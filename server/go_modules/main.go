package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	GameStateCollection    = "game_states"
	MatchHistoryCollection = "match_history"
)

// GameState represents the complete state of a Dots and Boxes game
type GameState struct {
	ID                 string            `json:"id"`
	Players            []string          `json:"players"`
	GridSize           int               `json:"gridSize"`
	Started            bool              `json:"started"`
	Lines              []string          `json:"lines"`
	Boxes              map[string]string `json:"boxes"`
	CurrentPlayerIndex int               `json:"currentPlayerIndex"`
	Moves              []Move            `json:"moves"`
	CreatedAt          int64             `json:"createdAt"`
	UpdatedAt          int64             `json:"updatedAt"`
	Completed          bool              `json:"completed"`
	Winner             string            `json:"winner,omitempty"`
	Scores             map[string]int    `json:"scores"`
}

// Move represents a single move in the game
type Move struct {
	PlayerIndex  int      `json:"playerIndex"`
	Line         string   `json:"line"`
	Timestamp    int64    `json:"timestamp"`
	BoxesClaimed []string `json:"boxesClaimed"`
}

// MoveResult contains the result of applying a move
type MoveResult struct {
	Valid        bool     `json:"valid"`
	BoxesClaimed []string `json:"boxesClaimed"`
	NextPlayer   int      `json:"nextPlayer"`
}

// InitModule registers RPCs and match handlers
func InitModule(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, initializer runtime.Initializer) error {
	if err := initializer.RegisterRpc("create_game", rpcCreateGame); err != nil {
		return err
	}
	if err := initializer.RegisterRpc("join_game", rpcJoinGame); err != nil {
		return err
	}
	if err := initializer.RegisterRpc("get_game_state", rpcGetGameState); err != nil {
		return err
	}
	if err := initializer.RegisterRpc("start_game", rpcStartGame); err != nil {
		return err
	}
	if err := initializer.RegisterRpc("make_move", rpcMakeMove); err != nil {
		return err
	}
	if err := initializer.RegisterRpc("leave_game", rpcLeaveGame); err != nil {
		return err
	}

	logger.Info("Dots and Boxes module initialized")
	return nil
}

func broadcastGameEvent(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, gameID string, content map[string]interface{}) {
	channelID, err := nk.ChannelIdBuild(ctx, "", gameID, runtime.Room)
	if err != nil {
		logger.Error("Failed to build game channel for %s: %v", gameID, err)
		return
	}

	if _, err = nk.ChannelMessageSend(ctx, channelID, content, "", "", false); err != nil {
		logger.Error("Failed to broadcast game event for %s: %v", gameID, err)
	}
}

func broadcastGameState(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, gameState *GameState) {
	content := map[string]interface{}{
		"type":      "game_state_update",
		"gameId":    gameState.ID,
		"gameState": gameState,
	}

	broadcastGameEvent(ctx, logger, nk, gameState.ID, content)
}

// rpcCreateGame creates a new game
func rpcCreateGame(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var request struct {
		GridSize int `json:"gridSize"`
	}

	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", err
	}

	if request.GridSize == 0 {
		request.GridSize = 5
	}

	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok {
		return "", errors.New("user ID not found")
	}

	gameID := uuid.New().String()
	gameState := &GameState{
		ID:                 gameID,
		Players:            []string{userID},
		GridSize:           request.GridSize,
		Started:            false,
		Lines:              []string{},
		Boxes:              make(map[string]string),
		CurrentPlayerIndex: 0,
		Moves:              []Move{},
		CreatedAt:          time.Now().Unix(),
		UpdatedAt:          time.Now().Unix(),
		Completed:          false,
		Scores:             map[string]int{userID: 0},
	}

	if err := persistGameState(ctx, logger, nk, gameState); err != nil {
		logger.Error("Failed to persist game state: %v", err)
		return "", err
	}

	broadcastGameState(ctx, logger, nk, gameState)

	response := map[string]interface{}{
		"gameId":    gameID,
		"status":    "waiting_for_players",
		"gameState": gameState,
	}

	data, _ := json.Marshal(response)
	return string(data), nil
}

