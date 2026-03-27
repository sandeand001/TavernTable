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
  HARD_LANDING_HEIGHT_THRESHOLD,
  ROLLING_LANDING_HEIGHT_THRESHOLD,
  FALL_MIN_HEIGHT_THRESHOLD,
  FALL_EDGE_TRIGGER_TILE_RATIO,
  PATH_STALL_REPATH_DELAY,
} from './MannequinConfig.js';

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
  const pathGoal = state.pathActive ? state.pathGoal : null;
  const goalWorld = pathGoal?.world || null;
  let clampToGoal = false;
  let tolerance = 0;

  if (goalWorld) {
    const toGoalX = goalWorld.x - currentWorld.x;
    const toGoalZ = goalWorld.z - currentWorld.z;
    const remaining = Math.hypot(toGoalX, toGoalZ);
    const tileSize = bounds?.tileSize || this.gameManager?.spatial?.tileWorldSize || 1;
    tolerance = Math.max(state.pathTolerance || tileSize * 0.1, 0.05);

    if (remaining > 1e-6) {
      direction = { x: toGoalX / remaining, z: toGoalZ / remaining };
    }

    if (!(remaining > tolerance)) {
      distance = remaining;
      clampToGoal = true;
    } else {
      const projected = toGoalX * direction.x + toGoalZ * direction.z;
      if (projected <= tolerance) {
        distance = Math.max(remaining - tolerance, 0);
        clampToGoal = true;
      } else if (distance >= projected) {
        distance = Math.max(projected, 0);
        clampToGoal = true;
      }
    }
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

  this._syncTokenAndMeshWorld(state, nextWorld);

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
    state.pathReached = remainingAfter <= Math.max(tolerance, 0.05);
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

function _createForwardMovementStep(tokenEntry, mesh) {
  try {
    const gm = this.gameManager;
    if (!gm?.spatial) return null;
    const rawGridX = Number.isFinite(tokenEntry.gridX) ? tokenEntry.gridX : 0;
    const rawGridY = Number.isFinite(tokenEntry.gridY) ? tokenEntry.gridY : 0;
    const storedGridX = Math.round(rawGridX);
    const storedGridY = Math.round(rawGridY);
    let startGridX = storedGridX;
    let startGridY = storedGridY;
    const world = tokenEntry.world;
    if (world && Number.isFinite(world.x) && Number.isFinite(world.z)) {
      const mapped = this._mapWorldToGrid(world);
      if (mapped && mapped.gridX != null && mapped.gridY != null) {
        const dx = Math.abs(mapped.gridX - storedGridX);
        const dy = Math.abs(mapped.gridY - storedGridY);
        if (dx <= 1 && dy <= 1 && (mapped.gridX !== storedGridX || mapped.gridY !== storedGridY)) {
          const storedH = this._getTerrainHeight(storedGridX, storedGridY);
          const mappedH = this._getTerrainHeight(mapped.gridX, mapped.gridY);
          if (Number.isFinite(storedH) && Number.isFinite(mappedH) && storedH === mappedH) {
            startGridX = mapped.gridX;
            startGridY = mapped.gridY;
          }
        }
      }
    }
    const yaw = this._getMovementYaw(tokenEntry);
    const { stepX, stepY } = this._getForwardGridDelta(yaw);
    if (stepX === 0 && stepY === 0) return null;

    const targetGridX = startGridX + stepX;
    const targetGridY = startGridY + stepY;

    const startHeight = this._getTerrainHeight(startGridX, startGridY);
    const targetHeight = this._getTerrainHeight(targetGridX, targetGridY);
    const heightDrop =
      Number.isFinite(startHeight) && Number.isFinite(targetHeight)
        ? startHeight - targetHeight
        : 0;

    const startWorld =
      this._cloneWorld(tokenEntry.world) ||
      gm.spatial.gridToWorld(startGridX + 0.5, startGridY + 0.5, startHeight);
    const targetWorld = gm.spatial.gridToWorld(targetGridX + 0.5, targetGridY + 0.5, targetHeight);

    const startPosition = this._composeMeshPosition(startWorld, mesh);
    const targetPosition = this._composeMeshPosition(targetWorld, mesh);

    const dx = targetPosition.x - startPosition.x;
    const dy = targetPosition.y - startPosition.y;
    const dz = targetPosition.z - startPosition.z;
    const totalDistance = Math.hypot(dx, dy, dz);
    if (!(totalDistance > 0.001)) return null;

    const horizontalDistance = Math.hypot(dx, dz);
    const tileSize = gm.spatial?.tileWorldSize || 1;
    const edgeDistance = Math.min(
      horizontalDistance,
      tileSize * Math.max(Math.min(FALL_EDGE_TRIGGER_TILE_RATIO, 0.95), 0.4)
    );
    const fallTriggerProgress = horizontalDistance > 0 ? edgeDistance / horizontalDistance : 1;
    const normalizedTrigger = Math.min(
      Math.max(fallTriggerProgress || DEFAULT_FALL_TRIGGER_PROGRESS, 0.4),
      0.98
    );
    const requiresFall = heightDrop > FALL_MIN_HEIGHT_THRESHOLD;
    let landingVariant = null;
    if (requiresFall) {
      if (heightDrop > ROLLING_LANDING_HEIGHT_THRESHOLD) {
        landingVariant = 'fallToRoll';
      } else if (heightDrop > HARD_LANDING_HEIGHT_THRESHOLD) {
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
  } catch (_) {
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
