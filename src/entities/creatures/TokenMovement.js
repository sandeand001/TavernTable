import {
  FEET_PER_GRID_SQUARE,
  MAX_STEP_HEIGHT_FEET,
  TOKEN_MOVEMENT_DEFAULTS,
} from '../../config/TokenMovementConfig.js';

const characterLibraries = new WeakMap();

// ── Per-Creature Settings ────────────────────────────────────
export function linkTokenCharacter(token, library, characterId) {
  const character = library.get(characterId);
  token.characterSheetId = character.id;
  token.name = character.name;
  token.nameMode = 'character';
  characterLibraries.set(token, library);
  const style = { ...token.movementSettings };
  delete style.speed;
  token.movementSettings = style;
  return character;
}

export function unlinkTokenCharacter(token, movementSettings) {
  characterLibraries.delete(token);
  delete token.characterSheetId;
  token.movementSettings = { ...movementSettings };
}

export function getTokenMovementSettings(token) {
  const settings = { ...TOKEN_MOVEMENT_DEFAULTS, ...token.movementSettings };
  const library = characterLibraries.get(token);
  if (library) settings.speed = library.get(token.characterSheetId).speed;
  if (!Number.isFinite(settings.speed) || settings.speed < 0) {
    throw new Error('Movement speed must be a finite, non-negative number of feet');
  }
  if (!['walk', 'run'].includes(settings.mode))
    throw new Error('Movement mode must be Walk or Run');
  if (!['default', 'drunk'].includes(settings.type)) {
    throw new Error('Movement type must be Default or Drunk');
  }
  return settings;
}

export function setTokenMovementSettings(token, updates) {
  const settings = getTokenMovementSettings({
    movementSettings: { ...getTokenMovementSettings(token), ...updates },
  });
  const library = characterLibraries.get(token);
  if (library) {
    if ('speed' in updates) library.edit(token.characterSheetId, { speed: settings.speed });
    token.movementSettings = { mode: settings.mode, type: settings.type };
  } else {
    token.movementSettings = settings;
  }
  return settings;
}

export function movementStepCost(
  fromHeight,
  toHeight,
  tileWorldSize,
  elevationUnit,
  mode = 'walk',
  minClimbHeightDifference = elevationUnit > 0
    ? (MAX_STEP_HEIGHT_FEET * tileWorldSize) / (FEET_PER_GRID_SQUARE * elevationUnit)
    : Infinity
) {
  const delta = toHeight - fromHeight;
  const climbs =
    Math.abs(delta) > minClimbHeightDifference + 1e-9 && (delta > 0 || mode === 'walk');
  const verticalFeet = (Math.abs(delta) * elevationUnit * FEET_PER_GRID_SQUARE) / tileWorldSize;
  return FEET_PER_GRID_SQUARE + (climbs ? 2 * verticalFeet : 0);
}

