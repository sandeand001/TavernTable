/**
 * Navigation.js
 *
 * Navigation & path-orchestration methods extracted from Token3DAdapter.
 * Each function is written with `this` semantics so it can be installed on a
 * class prototype via `installNavigationMethods()`.
 *
 * Responsibilities:
 *   - Grid-based pathfinding entry-point (navigateToGrid)
 *   - Path state lifecycle (clear, complete, stall re-issue)
 *   - Speed-mode normalisation and grid-distance helpers
 *   - Intermediate climb traversal planning and redirect
 *   - Token orientation towards a world-space target
 */

import {
  PATH_NAVIGATION_KEY,
  PATH_SPEED_WALK_MAX,
  PATH_SPEED_RUN_MAX,
  PATH_SPEED_DEFAULT_TOLERANCE,
  PATH_SPEED_MODES,
  MAX_STANDARD_CLIMB_LEVELS,
  CLIMB_WALL_ENTRY_TILE_HALF_RATIO,
  CLIMB_WALL_ENTRY_MIN_RATIO,
  CLIMB_WALL_ENTRY_RUN_BACKOFF_RATIO,
  CLIMB_WALL_ENTRY_SPRINT_BACKOFF_RATIO,
  CLIMB_APPROACH_TOLERANCE_MIN,
  CLIMB_APPROACH_TOLERANCE_RUN_SCALE,
  CLIMB_APPROACH_TOLERANCE_SPRINT_SCALE,
  MAX_INTERMEDIATE_CLIMB_CHAIN,
} from './MannequinConfig.js';

// ── Main Navigation Entry-Point ──────────────────────────────────────────

