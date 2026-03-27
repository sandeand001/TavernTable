/**
 * MovementPhases.js
 *
 * Forward-movement update loop, phase advancement (start / walk / stop),
 * and movement-step interpolation methods extracted from Token3DAdapter.
 * Each function is written with `this` semantics so it can be installed on a
 * class prototype via `installMovementPhaseMethods()`.
 */

import {
  DEFAULT_MOVEMENT_PROFILE,
  DEFAULT_FALL_TRIGGER_PROGRESS,
  DEFAULT_HEIGHT_SNAP_PROGRESS,
} from './MannequinConfig.js';

// ── Movement Update Loop ─────────────────────────────────────────────────

function _updateForwardMovements(delta) {
  if (!this._movementStates.size) return;
  const bounds = this._computeMovementBounds();
  const entries = Array.from(this._movementStates.entries());
  for (const [tokenEntry, state] of entries) {
    if (!state) {
      this._movementStates.delete(tokenEntry);
      continue;
    }

    const mesh = tokenEntry?.__threeMesh;
    if (!mesh) {
      this._movementStates.delete(tokenEntry);
      continue;
    }
    state.mesh = mesh;

    try {
      this._advanceRotationState(state, delta);

      switch (state.phase) {
        case 'start':
          this._advanceStartPhase(state, delta, bounds);
          break;
        case 'walk':
          this._advanceWalkPhase(state, delta, bounds);
          break;
        case 'climb-wall':
          this._advanceClimbWallPhase(state, delta);
          break;
        case 'climb':
          this._advanceClimbPhase(state, delta);
          break;
        case 'climb-recover':
          this._advanceClimbRecoverPhase(state, delta);
          break;
        case 'climb-advance':
          this._advanceClimbAdvancePhase(state, delta);
          break;
        case 'stop':
          this._advanceStopPhase(state, delta);
          break;
        case 'fall':
          this._advanceFallPhase(state, delta);
          break;
        case 'idle':
        default: {
          const netIntent = this._recalculateMovementIntent(state);
          if (netIntent !== 0) {
            this._startMovementPhase(state, netIntent);
          } else if (!this._hasActiveIntents(state) && !this._shouldHoldMovementState(state)) {
            this._movementStates.delete(tokenEntry);
          }
          break;
        }
      }

      if (state.pathActive && state.pathReached) {
        this._completePath(state);
        continue;
      }

      if (state.pendingStop && state.phase !== 'stop' && state.phase !== 'fall') {
        this._initiateStopPhase(state);
      }

      this._checkResumeProbe(state);

      if (
        state.phase === 'idle' &&
        !this._hasActiveIntents(state) &&
        !this._shouldHoldMovementState(state)
      ) {
        this._movementStates.delete(tokenEntry);
      }
    } catch (_) {
      this._movementStates.delete(tokenEntry);
    }
  }
}

// ── Start Phase ──────────────────────────────────────────────────────────

function _advanceStartPhase(state, delta, bounds) {
  if (!state) return;
  this._syncMovementVariant(state, state.movementSign || state.lastMoveSign || 1);
  this._updateRunningDuration(state, delta, state.movementSign || state.lastMoveSign || 1);
  state.phaseElapsed += delta;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  const moveDelay = Math.max(state.startMoveDelay || 0, 0);

  if (state.phaseElapsed > moveDelay && state.movementSign !== 0) {
    const previous = Math.max(0, state.phaseElapsed - delta - moveDelay);
    const current = Math.max(0, state.phaseElapsed - moveDelay);
    const moveDelta = current - previous;
    if (moveDelta > 0) {
      this._advanceFreeMovement(state, moveDelta, bounds);
    }
  }

  const clipDuration = Math.max(state.startDuration || 0, 0);
  if (!state.hasLoopStarted && clipDuration > 0) {
    const lead = Math.min(Math.max(state.startBlendLead || 0, 0), clipDuration);
    if (state.phaseElapsed >= Math.max(clipDuration - lead, 0)) {
      this._playLoopAnimation(state, {
        fadeIn: profile.walkFadeIn,
        fadeOut: profile.walkFadeOut,
      });
      state.hasLoopStarted = true;
    }
  }

  if (clipDuration === 0 || state.phaseElapsed >= clipDuration - 1e-4) {
    state.phase = 'walk';
    state.phaseElapsed = 0;
    if (!state.hasLoopStarted) {
      this._playLoopAnimation(state, {
        fadeIn: profile.walkFadeIn,
        fadeOut: profile.walkFadeOut,
      });
      state.hasLoopStarted = true;
    }
  }
}

// ── Walk Phase ───────────────────────────────────────────────────────────

