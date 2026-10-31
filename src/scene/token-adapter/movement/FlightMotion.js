import {
  FEET_PER_GRID_SQUARE,
  FLIGHT_ELEVATION_STEPS,
  FLIGHT_TAKEOFF_FEET,
  FLIGHT_PACE_MULTIPLIER,
} from '../../../config/TokenMovementConfig.js';
import {
  buildFlightRange,
  facingAngleFromDirection,
  getMovementRoute,
  getTokenCharacterRecord,
  getTokenConditions,
  getTokenFallTraits,
  getTokenMovementSettings,
} from '../../../entities/creatures/TokenMovement.js';
import { flightAvailability, movementSpeed } from '../../../rules/flight.js';
import { canRemainAirborne } from '../../../rules/falling.js';

const PROTOTYPE_FLIGHT_RULES = Object.freeze({ flightAvailability, canRemainAirborne });

function flightRules() {
  const library =
    this.gameManager.characterServices?.library || this.gameManager.campaignContext?.library;
  return library ? library.rules : PROTOTYPE_FLIGHT_RULES;
}

// -- Eligibility and clearance --
function flightCharacter(token) {
  const character = getTokenCharacterRecord(token);
  if (character) return character;
  if (token.characterSheetId) {
    const library = this.gameManager.characterServices?.library;
    if (!library) throw new Error('The flying creature has no character service');
    return library.get(token.characterSheetId);
  }
  return {
    speed: getTokenMovementSettings(token).speed,
    hp: token.hp || { current: 1 },
    conditions: getTokenConditions(token),
    fallTraits: getTokenFallTraits(token),
  };
}

function flightAllowance(token) {
  const combat = this.gameManager.characterServices?.combat;
  if (combat?.active) return combat.movementAllowance(token, 'fly');
  if (combat && token.characterSheetId) return combat.freeMovementAllowance(token, 'fly');
  return movementSpeed(flightCharacter.call(this, token), 'fly');
}

function getFlightCommandAvailability(token, kind, feet = FLIGHT_TAKEOFF_FEET) {
  const flying = token?.flightActive === true;
  const character = token ? flightCharacter.call(this, token) : null;
  const visible =
    !!character &&
    (flying || movementSpeed(character, 'fly') > 0) &&
    (kind === 'takeoff' ? !flying : flying);
  const unavailable = (reason) => ({ visible, allowed: false, reason });
  if (!visible) return unavailable('This flight command is not available.');
  if (!this.gameManager.placedTokens.includes(token)) {
    return unavailable('This creature is no longer on the board.');
  }
  if (this.gameManager.sceneAutosave?.ready === false) {
    return unavailable('Wait for the campaign to finish opening.');
  }
  if (!token.__threeMesh || !this._tokenAnimationData.has(token)) {
    return unavailable('Wait for this creature to finish loading.');
  }
  if (!this.gameManager.is3DModeActive?.()) {
    return unavailable('Flight requires the 3D board view.');
  }
  const falling = this.gameManager.characterServices?.falling;
  if (typeof falling?.begin !== 'function' || typeof falling?.land !== 'function') {
    return unavailable('The falling rules service is not ready.');
  }
  const combat = this.gameManager.characterServices?.combat;
  if (combat?.active && combat.activeToken !== token) {
    return unavailable('This creature is not taking its turn.');
  }
  if (
    this.isMovementInProgress(token) ||
    this._isManualMotionInProgress(token) ||
    combat?.pending ||
    combat?.committing ||
    this.gameManager.characterServices?.library?.isSaving
  ) {
    return unavailable('Finish the current action or movement first.');
  }
  if (kind === 'drop') {
    if (!this.hasAnimation(token, 'fall') && !this.hasAnimation(token, 'fallLoop')) {
      return unavailable('Wait for the falling animations to finish loading.');
    }
    return { visible, allowed: true, cost: 0 };
  }
  const permission = flightRules.call(this).flightAvailability(character);
  if (!permission.allowed) return unavailable(permission.reason);
  if (this.isWallAttached(token)) return unavailable('Reach the ground before taking flight.');
  const cost = kind === 'takeoff' ? FLIGHT_TAKEOFF_FEET : feet;
  if (flightAllowance.call(this, token) + 1e-7 < cost) {
    return unavailable(`Not enough flying movement remains for ${cost} feet.`);
  }
  const world = this._resolveTokenWorldPosition(token);
  const targetY =
    world.y +
    ((kind === 'lower' ? -cost : cost) * this.gameManager.spatial.tileWorldSize) /
      FEET_PER_GRID_SQUARE;
  const groundY = groundHeight.call(this, token.gridX, token.gridY);
  if (kind === 'takeoff' && Math.abs(world.y - groundY) > 1e-7) {
    return unavailable('Reach the ground before taking flight.');
  }
  if (targetY < groundY - 1e-7) return unavailable('That descent would go below the ground.');
  if (
    flightCellBlocked.call(
      this,
      token,
      token.gridX,
      token.gridY,
      Math.min(world.y, targetY),
      true,
      Math.max(world.y, targetY) + this.gameManager.spatial.tileWorldSize
    )
  ) {
    return unavailable('There is not enough clearance at that elevation.');
  }
  return { visible, allowed: true, cost };
}

