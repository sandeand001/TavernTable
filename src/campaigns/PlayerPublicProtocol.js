import { validateMapBoard, freezeSceneData } from './CampaignScene.js';
import { validateConnections } from './CampaignConnections.js';
import { validateSavedPlacement, samePlacement } from '../scene/token-adapter/SavedPlacements.js';
import { PLAYER_COMMAND_KINDS } from './PlayerCommandProtocol.js';
import { CONSTRUCTION_MATERIALS } from '../config/biome/ConstructionPalettes.js';
import { getTokenCommand } from '../config/TokenCommandConfig.js';

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
const sealedAssets = new WeakSet();

export function sealPlayerAssets(assets) {
  if (sealedAssets.has(assets)) return assets;
  validatePlayerAssets(assets);
  freezeSceneData(assets);
  sealedAssets.add(assets);
  return assets;
}

export function validatePlayerAssets(assets) {
  if (sealedAssets.has(assets)) return assets;
  if (
    !only(assets, ['location', 'maps', 'connections', 'doorPanels']) ||
    !only(assets.location, ['id', 'name']) ||
    !id(assets.location.id) ||
    typeof assets.location.name !== 'string' ||
    !Array.isArray(assets.maps) ||
    !assets.maps.length ||
    assets.maps.length > 256 ||
    !Array.isArray(assets.connections) ||
    (assets.doorPanels !== undefined &&
      (!Array.isArray(assets.doorPanels) || assets.doorPanels.length > 2000))
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
        'floorContext',
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
        'renderStyle',
      ])
    )
      invalid();
    const geometry = map.terrain.geometry;
    if (geometry && (!only(geometry, ['version', 'volumes']) || ![1, 2].includes(geometry.version)))
      invalid('The public geometry version or join data is not supported');
    if (map.terrain.renderStyle !== undefined && map.terrain.renderStyle !== 'cavern') invalid();
    validateMapBoard(map.grid, map.terrain, geometry ? 2 : 1, map.base);
    maps.set(map.id, map);
  }
  for (const map of maps.values())
    if (map.floorContext) {
      const floor = map.floorContext;
      if (
        !only(floor, ['ownerMapId', 'ceilingFeet', 'terrainThicknessFeet', 'floorAppearance']) ||
        map.base !== 'floor' ||
        !id(floor.ownerMapId) ||
        !(floor.ceilingFeet === null || Number.isFinite(floor.ceilingFeet)) ||
        !Number.isFinite(floor.terrainThicknessFeet) ||
        floor.terrainThicknessFeet <= 0 ||
        !(
          floor.floorAppearance === null ||
          (only(floor.floorAppearance, ['floorColor', 'floorMaterial']) &&
            Number.isInteger(floor.floorAppearance.floorColor) &&
            floor.floorAppearance.floorColor >= 0 &&
            floor.floorAppearance.floorColor <= 0xffffff &&
            Object.hasOwn(CONSTRUCTION_MATERIALS, floor.floorAppearance.floorMaterial))
        )
      )
        invalid();
    }
  const doorIds = new Set();
  for (const door of assets.doorPanels || []) {
    if (
      !only(door, ['id', 'mapIds', 'cells']) ||
      !id(door.id) ||
      doorIds.has(door.id) ||
      !Array.isArray(door.mapIds) ||
      door.mapIds.length < 1 ||
      door.mapIds.length > 2 ||
      new Set(door.mapIds).size !== door.mapIds.length ||
      door.mapIds.some((mapId) => !maps.has(mapId)) ||
      !Array.isArray(door.cells) ||
      !door.cells.length ||
      door.cells.length > 256
    )
      invalid('The public door panel is invalid');
    doorIds.add(door.id);
  }
  const obstacles = (assets.doorPanels || []).flatMap((door) => door.cells);
  if (obstacles.length > 10000) invalid('There are too many public door panels');
  for (const obstacle of obstacles) {
    if (
      !only(obstacle, ['min', 'max', 'planes']) ||
      !point(obstacle.min) ||
      !point(obstacle.max) ||
      !['x', 'y', 'z'].every((axis) => obstacle.min[axis] < obstacle.max[axis]) ||
      (obstacle.planes !== undefined &&
        (!Array.isArray(obstacle.planes) ||
          obstacle.planes.length < 4 ||
          obstacle.planes.length > 256))
    )
      invalid('The public sight obstacle is invalid');
    for (const plane of obstacle.planes || [])
      if (
        !only(plane, ['normal', 'distance']) ||
        !point(plane.normal) ||
        Math.hypot(plane.normal.x, plane.normal.y, plane.normal.z) < 1e-10 ||
        !Number.isFinite(plane.distance)
      )
        invalid('The public sight plane is invalid');
  }
  for (const connection of assets.connections)
    if (
      !only(connection, [
        'id',
        'name',
        'kind',
        'enabled',
        'open',
        'locked',
        'ends',
        'pathFeet',
        'feature',
        'outsideMapId',
      ]) ||
      !only(connection.feature, ['mapId', 'volumeIds', 'terrainCells']) ||
      !Array.isArray(connection.ends) ||
      connection.ends.some((end) => !only(end, ['mapId', 'positionFeet']))
    )
      invalid('The public connection contains unsupported authoring data');
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