function _advanceWalkPhase(state, delta, bounds) {
  if (!state) return;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  const netIntent = this._recalculateMovementIntent(state);
  if (netIntent === 0) {
    this._updateRunningDuration(state, delta, netIntent);
    state.intentHold = false;
    state.pendingStop = true;
    return;
  }

  if (netIntent !== state.movementSign) {
    state.freeStartWorld = this._resolveTokenWorldPosition(state.token);
    state.freeLastWorld = this._cloneWorld(state.freeStartWorld);
    state.freeDistance = 0;
    state.phaseElapsed = 0;
  }

  state.movementSign = netIntent;
  state.lastMoveSign = netIntent;
  state.intentHold = true;
  state.pendingStop = false;

  this._syncMovementVariant(state, netIntent);
  this._updateRunningDuration(state, delta, netIntent);

  const fallStepActive = this._ensureFallStepActive(state);
  if (fallStepActive) {
    const baseSpeed = Math.max(
      state.activeSpeed ?? profile.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed ?? 1,
      0
    );
    const speed = Math.max(baseSpeed, Number(state.lastMoveSpeed) || 0);
    if (delta > 0 && speed > 0) {
      const completed = this._advanceMovementStep(state, speed * delta);
      if (state.phase === 'fall') {
        return;
      }
      if (completed && state.__fallStepActive) {
        this._clearFallStepState(state, { force: true });
      }
    }
    return;
  }

  if (delta > 0) {
    this._advanceFreeMovement(state, delta, bounds);
  }
}

// ── Stop Phase ───────────────────────────────────────────────────────────

function _initiateStopPhase(state) {
  if (!state || state.phase === 'stop') return;
  state.activeStep = null;
  state.stepFinalized = true;
  state.phase = 'stop';
  state.stopTriggered = true;
  state.pendingStop = false;
  state.intentHold = false;
  state.movementSign = 0;
  state.stopElapsed = 0;
  state.stopMovementElapsed = 0;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  state.stopMovementTime = 0;
  state.stopSpeed = 0;
  state.stopBlendedToIdle = false;
  this._resetSprintState(state);

  const data = this._tokenAnimationData.get(state.token);
  const snapshot = this._captureMovementStyleSnapshot(state);
  this._updateMovementFlags(state, state.lastMoveSign || state.activeDirectionSign || -1);
  this._handleMovementStyleChange(state, snapshot);
  const stopActionKey = state.stopActionKey;
  const hasStopAction = !!(stopActionKey && data?.actions?.[stopActionKey]);
  let glideStep = null;
  if (hasStopAction) {
    glideStep = this._createStopGlideStep(state, profile);
    if (glideStep) {
      state.activeStep = glideStep;
      state.stepFinalized = false;
      const duration = Math.max(state.stopMovementDuration ?? profile.stopMovementDuration ?? 0, 0);
      state.stopMovementTime = duration;
      if (state.stopMovementTime > 1e-4) {
        state.stopSpeed = glideStep.totalDistance / state.stopMovementTime;
      } else {
        const fallbackSpeed = Math.max(
          state.lastMoveSpeed || profile.walkSpeed || DEFAULT_MOVEMENT_PROFILE.walkSpeed || 0,
          0
        );
        state.stopSpeed = fallbackSpeed;
        state.stopMovementTime =
          state.stopSpeed > 1e-4 ? glideStep.totalDistance / state.stopSpeed : 0;
      }
    }
  }

  if (hasStopAction) {
    this._setAnimation(state.token, stopActionKey, {
      fadeIn: profile.stopFadeIn,
      fadeOut: profile.stopFadeOut,
      force: true,
    });
    if (!glideStep) {
      state.stopMovementTime = 0;
      state.stopSpeed = 0;
    }
  } else {
    this._setAnimation(state.token, 'idle', {
      fadeIn: profile.idleFadeIn,
      fadeOut: profile.walkFadeOut,
      force: true,
    });
    this._resetMovementState(state, { useStopBlend: true, clearStopFlags: true });
  }
}

function _advanceStopPhase(state, delta) {
  if (!state) return;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  const step = state.activeStep;
  state.stopElapsed += delta;

  if (step && state.stopMovementTime > 0 && state.stopMovementElapsed < state.stopMovementTime) {
    const remainingTime = state.stopMovementTime - state.stopMovementElapsed;
    const timeSlice = Math.min(delta, remainingTime);
    this._advanceMovementStep(state, state.stopSpeed * timeSlice, { clamp: true });
    state.stopMovementElapsed += timeSlice;
  } else if (step && !state.stepFinalized) {
    this._lockStepAtTarget(state);
  }

  const clipDuration = state.stopDuration ?? profile.stopClipDuration ?? 0;
  if (!state.stopBlendedToIdle && clipDuration > 0) {
    const lead = Math.min(state.stopBlendLead ?? profile.stopBlendLead ?? 0, clipDuration);
    if (state.stopElapsed >= Math.max(clipDuration - lead, 0)) {
      this._setAnimation(state.token, 'idle', {
        fadeIn: profile.idleFadeIn,
        fadeOut: profile.stopFadeOut,
      });
      state.stopBlendedToIdle = true;
    }
  }

  if (clipDuration === 0 || state.stopElapsed >= clipDuration - 1e-4) {
    this._resetMovementState(state, { useStopBlend: true, clearStopFlags: true });
  }
}

// ── Movement Step Advancement ────────────────────────────────────────────