// ── Reachability & Route Planning ────────────────────────────
export function buildMovementRange({
  cols,
  rows,
  startGridX,
  startGridY,
  speed,
  tileWorldSize,
  elevationUnit,
  getHeight,
  blocked = new Set(),
  maxDiagonalHeightDifference = Infinity,
  minClimbHeightDifference = elevationUnit > 0
    ? (MAX_STEP_HEIGHT_FEET * tileWorldSize) / (FEET_PER_GRID_SQUARE * elevationUnit)
    : Infinity,
  mode = TOKEN_MOVEMENT_DEFAULTS.mode,
  wallStart = null,
  getWallRestHeight = null,
  maxVaultHeightDifference = 0,
}) {
  if (
    !Number.isInteger(cols) ||
    cols < 1 ||
    !Number.isInteger(rows) ||
    rows < 1 ||
    !Number.isInteger(startGridX) ||
    startGridX < 0 ||
    startGridX >= cols ||
    !Number.isInteger(startGridY) ||
    startGridY < 0 ||
    startGridY >= rows ||
    !Number.isFinite(speed) ||
    speed < 0 ||
    !Number.isFinite(tileWorldSize) ||
    tileWorldSize <= 0 ||
    !Number.isFinite(elevationUnit) ||
    elevationUnit < 0 ||
    typeof getHeight !== 'function' ||
    (getWallRestHeight !== null && typeof getWallRestHeight !== 'function') ||
    !['walk', 'run'].includes(mode) ||
    !(minClimbHeightDifference >= 0) ||
    !(maxVaultHeightDifference >= 0)
  ) {
    throw new Error(
      'Movement range requires a valid grid, start cell, distance, and terrain scale'
    );
  }
  const heights = new Map();
  const heightAt = (x, y) => {
    const key = `${x},${y}`;
    if (!heights.has(key)) {
      const height = getHeight(x, y);
      if (!Number.isFinite(height)) throw new Error(`Terrain height is invalid at ${key}`);
      heights.set(key, height);
    }
    return heights.get(key);
  };
  const wallFaces = new Map();
  const faceAt = (x, y, nx, ny) => {
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return null;
    const first = { gridX: x, gridY: y, height: heightAt(x, y) };
    const second = { gridX: nx, gridY: ny, height: heightAt(nx, ny) };
    if (
      Math.abs(first.height - second.height) <= minClimbHeightDifference + 1e-9 ||
      first.height === second.height
    )
      return null;
    const [low, high] = first.height < second.height ? [first, second] : [second, first];
    const id = `${low.gridX},${low.gridY}>${high.gridX},${high.gridY}`;
    if (!wallFaces.has(id)) {
      const face = { id, low, high, bands: [] };
      const restHeight = getWallRestHeight ? getWallRestHeight(face) : high.height;
      if (
        !Number.isFinite(restHeight) ||
        restHeight < low.height - 1e-9 ||
        restHeight > high.height + 1e-9
      )
        throw new Error('Movement wall-rest height is invalid');
      face.restHeight = restHeight;
      wallFaces.set(id, face);
    }
    return wallFaces.get(id);
  };
  let startingWall = null;
  if (wallStart) {
    const { low, high } = wallStart.face || {};
    const cells = [low, high];
    if (
      !cells.every(
        (cell) =>
          Number.isInteger(cell?.gridX) &&
          Number.isInteger(cell?.gridY) &&
          cell.gridX >= 0 &&
          cell.gridX < cols &&
          cell.gridY >= 0 &&
          cell.gridY < rows
      ) ||
      Math.abs(low.gridX - high.gridX) + Math.abs(low.gridY - high.gridY) !== 1 ||
      !(elevationUnit > 0)
    )
      throw new Error('Movement wall anchor is invalid');
    startingWall = faceAt(low.gridX, low.gridY, high.gridX, high.gridY);
    if (
      !startingWall ||
      !Number.isFinite(wallStart.height) ||
      wallStart.height < startingWall.low.height - 1e-9 ||
      wallStart.height > startingWall.high.height + 1e-9
    )
      throw new Error('Movement wall anchor is no longer supported by terrain');
  }
  const startKey = startingWall ? `wall:${startingWall.id}` : `${startGridX},${startGridY}`;
  const start = {
    gridX: startGridX,
    gridY: startGridY,
    height: wallStart?.height ?? heightAt(startGridX, startGridY),
    cost: 0,
    distance: 0,
  };
  const tiles = new Map();
  const previous = new Map();
  const heap = [];
  let order = 0;
  const verticalCostPerLevel = (2 * elevationUnit * FEET_PER_GRID_SQUARE) / tileWorldSize;
  if (startingWall) {
    for (const exit of ['low', 'high']) {
      const cell = startingWall[exit];
      const key = `${cell.gridX},${cell.gridY}`;
      const cost =
        exit === 'low' && mode === 'run'
          ? 0
          : Math.abs(cell.height - start.height) * verticalCostPerLevel;
      if (blocked.has(key) || cost > speed + 1e-9) continue;
      const seed = { ...cell, cost, distance: 0, wallExit: exit, wall: startingWall };
      tiles.set(key, seed);
      previous.set(key, startKey);
      push(heap, { ...seed, key, order: order++ });
    }
  } else {
    tiles.set(startKey, start);
    push(heap, { ...start, key: startKey, order: order++ });
  }
  const offsets = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ];
  while (heap.length) {
    const current = pop(heap);
    const best = tiles.get(current.key);
    if (current.cost !== best.cost || current.distance !== best.distance) continue;
    for (const [dx, dy] of offsets) {
      const x = current.gridX + dx;
      const y = current.gridY + dy;
      const key = `${x},${y}`;
      if (x < 0 || y < 0 || x >= cols || y >= rows || blocked.has(key)) continue;
      const height = heightAt(x, y);
      const diagonal = dx !== 0 && dy !== 0;
      if (diagonal) {
        if (blocked.has(`${x},${current.gridY}`) || blocked.has(`${current.gridX},${y}`)) continue;
        const cornerHeights = [
          current.height,
          height,
          heightAt(x, current.gridY),
          heightAt(current.gridX, y),
        ];
        if (
          Math.max(...cornerHeights) - Math.min(...cornerHeights) >=
          maxDiagonalHeightDifference
        ) {
          continue;
        }
      }
      const cost =
        current.cost +
        movementStepCost(
          current.height,
          height,
          tileWorldSize,
          elevationUnit,
          mode,
          minClimbHeightDifference
        );
      if (cost > speed + 1e-9) continue;
      const distance = current.distance + (diagonal ? Math.SQRT2 : 1);
      const known = tiles.get(key);
      if (known && (known.cost < cost || (known.cost === cost && known.distance <= distance)))
        continue;
      const next = { gridX: x, gridY: y, height, cost, distance };
      tiles.set(key, next);
      previous.set(key, current.key);
      push(heap, { ...next, key, order: order++ });
    }
    if (mode === 'run' && maxVaultHeightDifference > 0) {
      for (const [dx, dy] of offsets.slice(0, 4)) {
        const ox = current.gridX + dx;
        const oy = current.gridY + dy;
        const x = ox + dx;
        const y = oy + dy;
        const key = `${x},${y}`;
        if (
          x < 0 ||
          y < 0 ||
          x >= cols ||
          y >= rows ||
          blocked.has(`${ox},${oy}`) ||
          blocked.has(key)
        )
          continue;
        const obstacleHeight = heightAt(ox, oy);
        const rise = obstacleHeight - current.height;
        if (
          rise <= minClimbHeightDifference + 1e-9 ||
          rise > maxVaultHeightDifference + 1e-9 ||
          Math.abs(heightAt(x, y) - current.height) > 1e-9
        )
          continue;
        const cost = current.cost + 2 * FEET_PER_GRID_SQUARE + rise * verticalCostPerLevel;
        if (cost > speed + 1e-9) continue;
        const distance = current.distance + 2;
        const known = tiles.get(key);
        if (known && (known.cost < cost || (known.cost === cost && known.distance <= distance)))
          continue;
        const next = {
          gridX: x,
          gridY: y,
          height: current.height,
          cost,
          distance,
          vault: { gridX: ox, gridY: oy, height: obstacleHeight, rise },
        };
        tiles.set(key, next);
        previous.set(key, current.key);
        push(heap, { ...next, key, order: order++ });
      }
    }
  }
  const addBand = (face, originHeight, baseCost, entryKey, minHeight, maxHeight) => {
    if (mode === 'run') minHeight = Math.max(minHeight, start.height);
    maxHeight = Math.min(maxHeight, face.restHeight);
    if (maxHeight < minHeight - 1e-9 || baseCost > speed + 1e-9) return;
    minHeight = Math.min(minHeight, maxHeight);
    if (
      face.restHeight < face.high.height - 1e-9 &&
      face.restHeight > face.low.height + 1e-9 &&
      maxHeight >= face.restHeight - 1e-9 &&
      baseCost + Math.abs(face.restHeight - originHeight) * verticalCostPerLevel <= speed + 1e-9
    )
      maxHeight = face.high.height;
    face.bands.push({ originHeight, baseCost, entryKey, minHeight, maxHeight });
  };
  for (const [key, cell] of tiles) {
    for (const [dx, dy] of offsets.slice(0, 4)) {
      const face = faceAt(cell.gridX, cell.gridY, cell.gridX + dx, cell.gridY + dy);
      if (!face) continue;
      if (blocked.has(`${face.low.gridX},${face.low.gridY}`)) continue;
      const baseCost = cell.cost + FEET_PER_GRID_SQUARE;
      const reach = (speed - baseCost) / verticalCostPerLevel;
      if (cell.height === face.low.height) {
        addBand(
          face,
          cell.height,
          baseCost,
          key,
          cell.height,
          Math.min(face.high.height, cell.height + reach)
        );
      } else if (mode === 'walk') {
        addBand(
          face,
          cell.height,
          baseCost,
          key,
          Math.max(face.low.height, cell.height - reach),
          cell.height
        );
      }
    }
  }
  if (startingWall) {
    const reach = speed / verticalCostPerLevel;
    addBand(
      startingWall,
      start.height,
      0,
      startKey,
      Math.max(startingWall.low.height, start.height - reach),
      Math.min(startingWall.high.height, start.height + reach)
    );
  }
  return {
    startKey,
    start,
    tiles,
    previous,
    walls: wallFaces,
    wallStart,
    speed,
    mode,
    verticalCostPerLevel,
    wallStepHeight: elevationUnit > 0 ? tileWorldSize / elevationUnit : Infinity,
  };
}

