import {
  CLIMB_WALL_ENTRY_TILE_HALF_RATIO,
  DEFAULT_CLIMB_WALL_DURATION,
  HIGH_WALL_SEGMENT_LEVELS,
  PATH_NAVIGATION_KEY,
} from '../../../config/token-adapter/MannequinConfig.js';
import {
  facingAngleFromDirection,
  getTokenMovementSettings,
} from '../../../entities/creatures/TokenMovement.js';
import { FEET_PER_GRID_SQUARE } from '../../../config/TokenMovementConfig.js';

const EPSILON = 1e-8;

function _startWallMovement(token, face, target) {
  const state = this._ensureMovementState(token);
  const data = this._tokenAnimationData.get(token);
  for (const key of ['climbWall', 'climb', 'climbRecover']) {
    if (!data?.actions?.[key] || !(this._extractClipDuration(data.actions[key]) > 0))
      throw new Error(`Wall movement requires the ${key} animation`);
  }
  const previous = state.wallMotion;
  const job = this._movementRoutes.get(token);
  const entryCost = previous?.holding || target.wallExit ? 0 : FEET_PER_GRID_SQUARE;
  const available = job.settings.speed - job.spent - entryCost;
  if (
    available < EPSILON &&
    !(previous?.holding && (job.settings.mode === 'run' || target.ledgeHang))
  )
    return this._stopPlannedMovement(token);
  if (previous && previous.face.id !== face.id)
    throw new Error('A creature must return to ground before changing wall columns');
  this._releaseManualAnimationForMovement(token);
  this._clearPathState(state);
  this._clearClimbState(state);
  state.climbContinuationGoal = null;
  state.pendingStop = false;
  state.intentHold = false;
  state.movementSign = 0;
  state.activeStep = null;
  state.stepFinalized = true;
  const spatial = this.gameManager.spatial;
  const low = spatial.gridToWorld(face.low.gridX + 0.5, face.low.gridY + 0.5, face.low.height);
  const high = spatial.gridToWorld(face.high.gridX + 0.5, face.high.gridY + 0.5, face.high.height);
  const dx = face.high.gridX - face.low.gridX;
  const dz = face.high.gridY - face.low.gridY;
  const facing = facingAngleFromDirection(dx, dz);
  token.facingAngle = facing;
  this._applyOrientationImmediate(token, facing);
  state.pendingFacingAngle = undefined;
  const depth = spatial.tileWorldSize * 0.5 * CLIMB_WALL_ENTRY_TILE_HALF_RATIO;
  const foot = { x: low.x + dx * depth, y: low.y, z: low.z + dz * depth };
  const info = {
    footWorld: foot,
    edgeWorld: { ...foot, y: high.y },
    finalWorld: high,
    heightDelta: face.high.height - face.low.height,
    elevationUnit: spatial.elevationUnit,
  };
  const wallPlan = this._planClimbWallSegments(state, info, data);
  const mantleStart = wallPlan?.finalStartWorld || foot;
  const recover = this._resolveClimbTargetWorld(info, data);
  const world = this._resolveTokenWorldPosition(token);
  const targetY = target.height * spatial.elevationUnit;
  const direction = targetY >= world.y ? 1 : -1;
  const loopClip = direction < 0 && data.actions.climbWallDown ? 'climbWallDown' : 'climbWall';
  const loopDirection = loopClip === 'climbWallDown' ? -1 : 1;
  const wall = data.rootMotion?.[loopClip === 'climbWallDown' ? 'wallDown' : 'wall'];
  const wallDisplacement = wall
    ? this._rootDisplacementToWorld(data.rootMotion.rootInfo, wall.displacementLocal)
    : null;
  const sameLoop = previous?.loopClip === loopClip;
  const motion = {
    face,
    low,
    high,
    foot,
    ledge: { x: high.x - dx * depth, y: high.y, z: high.z - dz * depth },
    mantleStart,
    recover,
    wall,
    wallDuration: this._extractClipDuration(data.actions[loopClip]) || DEFAULT_CLIMB_WALL_DURATION,
    wallHeight:
      Math.abs(wallDisplacement?.y) > EPSILON
        ? Math.abs(wallDisplacement.y)
        : HIGH_WALL_SEGMENT_LEVELS * spatial.elevationUnit,
    mantleDuration: this._extractClipDuration(data.actions.climb),
    recoverDuration: this._extractClipDuration(data.actions.climbRecover),
    cursorY: world.y,
    startY: world.y,
    targetY,
    entryCost,
    costPerWorldUnit: (2 * FEET_PER_GRID_SQUARE) / spatial.tileWorldSize,
    direction,
    destination: target.kind === 'wall' ? 'hold' : targetY > low.y + EPSILON ? 'high' : 'low',
    clip: previous?.clip || null,
    loopClip,
    loopDirection,
    loopClock: sameLoop ? previous.loopClock : undefined,
    loopOriginY: sameLoop
      ? previous.loopOriginY
      : loopDirection < 0
        ? Math.min(world.y, mantleStart.y)
        : low.y,
    holding: false,
    stage: previous?.holding ? 'surface' : 'approach',
    stageTime: 0,
    stageStart: { ...world },
  };
  if (sameLoop && previous.clip === loopClip)
    motion.loopOriginY =
      world.y - wallHeightAtClock({ ...motion, loopOriginY: 0 }, motion.loopClock);
  motion.loopClock ??= wallClockAtHeight(motion, Math.min(world.y, mantleStart.y));
  motion.stageTarget = motion.direction > 0 ? foot : recover;
  state.wallMotion = motion;
  this._movementRangeDirty = true;
  state.phase = 'climb-surface';
  state.pathSpeedMode = job.settings.mode;
  state.pathMovementType = job.settings.type;
  state.lastRequestedGoal = {
    gridX: target.gridX ?? face.low.gridX,
    gridY: target.gridY ?? face.low.gridY,
    options: { __preferredSpeedMode: job.settings.mode, movementType: job.settings.type },
  };
  this._limitWallMovementBudget(state);
  this._lockTokenWorldAuthority(state);
  this._setSelectionIndicatorSuppressed(state, true);
  this._syncMovementVariant(state, 1);
  if (motion.direction < 0 && job.settings.mode === 'run') this._dropFromWall(state);
  else if (motion.stage === 'approach' || motion.stage === 'exit')
    this._startWallGroundStage(state, motion.stageTarget);
  return {
    goal: { ...state.lastRequestedGoal, world: job.current.world },
    speedMode: job.settings.mode,
  };
}