function _advanceMovementStep(state, distance, options = {}) {
  const step = state.activeStep;
  if (!step || distance <= 0) return false;
  const fallSingleUse = !!step.__fallSingleUse;

  const remaining = Math.max(0, step.totalDistance - step.traveled);
  const move = Math.min(distance, remaining);
  if (move <= 0) {
    return remaining <= 1e-5;
  }

  step.traveled += move;
  const ratio = step.totalDistance > 0 ? Math.min(step.traveled / step.totalDistance, 1) : 1;
  const pos = this._lerp3(step.startPosition, step.targetPosition, ratio);
  const world = this._lerp3(step.startWorld, step.targetWorld, ratio);

  const isFallPhase = state?.phase === 'fall';
  const requiresFall = !!step.requiresFall;
  const verticalDelta = Math.abs((step.startPosition?.y ?? 0) - (step.targetPosition?.y ?? 0));

  if (requiresFall) {
    if (isFallPhase) {
      const fallStartRatio = Number.isFinite(step.fallStartRatio) ? step.fallStartRatio : 0;
      const fallStartPositionY = Number.isFinite(step.fallStartPosition?.y)
        ? step.fallStartPosition.y
        : (step.startPosition?.y ?? pos.y);
      const fallStartWorldY = Number.isFinite(step.fallStartWorld?.y)
        ? step.fallStartWorld.y
        : (step.startWorld?.y ?? world.y);

      let fallProgress = 0;
      if (ratio > fallStartRatio) {
        const denom = Math.max(1 - fallStartRatio, 1e-6);
        fallProgress = Math.min((ratio - fallStartRatio) / denom, 1);
      }

      const targetPositionY = step.targetPosition?.y ?? fallStartPositionY;
      const targetWorldY = step.targetWorld?.y ?? fallStartWorldY;
      pos.y = fallStartPositionY + (targetPositionY - fallStartPositionY) * fallProgress;
      world.y = fallStartWorldY + (targetWorldY - fallStartWorldY) * fallProgress;
    } else {
      pos.y = step.startPosition?.y ?? pos.y;
      world.y = step.startWorld?.y ?? world.y;
    }
  } else if (verticalDelta > 1e-4) {
    const snapProgress = step.verticalSnapProgress || DEFAULT_HEIGHT_SNAP_PROGRESS;
    const useTarget = ratio >= snapProgress || options?.clamp;
    pos.y = useTarget ? step.targetPosition.y : step.startPosition.y;
    world.y = useTarget ? step.targetWorld.y : step.startWorld.y;
  }

  step.horizontalTraveled = Math.hypot(pos.x - step.startPosition.x, pos.z - step.startPosition.z);
  this._syncTokenAndMeshWorld(state, world, {
    token: step.tokenEntry,
    mesh: step.mesh,
  });

  const completed = step.traveled >= step.totalDistance - 1e-5;

  if (state.phase !== 'fall' && step.requiresFall && !step.fallTriggered) {
    let ratio = 1;
    if (step.horizontalDistance > 0) {
      ratio = Math.min(step.horizontalTraveled / step.horizontalDistance, 1);
    } else if (step.totalDistance > 0) {
      ratio = Math.min(step.traveled / step.totalDistance, 1);
    }
    const triggerProgress = step.fallTriggerProgress ?? DEFAULT_FALL_TRIGGER_PROGRESS;
    if (ratio >= triggerProgress) {
      const animationData = this._tokenAnimationData.get(state.token);
      const activated = this._maybeEnterFallPhase(state, animationData);
      if (activated) {
        step.fallTriggered = true;
        return false;
      }
      step.fallTriggered = true;
    }
  }
  if (completed && !state.stepFinalized) {
    this._lockStepAtTarget(state);
    if (state.phase === 'fall') {
      return true;
    }
    if (state.phase === 'walk' && state.intentHold && !state.pendingStop && !fallSingleUse) {
      const nextStep = this._createForwardMovementStep(state.token, state.mesh);
      if (nextStep) {
        state.activeStep = nextStep;
        state.stepFinalized = false;
        state.phase = 'walk';
        state.phaseElapsed = 0;
        this._applyPendingOrientation(state);
        return false;
      }
    }

    if (state.phase !== 'stop' && (!state.intentHold || state.pendingStop)) {
      this._triggerStop(state);
    }

    if (state.phase !== 'stop' && !state.pendingStop && !state.intentHold) {
      this._resetMovementState(state);
    }
  }
  if (completed && fallSingleUse && state.phase !== 'fall') {
    this._clearFallStepState(state, { force: true });
  }
  return completed;
}

// ── Install ──────────────────────────────────────────────────────────────

export function installMovementPhaseMethods(prototype) {
  prototype._updateForwardMovements = _updateForwardMovements;
  prototype._advanceStartPhase = _advanceStartPhase;
  prototype._advanceWalkPhase = _advanceWalkPhase;
  prototype._initiateStopPhase = _initiateStopPhase;
  prototype._advanceStopPhase = _advanceStopPhase;
  prototype._advanceMovementStep = _advanceMovementStep;
}
