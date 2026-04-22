import { getElement } from "../modules/dom-utils.js";
import {
  areAdjacentDots,
  findClosestDot,
  getBoardMetrics,
  isSelectableDot,
} from "../modules/board-geometry.js";
import { drawSelectedDot, renderGameBoard } from "../modules/board-renderer.js";
import { dotsClient } from "../app-context.js";

export function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
  getElement(screenId).classList.add("active");
}

export function showStatus(message, type = "info") {
  const element = getElement("statusMessage");
  element.textContent = message;
  element.className = `status-message ${type}`;
  element.style.display = "block";
}

export function clearStatus() {
  getElement("statusMessage").style.display = "none";
}

export function isGameScreenActive() {
  return getElement("gameScreen").classList.contains("active");
}

export function handleGameStateUpdate(state) {
  dotsClient.gameState = state;

  if (state.started && !state.completed && !isGameScreenActive()) {
    dotsClient.stopPolling();
    clearStatus();
    showGameScreen();

    dotsClient.startPolling(dotsClient.gameId, (nextState) => {
      handleGameStateUpdate(nextState);
      if (isGameScreenActive()) {
        updateUI();
      }
    });
    return;
  }

  if (isGameScreenActive()) {
    updateUI();

    if (state.completed) {
      dotsClient.stopPolling();
      showGameOver({ gameState: state, winner: state.winner, finalScores: state.scores });
    }
    return;
  }

  updatePlayersList();
}

export async function createGame() {
  try {
    showStatus("Creating game...", "info");
    const gridSize = getElement("gridSize").value;
    const result = await dotsClient.createGame(gridSize);
    const gameId = result.gameId;

    showGameIdDisplay(gameId);
    showStatus("Game created! Share the Game ID with others.", "success");

    dotsClient.startPolling(gameId, (state) => {
      handleGameStateUpdate(state);
    });
  } catch (error) {
    showStatus("Failed to create game: " + error.message, "error");
  }
}

export function showGameIdDisplay(gameId) {
  const element = getElement("gameIdDisplay");
  getElement("gameId").textContent = gameId;
  element.style.display = "block";
  updatePlayersList();
}

export function copyGameId() {
  const gameId = getElement("gameId").textContent;
  navigator.clipboard.writeText(gameId).then(() => {
    showStatus("Game ID copied!", "success");
  });
}

export async function joinGame() {
  try {
    const gameId = getElement("gameIdInput").value.trim();
    if (!gameId) {
      showStatus("Please enter a Game ID", "error");
      return;
    }

    showStatus("Joining game...", "info");
    const result = await dotsClient.joinGame(gameId);
    const state = result.gameState || dotsClient.gameState;

    showGameIdDisplay(gameId);
    clearStatus();
    handleGameStateUpdate(state);

    dotsClient.startPolling(gameId, (nextState) => {
      handleGameStateUpdate(nextState);
    });
  } catch (error) {
    showStatus("Failed to join game: " + error.message, "error");
  }
}

export function updatePlayersList() {
  const container = getElement("playersContainer");
  const list = getElement("playersList");
  const startButton = getElement("startButton");

  if (!dotsClient.gameState) {
    return;
  }

  container.style.display = "block";
  list.innerHTML = "";

  dotsClient.gameState.players.forEach((playerId, index) => {
    const item = document.createElement("div");
    item.className = "player-item";
    if (playerId === dotsClient.gameState.players[dotsClient.gameState.currentPlayerIndex]) {
      item.classList.add("active");
    }

    const badge = document.createElement("div");
    badge.className = `player-badge p${index + 1}`;
    badge.textContent = String.fromCharCode(65 + index);

    item.appendChild(badge);
    item.appendChild(document.createTextNode(playerId === dotsClient.userId ? "You" : "Player " + (index + 1)));
    list.appendChild(item);
  });

  startButton.style.display =
    !dotsClient.gameState.started &&
    dotsClient.gameState.players.length > 1 &&
    dotsClient.gameState.players[0] === dotsClient.userId
      ? "block"
      : "none";
}

export async function startGame() {
  try {
    showStatus("Starting game...", "info");
    await dotsClient.startGame(dotsClient.gameId);

    dotsClient.stopPolling();
    showGameScreen();

    dotsClient.startPolling(dotsClient.gameId, (state) => {
      handleGameStateUpdate(state);
    });
  } catch (error) {
    showStatus("Failed to start game: " + error.message, "error");
  }
}

export function showGameScreen() {
  dotsClient.selectedLine = null;
  showScreen("gameScreen");
  getElement("gameIdSmall").textContent = dotsClient.gameId;
  renderBoard();
  setupBoardCanvas();
  updateUI();
}

export function updateUI() {
  if (!dotsClient.gameState) {
    return;
  }

  const currentPlayerId = dotsClient.gameState.players[dotsClient.gameState.currentPlayerIndex];
  const playerIndex = dotsClient.gameState.players.indexOf(currentPlayerId);
  getElement("currentPlayer").textContent =
    currentPlayerId === dotsClient.userId ? "You" : `Player ${String.fromCharCode(65 + playerIndex)}`;

  const scoreBoard = getElement("scoreBoard");
  scoreBoard.innerHTML = "";
  dotsClient.gameState.players.forEach((playerId, index) => {
    const row = document.createElement("div");
    row.className = "score-row";
    if (playerId === currentPlayerId) {
      row.classList.add("active");
    }

    const name = document.createElement("span");
    name.textContent = playerId === dotsClient.userId ? "You" : `Player ${String.fromCharCode(65 + index)}`;

    const score = document.createElement("span");
    score.textContent = dotsClient.gameState.scores[playerId] || 0;

    row.appendChild(name);
    row.appendChild(score);
    scoreBoard.appendChild(row);
  });

  renderBoard();
}

