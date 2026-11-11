import { getTokenMovementSettings } from '../../entities/creatures/TokenMovement.js';
import { TOKEN_WORLD_LOCK_PROP } from '../../config/token-adapter/MannequinConfig.js';
import { validGripReference, isSurfaceGripValid } from '../../campaigns/CampaignSurfaceClimb.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
const invalidPlacement = (message) =>
  Object.assign(new Error(message), { code: 'invalid-saved-placement' });
const VECTOR_KEYS = [
  'low',
  'high',
  'foot',
  'ledge',
  'mantleStart',
  'recover',
  'stageStart',
  'stageTarget',
];
const NUMBER_KEYS = [
  'wallDuration',
  'wallHeight',
  'mantleDuration',
  'recoverDuration',
  'cursorY',
  'startY',
  'targetY',
  'entryCost',
  'costPerWorldUnit',
  'direction',
  'loopDirection',
  'loopClock',
  'loopOriginY',
  'stageTime',
];

export class SceneNotReadyError extends Error {}

export function campaignLandingForSupport(world, token, support) {
  if (!world || !support || support.mapId === token.mapId) return null;
  const map = world.getMap(support.mapId),
    source = world.getMap(token.mapId);
  return {
    mapId: support.mapId,
    placement: {
      gridX: Math.floor(support.world.x / map.grid.tileWorldSize),
      gridY: Math.floor(support.world.z / map.grid.tileWorldSize),
      facingAngle: token.facingAngle + ((map.quarterTurns - source.quarterTurns) * Math.PI) / 2,
      pose: { kind: 'ground', world: support.world, surfaceId: support.surfaceId },
    },
  };
}

export function validateSavedPlacement(placement) {
  const pose = placement?.pose;
  const finiteVector = (vector) =>
    vector && ['x', 'y', 'z'].every((axis) => Number.isFinite(vector[axis]));
  if (
    !finiteVector(pose?.world) ||
    !Number.isFinite(placement.facingAngle) ||
    !['ground', 'wall', 'flight', 'ledge', 'grip'].includes(pose.kind)
  )
    throw invalidPlacement('The saved creature placement is invalid');
  if (pose.kind === 'grip' && !validGripReference(pose.grip))
    throw invalidPlacement('The saved physical wall grip is invalid');
  if (
    pose.kind === 'ledge' &&
    (typeof pose.openingId !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(pose.openingId))
  )
    throw invalidPlacement('The saved opening ledge reference is invalid');
  if (pose.kind === 'wall') {
    const saved = pose.wall;
    if (
      !saved ||
      VECTOR_KEYS.slice(0, 6).some((key) => !finiteVector(saved[key])) ||
      VECTOR_KEYS.some((key) => saved[key] && !finiteVector(saved[key])) ||
      NUMBER_KEYS.some((key) => !Number.isFinite(saved[key])) ||
      saved.wallDuration <= 0 ||
      saved.wallHeight <= 0 ||
      saved.loopClock < 0 ||
      saved.holding !== true ||
      saved.stage !== 'surface' ||
      saved.destination !== 'hold' ||
      !['climbWall', 'climbWallDown'].includes(saved.loopClip) ||
      !['climbWall', 'climbWallDown', 'ledgeHang'].includes(saved.clip)
    ) {
      throw invalidPlacement('The saved stable wall/ledge placement is invalid');
    }
  }
}

export function samePlacement(left, right) {
  const a = left?.pose?.world || left?.world;
  const b = right?.pose?.world || right?.world;
  return Boolean(
    a &&
      b &&
      left.mapId === right.mapId &&
      left.gridX === right.gridX &&
      left.gridY === right.gridY &&
      (!left.pose || !right.pose || left.pose.kind === right.pose.kind) &&
      ['x', 'y', 'z'].every((axis) => Math.abs(a[axis] - b[axis]) < 1e-6)
  );
}

