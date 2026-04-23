# Dots and Boxes - Multiplayer Game

<p align="center">
  <img src="https://img.shields.io/badge/Go-1.21-00ADD8?logo=go" alt="Go 1.21">
  <img src="https://img.shields.io/badge/Nakama-3.18-orange" alt="Nakama 3.18">
  <img src="https://img.shields.io/badge/CockroachDB-Latest-6933FF?logo=cockroachlabs" alt="CockroachDB">
  <img src="https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker" alt="Docker">
</p>

A real-time multiplayer **Dots and Boxes** game built with Go, Nakama, and CockroachDB. Players compete to claim the most boxes on a grid by drawing lines between adjacent dots.

## 🎮 Quick Start

## Deployment
I have deployed this project into my private VPS so can be tested straight out-of-the-box. The URLs are:
- Client: http://arkadium-dots-boxes.s3-website.eu-west-1.amazonaws.com
- Server Nakama: http://161.97.163.223:7351/#/login?next=%2Fstatus
 
---

### Prerequisites

- **Docker & Docker Compose** (recommended)
- Or: Go 1.21+, CockroachDB 24+, Nakama 3.18+

### Run with Docker (Recommended)

```bash
# Clone and navigate to project
cd arkadium

# Start all services
make up

# Open in browser
open http://localhost:8080

# View logs
make logs
```

That's it! The game is now running at **http://localhost:8080**

### Run Locally Without Docker

```bash
# 1. Start CockroachDB and initialize the database
docker compose up -d cockroach-certs cockroachdb cockroach-init

# 2. Build Go module
cd server/go_modules
go build --buildmode=plugin -o backend.so

# 3. Start Nakama
nakama migrate up --database.address=postgresql://root:change-me@localhost:26257/nakama?sslmode=require
nakama --database.address=postgresql://root:change-me@localhost:26257/nakama?sslmode=require \
       --runtime.path=./server/go_modules

# 4. Serve client (in another terminal)
cd client
python3 -m http.server 8080

# 5. Open browser
open http://localhost:8080
```

---

## 📐 Architecture

### High-Level System Design

```
┌─────────────────┐          ┌──────────────────┐          ┌──────────────┐
│   Web Client    │          │   Nakama Server  │          │ CockroachDB  │
│   (HTML/JS)     │◄────────►│   (Go Runtime)   │◄────────►│   Database   │
│                 │ HTTP RPC │                  │   SQL    │              │
│                 │ + Socket │                  │          │              │
│  - Canvas Board │  RPC     │  - Game Logic    │          │  - States    │
│  - UI/UX        │  Push    │  - Validation    │          │  - History   │
│  - State Render │          │  - Persistence   │          │  - Sessions  │
└─────────────────┘          └──────────────────┘          └──────────────┘
```

### Component Breakdown

#### 1. **Client Layer** (`client/`)
- **Technology**: Vanilla JavaScript + HTML5 Canvas
- **Responsibilities**:
  - Render game board with dots, lines, and claimed boxes
  - Handle user input (clicking dots to draw lines)
  - Send mutations via Nakama HTTP RPC
  - Receive state changes through Nakama realtime socket channels
  - Display lobby, active game, and game over screens

**Files**:
- `index.html` - UI, styling, and DOM structure
- `client.js` - Thin browser entrypoint
- `services/dots-client.js` - Nakama client integration and state sync
- `ui/game-flow.js` - Lobby/game screen flows and UI updates

#### 2. **Game Server** (`server/go_modules/`)
- **Technology**: Go 1.21 + Nakama Runtime
- **Responsibilities**:
  - Enforce game rules (line validation, turn order)
  - Maintain authoritative game state
  - Detect box completion and award bonus turns
  - Persist game state to database after every move
  - Handle player joins, disconnections, and game lifecycle

**Files**:
- `module.go` - Nakama module registration
- `rpc_game.go` - RPC handlers
- `game_logic.go` - Game rules and turn logic
- `storage.go` - Persistence helpers
- `realtime.go` - Realtime broadcast helpers
- `types.go` - Shared game types

#### 3. **Database** (`CockroachDB`)
- **Technology**: CockroachDB with Nakama Storage Collections over the PostgreSQL wire protocol
- **Responsibilities**:
  - Store active game states (recoverable on server restart)
  - Persist match history when games complete
  - Enable queries for player statistics and game replays