function groundHeight(gridX, gridY) {
  const gm = this.gameManager;
  if (
    !Number.isInteger(gridX) ||
    !Number.isInteger(gridY) ||
    gridX < 0 ||
    gridY < 0 ||
    gridX >= gm.cols ||
    gridY >= gm.rows ||
    !Number.isFinite(gm.spatial?.tileWorldSize) ||
    gm.spatial.tileWorldSize <= 0 ||
    !Number.isFinite(gm.spatial.elevationUnit) ||
    gm.spatial.elevationUnit < 0
  ) {
    throw new Error('Flight requires a valid board position and terrain scale');
  }
  const height = gm.getTerrainHeight(gridX, gridY);
  if (!Number.isFinite(height)) throw new Error('Flight requires valid terrain heights');
  return height * gm.spatial.elevationUnit;
}

function flightCellBlocked(token, gridX, gridY, worldY, allowLanding = false, sweptTopY = null) {
  const gm = this.gameManager;
  const groundY = groundHeight.call(this, gridX, gridY);
  if (allowLanding ? worldY < groundY - 1e-7 : worldY <= groundY + 1e-7) return true;
  const bodyHeight = gm.spatial.tileWorldSize;
  const topY = sweptTopY ?? worldY + bodyHeight;
  for (const other of gm.placedTokens) {
    if (other === token || other.gridX !== gridX || other.gridY !== gridY) continue;
    const otherY = this._resolveTokenWorldPosition(other).y;
    if (worldY < otherY + bodyHeight - 1e-7 && topY > otherY + 1e-7) {
      return true;
    }
  }
  for (const entry of gm.terrainManager?.placeables?.get(`${gridX},${gridY}`) || []) {
    if (!['plant', 'structure'].includes(entry.placeableType)) continue;
    const handle = entry.__meshPoolHandle;
    const pool = gm.placeableMeshPool;
    const group = handle && pool?._groups?.get(handle.key);
    const metadata = handle && pool?._metadata?.get(handle.key)?.get(handle.index);
    const bounds = group?.supportBounds || group?.instancedMesh?.geometry?.boundingBox;
    // Unmeasured solid obstacles remain blocked rather than becoming passable in flight.
    if (
      !bounds ||
      !metadata ||
      !Number.isFinite(bounds.max.y) ||
      !Number.isFinite(metadata.heightOffset) ||
      !Number.isFinite(metadata.scale?.y) ||
      metadata.scale.y <= 0
    )
      return true;
    const top = groundY + metadata.heightOffset + bounds.max.y * metadata.scale.y;
    if (worldY < top + 1e-7) return true;
  }
  return false;
}

