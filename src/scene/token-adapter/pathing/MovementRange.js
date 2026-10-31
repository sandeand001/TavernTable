import {
  buildMovementRange,
  getMovementRoute,
  getTokenMovementSettings,
  getWallMovementTarget,
} from '../../../entities/creatures/TokenMovement.js';
import { MAX_STANDARD_CLIMB_LEVELS } from '../../../config/token-adapter/MannequinConfig.js';
import { GameErrors } from '../../../utils/error/ErrorHandler.js';
import { MovementRangeOverlay } from '../MovementRangeOverlay.js';
import {
  FEET_PER_GRID_SQUARE,
  MAX_STEP_HEIGHT_FEET,
  MAX_LOW_LEDGE_HEIGHT_FEET,
} from '../../../config/TokenMovementConfig.js';

// ── Movement Allowance & Reachable Tiles ──────────────────────
function isMovementInProgress(token) {
  const state = this._movementStates.get(token);
  return (
    this._isManualMotionInProgress(token) ||
    this._movementRoutes.has(token) ||
    !!(state && ((state.phase !== 'idle' && state.phase !== 'climb-hold') || state.pathActive))
  );
}

function applyMovementStyle(token) {
  try {
    const job = this._movementRoutes.get(token);
    if (!job) {
      this._movementRangeDirty = true;
      return;
    }
    const settings = getTokenMovementSettings(token);
    const previousMode = job.settings.mode;
    job.settings.mode = settings.mode;
    job.settings.type = settings.type;
    const state = this._movementStates.get(token);
    if (!state) return;
    state.pathSpeedMode = settings.mode;
    state.pathMovementType = settings.type;
    if (state.traversal) {
      this._movementRangeDirty = true;
      return;
    }
    for (const goal of [
      state.lastRequestedGoal,
      state.climbContinuationGoal,
      state.__resumeProbe?.goal,
    ]) {
      if (goal)
        goal.options = {
          ...goal.options,
          __preferredSpeedMode: settings.mode,
          movementType: settings.type,
        };
    }
    if (state.__fallResumeContext) {
      state.__fallResumeContext.pathSpeedMode = settings.mode;
      state.__fallResumeContext.pathMovementType = settings.type;
      state.__fallResumeContext.runDuration = 0;
      state.__fallResumeContext.wasSprinting = false;
    }
    this._syncMovementVariant(
      state,
      state.movementSign || state.lastMoveSign || state.activeDirectionSign || 1
    );
    if (state.wallMotion) this._applyWallMovementStyle(state);
    else if (
      previousMode === 'run' &&
      settings.mode === 'walk' &&
      state.phase !== 'fall' &&
      job.currentWall &&
      job.current.height * this.gameManager.spatial.elevationUnit <
        this._resolveTokenWorldPosition(token).y - 1e-8
    )
      this._startWallMovement(token, job.currentWall, job.current);
  } catch (error) {
    GameErrors.gameState(error, {
      component: 'TokenMovement',
      operation: 'applyMovementStyle',
      tokenId: token?.id,
    });
  }
}

function getTokenMovementRange(token) {
  if (!token || this.isMovementInProgress(token)) return null;
  const gm = this.gameManager;
  const combat = gm.characterServices?.combat;
  if (combat?.active && combat.activeToken !== token) return null;
  const world = this._resolveTokenWorldPosition(token);
  const start = this._mapWorldToGrid(world) || token;
  const settings = getTokenMovementSettings(token);
  const threshold = this._getWallClimbThreshold();
  const anchor = this._movementStates.get(token)?.wallMotion;
  const blocked = new Set();
  for (const other of gm.placedTokens || []) {
    if (other !== token) {
      blocked.add(`${other.gridX},${other.gridY}`);
      const face = this._movementStates.get(other)?.wallMotion?.face;
      if (face) blocked.add(`${face.low.gridX},${face.low.gridY}`);
    }
  }
  for (const [key, entries] of gm.terrainManager?.placeables || []) {
    if (entries.some((entry) => ['plant', 'structure'].includes(entry.placeableType)))
      blocked.add(key);
  }
  return buildMovementRange({
    cols: gm.cols,
    rows: gm.rows,
    startGridX: start.gridX,
    startGridY: start.gridY,
    speed: combat?.active ? combat.movementAllowance(token) : settings.speed,
    mode: settings.mode,
    tileWorldSize: gm.spatial.tileWorldSize,
    elevationUnit: gm.spatial.elevationUnit,
    getHeight: (x, y) => gm.getTerrainHeight(x, y),
    blocked,
    // A cliff needs a face-on approach; do not cut across its corner.
    maxDiagonalHeightDifference: threshold + 1e-8,
    minClimbHeightDifference: threshold,
    getWallRestHeight: (face) => this._getWallRestHeight(token, face),
    maxVaultHeightDifference: this._tokenAnimationData.get(token)?.traversal
      ? (MAX_LOW_LEDGE_HEIGHT_FEET * gm.spatial.tileWorldSize) /
        (FEET_PER_GRID_SQUARE * gm.spatial.elevationUnit)
      : 0,
    wallStart: anchor?.holding
      ? { face: anchor.face, height: world.y / gm.spatial.elevationUnit }
      : null,
  });
}

