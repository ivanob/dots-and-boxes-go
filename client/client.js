// Nakama SDK and game client
class DotsAndBoxesClient {
  constructor() {
    this.client = null;
    this.session = null;
    this.socket = null;
    this.gameId = null;
    this.gameChannel = null;
    this.gameChannelId = null;
    this.userId = null;
    this.gameState = null;
    this.playerColors = ["#ff6b6b", "#4ecdc4", "#ffd93d", "#a78bfa"];
    this.selectedLine = null;
    this.onGameStateChanged = null;
    this.serverUrl = "localhost";
    this.serverPort = "7350";
    this.useSSL = false;
    this.initPromise = null;
    this.refreshPromise = null;
    this.socketConnectPromise = null;
    this.reconnectTimeoutId = null;
  }

  getSessionStorageKeys() {
    return {
      token: "nakama_token",
      refreshToken: "nakama_refresh_token",
    };
  }

  persistSession() {
    if (!this.session?.token) {
      return;
    }

    const keys = this.getSessionStorageKeys();
    localStorage.setItem(keys.token, this.session.token);
    localStorage.setItem(keys.refreshToken, this.session.refresh_token || "");
  }

  clearStoredSession() {
    const keys = this.getSessionStorageKeys();
    localStorage.removeItem(keys.token);
    localStorage.removeItem(keys.refreshToken);
  }

  restoreStoredSession() {
    const keys = this.getSessionStorageKeys();
    const token = localStorage.getItem(keys.token);
    const refreshToken = localStorage.getItem(keys.refreshToken) || "";

    if (!token) {
      return null;
    }

    try {
      return nakamajs.Session.restore(token, refreshToken);
    } catch (error) {
      this.clearStoredSession();
      return null;
    }
  }

  parseRpcPayload(payload) {
    if (typeof payload === "string") {
      return JSON.parse(payload);
    }

    return payload;
  }

  setupSocket() {
    if (this.socket) {
      return;
    }

    this.socket = this.client.createSocket(this.useSSL, false);
    this.socket.onchannelmessage = (message) => {
      if (!this.gameChannelId || message.channel_id !== this.gameChannelId) {
        return;
      }

      const content = message.content || {};

	  if (content.type === "game_closed") {
		this.handleGameClosed(content);
		return;
	  }

	  if (content.type !== "game_state_update" || !content.gameState) {
        return;
      }

      this.applyIncomingGameState(content.gameState);
    };

    this.socket.ondisconnect = () => {
      this.gameChannel = null;
      this.gameChannelId = null;
      this.scheduleRealtimeReconnect();
    };

    this.socket.onerror = (error) => {
      console.error("Socket error:", error);
    };
  }

  async ensureSocketConnected() {
    if (!this.client || !this.session) {
      throw new Error("Socket requires an authenticated session.");
    }

    this.setupSocket();

    if (this.socketConnectPromise) {
      return this.socketConnectPromise;
    }

    this.socketConnectPromise = this.socket.connect(this.session, false).finally(() => {
      this.socketConnectPromise = null;
    });

    return this.socketConnectPromise;
  }

  scheduleRealtimeReconnect() {
    if (this.reconnectTimeoutId || !this.session) {
      return;
    }

    this.reconnectTimeoutId = setTimeout(async () => {
      this.reconnectTimeoutId = null;

      try {
        this.socket = null;
        await this.ensureSocketConnected();

        if (this.gameId && this.onGameStateChanged) {
          await this.subscribeToGame(this.gameId);
          const state = await this.getGameState(this.gameId);
          this.applyIncomingGameState(state);
        }
      } catch (error) {
        console.error("Realtime reconnect failed:", error);
        this.scheduleRealtimeReconnect();
      }
    }, 1000);
  }

