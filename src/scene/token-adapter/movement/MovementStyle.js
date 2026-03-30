/**
 * MovementStyle.js
 *
 * Movement intent, style resolution, sprint management, and movement-phase
 * lifecycle methods extracted from Token3DAdapter.
 * Each function is written with `this` semantics so it can be installed on a
 * class prototype via `installMovementStyleMethods()`.
 */

import {
  DEFAULT_MOVEMENT_PROFILE,
  SPRINT_LEAN_RADIANS,
  SPRINT_THRESHOLD_SECONDS,
  SPRINT_SPEED_MULTIPLIER,
} from '../../../config/token-adapter/MannequinConfig.js';

// ── Movement Intent ──────────────────────────────────────────────────────

function _recalculateMovementIntent(state) {
  if (!state) return 0;
  const forwardActive = state.forwardKeys?.size > 0;
  const backwardActive = state.backwardKeys?.size > 0;
  if (forwardActive && backwardActive) return 0;
  if (forwardActive) return 1;
  if (backwardActive) return -1;
  return 0;
}

function _computeRotationIntent(state) {
  if (!state) return 0;
  const rightActive = state.rotationRightKeys?.size > 0;
  const leftActive = state.rotationLeftKeys?.size > 0;
  if (rightActive && leftActive) return 0;
  if (rightActive) return 1;
  if (leftActive) return -1;
  return 0;
}

// ── Movement Style Snapshot ──────────────────────────────────────────────

function _captureMovementStyleSnapshot(state) {
  if (!state) return null;
  return {
    loop: state.loopActionKey,
    start: state.startActionKey,
    stop: state.stopActionKey,
    speed: state.activeSpeed,
    style: state.movementStyle,
    running: state.isRunning,
    direction: state.activeDirectionSign,
  };
}

function _movementStyleSnapshotEquals(previous, state) {
  if (!previous || !state) return false;
  const epsilon = 1e-5;
  return (
    previous.loop === state.loopActionKey &&
    previous.start === state.startActionKey &&
    previous.stop === state.stopActionKey &&
    Math.abs((previous.speed || 0) - (state.activeSpeed || 0)) < epsilon &&
    previous.style === state.movementStyle &&
    previous.running === state.isRunning &&
    previous.direction === state.activeDirectionSign
  );
}

// ── Action Key Resolution ────────────────────────────────────────────────

function _resolveAvailableActionKey(tokenEntry, key, fallback) {
  const data = this._tokenAnimationData.get(tokenEntry);
  if (key && data?.actions?.[key]) return key;
  if (fallback && data?.actions?.[fallback]) return fallback;
  return null;
}

function _getActionDuration(tokenEntry, actionKey) {
  if (!actionKey) return 0;
  const data = this._tokenAnimationData.get(tokenEntry);
  if (!data?.actions?.[actionKey]) return 0;
  return this._extractClipDuration(data.actions[actionKey]) || 0;
}

// ── Loop Animation ───────────────────────────────────────────────────────

function _playLoopAnimation(state, options = {}) {
  if (!state) return;
  const key = state.loopActionKey || 'walk';
  const data = this._tokenAnimationData.get(state.token);
  if (!data?.actions?.[key]) {
    state.__pendingLoopKey = key;
    state.__pendingLoopOptions = { ...options };
    return;
  }
  state.__pendingLoopKey = null;
  state.__pendingLoopOptions = null;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  this._setAnimation(state.token, key, {
    fadeIn: options.fadeIn ?? profile.walkFadeIn,
    fadeOut: options.fadeOut ?? profile.walkFadeOut,
    force: options.force ?? false,
  });
}

function _setHasKey(set, key) {
  if (!set || !key) return false;
  try {
    return set.has(key);
  } catch (_) {
    return false;
  }
}

function _resumeMovementAnimations(tokenEntry) {
  const state = this._movementStates.get(tokenEntry);
  if (!state) return;
  if (state.__pendingLoopKey) {
    const pendingOptions = state.__pendingLoopOptions || {};
    this._playLoopAnimation(state, { ...pendingOptions, force: true });
    return;
  }
  if (state.phase === 'walk' && state.loopActionKey) {
    this._playLoopAnimation(state, { force: true });
  }
}

// ── Sprint Management ────────────────────────────────────────────────────