export function sceneActorPlacement(scene, actor) {
  return {
    mapId: scene.version === 3 ? actor.mapId : 'map-main',
    gridX: actor.gridX,
    gridY: actor.gridY,
    facingAngle: actor.facingAngle,
    pose: actor.pose,
  };
}

export function coalesceMovementPresentations(presentations) {
  const unique = new Map(
    presentations.map((entry) => [
      `${entry.sceneRevision}:${entry.tokenId}:${entry.commandId}`,
      entry,
    ])
  );
  const actors = new Map();
  for (const entry of [...unique.values()].sort((a, b) => a.sceneRevision - b.sceneRevision)) {
    const previous = actors.get(entry.tokenId);
    if (
      previous &&
      previous.motion.kind === entry.motion.kind &&
      previous.motion.route.length + entry.motion.route.length <= 10000 &&
      samePlacement(previous.motion.route.at(-1), entry.motion.from)
    ) {
      const combined = {
        ...entry,
        motion: {
          ...entry.motion,
          from: previous.motion.from,
          route: [...previous.motion.route, ...entry.motion.route],
        },
      };
      if (previous.costFeet !== undefined && entry.costFeet !== undefined)
        combined.costFeet = previous.costFeet + entry.costFeet;
      else delete combined.costFeet;
      actors.set(entry.tokenId, combined);
    } else actors.set(entry.tokenId, entry);
  }
  return [...actors.values()];
}

function currentPlacement(adapter, token) {
  const state = adapter._movementStates.get(token);
  const motion = state?.wallMotion;
  const world = adapter._resolveTokenWorldPosition(token);
  if (!world || ![world.x, world.y, world.z].every(Number.isFinite)) {
    throw new Error('Creature position is not available for saving');
  }
  const placement = {
    gridX: token.gridX,
    gridY: token.gridY,
    facingAngle: token.facingAngle ?? 0,
    pose: { kind: token.flightActive ? 'flight' : 'ground', world: { ...world } },
  };
  if (
    !motion?.holding &&
    (adapter.gameManager.campaignWorld || adapter.gameManager.terrainEngine?.geometry.hasVolumes)
  ) {
    const gm = adapter.gameManager;
    const tileWorldSize =
      gm.campaignWorld && token.mapId !== gm.campaignMapId
        ? gm.campaignWorld.getMap(token.mapId).grid.tileWorldSize
        : gm.spatial.tileWorldSize;
    if (!Number.isFinite(tileWorldSize) || tileWorldSize <= 0)
      throw new Error('Creature placement requires a valid physical grid scale');
    placement.gridX = Math.floor(world.x / tileWorldSize);
    placement.gridY = Math.floor(world.z / tileWorldSize);
  }
  if (token.surfaceHold) {
    placement.pose = { kind: 'grip', world: { ...world }, grip: clone(token.surfaceHold) };
    return placement;
  }
  if (token.openingHold) {
    placement.pose = {
      kind: 'ledge',
      world: { ...world },
      openingId: token.openingHold.openingId,
    };
    return placement;
  }
  if (
    !token.flightActive &&
    !motion?.holding &&
    adapter.gameManager.terrainEngine?.geometry.hasVolumes
  ) {
    const scale = 5 / adapter.gameManager.spatial.tileWorldSize;
    const support = adapter.gameManager.terrainEngine.geometry.findSupport(
      world.x * scale,
      world.z * scale,
      { belowFeet: world.y * scale + 1e-5, clearanceFeet: 5 }
    );
    if (!support || Math.abs(support.heightFeet - world.y * scale) > 1e-4) {
      throw new SceneNotReadyError('Waiting for the creature to reach a supported floor');
    }
    placement.pose.surfaceId = support.id;
  }
  if (motion?.holding) {
    const wall = {
      face: { id: motion.face.id, low: { ...motion.face.low }, high: { ...motion.face.high } },
      loopClip: motion.loopClip,
      clip: motion.clip,
      holding: true,
      destination: 'hold',
      stage: 'surface',
    };
    for (const key of VECTOR_KEYS) if (motion[key]) wall[key] = { ...motion[key] };
    for (const key of NUMBER_KEYS) wall[key] = motion[key];
    placement.pose = { kind: 'wall', world: { ...world }, wall };
  }
  return placement;
}

