import {
  facingAngleFromDirection,
  getTokenConditions,
  getTokenMovementSettings,
} from '../../../entities/creatures/TokenMovement.js';
import {
  buildSurfaceRange,
  getSurfaceRoute,
  isFloorSurface,
} from '../../../terrain/SurfaceNavigation.js';
import { MAX_STEP_HEIGHT_FEET } from '../../../config/TokenMovementConfig.js';
import {
  boundsIntersectSolid,
  sweptBodyCell,
  cellIntersectsSolid,
} from '../../../terrain/ConvexGeometry.js';
import { campaignLandingForSupport } from '../SavedPlacements.js';
import { FootprintIndex } from '../../../terrain/FootprintIndex.js';

export function navigationGeometry(gm) {
  const world = gm.campaignWorld;
  const mapId = gm.campaignMapId;
  const unit = gm.spatial.tileWorldSize / 5;
  const foreign = new FootprintIndex(world ? world.getObstacles({ excludeMapId: mapId }) : []);
  const supports = new Map();
  const local = (point) => ({ x: point.x * unit, y: point.y * unit, z: point.z * unit });
  const foreignClear = (bounds) => {
    if (!world) return true;
    const body = world.toCampaignBounds(mapId, { min: local(bounds.min), max: local(bounds.max) });
    return !foreign.inBounds(body).some((obstacle) => boundsIntersectSolid(body, obstacle, 1e-6));
  };
  return {
    get widthFeet() {
      return gm.terrainEngine.geometry.widthFeet;
    },
    get depthFeet() {
      return gm.terrainEngine.geometry.depthFeet;
    },
    isCurvedSupport: (id) => gm.terrainEngine.geometry.isCurvedSupport(id),
    getNavigationPoints: () => gm.terrainEngine.geometry.getNavigationPoints(),
    isGroundSpaceClear: (bounds, belowFeet) =>
      gm.terrainEngine.geometry.isGroundSpaceClear(bounds, belowFeet) && foreignClear(bounds),
    findSupport(x, z, options) {
      const key = `${x}:${z}:${options.belowFeet}:${options.clearanceFeet ?? 0}:${options.surfaceId ?? ''}`;
      if (supports.has(key)) return supports.get(key);
      let support = gm.terrainEngine.geometry.findSupport(x, z, options);
      const point =
        world && Number.isFinite(options.belowFeet)
          ? world.toCampaignPosition(mapId, {
              x: x * unit,
              y: options.belowFeet * unit,
              z: z * unit,
            })
          : null;
      const higherForeign =
        point &&
        (!support ||
          foreign
            .atPoint(point.x, point.z)
            .some(
              (obstacle) =>
                obstacle.min.x <= point.x + 1e-6 &&
                obstacle.max.x >= point.x - 1e-6 &&
                obstacle.min.z <= point.z + 1e-6 &&
                obstacle.max.z >= point.z - 1e-6 &&
                obstacle.min.y <= point.y + 1e-6 &&
                obstacle.max.y > point.y - options.belowFeet + support.heightFeet + 1e-6
            ));
      const physical =
        point && higherForeign
          ? world.findSupportBelow(point, { mapId, geometry: gm.terrainEngine.geometry })
          : null;
      if (!support && physical) {
        const local = world.toMapPosition(mapId, physical.positionFeet);
        support = {
          id: physical.surfaceId || 'terrain',
          heightFeet: local.y / unit,
          layerId: 'ground',
          requiresTransfer: true,
        };
      }
      if (
        support &&
        physical &&
        world.toMapPosition(mapId, physical.positionFeet).y / unit > support.heightFeet + 1e-6
      )
        support = null;
      supports.set(key, support);
      return support;
    },
    isSpaceClear(bounds) {
      return gm.terrainEngine.geometry.isSpaceClear(bounds) && foreignClear(bounds);
    },
    isSweptSpaceClear(start, end, radius, bottom, top) {
      if (!gm.terrainEngine.geometry.isSweptSpaceClear(start, end, radius, bottom, top))
        return false;
      if (!world) return true;
      const a = world.toCampaignPosition(mapId, local({ ...start, y: bottom }));
      const b = world.toCampaignPosition(mapId, local({ ...end, y: top }));
      const body = sweptBodyCell(a, b, radius, a.y + 1e-6, b.y - 1e-6);
      return !foreign.inBounds(body.bounds).some((obstacle) => cellIntersectsSolid(body, obstacle));
    },
  };
}

