import {
  openingSurfaceGrip,
  planSurfaceClimb,
  wallClimbStarts,
  platformClimbWalls,
} from '../../../campaigns/CampaignSurfaceClimb.js';
import { getSurfaceRoute } from '../../../terrain/SurfaceNavigation.js';
import { wallHeightAtClock, wallClockAtHeight } from './WallMovement.js';
import { ConnectionUnavailableError } from '../../../campaigns/CampaignConnectionGeometry.js';
import {
  getTokenConditions,
  getTokenMovementSettings,
  facingAngleFromDirection,
} from '../../../entities/creatures/TokenMovement.js';

const clone = (value) => JSON.parse(JSON.stringify(value));

function surfaceClimbGrip(token) {
  if (token.surfaceHold) return clone(token.surfaceHold);
  if (!token.openingHold) return null;
  const gm = this.gameManager;
  return openingSurfaceGrip(
    gm.campaignWorld,
    token.mapId,
    token.world,
    token.openingHold.openingId,
    {
      mapId: gm.campaignMapId,
      geometry: gm.terrainEngine.geometry,
    }
  );
}

function getSurfaceClimbOption(token, surface, { allowance = null } = {}) {
  const gm = this.gameManager;
  const session = gm.characterServices.combat;
  try {
    if (!gm.placedTokens.includes(token) || token.mapId !== gm.campaignMapId)
      throw new ConnectionUnavailableError('Focus the creature on its own map before climbing');
    if (
      gm.campaignViewBusy ||
      gm.campaignMapFailure ||
      session.pending ||
      session.committing ||
      gm.characterServices.library.isSaving
    )
      throw new ConnectionUnavailableError('Finish the current action or save before climbing');
    if (session.active && session.activeToken !== token)
      throw new ConnectionUnavailableError('Only the creature taking its turn can climb');
    if (getTokenConditions(token).includes('prone'))
      throw new ConnectionUnavailableError('Stand up before climbing');
    const character =
      token.characterSheetId && gm.characterServices.library.get(token.characterSheetId);
    if (character && gm.characterServices.library.rules.movementImpaired(character))
      throw new ConnectionUnavailableError('This creature cannot climb');
    let speed = character
      ? session.active
        ? session.movementAllowance(token)
        : session.freeMovementAllowance(token)
      : getTokenMovementSettings(token).speed;
    const moving = this._movementRoutes.get(token);
    if (moving?.physicalClimb) speed = Math.max(0, moving.settings.speed - moving.current.cost);
    const grip = surfaceClimbGrip.call(this, token);
    const allowed = Math.min(speed, allowance ?? Infinity);
    const query = {
      mapId: gm.campaignMapId,
      geometry: gm.terrainEngine.geometry,
      allowanceFeet: allowed,
      occupants: gm.placedTokens.filter((actor) => actor !== token),
    };
    const plan = grip
      ? planSurfaceClimb(gm.campaignWorld, token.mapId, token.world, grip, surface, query)
      : approachClimbPlan.call(this, token, surface, allowed, query);
    return {
      allowed: true,
      plan,
      costFeet: plan.costFeet,
      actionLabel:
        surface.normal.y > 0.9
          ? surface.point.y > token.world.y
            ? 'Climb onto surface'
            : 'Climb down'
          : 'Climb to point',
    };
  } catch (error) {
    if (!(error instanceof ConnectionUnavailableError)) throw error;
    return {
      allowed: false,
      reason: error.message,
      actionLabel: 'Climb',
      insufficientMovement: error.code === 'insufficient-movement',
    };
  }
}