function checkpointCost(adapter, token, placement) {
  const job = adapter._movementRoutes.get(token);
  if (!job) return { job: null, spent: 0 };
  if (job.segmentCharged) return { job, spent: job.spent };
  if (adapter._movementStates.get(token)?.phase === 'fall-resolve') {
    return { job, spent: adapter._getFallMovementCost(job) };
  }
  if (placement.pose.kind === 'wall') return { job, spent: job.spent + (job.segmentCost || 0) };
  const start = job.segmentStartWorld;
  const cell = job.current;
  if (!start || !cell || cell.kind === 'wall') return { job, spent: job.spent };
  const target =
    cell.world ||
    adapter.gameManager.spatial.gridToWorld(cell.gridX + 0.5, cell.gridY + 0.5, cell.height);
  const distance = Math.hypot(target.x - start.x, target.y - start.y, target.z - start.z);
  const world = placement.pose.world;
  const travelled = Math.hypot(world.x - start.x, world.y - start.y, world.z - start.z);
  const ratio = distance > 1e-8 ? Math.min(1, travelled / distance) : 1;
  return { job, spent: job.spent + (job.segmentCost || 0) * ratio };
}

function recordStablePlacement(token) {
  const state = this._movementStates.get(token);
  if (
    this._isManualMotionInProgress(token) ||
    (state?.wallMotion && !state.wallMotion.holding) ||
    (state &&
      !['idle', 'walk', 'start', 'stop', 'climb-hold'].includes(state.phase) &&
      !(state.phase === 'fall-resolve' && state.stepFinalized))
  )
    return false;
  const placement = currentPlacement(this, token);
  this._savedPlacements ||= new Map();
  const previous = this._savedPlacements.get(token);
  const checkpoint = {
    mapId: token.mapId ?? this.gameManager.campaignMapId ?? 'map-main',
    placement,
    ...checkpointCost(this, token, placement),
  };
  this._savedPlacements.set(token, checkpoint);
  recordSharedPlacement(this, token, previous, checkpoint);
  if (
    !previous ||
    JSON.stringify(previous.placement) !== JSON.stringify(placement) ||
    previous.spent !== checkpoint.spent
  )
    this.gameManager.sceneAutosave?.changed('movement checkpoint');
  return true;
}

function recordSharedPlacement(adapter, token, previous, checkpoint) {
  const autosave = adapter.gameManager.sceneAutosave;
  if (
    !previous ||
    !autosave?.ready ||
    autosave.library?.store?.storageInfo?.kind !== 'host' ||
    adapter.gameManager.campaignViewBusy ||
    adapter._approvedMovements?.has(token)
  )
    return;
  const from = {
    mapId: previous.mapId ?? checkpoint.mapId,
    ...clone(previous.placement),
  };
  const next = { mapId: checkpoint.mapId, ...clone(checkpoint.placement) };
  if (samePlacement(from, next)) return;
  adapter._sharedMovementPresentations ??= new Map();
  let pending = adapter._sharedMovementPresentations.get(token);
  if (!pending) {
    pending = {
      commandId: globalThis.crypto.randomUUID(),
      tokenId: token.id,
      kind: 'move',
      motion: { kind: 'walk', completed: true, from, route: [] },
    };
    adapter._sharedMovementPresentations.set(token, pending);
  }
  pending.motion.route.push(next);
  if (from.pose.kind === 'flight' || next.pose.kind === 'flight') pending.motion.kind = 'fly';
  if (
    from.mapId !== next.mapId ||
    [from.pose.kind, next.pose.kind].some((kind) => ['wall', 'ledge', 'grip'].includes(kind))
  )
    pending.motion.kind = 'traverse';
  if (adapter._movementStates.get(token)?.phase === 'fall-resolve') pending.motion.kind = 'fall';
}