**Collections** (schema details below):
- `game_states` - Current state of all active games
- `match_history` - Completed games with full move history

#### 4. **Deployment** (`docker-compose.yml`)
- **Technology**: Docker Compose
- **Services**:
  - `cockroachdb` - Distributed SQL database with health checks
  - `nakama` - Custom build with Go plugin
  - `client` - Nginx serving static files

---

## 🔄 Game State Flow

### Creating & Joining a Game

```
[Browser] User clicks "Create Game"
    ↓
[Client] RPC: create_game { gridSize: 5 }
    ↓
[Server] Generate UUID, initialize GameState
    ↓
[Server] Persist to CockroachDB (game_states collection)
    ↓
[Server] Broadcast lobby state to game channel
  ↓
[Client] Display Game ID, subscribe to game channel
    ↓
[Other Player] Enters Game ID, clicks "Join Game"
    ↓
[Server] Add player to GameState.players[]
    ↓
[Server] Update CockroachDB
    ↓
[Server] Broadcast updated lobby state
  ↓
[All Clients] Realtime update refreshes lobby immediately
    ↓
[Creator] Clicks "Start Game"
    ↓
[Server] Validates min 2 players, transitions state
    ↓
[All Clients] Redirected to game board
```

### Making a Move

```
[Browser] Player clicks two adjacent dots
    ↓
[Client] Validates selection, sends RPC: make_move
    ↓
[Server] Validates:
  - Is it this player's turn?
  - Is the line valid (adjacent, not already drawn)?
    ↓
[Server] Apply move:
  - Add line to GameState.lines[]
  - Check for completed boxes
  - Award boxes to current player
  - Update scores
  - Determine next player (bonus turn if boxes claimed)
    ↓
[Server] Check if game complete (all lines drawn)
    ↓
[Server] Persist updated GameState to CockroachDB
    ↓
[Server] If game complete, persist to match_history
    ↓
[Server] Return updated state to acting client
  ↓
[Server] Broadcast updated state to game channel
    ↓
[Client] Renders board, updates scores
    ↓
[All Clients] Update UI with new board state
```

### Persistence & Recovery

```
[Server Crash/Restart]
    ↓
[Nakama] Reconnects to CockroachDB
    ↓
[Client] Rejoin game and request get_game_state
    ↓
[Server] Reads from game_states collection
    ↓
[Server] Reconstructs GameState from JSON
    ↓
[Client] Receives full state, resumes rendering
    ↓
[Game Continues] No data loss, players reconnect seamlessly
```

---

## 📊 Database Schema

### GameState Collection (`game_states`)

Nakama stores this as JSON in CockroachDB's `storage` table.

```json
{
  "id": "a1b2c3d4-...",
  "players": [
    "user_abc123",
    "user_def456"
  ],
  "gridSize": 5,
  "lines": [
    "0:0-1:0",  // Line from (0,0) to (1,0)
    "1:0-1:1",
    "0:0-0:1"
  ],
  "boxes": {
    "0:0": "user_abc123",  // Box at (0,0) claimed by user_abc123
    "1:1": "user_def456"
  },
  "currentPlayerIndex": 0,
  "moves": [
    {
      "playerIndex": 0,
      "line": "0:0-1:0",
      "timestamp": 1650000000,
      "boxesClaimed": []
    },
    {
      "playerIndex": 1,
      "line": "1:0-1:1",
      "timestamp": 1650000010,
      "boxesClaimed": ["0:0"]
    }
  ],
  "createdAt": 1650000000,
  "updatedAt": 1650000020,
  "completed": false,
  "winner": "",
  "scores": {
    "user_abc123": 3,
    "user_def456": 5
  }
}
```

**Field Descriptions**:
- **id**: UUID of the game
- **players**: Array of Nakama user IDs
- **gridSize**: N×N grid (5 = 5×5 dots, 4×4 boxes)
- **lines**: Array of line keys (format: `"x1:y1-x2:y2"`)
- **boxes**: Map of box keys to player IDs
- **currentPlayerIndex**: Index into `players` array
- **moves**: Ordered array of all moves (for replay)
- **completed**: Boolean indicating game over
- **winner**: User ID of winner (empty if tie)
- **scores**: Map of player ID to score (boxes claimed)

### Match History Collection (`match_history`)

Persisted when a game completes.

