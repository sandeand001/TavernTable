import {
  facingAngleFromDirection,
  getTokenConditions,
  getTokenMovementSettings,
} from '../../../entities/creatures/TokenMovement.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../terrain/SurfaceNavigation.js';
import { MAX_STEP_HEIGHT_FEET } from '../../../config/TokenMovementConfig.js';

function getTokenSurfaceRange(token, allowance = null) {
  const gm = this.gameManager;
  const world = this._resolveTokenWorldPosition(token);
  const feetPerWorld = 5 / gm.spatial.tileWorldSize;
  gm.terrainEngine.configureGeometryScale(gm.spatial.elevationUnit * feetPerWorld);
  const combat = gm.characterServices?.combat;
  const settings = getTokenMovementSettings(token);
  const available = combat?.active
    ? combat.movementAllowance(token)
    : combat && token.characterSheetId
      ? combat.freeMovementAllowance(token)
      : settings.speed;
  const range = buildSurfaceRange({
    geometry: gm.terrainEngine.geometry,
    start: {
      gridX: token.gridX,
      gridY: token.gridY,
      heightFeet: world.y * feetPerWorld,
    },
    speedFeet: Math.min(available, allowance ?? Infinity),
    prone: getTokenConditions(token).includes('prone'),
    isOccupied: (x, y, height, bodyHeight) =>
      (gm.placedTokens || []).some((other) => {
        if (other === token || other.gridX !== x || other.gridY !== y) return false;
        const otherHeight = this._resolveTokenWorldPosition(other).y * feetPerWorld;
        return height < otherHeight + bodyHeight - 1e-7 && height + bodyHeight > otherHeight + 1e-7;
      }),
  });
  for (const cell of range.tiles.values()) {
    cell.world = {
      x: (cell.gridX + 0.5) * gm.spatial.tileWorldSize,
      y: cell.heightFeet / feetPerWorld,
      z: (cell.gridY + 0.5) * gm.spatial.tileWorldSize,
    };
    cell.height = gm.spatial.elevationUnit > 0 ? cell.world.y / gm.spatial.elevationUnit : 0;
  }
  range.mode = settings.mode;
  range.visibleLayers = gm.terrainEngine.visibleLayers;
  return range;
}

function requestSurfaceMovement(token, destination, range) {
  const gm = this.gameManager;
  const picked = destination.surface;
  let gridX = destination.gridX,
    gridY = destination.gridY;
  if (picked) {
    if (
      !picked.point ||
      !picked.normal ||
      picked.normal.y < 0.9 ||
      ![picked.point.x, picked.point.y, picked.point.z].every(Number.isFinite)
    ) {
      throw new Error('Choose a walkable floor or stair top on the layered map');
    }
    const mapped = gm.spatial.worldToGrid(picked.point.x, picked.point.z);
    gridX = mapped.gridX;
    gridY = mapped.gridY;
  }
  const route = getSurfaceRoute(
    range,
    gridX,
    gridY,
    picked
      ? {
          surfaceId: picked.surfaceId ?? null,
          heightFeet: (picked.point.y * 5) / gm.spatial.tileWorldSize,
        }
      : {}
  );
  if (!route) throw new Error('That floor is outside the reachable supported movement range');
  if (!route.length) return { goal: null, cost: 0, distance: 0, speedMode: range.mode };
  const data = this._tokenAnimationData.get(token);
  if (!token.__threeMesh || !data?.actions.walk || !data?.profile) {
    throw new Error('Wait for the creature movement animations to finish loading');
  }
  let previousHeight = range.start.heightFeet;
  for (const cell of route) {
    if (
      previousHeight - cell.heightFeet > MAX_STEP_HEIGHT_FEET + 1e-7 &&
      ((!data.actions.fall && !data.actions.fallLoop) ||
        typeof gm.characterServices?.falling?.begin !== 'function')
    ) {
      throw new Error('Wait for falling animations and rules before stepping off a ledge');
    }
    previousHeight = cell.heightFeet;
  }
  this.recordStablePlacement(token);
  const combat = gm.characterServices?.combat;
  const cost = route.at(-1).cost;
  const job = {
    token,
    layered: true,
    points: route,
    index: 0,
    current: null,
    settings: { ...getTokenMovementSettings(token), speed: range.speed },
    range,
    spent: 0,
    plannedCost: cost,
    combat,
    combatMove: combat?.active ? combat.beginMovement(token, cost) : null,
  };
  this._movementRoutes.set(token, job);
  this._releaseManualAnimationForMovement(token);
  const state = this._ensureMovementState(token);
  this._clearPathState(state);
  state.forwardKeys.clear();
  state.backwardKeys.clear();
  this._lockTokenWorldAuthority(state);
  this._beginSurfaceSegment(state, job);
  this._movementRangeDirty = true;
  return { goal: route.at(-1), cost, distance: cost, speedMode: job.settings.mode };
}

