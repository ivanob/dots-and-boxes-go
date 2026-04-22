export default class DotsAndBoxesClient {
  constructor() {
    const runtimeConfig = globalThis.__DOTS_CONFIG__ || {};

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
    this.onRemoteGameClosed = null;
    this.serverUrl = runtimeConfig.serverUrl || "localhost";
    this.serverPort = runtimeConfig.serverPort || "7350";
    this.useSSL = runtimeConfig.useSSL === true || runtimeConfig.useSSL === "true";
    this.initPromise = null;
    this.refreshPromise = null;
    this.socketConnectPromise = null;
    this.reconnectTimeoutId = null;
  }

  setRemoteGameClosedHandler(handler) {
    this.onRemoteGameClosed = handler;
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

    if (this.onRemoteGameClosed) {
      this.onRemoteGameClosed(event);
    }
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
      const payload = JSON.stringify({ gridSize: parseInt(gridSize, 10) });
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