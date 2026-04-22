export const BOARD_PADDING = 40;
export const BOARD_SPACING = 40;
export const BOARD_DOT_RADIUS = 6;
export const SELECTED_DOT_RADIUS = 10;
export const CLICK_SELECTION_RADIUS = 24;

export function getBoardMetrics(gridSize) {
  return {
    gridSize,
    padding: BOARD_PADDING,
    spacing: BOARD_SPACING,
    dotRadius: BOARD_DOT_RADIUS,
    width: BOARD_SPACING * (gridSize - 1) + BOARD_PADDING * 2,
    height: BOARD_SPACING * (gridSize - 1) + BOARD_PADDING * 2,
  };
}

export function gridToCanvasPoint(x, y, metrics) {
  return {
    x: metrics.padding + x * metrics.spacing,
    y: metrics.padding + y * metrics.spacing,
  };
}

export function parseSerializedLine(line) {
  const [pos1, pos2] = line.split("-");
  const [x1, y1] = pos1.split(":").map((value) => parseInt(value, 10));
  const [x2, y2] = pos2.split(":").map((value) => parseInt(value, 10));

  return {
    start: { x: x1, y: y1 },
    end: { x: x2, y: y2 },
  };
}

export function findClosestDot(canvasX, canvasY, gridSize, metrics = getBoardMetrics(gridSize)) {
  let closestDot = null;
  let minDistance = Infinity;

  for (let x = 0; x < gridSize; x += 1) {
    for (let y = 0; y < gridSize; y += 1) {
      const point = gridToCanvasPoint(x, y, metrics);
      const distance = Math.sqrt((canvasX - point.x) ** 2 + (canvasY - point.y) ** 2);

      if (distance < minDistance) {
        minDistance = distance;
        closestDot = { x, y, dist: distance };
      }
    }
  }

  return closestDot;
}

export function isSelectableDot(dot) {
  return Boolean(dot) && dot.dist < CLICK_SELECTION_RADIUS;
}

export function areAdjacentDots(firstDot, secondDot) {
  if (!firstDot || !secondDot) {
    return false;
  }

  const dx = Math.abs(firstDot.x - secondDot.x);
  const dy = Math.abs(firstDot.y - secondDot.y);

  return (dx === 1 && dy === 0) || (dx === 0 && dy === 1);
}