export function renderBoard() {
  const canvas = getElement("gameBoard");
  if (!canvas || !dotsClient.gameState) {
    return;
  }

  renderGameBoard(canvas, dotsClient.gameState, dotsClient.playerColors);
}

export function setupBoardCanvas() {
  const canvas = getElement("gameBoard");
  if (!canvas) {
    return;
  }

  canvas.onclick = (event) => handleCanvasClick(event, canvas);
}

export function handleCanvasClick(event, canvas) {
  if (!dotsClient.gameState || dotsClient.gameState.completed) {
    return;
  }

  const currentPlayerId = dotsClient.gameState.players[dotsClient.gameState.currentPlayerIndex];
  if (currentPlayerId !== dotsClient.userId) {
    showStatus("Wait for your turn!", "error");
    setTimeout(clearStatus, 2000);
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;

  const metrics = getBoardMetrics(dotsClient.gameState.gridSize);
  const closest = findClosestDot(x, y, dotsClient.gameState.gridSize, metrics);

  if (!isSelectableDot(closest)) {
    return;
  }

  if (!dotsClient.selectedLine) {
    dotsClient.selectedLine = closest;
    console.log("First dot selected:", closest);
    drawSelectedDot(getElement("gameBoard"), closest, dotsClient.gameState.gridSize);
    return;
  }

  const first = dotsClient.selectedLine;
  const second = closest;

  if (areAdjacentDots(first, second)) {
    submitMove(first.x, first.y, second.x, second.y);
  } else {
    showStatus("Invalid line. Dots must be adjacent.", "error");
    setTimeout(clearStatus, 2000);
    renderBoard();
  }

  dotsClient.selectedLine = null;
}

export async function submitMove(x1, y1, x2, y2) {
  try {
    await dotsClient.makeMove(dotsClient.gameId, x1, y1, x2, y2);
    dotsClient.selectedLine = null;
  } catch (error) {
    showStatus("Failed to submit move: " + error.message, "error");
    setTimeout(clearStatus, 2000);
    renderBoard();
  }
}

export function showGameOver(data) {
  setTimeout(() => {
    showScreen("gameOverScreen");
    updateGameOverScreen(data);
  }, 500);
}

export function resetActiveGameState() {
  dotsClient.stopPolling();
  dotsClient.gameState = null;
  dotsClient.gameId = null;
  dotsClient.selectedLine = null;
}

export function resetLobbyUI() {
  getElement("gameIdInput").value = "";
  getElement("gameIdDisplay").style.display = "none";
  getElement("playersContainer").style.display = "none";
}

export function handleRemoteGameClosed() {
  resetActiveGameState();
  resetLobbyUI();
  showScreen("lobbyScreen");
  showStatus("Your opponent left the game. The match was closed.", "info");
}

export function updateGameOverScreen(data) {
  const gameState = data.gameState || dotsClient.gameState;

  if (data.winner === dotsClient.userId) {
    getElement("resultEmoji").textContent = "🏆";
    getElement("resultTitle").textContent = "You Won!";
  } else if (!data.winner) {
    getElement("resultEmoji").textContent = "🤝";
    getElement("resultTitle").textContent = "It's a Tie!";
  } else {
    getElement("resultEmoji").textContent = "😢";
    getElement("resultTitle").textContent = "Game Over";
    const winnerIndex = gameState.players.indexOf(data.winner);
    getElement("resultMessage").textContent = `Player ${String.fromCharCode(65 + winnerIndex)} wins!`;
  }

  const finalScores = getElement("finalScores");
  finalScores.innerHTML = "";

  const scores = data.finalScores || gameState.scores;
  Object.entries(scores).forEach(([playerId, score]) => {
    const playerIndex = gameState.players.indexOf(playerId);
    const row = document.createElement("div");
    row.className = "score-row";

    const name = document.createElement("span");
    name.textContent = playerId === dotsClient.userId ? "You" : `Player ${String.fromCharCode(65 + playerIndex)}`;

    const scoreElement = document.createElement("span");
    scoreElement.textContent = score;

    row.appendChild(name);
    row.appendChild(scoreElement);
    finalScores.appendChild(row);
  });

  getElement("statMoves").textContent = gameState.moves?.length || 0;
  const duration = gameState.updatedAt - gameState.createdAt;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  getElement("statDuration").textContent = `${minutes}m ${seconds}s`;
  getElement("statGrid").textContent = `${gameState.gridSize}x${gameState.gridSize}`;
}

export async function leaveGame() {
  if (!confirm("Leave the game?")) {
    return;
  }

  try {
    await dotsClient.leaveGame(dotsClient.gameId);
    resetActiveGameState();
    resetLobbyUI();
    showScreen("lobbyScreen");
    clearStatus();
    showStatus("You left the game.", "info");
  } catch (error) {
    showStatus("Failed to leave game: " + error.message, "error");
  }
}

export function returnToLobby() {
  resetActiveGameState();
  resetLobbyUI();
  showScreen("lobbyScreen");
  clearStatus();
}

export function initializeClient() {
  dotsClient.setRemoteGameClosedHandler(handleRemoteGameClosed);
  return dotsClient.init();
}