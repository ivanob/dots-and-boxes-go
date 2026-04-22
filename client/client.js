import {
  clearStatus,
  copyGameId,
  createGame,
  initializeClient,
  joinGame,
  leaveGame,
  returnToLobby,
  showStatus,
  startGame,
} from "./ui/game-flow.js";

window.addEventListener("load", async () => {
  try {
    await initializeClient();
    console.log("Client initialized");
  } catch (error) {
    clearStatus();
    showStatus("Failed to connect to server. Is it running?", "error");
  }
});

window.createGame = createGame;
window.joinGame = joinGame;
window.copyGameId = copyGameId;
window.startGame = startGame;
window.leaveGame = leaveGame;
window.returnToLobby = returnToLobby;