function navigateToGrid(tokenEntry, gridX, gridY, options = {}) {
  try {
    if (!tokenEntry) return null;
    this._releaseManualAnimationForMovement(tokenEntry);
    const gm = this.gameManager;
    if (!gm?.is3DModeActive?.()) return null;
    const spatial = gm.spatial;
    if (!spatial || typeof spatial.gridToWorld !== 'function') return null;

    const requestOptions = { ...options };
    const preferredSpeedMode = this._normalizePathSpeedMode(requestOptions.__preferredSpeedMode);
    const preserveLastGoal = !!requestOptions.__maintainLastRequestedGoal;
    if (preserveLastGoal) {
      delete requestOptions.__maintainLastRequestedGoal;
    }

    const state = this._ensureMovementState(tokenEntry);
    if (!state) return null;
    if (!preserveLastGoal) {
      this._clearResumeProbe(state);
      state.climbContinuationGoal = null;
    }
    state.pathStallTime = 0;
    const tokenDescriptor = this._describeTokenForLogs(tokenEntry);

    const currentGridX = Number.isFinite(tokenEntry.gridX) ? Math.round(tokenEntry.gridX) : 0;
    const currentGridY = Number.isFinite(tokenEntry.gridY) ? Math.round(tokenEntry.gridY) : 0;

    let targetGridX = Number.isFinite(gridX) ? Math.round(gridX) : currentGridX;
    let targetGridY = Number.isFinite(gridY) ? Math.round(gridY) : currentGridY;
    const requestedTargetGridX = targetGridX;
    const requestedTargetGridY = targetGridY;

    this._logPathing('navigate:start', {
      token: tokenDescriptor,
      from: { gridX: currentGridX, gridY: currentGridY },
      requested: { gridX: requestedTargetGridX, gridY: requestedTargetGridY },
      preserveLastGoal,
      options: { ...requestOptions },
    });

    if (!preserveLastGoal) {
      state.lastRequestedGoal = {
        gridX: requestedTargetGridX,
        gridY: requestedTargetGridY,
        options: { ...requestOptions },
      };
    }

    const sameTile = currentGridX === targetGridX && currentGridY === targetGridY;
    if (sameTile) {
      if (!preserveLastGoal) {
        state.lastRequestedGoal = null;
      }
      this._clearPathState(state, { silentResumeProbe: true });
      if (state.phase !== 'idle') {
        state.pendingStop = true;
      }
      this._logPathing('navigate:already-at-target', {
        token: tokenDescriptor,
        grid: { gridX: currentGridX, gridY: currentGridY },
      });
      return { goal: null, speedMode: null, distance: 0 };
    }

    const walkThreshold =
      Number.isFinite(requestOptions.walkThreshold) && requestOptions.walkThreshold >= 0
        ? requestOptions.walkThreshold
        : PATH_SPEED_WALK_MAX;
    const runThreshold =
      Number.isFinite(requestOptions.runThreshold) && requestOptions.runThreshold >= walkThreshold
        ? requestOptions.runThreshold
        : PATH_SPEED_RUN_MAX;

    const distance = this._computeGridDistance(
      currentGridX,
      currentGridY,
      targetGridX,
      targetGridY
    );

    let speedMode = PATH_SPEED_MODES.WALK;
    if (distance > runThreshold) {
      speedMode = PATH_SPEED_MODES.SPRINT;
    } else if (distance > walkThreshold) {
      speedMode = PATH_SPEED_MODES.RUN;
    }
    if (preferredSpeedMode) {
      speedMode = preferredSpeedMode;
    }
    if (state.lastRequestedGoal?.options) {
      state.lastRequestedGoal.options.__preferredSpeedMode = speedMode;
    }

    let startHeightLevel = this._getTerrainHeight(currentGridX, currentGridY);
    let targetHeightLevel = this._getTerrainHeight(targetGridX, targetGridY);
    let heightDelta =
      Number.isFinite(startHeightLevel) && Number.isFinite(targetHeightLevel)
        ? targetHeightLevel - startHeightLevel
        : 0;

    const climbChainDepth = Number.isFinite(requestOptions.__intermediateClimbDepth)
      ? Math.max(0, requestOptions.__intermediateClimbDepth)
      : 0;
    let continuationGoal = state.climbContinuationGoal || null;

    if (climbChainDepth < MAX_INTERMEDIATE_CLIMB_CHAIN) {
      const intermediatePlan = this._planIntermediateClimbTraversal(
        currentGridX,
        currentGridY,
        targetGridX,
        targetGridY
      );
      if (intermediatePlan) {
        const planDiffersFromOriginal =
          intermediatePlan.climbGridX !== requestedTargetGridX ||
          intermediatePlan.climbGridY !== requestedTargetGridY;

        if (planDiffersFromOriginal) {
          continuationGoal = {
            gridX: requestedTargetGridX,
            gridY: requestedTargetGridY,
            options: {
              ...requestOptions,
              __intermediateClimbDepth: climbChainDepth + 1,
              __preferredSpeedMode: speedMode,
            },
          };
        }
        this._logPathing('navigate:intermediate-climb', {
          token: tokenDescriptor,
          intermediate: {
            approachGridX: intermediatePlan.approachGridX,
            approachGridY: intermediatePlan.approachGridY,
            climbGridX: intermediatePlan.climbGridX,
            climbGridY: intermediatePlan.climbGridY,
            heightDelta: intermediatePlan.heightDelta,
          },
          continuationGoal: continuationGoal
            ? { gridX: continuationGoal.gridX, gridY: continuationGoal.gridY }
            : null,
        });
        targetGridX = intermediatePlan.climbGridX;
        targetGridY = intermediatePlan.climbGridY;
        targetHeightLevel = this._getTerrainHeight(targetGridX, targetGridY);
        heightDelta =
          Number.isFinite(startHeightLevel) && Number.isFinite(targetHeightLevel)
            ? targetHeightLevel - startHeightLevel
            : heightDelta;
      }
    }
    const currentWorld = this._resolveTokenWorldPosition(tokenEntry);
    const fallbackHeight = Number.isFinite(options.elevation)
      ? options.elevation
      : (currentWorld?.y ?? 0);

    const targetCenterX = targetGridX + 0.5;
    const targetCenterY = targetGridY + 0.5;
    let targetCenterWorld = null;
    try {
      targetCenterWorld = spatial.gridToWorld(
        targetCenterX,
        targetCenterY,
        Number.isFinite(targetHeightLevel) ? targetHeightLevel : fallbackHeight
      );
    } catch (_) {
      targetCenterWorld = null;
    }

    const resolvedTargetX = Number.isFinite(targetCenterWorld?.x)
      ? targetCenterWorld.x
      : targetCenterX;
    const resolvedTargetZ = Number.isFinite(targetCenterWorld?.z)
      ? targetCenterWorld.z
      : targetCenterY;
    const resolvedTargetY = this._sampleWorldHeight(
      resolvedTargetX,
      resolvedTargetZ,
      Number.isFinite(targetCenterWorld?.y) ? targetCenterWorld.y : fallbackHeight
    );
    const targetWorld = {
      x: resolvedTargetX,
      z: resolvedTargetZ,
      y: resolvedTargetY,
    };

    const startWorldY = currentWorld?.y;
    const targetWorldReferenceY = Number.isFinite(targetCenterWorld?.y)
      ? targetCenterWorld.y
      : targetWorld?.y;

    const derivedStartHeightLevel = this._estimateHeightFromWorld(
      startWorldY,
      currentGridX,
      currentGridY
    );
    let resolvedStartHeightLevel = Number.isFinite(startHeightLevel)
      ? startHeightLevel
      : derivedStartHeightLevel;
    if (!Number.isFinite(resolvedStartHeightLevel)) {
      resolvedStartHeightLevel = 0;
    } else if (
      Number.isFinite(derivedStartHeightLevel) &&
      Math.abs(derivedStartHeightLevel - resolvedStartHeightLevel) > 1e-3
    ) {
      resolvedStartHeightLevel = derivedStartHeightLevel;
    }

    const derivedTargetHeightLevel = this._estimateHeightFromWorld(
      targetWorldReferenceY,
      targetGridX,
      targetGridY
    );
    let resolvedTargetHeightLevel = Number.isFinite(targetHeightLevel)
      ? targetHeightLevel
      : derivedTargetHeightLevel;
    if (!Number.isFinite(resolvedTargetHeightLevel)) {
      resolvedTargetHeightLevel = resolvedStartHeightLevel;
    } else if (
      Number.isFinite(derivedTargetHeightLevel) &&
      Math.abs(derivedTargetHeightLevel - resolvedTargetHeightLevel) > 1e-3
    ) {
      resolvedTargetHeightLevel = derivedTargetHeightLevel;
    }

    startHeightLevel = resolvedStartHeightLevel;
    targetHeightLevel = resolvedTargetHeightLevel;
    heightDelta =
      Number.isFinite(targetHeightLevel) && Number.isFinite(startHeightLevel)
        ? targetHeightLevel - startHeightLevel
        : 0;

    const climbEligible = heightDelta >= MAX_STANDARD_CLIMB_LEVELS;
    const elevationUnit =
      Number.isFinite(spatial?.elevationUnit) && spatial.elevationUnit > 0
        ? spatial.elevationUnit
        : 0.5;
    const toleranceBase =
      Number.isFinite(requestOptions.tolerance) && requestOptions.tolerance > 0
        ? requestOptions.tolerance
        : PATH_SPEED_DEFAULT_TOLERANCE;

    let pathGoalGridX = targetGridX;
    let pathGoalGridY = targetGridY;
    let pathGoalWorld = targetWorld;
    let pathTolerance = toleranceBase;

    if (climbEligible) {
      const stepX = Math.sign(targetGridX - currentGridX);
      const stepY = Math.sign(targetGridY - currentGridY);

      let approachGridX = targetGridX - stepX;
      let approachGridY = targetGridY - stepY;

      if (!Number.isFinite(approachGridX)) approachGridX = currentGridX;
      if (!Number.isFinite(approachGridY)) approachGridY = currentGridY;

      if (!this._isGridWithinBounds(approachGridX, approachGridY)) {
        approachGridX = currentGridX;
        approachGridY = currentGridY;
      }

      if (approachGridX === targetGridX && approachGridY === targetGridY) {
        approachGridX = currentGridX;
        approachGridY = currentGridY;
      }

      const approachHeightLevel = this._getTerrainHeight(approachGridX, approachGridY);
      let approachCenterWorld = null;
      try {
        approachCenterWorld = spatial.gridToWorld(
          approachGridX + 0.5,
          approachGridY + 0.5,
          Number.isFinite(approachHeightLevel) ? approachHeightLevel : fallbackHeight
        );
      } catch (_) {
        approachCenterWorld = null;
      }
      const approachX = Number.isFinite(approachCenterWorld?.x)
        ? approachCenterWorld.x
        : approachGridX + 0.5;
      const approachZ = Number.isFinite(approachCenterWorld?.z)
        ? approachCenterWorld.z
        : approachGridY + 0.5;
      const approachY = this._sampleWorldHeight(
        approachX,
        approachZ,
        Number.isFinite(approachCenterWorld?.y) ? approachCenterWorld.y : fallbackHeight
      );
      const approachWorld = { x: approachX, z: approachZ, y: approachY };

      const tileHalf =
        Number.isFinite(spatial?.tileWorldSize) && spatial.tileWorldSize > 0
          ? spatial.tileWorldSize * 0.5
          : 0.5;

      const dirX = targetWorld.x - approachWorld.x;
      const dirZ = targetWorld.z - approachWorld.z;
      const dirLen = Math.hypot(dirX, dirZ);
      const baseEntryRatio = Math.min(Math.max(CLIMB_WALL_ENTRY_TILE_HALF_RATIO, 0.05), 1);
      const entryVector = dirLen > 1e-4 ? { x: dirX / dirLen, z: dirZ / dirLen } : { x: 0, z: 0 };

      let wallEntryDepth = tileHalf * baseEntryRatio;
      if (dirLen > 1e-4) {
        wallEntryDepth = Math.min(Math.max(wallEntryDepth, 0), dirLen);
      } else {
        wallEntryDepth = 0;
      }

      const wallEntryWorld = this._cloneWorld(approachWorld) || approachWorld;
      wallEntryWorld.x += entryVector.x * wallEntryDepth;
      wallEntryWorld.z += entryVector.z * wallEntryDepth;

      let stopDepth = wallEntryDepth;
      const extraBackoff = (() => {
        if (speedMode === PATH_SPEED_MODES.RUN) {
          return tileHalf * CLIMB_WALL_ENTRY_RUN_BACKOFF_RATIO;
        }
        if (speedMode === PATH_SPEED_MODES.SPRINT) {
          return tileHalf * CLIMB_WALL_ENTRY_SPRINT_BACKOFF_RATIO;
        }
        return 0;
      })();
      const minStopDepth = CLIMB_WALL_ENTRY_MIN_RATIO * tileHalf;
      stopDepth = Math.max(wallEntryDepth - extraBackoff, minStopDepth);
      if (dirLen > 1e-4) {
        stopDepth = Math.min(stopDepth, dirLen);
      } else {
        stopDepth = 0;
      }

      const stopWorld = this._cloneWorld(approachWorld) || approachWorld;
      stopWorld.x += entryVector.x * stopDepth;
      stopWorld.z += entryVector.z * stopDepth;

      const edgeTopWorld = {
        x: wallEntryWorld.x,
        z: wallEntryWorld.z,
        y: targetWorld.y,
      };

      const availableWallHeight = Math.max((edgeTopWorld.y ?? 0) - (wallEntryWorld.y ?? 0), 0);
      const maxStandardWorldHeight = MAX_STANDARD_CLIMB_LEVELS * elevationUnit;
      const wallWorldTravel = Math.max(0, availableWallHeight - maxStandardWorldHeight);
      const extraWallLevels = Math.max(0, heightDelta - MAX_STANDARD_CLIMB_LEVELS);

      state.climbQueued = {
        targetGridX,
        targetGridY,
        targetHeight: targetHeightLevel,
        footWorld: this._cloneWorld(wallEntryWorld) || wallEntryWorld,
        edgeWorld: this._cloneWorld(edgeTopWorld) || edgeTopWorld,
        finalWorld: this._cloneWorld(targetWorld) || targetWorld,
        heightDelta,
        elevationUnit,
        extraWallLevels,
        wallWorldTravel,
      };

      this._logPathing('climb:queued', {
        token: tokenDescriptor,
        target: {
          gridX: targetGridX,
          gridY: targetGridY,
          heightDelta,
          extraWallLevels,
        },
        continuationGoal: continuationGoal
          ? { gridX: continuationGoal.gridX, gridY: continuationGoal.gridY }
          : null,
      });

      pathGoalGridX = approachGridX;
      pathGoalGridY = approachGridY;
      pathGoalWorld = stopWorld;
      pathTolerance = Math.min(toleranceBase, PATH_SPEED_DEFAULT_TOLERANCE * 0.5);
      if (speedMode === PATH_SPEED_MODES.RUN) {
        pathTolerance = Math.max(
          pathTolerance * CLIMB_APPROACH_TOLERANCE_RUN_SCALE,
          CLIMB_APPROACH_TOLERANCE_MIN
        );
      } else if (speedMode === PATH_SPEED_MODES.SPRINT) {
        pathTolerance = Math.max(
          pathTolerance * CLIMB_APPROACH_TOLERANCE_SPRINT_SCALE,
          CLIMB_APPROACH_TOLERANCE_MIN
        );
      }
    } else {
      state.climbQueued = null;
    }

    if (continuationGoal) {
      state.climbContinuationGoal = continuationGoal;
    }

    const orientationWorld = climbEligible ? pathGoalWorld : targetWorld;
    this._orientTokenTowardsWorld(tokenEntry, orientationWorld);

    const clearOptions = { silentResumeProbe: true };
    if (state.__resumeProbe) {
      clearOptions.preserveResumeProbe = true;
    }
    this._clearPathState(state, clearOptions);
    state.pathActive = true;
    state.pathGoal = { gridX: pathGoalGridX, gridY: pathGoalGridY, world: pathGoalWorld };
    state.pathSpeedMode = speedMode;
    state.pathTolerance = pathTolerance;
    state.pathReached = false;
    state.pathKey = PATH_NAVIGATION_KEY;

    if (state.forwardKeys && typeof state.forwardKeys.clear === 'function') {
      state.forwardKeys.clear();
    }
    if (state.backwardKeys && typeof state.backwardKeys.clear === 'function') {
      state.backwardKeys.clear();
    }
    state.forwardKeys.add(PATH_NAVIGATION_KEY);

    state.freeStartWorld = this._cloneWorld(currentWorld);
    state.freeLastWorld = this._cloneWorld(currentWorld);
    state.freeDistance = 0;

    state.movementSign = 1;
    state.lastMoveSign = 1;
    state.intentHold = true;
    state.pendingStop = false;
    state.stopTriggered = false;

    if (state.phase === 'stop') {
      this._abortStopPhase(state);
    }

    const netIntent = this._recalculateMovementIntent(state) || 1;
    if (state.phase === 'idle') {
      this._startMovementPhase(state, netIntent);
    } else {
      state.movementSign = netIntent;
      state.lastMoveSign = netIntent;
      this._syncMovementVariant(state, netIntent);
    }

    this._updateMovementFlags(state, netIntent);

    this._logPathing('navigate:path-issued', {
      token: tokenDescriptor,
      goal: state.pathGoal
        ? {
            gridX: state.pathGoal.gridX,
            gridY: state.pathGoal.gridY,
            world: state.pathGoal.world
              ? {
                  x: state.pathGoal.world.x,
                  y: state.pathGoal.world.y,
                  z: state.pathGoal.world.z,
                }
              : null,
          }
        : null,
      speedMode,
      hasClimbQueued: Boolean(state.climbQueued),
      continuationGoal: state.climbContinuationGoal
        ? {
            gridX: state.climbContinuationGoal.gridX,
            gridY: state.climbContinuationGoal.gridY,
          }
        : null,
    });

    return { goal: state.pathGoal, speedMode, distance };
  } catch (_) {
    return null;
  }
}