function _getWallRestHeight(token, face) {
  const elevationUnit = this.gameManager.spatial.elevationUnit;
  const data = this._tokenAnimationData.get(token);
  if (
    !(elevationUnit > 0) ||
    !data?.actions?.climbWall ||
    face.high.height - face.low.height < MAX_STANDARD_CLIMB_LEVELS
  )
    return face.low.height;
  return Math.max(
    face.low.height,
    face.high.height - this._resolveClimbMantleHeight(data, elevationUnit) / elevationUnit
  );
}

function _getWallClimbThreshold() {
  const { tileWorldSize, elevationUnit } = this.gameManager.spatial;
  return elevationUnit > 0
    ? (MAX_STEP_HEIGHT_FEET * tileWorldSize) / (FEET_PER_GRID_SQUARE * elevationUnit)
    : Infinity;
}

function refreshMovementRange() {
  this._movementRangeDirty = false;
  const gm = this.gameManager;
  const manager = gm.threeSceneManager;
  if (!manager?.scene?.isScene || !manager.three || !gm.is3DModeActive?.()) return null;
  try {
    const token = this.getSelectedToken();
    const range = gm.placedTokens.includes(token) ? this.getTokenMovementRange(token) : null;
    this._movementRange = range;
    if (!range) {
      this._movementRangeOverlay?.hide();
      return null;
    }
    const capacity = gm.cols * gm.rows;
    const tileSize = gm.spatial.tileWorldSize;
    const current = this._movementRangeOverlay;
    if (
      !current ||
      current.scene !== manager.scene ||
      current.capacity !== capacity ||
      current.tileSize !== tileSize
    ) {
      current?.dispose();
      this._movementRangeOverlay = new MovementRangeOverlay(
        manager.three,
        manager.scene,
        capacity,
        tileSize
      );
    }
    this._movementRangeOverlay.update(range, gm.spatial);
    return range;
  } catch (error) {
    this._movementRange = null;
    this._movementRangeOverlay?.hide();
    GameErrors.gameState(error, { component: 'TokenMovement', operation: 'refreshRange' });
    return null;
  }
}

// ── Constrained User Requests ────────────────────────────────
function requestMoveToGrid(token, gridX, gridY) {
  return this._requestPlannedMovement(token, { gridX, gridY });
}

function requestMoveToSurface(token, surface) {
  return this._requestPlannedMovement(token, { surface });
}