function _applySprintLean(state) {
  const mesh = state?.mesh;
  if (!mesh) return;
  const baseRotation = mesh.userData?.__ttBaseRotation;
  const baseX = Number.isFinite(baseRotation?.x) ? baseRotation.x : 0;
  const shouldLean =
    state?.isSprinting &&
    state?.movementStyle === 'standard' &&
    (state?.activeDirectionSign ?? 1) > 0;
  const targetX = shouldLean ? baseX + SPRINT_LEAN_RADIANS : baseX;
  if (Math.abs((mesh.rotation?.x ?? 0) - targetX) > 1e-4) {
    if (mesh.rotation) {
      mesh.rotation.x = targetX;
    }
  }
}

function _isSprintEligible(state) {
  if (!state?.token) return false;
  const typeKey = (state.token.type || state.token.creature?.type || '').toLowerCase();
  if (typeKey !== 'mannequin' && typeKey !== 'female-humanoid' && typeKey !== 'defeated-doll') {
    return false;
  }
  const data = this._tokenAnimationData.get(state.token);
  if (!data?.actions?.sprint) return false;
  return state.movementStyle === 'standard';
}

function _resetSprintState(state) {
  if (!state) return;
  state.runDuration = 0;
  state.isSprinting = false;
  if (state.mesh) {
    this._applySprintLean(state);
  }
}

function _updateRunningDuration(state, delta, directionSign) {
  if (!state) return;
  const sign = Number.isFinite(directionSign) ? directionSign : state.movementSign || 0;
  const runningForward = state.isRunning && sign > 0 && this._isSprintEligible(state);
  if (!runningForward) {
    if (state.runDuration !== 0 || state.isSprinting) {
      this._resetSprintState(state);
    }
    return;
  }
  if (delta > 0) {
    const ceiling = SPRINT_THRESHOLD_SECONDS * 4;
    state.runDuration = Math.min(state.runDuration + delta, ceiling);
  }
  if (!state.isSprinting && state.runDuration >= SPRINT_THRESHOLD_SECONDS) {
    state.isSprinting = true;
  }

  this._applySprintLean(state);
}

// ── Movement Flags & Style Resolution ────────────────────────────────────

