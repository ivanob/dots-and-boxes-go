# Architecture Deep Dive

This document provides a detailed technical analysis of the Dots and Boxes multiplayer game architecture.

## Table of Contents

1. [State Flow](#state-flow)
2. [Database Design](#database-design)
3. [Disconnection Handling](#disconnection-handling)
4. [Scaling Analysis](#scaling-analysis)
5. [CDN Integration](#cdn-integration)
6. [Spectator Mode Design](#spectator-mode-design)

---

## State Flow

### Client → Server → Database Data Pipeline

```
┌─────────────┐
│   Browser   │
│   (Client)  │
└──────┬──────┘
       │
       │ 1. User clicks dots → draw line
       │
       ▼
┌─────────────┐
│  client.js  │
│             │
│ - Validate  │ 2. Client-side validation (prevent obvious errors)
│   selection │    - Adjacent dots?
│ - RPC call  │    - Is it my turn?
└──────┬──────┘
       │
       │ 3. HTTP POST /v2/rpc/make_move
       │    { gameId, x1, y1, x2, y2 }
       │
       ▼
┌─────────────┐
│   Nakama    │
│  HTTP API   │
└──────┬──────┘
       │
       │ 4. Authenticate session
       │
       ▼
┌─────────────┐
│  main.go    │
│rpcMakeMove()│
│             │
│ - Validate  │ 5. Server-side validation (authoritative)
│   player    │    - Is this player in the game?
│ - Apply     │    - Is it their turn?
│   logic     │    - Is the line valid?
└──────┬──────┘
       │
       │ 6. applyMove() mutates GameState
       │    - Add line to state
       │    - Check for completed boxes
       │    - Award points
       │    - Determine next player
       │
       ▼
┌─────────────┐
│ GameState   │
│ (in-memory) │
└──────┬──────┘
       │
       │ 7. Serialize to JSON
       │
       ▼
┌─────────────┐
│  Nakama     │
│ StorageWrite│
└──────┬──────┘
       │
       │ 8. SQL INSERT/UPDATE
       │
       ▼
┌─────────────┐
│ CockroachDB │
│   storage   │
│   table     │
└──────┬──────┘
       │
       │ 9. COMMIT transaction
       │
       ▼
┌─────────────┐
│   Disk      │
│ (persisted) │
└─────────────┘
```

### Read Path (Realtime + Recovery)

```
On game mutation:

Acting client → HTTP RPC mutation → Nakama
               ↓
             StorageWrite
               ↓
             CockroachDB
               ↓
          ChannelMessageSend
               ↓
Clients subscribed to room channel
       ↓
  Update UI

On reconnect or refresh:

Client → RPC get_game_state → Nakama
                                  ↓
                            StorageRead
                                  ↓
                            CockroachDB
                                  ↓
                            Deserialize JSON
                                  ↓
                            Return GameState
                                  ↓
Client ← Update UI ← Response
```

---

## Database Design

### Physical Storage (CockroachDB)

Nakama uses a single `storage` table:

```sql
CREATE TABLE storage (
    collection VARCHAR(128) NOT NULL,
    key VARCHAR(128) NOT NULL,
    user_id VARCHAR(128),
    value JSONB NOT NULL,
    version VARCHAR(16) NOT NULL,
    read INTEGER NOT NULL DEFAULT 0,
    write INTEGER NOT NULL DEFAULT 0,
    create_time TIMESTAMP NOT NULL DEFAULT NOW(),
    update_time TIMESTAMP NOT NULL DEFAULT NOW(),
    PRIMARY KEY (collection, key, user_id)
);

CREATE INDEX idx_collection ON storage (collection);
```

### Collections

#### 1. `game_states`

**Purpose**: Active games (in progress or waiting for players)

**Key**: `game_id` (UUID)

**Value** (JSONB):
```json
{
  "id": "uuid",
  "players": ["user1", "user2"],
  "gridSize": 5,
  "lines": ["0:0-1:0", ...],
  "boxes": {"0:0": "user1"},
  "currentPlayerIndex": 0,
  "moves": [{...}],
  "createdAt": 1650000000,
  "updatedAt": 1650000100,
  "completed": false,
  "winner": "",
  "scores": {"user1": 3, "user2": 5}
}
```

**Size**: ~2KB per game (5×5 grid, 2 players, 40 moves)

**Retention**: Forever (allows rejoining after server restart)

**Cleanup Strategy** (production):
- Archive games older than 7 days
- Delete abandoned games (no moves in 24 hours)

#### 2. `match_history`

**Purpose**: Completed games (for statistics, replay, leaderboards)

**Key**: `game_id` (UUID)

**Value** (JSONB):
```json
{
  "gameId": "uuid",
  "players": ["user1", "user2"],
  "gridSize": 5,
  "winner": "user2",
  "scores": {"user1": 6, "user2": 10},
  "duration": 180,
  "moveCount": 24,
  "completedAt": 1650000180,
  "moves": [{...}]
}
```

**Size**: ~3KB per game

**Retention**: Forever (valuable for analytics)

**Queries** (future):
```sql
-- Leaderboard
SELECT user_id, COUNT(*) as wins
FROM storage
WHERE collection = 'match_history'
  AND value->>'winner' IS NOT NULL
GROUP BY user_id
ORDER BY wins DESC
LIMIT 100;

-- Player win rate
SELECT 
  CASE 
    WHEN value->>'winner' = 'user123' THEN 'win'
    ELSE 'loss'
  END as result,
  COUNT(*)
FROM storage
WHERE collection = 'match_history'
  AND value->'players' @> '["user123"]'
GROUP BY result;
```

### Indexing Strategy

**Current** (Nakama defaults):
- Primary key: `(collection, key, user_id)`
- Index on `collection`

**Production Enhancements**:
```sql
-- Fast lookup by player
CREATE INDEX idx_players ON storage 
  USING gin ((value->'players')) 
  WHERE collection = 'match_history';

-- Fast lookup by completion time
CREATE INDEX idx_completed_at ON storage 
  ((value->>'completedAt')::BIGINT) 
  WHERE collection = 'match_history';

-- Fast lookup by grid size
CREATE INDEX idx_grid_size ON storage 
  ((value->>'gridSize')::INT) 
  WHERE collection = 'game_states';
```

### Consistency Guarantees

**Transaction Isolation**: Serializable (CockroachDB default)

**Invariants**:
1. `len(lines)` always matches sum of `moves[].line`
2. `sum(scores)` always equals `len(boxes)`
3. `currentPlayerIndex` always in range `[0, len(players))`
4. If `completed = true`, then `len(lines) == getTotalLines(gridSize)`

**Enforcement**:
- Server-side validation before write
- No client-side mutations
- CockroachDB JSON schema validation / constraints (future)

---

## Disconnection Handling

### Current Implementation

**No explicit reconnection logic** - players can:
1. Refresh browser
2. Navigate to lobby
3. Enter Game ID
4. Rejoin game

**Limitations**:
- No visual indication of disconnected players
- No automatic reconnection
- No timeout/forfeit mechanism

### Production Design

#### Player States

```
CONNECTED → Player polling every 2s
IDLE → No poll in 10s (show warning)
DISCONNECTED → No poll in 60s (auto-forfeit)
RECONNECTED → Poll resumes within 60s
```

#### Reconnection Flow

```go
type PlayerSession struct {
    UserID       string
    GameID       string
    LastSeen     int64  // Unix timestamp
    Disconnected bool
}

// Nakama After Hook (every RPC)
func afterRPC(ctx context.Context, gameId string, userId string) {
    updatePlayerSession(userId, gameId, time.Now().Unix())
}

// Background goroutine (runs every 30s)
func checkInactivePlayers() {
    now := time.Now().Unix()
    sessions := loadAllSessions()
    
    for _, session := range sessions {
        if now - session.LastSeen > 60 {
            // Auto-forfeit
            forfeitGame(session.GameID, session.UserID)
        } else if now - session.LastSeen > 10 {
            // Mark as idle
            notifyOtherPlayers(session.GameID, "Player idle")
        }
    }
}
```

#### Persisted State Recovery

**On server restart**:

```go
func loadGameState(gameId string) *GameState {
    // 1. Read from CockroachDB
    objects := nk.StorageRead([]{
        Collection: "game_states",
        Key: gameId,
    })
    
    // 2. Deserialize JSON
    var state GameState
    json.Unmarshal(objects[0].Value, &state)
    
    // 3. Restore in-memory state
    return &state
}
```

**Client side**:

```javascript
// On page load
const gameId = localStorage.getItem("current_game_id");
if (gameId) {
    const state = await dotsClient.getGameState(gameId);
    if (!state.completed) {
        showGameScreen();  // Resume game
    }
}
```

---

## Scaling Analysis

### Bottleneck Identification

#### 1. Nakama CPU (Game Logic)

**Current Capacity**:
- 1 core @ 3GHz
- ~1ms per move (validation + logic)
- **Max**: 1000 moves/sec = 60,000 moves/min

**Scaling Strategy**:
- Horizontal: Add more Nakama instances
- Vertical: Use CPU-optimized instances (c5.4xlarge)

#### 2. CockroachDB I/O (Persistence)

**Current Capacity**:
- gp3 SSD: 3000 IOPS baseline
- ~10ms per write (including network)
- **Max**: 300 writes/sec

**Scaling Strategy**:
- Read replicas for `get_game_state` (read-heavy)
- Connection pooling (PgBouncer)
- Batch writes (group moves into transactions)
- Upgrade to io2 (64,000 IOPS)

#### 3. Client Polling (Network)

**Current Load**:
- 10,000 games × 2 polls/sec = 20,000 requests/sec

**Scaling Strategy**:
- Switch to WebSockets (eliminate polling)
- Adaptive polling (slow down when idle)
- HTTP/2 multiplexing

### Architecture at 10k Concurrent Games

```
┌─────────────────────────────────────┐
│         CloudFlare CDN              │ (static assets)
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│     Application Load Balancer       │
│     (AWS ALB or Nginx)              │
└──────────────┬──────────────────────┘
               │
       ┌───────┼───────┐
       │       │       │
┌──────▼──┐ ┌──▼────┐ ┌▼──────┐
│ Nakama1 │ │Nakama2│ │Nakama3│  (3 instances, auto-scaling)
└──────┬──┘ └───┬───┘ └───┬───┘
       │        │         │
       └────────┼─────────┘
                │
       ┌────────▼────────┐
       │   Redis Cluster  │  (in-memory cache)
       │   (3 nodes)      │
       └────────┬────────┘
                │
       ┌────────▼────────┐
      │  CockroachDB    │
       │  Primary (RW)   │
       └────────┬────────┘
                │
       ┌────────┼────────┐
       │        │        │
  ┌────▼───┐ ┌─▼────┐ ┌─▼────┐
  │ Read   │ │ Read │ │ Read │  (3 read replicas)
  │Replica1│ │Repli2│ │Repli3│
  └────────┘ └──────┘ └──────┘
```

### Performance Projections

| Metric | Current | At 10k Games |
|--------|---------|--------------|
| **Active Games** | 1-10 | 10,000 |
| **Concurrent Players** | 2-20 | 20,000 |
| **Moves/minute** | 10 | 10,000 |
| **DB Size** | 10 MB | 20 GB |
| **Memory (Nakama)** | 256 MB | 4 GB |
| **CPU (Nakama)** | 5% | 60% (3 instances) |
| **CockroachDB IOPS** | <10 | 500 |
| **Network (polling)** | 10 req/s | 20,000 req/s |

### Cost Estimation (AWS)

| Resource | Instance | Monthly Cost |
|----------|----------|--------------|
| Nakama (3×) | c5.2xlarge | $510 |
| CockroachDB | 3x db.r6g.large equivalent | $408 |
| Redis (cache) | cache.r5.large | $170 |
| Load Balancer | ALB | $25 |
| **Total** | | **$1,113/month** |

---

## CDN Integration

### Asset Delivery Pipeline

```
Developer → Git Push → CI/CD → S3 Bucket → CloudFlare CDN → User
                                    │
                                    ▼
                            Origin (CloudFront)
```

### Cache Configuration

```nginx
# Nginx (origin server)
location ~* \.(html)$ {
    expires 5m;
    add_header Cache-Control "public, max-age=300";
}

location ~* \.(js|css)$ {
    expires 1y;
    add_header Cache-Control "public, immutable, max-age=31536000";
}

# Versioning strategy
# client.js → client.abc123.js (hash in filename)
# index.html → index.html?v=1.2.3 (query param)
```

### Deployment Workflow

```bash
# 1. Build assets
npm run build

# 2. Upload to S3
aws s3 sync dist/ s3://dots-and-boxes-static/

# 3. Invalidate CDN
aws cloudfront create-invalidation \
  --distribution-id E1234 \
  --paths "/index.html"

# 4. New users get latest version
# Cached users get updated on next refresh (5 min max)
```

### Performance Gains

| Metric | No CDN | With CDN |
|--------|--------|----------|
| **TTFB (US)** | 200ms | 20ms |
| **TTFB (Europe)** | 400ms | 30ms |
| **TTFB (Asia)** | 600ms | 40ms |
| **Bandwidth Cost** | $0.09/GB | $0.01/GB |

---

## Spectator Mode Design

### Requirements

1. View live games without playing
2. See historical games (replay)
3. No impact on game performance

### Implementation

#### 1. Read-Only Game State Access

```go
// New RPC: spectate_game
func rpcSpectateGame(ctx context.Context, payload string) (string, error) {
    var req struct {
        GameID string `json:"gameId"`
    }
    json.Unmarshal([]byte(payload), &req)
    
    // Load game state (read-only)
    gameState := loadGameState(ctx, logger, nk, req.GameID)
    
    // Return redacted state (hide player IDs)
    redacted := redactPlayerInfo(gameState)
    
    return json.Marshal(redacted)
}
```

#### 2. Live Updates (WebSocket)

```javascript
// client.js
async function spectateGame(gameId) {
    // Connect to Nakama socket
    const socket = client.createSocket();
    await socket.connect(session);
    
    // Join spectator room
    await socket.send({
        room_join: {
            room_id: gameId,
            spectator: true
        }
    });
    
    // Listen for move broadcasts
    socket.onroommessage = (message) => {
        updateBoard(message.data);
    };
}
```

#### 3. Historical Replay

```javascript
async function replayGame(gameId) {
    // Fetch match history
    const history = await client.rpc(session, "get_match_history", { gameId });
    
    // Animate moves sequentially
    for (const move of history.moves) {
        await sleep(500);  // 500ms between moves
        renderMove(move);
    }
}
```

### Database Queries

```sql
-- Get recent completed games
SELECT 
    key as game_id,
    value->>'winner' as winner,
    value->>'gridSize' as grid_size,
    (value->>'completedAt')::BIGINT as completed_at
FROM storage
WHERE collection = 'match_history'
ORDER BY (value->>'completedAt')::BIGINT DESC
LIMIT 20;

-- Get game by ID
SELECT value
FROM storage
WHERE collection = 'match_history'
  AND key = 'game_id_123';
```

---

## Conclusion

This architecture balances:
- **Simplicity**: Easy to understand and debug
- **Reliability**: CockroachDB ensures consistency
- **Scalability**: Clear path to 10k+ concurrent games
- **Performance**: Sub-100ms response times

Key design decisions:
1. **Go + Nakama**: Production-grade game server
2. **CockroachDB**: ACID guarantees over NoSQL speed
3. **RPC + Realtime Channels**: Simplicity for authoritative writes with immediate client updates
4. **Server Authority**: All validation server-side

Trade-offs accepted:
- 2-second polling latency (acceptable for turn-based)
- No client-side prediction (simplicity over responsiveness)
- No distributed caching (premature optimization)

This architecture is production-ready for <1000 concurrent games with minor enhancements.
