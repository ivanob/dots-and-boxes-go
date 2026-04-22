package main

import (
	"context"
	"database/sql"

	"github.com/heroiclabs/nakama-common/runtime"
)

const (
	GameStateCollection    = "game_states"
	MatchHistoryCollection = "match_history"
)

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