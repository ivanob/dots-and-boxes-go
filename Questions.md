Questions;

1- I could reduce the verbose of the state sent by sneding deltas instead of the whole object response
    The whole state of the game is sent to the counterparty when the other player makes a move. It is sent completely, not a delta. Would be good to improve.

1.1 - How communication is done
    RPCs (HTTP POST) for actions: (reply -> response)

    create_game
    join_game
    make_move
    start_game
    leave_game
    get_game_state
    These are sent via the rpc() method using fetch() to /v2/rpc/{id} endpoints.

    WebSockets for real-time updates: They are behind the nakama channels concept: a channel is a pub/sub messaging that fans-out the message to both participants of a game.

    - setupSocket() creates a WebSocket connection
    - subscribeToGame() subscribes the client to a game channel
    - socket.onchannelmessage receives live game_state_update messages pushed from the server
    game_state_update → Full gameState object: (all state, not just deltas)

        id, players, gridSize
        lines (all lines drawn)
        boxes (completed boxes with owner)
        currentPlayerIndex
        scores
        completed, winner
        etc.
    game_closed → Event that the game was closed by another player

    So the pattern is:

    - Client sends action → RPC (HTTP POST)
    - Server responds with new state + broadcasts to other players via WebSocket
    - All clients receive update through the socket channel



3- Store the user game in REDIS instead of persisting it. As my games are stateless.


4 - break the client to see what happens if you send a move when its not your turn.

5 - Where is the authentication happening
    Authentication happens in two places:

    Client side — in dots-client.js:

    ```
    async init(serverUrl = this.serverUrl, port = this.serverPort, useSSL = this.useSSL) {
        // ...
        const deviceId = localStorage.getItem("device_id") || this.generateDeviceId();
        this.session = await this.client.authenticateDevice(deviceId, true);
        // ...
    }
    ```

    Device-based authentication: generates a unique device ID, authenticates with Nakama, gets a session token.

    Server side — Nakama automatically validates the token (from the Authorization: Bearer {token} header) before executing any RPC.

    Then in the RPC functions (e.g., rpc_game.go):
    ```
    userID, ok := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
    if !ok {
        return "", errors.New("user ID not found")
    }
    ```

    Nakama injects the authenticated userID into the context. If the token is invalid, Nakama rejects the request before your code runs.

    So you don't write authentication logic yourself — Nakama handles it, and you just extract the user ID from the context when you need it.

6 - How to connect my code with the nakama server?
    Three places:

    1. local.yml — tells Nakama where to load plugins:

    2. Dockerfile — compiles and places your code:

    3. module.go — registers the RPCs:

    Nakama's plugin system automatically discovers and calls InitModule() when it loads backend.so. Your code registers each RPC handler with initializer.RegisterRpc(), mapping the name (e.g., "make_move") to the function (e.g., rpcMakeMove).

    When a client calls /v2/rpc/make_move, Nakama looks up that RPC name and executes the corresponding function.

7 - How the nakama program is build

    Stage 1 (Builder) — Compile the code:

    `FROM heroiclabs/nakama-pluginbuilder:3.22.0 AS builder`

    Start with a container that has Go compiler and build tools.

    ```
    WORKDIR /build
    COPY go_modules/go.mod ./go.mod
    COPY go_modules/*.go ./
    ```

    Copy your Go source files into the container.

    `RUN go mod tidy`

    Download Go dependencies.

    `RUN go build --trimpath --buildmode=plugin -o backend.so .`

    Compile your Go code into a plugin file (backend.so). This is what Nakama will load.

    Stage 2 (Runtime) — Run the server:

    `FROM heroiclabs/nakama:3.22.0`

    Start with a fresh Nakama server container (doesn't have Go compiler, keeps image small).

    `COPY --from=builder /build/backend.so /nakama/data/modules/`

    Copy the compiled plugin from Stage 1 into the Nakama modules directory.

    `COPY local.yml /nakama/data/`

    Copy the Nakama configuration.

    Why two stages?

    Stage 1 is temporary — only used for compilation
    Stage 2 is the final image — small and clean, only contains the compiled plugin, not the compiler
    This keeps the final Docker image size small (no Go toolchain overhead).

7- Explain the Client hierarchy

    ```
    client.js
    └── game-flow.js
            ├── dots-client.js  (server comms)
            ├── board-geometry.js (math)
            └── board-renderer.js (drawing)
    ```