/**
 * StepFactory.js
 *
 * Free-movement advance loop, movement-step creation, stop-glide steps,
 * and movement-state reset methods extracted from Token3DAdapter.
 * Each function is written with `this` semantics so it can be installed
 * on a class prototype via `installStepFactoryMethods()`.
 */

import {
  DEFAULT_MOVEMENT_PROFILE,
  DEFAULT_FALL_TRIGGER_PROGRESS,
  DEFAULT_HEIGHT_SNAP_PROGRESS,
  FALL_EDGE_TRIGGER_TILE_RATIO,
  PATH_STALL_REPATH_DELAY,
  MAX_STANDARD_CLIMB_LEVELS,
  CLIMB_WALL_ENTRY_TILE_HALF_RATIO,
} from '../../../config/token-adapter/MannequinConfig.js';
import {
  FEET_PER_GRID_SQUARE,
  MAX_STEP_HEIGHT_FEET,
  HARD_LANDING_HEIGHT_FEET,
  ROLLING_LANDING_HEIGHT_FEET,
} from '../../../config/TokenMovementConfig.js';
import { GameErrors } from '../../../utils/error/ErrorHandler.js';

// ── Free Movement ────────────────────────────────────────────────────────

function _advanceFreeMovement(state, delta, bounds) {
  if (!state || !(delta > 0)) return;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  const speed = Math.max(
    state.activeSpeed ?? profile.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed ?? 1,
    0
  );
  if (!(speed > 0)) {
    if (state.pathActive) {
      this._logPathingOnce(state, 'free-no-speed', 'movement:advance-skipped', {
        token: this._describeTokenForLogs(state.token),
        reason: 'no-speed',
        phase: state.phase,
        movementSign: state.movementSign,
        intentHold: state.intentHold,
      });
    }
    return;
  }

  const sign = state.movementSign || 0;
  if (sign === 0) {
    if (state.pathActive) {
      this._logPathingOnce(state, 'free-no-sign', 'movement:advance-skipped', {
        token: this._describeTokenForLogs(state.token),
        reason: 'no-direction',
        phase: state.phase,
        pathActive: state.pathActive,
        intentHold: state.intentHold,
        forwardKeys: state.forwardKeys ? Array.from(state.forwardKeys) : [],
      });
    }
    return;
  }

  const yaw = this._getMovementYaw(state.token);
  let direction = this._getDirectionalVectorFromYaw(yaw, sign);
  if (!direction || (Math.abs(direction.x) < 1e-6 && Math.abs(direction.z) < 1e-6)) {
    if (state.pathActive) {
      this._logPathingOnce(state, 'free-bad-direction', 'movement:advance-skipped', {
        token: this._describeTokenForLogs(state.token),
        reason: 'no-direction-vector',
        phase: state.phase,
        yaw,
      });
    }
    return;
  }

  let distance = speed * delta;
  if (!(distance > 0)) {
    if (state.pathActive) {
      this._logPathingOnce(state, 'free-no-distance', 'movement:advance-skipped', {
        token: this._describeTokenForLogs(state.token),
        reason: 'zero-distance',
        phase: state.phase,
        speed,
        delta,
      });
    }
    return;
  }

  const currentWorld = this._resolveTokenWorldPosition(state.token);
  const sampledCurrentY = this._sampleWorldHeight(currentWorld.x, currentWorld.z, currentWorld.y);
  const worldYOffset =
    Number.isFinite(currentWorld.y) && Number.isFinite(sampledCurrentY)
      ? currentWorld.y - sampledCurrentY
      : 0;
  let goalWorld = (state.pathActive ? state.pathGoal?.world : state.climbKeyboardApproach) || null;
  let clampToGoal = false;
  let tolerance = 0;
  const tileSize = bounds?.tileSize || this.gameManager?.spatial?.tileWorldSize || 1;

  if (goalWorld) {
    const remaining = Math.hypot(goalWorld.x - currentWorld.x, goalWorld.z - currentWorld.z);
    if (remaining > 1e-6) {
      direction = {
        x: (goalWorld.x - currentWorld.x) / remaining,
        z: (goalWorld.z - currentWorld.z) / remaining,
      };
    }
  }

  if (!state.groundTransition) {
    const edge = this._findTerrainTransition(
      currentWorld,
      {
        x: currentWorld.x + direction.x * tileSize,
        z: currentWorld.z + direction.z * tileSize,
      },
      (from, to) => {
        const feet =
          (Math.abs(to - from) * this.gameManager.spatial.elevationUnit * FEET_PER_GRID_SQUARE) /
          tileSize;
        return feet > 1e-8 && feet <= MAX_STEP_HEIGHT_FEET + 1e-8;
      }
    );
    if (edge) {
      state.groundTransition = {
        edge: { ...edge.world },
        direction: { ...direction },
        fromY: edge.fromHeight * this.gameManager.spatial.elevationUnit,
        toY: edge.toHeight * this.gameManager.spatial.elevationUnit,
        halfWidth: tileSize * 0.25,
      };
    }
  }

  if (!state.climbQueued && !state.climbKeyboardApproach) {
    const lookAhead = goalWorld
      ? Math.min(tileSize, Math.hypot(goalWorld.x - currentWorld.x, goalWorld.z - currentWorld.z))
      : tileSize;
    const edge = this._findTerrainTransition(
      currentWorld,
      {
        x: currentWorld.x + direction.x * lookAhead,
        z: currentWorld.z + direction.z * lookAhead,
      },
      (fromHeight, toHeight) => toHeight - fromHeight >= MAX_STANDARD_CLIMB_LEVELS
    );
    if (edge && (state.pathActive || sign > 0)) {
      const plan = this._createClimbApproach(state.token, edge.toGrid.gridX, edge.toGrid.gridY);
      if (!plan) {
        throw new Error('Unable to plan a climb at the terrain edge');
      }
      state.climbQueued = plan.info;
      if (state.pathActive) {
        state.climbContinuationGoal = this._cloneClimbContinuationGoal(
          state.lastRequestedGoal || state.pathGoal
        );
        state.pathGoal = plan.goal;
      } else {
        state.climbKeyboardActive = true;
        state.climbKeyboardApproach = plan.goal.world;
        state.lastRequestedGoal = null;
        state.climbContinuationGoal = null;
      }
      goalWorld = plan.goal.world;
      this._orientTokenTowardsWorld(state.token, goalWorld);
    } else if (edge) {
      const standOff = tileSize * (1 - CLIMB_WALL_ENTRY_TILE_HALF_RATIO) * 0.5;
      distance = Math.min(distance, Math.max(edge.distance - standOff, 0));
    }
  }

  if (goalWorld) {
    const toGoalX = goalWorld.x - currentWorld.x;
    const toGoalZ = goalWorld.z - currentWorld.z;
    const remaining = Math.hypot(toGoalX, toGoalZ);
    tolerance = Math.max(state.pathTolerance || tileSize * 0.1, 0.05);

    if (remaining > 1e-6) {
      direction = { x: toGoalX / remaining, z: toGoalZ / remaining };
    }

    clampToGoal = remaining <= distance + 1e-6;
    distance = Math.min(distance, remaining);
  }

  if (!(distance > 0) && !clampToGoal) {
    return;
  }

  const nextWorld = {
    x: currentWorld.x + direction.x * distance,
    y: currentWorld.y,
    z: currentWorld.z + direction.z * distance,
  };

  if (bounds) {
    if (Number.isFinite(bounds.minX)) nextWorld.x = Math.max(nextWorld.x, bounds.minX);
    if (Number.isFinite(bounds.maxX)) nextWorld.x = Math.min(nextWorld.x, bounds.maxX);
    if (Number.isFinite(bounds.minZ)) nextWorld.z = Math.max(nextWorld.z, bounds.minZ);
    if (Number.isFinite(bounds.maxZ)) nextWorld.z = Math.min(nextWorld.z, bounds.maxZ);
  }

  if (goalWorld && clampToGoal) {
    nextWorld.x = goalWorld.x;
    nextWorld.z = goalWorld.z;
    const baseGoalY = Number.isFinite(goalWorld.y) ? goalWorld.y : currentWorld.y;
    nextWorld.y = baseGoalY + worldYOffset;
  } else {
    const sampledNextY = this._sampleWorldHeight(nextWorld.x, nextWorld.z, currentWorld.y);
    const baseNextY = Number.isFinite(sampledNextY) ? sampledNextY : currentWorld.y;
    nextWorld.y = baseNextY + worldYOffset;
  }
  const groundTransition = state.groundTransition;
  if (groundTransition) {
    const along =
      (nextWorld.x - groundTransition.edge.x) * groundTransition.direction.x +
      (nextWorld.z - groundTransition.edge.z) * groundTransition.direction.z;
    const ratio = Math.min(
      1,
      Math.max(0, (along + groundTransition.halfWidth) / (2 * groundTransition.halfWidth))
    );
    const smooth = ratio * ratio * (3 - 2 * ratio);
    nextWorld.y = groundTransition.fromY + (groundTransition.toY - groundTransition.fromY) * smooth;
    if (ratio >= 1) state.groundTransition = null;
  }

  this._syncTokenAndMeshWorld(state, nextWorld);
  this._applyTokenGridFromWorld(state.token, nextWorld);

  const actualDistance = Math.hypot(nextWorld.x - currentWorld.x, nextWorld.z - currentWorld.z);
  if (delta > 1e-4 && actualDistance > 0) {
    state.lastMoveSpeed = actualDistance / delta;
  }

  if (state.pathActive && goalWorld) {
    const now =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    const lastLog = state.__pathAdvanceLogAt || 0;
    if (!lastLog || now - lastLog >= 200) {
      state.__pathAdvanceLogAt = now;
      const remainingAfter = Math.hypot(goalWorld.x - nextWorld.x, goalWorld.z - nextWorld.z);
      this._logPathing('movement:advance', {
        token: this._describeTokenForLogs(state.token),
        phase: state.phase,
        actualDistance,
        remainingAfter,
        tolerance,
        movementSign: state.movementSign,
        intentHold: state.intentHold,
      });
    }
  }

  if (goalWorld) {
    if (actualDistance <= 1e-4) {
      state.pathStallTime = (state.pathStallTime || 0) + delta;
      if (state.pathStallTime >= PATH_STALL_REPATH_DELAY) {
        const tokenDescriptor = this._describeTokenForLogs(state.token);
        const worldDistanceToGoal = Math.hypot(
          goalWorld.x - currentWorld.x,
          goalWorld.z - currentWorld.z
        );
        this._logPathing('path:stall-detected', {
          token: tokenDescriptor,
          worldDistanceToGoal,
          tolerance,
          stallTime: state.pathStallTime,
        });
        const rerouted = this._attemptIntermediateClimbRedirect(state);
        this._logPathing('path:stall-reroute', {
          token: tokenDescriptor,
          rerouted,
        });
        state.pathStallTime = 0;
        if (rerouted) {
          return;
        }
      }
    } else {
      state.pathStallTime = 0;
    }
  } else {
    state.pathStallTime = 0;
  }

  if (!state.freeStartWorld) {
    state.freeStartWorld = this._cloneWorld(currentWorld);
  }
  state.freeLastWorld = this._cloneWorld(nextWorld);
  state.freeDistance += actualDistance;
  this._handleResumeProbeProgress(state);
  state.activeStep = null;
  state.stepFinalized = false;

  if (goalWorld) {
    const remainingAfter = Math.hypot(goalWorld.x - nextWorld.x, goalWorld.z - nextWorld.z);
    state.pathReached = state.pathActive && remainingAfter <= 1e-5;
    if (state.climbKeyboardApproach && remainingAfter <= 1e-5) {
      state.climbKeyboardApproach = null;
      this._startClimbPhase(state, state.climbQueued);
    }
  } else {
    state.pathReached = false;
  }
}