function approachClimbPlan(token, surface, allowance, query) {
  const gm = this.gameManager;
  if (allowance <= 0) {
    const error = new ConnectionUnavailableError('No climbing movement remains');
    error.code = 'insufficient-movement';
    throw error;
  }
  const walls =
    surface.normal.y > 0.9
      ? platformClimbWalls(gm.campaignWorld, token.mapId, surface, query)
      : [surface];
  const starts = [];
  for (const wall of walls) {
    try {
      starts.push(...wallClimbStarts(gm.campaignWorld, token.mapId, token.world, wall, query));
    } catch (error) {
      if (!(error instanceof ConnectionUnavailableError)) throw error;
    }
    if (surface.normal.y > 0.9) {
      const scale = 5 / gm.spatial.tileWorldSize;
      for (const entry of starts)
        entry.distance =
          scale *
          (Math.max(
            Math.abs(entry.world.x - token.world.x),
            Math.abs(entry.world.z - token.world.z)
          ) +
            2 *
              Math.max(
                Math.abs(surface.point.x - entry.world.x),
                Math.abs(surface.point.z - entry.world.z)
              ) +
            2 * Math.abs(surface.point.y - entry.world.y));
    }
  }
  starts.sort((a, b) => a.distance - b.distance);
  const range = this.getTokenSurfaceRange(token, allowance);
  for (const entry of starts) {
    const grid = gm.spatial.worldToGrid(entry.world.x, entry.world.z);
    const route = getSurfaceRoute(range, grid.gridX, grid.gridY, {
      heightFeet: (entry.world.y * 5) / gm.spatial.tileWorldSize,
    });
    if (!route) continue;
    const last = route.at(-1)?.world || token.world;
    const alignment =
      (Math.hypot(last.x - entry.world.x, last.z - entry.world.z) * 5) / gm.spatial.tileWorldSize;
    const approachCost = Math.ceil(((route.at(-1)?.cost || 0) + alignment) / 5 - 1e-6) * 5;
    if (approachCost >= allowance) continue;
    let plan;
    try {
      plan = planSurfaceClimb(
        gm.campaignWorld,
        token.mapId,
        entry.world,
        entry.grip,
        surface.normal.y > 0.9 ? surface : entry.destination,
        {
          ...query,
          allowanceFeet: allowance - approachCost,
        }
      );
    } catch (error) {
      if (error instanceof ConnectionUnavailableError) continue;
      throw error;
    }
    const points = route.map((cell) => ({
      ...cell,
      mapId: token.mapId,
      kind: 'approach',
      pose: { kind: 'ground', world: cell.world, surfaceId: cell.surfaceId },
    }));
    points.push({
      world: entry.world,
      mapId: token.mapId,
      cost: approachCost,
      kind: 'approach',
      pose: { kind: 'grip', world: entry.world, grip: entry.grip },
    });
    for (const point of plan.points) points.push({ ...point, cost: approachCost + point.cost });
    return { ...plan, points, costFeet: approachCost + plan.costFeet };
  }
  throw new ConnectionUnavailableError(
    'No supported approach and clear wall route is reachable with this movement'
  );
}

function requestSurfaceClimb(token, destination, options = {}) {
  const option = getSurfaceClimbOption.call(this, token, destination.surface, options);
  if (!option.allowed) throw new Error(option.reason);
  const { plan } = option;
  if (plan.gapFalls.length && !destination.confirmGapDrops)
    throw new Error('Confirm the opening-gap drops and wall catches before climbing');
  const data = this._tokenAnimationData.get(token);
  for (const clip of ['climbWall', 'climbWallDown', 'climb'])
    if (!data?.actions[clip]) throw new Error(`The ${clip} animation is not ready`);
  const gm = this.gameManager;
  const combat = gm.characterServices.combat;
  this.recordStablePlacement(token);
  const ticket = combat.active ? combat.beginMovement(token, plan.costFeet) : null;
  const state = this._ensureMovementState(token);
  this._clearPathState(state);
  this._releaseManualAnimationForMovement(token);
  this.clearOpeningHoldVisual(token);
  const startedHeld = !!token.openingHold || !!token.surfaceHold;
  delete token.openingHold;
  if (startedHeld) token.surfaceHold = clone(plan.grip);
  this._lockTokenWorldAuthority(state);
  const speed =
    options.allowance ??
    (token.characterSheetId
      ? combat.active
        ? combat.movementAllowance(token) + plan.costFeet
        : combat.freeMovementAllowance(token)
      : getTokenMovementSettings(token).speed);
  const job = {
    token,
    physicalClimb: true,
    grip: clone(plan.grip),
    points: plan.points,
    index: 0,
    current: null,
    spent: 0,
    plannedCost: plan.costFeet,
    settings: { ...getTokenMovementSettings(token), speed },
    combat,
    combatMove: ticket,
    destination,
  };
  this._movementRoutes.set(token, job);
  beginSurfaceClimbPoint.call(this, state, job);
  this._movementRangeDirty = true;
  return {
    goal: plan.points.at(-1),
    cost: plan.costFeet,
    distance: plan.costFeet,
    speedMode: 'climb',
  };
}