function getSharedPresentations(scene) {
  const result = [];
  for (const [token, pending] of this._sharedMovementPresentations || []) {
    const actor = scene.creatures.find(({ id }) => id === token.id);
    if (!actor) {
      this._sharedMovementPresentations.delete(token);
      continue;
    }
    const placement = clone(sceneActorPlacement(scene, actor));
    const index = pending.motion.route.findLastIndex((point) => samePlacement(point, placement));
    if (index < 0) continue;
    const captured = clone(pending);
    captured.motion.route = captured.motion.route.slice(0, index + 1);
    captured.motion.route[index] = placement;
    result.push(captured);
  }
  return result;
}

function acknowledgeSharedPresentations(presentations = []) {
  for (const [token, pending] of this._sharedMovementPresentations || []) {
    const captured = presentations.find(({ commandId }) => commandId === pending.commandId);
    if (!captured) continue;
    pending.motion.route = pending.motion.route.slice(captured.motion.route.length);
    if (!pending.motion.route.length) this._sharedMovementPresentations.delete(token);
    else {
      pending.commandId = globalThis.crypto.randomUUID();
      pending.motion.from = clone(captured.motion.route.at(-1));
    }
  }
}

function flightGround(adapter, token, world) {
  const gm = adapter.gameManager;
  if (gm.campaignWorld) {
    const support = gm.campaignWorld.findSupportBelow(
      gm.campaignWorld.toCampaignPosition(token.mapId, world),
      { mapId: gm.campaignMapId, geometry: gm.terrainEngine.geometry }
    );
    return support ? gm.campaignWorld.toMapPosition(token.mapId, support.positionFeet).y : null;
  }
  const geometry = gm.terrainEngine?.geometry;
  const scale = 5 / gm.spatial.tileWorldSize;
  if (geometry?.hasVolumes)
    return (
      geometry.findSupport(world.x * scale, world.z * scale, {
        belowFeet: world.y * scale,
      })?.heightFeet / scale
    );
  return gm.getTerrainHeight(token.gridX, token.gridY) * gm.spatial.elevationUnit;
}