function getTokenFlightRange(token) {
  const character = flightCharacter.call(this, token);
  if (!flightRules.call(this).flightAvailability(character).allowed) return null;
  const gm = this.gameManager;
  const world = this._resolveTokenWorldPosition(token);
  const start = this._mapWorldToGrid(world) || token;
  const blocked = new Set();
  for (let y = 0; y < gm.rows; y++) {
    for (let x = 0; x < gm.cols; x++) {
      if (flightCellBlocked.call(this, token, x, y, world.y)) blocked.add(`${x},${y}`);
    }
  }
  return buildFlightRange({
    cols: gm.cols,
    rows: gm.rows,
    startGridX: start.gridX,
    startGridY: start.gridY,
    speed: flightAllowance.call(this, token),
    tileWorldSize: gm.spatial.tileWorldSize,
    elevationUnit: gm.spatial.elevationUnit,
    getHeight: (x, y) => gm.getTerrainHeight(x, y),
    blocked,
    flightWorldY: world.y,
  });
}

function getFlightStatus(token) {
  if (!token || !this.gameManager.placedTokens.includes(token)) return null;
  const character = flightCharacter.call(this, token);
  const speed = movementSpeed(character, 'fly');
  if (speed === 0 && !token.flightActive) return null;
  const world = this._resolveTokenWorldPosition(token);
  return {
    flying: token.flightActive === true,
    speed,
    heightFeet:
      ((world.y - groundHeight.call(this, token.gridX, token.gridY)) * FEET_PER_GRID_SQUARE) /
      this.gameManager.spatial.tileWorldSize,
    remaining: flightAllowance.call(this, token),
  };
}

// -- Paid takeoff, elevation changes and horizontal routes --
async function ensureFlightAnimations(token) {
  const data = this._tokenAnimationData.get(token);
  if (!data) throw new Error('Wait for the creature animations to finish loading');
  if (data.actions.hover && data.actions.fly) return;
  if (data.flightAnimationPromise) return data.flightAnimationPromise;
  data.flightAnimationPromise = (async () => {
    const three = await this._getThree();
    if (!three) throw new Error('Flight animations require Three.js');
    for (const key of ['hover', 'fly']) {
      if (data.actions[key]) continue;
      const descriptor = data.animationsConfig?.[key];
      if (!descriptor) throw new Error(`The ${key} flight animation is not configured`);
      const clip = await this._resolveAnimationClip(descriptor, null, data.clipOptions);
      if (!clip) throw new Error(`The ${key} flight animation could not be loaded`);
      const action = data.mixer.clipAction(clip);
      this._configureAction(action, descriptor, three, { loop: 'repeat' });
      data.actions[key] = action;
      data.clips[key] = clip.duration;
    }
  })().finally(() => {
    delete data.flightAnimationPromise;
  });
  return data.flightAnimationPromise;
}

async function applyFlightCommand(token, kind, feet = FLIGHT_TAKEOFF_FEET) {
  if (
    !['takeoff', 'raise', 'lower', 'drop'].includes(kind) ||
    !FLIGHT_ELEVATION_STEPS.includes(feet)
  ) {
    throw new Error('Flight requires a valid command and 5, 10, 15 or 20 feet');
  }
  let availability = this.getFlightCommandAvailability(token, kind, feet);
  if (!availability.allowed) throw new Error(availability.reason);
  if (kind === 'drop') {
    dropFlight.call(this, this._ensureMovementState(token));
    return true;
  }
  await ensureFlightAnimations.call(this, token);
  availability = this.getFlightCommandAvailability(token, kind, feet);
  if (!availability.allowed) throw new Error(availability.reason);
  const world = this._resolveTokenWorldPosition(token);
  const cost = availability.cost;
  const target = {
    ...world,
    y:
      world.y +
      ((kind === 'lower' ? -cost : cost) * this.gameManager.spatial.tileWorldSize) /
        FEET_PER_GRID_SQUARE,
  };
  beginFlightMove.call(this, token, [
    { gridX: token.gridX, gridY: token.gridY, world: target, cost },
  ]);
  return true;
}

