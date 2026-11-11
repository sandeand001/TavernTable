import { validateMapBoard } from './CampaignScene.js';
import { validateConnections } from './CampaignConnections.js';
import { validateSavedPlacement, samePlacement } from '../scene/token-adapter/SavedPlacements.js';
import { PLAYER_COMMAND_KINDS } from './PlayerCommandProtocol.js';

export const PLAYER_PUBLIC_VERSION = 1;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) =>
  object(value) && Object.keys(value).every((key) => keys.includes(key));
const id = (value) =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value) &&
  !value.startsWith('assigned-sheet-');
const revision = (value) => Number.isSafeInteger(value) && value >= 0;
const feet = (value) => Number.isFinite(value) && value >= 0;
const point = (value) =>
  only(value, ['x', 'y', 'z']) && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
const invalid = (message = 'The host returned an invalid public player snapshot') => {
  throw Object.assign(new Error(message), { code: 'invalid-player-state' });
};

export function validatePlayerAssets(assets) {
  if (
    !only(assets, ['location', 'maps', 'connections']) ||
    !only(assets.location, ['id', 'name']) ||
    !id(assets.location.id) ||
    typeof assets.location.name !== 'string' ||
    !Array.isArray(assets.maps) ||
    !assets.maps.length ||
    assets.maps.length > 256 ||
    !Array.isArray(assets.connections)
  )
    invalid();
  const maps = new Map();
  for (const map of assets.maps) {
    if (
      !only(map, [
        'id',
        'name',
        'locationId',
        'originFeet',
        'quarterTurns',
        'base',
        'grid',
        'terrain',
        'building',
      ]) ||
      !id(map.id) ||
      maps.has(map.id) ||
      map.locationId !== assets.location.id ||
      typeof map.name !== 'string' ||
      !point(map.originFeet) ||
      ![0, 1, 2, 3].includes(map.quarterTurns) ||
      !['ground', 'floor'].includes(map.base) ||
      !only(map.terrain, [
        'heights',
        'biome',
        'seed',
        'elevationScale',
        'worldElevationUnit',
        'treeDensity',
        'richShading',
        'sightBounds',
        'coverBounds',
        'structureGenerationEnabled',
        'geometry',
        'placeables',
      ])
    )
      invalid();
    const geometry = map.terrain.geometry;
    if (
      geometry &&
      (!only(geometry, ['version', 'structures', 'volumes']) ||
        ![1, 2, 3].includes(geometry.version))
    )
      invalid('The public geometry version or join data is not supported');
    validateMapBoard(map.grid, map.terrain, geometry ? 2 : 1, map.base);
    maps.set(map.id, map);
  }
  for (const map of maps.values())
    if (map.building) {
      const floor = map.building;
      if (
        !only(floor, [
          'ownerMapId',
          'structureId',
          'floor',
          'offsetX',
          'offsetZ',
          'lengthFeet',
          'widthFeet',
          'roomHeightFeet',
        ]) ||
        !maps.has(floor.ownerMapId) ||
        !id(floor.structureId) ||
        !Number.isInteger(floor.floor) ||
        !['offsetX', 'offsetZ', 'lengthFeet', 'widthFeet'].every((field) =>
          Number.isFinite(floor[field])
        ) ||
        (floor.roomHeightFeet !== null && !feet(floor.roomHeightFeet))
      )
        invalid();
      const owner = maps.get(floor.ownerMapId);
      if (
        !owner.terrain.geometry?.structures?.some((structure) => structure.id === floor.structureId)
      )
        invalid('The public floor owner is missing');
    }
  validateConnections(assets.connections, assets.maps);
  return assets;
}

export function validatePlayerPlacement(placement, maps = null) {
  if (
    !only(placement, ['mapId', 'gridX', 'gridY', 'facingAngle', 'pose']) ||
    !id(placement.mapId) ||
    !revision(placement.gridX) ||
    !revision(placement.gridY)
  )
    invalid();
  validateSavedPlacement(placement);
  if (maps) {
    const map = maps.get(placement.mapId);
    if (!map || placement.gridX >= map.grid.cols || placement.gridY >= map.grid.rows)
      invalid('The public actor placement is outside its authorized map');
  }
  return placement;
}

function validateBudget(budget) {
  if (
    !only(budget, [
      'movementSpentFeet',
      'movementRemainingFeet',
      'movementAllowanceFeet',
      'actions',
      'bonusActions',
      'reactions',
      'attacksRemaining',
    ]) ||
    !['movementSpentFeet', 'movementRemainingFeet', 'movementAllowanceFeet'].every((key) =>
      feet(budget[key])
    ) ||
    Object.entries(budget).some(([key, value]) => !key.startsWith('movement') && !revision(value))
  )
    invalid('The public command budget is invalid');
}

