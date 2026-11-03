import { getCharacterDefinition } from '../config/CharacterCatalog.js';
import { restoreCombat } from '../entities/characters/combat/persistence.js';
import { copyRollSummary } from '../systems/dice/rollSummary.js';
import { GRID_CONFIG } from '../config/GameConstants.js';
import { validateSavedPlacement } from '../scene/token-adapter/SavedPlacements.js';
import { validateMovementEffects } from '../rules/falling.js';
import { TerrainGeometry } from '../terrain/TerrainGeometry.js';
import { validateConnections } from './CampaignConnections.js';
import { isOpeningHoldValid } from './CampaignOpeningClimb.js';
import { isSurfaceGripValid } from './CampaignSurfaceClimb.js';
import {
  TARGET_ALLEGIANCES,
  TARGET_CREATURE_TYPES,
  TARGET_CREATURE_SIZES,
} from '../config/targeting/SpellProfiles.js';

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

function validateCamera(camera) {
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
}

function validateBoard(grid, terrain, version, base = 'ground') {
  if (
    !record(grid) ||
    !integer(grid.cols, GRID_CONFIG.MIN_COLS, GRID_CONFIG.MAX_COLS) ||
    !integer(grid.rows, GRID_CONFIG.MIN_ROWS, GRID_CONFIG.MAX_ROWS) ||
    !finite(grid.tileWorldSize, 0.001, 1000)
  )
    failure('grid dimensions');
  const inside = (x, y) => integer(x, 0, grid.cols - 1) && integer(y, 0, grid.rows - 1);
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
  let geometry = null;
  const feetPerWorld = 5 / grid.tileWorldSize;
  if (terrain.geometry !== undefined || base === 'floor') {
    if (terrain.geometry !== undefined && version !== 2) failure('geometry version');
    if (terrain.geometry === undefined && version === 2) failure('map geometry');
    geometry = new TerrainGeometry({
      widthFeet: grid.cols * 5,
      depthFeet: grid.rows * 5,
      terrainThicknessFeet: base === 'floor' ? 0.5 : null,
      getTerrainHeightFeet: (x, z) =>
        terrain.heights[Math.floor(z / 5)][Math.floor(x / 5)] *
        terrain.worldElevationUnit *
        feetPerWorld,
    });
    if (terrain.geometry !== undefined) geometry.load(terrain.geometry);
  } else if (version === 2) failure('map geometry');
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
  if (
    terrain.coverBounds !== undefined &&
    (!Array.isArray(terrain.coverBounds) ||
      terrain.coverBounds.length > 50000 ||
      terrain.coverBounds.some(
        (bounds) =>
          !record(bounds) ||
          !vector(bounds.min) ||
          !vector(bounds.max) ||
          ['x', 'y', 'z'].some((axis) => bounds.min[axis] > bounds.max[axis])
      ))
  )
    failure('structure cover bounds');
  return { grid, terrain, inside, geometry, feetPerWorld };
}

export { validateBoard as validateMapBoard };