  shouldApplyGameState(nextState) {
    if (!nextState) {
      return false;
    }

    if (!this.gameState) {
      return true;
    }

    if (nextState.updatedAt !== this.gameState.updatedAt) {
      return true;
    }

    if ((nextState.lines?.length || 0) !== (this.gameState.lines?.length || 0)) {
      return true;
    }

    if ((nextState.players?.length || 0) !== (this.gameState.players?.length || 0)) {
      return true;
    }

    return nextState.started !== this.gameState.started || nextState.completed !== this.gameState.completed;
  }

  applyIncomingGameState(nextState) {
    if (!this.shouldApplyGameState(nextState)) {
      return false;
    }

    this.gameState = nextState;

    if (this.onGameStateChanged) {
      this.onGameStateChanged(nextState);
    }

    return true;
  }

  handleGameClosed(event) {
    if (!event || event.closedBy === this.userId) {
      return;
    }

    handleRemoteGameClosed(event);
  }

  async subscribeToGame(gameId) {
    await this.ensureSocketConnected();

    if (this.gameChannelId && this.gameId === gameId) {
      return this.gameChannel;
    }

    await this.unsubscribeFromGame();

    this.gameId = gameId;
    this.gameChannel = await this.socket.joinChat(gameId, 1, false, false);
    this.gameChannelId = this.gameChannel.id;

    return this.gameChannel;
  }

  async unsubscribeFromGame() {
    if (!this.socket || !this.gameChannelId) {
      this.gameChannel = null;
      this.gameChannelId = null;
      return;
    }

    const channelId = this.gameChannelId;
    this.gameChannel = null;
    this.gameChannelId = null;

    try {
      await this.socket.leaveChat(channelId);
    } catch (error) {
      console.error("Failed to leave game channel:", error);
    }
  }

  getRpcBaseUrl() {
    const protocol = this.useSSL ? "https" : "http";
    return `${protocol}://${this.serverUrl}:${this.serverPort}`;
  }

  async ensureReady() {
    if (this.session?.token) {
      await this.refreshSessionIfNeeded();
      return;
    }

    await this.init(this.serverUrl, this.serverPort, this.useSSL);

    if (!this.session?.token) {
      throw new Error("Authentication is not ready yet.");
    }
  }