// ── Path State Lifecycle ─────────────────────────────────────────────────

function _clearPathState(state, options = {}) {
  if (!state) return;
  const {
    silentResumeProbe = false,
    resumeProbeReason = 'path-cleared',
    resumeProbeDetails = {},
    preserveResumeProbe = false,
  } = options;
  if (state.pathKey && state.forwardKeys?.has(state.pathKey)) {
    state.forwardKeys.delete(state.pathKey);
  }
  state.pathActive = false;
  state.pathGoal = null;
  state.pathSpeedMode = null;
  state.pathKey = null;
  state.pathTolerance = 0;
  state.pathReached = false;
  state.__pathAdvanceLogAt = 0;
  if (!preserveResumeProbe) {
    if (silentResumeProbe) {
      this._clearResumeProbe(state);
    } else {
      this._abortResumeProbe(state, resumeProbeReason, resumeProbeDetails);
    }
  }
  if (state.__pathingLogFlags && typeof state.__pathingLogFlags.clear === 'function') {
    state.__pathingLogFlags.clear();
  }
}

function _completePath(state) {
  if (!state) return;
  const goal = state.pathGoal;
  const tokenEntry = state.token;
  const mesh = state.mesh;
  const climbInfo = this._cloneClimbWorldInfo(state.climbQueued);

  const tokenDescriptor = this._describeTokenForLogs(tokenEntry);
  this._logPathing('path:complete', {
    token: tokenDescriptor,
    goal: goal
      ? {
          gridX: goal.gridX,
          gridY: goal.gridY,
        }
      : null,
    hadClimbQueued: Boolean(climbInfo),
  });

  this._clearPathState(state);
  state.intentHold = false;
  state.pendingStop = false;
  state.movementSign = 0;
  state.lastMoveSign = 0;

  if (goal) {
    if (Number.isFinite(goal.gridX)) tokenEntry.gridX = goal.gridX;
    if (Number.isFinite(goal.gridY)) tokenEntry.gridY = goal.gridY;
    const goalWorld = this._cloneWorld(goal.world);
    if (goalWorld) {
      this._syncTokenAndMeshWorld(state, goalWorld, { token: tokenEntry, mesh });
    }
  }

  if (climbInfo) {
    this._logPathing('path:complete-start-climb', {
      token: tokenDescriptor,
      target: {
        gridX: climbInfo.targetGridX,
        gridY: climbInfo.targetGridY,
        heightDelta: climbInfo.heightDelta,
      },
    });
    this._startClimbPhase(state, climbInfo);
    return;
  }

  this._resetMovementState(state);
}