function beginSurfaceClimbPoint(state, job) {
  const point = job.points[job.index++];
  const start = { ...state.token.world };
  job.current = point;
  job.segmentStartWorld = start;
  job.segmentCost = point.cost - job.spent;
  job.segmentCharged = false;
  if (point.kind === 'catch' || point.kind === 'drop') {
    this._dropToSurfacePoint(state, point);
    return;
  }
  const data = this._tokenAnimationData.get(state.token);
  const gm = this.gameManager;
  if (
    !point.transient &&
    point.pose.kind === 'grip' &&
    !gm.campaignWorld.isSurfaceGripValid(state.token.mapId, point.world, point.pose.grip, {
      mapId: gm.campaignMapId,
      geometry: gm.terrainEngine.geometry,
    })
  )
    throw new Error('The climbing route no longer has physical wall support');
  const vertical = point.world.y - start.y;
  const wallClip =
    vertical < -1e-8
      ? 'climbWallDown'
      : vertical > 1e-8
        ? 'climbWall'
        : job.climbCycle?.clip ||
          (data.current === 'climbWallDown' ? 'climbWallDown' : 'climbWall');
  const clip =
    point.kind === 'mantle'
      ? 'climb'
      : point.kind === 'approach' || point.pose.kind === 'ground'
        ? 'walk'
        : wallClip;
  const root = data.rootMotion?.[clip === 'climbWallDown' ? 'wallDown' : 'wall'];
  const displacement =
    root && this._rootDisplacementToWorld(data.rootMotion.rootInfo, root.displacementLocal);
  const duration = this._extractClipDuration(data.actions[clip]);
  const pace =
    clip === 'walk'
      ? data.profile.walkSpeed
      : clip === 'climb'
        ? this.gameManager.spatial.tileWorldSize / duration
        : Math.abs(displacement?.y) / duration;
  if (!(pace > 0) || !Number.isFinite(pace))
    throw new Error('Physical climbing needs a valid authored animation pace');
  const grip = point.pose.grip || state.token.surfaceHold || job.grip;
  const world = this.gameManager.campaignWorld;
  const owner = world.getMap(grip.mapId);
  const normal = world.toMapPosition(
    state.token.mapId,
    world.toCampaignPosition(grip.mapId, {
      x: (grip.normal.x * owner.grid.tileWorldSize) / 5,
      y: 0,
      z: (grip.normal.z * owner.grid.tileWorldSize) / 5,
    })
  );
  const zero = world.toMapPosition(
    state.token.mapId,
    world.toCampaignPosition(grip.mapId, { x: 0, y: 0, z: 0 })
  );
  const angle =
    clip === 'walk'
      ? facingAngleFromDirection(point.world.x - start.x, point.world.z - start.z)
      : facingAngleFromDirection(zero.x - normal.x, zero.z - normal.z);
  this._applyOrientationImmediate(state.token, angle);
  state.surfaceClimb = {
    start,
    target: point.world,
    elapsed: 0,
    duration: Math.max(
      Math.hypot(point.world.x - start.x, point.world.y - start.y, point.world.z - start.z) / pace,
      0.1
    ),
    clip,
    clipDuration: duration,
    gripHeight: point.gripHeight ?? null,
  };
  if (clip === 'climbWall' || clip === 'climbWallDown') {
    const clock =
      job.climbCycle?.clip === clip
        ? job.climbCycle.clock
        : data.current === clip
          ? data.actions[clip].time
          : 0;
    const cycle = {
      wall: root,
      wallDuration: duration,
      wallHeight: Math.abs(displacement.y),
      loopDirection: 1,
      loopOriginY: 0,
    };
    const startDistance = wallHeightAtClock(cycle, clock);
    const distance = Math.hypot(
      point.world.x - start.x,
      point.world.y - start.y,
      point.world.z - start.z
    );
    const endClock = wallClockAtHeight(cycle, startDistance + distance);
    state.surfaceClimb.cycle = { ...cycle, startClock: clock, clock, startDistance, distance };
    state.surfaceClimb.duration = endClock - clock;
  }
  state.phase = 'surface-climb';
  if (clip === 'walk') {
    delete state.token.surfaceHold;
    this.clearOpeningHoldVisual(state.token);
    this._setAnimation(state.token, clip, { force: true, fadeIn: 0, fadeOut: 0 });
  } else {
    const time = state.surfaceClimb.cycle ? state.surfaceClimb.cycle.clock % duration : 0;
    this.syncSurfaceGripVisual(state.token, clip, time, state.surfaceClimb.gripHeight, 0.18);
  }
}