function getTokenSurfaceRange(token, allowance = null) {
  const gm = this.gameManager;
  const publicAllowance = gm.playerInput?.movementAllowance(token);
  if (gm.playerInput && publicAllowance === null) return null;
  const world = this._resolveTokenWorldPosition(token);
  const feetPerWorld = 5 / gm.spatial.tileWorldSize;
  gm.terrainEngine.configureGeometryScale(gm.spatial.elevationUnit * feetPerWorld);
  const combat = gm.characterServices?.combat;
  const settings = getTokenMovementSettings(token);
  const available = gm.playerInput
    ? publicAllowance
    : combat?.active
      ? combat.movementAllowance(token)
      : combat && token.characterSheetId
        ? combat.freeMovementAllowance(token)
        : settings.speed;
  const occupied = (gm.placedTokens || [])
    .filter(
      (other) =>
        other !== token &&
        (!gm.campaignWorld || gm.campaignWorld.sharesLocation(other.mapId, gm.campaignMapId))
    )
    .map((other) => {
      const position = this.getTokenViewPosition(other);
      const remote = gm.campaignWorld && other.mapId !== gm.campaignMapId;
      return {
        gridX: remote ? Math.floor(position.x / gm.spatial.tileWorldSize) : other.gridX,
        gridY: remote ? Math.floor(position.z / gm.spatial.tileWorldSize) : other.gridY,
        heightFeet: position.y * feetPerWorld,
      };
    });
  const range = buildSurfaceRange({
    geometry: navigationGeometry(gm),
    start: {
      gridX: token.gridX,
      gridY: token.gridY,
      heightFeet: world.y * feetPerWorld,
      xFeet: world.x * feetPerWorld,
      zFeet: world.z * feetPerWorld,
    },
    speedFeet: Math.min(available, allowance ?? Infinity),
    prone: getTokenConditions(token).includes('prone'),
    isOccupied: (x, y, height, bodyHeight) =>
      occupied.some(
        (other) =>
          other.gridX === x &&
          other.gridY === y &&
          height < other.heightFeet + bodyHeight - 1e-7 &&
          height + bodyHeight > other.heightFeet + 1e-7
      ),
  });
  for (const cell of range.tiles.values()) {
    cell.world = {
      x: (cell.xFeet ?? (cell.gridX + 0.5) * 5) / feetPerWorld,
      y: cell.heightFeet / feetPerWorld,
      z: (cell.zFeet ?? (cell.gridY + 0.5) * 5) / feetPerWorld,
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
      !isFloorSurface(picked) ||
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
          surfaceId: range.geometry.isCurvedSupport?.(picked.surfaceId) ? picked.surfaceId : null,
          heightFeet: range.geometry.isCurvedSupport?.(picked.surfaceId)
            ? null
            : (picked.point.y * 5) / gm.spatial.tileWorldSize,
        }
      : {}
  );
  if (!route) {
    if (gm.campaignWorld && picked?.point.y > token.world.y + 1e-6)
      return this._requestSurfaceClimb(token, destination);
    throw new Error('That floor is outside the reachable supported movement range');
  }
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
    followSurface:
      job.range.geometry.isCurvedSupport?.(point.surfaceId) ||
      job.range.geometry.isCurvedSupport?.(
        job.index === 1 ? job.range.start.surfaceId : job.points[job.index - 2].surfaceId
      ),
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
  const geometry = job.range.geometry;
  const point = job.current;
  const support = geometry.findSupport(
    point.xFeet ?? (point.gridX + 0.5) * 5,
    point.zFeet ?? (point.gridY + 0.5) * 5,
    {
      belowFeet: point.heightFeet + 1e-6,
      clearanceFeet: 5,
      surfaceId: point.surfaceId,
    }
  );
  if (!support || Math.abs(support.heightFeet - point.heightFeet) > 1e-5) {
    throw new Error('The approved floor changed before the creature could arrive');
  }
  motion.elapsed += delta;
  const progress = Math.min(motion.elapsed / motion.duration, 1);
  const world = this._lerp3(motion.start, motion.target, progress);
  if (motion.fall) world.y = motion.start.y;
  else if (motion.followSurface) {
    const scale = 5 / this.gameManager.spatial.tileWorldSize;
    const underfoot = geometry.findSupport(world.x * scale, world.z * scale, {
      belowFeet: Math.max(motion.start.y, motion.target.y) * scale + MAX_STEP_HEIGHT_FEET,
      clearanceFeet: 5,
    });
    if (!underfoot) throw new Error('The curved route no longer has clear floor support');
    world.y = underfoot.heightFeet / scale;
  }
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
    const gm = this.gameManager;
    const support = gm.campaignWorld?.findSupportBelow(
      gm.campaignWorld.toCampaignPosition(state.token.mapId, { ...target, y: world.y }),
      { mapId: gm.campaignMapId, geometry: gm.terrainEngine.geometry }
    );
    const campaignLanding = campaignLandingForSupport(gm.campaignWorld, state.token, support);
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
      ...(campaignLanding ? { campaignLanding } : {}),
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
  if (this._applyMovementRedirect(state.token)) return;
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
  if (this._applyMovementRedirect(token)) return;
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