```json
{
  "gameId": "a1b2c3d4-...",
  "players": ["user_abc123", "user_def456"],
  "gridSize": 5,
  "winner": "user_def456",
  "scores": {
    "user_abc123": 6,
    "user_def456": 10
  },
  "duration": 180,  // seconds
  "moveCount": 24,
  "completedAt": 1650000180,
  "moves": [...]  // Full move history
}
```

**Why CockroachDB + Nakama Storage?**
- ✅ ACID transactions ensure consistency
- ✅ JSON support allows flexible schema
- ✅ Nakama abstracts SQL complexity
- ✅ Scales to millions of games
- ✅ Easy to query for statistics/leaderboards

---

## 🎯 Game Logic Implementation

### Line Validation

```go
func isValidLine(gridSize, x1, y1, x2, y2 int, existingLines []string) bool {
    // 1. Check bounds: coordinates must be within 0 to gridSize-1
    // 2. Check adjacency: must be horizontal OR vertical, distance = 1
    // 3. Check uniqueness: line must not already exist
}
```

**Valid Lines**:
- `(0,0) → (1,0)` ✅ Horizontal
- `(2,3) → (2,4)` ✅ Vertical
- `(1,1) → (3,1)` ❌ Not adjacent
- `(0,0) → (1,1)` ❌ Diagonal

### Box Completion Detection

```go
func getCompletedBoxes(gridSize, x1, y1, x2, y2 int, lines []string) []string {
    // A box at (boxX, boxY) has 4 sides:
    // - Top:    (boxX, boxY) → (boxX+1, boxY)
    // - Bottom: (boxX, boxY+1) → (boxX+1, boxY+1)
    // - Left:   (boxX, boxY) → (boxX, boxY+1)
    // - Right:  (boxX+1, boxY) → (boxX+1, boxY+1)
    
    // When a line is drawn:
    // - If horizontal: check boxes above and below
    // - If vertical: check boxes left and right
}
```

### Turn Order

```
1. Player A draws a line → no boxes completed
   → Next player: Player B

2. Player B draws a line → completes 1 box
   → Next player: Player B (bonus turn!)

3. Player B draws another line → completes 2 boxes
   → Next player: Player B (bonus turn!)

4. Player B draws another line → no boxes completed
   → Next player: Player A
```

### Game Completion

```
Total lines on a 5×5 grid:
  Horizontal: 5 × 4 = 20
  Vertical:   4 × 5 = 20
  Total:      40 lines

Game ends when len(GameState.lines) == 40
```

---

## 🌐 Network Communication

### RPC Endpoints (HTTP POST)

All RPCs use Nakama's RPC system: `POST /v2/rpc/<function_name>`

#### 1. Create Game
```json
// Request
POST /v2/rpc/create_game
{
  "gridSize": 5
}

// Response
{
  "gameId": "a1b2c3d4-...",
  "status": "waiting_for_players"
}
```

#### 2. Join Game
```json
// Request
POST /v2/rpc/join_game
{
  "gameId": "a1b2c3d4-..."
}

// Response
{
  "gameId": "a1b2c3d4-...",
  "status": "joined",
  "players": ["user_abc", "user_def"],
  "playerCount": 2
}
```

#### 3. Get Game State
```json
// Request
POST /v2/rpc/get_game_state
{
  "gameId": "a1b2c3d4-..."
}

// Response
{
  // Full GameState JSON (see schema above)
}
```

#### 4. Start Game
```json
// Request
POST /v2/rpc/start_game
{
  "gameId": "a1b2c3d4-..."
}

// Response
{
  "gameId": "a1b2c3d4-...",
  "status": "started"
}
```

#### 5. Make Move
```json
// Request
POST /v2/rpc/make_move
{
  "gameId": "a1b2c3d4-...",
  "x1": 0,
  "y1": 0,
  "x2": 1,
  "y2": 0
}

// Response
{
  "valid": true,
  "boxesClaimed": ["0:0"],
  "currentPlayer": "user_def",
  "scores": {...},
  "completed": false,
  "gameState": {...}
}
```

### State Synchronization Strategy

**Chosen Approach**: **HTTP RPC for mutations + Nakama realtime sockets for state delivery**

- Clients send authoritative mutations via RPC
- Nakama broadcasts updated state over room channels
- `get_game_state` remains available for reconnect and refresh recovery