export function validateScene(scene, { ruleset, library }) {
  if (!record(scene) || ![1, 2, 3].includes(scene.version) || scene.ruleset !== ruleset)
    failure('version or ruleset');
  const boards = new Map();
  let legacyBoard = null;
  if (scene.version === 3) {
    if (!Array.isArray(scene.maps) || !scene.maps.length || scene.maps.length > 128)
      failure('map collection');
    for (const map of scene.maps) {
      if (
        !record(map) ||
        !identifier(map.id) ||
        boards.has(map.id) ||
        !name(map.name) ||
        !vector(map.originFeet) ||
        !integer(map.quarterTurns, 0, 3) ||
        !['ground', 'floor'].includes(map.base)
      )
        failure('map identity or physical anchor');
      boards.set(
        map.id,
        validateBoard(map.grid, map.terrain, map.terrain?.geometry ? 2 : 1, map.base)
      );
      if (
        map.terrain.placeables.some((entry) => ['structure', 'building'].includes(entry.type)) &&
        !map.terrain.coverBounds?.length
      )
        failure('map structure cover; load and capture the original board before migration');
    }
    if (!record(scene.view) || !boards.has(scene.view.mapId)) failure('participant map view');
    validateConnections(scene.connections, scene.maps);
  } else {
    legacyBoard = validateBoard(scene.grid, scene.terrain, scene.version);
  }
  if (!Array.isArray(scene.creatures) || scene.creatures.length > 2000) failure('creature list');
  const ids = new Set();
  const placeholders = [];
  for (const creature of scene.creatures) {
    const board = legacyBoard || boards.get(creature?.mapId);
    if (!board) failure('creature map reference');
    const { grid, inside, terrain, geometry, feetPerWorld } = board;
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
      (creature.allegiance !== undefined && !TARGET_ALLEGIANCES.includes(creature.allegiance)) ||
      (creature.creatureType !== undefined &&
        !TARGET_CREATURE_TYPES.includes(creature.creatureType)) ||
      (creature.creatureSize !== undefined &&
        !TARGET_CREATURE_SIZES.includes(creature.creatureSize)) ||
      !['walk', 'run'].includes(creature.movement.mode) ||
      !['default', 'drunk'].includes(creature.movement.type) ||
      (creature.characterId === null && !finite(creature.movement.speed, 0, 1000)) ||
      !record(creature.pose) ||
      !['ground', 'wall', 'flight', 'ledge', 'grip'].includes(creature.pose.kind) ||
      !vector(creature.pose.world)
    )
      failure('creature identity or position');
    validateSavedPlacement(creature);
    if (
      creature.pose.kind === 'ledge' &&
      (scene.version !== 3 ||
        !isOpeningHoldValid(
          scene.maps,
          scene.connections || [],
          creature,
          (id) => boards.get(id)?.geometry
        ))
    )
      failure('physical opening/ledge attachment');
    if (
      scene.version === 3 &&
      creature.pose.kind !== 'wall' &&
      (Math.floor(creature.pose.world.x / grid.tileWorldSize) !== creature.gridX ||
        Math.floor(creature.pose.world.z / grid.tileWorldSize) !== creature.gridY)
    )
      failure('creature local grid position');
    if (
      creature.pose.kind === 'grip' &&
      (scene.version !== 3 ||
        !isSurfaceGripValid(scene.maps, creature, (id) => boards.get(id)?.geometry))
    )
      failure('physical wall grip attachment');
    if (
      scene.version === 3 &&
      creature.pose.kind === 'ground' &&
      !geometry &&
      Math.abs(
        creature.pose.world.y -
          terrain.heights[creature.gridY][creature.gridX] * terrain.worldElevationUnit
      ) > 1e-4
    )
      failure('creature floor support');
    if (creature.fallTraits !== undefined) {
      validateMovementEffects({ fallTraits: creature.fallTraits });
    }
    if (
      creature.pose.kind === 'flight' &&
      !geometry &&
      creature.pose.world.y <=
        terrain.heights[creature.gridY][creature.gridX] * terrain.worldElevationUnit + 1e-7
    ) {
      failure('flight altitude');
    }
    if (geometry) {
      const { world } = creature.pose;
      const x = world.x * feetPerWorld,
        z = world.z * feetPerWorld;
      const y = world.y * feetPerWorld;
      if (creature.pose.kind === 'ground') {
        const support = geometry.findSupport(x, z, {
          belowFeet: y + 1e-5,
          clearanceFeet: 5,
          surfaceId: creature.pose.surfaceId ?? null,
        });
        if (!support || Math.abs(support.heightFeet - y) > 1e-4) failure('creature floor support');
      } else if (creature.pose.kind === 'flight') {
        const inset = 1e-5;
        if (
          !geometry.isSpaceClear({
            min: { x: creature.gridX * 5 + inset, y, z: creature.gridY * 5 + inset },
            max: {
              x: (creature.gridX + 1) * 5 - inset,
              y: y + 5,
              z: (creature.gridY + 1) * 5 - inset,
            },
          })
        )
          failure('flight clearance');
      }
    }
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
    placeholders.push({
      id: creature.id,
      characterSheetId: creature.characterId,
      ...(creature.pose.kind === 'flight' ? { flightActive: true } : {}),
    });
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
  const camera = scene.version === 3 ? scene.view.camera : scene.camera;
  validateCamera(camera);
  if (scene.version === 3 && scene.view.cameras !== undefined) {
    if (!Array.isArray(scene.view.cameras) || scene.view.cameras.length > boards.size)
      failure('map camera history');
    const cameras = new Set();
    for (const entry of scene.view.cameras) {
      if (!record(entry) || !boards.has(entry.mapId) || cameras.has(entry.mapId))
        failure('map camera references');
      cameras.add(entry.mapId);
      validateCamera(entry.camera);
    }
  }
  const selection = scene.version === 3 ? scene.view.focusTokenId : scene.selection;
  if (selection !== null && !ids.has(selection)) failure('selected creature');
  if (
    scene.version === 3 &&
    selection !== null &&
    scene.creatures.find((creature) => creature.id === selection).mapId !== scene.view.mapId
  )
    failure('focused creature map');
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
