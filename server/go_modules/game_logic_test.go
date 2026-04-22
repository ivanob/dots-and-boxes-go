package main

import (
	"testing"
)

func newTestGameState() *GameState {
	return &GameState{
		ID:                 "game-1",
		Players:            []string{"player-a", "player-b"},
		GridSize:           3,
		Started:            true,
		Lines:              []string{},
		Boxes:              map[string]string{},
		CurrentPlayerIndex: 0,
		Moves:              []Move{},
		Scores: map[string]int{
			"player-a": 0,
			"player-b": 0,
		},
	}
}

func TestGetLineKeyNormalizesCoordinateOrder(t *testing.T) {
	got := getLineKey(2, 1, 1, 1)
	want := "1:1-2:1"

	if got != want {
		t.Fatalf("getLineKey() = %q, want %q", got, want)
	}
}

func TestIsValidLineRejectsDiagonalAndDuplicateLines(t *testing.T) {
	if isValidLine(3, 0, 0, 1, 1, nil) {
		t.Fatal("expected diagonal line to be invalid")
	}

	existing := []string{getLineKey(0, 0, 1, 0)}
	if isValidLine(3, 1, 0, 0, 0, existing) {
		t.Fatal("expected duplicate line to be invalid")
	}
}

func TestGetCompletedBoxesReturnsSingleCompletedBox(t *testing.T) {
	lines := []string{
		getLineKey(0, 0, 1, 0),
		getLineKey(0, 0, 0, 1),
		getLineKey(1, 0, 1, 1),
		getLineKey(0, 1, 1, 1),
	}

	completed := getCompletedBoxes(3, 0, 1, 1, 1, lines)
	if len(completed) != 1 || completed[0] != "0:0" {
		t.Fatalf("getCompletedBoxes() = %#v, want [\"0:0\"]", completed)
	}
}

func TestApplyMoveAdvancesTurnWhenNoBoxIsClaimed(t *testing.T) {
	gameState := newTestGameState()

	result := applyMove(gameState, 0, 0, 0, 1, 0)
	if !result.Valid {
		t.Fatal("expected move to be valid")
	}
	if result.NextPlayer != 1 {
		t.Fatalf("NextPlayer = %d, want 1", result.NextPlayer)
	}
	if gameState.CurrentPlayerIndex != 1 {
		t.Fatalf("CurrentPlayerIndex = %d, want 1", gameState.CurrentPlayerIndex)
	}
	if len(gameState.Lines) != 1 || gameState.Lines[0] != "0:0-1:0" {
		t.Fatalf("Lines = %#v, want [\"0:0-1:0\"]", gameState.Lines)
	}
	if len(gameState.Moves) != 1 {
		t.Fatalf("Moves length = %d, want 1", len(gameState.Moves))
	}
}

func TestApplyMoveClaimsBoxAndKeepsTurn(t *testing.T) {
	gameState := newTestGameState()
	gameState.Lines = []string{
		getLineKey(0, 0, 1, 0),
		getLineKey(0, 0, 0, 1),
		getLineKey(1, 0, 1, 1),
	}

	result := applyMove(gameState, 0, 0, 1, 1, 1)
	if !result.Valid {
		t.Fatal("expected move to be valid")
	}
	if result.NextPlayer != 0 {
		t.Fatalf("NextPlayer = %d, want 0", result.NextPlayer)
	}
	if len(result.BoxesClaimed) != 1 || result.BoxesClaimed[0] != "0:0" {
		t.Fatalf("BoxesClaimed = %#v, want [\"0:0\"]", result.BoxesClaimed)
	}
	if gameState.Boxes["0:0"] != "player-a" {
		t.Fatalf("Boxes[\"0:0\"] = %q, want player-a", gameState.Boxes["0:0"])
	}
	if gameState.Scores["player-a"] != 1 {
		t.Fatalf("Score for player-a = %d, want 1", gameState.Scores["player-a"])
	}
	if gameState.CurrentPlayerIndex != 0 {
		t.Fatalf("CurrentPlayerIndex = %d, want 0", gameState.CurrentPlayerIndex)
	}
}

func TestApplyMoveRejectsWrongPlayerAndCompletedGames(t *testing.T) {
	gameState := newTestGameState()

	wrongPlayer := applyMove(gameState, 1, 0, 0, 1, 0)
	if wrongPlayer.Valid {
		t.Fatal("expected wrong-player move to be invalid")
	}

	gameState.Completed = true
	finished := applyMove(gameState, 0, 0, 0, 1, 0)
	if finished.Valid {
		t.Fatal("expected move on completed game to be invalid")
	}
}

func TestApplyMoveMarksGameCompleteAndWinner(t *testing.T) {
	gameState := newTestGameState()
	gameState.GridSize = 2
	gameState.Lines = []string{
		getLineKey(0, 0, 1, 0),
		getLineKey(0, 0, 0, 1),
		getLineKey(1, 0, 1, 1),
	}
	gameState.Scores["player-a"] = 0
	gameState.Scores["player-b"] = 0

	result := applyMove(gameState, 0, 0, 1, 1, 1)
	if !result.Valid {
		t.Fatal("expected move to be valid")
	}
	if !gameState.Completed {
		t.Fatal("expected game to be completed")
	}
	if gameState.Winner != "player-a" {
		t.Fatalf("Winner = %q, want player-a", gameState.Winner)
	}
	if gameState.Scores["player-a"] != 1 {
		t.Fatalf("Score for player-a = %d, want 1", gameState.Scores["player-a"])
	}
}

func TestIsGameCompleteUsesExpectedLineCount(t *testing.T) {
	gameState := newTestGameState()
	gameState.GridSize = 2
	gameState.Lines = []string{
		getLineKey(0, 0, 1, 0),
		getLineKey(0, 0, 0, 1),
		getLineKey(1, 0, 1, 1),
		getLineKey(0, 1, 1, 1),
	}

	if !isGameComplete(gameState) {
		t.Fatal("expected game to be complete when all lines are present")
	}
}