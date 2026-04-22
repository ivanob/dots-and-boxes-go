import {
  getBoardMetrics,
  gridToCanvasPoint,
  parseSerializedLine,
  SELECTED_DOT_RADIUS,
} from "./board-geometry.js";

export function renderGameBoard(canvas, gameState, playerColors) {
  if (!canvas || !gameState) {
    return;
  }

  const metrics = getBoardMetrics(gameState.gridSize);
  canvas.width = metrics.width;
  canvas.height = metrics.height;

  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawGrid(ctx, metrics);
  drawLines(ctx, gameState, metrics);
  drawBoxes(ctx, gameState, playerColors, metrics);
  drawDots(ctx, metrics);
}

export function drawSelectedDot(canvas, selectedDot, gridSize) {
  if (!canvas || !selectedDot) {
    return;
  }

  const ctx = canvas.getContext("2d");
  const metrics = getBoardMetrics(gridSize);
  const point = gridToCanvasPoint(selectedDot.x, selectedDot.y, metrics);

  ctx.strokeStyle = "#ff6b6b";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(point.x, point.y, SELECTED_DOT_RADIUS, 0, Math.PI * 2);
  ctx.stroke();
}

function drawGrid(ctx, metrics) {
  ctx.strokeStyle = "#e0e0e0";
  ctx.lineWidth = 1;

  for (let x = 0; x < metrics.gridSize; x += 1) {
    for (let y = 0; y < metrics.gridSize; y += 1) {
      const point = gridToCanvasPoint(x, y, metrics);

      if (x < metrics.gridSize - 1) {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x + metrics.spacing, point.y);
        ctx.stroke();
      }

      if (y < metrics.gridSize - 1) {
        ctx.beginPath();
        ctx.moveTo(point.x, point.y);
        ctx.lineTo(point.x, point.y + metrics.spacing);
        ctx.stroke();
      }
    }
  }
}

function drawLines(ctx, gameState, metrics) {
  if (!gameState.lines) {
    return;
  }

  ctx.strokeStyle = "#667eea";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";

  gameState.lines.forEach((line) => {
    const parsedLine = parseSerializedLine(line);
    const start = gridToCanvasPoint(parsedLine.start.x, parsedLine.start.y, metrics);
    const end = gridToCanvasPoint(parsedLine.end.x, parsedLine.end.y, metrics);

    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  });
}

function drawBoxes(ctx, gameState, playerColors, metrics) {
  const boxCount = metrics.gridSize - 1;

  for (let x = 0; x < boxCount; x += 1) {
    for (let y = 0; y < boxCount; y += 1) {
      const boxKey = `${x}:${y}`;
      const playerId = gameState.boxes?.[boxKey];
      if (!playerId) {
        continue;
      }

      const point = gridToCanvasPoint(x, y, metrics);
      const playerIndex = gameState.players.indexOf(playerId);
      const color = playerColors[playerIndex % playerColors.length];

      ctx.fillStyle = color + "30";
      ctx.fillRect(
        point.x + metrics.spacing / 10,
        point.y + metrics.spacing / 10,
        metrics.spacing * 0.8,
        metrics.spacing * 0.8
      );

      ctx.fillStyle = color;
      ctx.font = "bold 16px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(String.fromCharCode(65 + playerIndex), point.x + metrics.spacing / 2, point.y + metrics.spacing / 2);
    }
  }
}

function drawDots(ctx, metrics) {
  ctx.fillStyle = "#333";

  for (let x = 0; x < metrics.gridSize; x += 1) {
    for (let y = 0; y < metrics.gridSize; y += 1) {
      const point = gridToCanvasPoint(x, y, metrics);
      ctx.beginPath();
      ctx.arc(point.x, point.y, metrics.dotRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}