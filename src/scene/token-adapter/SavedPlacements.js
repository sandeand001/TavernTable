import { getTokenMovementSettings } from '../../entities/creatures/TokenMovement.js';
import { TOKEN_WORLD_LOCK_PROP } from '../../config/token-adapter/MannequinConfig.js';

const clone = (value) => JSON.parse(JSON.stringify(value));
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

export function validateSavedPlacement(placement) {
  const pose = placement?.pose;
  const finiteVector = (vector) =>
    vector && ['x', 'y', 'z'].every((axis) => Number.isFinite(vector[axis]));
  if (
    !finiteVector(pose?.world) ||
    !Number.isFinite(placement.facingAngle) ||
    !['ground', 'wall', 'flight'].includes(pose.kind)
  )
    throw new Error('The saved creature placement is invalid');
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
      throw new Error('The saved stable wall/ledge placement is invalid');
    }
  }
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
  const checkpoint = { placement, ...checkpointCost(this, token, placement) };
  this._savedPlacements.set(token, checkpoint);
  if (
    !previous ||
    JSON.stringify(previous.placement) !== JSON.stringify(placement) ||
    previous.spent !== checkpoint.spent
  )
    this.gameManager.sceneAutosave?.changed('movement checkpoint');
  return true;
}

function getStablePlacement(token) {
  this._savedPlacements ||= new Map();
  if (!this.isMovementInProgress(token)) recordStablePlacement.call(this, token);
  const saved = this._savedPlacements.get(token);
  if (!saved)
    throw new SceneNotReadyError('Waiting for a completed creature movement step before saving');
  if (saved.placement.pose.kind === 'wall') {
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
    const ground =
      this.gameManager.getTerrainHeight(placement.gridX, placement.gridY) *
      this.gameManager.spatial.elevationUnit;
    if (placement.pose.world.y <= ground + 1e-7) {
      throw new SceneNotReadyError('Waiting for the flying creature to reach clear air or land');
    }
  } else {
    const placement = saved.placement;
    const height =
      this.gameManager.getTerrainHeight(placement.gridX, placement.gridY) *
      this.gameManager.spatial.elevationUnit;
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

async function restoreStablePlacement(token, placement) {
  validateSavedPlacement(placement);
  await token.__threeMeshPromise;
  const world = placement?.pose?.world;
  if (!world || ![world.x, world.y, world.z, placement.facingAngle].every(Number.isFinite)) {
    throw new Error('The saved creature placement is invalid');
  }
  if (!token.__threeMesh) throw new Error('The saved creature model did not load');
  this._movementRoutes.delete(token);
  this._movementStates.delete(token);
  delete token[TOKEN_WORLD_LOCK_PROP];
  const state = this._ensureMovementState(token);
  if (placement.pose.kind === 'flight') token.flightActive = true;
  else delete token.flightActive;
  token.gridX = placement.gridX;
  token.gridY = placement.gridY;
  token.facingAngle = placement.facingAngle;
  this._syncTokenAndMeshWorld(state, { ...world });
  this._applyOrientationImmediate(token, placement.facingAngle);
  if (placement.pose.kind === 'wall') {
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
  } else if (placement.pose.kind !== 'ground') throw new Error('Unsupported saved creature pose');
  this._neutralizeRootMotion(token);
  this.syncProneState(token);
  token.__threeMesh.updateMatrixWorld?.(true);
  this.recordStablePlacement(token);
  this._movementRangeDirty = true;
}

export function installSavedPlacementMethods(prototype) {
  prototype.recordStablePlacement = recordStablePlacement;
  prototype.getStablePlacement = getStablePlacement;
  prototype.restoreStablePlacement = restoreStablePlacement;
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
