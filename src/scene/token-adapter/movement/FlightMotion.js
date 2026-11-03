import {
  FEET_PER_GRID_SQUARE,
  FLIGHT_ELEVATION_STEPS,
  FLIGHT_TAKEOFF_FEET,
  FLIGHT_PACE_MULTIPLIER,
} from '../../../config/TokenMovementConfig.js';
import {
  buildFlightRange,
  buildMovementRange,
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
  let character = getTokenCharacterRecord(token);
  if (!character && token.characterSheetId) {
    const library = this.gameManager.characterServices?.library;
    if (!library) throw new Error('The flying creature has no character service');
    character = library.get(token.characterSheetId);
  }
  character ||= {
    speed: getTokenMovementSettings(token).speed,
    hp: token.hp || { current: 1 },
    conditions: getTokenConditions(token),
    fallTraits: getTokenFallTraits(token),
  };
  const combat = this.gameManager.characterServices?.combat;
  return combat ? combat.movementCharacter(token, character) : character;
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
  if (this.gameManager.campaignWorld && token.mapId !== this.gameManager.campaignMapId)
    return unavailable('Focus this creature on its own map before changing elevation.');
  if (this.gameManager.campaignMapFailure)
    return unavailable(this.gameManager.campaignMapFailure.message);
  if (this.gameManager.campaignViewBusy)
    return unavailable('Wait for the map view to finish changing.');
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
  const physicalHold = !!token.openingHold || !!token.surfaceHold;
  if (this.isWallAttached(token) && !physicalHold)
    return unavailable('Reach the ground before taking flight.');
  const cost = kind === 'takeoff' ? FLIGHT_TAKEOFF_FEET : feet;
  if (flightAllowance.call(this, token) + 1e-7 < cost) {
    return unavailable(`Not enough flying movement remains for ${cost} feet.`);
  }
  const world = this._resolveTokenWorldPosition(token);
  const targetY =
    world.y +
    ((kind === 'lower' ? -cost : cost) * this.gameManager.spatial.tileWorldSize) /
      FEET_PER_GRID_SQUARE;
  const groundY = groundHeight.call(this, token.gridX, token.gridY, world.y);
  if (kind === 'takeoff' && !physicalHold && Math.abs(world.y - groundY) > 1e-7) {
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

function groundHeight(gridX, gridY, belowWorldY = Infinity) {
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
  if (gm.campaignWorld) {
    if (!Number.isFinite(belowWorldY))
      throw new Error('Campaign flight requires a finite reference elevation');
    const world = {
      x: (gridX + 0.5) * gm.spatial.tileWorldSize,
      y: belowWorldY,
      z: (gridY + 0.5) * gm.spatial.tileWorldSize,
    };
    const support = gm.campaignWorld.findSupportBelow(
      gm.campaignWorld.toCampaignPosition(gm.campaignMapId, world),
      { mapId: gm.campaignMapId, geometry: gm.terrainEngine.geometry }
    );
    if (!support) throw new Error('Flight has no supported landing surface below this elevation');
    return gm.campaignWorld.toMapPosition(gm.campaignMapId, support.positionFeet).y;
  }
  if (gm.terrainEngine?.geometry.hasVolumes) {
    const scale = FEET_PER_GRID_SQUARE / gm.spatial.tileWorldSize;
    const support = gm.terrainEngine.geometry.findSupport((gridX + 0.5) * 5, (gridY + 0.5) * 5, {
      belowFeet: belowWorldY * scale + 1e-6,
    });
    if (!support) throw new Error('Flight has no supported landing surface below this elevation');
    return support.heightFeet / scale;
  }
  const height = gm.getTerrainHeight(gridX, gridY);
  if (!Number.isFinite(height)) throw new Error('Flight requires valid terrain heights');
  return height * gm.spatial.elevationUnit;
}

function flightCreatureCellBlocked(token, gridX, gridY, worldY, sweptTopY = null) {
  const gm = this.gameManager;
  const bodyHeight = gm.spatial.tileWorldSize;
  const topY = sweptTopY ?? worldY + bodyHeight;
  for (const other of gm.placedTokens) {
    if (other === token) continue;
    const position = this.getTokenViewPosition(other);
    const cell =
      gm.campaignWorld && other.mapId !== gm.campaignMapId
        ? gm.spatial.worldToGrid(position.x, position.z)
        : other;
    if (cell.gridX !== gridX || cell.gridY !== gridY) continue;
    const otherY = position.y;
    if (worldY < otherY + bodyHeight - 1e-7 && topY > otherY + 1e-7) {
      return true;
    }
  }
  return false;
}

function campaignFlightObstacles() {
  const gm = this.gameManager;
  const world = gm.campaignWorld;
  const references = world
    .listMaps()
    .filter(({ id }) => id !== gm.campaignMapId)
    .map(({ id }) => world.getMapGeometry(id));
  const cached = this._campaignFlightObstacles;
  if (
    cached?.world === world &&
    cached.mapId === gm.campaignMapId &&
    cached.references.length === references.length &&
    references.every((reference, index) => cached.references[index] === reference)
  )
    return cached.obstacles;
  const obstacles = world.getObstacles({ excludeMapId: gm.campaignMapId });
  this._campaignFlightObstacles = { world, mapId: gm.campaignMapId, references, obstacles };
  return obstacles;
}

function flightSolidCellBlocked(gridX, gridY, worldY, allowLanding = false, sweptTopY = null) {
  const gm = this.gameManager;
  if (gm.terrainEngine?.geometry.hasVolumes) {
    const scale = FEET_PER_GRID_SQUARE / gm.spatial.tileWorldSize;
    const inset = 1e-5;
    if (
      !gm.terrainEngine.geometry.isSpaceClear({
        min: { x: gridX * 5 + inset, y: worldY * scale, z: gridY * 5 + inset },
        max: {
          x: (gridX + 1) * 5 - inset,
          y: (sweptTopY ?? worldY + gm.spatial.tileWorldSize) * scale,
          z: (gridY + 1) * 5 - inset,
        },
      })
    )
      return true;
  }
  if (gm.campaignWorld) {
    const tile = gm.spatial.tileWorldSize;
    const inset = (tile / 5) * 1e-5;
    const body = gm.campaignWorld.toCampaignBounds(gm.campaignMapId, {
      min: { x: gridX * tile + inset, y: worldY, z: gridY * tile + inset },
      max: {
        x: (gridX + 1) * tile - inset,
        y: sweptTopY ?? worldY + tile,
        z: (gridY + 1) * tile - inset,
      },
    });
    if (
      campaignFlightObstacles
        .call(this)
        .some((bounds) =>
          ['x', 'y', 'z'].every(
            (axis) =>
              body.min[axis] < bounds.max[axis] - 1e-6 && body.max[axis] > bounds.min[axis] + 1e-6
          )
        )
    )
      return true;
  }
  const groundY = groundHeight.call(this, gridX, gridY, worldY);
  if (allowLanding ? worldY < groundY - 1e-7 : worldY <= groundY + 1e-7) return true;
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

function flightCellBlocked(token, gridX, gridY, worldY, allowLanding = false, sweptTopY = null) {
  return (
    flightSolidCellBlocked.call(this, gridX, gridY, worldY, allowLanding, sweptTopY) ||
    flightCreatureCellBlocked.call(this, token, gridX, gridY, worldY, sweptTopY)
  );
}

function getTokenFlightRange(token, allowance = null, { worldY = null } = {}) {
  const character = flightCharacter.call(this, token);
  if (!flightRules.call(this).flightAvailability(character).allowed) return null;
  const gm = this.gameManager;
  const origin = this._resolveTokenWorldPosition(token);
  if (worldY !== null && !Number.isFinite(worldY))
    throw new Error('Flight range requires a finite elevation');
  const world = worldY === null ? origin : { ...origin, y: worldY };
  const start = this._mapWorldToGrid(world) || token;
  const blocked = new Set();
  const occupied = new Set();
  for (let y = 0; y < gm.rows; y++) {
    for (let x = 0; x < gm.cols; x++) {
      if (flightSolidCellBlocked.call(this, x, y, world.y)) blocked.add(`${x},${y}`);
      else if (flightCreatureCellBlocked.call(this, token, x, y, world.y))
        occupied.add(`${x},${y}`);
    }
  }
  const inputs = {
    cols: gm.cols,
    rows: gm.rows,
    startGridX: start.gridX,
    startGridY: start.gridY,
    speed: Math.min(flightAllowance.call(this, token), allowance ?? Infinity),
    tileWorldSize: gm.spatial.tileWorldSize,
    elevationUnit: gm.spatial.elevationUnit,
    getHeight: (x, y) => gm.getTerrainHeight(x, y),
    blocked,
    occupied,
    flightWorldY: world.y,
  };
  if (gm.terrainEngine?.geometry.hasVolumes) {
    return {
      ...buildMovementRange({ ...inputs, elevationUnit: 0, getHeight: () => 0, mode: 'walk' }),
      travelMode: 'fly',
      flightWorldY: world.y,
    };
  }
  return buildFlightRange(inputs);
}

function getFlightStatus(token) {
  if (!token || !this.gameManager.placedTokens.includes(token)) return null;
  const character = flightCharacter.call(this, token);
  const speed = movementSpeed(character, 'fly');
  if (speed === 0 && !token.flightActive) return null;
  const world = this._resolveTokenWorldPosition(token);
  const gm = this.gameManager;
  let heightFeet;
  if (gm.campaignWorld) {
    const position = gm.campaignWorld.toCampaignPosition(token.mapId, world);
    const support = gm.campaignWorld.findSupportBelow(position, {
      mapId: gm.campaignMapId,
      geometry: gm.terrainEngine.geometry,
    });
    if (!support) throw new Error('Flight height requires a supported campaign surface');
    heightFeet = position.y - support.positionFeet.y;
  } else {
    const ground = groundHeight.call(this, token.gridX, token.gridY, world.y);
    heightFeet = ((world.y - ground) * FEET_PER_GRID_SQUARE) / gm.spatial.tileWorldSize;
  }
  return {
    flying: token.flightActive === true,
    speed,
    heightFeet,
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

function requestFlyToPoint(token, point, { closest = false } = {}) {
  return this._requestPlannedMovement(
    token,
    {
      surface: { point, normal: { x: 0, y: 1, z: 0 } },
      flightApproach: true,
    },
    { closest }
  );
}

function requestFlightApproach(token, target, range, { closest = false } = {}) {
  if (!target || !['x', 'y', 'z'].every((axis) => Number.isFinite(target[axis])))
    throw new Error('Flight approach requires a finite destination');
  const gm = this.gameManager;
  const world = this._resolveTokenWorldPosition(token);
  const scale = FEET_PER_GRID_SQUARE / gm.spatial.tileWorldSize;
  const vertical = Math.abs(target.y - world.y) * scale;
  if (!closest && vertical > range.speed + 1e-7)
    throw new Error('Not enough flying movement remains to reach this elevation');
  const verticalCost = Math.min(vertical, range.speed);
  const height = world.y + (Math.sign(target.y - world.y) * verticalCost) / scale;
  if (
    flightCellBlocked.call(
      this,
      token,
      token.gridX,
      token.gridY,
      Math.min(world.y, height),
      true,
      Math.max(world.y, height) + gm.spatial.tileWorldSize
    )
  )
    throw new Error('The flight approach has insufficient vertical clearance');
  const points = [];
  if (verticalCost > 1e-7)
    points.push({
      gridX: token.gridX,
      gridY: token.gridY,
      world: { ...world, y: height },
      cost: verticalCost,
    });
  if (verticalCost >= vertical - 1e-7) {
    const horizontal = getTokenFlightRange.call(this, token, range.speed - verticalCost, {
      worldY: height,
    });
    const grid = gm.spatial.worldToGrid(target.x, target.z);
    const goal = closest
      ? this._closestMovementDestination(
          token,
          { gridX: grid.gridX, gridY: grid.gridY },
          horizontal
        )
      : grid;
    const route = getMovementRoute(horizontal, goal.gridX, goal.gridY);
    if (!route) throw new Error('The opening is outside the clear flying movement range');
    for (const cell of route)
      points.push({
        ...cell,
        world: {
          x: (cell.gridX + 0.5) * gm.spatial.tileWorldSize,
          y: height,
          z: (cell.gridY + 0.5) * gm.spatial.tileWorldSize,
        },
        cost: verticalCost + cell.cost,
      });
  }
  if (!points.length) return { goal: null, cost: 0, distance: 0, speedMode: 'fly' };
  beginFlightMove.call(this, token, points, range);
  const goal = points.at(-1);
  return { goal, cost: goal.cost, distance: goal.cost, speedMode: 'fly' };
}

function requestFlyingMovement(token, destination, range, options = {}) {
  if (destination.flightApproach)
    return requestFlightApproach.call(this, token, destination.surface?.point, range, options);
  if (destination.surface) {
    const { point, normal } = destination.surface;
    if (!point || !normal || !['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis])))
      throw new Error('Choose open ground or a walkable surface as the flying destination');
    if (Math.abs(normal.y) < 0.45) {
      const offset = this.gameManager.spatial.tileWorldSize / 2;
      return requestFlightApproach.call(
        this,
        token,
        {
          x: point.x + normal.x * offset,
          y: point.y,
          z: point.z + normal.z * offset,
        },
        range,
        options
      );
    }
    if (normal.y < 0.9)
      throw new Error('Choose an exposed wall or a walkable surface, not a ceiling');
    const grid = this.gameManager.spatial.worldToGrid(point.x, point.z);
    if (point.y > range.flightWorldY + 1e-6)
      return requestFlightApproach.call(this, token, point, range, options);
    destination = { gridX: grid.gridX, gridY: grid.gridY };
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
  const settings = {
    ...getTokenMovementSettings(token),
    speed: range?.speed ?? flightAllowance.call(this, token),
  };
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
    flightSpeed: movementSpeed(flightCharacter.call(this, token), 'fly'),
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
  this.clearOpeningHoldVisual(token);
  delete token.openingHold;
  delete token.surfaceHold;
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
  const character = flightCharacter.call(this, token);
  const rules = flightRules.call(this);
  const supported = rules.canRemainAirborne(character);
  if (!motion) {
    if (!supported) dropFlight.call(this, state);
    return;
  }
  const job = this._movementRoutes.get(token);
  if (!job?.flight) throw new Error('The active flight has no committed movement route');
  if (
    !rules.flightAvailability(character).allowed ||
    movementSpeed(character, 'fly') < job.flightSpeed
  ) {
    stopFlightMovement.call(this, state);
    if (token.flightActive && !supported) dropFlight.call(this, state);
    return;
  }
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
  const landed =
    Math.abs(world.y - groundHeight.call(this, token.gridX, token.gridY, world.y)) < 1e-7;
  if (landed) {
    delete token.flightActive;
    this._unlockTokenWorldAuthority(state);
  }
  this.recordStablePlacement(token);
  if (this._applyMovementRedirect(token)) return;
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
function releaseOpeningHold(token) {
  if (!this.gameManager.placedTokens.includes(token) || (!token.openingHold && !token.surfaceHold))
    throw new Error('Let go requires a creature holding an opening');
  if (this.isMovementInProgress(token))
    throw new Error('Finish the current movement before letting go');
  dropFlight.call(this, this._ensureMovementState(token));
  return true;
}

function dropFlight(state, { point = null } = {}) {
  const token = state.token;
  const world = this._resolveTokenWorldPosition(token);
  const gm = this.gameManager;
  const support = gm.campaignWorld?.findSupportBelow(
    gm.campaignWorld.toCampaignPosition(token.mapId, world),
    { mapId: gm.campaignMapId, geometry: gm.terrainEngine.geometry }
  );
  if (gm.campaignWorld && !support) throw new Error('There is no physical surface below this drop');
  const target = point
    ? point.world
    : support
      ? gm.campaignWorld.toMapPosition(token.mapId, support.positionFeet)
      : { ...world, y: groundHeight.call(this, token.gridX, token.gridY, world.y) };
  let campaignLanding = null;
  if (support && support.mapId !== token.mapId) {
    const map = gm.campaignWorld.getMap(support.mapId);
    const source = gm.campaignWorld.getMap(token.mapId);
    campaignLanding = {
      mapId: support.mapId,
      placement: {
        gridX: Math.floor(support.world.x / map.grid.tileWorldSize),
        gridY: Math.floor(support.world.z / map.grid.tileWorldSize),
        facingAngle: token.facingAngle + ((map.quarterTurns - source.quarterTurns) * Math.PI) / 2,
        pose: { kind: 'ground', world: support.world, surfaceId: support.surfaceId },
      },
    };
  }
  const drop = Math.max(world.y - target.y, 0);
  if (!this.gameManager.characterServices?.falling) {
    throw new Error('The falling rules service is not ready');
  }
  if (!this.hasAnimation(token, 'fall') && !this.hasAnimation(token, 'fallLoop')) {
    throw new Error('The falling animations are not ready');
  }
  delete token.flightActive;
  this.clearOpeningHoldVisual(token);
  delete token.openingHold;
  delete token.surfaceHold;
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
    ...(campaignLanding ? { campaignLanding } : {}),
    ...(point
      ? {
          surfaceCatch: {
            mapId: point.mapId,
            placement: {
              gridX: Math.floor(point.pose.world.x / gm.spatial.tileWorldSize),
              gridY: Math.floor(point.pose.world.z / gm.spatial.tileWorldSize),
              facingAngle: token.facingAngle,
              pose: point.pose,
            },
          },
          catchingWall: point.pose.kind === 'grip',
        }
      : {}),
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
  prototype.requestFlyToPoint = requestFlyToPoint;
  prototype.releaseOpeningHold = releaseOpeningHold;
  prototype._dropToSurfacePoint = function (state, point) {
    if (point.pose.kind === 'ground') {
      const job = this._movementRoutes.get(state.token);
      const destination = { ...job.destination, frameMapId: this.gameManager.campaignMapId };
      job.continuing = true;
      this._commitPlannedMovementCost(job);
      const allowance = Math.max(0, job.settings.speed - job.spent);
      this._finishPlannedMovement(state.token);
      dropFlight.call(this, state);
      this._landingMovementRedirects ||= new Map();
      this._landingMovementRedirects.set(state.token, { destination, allowance });
    } else dropFlight.call(this, state, { point });
  };
  prototype.applyFlightCommand = applyFlightCommand;
  prototype.getFlightStatus = getFlightStatus;
  prototype._ensureFlightAnimations = ensureFlightAnimations;
  prototype._requestFlyingMovement = requestFlyingMovement;
  prototype._advanceFlightMotion = advanceFlightMotion;
  prototype._stopFlightMovement = stopFlightMovement;
}
