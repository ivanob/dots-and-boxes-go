package main

import (
	"fmt"
	"math"
	"time"
)

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
	if x1 < 0 || x1 >= gridSize || x2 < 0 || x2 >= gridSize {
		return false
	}
	if y1 < 0 || y1 >= gridSize || y2 < 0 || y2 >= gridSize {
		return false
	}

	if x1 == x2 && int(math.Abs(float64(y1-y2))) == 1 {
	} else if y1 == y2 && int(math.Abs(float64(x1-x2))) == 1 {
	} else {
		return false
	}

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

	if x1 == x2 {
		x := x1
		minY := y1
		if y1 > y2 {
			minY = y2
		}

		if x > 0 {
			boxX, boxY := x-1, minY
			if isBoxComplete(boxX, boxY, lines) {
				completed = append(completed, getBoxKey(boxX, boxY))
			}
		}

		if x < boxCount {
			boxX, boxY := x, minY
			if isBoxComplete(boxX, boxY, lines) {
				completed = append(completed, getBoxKey(boxX, boxY))
			}
		}
	} else if y1 == y2 {
		y := y1
		minX := x1
		if x1 > x2 {
			minX = x2
		}

		if y > 0 {
			boxX, boxY := minX, y-1
			if isBoxComplete(boxX, boxY, lines) {
				completed = append(completed, getBoxKey(boxX, boxY))
			}
		}

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