function _requestPlannedMovement(token, destination) {
  try {
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('Movement token is no longer in this session');
    if (this.gameManager.sceneAutosave?.ready === false)
      throw new Error('Wait for the campaign to finish opening before moving');
    this.recordStablePlacement?.(token);
    if (this.isMovementInProgress(token)) {
      this._logPathing('movement:range-rejected', { reason: 'already-moving', tokenId: token.id });
      return null;
    }
    const range = this.getTokenMovementRange(token);
    if (!range) {
      this._logPathing('movement:range-rejected', {
        reason: 'turn-unavailable',
        tokenId: token.id,
      });
      return null;
    }
    let route;
    let wallTarget = null;
    if (destination.surface) {
      const { point, normal } = destination.surface;
      if (
        !point ||
        !normal ||
        ![point.x, point.y, point.z, normal.x, normal.y, normal.z].every(Number.isFinite) ||
        Math.abs(normal.y) >= 0.45
      )
        throw new Error('Wall movement requires a valid vertical terrain-face intersection');
      const spatial = this.gameManager.spatial;
      const dx = Math.round(normal.x);
      const dy = Math.round(normal.z);
      if (Math.abs(dx) + Math.abs(dy) !== 1)
        throw new Error('Wall movement requires an axis-aligned terrain face');
      const inset = spatial.tileWorldSize * 1e-4;
      const high = spatial.worldToGrid(point.x - dx * inset, point.z - dy * inset);
      const faceId = `${high.gridX + dx},${high.gridY + dy}>${high.gridX},${high.gridY}`;
      wallTarget = getWallMovementTarget(range, faceId, point.y / spatial.elevationUnit);
      if (wallTarget?.exit) {
        const cell = wallTarget.face[wallTarget.exit];
        route = getMovementRoute(range, cell.gridX, cell.gridY);
        wallTarget = null;
      } else if (wallTarget) {
        const entry = range.tiles.get(wallTarget.entryKey);
        route =
          wallTarget.entryKey === range.startKey
            ? []
            : getMovementRoute(range, entry.gridX, entry.gridY);
      }
    } else {
      route = range && getMovementRoute(range, destination.gridX, destination.gridY);
    }
    if (!route) {
      this._logPathing('movement:range-rejected', {
        reason: 'out-of-range',
        tokenId: token.id,
        destination,
      });
      return null;
    }
    const combat = this.gameManager.characterServices?.combat;
    const settings = { ...getTokenMovementSettings(token) };
    if (combat?.active) settings.speed = combat.movementAllowance(token);
    const world = this._resolveTokenWorldPosition(token);
    if (
      !route.length &&
      (!wallTarget ||
        (Math.abs(wallTarget.height * this.gameManager.spatial.elevationUnit - world.y) < 1e-8 &&
          (!wallTarget.ledgeHang ||
            this._movementStates.get(token)?.wallMotion?.clip === 'ledgeHang')))
    )
      return { goal: null, cost: 0, distance: 0, speedMode: settings.mode };
    const points = compressRoute(range.start, route);
    if (wallTarget) points.push(wallTarget);
    const cost = wallTarget?.cost ?? route.at(-1).cost;
    const job = {
      token,
      points,
      index: 0,
      current: null,
      settings,
      range,
      spent: 0,
      plannedCost: cost,
      combat,
      combatMove: combat?.active ? combat.beginMovement(token, cost) : null,
    };
    this._movementRoutes.set(token, job);
    const result = this._beginPlannedMovementSegment(token, job);
    this.refreshMovementRange();
    return { ...result, cost, distance: cost };
  } catch (error) {
    const state = this._movementStates.get(token);
    const hadRoute = this._movementRoutes.has(token);
    this._finishPlannedMovement(token);
    if (hadRoute && state?.wallMotion && !state.wallMotion.holding) this._cancelWallMovement(state);
    GameErrors.input(error, {
      component: 'TokenMovement',
      operation: 'requestMove',
      tokenId: token?.id,
    });
    return null;
  }
}

function _beginPlannedMovementSegment(token, job) {
  let cell = job.points[job.index++];
  job.current = cell;
  job.segmentStartWorld = { ...this._resolveTokenWorldPosition(token) };
  job.segmentCharged = false;
  job.segmentCost = 0;
  job.currentWall = null;
  if (cell.vault && job.settings.mode !== 'run') {
    const landing = { ...cell };
    delete landing.vault;
    const obstacle = { ...cell.vault };
    const index = job.index - 1;
    job.points.splice(index, 1, obstacle, landing);
    job.index = index;
    return this._beginPlannedMovementSegment(token, job);
  }
  if (cell.vault) {
    job.segmentCost = 2 * FEET_PER_GRID_SQUARE + cell.vault.rise * job.range.verticalCostPerLevel;
    return this._startShortTraversal(token, cell, 'vault');
  }
  if (cell.kind === 'wall' || cell.wallExit) {
    return this._startWallMovement(token, cell.face || cell.wall, cell);
  }
  const world = this._resolveTokenWorldPosition(token);
  const from = this._mapWorldToGrid(world);
  const elevationUnit = this.gameManager.spatial.elevationUnit;
  const fromHeight =
    elevationUnit > 0
      ? world.y / elevationUnit
      : this._getTerrainHeight(from?.gridX ?? token.gridX, from?.gridY ?? token.gridY);
  const steps = Math.max(
    Math.abs(cell.gridX - (from?.gridX ?? token.gridX)),
    Math.abs(cell.gridY - (from?.gridY ?? token.gridY))
  );
  const affordableSteps = Math.floor(
    (job.settings.speed - job.spent + 1e-9) / FEET_PER_GRID_SQUARE
  );
  if (affordableSteps < steps) {
    if (affordableSteps <= 0) return this._stopPlannedMovement(token);
    cell = {
      ...cell,
      gridX: from.gridX + Math.sign(cell.gridX - from.gridX) * affordableSteps,
      gridY: from.gridY + Math.sign(cell.gridY - from.gridY) * affordableSteps,
    };
    job.current = cell;
    job.points = [cell];
    job.index = 1;
  }
  job.segmentCost = Math.min(steps, affordableSteps) * FEET_PER_GRID_SQUARE;
  if (
    from &&
    Math.abs(from.gridX - cell.gridX) + Math.abs(from.gridY - cell.gridY) === 1 &&
    Math.abs(cell.height - fromHeight) > this._getWallClimbThreshold() + 1e-9
  ) {
    const low = cell.height > fromHeight ? from : cell;
    const high = cell.height > fromHeight ? cell : from;
    const face = job.range.walls.get(`${low.gridX},${low.gridY}>${high.gridX},${high.gridY}`);
    if (!face) throw new Error('The approved climbing route has no terrain wall');
    job.currentWall = face;
    const heightFeet =
      (Math.abs(cell.height - fromHeight) * elevationUnit * FEET_PER_GRID_SQUARE) /
      this.gameManager.spatial.tileWorldSize;
    const data = this._tokenAnimationData.get(token);
    const shortClimbFeet = data
      ? (this._resolveClimbMantleHeight(data, elevationUnit) * FEET_PER_GRID_SQUARE) /
        this.gameManager.spatial.tileWorldSize
      : 0;
    const shortLimit =
      cell.height > fromHeight || job.settings.mode === 'walk'
        ? Math.max(MAX_LOW_LEDGE_HEIGHT_FEET, shortClimbFeet)
        : MAX_LOW_LEDGE_HEIGHT_FEET;
    if (data?.traversal && heightFeet <= shortLimit + 1e-8) {
      job.segmentCost =
        FEET_PER_GRID_SQUARE +
        (cell.height > fromHeight || job.settings.mode === 'walk' ? 2 * heightFeet : 0);
      return this._startShortTraversal(
        token,
        cell,
        cell.height > fromHeight
          ? 'climb-low'
          : job.settings.mode === 'run'
            ? 'hop-down'
            : 'lower-low'
      );
    }
    if (cell.height > fromHeight || job.settings.mode === 'walk')
      return this._startWallMovement(token, face, cell);
  }
  const result = this.navigateToGrid(token, cell.gridX, cell.gridY, {
    __preferredSpeedMode: job.settings.mode,
    movementType: job.settings.type,
  });
  if (!result?.goal) throw new Error('The reachable movement route could not be started');
  return result;
}