function getStablePlacement(token) {
  this._savedPlacements ||= new Map();
  const gm = this.gameManager;
  if (gm.campaignWorld && token.mapId !== gm.campaignMapId) {
    const placement = this._savedPlacements.get(token)?.placement;
    if (!placement)
      throw new SceneNotReadyError('Waiting for the creature checkpoint on its own grid');
    if (placement.pose.kind === 'grip') {
      assertSurfaceGrip(this, token, placement);
    } else if (placement.pose.kind === 'ledge') {
      if (
        !gm.campaignWorld.isOpeningHoldValid(
          token.mapId,
          placement.pose.world,
          placement.pose.openingId,
          {
            mapId: gm.campaignMapId,
            geometry: gm.terrainEngine.geometry,
          }
        )
      )
        throw new SceneNotReadyError('Waiting for a valid physical opening hold');
    } else if (placement.pose.kind === 'wall') {
      const map = gm.campaignWorld.getMap(token.mapId);
      if (
        [placement.pose.wall.face.low, placement.pose.wall.face.high].some(
          (cell) => Math.abs(map.terrain.heights[cell.gridY][cell.gridX] - cell.height) > 1e-6
        )
      )
        throw new SceneNotReadyError('Waiting for safe wall support on the creature grid');
    } else if (placement.pose.kind === 'flight') {
      const ground = flightGround(this, token, placement.pose.world);
      if (!Number.isFinite(ground) || placement.pose.world.y <= ground + 1e-7)
        throw new SceneNotReadyError('Waiting for clear air above physical campaign support');
    } else {
      const support = gm.campaignWorld.findLocalSupport(token.mapId, placement.pose.world, {
        surfaceId: placement.pose.surfaceId ?? null,
        clearanceFeet: 5,
      });
      if (!support || Math.abs(support.heightWorld - placement.pose.world.y) > 1e-4)
        throw new SceneNotReadyError('Waiting for safe support on the creature grid');
    }
    return clone(placement);
  }
  if (!this.isMovementInProgress(token)) recordStablePlacement.call(this, token);
  const saved = this._savedPlacements.get(token);
  if (!saved)
    throw new SceneNotReadyError('Waiting for a completed creature movement step before saving');
  if (saved.placement.pose.kind === 'grip') {
    assertSurfaceGrip(this, token, saved.placement);
  } else if (saved.placement.pose.kind === 'ledge') {
    if (
      !gm.campaignWorld?.isOpeningHoldValid(
        token.mapId,
        saved.placement.pose.world,
        saved.placement.pose.openingId,
        { mapId: gm.campaignMapId, geometry: gm.terrainEngine.geometry }
      )
    )
      throw new SceneNotReadyError('Waiting for a valid physical opening hold');
  } else if (saved.placement.pose.kind === 'wall') {
    for (const cell of [saved.placement.pose.wall.face.low, saved.placement.pose.wall.face.high]) {
      if (
        Math.abs(this.gameManager.getTerrainHeight(cell.gridX, cell.gridY) - cell.height) > 1e-6
      ) {
        throw new SceneNotReadyError(
          'Waiting for the creature to reach safe support after terrain changed'
        );
      }
    }
  } else if (saved.placement.pose.kind === 'flight') {
    const placement = saved.placement;
    const ground = flightGround(this, token, placement.pose.world);
    if (!Number.isFinite(ground)) {
      throw new SceneNotReadyError('Waiting for clear air above a valid floor');
    }
    if (placement.pose.world.y <= ground + 1e-7) {
      throw new SceneNotReadyError('Waiting for the flying creature to reach clear air or land');
    }
  } else {
    const placement = saved.placement;
    const scale = 5 / this.gameManager.spatial.tileWorldSize;
    const geometry = this.gameManager.terrainEngine?.geometry;
    const support = geometry?.hasVolumes
      ? geometry.findSupport(placement.pose.world.x * scale, placement.pose.world.z * scale, {
          belowFeet: placement.pose.world.y * scale + 1e-5,
          surfaceId: placement.pose.surfaceId ?? null,
          clearanceFeet: 5,
        })
      : null;
    const height = geometry?.hasVolumes
      ? support?.heightFeet / scale
      : this.gameManager.getTerrainHeight(placement.gridX, placement.gridY) *
        this.gameManager.spatial.elevationUnit;
    if (!Number.isFinite(height)) {
      throw new SceneNotReadyError('Waiting for the creature to reach a supported floor');
    }
    if (Math.abs(height - placement.pose.world.y) > 1e-4) {
      throw new SceneNotReadyError(
        'Waiting for the creature to reach safe ground after terrain changed'
      );
    }
  }
  return clone(saved.placement);
}

export function readStablePlacement(adapter, token) {
  return getStablePlacement.call(adapter, token);
}

function reframeStablePlacement(token, placement) {
  validateSavedPlacement(placement);
  if (placement.mapId === undefined) delete token.mapId;
  else token.mapId = placement.mapId;
  token.gridX = placement.gridX;
  token.gridY = placement.gridY;
  token.facingAngle = placement.facingAngle;
  token.world = { ...placement.pose.world };
  if (placement.pose.kind === 'grip') token.surfaceHold = clone(placement.pose.grip);
  if (placement.pose.kind === 'ledge') token.openingHold = { openingId: placement.pose.openingId };
  this._savedPlacements ||= new Map();
  this._savedPlacements.set(token, {
    mapId: token.mapId ?? this.gameManager.campaignMapId ?? 'map-main',
    placement: {
      gridX: placement.gridX,
      gridY: placement.gridY,
      facingAngle: placement.facingAngle,
      pose: clone(placement.pose),
    },
    job: null,
    spent: 0,
  });
}