// ── Goal Resumption & Navigation Helpers ─────────────────────────────────

function _reissueMaintainedGoal(state, goal, options = {}) {
  if (!state?.token || !goal) return false;
  const gm = this.gameManager;
  if (!gm?.is3DModeActive?.()) return false;

  const tokenDescriptor = this._describeTokenForLogs(state.token);

  const targetGridX = Number.isFinite(goal.gridX) ? Math.round(goal.gridX) : null;
  const targetGridY = Number.isFinite(goal.gridY) ? Math.round(goal.gridY) : null;
  if (targetGridX == null || targetGridY == null) {
    return false;
  }

  this._logPathing('path:reissue-goal:attempt', {
    token: tokenDescriptor,
    goal: { gridX: targetGridX, gridY: targetGridY },
    allowSameTile: !!options?.allowSameTile,
  });

  if (!options?.allowSameTile) {
    const currentGridX = Number.isFinite(state.token.gridX) ? Math.round(state.token.gridX) : null;
    const currentGridY = Number.isFinite(state.token.gridY) ? Math.round(state.token.gridY) : null;
    if (currentGridX != null && currentGridY != null) {
      if (currentGridX === targetGridX && currentGridY === targetGridY) {
        return false;
      }
    }
  }

  const requestOptions = {
    ...(goal.options || {}),
    __maintainLastRequestedGoal: true,
  };

  const result = this.navigateToGrid(state.token, targetGridX, targetGridY, requestOptions);
  const succeeded = !!result;
  this._logPathing('path:reissue-goal:result', {
    token: tokenDescriptor,
    goal: { gridX: targetGridX, gridY: targetGridY },
    succeeded,
  });
  return succeeded;
}