// rpcJoinGame allows a player to join an existing game
func rpcJoinGame(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var request struct {
		GameID string `json:"gameId"`
	}

	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", err
	}

	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok {
		return "", errors.New("user ID not found")
	}

	gameState, err := loadGameState(ctx, logger, nk, request.GameID)
	if err != nil {
		return "", err
	}

	if gameState.Completed {
		return "", errors.New("game already completed")
	}

	// Check if player already in game
	for _, pid := range gameState.Players {
		if pid == userID {
			return "", errors.New("player already in game")
		}
	}

	gameState.Players = append(gameState.Players, userID)
	gameState.Scores[userID] = 0
	if len(gameState.Players) >= 2 {
		gameState.Started = true
	}
	gameState.UpdatedAt = time.Now().Unix()

	if err := persistGameState(ctx, logger, nk, gameState); err != nil {
		return "", err
	}

	broadcastGameState(ctx, logger, nk, gameState)

	response := map[string]interface{}{
		"gameId":      request.GameID,
		"status":      map[bool]string{true: "started", false: "joined"}[gameState.Started],
		"players":     gameState.Players,
		"playerCount": len(gameState.Players),
		"gameState":   gameState,
	}

	data, _ := json.Marshal(response)
	return string(data), nil
}

// rpcGetGameState retrieves the current game state
func rpcGetGameState(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var request struct {
		GameID string `json:"gameId"`
	}

	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", err
	}

	gameState, err := loadGameState(ctx, logger, nk, request.GameID)
	if err != nil {
		return "", err
	}

	data, _ := json.Marshal(gameState)
	return string(data), nil
}

// rpcStartGame transitions game from lobby to active
func rpcStartGame(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var request struct {
		GameID string `json:"gameId"`
	}

	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", err
	}

	gameState, err := loadGameState(ctx, logger, nk, request.GameID)
	if err != nil {
		return "", err
	}

	if len(gameState.Players) < 2 {
		return "", errors.New("need at least 2 players to start")
	}

	gameState.Started = true

	gameState.UpdatedAt = time.Now().Unix()

	if err := persistGameState(ctx, logger, nk, gameState); err != nil {
		return "", err
	}

	broadcastGameState(ctx, logger, nk, gameState)

	response := map[string]interface{}{
		"gameId":    request.GameID,
		"status":    "started",
		"gameState": gameState,
	}

	data, _ := json.Marshal(response)
	return string(data), nil
}

// rpcMakeMove handles a player making a move
func rpcMakeMove(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var request struct {
		GameID string `json:"gameId"`
		X1     int    `json:"x1"`
		Y1     int    `json:"y1"`
		X2     int    `json:"x2"`
		Y2     int    `json:"y2"`
	}

	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", err
	}

	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok {
		return "", errors.New("user ID not found")
	}

	gameState, err := loadGameState(ctx, logger, nk, request.GameID)
	if err != nil {
		return "", err
	}

	playerIndex := -1
	for i, pid := range gameState.Players {
		if pid == userID {
			playerIndex = i
			break
		}
	}

	if playerIndex == -1 {
		return "", errors.New("player not in game")
	}

	if !gameState.Started {
		return "", errors.New("game has not started")
	}

	result := applyMove(gameState, playerIndex, request.X1, request.Y1, request.X2, request.Y2)

	if !result.Valid {
		return "", errors.New("invalid move")
	}

	gameState.UpdatedAt = time.Now().Unix()

	if err := persistGameState(ctx, logger, nk, gameState); err != nil {
		return "", err
	}

	broadcastGameState(ctx, logger, nk, gameState)

	// If game completed, persist match history
	if gameState.Completed {
		if err := persistMatchHistory(ctx, logger, nk, gameState); err != nil {
			logger.Error("Failed to persist match history: %v", err)
		}
	}

	response := map[string]interface{}{
		"valid":         true,
		"boxesClaimed":  result.BoxesClaimed,
		"currentPlayer": gameState.Players[result.NextPlayer],
		"scores":        gameState.Scores,
		"completed":     gameState.Completed,
		"winner":        gameState.Winner,
		"gameState":     gameState,
	}

	data, _ := json.Marshal(response)
	return string(data), nil
}

