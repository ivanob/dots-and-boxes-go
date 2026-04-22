import test from "node:test";
import assert from "node:assert/strict";

import DotsAndBoxesClient from "../services/dots-client.js";

function createState(overrides = {}) {
  return {
    updatedAt: 100,
    lines: [],
    players: ["a", "b"],
    started: false,
    completed: false,
    ...overrides,
  };
}

test("parseRpcPayload parses string payloads and passes objects through", () => {
  const client = new DotsAndBoxesClient();

  assert.deepEqual(client.parseRpcPayload('{"ok":true}'), { ok: true });
  assert.deepEqual(client.parseRpcPayload({ ok: true }), { ok: true });
});

test("shouldApplyGameState accepts first state and meaningful changes", () => {
  const client = new DotsAndBoxesClient();

  assert.equal(client.shouldApplyGameState(createState()), true);

  client.gameState = createState();

  assert.equal(client.shouldApplyGameState(createState()), false);
  assert.equal(client.shouldApplyGameState(createState({ updatedAt: 101 })), true);
  assert.equal(client.shouldApplyGameState(createState({ lines: ["0:0-1:0"] })), true);
  assert.equal(client.shouldApplyGameState(createState({ players: ["a", "b", "c"] })), true);
  assert.equal(client.shouldApplyGameState(createState({ started: true })), true);
  assert.equal(client.shouldApplyGameState(createState({ completed: true })), true);
});

test("applyIncomingGameState updates state and notifies listener once per accepted state", () => {
  const client = new DotsAndBoxesClient();
  const nextState = createState();
  const seen = [];

  client.onGameStateChanged = (state) => seen.push(state);

  assert.equal(client.applyIncomingGameState(nextState), true);
  assert.equal(client.gameState, nextState);
  assert.deepEqual(seen, [nextState]);

  assert.equal(client.applyIncomingGameState(createState()), false);
  assert.deepEqual(seen, [nextState]);
});

test("handleGameClosed ignores local closures and notifies remote closures", () => {
  const client = new DotsAndBoxesClient();
  const events = [];

  client.userId = "local-user";
  client.setRemoteGameClosedHandler((event) => events.push(event));

  client.handleGameClosed({ closedBy: "local-user" });
  client.handleGameClosed({ closedBy: "remote-user", reason: "player_left" });

  assert.deepEqual(events, [{ closedBy: "remote-user", reason: "player_left" }]);
});

test("startPolling stores callback and subscribes to the game channel", async () => {
  const client = new DotsAndBoxesClient();
  const subscriptions = [];

  client.subscribeToGame = async (gameId) => {
    subscriptions.push(gameId);
  };

  const callback = () => {};
  client.startPolling("game-123", callback);

  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(client.onGameStateChanged, callback);
  assert.deepEqual(subscriptions, ["game-123"]);
});