function _resumeCachedPostClimbGoal(state) {
  return this._reissueMaintainedGoal(state, state?.lastRequestedGoal);
}

function _orientTokenTowardsWorld(tokenEntry, targetWorld) {
  if (!tokenEntry || !targetWorld) return;
  const current = this._resolveTokenWorldPosition(tokenEntry);
  const dx = targetWorld.x - current.x;
  const dz = targetWorld.z - current.z;
  if (Math.abs(dx) < 1e-6 && Math.abs(dz) < 1e-6) {
    return;
  }
  const yaw = Math.atan2(dx, -dz);
  const facing = this._normalizeAngle(Math.PI / 2 - yaw);
  tokenEntry.facingAngle = facing;
  this.updateTokenOrientation(tokenEntry);
}

function _normalizePathSpeedMode(mode) {
  if (!mode) return null;
  const value = typeof mode === 'string' ? mode.toLowerCase() : mode;
  if (value === PATH_SPEED_MODES.WALK) return PATH_SPEED_MODES.WALK;
  if (value === PATH_SPEED_MODES.RUN) return PATH_SPEED_MODES.RUN;
  if (value === PATH_SPEED_MODES.SPRINT) return PATH_SPEED_MODES.SPRINT;
  return null;
}

function _computeGridDistance(ax, ay, bx, by) {
  const fromX = Number.isFinite(ax) ? Math.round(ax) : 0;
  const fromY = Number.isFinite(ay) ? Math.round(ay) : 0;
  const toX = Number.isFinite(bx) ? Math.round(bx) : 0;
  const toY = Number.isFinite(by) ? Math.round(by) : 0;
  return Math.abs(fromX - toX) + Math.abs(fromY - toY);
}