func rpcLeaveGame(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
	var request struct {
		GameID string `json:"gameId"`
	}

	if err := json.Unmarshal([]byte(payload), &request); err != nil {
		return "", err
	}

	userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
	if !ok {
		return "", errors.New("user ID not found")
	}

	gameState, err := loadGameState(ctx, logger, nk, request.GameID)
	if err != nil {
		return "", err
	}

	playerFound := false
	for _, playerID := range gameState.Players {
		if playerID == userID {
			playerFound = true
			break
		}
	}

	if !playerFound {
		return "", errors.New("player not in game")
	}

	if err := deleteGameState(ctx, nk, request.GameID); err != nil {
		return "", err
	}

	broadcastGameEvent(ctx, logger, nk, request.GameID, map[string]interface{}{
		"type":     "game_closed",
		"gameId":   request.GameID,
		"closedBy": userID,
		"reason":   "player_left",
	})

	response := map[string]interface{}{
		"gameId": request.GameID,
		"closed": true,
	}

	data, _ := json.Marshal(response)
	return string(data), nil
}

// Game logic functions

func getLineKey(x1, y1, x2, y2 int) string {
	minX, maxX := x1, x2
	if x1 > x2 {
		minX, maxX = x2, x1
	}
	minY, maxY := y1, y2
	if y1 > y2 {
		minY, maxY = y2, y1
	}
	return fmt.Sprintf("%d:%d-%d:%d", minX, minY, maxX, maxY)
}

func getBoxKey(x, y int) string {
	return fmt.Sprintf("%d:%d", x, y)
}

func isValidLine(gridSize int, x1, y1, x2, y2 int, existingLines []string) bool {
	// Check bounds
	if x1 < 0 || x1 >= gridSize || x2 < 0 || x2 >= gridSize {
		return false
	}
	if y1 < 0 || y1 >= gridSize || y2 < 0 || y2 >= gridSize {
		return false
	}

	// Must be horizontal or vertical
	if x1 == x2 && int(math.Abs(float64(y1-y2))) == 1 {
		// Horizontal
	} else if y1 == y2 && int(math.Abs(float64(x1-x2))) == 1 {
		// Vertical
	} else {
		return false
	}

	// Line must not already exist
	lineKey := getLineKey(x1, y1, x2, y2)
	for _, line := range existingLines {
		if line == lineKey {
			return false
		}
	}

	return true
}

func isBoxComplete(boxX, boxY int, lines []string) bool {
	top := getLineKey(boxX, boxY, boxX+1, boxY)
	bottom := getLineKey(boxX, boxY+1, boxX+1, boxY+1)
	left := getLineKey(boxX, boxY, boxX, boxY+1)
	right := getLineKey(boxX+1, boxY, boxX+1, boxY+1)

	hasTop, hasBottom, hasLeft, hasRight := false, false, false, false
	for _, line := range lines {
		if line == top {
			hasTop = true
		}
		if line == bottom {
			hasBottom = true
		}
		if line == left {
			hasLeft = true
		}
		if line == right {
			hasRight = true
		}
	}

	return hasTop && hasBottom && hasLeft && hasRight
}

func getCompletedBoxes(gridSize, x1, y1, x2, y2 int, lines []string) []string {
	completed := []string{}
	boxCount := gridSize - 1

	// Vertical line
	if x1 == x2 {
		x := x1
		minY := y1
		if y1 > y2 {
			minY = y2
		}

		// Box left
		if x > 0 {
			boxX, boxY := x-1, minY
			if isBoxComplete(boxX, boxY, lines) {
				completed = append(completed, getBoxKey(boxX, boxY))
			}
		}

		// Box right
		if x < boxCount {
			boxX, boxY := x, minY
			if isBoxComplete(boxX, boxY, lines) {
				completed = append(completed, getBoxKey(boxX, boxY))
			}
		}
	} else if y1 == y2 { // Horizontal line
		y := y1
		minX := x1
		if x1 > x2 {
			minX = x2
		}

		// Box above
		if y > 0 {
			boxX, boxY := minX, y-1
			if isBoxComplete(boxX, boxY, lines) {
				completed = append(completed, getBoxKey(boxX, boxY))
			}
		}

		// Box below
		if y < boxCount {
			boxX, boxY := minX, y
			if isBoxComplete(boxX, boxY, lines) {
				completed = append(completed, getBoxKey(boxX, boxY))
			}
		}
	}

	return completed
}

func getTotalLines(gridSize int) int {
	return gridSize*(gridSize-1) + (gridSize-1)*gridSize
}

func isGameComplete(gameState *GameState) bool {
	return len(gameState.Lines) >= getTotalLines(gameState.GridSize)
}