**Why This Approach?**
- ✅ Keeps move validation server-authoritative
- ✅ Reduces repeated read requests compared with steady-state polling
- ✅ Delivers lobby and gameplay updates immediately to all connected clients
- ✅ Still preserves a simple recovery path through explicit state fetches

---

## 🏗️ Technology Choices & Trade-offs

### Why Nakama?

**Pros**:
- ✅ Battle-tested (100M+ players served by licensees)
- ✅ Go runtime for game logic (native performance)
- ✅ Built-in authentication, storage, matchmaking
- ✅ Horizontal scalability (clustering support)
- ✅ Admin console for debugging
- ✅ Focus on game logic, not infrastructure

**Cons**:
- ⚠️ Vendor lock-in (Nakama-specific APIs)
- ⚠️ Steeper learning curve than raw Socket.IO
- ⚠️ Docker image is ~200MB

**Verdict**: Nakama is the right choice for production multiplayer games. It saves weeks of infrastructure work.

### Why Go for Server Logic?

**Pros**:
- ✅ Native Nakama runtime (no overhead)
- ✅ Excellent concurrency (goroutines)
- ✅ Strong typing prevents bugs
- ✅ Fast compilation and execution

**Cons**:
- ⚠️ More verbose than TypeScript/Lua
- ⚠️ Requires compilation step

**Verdict**: Go is ideal for game servers. The type safety and performance are worth the verbosity.

### Why CockroachDB?

**Pros**:
- ✅ ACID transactions (consistency guarantees)
- ✅ PostgreSQL wire compatibility for Nakama
- ✅ Horizontal scaling path beyond single-node deployments
- ✅ Rich SQL query capabilities (future analytics)
- ✅ Suitable backing store for Nakama's storage backend

**Cons**:
- ⚠️ Heavier than SQLite (overkill for small deployments)
- ⚠️ Requires separate service

**Alternatives Considered**:
- **Redis**: Fast but lacks ACID guarantees
- **MongoDB**: Good for NoSQL, but CockroachDB's SQL and JSON support is sufficient
- **SQLite**: Simple, but doesn't support concurrent writes at scale

**Verdict**: CockroachDB is the safe, scalable choice for this deployment while preserving Nakama compatibility.

### Why Vanilla JS (No Framework)?

**Pros**:
- ✅ Lightweight (no build step)
- ✅ Direct control over rendering
- ✅ Faster initial load
- ✅ Easier to audit and debug

**Cons**:
- ⚠️ More boilerplate than React/Vue
- ⚠️ Manual state management

**Verdict**: For a game with Canvas rendering, vanilla JS is sufficient and fast.

---

## 🔐 State Consistency & Persistence

### Consistency Model

**Server is Source of Truth**:
- All moves validated server-side
- Clients never modify state locally (except UI selection)
- Race conditions impossible (turn order enforced)

**Write Strategy**:
- **Every move** writes to CockroachDB
- No caching layer (simplicity over performance)
- Average write latency: ~10ms

**Read Strategy**:
- Clients receive realtime updates over Nakama room channels
- Server still reads from CockroachDB for reconnects and explicit recovery
- Could optimize with Redis cache or delta messages (future)

### Crash Recovery

```
Scenario: Nakama crashes mid-game

1. Nakama restarts
2. CockroachDB connection restored
3. Client refetches `get_game_state`
4. Server reads GameState from `game_states` collection
5. Client resumes rendering from last persisted state
6. Game continues with no data loss
```

**Maximum Data Loss**: Last 2 seconds (time between polls)

**Recovery Time**: ~5 seconds (health checks + DB connection)

### Disconnection Handling

**Current Implementation**:
- No explicit reconnection logic
- Players can refresh and rejoin via Game ID
- Turn order prevents out-of-sync moves

**Production Enhancement** (not implemented):
- Track last_seen timestamp per player
- Auto-forfeit after 60 seconds of inactivity
- Reconnection window with state diff sync

---

## 📈 Scaling to 10,000 Concurrent Players

### Current Bottlenecks

| Component | Current Limit | Bottleneck |
|-----------|---------------|------------|
| **Nakama** | ~500 concurrent games | CPU (Go plugin execution) |
| **CockroachDB** | ~10k writes/sec | Network round-trips, SQL contention |
| **Client Polling** | ~5k requests/sec | Network bandwidth |

### Scaling Strategy