// ── Intermediate Climb Traversal ─────────────────────────────────────────

function _planIntermediateClimbTraversal(startGridX, startGridY, targetGridX, targetGridY) {
  if (startGridX === targetGridX && startGridY === targetGridY) return null;
  const gm = this.gameManager;
  if (!gm?.spatial) return null;

  const evaluateStep = (fromX, fromY, toX, toY, stepIndex) => {
    if (!this._isGridWithinBounds(toX, toY)) {
      return null;
    }
    const prevHeight = this._getTerrainHeight(fromX, fromY);
    const nextHeight = this._getTerrainHeight(toX, toY);
    const heightDelta =
      Number.isFinite(prevHeight) && Number.isFinite(nextHeight) ? nextHeight - prevHeight : 0;
    if (heightDelta >= MAX_STANDARD_CLIMB_LEVELS) {
      return {
        approachGridX: fromX,
        approachGridY: fromY,
        climbGridX: toX,
        climbGridY: toY,
        heightDelta,
        stepIndex,
      };
    }
    return null;
  };

  const evaluateLineTraversal = () => {
    const dx = targetGridX - startGridX;
    const dy = targetGridY - startGridY;
    if (dx === 0 && dy === 0) return null;
    const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
    const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
    const absDx = Math.abs(dx);
    const absDy = Math.abs(dy);
    let cursorX = startGridX;
    let cursorY = startGridY;
    let err = absDx - absDy;
    let stepIndex = 0;
    while (cursorX !== targetGridX || cursorY !== targetGridY) {
      const prevX = cursorX;
      const prevY = cursorY;
      const err2 = err * 2;
      if (err2 > -absDy) {
        err -= absDy;
        cursorX += stepX;
      }
      if (err2 < absDx) {
        err += absDx;
        cursorY += stepY;
      }
      const plan = evaluateStep(prevX, prevY, cursorX, cursorY, stepIndex);
      if (plan) {
        return plan;
      }
      stepIndex += 1;
    }
    return null;
  };

  const linePlan = evaluateLineTraversal();
  if (linePlan) {
    return linePlan;
  }

  const evaluateOrder = (axesOrder) => {
    let cursorX = startGridX;
    let cursorY = startGridY;
    let stepIndex = 0;
    for (const axis of axesOrder) {
      const targetValue = axis === 'x' ? targetGridX : targetGridY;
      const delta = (axis === 'x' ? targetValue - cursorX : targetValue - cursorY) || 0;
      const step = Math.sign(delta);
      if (step === 0) continue;
      while ((axis === 'x' ? cursorX : cursorY) !== targetValue) {
        const nextX = axis === 'x' ? cursorX + step : cursorX;
        const nextY = axis === 'y' ? cursorY + step : cursorY;
        const plan = evaluateStep(cursorX, cursorY, nextX, nextY, stepIndex);
        if (plan) {
          return plan;
        }
        cursorX = nextX;
        cursorY = nextY;
        stepIndex += 1;
      }
    }
    return null;
  };

  const plans = [];
  const axisOrders = [
    ['x', 'y'],
    ['y', 'x'],
  ];
  for (const order of axisOrders) {
    const plan = evaluateOrder(order);
    if (plan) {
      plans.push(plan);
    }
  }

  if (!plans.length) return null;
  plans.sort((a, b) => a.stepIndex - b.stepIndex);
  const best = plans[0];
  if (!best) return null;
  return {
    approachGridX: best.approachGridX,
    approachGridY: best.approachGridY,
    climbGridX: best.climbGridX,
    climbGridY: best.climbGridY,
    heightDelta: best.heightDelta,
  };
}

