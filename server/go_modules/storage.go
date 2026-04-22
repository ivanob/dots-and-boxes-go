package main

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/heroiclabs/nakama-common/runtime"
)

// Storage functions

func persistGameState(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, gameState *GameState) error {
	data, err := json.Marshal(gameState)
	if err != nil {
		return err
	}

	writes := []*runtime.StorageWrite{
		{
			Collection:      GameStateCollection,
			Key:             gameState.ID,
			UserID:          "",
			Value:           string(data),
			Version:         "",
			PermissionRead:  2,
			PermissionWrite: 0,
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}

func loadGameState(ctx context.Context, logger runtime.Logger, nk runtime.NakamaModule, gameID string) (*GameState, error) {
	objects, err := nk.StorageRead(ctx, []*runtime.StorageRead{{
		Collection: GameStateCollection,
		Key:        gameID,
		UserID:     "",
	}})
	if err != nil {
		return nil, err
	}

	if len(objects) == 0 {
		return nil, errors.New("game not found")
	}

	var gameState GameState
	if err := json.Unmarshal([]byte(objects[0].Value), &gameState); err != nil {
		logger.Error("Failed to unmarshal game state: %v", err)
		return nil, err
	}

	return &gameState, nil
}

func deleteGameState(ctx context.Context, nk runtime.NakamaModule, gameID string) error {
	deletes := []*runtime.StorageDelete{{
		Collection: GameStateCollection,
		Key:        gameID,
		UserID:     "",
	}}

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
			Collection:      MatchHistoryCollection,
			Key:             gameState.ID,
			UserID:          "",
			Value:           string(data),
			Version:         "",
			PermissionRead:  2,
			PermissionWrite: 0,
		},
	}

	_, err = nk.StorageWrite(ctx, writes)
	return err
}