// ── Step Creation & Movement Reset ───────────────────────────────────────

function _lockStepAtTarget(state) {
  const step = state.activeStep;
  if (!step) return;
  this._syncTokenAndMeshWorld(state, step.targetWorld, {
    token: step.tokenEntry,
    mesh: step.mesh,
  });
  step.traveled = step.totalDistance;
  step.horizontalTraveled = step.horizontalDistance;
  state.stepFinalized = true;
  const token = step.tokenEntry;
  token.gridX = step.gridTargetX;
  token.gridY = step.gridTargetY;
}

function _createStopGlideStep(state, profile) {
  try {
    const tokenEntry = state?.token;
    if (!tokenEntry) return null;
    const mesh = state?.mesh || tokenEntry.__threeMesh;
    if (!mesh) return null;

    const lastSign = state?.lastMoveSign || state?.movementSign || 0;
    if (lastSign === 0) return null;

    const duration = Math.max(state?.stopMovementDuration ?? profile?.stopMovementDuration ?? 0, 0);
    if (!(duration > 0)) return null;

    const baseWalk = Math.max(
      state?.activeSpeed ?? profile?.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed ?? 0,
      0
    );
    const recentSpeed = Math.max(state?.lastMoveSpeed || 0, 0);
    const glideSpeed = Math.max(recentSpeed, baseWalk);
    if (!(glideSpeed > 0)) return null;

    const yaw = this._getMovementYaw(tokenEntry);
    const direction = this._getDirectionalVectorFromYaw(yaw, lastSign);
    if (!direction || (Math.abs(direction.x) < 1e-6 && Math.abs(direction.z) < 1e-6)) {
      return null;
    }

    const distance = glideSpeed * duration;
    if (!(distance > 0)) return null;

    const currentWorld = this._resolveTokenWorldPosition(tokenEntry);
    const bounds = this._computeMovementBounds();
    const targetWorld = {
      x: currentWorld.x + direction.x * distance,
      y: currentWorld.y,
      z: currentWorld.z + direction.z * distance,
    };

    if (bounds) {
      if (Number.isFinite(bounds.minX)) targetWorld.x = Math.max(targetWorld.x, bounds.minX);
      if (Number.isFinite(bounds.maxX)) targetWorld.x = Math.min(targetWorld.x, bounds.maxX);
      if (Number.isFinite(bounds.minZ)) targetWorld.z = Math.max(targetWorld.z, bounds.minZ);
      if (Number.isFinite(bounds.maxZ)) targetWorld.z = Math.min(targetWorld.z, bounds.maxZ);
    }

    targetWorld.y = this._sampleWorldHeight(targetWorld.x, targetWorld.z, currentWorld.y);

    const startPosition = this._composeMeshPosition(currentWorld, mesh);
    const targetPosition = this._composeMeshPosition(targetWorld, mesh);
    const dx = targetPosition.x - startPosition.x;
    const dy = targetPosition.y - startPosition.y;
    const dz = targetPosition.z - startPosition.z;
    const totalDistance = Math.hypot(dx, dy, dz);
    if (!(totalDistance > 1e-4)) return null;

    const horizontalDistance = Math.hypot(dx, dz);

    let gridStartX = Number(tokenEntry.gridX);
    let gridStartY = Number(tokenEntry.gridY);
    if (!Number.isFinite(gridStartX)) gridStartX = 0;
    if (!Number.isFinite(gridStartY)) gridStartY = 0;

    let gridTargetX = gridStartX;
    let gridTargetY = gridStartY;
    try {
      const spatial = this.gameManager?.spatial;
      if (spatial?.worldToGrid) {
        const mapped = spatial.worldToGrid(targetWorld.x, targetWorld.z);
        if (Number.isFinite(mapped?.gridX)) gridTargetX = mapped.gridX;
        if (Number.isFinite(mapped?.gridY)) gridTargetY = mapped.gridY;
      }
    } catch (_) {
      gridTargetX = gridStartX;
      gridTargetY = gridStartY;
    }

    const startWorldClone = this._cloneWorld(currentWorld) || currentWorld;
    const targetWorldClone = this._cloneWorld(targetWorld) || targetWorld;

    return {
      tokenEntry,
      mesh,
      startWorld: startWorldClone,
      targetWorld: targetWorldClone,
      startPosition,
      targetPosition,
      totalDistance,
      traveled: 0,
      gridStartX,
      gridStartY,
      gridTargetX,
      gridTargetY,
      startHeight: currentWorld.y,
      targetHeight: targetWorld.y,
      heightDrop: (currentWorld.y ?? 0) - (targetWorld.y ?? currentWorld.y),
      requiresFall: false,
      fallTriggerProgress: 1,
      fallTriggered: false,
      horizontalDistance,
      horizontalTraveled: 0,
      verticalSnapProgress: 1,
      landingVariant: null,
    };
  } catch (_) {
    return null;
  }
}