#### 1. Horizontal Scaling (Nakama Cluster)

```
Load Balancer (Nginx)
    ↓
┌─────────┬─────────┬─────────┐
│ Nakama1 │ Nakama2 │ Nakama3 │
└─────────┴─────────┴─────────┘
       ↓          ↓          ↓
┌─────────────────────────────┐
│   CockroachDB Cluster       │
│   (multi-node SQL layer)    │
└─────────────────────────────┘
```

**Implementation**:
- Use Nakama's built-in clustering (Raft consensus)
- Session affinity at load balancer (sticky sessions)
- Shared CockroachDB cluster (10k games ≈ modest working set)

#### 2. Database Optimization

**Current**: Write-heavy (every move)

**Optimizations**:
1. **Connection Pooling**: 100 connections max
2. **Read Replicas**: Route `get_game_state` to replicas
3. **Indexes**: On `game_states.key` (UUID)
4. **Partitioning**: Shard by game_id hash
5. **Archive Completed Games**: Move to cold storage after 24h

**Expected Throughput**:
- 10k games × 1 move/minute = 167 writes/sec ✅
- 10k active games receiving realtime updates remains within Nakama room-channel expectations for a modest cluster ✅

#### 3. Client Optimization

**Current**: Realtime room updates with explicit recovery fetches

**Optimizations**:
1. **Delta Messages**: Broadcast only move deltas instead of full state payloads
2. **State Versioning**: Detect missed messages and trigger targeted resync
3. **CDN for Client**: Serve HTML/JS from CloudFlare (99% cache hit)

#### 4. Caching Layer

```
Nakama → Redis (game state cache) → CockroachDB
```

- Cache active games in Redis (TTL: 1 hour)
- Write-through on moves
- Fall back to CockroachDB on cache miss
- **Expected speedup**: 10ms → 1ms reads

---

## 📦 CDN Strategy

### Static Assets

**Current Setup**:
- Nginx serves `client/` directory
- No caching headers

**Production Setup**:

```
CloudFlare CDN
    ↓ (cache MISS)
Origin Server (S3 or Nginx)
    ↓
Static Files:
  - index.html (versioned: ?v=1.2.3)
  - client.js (hashed: client.a1b2c3.js)
  - nakama-js.umd.js (from unpkg.com)
```

**Cache Rules**:
- `index.html`: Cache 5 minutes (allow quick deploys)
- `client.js`: Cache 1 year (bust with hash)
- `nakama-js`: Cache 1 year (CDN fetches from unpkg)

**Geographic Distribution**:
- Serve from nearest edge location
- API calls still go to origin (us-east-1)
- **Expected latency**: 20ms (CDN) vs 200ms (cross-continent)

### API Endpoints

**Cannot CDN**:
- All RPCs (dynamic, user-specific)

**Can CDN**:
- Completed match history (immutable)

---

## 🧪 Testing Strategy

### Unit Tests (Go)

```bash
cd server/go_modules
go test -v
```

**Coverage**:
- `isValidLine()`: Edge cases (bounds, diagonal, duplicate)
- `getCompletedBoxes()`: All box positions (corners, edges, center)
- `applyMove()`: Turn order, bonus turns, game completion

### Integration Tests

**Manual Test Cases**:
1. Create game → Join game → Start game
2. Draw 4 lines around a box → Verify box claimed
3. Complete all lines → Verify winner calculated
4. Restart Nakama → Verify game recovers
5. Disconnect player → Verify game continues

**Automated (Future)**:
- Playwright for end-to-end browser tests
- Concurrent move submissions (race conditions)

### Load Testing

```bash
# artillery.yml
config:
  target: 'http://localhost:7350'
  phases:
    - duration: 60
      arrivalRate: 100  # 100 games/sec

scenarios:
  - name: "Play Full Game"
    flow:
      - post:
          url: "/v2/rpc/create_game"
          json: { gridSize: 5 }
      - post:
          url: "/v2/rpc/make_move"
          json: { gameId: "...", x1: 0, y1: 0, x2: 1, y2: 0 }
```

---

## 🚧 What I'd Do With More Time

### High Priority (Production-Critical)

2. **Comprehensive Testing** (4 hours)
   - Unit tests for all game logic
   - Integration tests for RPC flows
   - Load tests with 1000 concurrent games

