import { getCharacterDefinition } from '../config/CharacterCatalog.js';
import { restoreCombat } from '../entities/characters/combat/persistence.js';
import { copyRollSummary } from '../systems/dice/rollSummary.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import { validateSavedPlacement } from '../scene/token-adapter/SavedPlacements.js';

const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const finite = (value, min = -1000000, max = 1000000) =>
  Number.isFinite(value) && value >= min && value <= max;
const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);
const vector = (value) => record(value) && ['x', 'y', 'z'].every((key) => finite(value[key]));
const name = (value) => typeof value === 'string' && !!value.trim() && value.length <= 100;
const failure = (part) => {
  throw new Error(`The saved campaign scene has invalid ${part}; it was not reset`);
};

function jsonSettings(value, depth = 0) {
  if (depth > 5) return false;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return value.length <= 100 && value.every((item) => jsonSettings(item, depth + 1));
  return (
    record(value) &&
    Object.keys(value).length <= 50 &&
    Object.entries(value).every(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && jsonSettings(item, depth + 1)
    )
  );
}

export function validateScene(scene, { ruleset, library }) {
  if (!record(scene) || scene.version !== 1 || scene.ruleset !== ruleset)
    failure('version or ruleset');
  const grid = scene.grid;
  if (
    !record(grid) ||
    !integer(grid.cols, GRID_CONFIG.MIN_COLS, GRID_CONFIG.MAX_COLS) ||
    !integer(grid.rows, GRID_CONFIG.MIN_ROWS, GRID_CONFIG.MAX_ROWS) ||
    !finite(grid.tileWorldSize, 0.001, 1000)
  )
    failure('grid dimensions');
  const inside = (x, y) => integer(x, 0, grid.cols - 1) && integer(y, 0, grid.rows - 1);
  const terrain = scene.terrain;
  if (
    !record(terrain) ||
    !Array.isArray(terrain.heights) ||
    terrain.heights.length !== grid.rows ||
    terrain.heights.some(
      (row) =>
        !Array.isArray(row) || row.length !== grid.cols || row.some((height) => !finite(height))
    ) ||
    (terrain.biome !== null && (typeof terrain.biome !== 'string' || terrain.biome.length > 150)) ||
    !integer(terrain.seed, 0, 0xffffffff) ||
    !finite(terrain.elevationScale, 0, 10000) ||
    !finite(terrain.worldElevationUnit, 0, 1000) ||
    !finite(terrain.treeDensity, 0, 100) ||
    !record(terrain.richShading) ||
    !jsonSettings(terrain.richShading) ||
    !Array.isArray(terrain.placeables) ||
    terrain.placeables.length > 50000
  )
    failure('terrain');
  for (const placement of terrain.placeables) {
    if (
      !record(placement) ||
      !inside(placement.gridX, placement.gridY) ||
      typeof placement.type !== 'string' ||
      placement.type.length > 100 ||
      !vector(placement.persistedScale) ||
      ['x', 'y', 'z'].some((key) => placement.persistedScale[key] <= 0) ||
      ['modelKey', 'variantKey', 'placeableId'].some(
        (key) =>
          placement[key] !== undefined &&
          (typeof placement[key] !== 'string' ||
            placement[key].length > 500 ||
            /(?:^https?:|^data:|^blob:|\.\.)/i.test(placement[key]))
      ) ||
      (placement.heightOffset !== undefined && !finite(placement.heightOffset))
    )
      failure('placeable references');
  }
  if (!Array.isArray(scene.creatures) || scene.creatures.length > 2000) failure('creature list');
  const ids = new Set();
  const placeholders = [];
  for (const creature of scene.creatures) {
    if (
      !record(creature) ||
      !identifier(creature.id) ||
      ids.has(creature.id) ||
      !getCharacterDefinition(creature.type) ||
      !integer(creature.instanceNumber, 1, 1000000000) ||
      !name(creature.name) ||
      !['automatic', 'character', 'custom'].includes(creature.nameMode) ||
      (creature.characterId !== null && !identifier(creature.characterId)) ||
      !inside(creature.gridX, creature.gridY) ||
      !finite(creature.facingAngle) ||
      !record(creature.movement) ||
      !['walk', 'run'].includes(creature.movement.mode) ||
      !['default', 'drunk'].includes(creature.movement.type) ||
      (creature.characterId === null && !finite(creature.movement.speed, 0, 1000)) ||
      !record(creature.pose) ||
      !['ground', 'wall'].includes(creature.pose.kind) ||
      !vector(creature.pose.world)
    )
      failure('creature identity or position');
    validateSavedPlacement(creature);
    if (creature.characterId) {
      const character = library.get(creature.characterId);
      if (creature.name !== character.name || creature.nameMode !== 'character')
        failure('shared character names');
    } else if (creature.nameMode === 'character') failure('unlinked character name');
    if (creature.pose.kind === 'wall') {
      const wall = creature.pose.wall;
      if (
        !record(wall) ||
        !record(wall.face) ||
        ![wall.face.low, wall.face.high].every(
          (cell) => record(cell) && inside(cell.gridX, cell.gridY) && finite(cell.height)
        ) ||
        Math.abs(wall.face.low.gridX - wall.face.high.gridX) +
          Math.abs(wall.face.low.gridY - wall.face.high.gridY) !==
          1 ||
        wall.face.high.height <= wall.face.low.height ||
        !finite(wall.loopClock, 0) ||
        !finite(wall.loopOriginY) ||
        !['climbWall', 'climbWallDown'].includes(wall.loopClip) ||
        !['climbWall', 'climbWallDown', 'ledgeHang'].includes(wall.clip) ||
        [wall.face.low, wall.face.high].some(
          (cell) => Math.abs(terrain.heights[cell.gridY][cell.gridX] - cell.height) > 1e-6
        )
      )
        failure('stable wall/ledge attachment');
    }
    ids.add(creature.id);
    placeholders.push({ id: creature.id, characterSheetId: creature.characterId });
  }
  const counters = scene.tokenCounters;
  if (
    !record(counters) ||
    !integer(counters.nextId, 0, Number.MAX_SAFE_INTEGER) ||
    !Array.isArray(counters.types) ||
    new Set(counters.types.map((row) => row?.[0])).size !== counters.types.length ||
    counters.types.some(
      (row) =>
        !Array.isArray(row) ||
        row.length !== 2 ||
        !getCharacterDefinition(row[0]) ||
        !integer(row[1], 0, 1000000000)
    )
  )
    failure('creature naming counters');
  const byType = new Map(counters.types);
  for (const creature of scene.creatures) {
    const number = /^token-(\d+)$/.exec(creature.id);
    if (
      (number && Number(number[1]) > counters.nextId) ||
      (byType.get(creature.type) ?? -1) < creature.instanceNumber
    )
      failure('creature naming counters');
  }
  const camera = scene.camera;
  if (
    !record(camera) ||
    !vector(camera.target) ||
    !finite(camera.yaw) ||
    !finite(camera.pitch, -Math.PI, Math.PI) ||
    !finite(camera.zoom, 0.001, 10000) ||
    typeof camera.topDown !== 'boolean' ||
    typeof camera.isometric !== 'boolean' ||
    typeof camera.manualLock !== 'boolean' ||
    (camera.orbit !== null &&
      (!record(camera.orbit) ||
        !finite(camera.orbit.yaw) ||
        !finite(camera.orbit.pitch, -Math.PI, Math.PI) ||
        typeof camera.orbit.manualLock !== 'boolean'))
  )
    failure('camera');
  if (scene.selection !== null && !ids.has(scene.selection)) failure('selected creature');
  if (!Array.isArray(scene.rollLog) || scene.rollLog.length > 50) failure('shared roll log');
  for (const entry of scene.rollLog) {
    if (
      !record(entry) ||
      typeof entry.message !== 'string' ||
      entry.message.length > 10000 ||
      typeof entry.type !== 'string' ||
      entry.type.length > 100 ||
      typeof entry.timestamp !== 'string' ||
      entry.timestamp.length > 100 ||
      !Number.isFinite(entry.id)
    )
      failure('shared roll log');
    if (entry.rollResult !== null && entry.rollResult !== undefined)
      copyRollSummary(entry.rollResult);
  }
  restoreCombat(scene.combat, placeholders, library);
  return scene;
}

export function encodeScene(scene, context) {
  validateScene(scene, context);
  const text = JSON.stringify(scene);
  if (text.length > 16000000) throw new Error('The saved campaign scene exceeds 16 MB');
  return text;
}

export function decodeScene(text, context) {
  if (typeof text !== 'string' || text.length > 16000000) failure('scene data size');
  return validateScene(JSON.parse(text), context);
}