function requestFlyingMovement(token, destination, range) {
  if (destination.surface) {
    throw new Error('Raise or lower flight elevation before moving over that terrain face');
  }
  const route = getMovementRoute(range, destination.gridX, destination.gridY);
  if (!route) throw new Error('That destination is outside the clear flying movement range');
  if (!route.length) return { goal: null, cost: 0, distance: 0, speedMode: 'fly' };
  const tileSize = this.gameManager.spatial.tileWorldSize;
  const points = route.map((cell) => ({
    ...cell,
    world: {
      x: (cell.gridX + 0.5) * tileSize,
      y: range.flightWorldY,
      z: (cell.gridY + 0.5) * tileSize,
    },
  }));
  beginFlightMove.call(this, token, points, range);
  const cost = points.at(-1).cost;
  return { goal: points.at(-1), cost, distance: cost, speedMode: 'fly' };
}

function beginFlightMove(token, points, range = null) {
  this.recordStablePlacement(token);
  const combat = this.gameManager.characterServices?.combat;
  const settings = { ...getTokenMovementSettings(token), speed: flightAllowance.call(this, token) };
  const profile = this._tokenAnimationData.get(token)?.profile;
  const pace = settings.mode === 'run' ? profile?.runSpeed : profile?.walkSpeed;
  if (!Number.isFinite(pace) || pace <= 0) {
    throw new Error('Flight requires a valid, loaded animation pace');
  }
  const cost = points.at(-1).cost;
  const ticket = combat?.active ? combat.beginMovement(token, cost, 'fly') : null;
  const state = this._ensureMovementState(token);
  const job = {
    token,
    flight: true,
    points,
    index: 0,
    current: null,
    settings,
    range,
    spent: 0,
    plannedCost: cost,
    combat,
    combatMove: ticket,
  };
  token.flightActive = true;
  this._clearPathState(state);
  state.forwardKeys.clear();
  state.backwardKeys.clear();
  this._releaseManualAnimationForMovement(token);
  this._lockTokenWorldAuthority(state);
  this._movementRoutes.set(token, job);
  beginFlightSegment.call(this, state, job);
  this._movementRangeDirty = true;
}

function beginFlightSegment(state, job) {
  const point = job.points[job.index++];
  const start = this._resolveTokenWorldPosition(state.token);
  job.current = point;
  job.segmentStartWorld = { ...start };
  job.segmentCost = point.cost - job.spent;
  job.segmentCharged = false;
  const dx = point.world.x - start.x;
  const dz = point.world.z - start.z;
  const horizontal = Math.hypot(dx, dz) > 1e-7;
  if (horizontal) {
    this._applyOrientationImmediate(state.token, facingAngleFromDirection(dx, dz));
  }
  const profile = this._tokenAnimationData.get(state.token).profile;
  const speed =
    (job.settings.mode === 'run' ? profile.runSpeed : profile.walkSpeed) * FLIGHT_PACE_MULTIPLIER;
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Flight animation pace is invalid');
  state.flightMotion = {
    start,
    target: point.world,
    elapsed: 0,
    duration: Math.max(Math.hypot(dx, point.world.y - start.y, dz) / speed, 0.16),
  };
  state.phase = 'flight';
  this._setAnimation(state.token, horizontal ? 'fly' : 'hover', {
    fadeIn: 0.25,
    fadeOut: 0.25,
  });
}

function advanceFlightMotion(state, delta) {
  const token = state.token;
  const motion = state.flightMotion;
  if (!motion) {
    if (!flightRules.call(this).canRemainAirborne(flightCharacter.call(this, token)))
      dropFlight.call(this, state);
    return;
  }
  const job = this._movementRoutes.get(token);
  if (!job?.flight) throw new Error('The active flight has no committed movement route');
  motion.elapsed += delta;
  const progress = Math.min(motion.elapsed / motion.duration, 1);
  const world = this._lerp3(motion.start, motion.target, progress);
  if (
    flightCellBlocked.call(
      this,
      token,
      job.current.gridX,
      job.current.gridY,
      Math.min(motion.start.y, motion.target.y),
      true,
      Math.max(motion.start.y, motion.target.y) + this.gameManager.spatial.tileWorldSize
    )
  ) {
    throw new Error('The flight destination is no longer clear');
  }
  this._syncTokenAndMeshWorld(state, world);
  this._applyTokenGridFromWorld(token, world);
  if (progress < 1) return;
  state.flightMotion = null;
  state.phase = 'idle';
  this._commitPlannedMovementCost(job);
  const landed = Math.abs(world.y - groundHeight.call(this, token.gridX, token.gridY)) < 1e-7;
  if (landed) {
    delete token.flightActive;
    this._unlockTokenWorldAuthority(state);
  }
  this.recordStablePlacement(token);
  const canContinue = flightRules.call(this).canRemainAirborne(flightCharacter.call(this, token));
  if (job.index < job.points.length && canContinue && !landed) {
    beginFlightSegment.call(this, state, job);
    return;
  }
  this._finishPlannedMovement(token);
  this._setAnimation(token, landed ? 'idle' : 'hover', { fadeIn: 0.25, fadeOut: 0.25 });
  this._movementRangeDirty = true;
  if (!landed && !canContinue) dropFlight.call(this, state);
}