function _triggerStop(state) {
  if (!state || state.phase === 'stop') return;
  this._initiateStopPhase(state);
}

function _resetMovementState(state, options = {}) {
  if (!state) return;
  const normalizedOptions = {
    useStopBlend: Boolean(options.useStopBlend),
    clearStopFlags: Boolean(options.clearStopFlags),
  };

  this._clearPathState(state);
  this._resetSprintState(state);
  this._applyPendingOrientation(state);

  if (state.__worldLockActive) {
    this._mergePendingMovementResetOptions(state, normalizedOptions);
    return;
  }

  this._unlockTokenWorldAuthority(state);
  this._applyMovementResetCore(state, normalizedOptions);
}

function _mergePendingMovementResetOptions(state, options = {}) {
  if (!state) return;
  const pending = state.__pendingMovementResetOptions || {};
  state.__pendingMovementResetOptions = {
    useStopBlend: pending.useStopBlend || Boolean(options.useStopBlend),
    clearStopFlags: pending.clearStopFlags || Boolean(options.clearStopFlags),
  };
}

function _applyMovementResetCore(state, options = {}) {
  if (!state) return;
  const { useStopBlend = false, clearStopFlags = false } = options;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;

  state.__pendingMovementResetOptions = null;
  state.phase = 'idle';
  state.activeStep = null;
  state.stepFinalized = true;
  state.intentHold = false;
  state.climbQueued = null;
  state.climbKeyboardApproach = null;
  state.climbKeyboardActive = false;

  if (clearStopFlags) {
    state.stopTriggered = false;
    state.pendingStop = false;
  }

  if (!state.stopBlendedToIdle) {
    this._setAnimation(state.token, 'idle', {
      fadeIn: profile.idleFadeIn,
      fadeOut: useStopBlend ? profile.stopFadeOut : profile.walkFadeOut,
    });
  }

  if (!this._hasActiveIntents(state) && !this._shouldHoldMovementState(state)) {
    this._movementStates.delete(state.token);
  }
}