function _hasReachedPlannedMovementGoal(token, job) {
  const world = this._resolveTokenWorldPosition(token);
  const goal =
    job.current.world ||
    this.gameManager.spatial.gridToWorld(
      job.current.gridX + 0.5,
      job.current.gridY + 0.5,
      job.current.height
    );
  return Math.hypot(world.x - goal.x, world.y - goal.y, world.z - goal.z) <= 1e-4;
}

function _advancePlannedMovement(state) {
  const job = this._movementRoutes.get(state.token);
  if (!job || !this._hasReachedPlannedMovementGoal(state.token, job)) return false;
  this._commitPlannedMovementCost(job);
  if (job.index < job.points.length) {
    this._beginPlannedMovementSegment(state.token, job);
    return true;
  }
  this._finishPlannedMovement(state.token);
  this._movementRangeDirty = true;
  return false;
}

function _updatePlannedMovements() {
  const gm = this.gameManager;
  const spatialKey = [gm.cols, gm.rows, gm.spatial?.tileWorldSize, gm.spatial?.elevationUnit].join(
    ':'
  );
  const scene = gm.threeSceneManager?.scene;
  if (this._movementRangeSpatialKey !== spatialKey || this._movementRangeScene !== scene) {
    this._movementRangeSpatialKey = spatialKey;
    this._movementRangeScene = scene;
    this._movementRangeDirty = true;
  }
  for (const [token, job] of this._movementRoutes) {
    const cellKey = `${token.gridX},${token.gridY}`;
    if (job.cellKey !== cellKey) {
      job.cellKey = cellKey;
      this._movementRangeDirty = true;
    }
    const state = this._movementStates.get(token);
    if (state && ((state.phase !== 'idle' && state.phase !== 'climb-hold') || state.pathActive))
      continue;
    try {
      if (!this._hasReachedPlannedMovementGoal(token, job)) {
        throw new Error('Movement stopped before reaching its approved route waypoint');
      }
      this._commitPlannedMovementCost(job);
      if (job.index < job.points.length) this._beginPlannedMovementSegment(token, job);
      else {
        this._finishPlannedMovement(token);
        if (state?.phase !== 'climb-hold')
          this._resetMovementState(state || this._ensureMovementState(token));
        this._movementRangeDirty = true;
      }
    } catch (error) {
      this._finishPlannedMovement(token, true);
      this._movementRangeDirty = true;
      GameErrors.gameState(error, {
        component: 'TokenMovement',
        operation: 'advanceRoute',
        tokenId: token.id,
      });
    }
  }
  if (this._movementRangeDirty) {
    this.resyncHeights();
    this.refreshMovementRange();
  }
}