export function validateBudget(budget) {
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
    !only(motion, ['kind', 'completed', 'from', 'route', 'continuing']) ||
    !['walk', 'fly', 'fall', 'traverse'].includes(motion.kind) ||
    motion.completed !== true ||
    (motion.continuing !== undefined && typeof motion.continuing !== 'boolean') ||
    !Array.isArray(motion.route) ||
    !motion.route.length ||
    motion.route.length > 10000
  )
    invalid('The public completed motion is invalid');
  validatePlayerPlacement(motion.from, maps);
  for (const step of motion.route) validatePlayerPlacement(step, maps);
  return motion;
}

export function validateLivePlayerMotion(motion, maps = null) {
  if (
    !only(motion, ['kind', 'completed', 'from', 'route', 'continuing']) ||
    !['walk', 'fly', 'fall', 'traverse'].includes(motion.kind) ||
    !(
      (motion.completed === false && motion.continuing === true) ||
      (motion.completed === true && motion.continuing !== true)
    ) ||
    !Array.isArray(motion.route) ||
    !motion.route.length ||
    motion.route.length > 10000
  )
    invalid('The public live motion is invalid');
  validatePlayerPlacement(motion.from, maps);
  for (const step of motion.route) validatePlayerPlacement(step, maps);
  return motion;
}

export function validateLivePlayerPresentation(entry, maps = null) {
  if (
    !object(entry) ||
    Object.keys(entry).some(
      (key) => !['commandId', 'tokenId', 'kind', 'motion', 'placement'].includes(key)
    ) ||
    typeof entry.commandId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(entry.commandId) ||
    !id(entry.tokenId)
  )
    invalid('The public live presentation is invalid');
  if (entry.kind === 'move') {
    if (
      Object.hasOwn(entry, 'placement') ||
      !object(entry.motion) ||
      Object.keys(entry).length !== 4
    )
      invalid('The public live movement presentation is invalid');
    validateLivePlayerMotion(entry.motion, maps);
  } else if (entry.kind === 'move-finish') {
    if (
      Object.hasOwn(entry, 'motion') ||
      Object.keys(entry).length !== 4 ||
      !object(entry.placement)
    )
      invalid('The public live movement finish is invalid');
    validatePlayerPlacement(entry.placement, maps);
  } else invalid('The public live presentation kind is invalid');
  return entry;
}

export function scopePlayerReceipt(receipt, state) {
  const maps = new Set(state.maps.map(({ id }) => id));
  const placements = [
    ...(receipt.from ? [receipt.from] : []),
    ...(receipt.motion ? [receipt.motion.from, ...receipt.motion.route] : []),
    ...(receipt.placement ? [receipt.placement] : []),
    ...(receipt.route || []),
  ];
  if (placements.every((placement) => maps.has(placement.mapId))) return structuredClone(receipt);
  const result = structuredClone(receipt);
  delete result.motion;
  delete result.route;
  delete result.placement;
  delete result.from;
  return result;
}

function validatePlayerCommandReceipt(receipt, maps = null, commandId = null) {
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
      'from',
    ]) ||
    !PLAYER_COMMAND_KINDS.includes(receipt.kind) ||
    !id(receipt.tokenId)
  )
    invalid('The public command receipt contains unsupported or private data');
  if (receipt.budget) validateBudget(receipt.budget);
  if (receipt.placement) validatePlayerPlacement(receipt.placement, maps);
  if (receipt.from !== undefined) {
    if (receipt.kind !== 'emote' || receipt.actionId !== 'action-cover') invalid();
    validatePlayerVisual(
      {
        commandId,
        tokenId: receipt.tokenId,
        kind: 'emote',
        actionId: receipt.actionId,
        animationKey: receipt.animationKey,
        from: receipt.from,
        placement: receipt.placement,
      },
      maps
    );
  }
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
  return receipt;
}

function playerCommandResultHeader(result) {
  if (
    !object(result) ||
    result.version !== 1 ||
    typeof result.commandId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(result.commandId) ||
    !['applied', 'duplicate'].includes(result.outcome) ||
    !only(result.applied, ['sceneRevision', 'charactersRevision']) ||
    !revision(result.applied.sceneRevision) ||
    !revision(result.applied.charactersRevision)
  )
    invalid('The public command result is invalid');
}

export function validatePlayerCommandAcknowledgement(result, options = {}) {
  playerCommandResultHeader(result);
  if (
    !only(result, [
      'version',
      'campaignId',
      'actorId',
      'commandId',
      'outcome',
      'applied',
      'receipt',
    ]) ||
    result.outcome !== 'applied' ||
    !id(result.campaignId) ||
    !id(result.actorId)
  )
    invalid('The public command acknowledgement is invalid');
  const maps = options.cachedAssets
    ? new Map(options.cachedAssets.maps.map((map) => [map.id, map]))
    : null;
  validatePlayerCommandReceipt(result.receipt, maps, result.commandId);
  return result;
}