function assertSurfaceGrip(adapter, token, placement) {
  const gm = adapter.gameManager;
  const world = gm.campaignWorld;
  if (
    !world ||
    !isSurfaceGripValid(
      world.listLocationMaps(token.mapId).map(({ id }) => world.getMap(id)),
      {
        mapId: token.mapId,
        pose: placement.pose,
      },
      (id) => (id === gm.campaignMapId ? gm.terrainEngine.geometry : world.getMapGeometry(id))
    )
  )
    throw new SceneNotReadyError('The creature needs a valid physical wall grip before saving');
}

async function restoreStablePlacement(token, placement) {
  validateSavedPlacement(placement);
  const gm = this.gameManager;
  if (placement.pose.kind === 'grip') token.surfaceHold = clone(placement.pose.grip);
  else delete token.surfaceHold;
  if (gm.campaignWorld && token.mapId !== gm.campaignMapId) {
    const wasOpeningHold =
      !!token.openingHold || !!this._tokenAnimationData.get(token)?.openingHoldClip;
    this.clearOpeningHoldVisual(token);
    token.gridX = placement.gridX;
    token.gridY = placement.gridY;
    token.facingAngle = placement.facingAngle;
    token.world = { ...placement.pose.world };
    if (placement.pose.kind === 'flight') token.flightActive = true;
    else delete token.flightActive;
    if (placement.pose.kind === 'ledge')
      token.openingHold = { openingId: placement.pose.openingId };
    else delete token.openingHold;
    if (wasOpeningHold && placement.pose.kind === 'ground' && this.hasAnimation(token, 'idle')) {
      this._setAnimation(token, 'idle', { force: true, fadeIn: 0, fadeOut: 0 });
      this.syncProneState(token);
    }
    this._savedPlacements ||= new Map();
    this._savedPlacements.set(token, {
      mapId: token.mapId ?? gm.campaignMapId ?? 'map-main',
      placement: {
        gridX: placement.gridX,
        gridY: placement.gridY,
        facingAngle: placement.facingAngle,
        pose: clone(placement.pose),
      },
      job: null,
      spent: 0,
    });
    return;
  }
  await token.__threeMeshPromise;
  const world = placement?.pose?.world;
  if (!world || ![world.x, world.y, world.z, placement.facingAngle].every(Number.isFinite)) {
    throw new Error('The saved creature placement is invalid');
  }
  if (!token.__threeMesh) throw new Error('The saved creature model did not load');
  this.clearOpeningHoldVisual(token);
  this._movementRoutes.delete(token);
  this._movementStates.delete(token);
  delete token[TOKEN_WORLD_LOCK_PROP];
  const state = this._ensureMovementState(token);
  if (placement.pose.kind === 'flight') token.flightActive = true;
  else delete token.flightActive;
  if (placement.pose.kind === 'ledge') token.openingHold = { openingId: placement.pose.openingId };
  else delete token.openingHold;
  token.gridX = placement.gridX;
  token.gridY = placement.gridY;
  token.facingAngle = placement.facingAngle;
  this._syncTokenAndMeshWorld(state, { ...world });
  this._applyOrientationImmediate(token, placement.facingAngle);
  if (placement.pose.kind === 'grip') {
    assertSurfaceGrip(this, token, placement);
    state.phase = 'climb-hold';
    this._lockTokenWorldAuthority(state);
    this.syncSurfaceGripVisual(token);
  } else if (placement.pose.kind === 'ledge') {
    if (
      !gm.campaignWorld?.isOpeningHoldValid(token.mapId, world, placement.pose.openingId, {
        mapId: gm.campaignMapId,
        geometry: gm.terrainEngine.geometry,
      })
    )
      throw new Error('The saved opening hold has no physical attachment');
    state.phase = 'climb-hold';
    this._lockTokenWorldAuthority(state);
    this.syncOpeningHoldVisual(token);
  } else if (placement.pose.kind === 'wall') {
    const saved = placement.pose.wall;
    if (
      !saved ||
      VECTOR_KEYS.some(
        (key) => saved[key] && !['x', 'y', 'z'].every((axis) => Number.isFinite(saved[key][axis]))
      ) ||
      NUMBER_KEYS.some((key) => !Number.isFinite(saved[key]))
    )
      throw new Error('Saved wall placement is invalid');
    const data = this._tokenAnimationData.get(token);
    if (!data?.actions?.[saved.clip])
      throw new Error('The saved wall/ledge animation is unavailable');
    state.wallMotion = {
      ...clone(saved),
      wall: data.rootMotion?.[saved.loopClip === 'climbWallDown' ? 'wallDown' : 'wall'],
    };
    state.phase = 'climb-hold';
    const settings = getTokenMovementSettings(token);
    state.pathSpeedMode = settings.mode;
    state.pathMovementType = settings.type;
    this._lockTokenWorldAuthority(state);
    this._setAnimation(token, saved.clip, { force: true, fadeIn: 0, fadeOut: 0 });
    const time =
      saved.clip === 'ledgeHang'
        ? 0
        : ((saved.loopClock % saved.wallDuration) + saved.wallDuration) % saved.wallDuration;
    this._seekWallClip(state, saved.clip, time);
    this._setSelectionIndicatorSuppressed(state, false);
  } else if (placement.pose.kind === 'flight') {
    state.phase = 'flight-loading';
    this._lockTokenWorldAuthority(state);
    await this._ensureFlightAnimations(token);
    state.phase = 'idle';
    this._setAnimation(token, 'hover', { force: true, fadeIn: 0, fadeOut: 0 });
  } else if (placement.pose.kind === 'ground') {
    state.phase = 'idle';
    const data = this._tokenAnimationData.get(token);
    if (
      [
        'ledgeHang',
        'climb',
        'climbWall',
        'climbWallDown',
        'climbRecover',
        'climbShort',
        'recoverShort',
      ].includes(data?.current)
    )
      this._setAnimation(token, 'idle', { force: true, fadeIn: 0, fadeOut: 0 });
    data?.mixer.update(0);
  } else throw new Error('Unsupported saved creature pose');
  this._neutralizeRootMotion(token);
  this.syncProneState(token);
  token.__threeMesh.updateMatrixWorld?.(true);
  this.recordStablePlacement(token);
  this._movementRangeDirty = true;
}