function _isPlannedLandingPositionAllowed(state, world) {
  const job = this._movementRoutes.get(state.token);
  if (!job) return true;
  const start = state.activeStep.targetWorld;
  const goal =
    job.current.world ||
    this.gameManager.spatial.gridToWorld(
      job.current.gridX + 0.5,
      job.current.gridY + 0.5,
      job.current.height
    );
  const dx = goal.x - start.x;
  const dz = goal.z - start.z;
  const length = Math.hypot(dx, dz);
  if (length < 1e-5) return Math.hypot(world.x - goal.x, world.z - goal.z) < 1e-4;
  const along = ((world.x - start.x) * dx + (world.z - start.z) * dz) / length;
  const across = Math.abs((world.x - start.x) * dz - (world.z - start.z) * dx) / length;
  return (
    along >= -1e-4 &&
    along <= length + 1e-4 &&
    across <= this.gameManager.spatial.tileWorldSize * 0.1
  );
}

function disposeMovementRange() {
  this._movementRangeOverlay?.dispose();
  this._movementRangeOverlay = null;
  this._movementRange = null;
  for (const token of this._movementRoutes.keys()) this._finishPlannedMovement(token, true);
  this._movementRangeSpatialKey = null;
  this._movementRangeScene = null;
  this._movementRangeDirty = true;
}

function _commitPlannedMovementCost(job) {
  if (job.segmentCharged) return;
  job.spent = (job.spent || 0) + (job.segmentCost || 0);
  job.segmentCharged = true;
  if (job.spent > job.settings.speed + 1e-7)
    throw new Error('Movement exceeded its original distance allowance');
}

function _finishPlannedMovement(token, interrupted = false) {
  const job = this._movementRoutes.get(token);
  this._movementRoutes.delete(token);
  if (job?.combatMove) {
    const ticket = job.combatMove;
    job.combatMove = null;
    const cost = interrupted
      ? Math.min(ticket.allowance, Math.max(job.spent, job.plannedCost))
      : job.spent;
    job.combat.finishMovement(ticket, cost);
  }
  if (job && !interrupted) this.recordStablePlacement?.(token);
}

function _stopPlannedMovement(token) {
  this._finishPlannedMovement(token);
  const state = this._movementStates.get(token);
  if (state && state.phase !== 'climb-hold') this._resetMovementState(state);
  this._movementRangeDirty = true;
  return { goal: null };
}

// ── Route Compression & Installation ─────────────────────────
function compressRoute(start, route) {
  const points = [];
  let previous = start;
  for (let i = 0; i < route.length; i++) {
    const cell = route[i];
    const next = route[i + 1];
    const directionChanged =
      next &&
      (Math.sign(cell.gridX - previous.gridX) !== Math.sign(next.gridX - cell.gridX) ||
        Math.sign(cell.gridY - previous.gridY) !== Math.sign(next.gridY - cell.gridY));
    if (
      !next ||
      cell.vault ||
      next.vault ||
      cell.wallExit ||
      next.wallExit ||
      directionChanged ||
      previous.height !== cell.height ||
      next.height !== cell.height
    ) {
      points.push({ ...cell });
    }
    previous = cell;
  }
  return points;
}

export function installMovementRangeMethods(prototype) {
  prototype.applyMovementStyle = applyMovementStyle;
  prototype.isMovementInProgress = isMovementInProgress;
  prototype.getTokenMovementRange = getTokenMovementRange;
  prototype.refreshMovementRange = refreshMovementRange;
  prototype.requestMoveToGrid = requestMoveToGrid;
  prototype.requestMoveToSurface = requestMoveToSurface;
  prototype._requestPlannedMovement = _requestPlannedMovement;
  prototype._getWallClimbThreshold = _getWallClimbThreshold;
  prototype._getWallRestHeight = _getWallRestHeight;
  prototype._commitPlannedMovementCost = _commitPlannedMovementCost;
  prototype._finishPlannedMovement = _finishPlannedMovement;
  prototype._stopPlannedMovement = _stopPlannedMovement;
  prototype._beginPlannedMovementSegment = _beginPlannedMovementSegment;
  prototype._hasReachedPlannedMovementGoal = _hasReachedPlannedMovementGoal;
  prototype._advancePlannedMovement = _advancePlannedMovement;
  prototype._updatePlannedMovements = _updatePlannedMovements;
  prototype._isPlannedLandingPositionAllowed = _isPlannedLandingPositionAllowed;
  prototype.disposeMovementRange = disposeMovementRange;
}