export function validatePlayerCommandResult(result, options = {}) {
  playerCommandResultHeader(result);
  if (!only(result, ['version', 'commandId', 'outcome', 'applied', 'receipt', 'state']))
    invalid('The public command result is invalid');
  validatePlayerState(result.state, options);
  if (
    result.state.sceneRevision < result.applied.sceneRevision ||
    result.state.revision < result.applied.charactersRevision ||
    (result.outcome === 'duplicate' && result.state.publicScene.updates.length)
  )
    invalid('The public command result contains stale or replayed state');
  const receipt = result.receipt;
  const assets = result.state.publicScene.assets || options.cachedAssets;
  const maps = assets ? new Map(assets.maps.map((map) => [map.id, map])) : null;
  validatePlayerCommandReceipt(receipt, maps, result.commandId);
  return result;
}

export function validatePlayerVisual(entry, maps = null) {
  const action = getTokenCommand(entry?.actionId);
  if (
    !only(entry, [
      'commandId',
      'tokenId',
      'kind',
      'sceneRevision',
      'charactersRevision',
      'actionId',
      'animationKey',
      'placement',
      'from',
    ]) ||
    entry.kind !== 'emote' ||
    typeof entry.commandId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,100}$/.test(entry.commandId) ||
    !id(entry.tokenId) ||
    !action ||
    !['emotes', 'actions'].includes(action.group) ||
    (action.animation
      ? action.animation.key !== entry.animationKey
      : !action.choices?.includes(entry.animationKey)) ||
    (entry.sceneRevision !== undefined && !revision(entry.sceneRevision)) ||
    (entry.charactersRevision !== undefined && !revision(entry.charactersRevision))
  )
    invalid('The visual presentation is not a canonical actor action');
  validatePlayerPlacement(entry.placement, maps);
  if (entry.actionId === 'action-cover') {
    validatePlayerPlacement(entry.from, maps);
    if (
      entry.from.mapId !== entry.placement.mapId ||
      entry.from.gridX !== entry.placement.gridX ||
      entry.from.gridY !== entry.placement.gridY ||
      entry.from.pose.kind !== 'ground' ||
      entry.placement.pose.kind !== 'ground' ||
      entry.from.pose.world.y !== entry.placement.pose.world.y
    )
      invalid('An approved Cover must preserve its supported cell and elevation');
  } else if (entry.from !== undefined) invalid();
  return entry;
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
  if (
    state.doors !== undefined &&
    (!Array.isArray(state.doors) ||
      state.doors.length > 2000 ||
      (state.observerTokenId === null && state.doors.length > 0) ||
      new Set(state.doors.map((door) => door?.id)).size !== state.doors.length ||
      state.doors.some(
        (door) =>
          !only(door, ['id', 'name', 'open', 'locked']) ||
          !id(door.id) ||
          typeof door.name !== 'string' ||
          typeof door.open !== 'boolean' ||
          typeof door.locked !== 'boolean' ||
          (door.open && door.locked)
      ))
  )
    invalid('The host returned invalid nearby door controls');
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
    const arrival = state.arrival;
    const grant =
      arrival &&
      state.placementGrants?.find(
        (entry) => entry.id === arrival.grantId && entry.mapId === arrival.mapId
      );
    if (
      arrival &&
      (!only(arrival, ['grantId', 'mapId']) ||
        !grant ||
        typeof snapshot.assetKey !== 'string' ||
        !snapshot.assetKey.length ||
        snapshot.presentation.mapId !== grant.mapId ||
        !maps?.has(grant.mapId) ||
        state.observers?.length ||
        state.gameplay?.ownedTokens?.length)
    )
      invalid('The render-only arrival preview does not match an authorized destination');
    if (
      (!arrival &&
        (snapshot.assets !== null ||
          snapshot.assetKey !== null ||
          snapshot.presentation.mapId !== null)) ||
      snapshot.presentation.focusTokenId !== null ||
      snapshot.actors.length ||
      snapshot.updates.length
    )
      invalid('A no-observer public snapshot cannot grant actor vision');
  } else if (
    state.arrival !== undefined ||
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
    if (update?.kind === 'emote') {
      validatePlayerVisual(update, maps);
      if (
        !actors.has(update.tokenId) ||
        !revision(update.sceneRevision) ||
        update.sceneRevision > state.sceneRevision ||
        !revision(update.charactersRevision) ||
        update.charactersRevision > state.revision ||
        !samePlacement(update.placement, actors.get(update.tokenId))
      )
        invalid('The visual action does not match the currently visible actor');
      continue;
    }
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
        !only(availability, ['allowed', 'code', 'reason', 'costFeet', 'visible']) ||
        typeof availability.allowed !== 'boolean' ||
        (availability.visible !== undefined && typeof availability.visible !== 'boolean') ||
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
