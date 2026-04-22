import test from "node:test";
import assert from "node:assert/strict";

import {
  BOARD_PADDING,
  BOARD_SPACING,
  CLICK_SELECTION_RADIUS,
  areAdjacentDots,
  findClosestDot,
  getBoardMetrics,
  gridToCanvasPoint,
  isSelectableDot,
  parseSerializedLine,
} from "../modules/board-geometry.js";

test("getBoardMetrics returns consistent board dimensions", () => {
  const metrics = getBoardMetrics(5);

  assert.equal(metrics.padding, BOARD_PADDING);
  assert.equal(metrics.spacing, BOARD_SPACING);
  assert.equal(metrics.width, BOARD_SPACING * 4 + BOARD_PADDING * 2);
  assert.equal(metrics.height, BOARD_SPACING * 4 + BOARD_PADDING * 2);
});

test("gridToCanvasPoint maps grid coordinates to canvas coordinates", () => {
  const metrics = getBoardMetrics(4);

  assert.deepEqual(gridToCanvasPoint(2, 3, metrics), {
    x: BOARD_PADDING + BOARD_SPACING * 2,
    y: BOARD_PADDING + BOARD_SPACING * 3,
  });
});

test("parseSerializedLine parses line endpoints", () => {
  assert.deepEqual(parseSerializedLine("1:2-3:4"), {
    start: { x: 1, y: 2 },
    end: { x: 3, y: 4 },
  });
});

test("findClosestDot returns the nearest grid point with distance", () => {
  const metrics = getBoardMetrics(5);
  const closest = findClosestDot(BOARD_PADDING + 2, BOARD_PADDING + 3, 5, metrics);

  assert.deepEqual(closest.x, 0);
  assert.deepEqual(closest.y, 0);
  assert.ok(closest.dist < 4);
});

test("isSelectableDot accepts nearby dots and rejects distant ones", () => {
  assert.equal(isSelectableDot({ x: 0, y: 0, dist: CLICK_SELECTION_RADIUS - 1 }), true);
  assert.equal(isSelectableDot({ x: 0, y: 0, dist: CLICK_SELECTION_RADIUS + 1 }), false);
  assert.equal(isSelectableDot(null), false);
});

test("areAdjacentDots only accepts orthogonally adjacent dots", () => {
  assert.equal(areAdjacentDots({ x: 0, y: 0 }, { x: 1, y: 0 }), true);
  assert.equal(areAdjacentDots({ x: 0, y: 0 }, { x: 0, y: 1 }), true);
  assert.equal(areAdjacentDots({ x: 0, y: 0 }, { x: 1, y: 1 }), false);
  assert.equal(areAdjacentDots({ x: 0, y: 0 }, { x: 0, y: 0 }), false);
  assert.equal(areAdjacentDots(null, { x: 0, y: 1 }), false);
});