function _startWallGroundStage(state, target) {
  const motion = state.wallMotion;
  motion.stageStart = { ...this._resolveTokenWorldPosition(state.token) };
  motion.stageTarget = { ...target };
  motion.stageTime = 0;
  motion.clip = null;
  this._orientTokenTowardsWorld(state.token, target);
  this._applyOrientationImmediate(state.token, state.token.facingAngle);
  this._playLoopAnimation(state);
}

function _seekWallClip(state, key, time) {
  const motion = state.wallMotion;
  const data = this._tokenAnimationData.get(state.token);
  const action = data.actions[key];
  if (motion.clip !== key || (data.current && data.current !== key)) {
    this._setAnimation(state.token, key, {
      fadeIn: 0.18,
      fadeOut: 0.18,
      force: data.current !== key,
    });
    motion.clip = key;
  }
  action.paused = true;
  action.time = time;
  // Sample a controlled/held pose without advancing the mixer's global fade clock twice.
  this._animationMixers.get(state.token)?.update(0);
}

function _advanceWallMovement(state, delta) {
  let remaining = Math.max(delta, 0);
  for (let transitions = 0; remaining > EPSILON && transitions < 12; transitions++) {
    const motion = state.wallMotion;
    if (!motion || state.phase !== 'climb-surface') return;
    if (motion.stage === 'approach' || motion.stage === 'exit' || motion.stage === 'release') {
      this._syncMovementVariant(state, 1);
      const speed = state.activeSpeed;
      if (!Number.isFinite(speed) || speed <= 0)
        throw new Error('Wall approach and departure require a positive movement pace');
      const current = this._resolveTokenWorldPosition(state.token);
      const distance = Math.hypot(
        current.x - motion.stageTarget.x,
        current.z - motion.stageTarget.z
      );
      const used = Math.min(remaining, distance / speed);
      const progress = distance > EPSILON ? Math.min((used * speed) / distance, 1) : 1;
      this._syncTokenAndMeshWorld(state, this._lerp3(current, motion.stageTarget, progress));
      this._applyTokenGridFromWorld(state.token, state.token.world);
      remaining -= used;
      if (progress < 1 - EPSILON) return;
      if (motion.stage === 'exit') {
        this._finishWallMovementOnGround(state);
        return;
      }
      if (motion.stage === 'release') {
        this._beginWallFall(state);
        return;
      }
      const dx = motion.face.high.gridX - motion.face.low.gridX;
      const dz = motion.face.high.gridY - motion.face.low.gridY;
      const facing = facingAngleFromDirection(dx, dz);
      state.token.facingAngle = facing;
      this._applyOrientationImmediate(state.token, facing);
      state.pendingFacingAngle = undefined;
      motion.cursorY = motion.stageTarget.y;
      if (motion.direction < 0) {
        motion.stage = 'recover';
        motion.stageTime = motion.recoverDuration;
        state.climbRecoverStartWorld = { ...motion.recover };
        this._seekWallClip(state, 'climbRecover', motion.stageTime);
      } else {
        motion.stage = 'surface';
      }
      continue;
    }
    if (motion.stage === 'recover') {
      const end = motion.direction > 0 ? motion.recoverDuration : 0;
      const used = Math.min(remaining, Math.abs(end - motion.stageTime));
      motion.stageTime += motion.direction * used;
      this._seekWallClip(state, 'climbRecover', motion.stageTime);
      remaining -= used;
      if (Math.abs(motion.stageTime - end) > EPSILON) return;
      if (motion.direction > 0) {
        motion.stage = 'exit';
        this._startWallGroundStage(state, motion.high);
      } else {
        motion.stage = 'surface';
      }
      continue;
    }
    const direction = motion.direction;
    if (Math.abs(motion.targetY - motion.cursorY) < EPSILON) {
      this._finishWallSurfaceTravel(state);
      continue;
    }
    const inMantle =
      direction > 0
        ? motion.cursorY >= motion.mantleStart.y - EPSILON
        : motion.cursorY > motion.mantleStart.y + EPSILON;
    let used;
    if (inMantle) {
      const rise = motion.high.y - motion.mantleStart.y;
      const time = ((motion.cursorY - motion.mantleStart.y) / rise) * motion.mantleDuration;
      const boundary =
        direction > 0 ? motion.targetY : Math.max(motion.targetY, motion.mantleStart.y);
      const endTime = ((boundary - motion.mantleStart.y) / rise) * motion.mantleDuration;
      used = Math.min(remaining, Math.abs(endTime - time));
      const nextTime = time + direction * used;
      motion.cursorY = motion.mantleStart.y + (nextTime / motion.mantleDuration) * rise;
      this._seekWallClip(state, 'climb', nextTime);
    } else {
      const boundary =
        direction > 0 ? Math.min(motion.targetY, motion.mantleStart.y) : motion.targetY;
      let nextClock = motion.loopClock + direction * motion.loopDirection * remaining;
      let nextY = wallHeightAtClock(motion, nextClock);
      if (direction * (nextY - boundary) >= -EPSILON) {
        nextClock = wallClockAtHeight(motion, boundary);
        nextY = boundary;
      }
      used = Math.min(remaining, Math.abs(nextClock - motion.loopClock));
      motion.loopClock = nextClock;
      motion.cursorY = nextY;
      const time = ((nextClock % motion.wallDuration) + motion.wallDuration) % motion.wallDuration;
      this._seekWallClip(state, motion.loopClip, time);
    }
    this._syncTokenAndMeshWorld(state, wallPointAtHeight(this, motion, motion.cursorY));
    this._applyTokenGridFromWorld(state.token, state.token.world);
    remaining -= used;
    if (Math.abs(motion.targetY - motion.cursorY) < EPSILON) this._finishWallSurfaceTravel(state);
  }
  if (remaining > EPSILON && state.phase === 'climb-surface')
    throw new Error('Wall movement could not advance through its animation stages');
}