func applyMove(gameState *GameState, playerIndex, x1, y1, x2, y2 int) MoveResult {
	if gameState.Completed {
		return MoveResult{Valid: false, BoxesClaimed: []string{}, NextPlayer: gameState.CurrentPlayerIndex}
	}

	if playerIndex != gameState.CurrentPlayerIndex {
		return MoveResult{Valid: false, BoxesClaimed: []string{}, NextPlayer: gameState.CurrentPlayerIndex}
	}

	if !isValidLine(gameState.GridSize, x1, y1, x2, y2, gameState.Lines) {
		return MoveResult{Valid: false, BoxesClaimed: []string{}, NextPlayer: gameState.CurrentPlayerIndex}
	}

	lineKey := getLineKey(x1, y1, x2, y2)
	gameState.Lines = append(gameState.Lines, lineKey)

	completedBoxes := getCompletedBoxes(gameState.GridSize, x1, y1, x2, y2, gameState.Lines)
	playerID := gameState.Players[playerIndex]

	for _, boxKey := range completedBoxes {
		gameState.Boxes[boxKey] = playerID
		gameState.Scores[playerID]++
	}

	gameState.Moves = append(gameState.Moves, Move{
		PlayerIndex:  playerIndex,
		Line:         lineKey,
		Timestamp:    time.Now().Unix(),
		BoxesClaimed: completedBoxes,
	})

	nextPlayer := gameState.CurrentPlayerIndex

	if len(completedBoxes) == 0 {
		nextPlayer = (gameState.CurrentPlayerIndex + 1) % len(gameState.Players)
	}

	gameState.CurrentPlayerIndex = nextPlayer

	if isGameComplete(gameState) {
		gameState.Completed = true
		winner := ""
		maxScore := 0
		winnerCount := 0

		for _, score := range gameState.Scores {
			if score > maxScore {
				maxScore = score
				winnerCount = 1
			} else if score == maxScore {
				winnerCount++
			}
		}

		if winnerCount == 1 {
			for pid, score := range gameState.Scores {
				if score == maxScore {
					winner = pid
					break
				}
			}
		}

		gameState.Winner = winner
	}

	return MoveResult{
		Valid:        true,
		BoxesClaimed: completedBoxes,
		NextPlayer:   nextPlayer,
	}
}

// Storage functions

func persistGameState(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, gameState *GameState) error {
	data, err := json.Marshal(gameState)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection: GameStateCollection,
			Key:        gameState.ID,
			UserID:     "",
			Value:      string(data),
			Version:    "",
			PermissionRead:  2,
			PermissionWrite: 0,
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}

func loadGameState(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, gameID string) (*GameState, error) {
	reads := []*runtime.StorageRead{
		{
			Collection: GameStateCollection,
			Key:        gameID,
			UserID:     "",
		},
	}

	objects, err := nk.StorageRead(ctx, reads)
	if err != nil {
		return nil, err
	}

	if len(objects) == 0 {
		return nil, errors.New("game not found")
	}

	var gameState GameState
	if err := json.Unmarshal([]byte(objects[0].Value), &gameState); err != nil {
		return nil, err
	}

	return &gameState, nil
}

func deleteGameState(ctx context.Context, nk runtime.NakamaModule, gameID string) error {
	deletes := []*runtime.StorageDelete{
		{
			Collection: GameStateCollection,
			Key:        gameID,
			UserID:     "",
		},
	}

	return nk.StorageDelete(ctx, deletes)
}

func persistMatchHistory(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, gameState *GameState) error {
	duration := gameState.UpdatedAt - gameState.CreatedAt
	moveCount := len(gameState.Moves)

	history := map[string]interface{}{
		"gameId":      gameState.ID,
		"players":     gameState.Players,
		"gridSize":    gameState.GridSize,
		"winner":      gameState.Winner,
		"scores":      gameState.Scores,
		"duration":    duration,
		"moveCount":   moveCount,
		"completedAt": gameState.UpdatedAt,
		"moves":       gameState.Moves,
	}

	data, err := json.Marshal(history)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection: MatchHistoryCollection,
			Key:        gameState.ID,
			UserID:     "",
			Value:      string(data),
			Version:    "",
			PermissionRead:  2,
			PermissionWrite: 0,
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}
