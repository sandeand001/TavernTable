import { getWallMovementTarget } from '../../../entities/creatures/TokenMovement.js';
import { logger, LOG_CATEGORY } from '../../../utils/logger/Logger.js';

const EPSILON = 1e-7;

// -- Accept the latest destination without abandoning an unfinished traversal --

function _queueMovementRedirect(token, destination) {
  const job = this._movementRoutes.get(token);
  const state = this._movementStates.get(token);
  if (!job && !['fall', 'fall-choice', 'fall-resolve', 'stand-up'].includes(state?.phase))
    return null;
  let target;
  if (destination.surface) {
    const { point, normal } = destination.surface;
    if (
      !point ||
      !normal ||
      ![point.x, point.y, point.z, normal.x, normal.y, normal.z].every(Number.isFinite)
    )
      throw new Error('Choose a valid map surface for the new destination');
    target = {
      ...destination,
      surface: { ...destination.surface, point: { ...point }, normal: { ...normal } },
    };
  } else {
    if (!Number.isInteger(destination.gridX) || !Number.isInteger(destination.gridY))
      throw new Error('Choose a valid grid destination');
    target = { ...destination };
  }
  if (!job) {
    this._landingMovementRedirects ||= new Map();
    this._landingMovementRedirects.set(token, { destination: target, allowance: null });
    return { goal: null, queued: true };
  }
  job.redirect = target;
  this._prepareMovementRedirect(token, job);
  this._logPathing('movement:redirect-queued', { tokenId: token.id, destination: job.redirect });
  return { goal: null, queued: true, speedMode: job.settings.mode };
}

function _prepareMovementRedirect(token, job) {
  if (job.redirectPrepared) return;
  const state = this._movementStates.get(token);
  if (
    !state ||
    job.flight ||
    job.physicalClimb ||
    job.layered ||
    state.traversal ||
    state.activeStep ||
    state.climbQueued
  )
    return;
  const wall = state.wallMotion;
  if (wall && !wall.holding) {
    if (
      !['surface', 'approach'].includes(wall.stage) ||
      wall.cursorY > wall.mantleStart.y + EPSILON ||
      (wall.direction < 0 && job.settings.mode === 'run')
    )
      return;
    const tile = this.gameManager.spatial.tileWorldSize;
    const steps = (wall.cursorY - wall.low.y) / tile;
    const next = wall.direction > 0 ? Math.ceil(steps - EPSILON) : Math.floor(steps + EPSILON);
    const offset =
      Math.abs(steps - next) < EPSILON && wall.stage === 'surface' ? wall.direction : 0;
    const height = wall.low.y + (next + offset) * tile;
    wall.targetY = Math.max(wall.low.y, Math.min(wall.mantleStart.y, height));
    wall.destination = 'hold';
    this._limitWallMovementBudget(state);
    job.index = job.points.length;
    job.redirectPrepared = true;
    return;
  }
  if (
    !state.pathActive ||
    !state.pathGoal?.world ||
    !['walk', 'start', 'stop'].includes(state.phase)
  )
    return;
  const start = job.segmentStartWorld;
  const target = state.pathGoal.world;
  const origin = this._mapWorldToGrid(start);
  if (!start || !origin) return;
  const dx = state.pathGoal.gridX - origin.gridX;
  const dy = state.pathGoal.gridY - origin.gridY;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (!steps) return;
  const world = this._resolveTokenWorldPosition(token);
  const distance = Math.hypot(target.x - start.x, target.z - start.z);
  if (!(distance > EPSILON)) return;
  const travelled = (Math.hypot(world.x - start.x, world.z - start.z) / distance) * steps;
  const rounded = Math.round(travelled);
  const next = Math.abs(travelled - rounded) < EPSILON ? rounded : Math.ceil(travelled);
  const completed = Math.max(0, Math.min(steps, next));
  const gridX = origin.gridX + Math.sign(dx) * completed;
  const gridY = origin.gridY + Math.sign(dy) * completed;
  const height = this._getTerrainHeight(gridX, gridY);
  const goalWorld = this.gameManager.spatial.gridToWorld(gridX + 0.5, gridY + 0.5, height);
  job.segmentCost *= completed / steps;
  job.current = { gridX, gridY, height, world: goalWorld };
  job.points = [job.current];
  job.index = 1;
  for (const goal of [state.pathGoal, state.lastRequestedGoal, state.__resumeProbe?.goal]) {
    if (!goal) continue;
    goal.gridX = gridX;
    goal.gridY = gridY;
    goal.world = { ...goalWorld };
  }
  job.redirectPrepared = true;
}

// -- Hand over at a completed, charged checkpoint --