function _finishWallSurfaceTravel(state) {
  const motion = state.wallMotion;
  if (motion.destination === 'hold') {
    if (motion.cursorY > motion.mantleStart.y + EPSILON)
      throw new Error('A creature cannot stop inside its ledge transition');
    const atLedge =
      Math.abs(motion.cursorY - motion.mantleStart.y) <= EPSILON &&
      motion.mantleStart.y > motion.low.y + EPSILON;
    const key =
      atLedge && this._tokenAnimationData.get(state.token)?.actions.ledgeHang
        ? 'ledgeHang'
        : motion.loopClip;
    const time =
      key === 'ledgeHang'
        ? 0
        : ((motion.loopClock % motion.wallDuration) + motion.wallDuration) % motion.wallDuration;
    this._seekWallClip(state, key, time);
    motion.holding = true;
    state.phase = 'climb-hold';
    this._setSelectionIndicatorSuppressed(state, false);
    this._movementRangeDirty = true;
    this.recordStablePlacement?.(state.token);
  } else if (motion.destination === 'high') {
    motion.stage = 'recover';
    motion.stageTime = 0;
    state.climbRecoverStartWorld = { ...motion.recover };
    this._seekWallClip(state, 'climbRecover', 0);
  } else {
    motion.stage = 'exit';
    this._startWallGroundStage(state, motion.low);
  }
}