function _updateMovementFlags(state, directionOverride) {
  if (!state) return;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  let sign = directionOverride;
  if (!sign) {
    sign = state.movementSign || state.lastMoveSign || 1;
  }
  sign = sign >= 0 ? 1 : -1;
  state.activeDirectionSign = sign;

  const forwardSet = state.forwardKeys || new Set();
  const backwardSet = state.backwardKeys || new Set();
  const drunkDrives = sign >= 0 ? forwardSet : backwardSet;
  const drunkKey = sign >= 0 ? 'KeyW' : 'KeyS';
  const styleIsDrunk = this._setHasKey(drunkDrives, drunkKey);

  state.movementStyle = styleIsDrunk ? 'drunk' : 'standard';

  const pathMode = state.pathActive ? state.pathSpeedMode : null;
  if (pathMode === 'walk') {
    state.isRunning = false;
    this._resetSprintState(state);
  } else if (pathMode === 'run' || pathMode === 'sprint') {
    state.isRunning = true;
    if (pathMode === 'sprint') {
      if (this._isSprintEligible(state)) {
        state.isSprinting = true;
        state.runDuration = Math.max(state.runDuration, SPRINT_THRESHOLD_SECONDS);
      } else {
        state.isSprinting = false;
        state.runDuration = 0;
      }
    } else {
      state.isSprinting = false;
      state.runDuration = 0;
    }
    this._applySprintLean(state);
  } else {
    state.isRunning = !!this._modifiers?.shift;
    if (!state.isRunning) {
      this._resetSprintState(state);
    }
  }

  let loopKey = null;
  let startKey = null;
  let stopKey = null;
  let loopFallback = 'walk';

  if (state.movementStyle === 'drunk') {
    loopKey = sign > 0 ? 'drunkRunForward' : 'drunkRunBackward';
    if (!state.isRunning) {
      loopKey = sign > 0 ? 'drunkWalk' : 'drunkWalkBackward';
    }
    startKey = null;
    stopKey = null;
    loopFallback = sign > 0 ? 'drunkWalk' : 'drunkWalkBackward';
  } else if (state.isRunning) {
    loopKey = sign > 0 ? 'run' : 'runBackward';
    startKey = null;
    stopKey = sign > 0 ? 'runStop' : null;
    loopFallback = sign > 0 ? 'walk' : 'walkBackward';
    if (sign > 0 && state.isSprinting) {
      loopKey = 'sprint';
      loopFallback = 'run';
    }
  } else {
    loopKey = sign > 0 ? 'walk' : 'walkBackward';
    startKey = null;
    stopKey = null;
    loopFallback = loopKey;
  }

  loopKey = this._resolveAvailableActionKey(state.token, loopKey, loopFallback) || loopFallback;
  if (loopKey !== 'sprint' && state.isSprinting) {
    state.isSprinting = false;
  }
  startKey = this._resolveAvailableActionKey(state.token, startKey, null);
  stopKey = this._resolveAvailableActionKey(state.token, stopKey, null);

  state.loopActionKey = loopKey;
  state.startActionKey = startKey;
  state.stopActionKey = stopKey;

  state.startDuration = this._getActionDuration(state.token, startKey);
  state.loopDuration = this._getActionDuration(state.token, loopKey);
  state.stopDuration = this._getActionDuration(state.token, stopKey);

  if (startKey) {
    state.startMoveDelay = Math.max(profile.startMoveDelay || 0, 0);
    state.startBlendLead = Math.max(
      Math.min(profile.startToWalkBlendLead || 0, state.startDuration || 0),
      0
    );
  } else {
    state.startMoveDelay = 0;
    state.startBlendLead = 0;
  }

  const stopPortion = Math.min(
    Math.max(profile.stopTravelPortion ?? DEFAULT_MOVEMENT_PROFILE.stopTravelPortion, 0),
    1
  );
  state.stopTravelPortionCurrent = stopPortion;

  if (stopKey) {
    state.stopMovementDuration = Math.max((state.stopDuration || 0) * stopPortion, 0);
    state.stopBlendLead = Math.max(
      Math.min(profile.stopBlendLead || 0, state.stopDuration || 0),
      0
    );
  } else {
    state.stopMovementDuration = 0;
    state.stopBlendLead = 0;
  }

  const walkSpeed = Math.max(profile.walkSpeed || DEFAULT_MOVEMENT_PROFILE.walkSpeed || 1, 0);
  const runSpeed = Math.max(profile.runSpeed || walkSpeed * 1.6, walkSpeed);
  const drunkWalkSpeed = Math.max(profile.drunkWalkSpeed || walkSpeed * 0.85, 0.1);
  const drunkRunSpeed = Math.max(profile.drunkRunSpeed || drunkWalkSpeed * 1.6, drunkWalkSpeed);

  if (state.isRunning) {
    state.activeSpeed = state.movementStyle === 'drunk' ? drunkRunSpeed : runSpeed;
  } else {
    state.activeSpeed = state.movementStyle === 'drunk' ? drunkWalkSpeed : walkSpeed;
  }

  if (
    state.isSprinting &&
    state.movementStyle === 'standard' &&
    state.activeDirectionSign > 0 &&
    state.activeSpeed > 0
  ) {
    state.activeSpeed *= SPRINT_SPEED_MULTIPLIER;
  }

  this._applySprintLean(state);
}

// ── Style Change Handling ────────────────────────────────────────────────

function _handleMovementStyleChange(state, previousSnapshot, options = {}) {
  if (!state) return;
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  const styleChanged = options.force || !this._movementStyleSnapshotEquals(previousSnapshot, state);
  if (!styleChanged) return;

  switch (state.phase) {
    case 'start': {
      if (!state.startActionKey) {
        state.phase = 'walk';
        state.phaseElapsed = 0;
        state.hasLoopStarted = true;
        this._playLoopAnimation(state, { force: true });
      } else if (
        !previousSnapshot ||
        previousSnapshot.start !== state.startActionKey ||
        options.force
      ) {
        this._setAnimation(state.token, state.startActionKey, {
          fadeIn: profile.startFadeIn,
          fadeOut: profile.startFadeOut,
          force: true,
        });
        state.phaseElapsed = 0;
        state.hasLoopStarted = false;
      }
      break;
    }
    case 'walk': {
      if (!previousSnapshot || previousSnapshot.loop !== state.loopActionKey || options.force) {
        this._playLoopAnimation(state, { force: true });
      }
      break;
    }
    case 'stop': {
      if (
        state.stopActionKey &&
        (!previousSnapshot || previousSnapshot.stop !== state.stopActionKey)
      ) {
        this._setAnimation(state.token, state.stopActionKey, {
          fadeIn: profile.stopFadeIn,
          fadeOut: profile.stopFadeOut,
          force: true,
        });
      }
      break;
    }
    default:
      break;
  }
}