function advanceSurfaceClimb(state, delta) {
  let remaining = Math.max(0, delta);
  for (let transitions = 0; remaining > 1e-8 && transitions < 12; transitions++) {
    const motion = state.surfaceClimb;
    const job = this._movementRoutes.get(state.token);
    if (!motion || !job?.physicalClimb)
      throw new Error('The active physical climb has no approved route');
    const used = Math.min(remaining, Math.max(0, motion.duration - motion.elapsed));
    motion.elapsed += used;
    let ratio = motion.duration > 0 ? Math.min(1, motion.elapsed / motion.duration) : 1;
    if (motion.cycle) {
      const cycle = motion.cycle;
      cycle.clock = cycle.startClock + motion.elapsed;
      ratio =
        cycle.distance > 1e-8
          ? Math.min(
              1,
              Math.max(
                0,
                (wallHeightAtClock(cycle, cycle.clock) - cycle.startDistance) / cycle.distance
              )
            )
          : 1;
      job.climbCycle = { clip: motion.clip, clock: cycle.clock };
    }
    const completed = motion.elapsed >= motion.duration - 1e-8;
    if (completed) ratio = 1;
    const point = this._lerp3(motion.start, motion.target, ratio);
    this._syncTokenAndMeshWorld(state, point);
    this._applyTokenGridFromWorld(state.token, point);
    if (motion.clip !== 'walk') {
      this.syncSurfaceGripVisual(
        state.token,
        motion.clip,
        motion.cycle
          ? motion.cycle.clock % motion.clipDuration
          : motion.clip === 'climb'
            ? ratio * motion.clipDuration
            : motion.elapsed % motion.clipDuration,
        motion.gripHeight
      );
    }
    remaining -= used;
    if (!completed) return;
    completeSurfaceClimbPoint.call(this, state);
    if (state.phase !== 'surface-climb') return;
  }
  if (remaining > 1e-8 && state.phase === 'surface-climb')
    throw new Error('Physical climbing could not settle its animation waypoints');
}