function stopFlightMovement(state) {
  const token = state.token;
  const saved = this._savedPlacements?.get(token)?.placement;
  if (!saved) throw new Error('The interrupted flight has no stable checkpoint');
  this._syncTokenAndMeshWorld(state, saved.pose.world);
  token.gridX = saved.gridX;
  token.gridY = saved.gridY;
  state.flightMotion = null;
  state.phase = 'idle';
  if (saved.pose.kind === 'flight') token.flightActive = true;
  else {
    delete token.flightActive;
    this._unlockTokenWorldAuthority(state);
  }
  this._finishPlannedMovement(token);
  this._setAnimation(token, token.flightActive ? 'hover' : 'idle', { fadeIn: 0.25, fadeOut: 0.25 });
  this._movementRangeDirty = true;
}

// -- Relinquished flight uses the shared falling lifecycle --
function dropFlight(state) {
  const token = state.token;
  const world = this._resolveTokenWorldPosition(token);
  const target = { ...world, y: groundHeight.call(this, token.gridX, token.gridY) };
  const drop = Math.max(world.y - target.y, 0);
  if (!this.gameManager.characterServices?.falling) {
    throw new Error('The falling rules service is not ready');
  }
  if (!this.hasAnimation(token, 'fall') && !this.hasAnimation(token, 'fallLoop')) {
    throw new Error('The falling animations are not ready');
  }
  delete token.flightActive;
  this._clearPathState(state);
  state.forwardKeys.clear();
  state.backwardKeys.clear();
  state.__fallResumeContext = null;
  state.lastRequestedGoal = null;
  state.climbContinuationGoal = null;
  state.activeStep = {
    tokenEntry: token,
    mesh: state.mesh,
    startWorld: { ...world },
    targetWorld: target,
    startPosition: this._composeMeshPosition(world, state.mesh),
    targetPosition: this._composeMeshPosition(target, state.mesh),
    gridStartX: token.gridX,
    gridStartY: token.gridY,
    gridTargetX: token.gridX,
    gridTargetY: token.gridY,
    totalDistance: drop,
    traveled: 0,
    horizontalDistance: 0,
    horizontalTraveled: 0,
    heightDrop: drop,
    requiresFall: true,
    fallTriggered: false,
    fallTriggerProgress: 0,
    ignoreFlight: true,
    landingVariant: 'fall',
  };
  state.stepFinalized = false;
  state.phaseElapsed = 0;
  this._lockTokenWorldAuthority(state);
  if (!this._maybeEnterFallPhase(state)) throw new Error('The flight drop could not begin');
  this._movementRangeDirty = true;
}

export function installFlightMotionMethods(prototype) {
  prototype.getFlightCommandAvailability = getFlightCommandAvailability;
  prototype.getTokenFlightRange = getTokenFlightRange;
  prototype.applyFlightCommand = applyFlightCommand;
  prototype.getFlightStatus = getFlightStatus;
  prototype._ensureFlightAnimations = ensureFlightAnimations;
  prototype._requestFlyingMovement = requestFlyingMovement;
  prototype._advanceFlightMotion = advanceFlightMotion;
  prototype._stopFlightMovement = stopFlightMovement;
}