function _finishWallMovementOnGround(state) {
  state.wallMotion = null;
  state.climbRecoverStartWorld = null;
  state.phase = 'idle';
  this._setSelectionIndicatorSuppressed(state, false);
  this._unlockTokenWorldAuthority(state);
  this._resetMovementState(state);
  this._movementRangeDirty = true;
}

function _applyWallMovementStyle(state) {
  const motion = state.wallMotion;
  if (!motion || motion.holding || motion.stage === 'release') return;
  const mode = this._movementRoutes.get(state.token)?.settings.mode;
  if (motion.direction < 0 && mode === 'run' && motion.destination !== 'ledge')
    this._dropFromWall(state);
  else if (motion.stage === 'approach' || motion.stage === 'exit') this._playLoopAnimation(state);
}

function _limitWallMovementBudget(state) {
  const motion = state.wallMotion;
  const job = this._movementRoutes.get(state.token);
  const isFreeDrop = motion.direction < 0 && job.settings.mode === 'run';
  const maximumTravel = Math.max(
    (job.settings.speed - job.spent - motion.entryCost) / motion.costPerWorldUnit,
    0
  );
  if (!isFreeDrop && Math.abs(motion.targetY - motion.startY) > maximumTravel + EPSILON) {
    motion.targetY = motion.startY + motion.direction * maximumTravel;
    motion.destination = 'hold';
  }
  if (motion.destination === 'hold') {
    if (motion.targetY > motion.mantleStart.y + EPSILON) {
      if (motion.direction > 0) motion.targetY = motion.mantleStart.y;
      else {
        motion.targetY = motion.high.y;
        motion.destination = 'ledge';
        motion.stage = 'exit';
        motion.stageTarget = { ...motion.ledge };
      }
    }
    if (motion.targetY <= motion.low.y + EPSILON) motion.destination = 'low';
    job.current =
      motion.destination === 'ledge'
        ? { ...motion.face.high, kind: 'ledge' }
        : motion.destination === 'low'
          ? { ...motion.face.low, wallExit: 'low', wall: motion.face }
          : {
              kind: 'wall',
              face: motion.face,
              height: motion.targetY / this.gameManager.spatial.elevationUnit,
            };
    job.points = [job.current];
    job.index = 1;
  }
  job.segmentCost =
    motion.entryCost +
    (isFreeDrop ? 0 : Math.abs(motion.targetY - motion.startY) * motion.costPerWorldUnit);
  job.current.world =
    motion.destination === 'hold'
      ? wallPointAtHeight(this, motion, motion.targetY)
      : { ...motion[motion.destination] };
}