function beginSurfaceSegment(state, job) {
  const point = job.points[job.index++];
  const start = this._resolveTokenWorldPosition(state.token);
  const data = this._tokenAnimationData.get(state.token);
  const run = job.settings.mode === 'run';
  const drunk = job.settings.type === 'drunk';
  const clip = job.range.prone
    ? 'prone'
    : drunk
      ? run
        ? 'drunkRunForward'
        : 'drunkWalk'
      : run
        ? 'run'
        : 'walk';
  if (!data.actions[clip])
    throw new Error(`The required ${clip} movement animation is unavailable`);
  const speed = job.range.prone
    ? data.profile.walkSpeed
    : drunk
      ? run
        ? data.profile.drunkRunSpeed
        : data.profile.drunkWalkSpeed
      : run
        ? data.profile.runSpeed
        : data.profile.walkSpeed;
  if (!Number.isFinite(speed) || speed <= 0)
    throw new Error('The movement animation pace is invalid');
  job.current = point;
  job.segmentStartWorld = { ...start };
  job.segmentCost = point.cost - job.spent;
  job.segmentCharged = false;
  const dx = point.world.x - start.x,
    dz = point.world.z - start.z;
  this._applyOrientationImmediate(state.token, facingAngleFromDirection(dx, dz));
  state.surfaceMotion = {
    start,
    target: point.world,
    elapsed: 0,
    duration: Math.max((Math.hypot(dx, dz) / speed) * (job.range.prone ? 2 : 1), 0.16),
    fall:
      ((start.y - point.world.y) * 5) / this.gameManager.spatial.tileWorldSize >
      MAX_STEP_HEIGHT_FEET + 1e-7,
  };
  state.phase = 'surface';
  this._setAnimation(state.token, clip, { fadeIn: 0.2, fadeOut: 0.2 });
}

function advanceSurfaceMotion(state, delta) {
  const job = this._movementRoutes.get(state.token);
  const motion = state.surfaceMotion;
  if (!job?.layered || !motion) throw new Error('Surface movement has no approved route');
  const geometry = this.gameManager.terrainEngine.geometry;
  const point = job.current;
  const support = geometry.findSupport((point.gridX + 0.5) * 5, (point.gridY + 0.5) * 5, {
    belowFeet: point.heightFeet + 1e-6,
    clearanceFeet: 5,
    surfaceId: point.surfaceId,
  });
  if (!support || Math.abs(support.heightFeet - point.heightFeet) > 1e-5) {
    throw new Error('The approved floor changed before the creature could arrive');
  }
  motion.elapsed += delta;
  const progress = Math.min(motion.elapsed / motion.duration, 1);
  const world = this._lerp3(motion.start, motion.target, progress);
  if (motion.fall) world.y = motion.start.y;
  this._syncTokenAndMeshWorld(state, world);
  this._applyTokenGridFromWorld(state.token, world);
  if (progress < 1) return;
  state.surfaceMotion = null;
  if (motion.fall) {
    job.surfaceFalling = true;
    state.__fallResumeContext = null;
    state.lastRequestedGoal = null;
    state.climbContinuationGoal = null;
    const target = { ...motion.target };
    const drop = world.y - target.y;
    state.activeStep = {
      tokenEntry: state.token,
      mesh: state.mesh,
      startWorld: { ...world },
      targetWorld: target,
      startPosition: this._composeMeshPosition(world, state.mesh),
      targetPosition: this._composeMeshPosition(target, state.mesh),
      gridStartX: point.gridX,
      gridStartY: point.gridY,
      gridTargetX: point.gridX,
      gridTargetY: point.gridY,
      totalDistance: drop,
      traveled: 0,
      horizontalDistance: 0,
      horizontalTraveled: 0,
      heightDrop: drop,
      requiresFall: true,
      fallTriggered: false,
      fallTriggerProgress: 0,
      landingVariant: 'fall',
    };
    state.stepFinalized = false;
    state.phaseElapsed = 0;
    state.phase = 'walk';
    if (!this._maybeEnterFallPhase(state)) throw new Error('The ledge fall could not begin');
    return;
  }
  state.phase = 'idle';
  this._commitPlannedMovementCost(job);
  this.recordStablePlacement(state.token);
  if (job.index < job.points.length) this._beginSurfaceSegment(state, job);
  else {
    this._finishPlannedMovement(state.token);
    this._unlockTokenWorldAuthority(state);
    this._setAnimation(state.token, 'idle', { fadeIn: 0.2, fadeOut: 0.2 });
  }
  this._movementRangeDirty = true;
}

function completeSurfaceFall(token, job) {
  const state = this._movementStates.get(token);
  if (!job.surfaceFalling || (state && state.phase !== 'idle')) return;
  if (!this._hasReachedPlannedMovementGoal(token, job)) {
    throw new Error('The layered fall did not reach its approved landing surface');
  }
  job.surfaceFalling = false;
  this._commitPlannedMovementCost(job);
  this.recordStablePlacement(token);
  if (job.index < job.points.length) {
    const nextState = state || this._ensureMovementState(token);
    this._lockTokenWorldAuthority(nextState);
    this._beginSurfaceSegment(nextState, job);
  } else this._finishPlannedMovement(token);
}

function stopSurfaceMovement(state) {
  const token = state.token;
  const saved = this._savedPlacements?.get(token)?.placement;
  if (!saved) throw new Error('The interrupted surface movement has no safe checkpoint');
  this._syncTokenAndMeshWorld(state, saved.pose.world);
  token.gridX = saved.gridX;
  token.gridY = saved.gridY;
  state.surfaceMotion = null;
  state.phase = 'idle';
  this._finishPlannedMovement(token);
  this._unlockTokenWorldAuthority(state);
  this._setAnimation(token, 'idle', { fadeIn: 0.2, fadeOut: 0.2 });
  this._movementRangeDirty = true;
}

export function installSurfaceMotionMethods(prototype) {
  prototype.getTokenSurfaceRange = getTokenSurfaceRange;
  prototype._requestSurfaceMovement = requestSurfaceMovement;
  prototype._beginSurfaceSegment = beginSurfaceSegment;
  prototype._advanceSurfaceMotion = advanceSurfaceMotion;
  prototype._completeSurfaceFall = completeSurfaceFall;
  prototype._stopSurfaceMovement = stopSurfaceMovement;
}