function _attemptIntermediateClimbRedirect(state) {
  if (!state || !state.token) return false;
  const continuationGoal = state.climbContinuationGoal;
  const fallbackGoal = state.lastRequestedGoal;
  const targetGoal = continuationGoal || fallbackGoal;
  if (!targetGoal) {
    return false;
  }

  const tokenDescriptor = this._describeTokenForLogs(state.token);
  this._logPathing('path:attempt-intermediate-redirect', {
    token: tokenDescriptor,
    targetGoal: {
      gridX: targetGoal.gridX,
      gridY: targetGoal.gridY,
    },
    source: continuationGoal ? 'continuation' : 'fallback',
  });

  const resumed = this._reissueMaintainedGoal(state, targetGoal, {
    allowSameTile: true,
  });

  if (resumed && targetGoal) {
    state.climbContinuationGoal = this._cloneClimbContinuationGoal(targetGoal);
  }

  this._logPathing('path:attempt-intermediate-redirect:result', {
    token: tokenDescriptor,
    resumed,
  });

  return resumed;
}

// ── Install ──────────────────────────────────────────────────────────────

export function installNavigationMethods(prototype) {
  prototype.navigateToGrid = navigateToGrid;
  prototype._clearPathState = _clearPathState;
  prototype._completePath = _completePath;
  prototype._reissueMaintainedGoal = _reissueMaintainedGoal;
  prototype._resumeCachedPostClimbGoal = _resumeCachedPostClimbGoal;
  prototype._orientTokenTowardsWorld = _orientTokenTowardsWorld;
  prototype._normalizePathSpeedMode = _normalizePathSpeedMode;
  prototype._computeGridDistance = _computeGridDistance;
  prototype._planIntermediateClimbTraversal = _planIntermediateClimbTraversal;
  prototype._attemptIntermediateClimbRedirect = _attemptIntermediateClimbRedirect;
}
