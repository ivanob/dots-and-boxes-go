package main

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