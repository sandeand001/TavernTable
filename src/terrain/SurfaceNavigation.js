import { FEET_PER_GRID_SQUARE, MAX_STEP_HEIGHT_FEET } from '../config/TokenMovementConfig.js';

export const WALKABLE_ROOF_NORMAL_Y =
  FEET_PER_GRID_SQUARE / Math.hypot(FEET_PER_GRID_SQUARE, MAX_STEP_HEIGHT_FEET);
export function isFloorSurface(surface) {
  return (
    surface?.normal?.y > 0.9 ||
    (surface?.kind === 'floor' && surface.normal?.y >= WALKABLE_ROOF_NORMAL_Y - 1e-6)
  );
}

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
  const startX = start.xFeet === undefined ? center(start.gridX) : start.xFeet;
  const startZ = start.zFeet === undefined ? center(start.gridY) : start.zFeet;
  if (
    !Number.isFinite(startX) ||
    !Number.isFinite(startZ) ||
    Math.floor(startX / FEET_PER_GRID_SQUARE) !== start.gridX ||
    Math.floor(startZ / FEET_PER_GRID_SQUARE) !== start.gridY
  )
    throw new Error('Surface navigation requires a physical start inside its grid cell');
  const initial = geometry.findSupport(startX, startZ, {
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
  if (startX !== center(start.gridX) || startZ !== center(start.gridY)) {
    first.xFeet = startX;
    first.zFeet = startZ;
  }
  const tiles = new Map([[startKey, first]]);
  const previous = new Map();
  const queue = [{ ...first, key: startKey }];
  const stepCost = FEET_PER_GRID_SQUARE * (prone ? 2 : 1);
  const supports = new Map();
  const supportAt = (x, y, height) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
    const key = `${x},${y}:${height}`;
    if (!supports.has(key))
      supports.set(
        key,
        geometry.findSupport(center(x), center(y), {
          belowFeet: height + MAX_STEP_HEIGHT_FEET,
          clearanceFeet: bodyHeightFeet,
        })
      );
    return supports.get(key);
  };
  const navigation = new Map();
  const horizon = (speedFeet * FEET_PER_GRID_SQUARE) / stepCost + FEET_PER_GRID_SQUARE;
  if (speedFeet >= stepCost)
    for (const [index, point] of (geometry.getNavigationPoints?.() || []).entries()) {
      const gridX = Math.floor(point.x / FEET_PER_GRID_SQUARE),
        gridY = Math.floor(point.z / FEET_PER_GRID_SQUARE);
      if (gridX < 0 || gridY < 0 || gridX >= cols || gridY >= rows) continue;
      if (Math.max(Math.abs(point.x - startX), Math.abs(point.z - startZ)) > horizon + 1e-7)
        continue;
      const support = geometry.findSupport(point.x, point.z, {
        belowFeet: point.y + MAX_STEP_HEIGHT_FEET,
        clearanceFeet: bodyHeightFeet,
      });
      if (!support || Math.abs(support.heightFeet - point.y) > MAX_STEP_HEIGHT_FEET + 1e-7)
        continue;
      const key = `${gridX},${gridY}`;
      if (!navigation.has(key)) navigation.set(key, []);
      navigation
        .get(key)
        .push({ gridX, gridY, support, xFeet: point.x, zFeet: point.z, navKey: `nav-${index}` });
    }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor];
    if (current.cost + stepCost > speedFeet + 1e-7) continue;
    const targets = OFFSETS.map(([dx, dy]) => {
      const x = current.gridX + dx,
        y = current.gridY + dy;
      return { gridX: x, gridY: y, support: supportAt(x, y, current.heightFeet) };
    });
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        targets.push(...(navigation.get(`${current.gridX + dx},${current.gridY + dy}`) || []));
    for (const target of targets) {
      const x = target.gridX,
        y = target.gridY,
        dx = x - current.gridX,
        dy = y - current.gridY;
      const support = target.support;
      if (!support || isOccupied(x, y, support.heightFeet, bodyHeightFeet)) continue;
      const key = keyFor(x, y, support) + (target.navKey ? `#${target.navKey}` : '');
      if (tiles.has(key)) continue;
      const currentX = current.xFeet ?? center(current.gridX),
        currentZ = current.zFeet ?? center(current.gridY);
      const targetX = target.xFeet ?? center(x),
        targetZ = target.zFeet ?? center(y);
      const distance = Math.max(Math.abs(targetX - currentX), Math.abs(targetZ - currentZ));
      if (
        (target.navKey || current.navKey) &&
        (distance > FEET_PER_GRID_SQUARE + 1e-7 ||
          (target.navKey &&
            Math.abs(current.heightFeet - support.heightFeet) > MAX_STEP_HEIGHT_FEET + 1e-7) ||
          (distance < 1e-7 && Math.abs(current.heightFeet - support.heightFeet) < 1e-7))
      )
        continue;
      if (
        support.requiresTransfer &&
        current.heightFeet - support.heightFeet <= MAX_STEP_HEIGHT_FEET + 1e-7
      )
        continue;
      if (dx && dy && !target.navKey && !current.navKey) {
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
      const curved =
        geometry.isCurvedSupport?.(current.surfaceId) || geometry.isCurvedSupport?.(support.id);
      const body = {
        min: {
          x: Math.min(currentX, targetX) - radius,
          y: standingHeight,
          z: Math.min(currentZ, targetZ) - radius,
        },
        max: {
          x: Math.max(currentX, targetX) + radius,
          y: standingHeight + bodyHeightFeet,
          z: Math.max(currentZ, targetZ) + radius,
        },
      };
      const clear = curved
        ? geometry.isGroundSpaceClear(body, standingHeight + MAX_STEP_HEIGHT_FEET)
        : geometry.isSpaceClear(body);
      if (
        !clear &&
        !(
          !curved &&
          Math.abs(targetX - currentX) > 1e-7 &&
          Math.abs(targetZ - currentZ) > 1e-7 &&
          geometry.isSweptSpaceClear?.(
            { x: currentX, y: standingHeight, z: currentZ },
            { x: targetX, y: standingHeight, z: targetZ },
            radius,
            standingHeight,
            standingHeight + bodyHeightFeet
          )
        )
      )
        continue;
      if (curved && Math.abs(current.heightFeet - support.heightFeet) <= MAX_STEP_HEIGHT_FEET) {
        const samples = Math.ceil(Math.hypot(targetX - currentX, targetZ - currentZ) / 0.5);
        let continuous = true;
        for (let sample = 1; sample < samples; sample++) {
          const ratio = sample / samples;
          const underfoot = geometry.findSupport(
            currentX + (targetX - currentX) * ratio,
            currentZ + (targetZ - currentZ) * ratio,
            { belowFeet: standingHeight + MAX_STEP_HEIGHT_FEET, clearanceFeet: bodyHeightFeet }
          );
          if (
            !underfoot ||
            underfoot.heightFeet <
              Math.min(current.heightFeet, support.heightFeet) - MAX_STEP_HEIGHT_FEET
          ) {
            continuous = false;
            break;
          }
        }
        if (!continuous) continue;
      }
      const next = cell(
        x,
        y,
        support,
        current.cost + stepCost,
        current.distance + (dx && dy ? Math.SQRT2 : 1)
      );
      if (target.navKey)
        Object.assign(next, { xFeet: targetX, zFeet: targetZ, navKey: target.navKey });
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