  async refreshSessionIfNeeded(force = false) {
    if (!this.client || !this.session) {
      return;
    }

    const now = Date.now() / 1000;
    const tokenExpired = this.session.isexpired(now);
    if (!force && !tokenExpired) {
      return;
    }

    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = (async () => {
      try {
        if (this.session.refresh_token && !this.session.isrefreshexpired(now)) {
          await this.client.sessionRefresh(this.session);
          this.persistSession();
          return;
        }

        this.session = null;
        this.clearStoredSession();
        this.initPromise = null;
        await this.init(this.serverUrl, this.serverPort, this.useSSL);
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async rpc(id, payload) {
    await this.ensureReady();

    let response = await fetch(`${this.getRpcBaseUrl()}/v2/rpc/${id}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.session.token}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 401) {
      await this.refreshSessionIfNeeded(true);
      response = await fetch(`${this.getRpcBaseUrl()}/v2/rpc/${id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.session.token}`,
        },
        body: JSON.stringify(payload),
      });
    }

    if (!response.ok) {
      let message = `RPC ${id} failed with status ${response.status}`;

      try {
        const errorBody = await response.json();
        message = errorBody.message || errorBody.error || message;
      } catch (error) {
        // Fall back to the HTTP status-based message.
      }

      throw new Error(message);
    }

    return response.json();
  }

  async init(serverUrl = "localhost", port = "7350", useSSL = false) {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.serverUrl = serverUrl;
    this.serverPort = port;
    this.useSSL = useSSL;

    this.initPromise = (async () => {
      // Initialize Nakama client
      this.client = new nakamajs.Client("defaultkey", serverUrl, port, useSSL);
      const restoredSession = this.restoreStoredSession();

      if (restoredSession) {
        this.session = restoredSession;
        this.userId = restoredSession.user_id;

        try {
          await this.refreshSessionIfNeeded();
          await this.ensureSocketConnected();
          this.persistSession();
          console.log("Restored Nakama session:", this.userId);
          return this.session;
        } catch (error) {
          this.session = null;
          this.clearStoredSession();
        }
      }

      // Authenticate or create session
      try {
        const deviceId = localStorage.getItem("device_id") || this.generateDeviceId();
        this.session = await this.client.authenticateDevice(deviceId, true);
        localStorage.setItem("device_id", deviceId);
        this.userId = this.session.user_id;
        await this.ensureSocketConnected();
        this.persistSession();
        console.log("Connected to Nakama:", this.userId);
        return this.session;
      } catch (error) {
        console.error("Authentication failed:", error);
        this.session = null;
        this.clearStoredSession();
        throw error;
      }
    })();

    try {
      return await this.initPromise;
    } catch (error) {
      this.initPromise = null;
      throw error;
    }
  }

  generateDeviceId() {
    const id = "device_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("device_id", id);
    return id;
  }

  async createGame(gridSize = 5) {
    try {
      const payload = JSON.stringify({ gridSize: parseInt(gridSize) });
      const response = await this.rpc("create_game", payload);

      const result = this.parseRpcPayload(response.payload);
      this.gameId = result.gameId;
      if (result.gameState) {
        this.gameState = result.gameState;
      }
      console.log("Game created:", this.gameId);
      return result;
    } catch (error) {
      console.error("Failed to create game:", error);
      throw error;
    }
  }

  async joinGame(gameId) {
    try {
      const payload = JSON.stringify({ gameId });
      const response = await this.rpc("join_game", payload);
      this.gameId = gameId;
      const result = this.parseRpcPayload(response.payload);
      if (result.gameState) {
        this.gameState = result.gameState;
      }
      console.log("Joined game:", gameId);
      return result;
    } catch (error) {
      console.error("Failed to join game:", error);
      throw error;
    }
  }

  async getGameState(gameId) {
    try {
      const payload = JSON.stringify({ gameId });
      const response = await this.rpc("get_game_state", payload);
      this.gameState = this.parseRpcPayload(response.payload);
      console.log("Game state:", this.gameState);
      return this.gameState;
    } catch (error) {
      console.error("Failed to get game state:", error);
      throw error;
    }
  }

  async startGame(gameId) {
    try {
      const payload = JSON.stringify({ gameId });
      const response = await this.rpc("start_game", payload);
      const result = this.parseRpcPayload(response.payload);
      if (result.gameState) {
        this.gameState = result.gameState;
      }
      console.log("Game started");
      return result;
    } catch (error) {
      console.error("Failed to start game:", error);
      throw error;
    }
  }

  async makeMove(gameId, x1, y1, x2, y2) {
    try {
      const payload = JSON.stringify({ gameId, x1, y1, x2, y2 });
      const response = await this.rpc("make_move", payload);
      const result = this.parseRpcPayload(response.payload);

      if (result.gameState) {
        this.applyIncomingGameState(result.gameState);
      }

      return result;
    } catch (error) {
      console.error("Failed to make move:", error);
      throw error;
    }
  }

  async leaveGame(gameId) {
    try {
      const payload = JSON.stringify({ gameId });
      const response = await this.rpc("leave_game", payload);
      return this.parseRpcPayload(response.payload);
    } catch (error) {
      console.error("Failed to leave game:", error);
      throw error;
    }
  }

  startPolling(gameId, callback) {
    this.onGameStateChanged = callback || null;

    this.subscribeToGame(gameId).catch((error) => {
      console.error("Realtime subscription error:", error);
    });
  }

  stopPolling() {
    this.onGameStateChanged = null;

    this.unsubscribeFromGame().catch((error) => {
      console.error("Realtime unsubscribe error:", error);
    });
  }
}

const dotsClient = new DotsAndBoxesClient();

// UI Functions
function showScreen(screenId) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  document.getElementById(screenId).classList.add("active");
}

function showStatus(message, type = "info") {
  const el = document.getElementById("statusMessage");
  el.textContent = message;
  el.className = `status-message ${type}`;
  el.style.display = "block";
}

function clearStatus() {
  document.getElementById("statusMessage").style.display = "none";
}

function isGameScreenActive() {
  return document.getElementById("gameScreen").classList.contains("active");
}

function handleGameStateUpdate(state) {
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

async function createGame() {
  try {
    showStatus("Creating game...", "info");
    const gridSize = document.getElementById("gridSize").value;
    const result = await dotsClient.createGame(gridSize);
    const gameId = result.gameId;

    showGameIdDisplay(gameId);
    showStatus("Game created! Share the Game ID with others.", "success");

    // Subscribe for lobby updates
    dotsClient.startPolling(gameId, (state) => {
      handleGameStateUpdate(state);
    });
  } catch (error) {
    showStatus("Failed to create game: " + error.message, "error");
  }
}

function showGameIdDisplay(gameId) {
  const el = document.getElementById("gameIdDisplay");
  document.getElementById("gameId").textContent = gameId;
  el.style.display = "block";
  updatePlayersList();
}

function copyGameId() {
  const gameId = document.getElementById("gameId").textContent;
  navigator.clipboard.writeText(gameId).then(() => {
    showStatus("Game ID copied!", "success");
  });
}

async function joinGame() {
  try {
    const gameId = document.getElementById("gameIdInput").value.trim();
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
    
      // Subscribe for lobby or gameplay updates
    dotsClient.startPolling(gameId, (state) => {
        handleGameStateUpdate(state);
    });
  } catch (error) {
    showStatus("Failed to join game: " + error.message, "error");
  }
}

function updatePlayersList() {
  const container = document.getElementById("playersContainer");
  const list = document.getElementById("playersList");
  const startButton = document.getElementById("startButton");

  if (!dotsClient.gameState) return;

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
    badge.textContent = String.fromCharCode(65 + index); // A, B, C, D

    item.appendChild(badge);
    item.appendChild(document.createTextNode(playerId === dotsClient.userId ? "You" : "Player " + (index + 1)));
    list.appendChild(item);
  });

  // Show start button only if creator and 2+ players
  startButton.style.display =
    !dotsClient.gameState.started &&
    dotsClient.gameState.players.length > 1 &&
    dotsClient.gameState.players[0] === dotsClient.userId
      ? "block"
      : "none";
}

async function startGame() {
  try {
    showStatus("Starting game...", "info");
    await dotsClient.startGame(dotsClient.gameId);
    
    dotsClient.stopPolling();
    showGameScreen();
    
    // Subscribe for gameplay updates during play
    dotsClient.startPolling(dotsClient.gameId, (state) => {
      handleGameStateUpdate(state);
    });
  } catch (error) {
    showStatus("Failed to start game: " + error.message, "error");
  }
}

function showGameScreen() {
  dotsClient.selectedLine = null;
  showScreen("gameScreen");
  document.getElementById("gameIdSmall").textContent = dotsClient.gameId;
  renderBoard();
  setupBoardCanvas();
  updateUI();
}

function updateUI() {
  if (!dotsClient.gameState) return;

  // Update current player
  const currentPlayerId = dotsClient.gameState.players[dotsClient.gameState.currentPlayerIndex];
  const playerIndex = dotsClient.gameState.players.indexOf(currentPlayerId);
  document.getElementById("currentPlayer").textContent =
    currentPlayerId === dotsClient.userId
      ? "You"
      : `Player ${String.fromCharCode(65 + playerIndex)}`;

  // Update scores
  const scoreBoard = document.getElementById("scoreBoard");
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

  // Redraw board
  renderBoard();
}

function renderBoard() {
  const canvas = document.getElementById("gameBoard");
  if (!canvas || !dotsClient.gameState) return;

  const gridSize = dotsClient.gameState.gridSize;
  const dotRadius = 6;
  const spacing = 40;
  const padding = 40;

  canvas.width = spacing * (gridSize - 1) + padding * 2;
  canvas.height = spacing * (gridSize - 1) + padding * 2;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Draw grid lines (faint)
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 1;
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = padding + i * spacing;
      const y = padding + j * spacing;

      // Horizontal line to next dot
      if (i < gridSize - 1) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + spacing, y);
        ctx.stroke();
      }

      // Vertical line to next dot
      if (j < gridSize - 1) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + spacing);
        ctx.stroke();
      }
    }
  }

  // Draw drawn lines
  if (dotsClient.gameState.lines) {
    ctx.strokeStyle = "#667eea";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";

    dotsClient.gameState.lines.forEach((line) => {
      const [pos1, pos2] = line.split("-");
      const [x1str, y1str] = pos1.split(":");
      const [x2str, y2str] = pos2.split(":");

      const x1 = padding + parseInt(x1str) * spacing;
      const y1 = padding + parseInt(y1str) * spacing;
      const x2 = padding + parseInt(x2str) * spacing;
      const y2 = padding + parseInt(y2str) * spacing;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    });
  }

  // Draw boxes and who claimed them
  const boxCount = gridSize - 1;
  for (let i = 0; i < boxCount; i++) {
    for (let j = 0; j < boxCount; j++) {
      const x = padding + i * spacing;
      const y = padding + j * spacing;

      const boxKey = `${i}:${j}`;
      if (dotsClient.gameState.boxes && dotsClient.gameState.boxes[boxKey]) {
        const playerId = dotsClient.gameState.boxes[boxKey];
        const playerIndex = dotsClient.gameState.players.indexOf(playerId);
        const color = dotsClient.playerColors[playerIndex % dotsClient.playerColors.length];

        ctx.fillStyle = color + "30"; // 30% opacity
        ctx.fillRect(x + spacing / 10, y + spacing / 10, spacing * 0.8, spacing * 0.8);

        // Draw initial
        ctx.fillStyle = color;
        ctx.font = "bold 16px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(String.fromCharCode(65 + playerIndex), x + spacing / 2, y + spacing / 2);
      }
    }
  }

  // Draw dots
  ctx.fillStyle = "#333";
  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const x = padding + i * spacing;
      const y = padding + j * spacing;

      ctx.beginPath();
      ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function setupBoardCanvas() {
  const canvas = document.getElementById("gameBoard");
  if (!canvas) return;

  canvas.onclick = (e) => handleCanvasClick(e, canvas);
}

function handleCanvasClick(e, canvas) {
  if (!dotsClient.gameState || dotsClient.gameState.completed) return;

  // Check if it's this player's turn
  const currentPlayerId = dotsClient.gameState.players[dotsClient.gameState.currentPlayerIndex];
  if (currentPlayerId !== dotsClient.userId) {
    showStatus("Wait for your turn!", "error");
    setTimeout(clearStatus, 2000);
    return;
  }

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  const gridSize = dotsClient.gameState.gridSize;
  const padding = 40;
  const spacing = 40;
  const dotRadius = 12;

  // Find closest dot
  let closest = null;
  let minDist = Infinity;

  for (let i = 0; i < gridSize; i++) {
    for (let j = 0; j < gridSize; j++) {
      const dotX = padding + i * spacing;
      const dotY = padding + j * spacing;
      const dist = Math.sqrt((x - dotX) ** 2 + (y - dotY) ** 2);

      if (dist < minDist) {
        minDist = dist;
        closest = { x: i, y: j, dist };
      }
    }
  }

  // If we clicked near a dot
  if (closest && closest.dist < dotRadius * 2) {
    if (!dotsClient.selectedLine) {
      dotsClient.selectedLine = closest;
      console.log("First dot selected:", closest);
      
      // Visual feedback
      const canvas = document.getElementById("gameBoard");
      const ctx = canvas.getContext("2d");
      const padding = 40;
      const spacing = 40;
      
      ctx.strokeStyle = "#ff6b6b";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(padding + closest.x * spacing, padding + closest.y * spacing, 10, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      const first = dotsClient.selectedLine;
      const second = closest;

      // Check if valid line (adjacent and not same dot)
      const dx = Math.abs(first.x - second.x);
      const dy = Math.abs(first.y - second.y);

      if ((dx === 1 && dy === 0) || (dx === 0 && dy === 1)) {
        // Valid line
        submitMove(first.x, first.y, second.x, second.y);
      } else {
        showStatus("Invalid line. Dots must be adjacent.", "error");
        setTimeout(clearStatus, 2000);
        renderBoard(); // Clear selection visual
      }

      dotsClient.selectedLine = null;
    }
  }
}

async function submitMove(x1, y1, x2, y2) {
  try {
    await dotsClient.makeMove(dotsClient.gameId, x1, y1, x2, y2);
    dotsClient.selectedLine = null;
  } catch (error) {
    showStatus("Failed to submit move: " + error.message, "error");
    setTimeout(clearStatus, 2000);
    renderBoard();
  }
}

function showGameOver(data) {
  setTimeout(() => {
    showScreen("gameOverScreen");
    updateGameOverScreen(data);
  }, 500);
}

function resetActiveGameState() {
  dotsClient.stopPolling();
  dotsClient.gameState = null;
  dotsClient.gameId = null;
  dotsClient.selectedLine = null;
}

function resetLobbyUI() {
  document.getElementById("gameIdInput").value = "";
  document.getElementById("gameIdDisplay").style.display = "none";
  document.getElementById("playersContainer").style.display = "none";
}

function handleRemoteGameClosed(event) {
  resetActiveGameState();
  resetLobbyUI();
  showScreen("lobbyScreen");
  showStatus("Your opponent left the game. The match was closed.", "info");
}

function updateGameOverScreen(data) {
  const gameState = data.gameState || dotsClient.gameState;
  
  if (data.winner === dotsClient.userId) {
    document.getElementById("resultEmoji").textContent = "🏆";
    document.getElementById("resultTitle").textContent = "You Won!";
  } else if (!data.winner) {
    document.getElementById("resultEmoji").textContent = "🤝";
    document.getElementById("resultTitle").textContent = "It's a Tie!";
  } else {
    document.getElementById("resultEmoji").textContent = "😢";
    document.getElementById("resultTitle").textContent = "Game Over";
    const winnerIndex = gameState.players.indexOf(data.winner);
    document.getElementById("resultMessage").textContent = 
      `Player ${String.fromCharCode(65 + winnerIndex)} wins!`;
  }

  const finalScores = document.getElementById("finalScores");
  finalScores.innerHTML = "";

  const scores = data.finalScores || gameState.scores;
  Object.entries(scores).forEach(([playerId, score]) => {
    const playerIndex = gameState.players.indexOf(playerId);
    const row = document.createElement("div");
    row.className = "score-row";

    const name = document.createElement("span");
    name.textContent = playerId === dotsClient.userId ? "You" : `Player ${String.fromCharCode(65 + playerIndex)}`;

    const scoreEl = document.createElement("span");
    scoreEl.textContent = score;

    row.appendChild(name);
    row.appendChild(scoreEl);
    finalScores.appendChild(row);
  });

  document.getElementById("statMoves").textContent = gameState.moves?.length || 0;
  const duration = gameState.updatedAt - gameState.createdAt;
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  document.getElementById("statDuration").textContent = `${minutes}m ${seconds}s`;
  document.getElementById("statGrid").textContent = `${gameState.gridSize}x${gameState.gridSize}`;
}

async function leaveGame() {
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

function returnToLobby() {
  resetActiveGameState();
  resetLobbyUI();
  showScreen("lobbyScreen");
  clearStatus();
}

// Initialize on page load
window.addEventListener("load", async () => {
  try {
    await dotsClient.init();
    console.log("Client initialized");
  } catch (error) {
    showStatus("Failed to connect to server. Is it running?", "error");
  }
});