export function validatePlayerMotion(motion, maps = null) {
  if (
    !only(motion, ['kind', 'completed', 'from', 'route']) ||
    !['walk', 'fly', 'fall', 'traverse'].includes(motion.kind) ||
    motion.completed !== true ||
    !Array.isArray(motion.route) ||
    !motion.route.length ||
    motion.route.length > 10000
  )
    invalid('The public completed motion is invalid');
  validatePlayerPlacement(motion.from, maps);
  for (const step of motion.route) validatePlayerPlacement(step, maps);
  return motion;
}

export function validatePlayerCommandResult(result, options = {}) {
  if (
    !only(result, ['version', 'commandId', 'outcome', 'applied', 'receipt', 'state']) ||
    result.version !== 1 ||
    typeof result.commandId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(result.commandId) ||
    !['applied', 'duplicate'].includes(result.outcome) ||
    !only(result.applied, ['sceneRevision', 'charactersRevision']) ||
    !revision(result.applied.sceneRevision) ||
    !revision(result.applied.charactersRevision)
  )
    invalid('The public command result is invalid');
  validatePlayerState(result.state, options);
  if (
    result.state.sceneRevision < result.applied.sceneRevision ||
    result.state.revision < result.applied.charactersRevision ||
    (result.outcome === 'duplicate' && result.state.publicScene.updates.length)
  )
    invalid('The public command result contains stale or replayed state');
  const receipt = result.receipt;
  if (
    !only(receipt, [
      'kind',
      'tokenId',
      'costFeet',
      'budget',
      'placement',
      'route',
      'motion',
      'fall',
      'distanceFeet',
      'result',
      'actionId',
      'cost',
      'sequence',
      'roll',
      'rolls',
      'rerollRequired',
      'characterId',
      'facingAngle',
      'movement',
      'animationKey',
    ]) ||
    !PLAYER_COMMAND_KINDS.includes(receipt.kind) ||
    !id(receipt.tokenId)
  )
    invalid('The public command receipt contains unsupported or private data');
  const assets = result.state.publicScene.assets || options.cachedAssets;
  const maps = assets ? new Map(assets.maps.map((map) => [map.id, map])) : null;
  if (receipt.budget) validateBudget(receipt.budget);
  if (receipt.placement) validatePlayerPlacement(receipt.placement, maps);
  if (receipt.motion) {
    validatePlayerMotion(receipt.motion, maps);
    if (
      !feet(receipt.costFeet) ||
      !receipt.budget ||
      JSON.stringify(receipt.route) !== JSON.stringify(receipt.motion.route) ||
      JSON.stringify(receipt.placement) !== JSON.stringify(receipt.route.at(-1))
    )
      invalid('The approved route, destination, cost and motion do not agree');
  }
  return result;
}