function _createForwardMovementStep(tokenEntry, mesh, directionSign = 1) {
  try {
    const gm = this.gameManager;
    if (!gm?.spatial) return null;
    const startWorld = this._resolveTokenWorldPosition(tokenEntry);
    const currentGrid = this._mapWorldToGrid(startWorld) || tokenEntry;
    const startGridX = currentGrid.gridX;
    const startGridY = currentGrid.gridY;
    const yaw = this._getMovementYaw(tokenEntry);
    let direction = this._getDirectionalVectorFromYaw(yaw, directionSign);
    const state = this._movementStates.get(tokenEntry);
    const goal = state?.pathActive ? state.pathGoal?.world : null;
    const goalDistance = goal ? Math.hypot(goal.x - startWorld.x, goal.z - startWorld.z) : Infinity;
    if (goal && goalDistance > 1e-6) {
      direction = {
        x: (goal.x - startWorld.x) / goalDistance,
        z: (goal.z - startWorld.z) / goalDistance,
      };
    }
    const tileSize = gm.spatial.tileWorldSize || 1;
    const lookAhead = Math.min(tileSize, goalDistance);
    const edge = this._findTerrainTransition(
      startWorld,
      { x: startWorld.x + direction.x * lookAhead, z: startWorld.z + direction.z * lookAhead },
      (fromHeight, toHeight) =>
        ((fromHeight - toHeight) * gm.spatial.elevationUnit * FEET_PER_GRID_SQUARE) / tileSize >
        MAX_STEP_HEIGHT_FEET + 1e-8
    );
    if (!edge) return null;
    const targetGridX = edge.toGrid.gridX;
    const targetGridY = edge.toGrid.gridY;
    const startHeight = this._getTerrainHeight(startGridX, startGridY);
    const targetHeight = edge.toHeight;
    const heightDrop = edge.fromHeight - targetHeight;
    const insideDistance = Math.min(tileSize * 0.5, (edge.exitDistance - edge.distance) * 0.5);
    const landingDistance = Math.min(edge.distance + insideDistance, goalDistance);
    const targetWorld = {
      x: startWorld.x + direction.x * landingDistance,
      y: this._sampleWorldHeight(
        startWorld.x + direction.x * landingDistance,
        startWorld.z + direction.z * landingDistance,
        edge.world.y
      ),
      z: startWorld.z + direction.z * landingDistance,
    };

    const startPosition = this._composeMeshPosition(startWorld, mesh);
    const targetPosition = this._composeMeshPosition(targetWorld, mesh);

    const dx = targetPosition.x - startPosition.x;
    const dy = targetPosition.y - startPosition.y;
    const dz = targetPosition.z - startPosition.z;
    const totalDistance = Math.hypot(dx, dy, dz);
    if (!(totalDistance > 0.001)) return null;

    const horizontalDistance = Math.hypot(dx, dz);
    const supportMargin = tileSize * (FALL_EDGE_TRIGGER_TILE_RATIO - 0.5);
    const edgeDistance = Math.min(horizontalDistance, edge.distance + Math.max(supportMargin, 0));
    const fallTriggerProgress = horizontalDistance > 0 ? edgeDistance / horizontalDistance : 1;
    const normalizedTrigger = Math.min(
      Math.max(fallTriggerProgress || DEFAULT_FALL_TRIGGER_PROGRESS, 0),
      0.98
    );
    const dropFeet = (heightDrop * gm.spatial.elevationUnit * FEET_PER_GRID_SQUARE) / tileSize;
    const requiresFall = dropFeet > MAX_STEP_HEIGHT_FEET + 1e-8;
    let landingVariant = null;
    if (requiresFall) {
      if (dropFeet > ROLLING_LANDING_HEIGHT_FEET && directionSign > 0) {
        landingVariant = 'fallToRoll';
      } else if (dropFeet > HARD_LANDING_HEIGHT_FEET) {
        landingVariant = 'hardLanding';
      } else {
        landingVariant = 'fall';
      }
    }

    if (mesh?.position) {
      mesh.position.set(startPosition.x, startPosition.y, startPosition.z);
    }

    return {
      tokenEntry,
      mesh,
      startWorld,
      targetWorld,
      startPosition,
      targetPosition,
      totalDistance,
      traveled: 0,
      gridStartX: startGridX,
      gridStartY: startGridY,
      gridTargetX: targetGridX,
      gridTargetY: targetGridY,
      startHeight,
      targetHeight,
      heightDrop,
      requiresFall,
      fallTriggerProgress: normalizedTrigger,
      fallTriggered: false,
      horizontalDistance,
      horizontalTraveled: 0,
      verticalSnapProgress: DEFAULT_HEIGHT_SNAP_PROGRESS,
      landingVariant,
    };
  } catch (error) {
    GameErrors.gameState(error, {
      component: 'Token3DAdapter',
      operation: 'createFallStep',
      tokenId: tokenEntry?.id,
    });
    return null;
  }
}

// ── Install ──────────────────────────────────────────────────────────────

export function installStepFactoryMethods(prototype) {
  prototype._advanceFreeMovement = _advanceFreeMovement;
  prototype._lockStepAtTarget = _lockStepAtTarget;
  prototype._createStopGlideStep = _createStopGlideStep;
  prototype._triggerStop = _triggerStop;
  prototype._resetMovementState = _resetMovementState;
  prototype._mergePendingMovementResetOptions = _mergePendingMovementResetOptions;
  prototype._applyMovementResetCore = _applyMovementResetCore;
  prototype._createForwardMovementStep = _createForwardMovementStep;
}