function completeSurfaceClimbPoint(state) {
  const token = state.token;
  const job = this._movementRoutes.get(token);
  if (!job?.physicalClimb) throw new Error('The completed climb has no movement reservation');
  const point = job.current;
  this._syncTokenAndMeshWorld(state, point.world);
  this._applyTokenGridFromWorld(token, point.world);
  if (point.transient) {
    beginSurfaceClimbPoint.call(this, state, job);
    return;
  }
  if (point.pose.kind === 'grip') {
    token.surfaceHold = clone(point.pose.grip);
    state.phase = 'climb-hold';
    if (job.index === job.points.length || job.redirect) this.syncSurfaceGripVisual(token);
  } else {
    delete token.surfaceHold;
    this.clearOpeningHoldVisual(token);
    state.phase = 'idle';
    this._unlockTokenWorldAuthority(state);
    this._setAnimation(token, 'idle', { force: true, fadeIn: 0.1, fadeOut: 0.1 });
    this.syncProneState(token);
  }
  state.surfaceClimb = null;
  if (job.redirect) {
    point.cost = Math.min(job.plannedCost, Math.ceil(point.cost / 5 - 1e-6) * 5);
    job.segmentCost = point.cost - job.spent;
  }
  this._commitPlannedMovementCost(job);
  this.recordStablePlacement(token);
  const character =
    token.characterSheetId &&
    this.gameManager.characterServices.library.get(token.characterSheetId);
  if (
    token.surfaceHold &&
    character &&
    this.gameManager.characterServices.library.rules.movementImpaired(character)
  ) {
    this._finishPlannedMovement(token);
    this.releaseOpeningHold(token);
    return;
  }
  if (this._applyMovementRedirect(token)) return;
  if (job.index < job.points.length) {
    beginSurfaceClimbPoint.call(this, state, job);
    return;
  }
  const remaining = Math.max(0, job.settings.speed - job.spent);
  const target = job.destination.surface;
  const continueGround =
    !token.surfaceHold &&
    target.normal.y > 0.9 &&
    Math.hypot(target.point.x - token.world.x, target.point.z - token.world.z) >
      this.gameManager.spatial.tileWorldSize / 2;
  job.continuing = continueGround;
  this._finishPlannedMovement(token);
  if (continueGround)
    this._requestPlannedMovement(
      token,
      { surface: target },
      { allowance: remaining, closest: true }
    );
  this._movementRangeDirty = true;
}

function finishSurfaceCatch(state) {
  state.fallRules = null;
  state.fallLandingPending = false;
  state.fallTrajectory = null;
  state.activeStep = null;
  state.stepFinalized = true;
  completeSurfaceClimbPoint.call(this, state);
}

function stopSurfaceClimb(state) {
  const token = state.token;
  const saved = this._savedPlacements.get(token)?.placement;
  if (!saved) throw new Error('The interrupted physical climb has no safe checkpoint');
  state.surfaceClimb = null;
  this.clearOpeningHoldVisual(token);
  delete token.surfaceHold;
  delete token.openingHold;
  if (saved.pose.kind === 'grip') token.surfaceHold = clone(saved.pose.grip);
  if (saved.pose.kind === 'ledge') token.openingHold = { openingId: saved.pose.openingId };
  this._syncTokenAndMeshWorld(state, { ...saved.pose.world });
  token.gridX = saved.gridX;
  token.gridY = saved.gridY;
  token.facingAngle = saved.facingAngle;
  this._applyOrientationImmediate(token, saved.facingAngle);
  state.phase = token.surfaceHold || token.openingHold ? 'climb-hold' : 'idle';
  this._finishPlannedMovement(token);
  if (token.surfaceHold) this.syncSurfaceGripVisual(token);
  else if (token.openingHold) this.syncOpeningHoldVisual(token);
  else {
    this._unlockTokenWorldAuthority(state);
    this._setAnimation(token, 'idle', { force: true, fadeIn: 0, fadeOut: 0 });
  }
  this._movementRangeDirty = true;
}

