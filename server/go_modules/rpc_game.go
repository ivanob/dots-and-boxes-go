package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/heroiclabs/nakama-common/runtime"
)

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
		"gameState": buildGameStateView(gameState),
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
		"gameState":   buildGameStateView(gameState),
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

	data, _ := json.Marshal(buildGameStateView(gameState))
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
		"gameState": buildGameStateView(gameState),
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