export function getMovementRoute(range, gridX, gridY) {
  let key = `${gridX},${gridY}`;
  if (!range.tiles.has(key)) return null;
  const route = [];
  while (key !== range.startKey) {
    const cell = range.tiles.get(key);
    if (!cell || route.length >= range.tiles.size)
      throw new Error('Movement route is inconsistent');
    route.push(cell);
    key = range.previous.get(key);
  }
  return route.reverse();
}

export function getWallMovementTarget(range, faceId, height) {
  if (!Number.isFinite(height)) throw new Error('Wall destination height must be finite');
  const face = range.walls.get(faceId);
  const matching = face?.bands.filter(
    (band) => height >= band.minHeight - 1e-9 && height <= band.maxHeight + 1e-9
  );
  if (!matching?.length) return null;
  const hasLedgeHang =
    face.restHeight > face.low.height + 1e-9 && face.restHeight < face.high.height - 1e-9;
  if (hasLedgeHang) height = Math.min(height, face.restHeight);
  const step = range.wallStepHeight;
  const nearest = Math.round((height - face.low.height) / step);
  const candidates = new Set([
    face.low.height + nearest * step,
    face.low.height + (nearest - 1) * step,
    face.low.height + (nearest + 1) * step,
    ...matching.flatMap((band) => [band.minHeight, band.maxHeight]),
  ]);
  if (hasLedgeHang) candidates.add(face.restHeight);
  if (range.wallStart?.face.id === faceId) candidates.add(range.start.height);
  const destinations = [];
  for (const candidate of candidates) {
    if (hasLedgeHang && candidate > face.restHeight + 1e-9) continue;
    const bands = matching.filter(
      (band) => candidate >= band.minHeight - 1e-9 && candidate <= band.maxHeight + 1e-9
    );
    if (!bands.length) continue;
    const exit =
      Math.abs(candidate - face.low.height) < 1e-9
        ? 'low'
        : Math.abs(candidate - face.high.height) < 1e-9
          ? 'high'
          : null;
    if (exit && !range.tiles.has(`${face[exit].gridX},${face[exit].gridY}`)) continue;
    const best = bands
      .map((band) => ({
        height: candidate,
        cost: band.baseCost + Math.abs(candidate - band.originHeight) * range.verticalCostPerLevel,
        entryKey: band.entryKey,
      }))
      .sort((a, b) => a.cost - b.cost)[0];
    if (best.cost <= range.speed + 1e-9)
      destinations.push({
        ...best,
        kind: 'wall',
        face,
        exit,
        ledgeHang: hasLedgeHang && Math.abs(candidate - face.restHeight) < 1e-9,
      });
  }
  destinations.sort(
    (a, b) => Math.abs(a.height - height) - Math.abs(b.height - height) || a.cost - b.cost
  );
  return destinations[0] || null;
}

// ── Stable Minimum-Cost Queue ─────────────────────────────────
function compare(a, b) {
  return a.cost - b.cost || a.distance - b.distance || a.order - b.order;
}

function push(heap, entry) {
  let index = heap.length;
  heap.push(entry);
  while (index > 0) {
    const parent = (index - 1) >> 1;
    if (compare(heap[parent], entry) <= 0) break;
    heap[index] = heap[parent];
    index = parent;
  }
  heap[index] = entry;
}

function pop(heap) {
  const first = heap[0];
  const last = heap.pop();
  if (!heap.length) return first;
  let index = 0;
  while (index * 2 + 1 < heap.length) {
    let child = index * 2 + 1;
    if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++;
    if (compare(last, heap[child]) <= 0) break;
    heap[index] = heap[child];
    index = child;
  }
  heap[index] = last;
  return first;
}
