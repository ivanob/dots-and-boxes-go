# Quick Start Guide

## 🚀 Launch the Game (3 steps)

```bash
cd arkadium
./start.sh
open http://localhost:8080
```

## 🎮 How to Play

### Creating a Game
1. Open http://localhost:8080
2. Click **"Create Game"**
3. Copy the Game ID
4. Share with another player

### Joining a Game
1. Open http://localhost:8080
2. Paste the Game ID
3. Click **"Join Game"**
4. Wait for the host to start

### Playing
1. Take turns drawing lines between adjacent dots
2. Complete a box (4 sides) to claim it and get a bonus turn
3. Game ends when all lines are drawn
4. Player with most boxes wins!

## 🛠️ Development Commands

```bash
make up          # Start services
make logs        # View logs
make down        # Stop services
make rebuild     # Rebuild after code changes
make clean       # Remove all data
```

## 📊 Access Points

- **Game**: http://localhost:8080
- **Nakama Console**: http://localhost:7351 (admin:password)
- **Nakama API**: http://localhost:7350
- **Database**: `make shell-db` for a CockroachDB SQL shell

## 🧪 Testing the Game

### Test Scenario 1: Basic Game Flow
1. Open two browser windows
2. Window 1: Create game, copy ID
3. Window 2: Join game with ID
4. Window 1: Start game
5. Take turns making moves
6. Verify score updates
7. Complete all lines
8. Check winner screen

### Test Scenario 2: Persistence
1. Create and start a game
2. Make a few moves
3. Stop Nakama: `docker-compose restart nakama`
4. Refresh browser
5. Game state should be preserved

### Test Scenario 3: Invalid Moves
1. Try to move when it's not your turn → Should fail
2. Try to draw a diagonal line → Should fail
3. Try to draw a line twice → Should fail

## 📝 Architecture Overview

```
Browser → Nakama (Go) → CockroachDB
   ↑                        ↓
        └── Realtime socket push ┘
```

- **Client**: Vanilla JS + Canvas
- **Server**: Nakama with Go runtime
- **Database**: CockroachDB
- **Communication**: HTTP RPC + Realtime socket updates

## 🐛 Troubleshooting

### Services won't start
```bash
make clean
make up
make logs
```

### Can't connect to game
- Check Nakama is running: `curl http://localhost:7350`
- Check logs: `make nakama-logs`
- Verify port 7350 is not in use

### Database issues
```bash
make shell-db
SELECT * FROM storage WHERE collection = 'game_states';
```

## 📚 Documentation

- **README.md** - Complete documentation
- **ARCHITECTURE.md** - Deep technical dive
- **server/go_modules/game_logic.go** - Core game rule implementation

## 🎯 Key Features Implemented

✅ Real-time multiplayer (server-pushed updates)
✅ Persistent game state
✅ Match history
✅ Turn-based gameplay with bonus turns
✅ Game completion detection
✅ Docker deployment
✅ Comprehensive documentation

## 💡 Next Steps

1. Add player authentication
2. Add leaderboards and statistics
3. Create mobile-responsive UI
4. Add AI opponent for single-player mode
