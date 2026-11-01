import { FEET_PER_GRID_SQUARE, MAX_STEP_HEIGHT_FEET } from '../config/TokenMovementConfig.js';

const OFFSETS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];
const keyFor = (x, y, surface) => `${x},${y}@${surface.id}:${surface.heightFeet}`;

export function buildSurfaceRange({
  geometry,
  start,
  speedFeet,
  bodyHeightFeet = 5,
  prone = false,
  isOccupied = () => false,
}) {
  if (
    !geometry ||
    !Number.isInteger(start?.gridX) ||
    !Number.isInteger(start?.gridY) ||
    !Number.isFinite(start.heightFeet) ||
    !Number.isFinite(speedFeet) ||
    speedFeet < 0 ||
    !Number.isFinite(bodyHeightFeet) ||
    bodyHeightFeet <= 0 ||
    typeof prone !== 'boolean' ||
    typeof isOccupied !== 'function'
  ) {
    throw new Error('Surface navigation requires a valid start, allowance and body clearance');
  }
  const cols = Math.floor(geometry.widthFeet / FEET_PER_GRID_SQUARE);
  const rows = Math.floor(geometry.depthFeet / FEET_PER_GRID_SQUARE);
  const center = (value) => (value + 0.5) * FEET_PER_GRID_SQUARE;
  const initial = geometry.findSupport(center(start.gridX), center(start.gridY), {
    belowFeet: start.heightFeet + 1e-6,
    clearanceFeet: bodyHeightFeet,
    surfaceId: start.surfaceId ?? null,
  });
  if (!initial || Math.abs(initial.heightFeet - start.heightFeet) > 1e-5) {
    throw new Error('The creature is not standing on a clear, supported map surface');
  }
  const cell = (x, y, support, cost, distance) => ({
    gridX: x,
    gridY: y,
    heightFeet: support.heightFeet,
    surfaceId: support.id,
    layerId: support.layerId,
    cost,
    distance,
  });
  const startKey = keyFor(start.gridX, start.gridY, initial);
  const first = cell(start.gridX, start.gridY, initial, 0, 0);
  const tiles = new Map([[startKey, first]]);
  const previous = new Map();
  const queue = [{ ...first, key: startKey }];
  const stepCost = FEET_PER_GRID_SQUARE * (prone ? 2 : 1);
  const supportAt = (x, y, height) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    return geometry.findSupport(center(x), center(y), {
      belowFeet: height + MAX_STEP_HEIGHT_FEET,
      clearanceFeet: bodyHeightFeet,
    });
  };
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current.cost + stepCost > speedFeet + 1e-7) continue;
    for (const [dx, dy] of OFFSETS) {
      const x = current.gridX + dx,
        y = current.gridY + dy;
      const support = supportAt(x, y, current.heightFeet);
      if (!support || isOccupied(x, y, support.heightFeet, bodyHeightFeet)) continue;
      if (dx && dy) {
        const sideX = supportAt(x, current.gridY, current.heightFeet);
        const sideY = supportAt(current.gridX, y, current.heightFeet);
        if (
          !sideX ||
          !sideY ||
          Math.max(sideX.heightFeet, sideY.heightFeet, support.heightFeet, current.heightFeet) -
            Math.min(sideX.heightFeet, sideY.heightFeet, support.heightFeet, current.heightFeet) >
            MAX_STEP_HEIGHT_FEET + 1e-7 ||
          (isOccupied(x, current.gridY, sideX.heightFeet, bodyHeightFeet) &&
            isOccupied(current.gridX, y, sideY.heightFeet, bodyHeightFeet))
        )
          continue;
      }
      const standingHeight = Math.max(current.heightFeet, support.heightFeet);
      const radius = 0.5;
      if (
        !geometry.isSpaceClear({
          min: {
            x: Math.min(center(current.gridX), center(x)) - radius,
            y: standingHeight,
            z: Math.min(center(current.gridY), center(y)) - radius,
          },
          max: {
            x: Math.max(center(current.gridX), center(x)) + radius,
            y: standingHeight + bodyHeightFeet,
            z: Math.max(center(current.gridY), center(y)) + radius,
          },
        })
      )
        continue;
      const key = keyFor(x, y, support);
      if (tiles.has(key)) continue;
      const next = cell(
        x,
        y,
        support,
        current.cost + stepCost,
        current.distance + (dx && dy ? Math.SQRT2 : 1)
      );
      tiles.set(key, next);
      previous.set(key, current.key);
      queue.push({ ...next, key });
    }
  }
  return {
    layered: true,
    geometry,
    start: first,
    startKey,
    tiles,
    previous,
    speed: speedFeet,
    prone,
    walls: new Map(),
  };
}

export function getSurfaceRoute(range, gridX, gridY, { surfaceId = null, heightFeet = null } = {}) {
  const candidates = [...range.tiles]
    .filter(
      ([, cell]) =>
        cell.gridX === gridX &&
        cell.gridY === gridY &&
        (surfaceId === null || cell.surfaceId === surfaceId) &&
        (heightFeet === null || Math.abs(cell.heightFeet - heightFeet) < 1e-5)
    )
    .sort(([, a], [, b]) => a.cost - b.cost);
  let key = candidates[0]?.[0];
  if (!key) return null;
  const route = [];
  while (key !== range.startKey) {
    const cell = range.tiles.get(key);
    if (!cell || route.length >= range.tiles.size)
      throw new Error('The surface route is inconsistent');
    route.push(cell);
    key = range.previous.get(key);
  }
  return route.reverse();
}
