package main

import (
	"context"

	"github.com/heroiclabs/nakama-common/runtime"
)

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