function _dropFromWall(state) {
  const motion = state.wallMotion;
  const job = this._movementRoutes.get(state.token);
  if (job.current.kind === 'wall') {
    job.current = { ...motion.face.low, wallExit: 'low', wall: motion.face };
    job.points = [job.current];
    job.index = 1;
  }
  job.current.world = { ...motion.low };
  const world = this._resolveTokenWorldPosition(state.token);
  job.segmentCost = motion.entryCost + Math.abs(world.y - motion.startY) * motion.costPerWorldUnit;
  motion.stage = 'release';
  motion.stageStart = { ...world };
  motion.stageTarget = { ...motion.foot, y: world.y };
  motion.clip = null;
  const data = this._tokenAnimationData.get(state.token);
  const key = data.actions.fallLoop ? 'fallLoop' : 'fall';
  if (!data.actions[key]) throw new Error('Dropping from a wall requires a falling animation');
  this._setAnimation(state.token, key, { fadeIn: 0.12, fadeOut: 0.12 });
}

function _beginWallFall(state) {
  const motion = state.wallMotion;
  const startWorld = { ...this._resolveTokenWorldPosition(state.token) };
  const targetWorld = { ...motion.low };
  const spatial = this.gameManager.spatial;
  state.wallMotion = null;
  state.climbRecoverStartWorld = null;
  state.stepFinalized = false;
  state.pathActive = true;
  state.pathKey = PATH_NAVIGATION_KEY;
  state.forwardKeys.add(PATH_NAVIGATION_KEY);
  state.pathReached = false;
  state.pathGoal = {
    gridX: motion.face.low.gridX,
    gridY: motion.face.low.gridY,
    world: { ...targetWorld },
  };
  state.pathSpeedMode = this._movementRoutes.get(state.token).settings.mode;
  state.pathMovementType = this._movementRoutes.get(state.token).settings.type;
  state.activeStep = {
    tokenEntry: state.token,
    mesh: state.mesh,
    startWorld,
    targetWorld,
    startPosition: this._composeMeshPosition(startWorld, state.mesh),
    targetPosition: this._composeMeshPosition(targetWorld, state.mesh),
    totalDistance: Math.hypot(
      startWorld.x - targetWorld.x,
      startWorld.y - targetWorld.y,
      startWorld.z - targetWorld.z
    ),
    horizontalDistance: Math.hypot(startWorld.x - targetWorld.x, startWorld.z - targetWorld.z),
    traveled: 0,
    horizontalTraveled: 0,
    heightDrop:
      (startWorld.y - targetWorld.y) /
      (spatial.elevationUnit > 0 ? spatial.elevationUnit : spatial.tileWorldSize),
    requiresFall: true,
    fallTriggered: false,
    fallStartCaptured: true,
    fallStartWorld: { ...startWorld },
    fallStartPosition: this._composeMeshPosition(startWorld, state.mesh),
    fallStartRatio: 0,
    gridTargetX: motion.face.low.gridX,
    gridTargetY: motion.face.low.gridY,
    landingVariant: 'hardLanding',
  };
  if (!this._maybeEnterFallPhase(state))
    throw new Error('The wall drop could not enter the falling state');
  this._setSelectionIndicatorSuppressed(state, false);
}

function wallPointAtHeight(adapter, motion, height) {
  const rise = motion.high.y - motion.mantleStart.y;
  const progress = rise > EPSILON ? Math.max((height - motion.mantleStart.y) / rise, 0) : 0;
  return {
    ...adapter._lerp3(motion.foot, motion.recover, Math.min(progress, 1)),
    y: height,
  };
}

function wallHeightAtClock(motion, clock) {
  const cycles = Math.floor(clock / motion.wallDuration);
  const time = clock - cycles * motion.wallDuration;
  let progress = time / motion.wallDuration;
  const wall = motion.wall;
  if (wall?.interpolant) {
    const span = wall.interpolant.evaluate(motion.wallDuration)[1] - wall.start.y;
    if (Math.abs(span) > EPSILON)
      progress = Math.min(
        Math.max((wall.interpolant.evaluate(time)[1] - wall.start.y) / span, 0),
        1
      );
  }
  return motion.loopOriginY + motion.loopDirection * (cycles + progress) * motion.wallHeight;
}