export function installSurfaceClimbMethods(prototype) {
  prototype.getSurfaceClimbGrip = surfaceClimbGrip;
  prototype.getSurfaceClimbOption = getSurfaceClimbOption;
  prototype._requestSurfaceClimb = requestSurfaceClimb;
  prototype._advanceSurfaceClimb = advanceSurfaceClimb;
  prototype._finishSurfaceCatch = finishSurfaceCatch;
  prototype._stopSurfaceClimb = stopSurfaceClimb;
  prototype.requestClimbToSurface = function (token, surface, { confirmGapDrops = false } = {}) {
    return this._requestPlannedMovement(token, { surface, confirmGapDrops });
  };
  prototype._openingClimbSurface = function (token, connectionId, targetPose) {
    const gm = this.gameManager,
      world = gm.campaignWorld;
    const grip =
      targetPose.grip ||
      world.openingSurfaceGrip(token.mapId, targetPose.world, connectionId, {
        mapId: gm.campaignMapId,
        geometry: gm.terrainEngine.geometry,
      });
    const owner = world.getMap(grip.mapId),
      unit = owner.grid.tileWorldSize / 5;
    const contact = {
      x: grip.pointFeet.x * unit,
      y: grip.pointFeet.y * unit,
      z: grip.pointFeet.z * unit,
    };
    const point = world.toMapPosition(
      gm.campaignMapId,
      world.toCampaignPosition(owner.id, contact)
    );
    const outward = world.toMapPosition(
      gm.campaignMapId,
      world.toCampaignPosition(owner.id, {
        ...contact,
        x: contact.x + grip.normal.x * unit,
        z: contact.z + grip.normal.z * unit,
      })
    );
    const scale = 5 / gm.spatial.tileWorldSize;
    return {
      kind: 'wall',
      mapId: owner.id,
      gripOffsetFeet: grip.offsetFeet,
      point: { ...point, y: targetPose.world.y + gm.spatial.tileWorldSize },
      normal: {
        x: Math.round((outward.x - point.x) * scale),
        y: 0,
        z: Math.round((outward.z - point.z) * scale),
      },
    };
  };
  prototype.getClimbTowardOpeningOption = function (token, connectionId, targetPose) {
    return this.getSurfaceClimbOption(
      token,
      this._openingClimbSurface(token, connectionId, targetPose)
    );
  };
  prototype.requestClimbTowardOpening = function (token, connectionId, targetPose) {
    return this.requestClimbToSurface(
      token,
      this._openingClimbSurface(token, connectionId, targetPose)
    );
  };
  prototype.getSurfaceDropOption = function (token) {
    const gm = this.gameManager,
      combat = gm.characterServices.combat;
    const moving = this._movementRoutes.get(token);
    const allowed =
      !!(token.openingHold || token.surfaceHold) &&
      token.mapId === gm.campaignMapId &&
      !gm.campaignViewBusy &&
      !gm.campaignMapFailure &&
      (!this.isMovementInProgress(token) || !!moving?.physicalClimb) &&
      !combat.pending &&
      !combat.committing &&
      !gm.characterServices.library.isSaving &&
      (!combat.active || combat.activeToken === token);
    return {
      allowed,
      reason: allowed ? '' : 'Finish the current action and use this creature on its own turn',
    };
  };
  prototype.requestSurfaceDrop = function (token, surface) {
    const option = this.getSurfaceDropOption(token);
    if (!option.allowed) throw new Error(option.reason);
    if (this.isMovementInProgress(token))
      return this._queueMovementRedirect(token, {
        surface,
        dropHold: true,
        frameMapId: this.gameManager.campaignMapId,
      });
    const combat = this.gameManager.characterServices.combat;
    this.releaseOpeningHold(token);
    this._landingMovementRedirects ||= new Map();
    this._landingMovementRedirects.set(token, {
      destination: { surface, frameMapId: this.gameManager.campaignMapId },
      allowance: token.characterSheetId
        ? combat.active
          ? combat.movementAllowance(token)
          : combat.freeMovementAllowance(token)
        : null,
    });
  };
}