function _syncMovementVariant(state, directionOverride, options = {}) {
  if (!state) return;
  const snapshot = this._captureMovementStyleSnapshot(state);
  this._updateMovementFlags(state, directionOverride);
  this._handleMovementStyleChange(state, snapshot, options);
}

// ── Movement Phase Lifecycle ─────────────────────────────────────────────

function _startMovementPhase(state, newSign) {
  if (!state || !newSign) return;
  const tokenEntry = state.token;
  const data = this._tokenAnimationData.get(tokenEntry);
  const profile = data?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;
  state.profile = profile;

  if (state.phase === 'stop') {
    this._abortStopPhase(state);
  }

  this._resetSprintState(state);

  state.movementSign = newSign;
  state.lastMoveSign = newSign;
  state.intentHold = true;
  state.pendingStop = false;
  state.stopTriggered = false;
  state.stepFinalized = false;
  state.activeStep = null;
  state.stopBlendedToIdle = false;
  state.phaseElapsed = 0;
  state.freeStartWorld = this._resolveTokenWorldPosition(tokenEntry);
  state.freeLastWorld = this._cloneWorld(state.freeStartWorld);
  state.freeDistance = 0;

  this._updateMovementFlags(state, newSign);

  const hasStartClip = !!state.startActionKey && (state.startDuration || 0) > 0.01;
  state.hasLoopStarted = !hasStartClip;
  state.phase = hasStartClip ? 'start' : 'walk';

  if (hasStartClip) {
    this._setAnimation(tokenEntry, state.startActionKey, {
      fadeIn: profile.startFadeIn,
      fadeOut: profile.startFadeOut,
      force: true,
    });
  } else {
    state.hasLoopStarted = true;
    this._playLoopAnimation(state, { force: true });
  }

  this._logPathing('movement:phase-start', {
    token: this._describeTokenForLogs(state.token),
    phase: state.phase,
    pathActive: state.pathActive,
    pathGoal: state.pathGoal ? { gridX: state.pathGoal.gridX, gridY: state.pathGoal.gridY } : null,
    movementSign: state.movementSign,
  });
}

function _abortStopPhase(state) {
  if (!state || state.phase !== 'stop') return;
  state.phase = 'walk';
  state.activeStep = null;
  state.stopTriggered = false;
  state.pendingStop = false;
  state.stepFinalized = false;
  state.stopBlendedToIdle = false;
}

// ── Install ──────────────────────────────────────────────────────────────

export function installMovementStyleMethods(prototype) {
  prototype._recalculateMovementIntent = _recalculateMovementIntent;
  prototype._computeRotationIntent = _computeRotationIntent;
  prototype._captureMovementStyleSnapshot = _captureMovementStyleSnapshot;
  prototype._movementStyleSnapshotEquals = _movementStyleSnapshotEquals;
  prototype._resolveAvailableActionKey = _resolveAvailableActionKey;
  prototype._getActionDuration = _getActionDuration;
  prototype._playLoopAnimation = _playLoopAnimation;
  prototype._setHasKey = _setHasKey;
  prototype._resumeMovementAnimations = _resumeMovementAnimations;
  prototype._applySprintLean = _applySprintLean;
  prototype._isSprintEligible = _isSprintEligible;
  prototype._resetSprintState = _resetSprintState;
  prototype._updateRunningDuration = _updateRunningDuration;
  prototype._updateMovementFlags = _updateMovementFlags;
  prototype._handleMovementStyleChange = _handleMovementStyleChange;
  prototype._syncMovementVariant = _syncMovementVariant;
  prototype._startMovementPhase = _startMovementPhase;
  prototype._abortStopPhase = _abortStopPhase;
}