function wallClockAtHeight(motion, height) {
  const cycles = Math.floor(
    (height - motion.loopOriginY) / (motion.loopDirection * motion.wallHeight)
  );
  let low = cycles * motion.wallDuration;
  let high = low + motion.wallDuration;
  for (let i = 0; i < 40; i++) {
    const mid = (low + high) * 0.5;
    if (motion.loopDirection * (wallHeightAtClock(motion, mid) - height) < 0) low = mid;
    else high = mid;
  }
  return (low + high) * 0.5;
}

function _cancelWallMovement(state) {
  state.wallMotion = null;
  state.climbRecoverStartWorld = null;
  this._finishPlannedMovement(state.token, true);
  this._setSelectionIndicatorSuppressed(state, false);
  this._unlockTokenWorldAuthority(state);
  this._resetMovementState(state);
  this._movementRangeDirty = true;
}

function _resyncHeldWall(state) {
  const motion = state.wallMotion;
  const gm = this.gameManager;
  const spatial = gm.spatial;
  const world = this._resolveTokenWorldPosition(state.token);
  const low = motion.face.low;
  const high = motion.face.high;
  const inBounds =
    this._isGridWithinBounds(low.gridX, low.gridY) &&
    this._isGridWithinBounds(high.gridX, high.gridY);
  const lowHeight = inBounds ? gm.getTerrainHeight(low.gridX, low.gridY) : NaN;
  const highHeight = inBounds ? gm.getTerrainHeight(high.gridX, high.gridY) : NaN;
  if (
    inBounds &&
    highHeight - lowHeight >= this._getWallClimbThreshold() - EPSILON &&
    world.y >= lowHeight * spatial.elevationUnit - EPSILON &&
    world.y <= highHeight * spatial.elevationUnit + EPSILON
  )
    return true;
  const groundY = this._sampleWorldHeight(world.x, world.z, world.y);
  this._logPathing('climb:wall-support-removed', { tokenId: state.token.id, world, groundY });
  if (groundY >= world.y - EPSILON) {
    this._cancelWallMovement(state);
    return false;
  }
  const grid = this._mapWorldToGrid(world);
  const cell = {
    ...grid,
    height: spatial.elevationUnit > 0 ? groundY / spatial.elevationUnit : 0,
  };
  cell.world = spatial.gridToWorld(grid.gridX + 0.5, grid.gridY + 0.5, cell.height);
  motion.low = { ...cell.world };
  motion.foot = { ...world, y: groundY };
  motion.face = { ...motion.face, low: cell };
  motion.direction = -1;
  motion.startY = world.y;
  motion.entryCost = 0;
  motion.holding = false;
  state.phase = 'climb-surface';
  this._movementRoutes.set(state.token, {
    points: [cell],
    index: 1,
    current: cell,
    settings: { ...getTokenMovementSettings(state.token), mode: 'run' },
    spent: 0,
  });
  this._dropFromWall(state);
  return true;
}

export function installWallMovementMethods(prototype) {
  prototype.isWallAttached = function (token) {
    return !!this._movementStates.get(token)?.wallMotion;
  };
  prototype._startWallMovement = _startWallMovement;
  prototype._advanceWallMovement = _advanceWallMovement;
  prototype._startWallGroundStage = _startWallGroundStage;
  prototype._seekWallClip = _seekWallClip;
  prototype._finishWallSurfaceTravel = _finishWallSurfaceTravel;
  prototype._finishWallMovementOnGround = _finishWallMovementOnGround;
  prototype._applyWallMovementStyle = _applyWallMovementStyle;
  prototype._limitWallMovementBudget = _limitWallMovementBudget;
  prototype._dropFromWall = _dropFromWall;
  prototype._beginWallFall = _beginWallFall;
  prototype._cancelWallMovement = _cancelWallMovement;
  prototype._resyncHeldWall = _resyncHeldWall;
}