export function installSavedPlacementMethods(prototype) {
  prototype.reframeStablePlacement = reframeStablePlacement;
  prototype.recordStablePlacement = recordStablePlacement;
  prototype.getStablePlacement = getStablePlacement;
  prototype.restoreStablePlacement = restoreStablePlacement;
  prototype.getSharedPresentations = getSharedPresentations;
  prototype.acknowledgeSharedPresentations = acknowledgeSharedPresentations;
  prototype.clearSharedPresentations = function () {
    this._sharedMovementPresentations?.clear();
  };
  prototype.recordGroundCheckpoint = function (state) {
    if (state.groundTransition || state.wallMotion || state.traversal) return;
    const saved = this._savedPlacements?.get(state.token)?.placement;
    const world = state.token.world;
    const previous = saved?.pose.world;
    if (
      !previous ||
      Math.hypot(world.x - previous.x, world.z - previous.z) >=
        this.gameManager.spatial.tileWorldSize - 1e-8
    )
      this.recordStablePlacement(state.token);
  };
  prototype.getCheckpointMovementCosts = function () {
    const costs = new Map();
    for (const [token, job] of this._movementRoutes) {
      const saved = this._savedPlacements?.get(token);
      costs.set(token.id, saved?.job === job ? saved.spent : 0);
    }
    return costs;
  };
}