export function validatePlayerState(state, { cachedAssets = null } = {}) {
  if (
    !object(state) ||
    state.scene !== null ||
    !revision(state.sceneRevision) ||
    !revision(state.revision) ||
    !object(state.campaign) ||
    !id(state.campaign.id) ||
    !['2014', '2024'].includes(state.campaign.ruleset) ||
    !(state.observerTokenId === null || id(state.observerTokenId))
  )
    invalid();
  const snapshot = state.publicScene;
  if (
    !only(snapshot, ['version', 'assetKey', 'assets', 'presentation', 'actors', 'updates']) ||
    snapshot.version !== PLAYER_PUBLIC_VERSION ||
    !only(snapshot.presentation, ['mapId', 'focusTokenId']) ||
    !Array.isArray(snapshot.actors) ||
    !Array.isArray(snapshot.updates)
  )
    invalid('The public player snapshot contains unsupported or private restore data');
  const assets = snapshot.assets || cachedAssets;
  const maps = assets
    ? new Map(validatePlayerAssets(assets).maps.map((map) => [map.id, map]))
    : null;
  if (state.observerTokenId === null) {
    if (
      snapshot.assets !== null ||
      snapshot.assetKey !== null ||
      snapshot.presentation.mapId !== null ||
      snapshot.presentation.focusTokenId !== null ||
      snapshot.actors.length ||
      snapshot.updates.length
    )
      invalid('A no-observer public snapshot cannot grant actor vision');
  } else if (
    typeof snapshot.assetKey !== 'string' ||
    !snapshot.assetKey.length ||
    !id(snapshot.presentation.mapId) ||
    snapshot.presentation.focusTokenId !== state.observerTokenId ||
    (maps && !maps.has(snapshot.presentation.mapId))
  )
    invalid();
  const actors = new Map();
  for (const actor of snapshot.actors) {
    if (
      !only(actor, [
        'id',
        'name',
        'type',
        'mapId',
        'gridX',
        'gridY',
        'pose',
        'facingAngle',
        'owned',
        'characterId',
        'portraitImage',
        'movement',
        'flags',
        'visualCommand',
      ]) ||
      !id(actor.id) ||
      actors.has(actor.id) ||
      typeof actor.name !== 'string' ||
      typeof actor.type !== 'string' ||
      typeof actor.owned !== 'boolean' ||
      (actor.owned ? !id(actor.characterId) : actor.characterId !== null) ||
      !(actor.portraitImage === null || typeof actor.portraitImage === 'string') ||
      !only(actor.movement, ['mode', 'type']) ||
      !['walk', 'run'].includes(actor.movement.mode) ||
      !['default', 'drunk'].includes(actor.movement.type) ||
      !only(actor.flags, ['prone', 'flightActive']) ||
      typeof actor.flags.prone !== 'boolean' ||
      typeof actor.flags.flightActive !== 'boolean'
    )
      invalid();
    validatePlayerPlacement(
      {
        mapId: actor.mapId,
        gridX: actor.gridX,
        gridY: actor.gridY,
        facingAngle: actor.facingAngle,
        pose: actor.pose,
      },
      maps
    );
    actors.set(actor.id, actor);
  }
  if (state.observerTokenId !== null && !actors.get(state.observerTokenId)?.owned)
    invalid('The public observer must be an owned real actor');
  for (const update of snapshot.updates) {
    if (
      !only(update, [
        'commandId',
        'tokenId',
        'kind',
        'sceneRevision',
        'charactersRevision',
        'costFeet',
        'budget',
        'motion',
      ]) ||
      typeof update.commandId !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(update.commandId) ||
      !actors.has(update.tokenId) ||
      !PLAYER_COMMAND_KINDS.includes(update.kind) ||
      !revision(update.sceneRevision) ||
      update.sceneRevision > state.sceneRevision ||
      !revision(update.charactersRevision) ||
      update.charactersRevision > state.revision ||
      (update.costFeet !== undefined &&
        (!actors.get(update.tokenId).owned || !feet(update.costFeet))) ||
      (update.budget !== undefined && !actors.get(update.tokenId).owned)
    )
      invalid('The public update is not an authorized visible motion');
    if (update.budget !== undefined) validateBudget(update.budget);
    validatePlayerMotion(update.motion, maps);
    if (!samePlacement(update.motion.route.at(-1), actors.get(update.tokenId)))
      invalid('The public motion does not end at the current authorized actor placement');
  }
  const gameplay = state.gameplay;
  if (
    !only(gameplay, ['version', 'commands', 'ownedTokens', 'turn']) ||
    gameplay.version !== 1 ||
    !Array.isArray(gameplay.commands) ||
    gameplay.commands.some((kind) => !PLAYER_COMMAND_KINDS.includes(kind)) ||
    !Array.isArray(gameplay.ownedTokens)
  )
    invalid();
  const seen = new Set();
  for (const token of gameplay.ownedTokens) {
    if (
      !only(token, [
        'tokenId',
        'mapId',
        'availability',
        'economy',
        'availableActions',
        'canUndo',
        'movement',
      ]) ||
      !id(token.tokenId) ||
      seen.has(token.tokenId) ||
      !id(token.mapId) ||
      !object(token.availability) ||
      !object(token.economy) ||
      !Array.isArray(token.availableActions) ||
      typeof token.canUndo !== 'boolean' ||
      !only(token.movement, ['spentFeet', 'remainingFeet', 'allowanceFeet']) ||
      !Object.values(token.movement).every(feet)
    )
      invalid();
    for (const availability of Object.values(token.availability)) {
      if (
        !only(availability, ['allowed', 'code', 'reason', 'costFeet']) ||
        typeof availability.allowed !== 'boolean' ||
        typeof availability.code !== 'string' ||
        !/^[a-z][a-z-]*$/.test(availability.code) ||
        (availability.reason !== undefined &&
          availability.reason !== null &&
          typeof availability.reason !== 'string') ||
        (availability.costFeet !== undefined && !feet(availability.costFeet))
      )
        invalid();
    }
    seen.add(token.tokenId);
  }
  if (
    gameplay.turn !== null &&
    (!only(gameplay.turn, ['active', 'number', 'tokenId']) ||
      gameplay.turn.active !== true ||
      !revision(gameplay.turn.number) ||
      !(gameplay.turn.tokenId === null || seen.has(gameplay.turn.tokenId)))
  )
    invalid();
  return state;
}

export function emptyPlayerScene() {
  return {
    version: PLAYER_PUBLIC_VERSION,
    assetKey: null,
    assets: null,
    presentation: { mapId: null, focusTokenId: null },
    actors: [],
    updates: [],
  };
}