3. **Authentication & Security** (3 hours)
   - Replace device auth with social login
   - Rate limiting (10 RPCs/second per user)
   - Input sanitization (prevent injection)

4. **Observability** (2 hours)
   - Structured logging (JSON format)
   - Prometheus metrics (game_duration, moves_per_game)
   - Grafana dashboards

5. **Database Migrations** (1 hour)
   - Use `golang-migrate` for schema versioning
   - Seed data for development
   - Backup/restore scripts

### Nice to Have (Product Features)

6. **Spectator Mode** (3 hours)
   - Read-only WebSocket connection
   - Live updates without playing
   - Query match_history and replay moves

7. **Player Profiles & Stats** (4 hours)
   - Win/loss record
   - Average game duration
   - Leaderboards (ELO ranking)

8. **Mobile Optimization** (2 hours)
   - Touch controls (tap dots)
   - Responsive canvas sizing
   - PWA manifest for installability

9. **Game Variants** (3 hours)
   - Power-ups (block opponent, remove line)
   - Timer per turn (30 seconds)
   - Larger grids (10×10, 15×15)

10. **AI Opponent** (6 hours)
    - Minimax algorithm for single-player
    - Difficulty levels (easy/medium/hard)
    - Runs server-side as virtual player

---

## 🐛 Known Limitations

1. **No Reconnection Flow**: If browser refreshes, must re-enter Game ID
2. **Polling Latency**: 2-second delay before seeing opponent's move
3. **No Player Names**: Users identified by auto-generated device IDs
4. **No Chat**: Can't communicate during game
5. **No Forfeit Button**: Can only leave (game persists)
6. **No Turn Timer**: Players can stall indefinitely
7. **No Mobile Touch Support**: Designed for desktop

---

## 📁 Project Structure

```
arkadium/
├── client/                     # Frontend (static files)
│   ├── index.html              # UI structure and styling
│   └── client.js               # Nakama client, game rendering
│
├── server/                     # Backend (Nakama runtime)
│   ├── go_modules/
│   │   ├── main.go             # RPC handlers, game logic
│   │   └── go.mod              # Go dependencies
│   └── Dockerfile              # Nakama + Go plugin build
│
├── docker-compose.yml          # Full stack orchestration
├── Makefile                    # Development commands
├── README.md                   # This file
├── ARCHITECTURE.md             # Deep dive (optional)
└── .gitignore
```

---

## 🔧 Development Workflow

```bash
# Start environment
make up

# View logs
make logs                 # All services
make nakama-logs          # Just Nakama
make client-logs          # Just Nginx

# Rebuild after code changes
make rebuild

# Access database
make shell-db             # psql shell
SELECT * FROM storage WHERE collection = 'game_states';

# Stop everything
make down

# Clean up volumes (deletes database!)
make clean
```

---

## 🌍 Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `COCKROACH_DB_NAME` | `nakama` | CockroachDB database name |
| `COCKROACH_DB_USER` | `root` | CockroachDB SQL user |
| `COCKROACH_DB_PASSWORD` | `change-me` | CockroachDB SQL password used during setup |
| `CLIENT_SERVER_HOST` | `localhost` | Hostname the browser uses for the Nakama API/socket |
| `CLIENT_SERVER_PORT` | `7350` | Port the browser uses for the Nakama API/socket |
| `CLIENT_SERVER_USE_SSL` | `false` | Whether the browser should use HTTPS/WSS for Nakama |

---

## 📞 Troubleshooting

### Client can't connect to Nakama

```bash
# Check if Nakama is running
make ps
make nakama-logs

# Verify port is open
curl http://localhost:7350/

# Check CORS (Nakama allows all origins by default)
```

### Game state not persisting

```bash
# Check CockroachDB
make shell-db
SELECT * FROM storage WHERE collection = 'game_states';

# Verify writes
make nakama-logs | grep "StorageWrite"
```

### Go plugin won't build

```bash
# Rebuild from scratch
make clean
make rebuild

# Check Go version
docker-compose exec nakama go version  # Should be 1.21+
```

---

## 📄 License

This project is a coding challenge implementation for Arkadium. Use as reference for educational purposes.

---

## 🙏 Acknowledgments

- **Nakama** by Heroic Labs - Excellent open-source game server
- **CockroachDB** - Distributed SQL database compatible with Nakama's PostgreSQL connection layer
- **Arkadium** - For the well-designed coding challenge