function _applyMovementRedirect(token) {
  const job = this._movementRoutes.get(token);
  if (!job?.redirect) return false;
  job.redirectReady = true;
  const state = this._movementStates.get(token);
  if (state && state.phase !== 'climb-hold') {
    this._unlockTokenWorldAuthority(state);
    this._resetMovementState(state, { clearStopFlags: true });
  }
  const services = this.gameManager.characterServices;
  if (services?.library?.isSaving || services?.combat?.pending || services?.combat?.committing)
    return true;
  const destination = job.redirect;
  const allowance = Math.max(0, job.settings.speed - job.spent);
  job.continuing = true;
  this._finishPlannedMovement(token);
  const result = this._requestPlannedMovement(token, destination, { allowance, closest: true });
  if (!this._movementRoutes.has(token) && !job.combat?.active && token.characterSheetId)
    job.combat?.completeFreeMovement(token);
  this._movementRangeDirty = true;
  this._logPathing('movement:redirect-applied', {
    tokenId: token.id,
    allowance,
    destination,
    goal: result?.goal || null,
  });
  return true;
}

function _resumeLandingMovementRedirects() {
  const services = this.gameManager.characterServices;
  if (services?.library?.isSaving || services?.combat?.pending || services?.combat?.committing)
    return;
  for (const [token, redirect] of this._landingMovementRedirects || []) {
    if (this.isMovementInProgress(token)) continue;
    this._landingMovementRedirects.delete(token);
    if (!this.gameManager.placedTokens.includes(token)) continue;
    const result = this._requestPlannedMovement(token, redirect.destination, {
      allowance: redirect.allowance,
      closest: true,
    });
    if (!this._movementRoutes.has(token) && !services?.combat?.active && token.characterSheetId)
      services?.combat?.completeFreeMovement(token);
    this._logPathing('movement:landing-redirect-applied', {
      tokenId: token.id,
      goal: result?.goal || null,
    });
  }
}

// -- Choose the closest legal point from the already-validated reachable range --

function _closestMovementDestination(token, destination, range) {
  const gm = this.gameManager;
  const tile = gm.spatial.tileWorldSize;
  const requested = destination.surface?.point || {
    x: (destination.gridX + 0.5) * tile,
    y: this._resolveTokenWorldPosition(token).y,
    z: (destination.gridY + 0.5) * tile,
  };
  if (!['x', 'y', 'z'].every((axis) => Number.isFinite(requested[axis])))
    throw new Error('Choose a valid map surface for the new destination');
  if (!destination.surface && !range.layered && range.travelMode !== 'fly') {
    if (
      destination.gridX >= 0 &&
      destination.gridY >= 0 &&
      destination.gridX < gm.cols &&
      destination.gridY < gm.rows
    )
      requested.y =
        gm.getTerrainHeight(destination.gridX, destination.gridY) * gm.spatial.elevationUnit;
  }
  let best = null;
  const consider = (world, cost, target) => {
    const distance = Math.hypot(
      world.x - requested.x,
      world.y - requested.y,
      world.z - requested.z
    );
    if (
      !best ||
      distance < best.distance - EPSILON ||
      (Math.abs(distance - best.distance) <= EPSILON && cost < best.cost - EPSILON)
    )
      best = { distance, cost, target };
  };
  for (const cell of range.tiles.values()) {
    const world = cell.world || {
      x: (cell.gridX + 0.5) * tile,
      y: range.travelMode === 'fly' ? range.flightWorldY : cell.height * gm.spatial.elevationUnit,
      z: (cell.gridY + 0.5) * tile,
    };
    consider(
      world,
      cell.cost,
      range.layered
        ? {
            surface: {
              point: { ...world },
              normal: { x: 0, y: 1, z: 0 },
              surfaceId: cell.surfaceId,
            },
          }
        : { gridX: cell.gridX, gridY: cell.gridY }
    );
  }
  if (!range.layered && range.travelMode !== 'fly') {
    for (const face of range.walls.values()) {
      for (const band of face.bands) {
        const height = Math.max(
          band.minHeight,
          Math.min(band.maxHeight, requested.y / gm.spatial.elevationUnit)
        );
        const target = getWallMovementTarget(range, face.id, height);
        if (!target) continue;
        const dx = face.high.gridX - face.low.gridX;
        const dy = face.high.gridY - face.low.gridY;
        const point = {
          x: (face.low.gridX + 0.5 + dx * 0.5) * tile,
          y: target.height * gm.spatial.elevationUnit,
          z: (face.low.gridY + 0.5 + dy * 0.5) * tile,
        };
        consider(point, target.cost, { surface: { point, normal: { x: -dx, y: 0, z: -dy } } });
      }
    }
  }
  if (!best) throw new Error('No legal movement destination remains after changing course');
  if (best.distance > EPSILON) {
    logger.info(
      'Moving to the closest reachable point',
      { tokenId: token.id, requested: { ...requested }, destination: best.target, cost: best.cost },
      LOG_CATEGORY.INTERACTION
    );
  }
  return best.target;
}

// -- Installation --

export function installMovementRedirectMethods(prototype) {
  prototype._queueMovementRedirect = _queueMovementRedirect;
  prototype._prepareMovementRedirect = _prepareMovementRedirect;
  prototype._applyMovementRedirect = _applyMovementRedirect;
  prototype._resumeLandingMovementRedirects = _resumeLandingMovementRedirects;
  prototype._closestMovementDestination = _closestMovementDestination;
}
