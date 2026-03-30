import {
  DEFAULT_MOVEMENT_PROFILE,
  LANDING_VARIANTS_ALLOW_TILE_EXIT,
  FALL_LANDING_THRESHOLD_CONFIG,
  FALL_LOOP_MIN_DROP,
  SPRINT_THRESHOLD_SECONDS,
} from '../../../config/token-adapter/MannequinConfig.js';

// ── Fall Phase Advancement ──────────────────────────────────────

function _advanceFallPhase(state, delta) {
  if (!state) return;
  state.phaseElapsed += delta;
  const animationData = this._tokenAnimationData.get(state.token);
  const speed = Math.max(state.fallSpeed || 0, 0);
  const step = state.activeStep;
  const stepFinished = step ? step.traveled >= step.totalDistance - 1e-5 : true;

  if (!(speed > 0) && !(state.fallMode === 'landing' && stepFinished)) {
    this._finishFallPhase(state);
    return;
  }

  let completed = false;
  if (state.fallMode === 'landing') {
    if (stepFinished || !(speed > 0)) {
      completed = true;
    } else {
      completed = this._advanceMovementStep(state, speed * delta);
    }
  } else {
    completed = this._advanceMovementStep(state, speed * delta);
  }
  this._checkFallTransitions(state);
  const logLabel = state.fallMode === 'landing' ? 'landing-step' : 'fall-step';
  this._logFallHeightSample(state, logLabel, step, {
    delta,
    speed,
    stepFinished,
  });

  let shouldFinish = false;
  if (state.fallMode === 'landing') {
    const duration = state.fallDuration || 0;
    const animationComplete = this._isLandingAnimationComplete(state, animationData);
    if (duration > 0) {
      shouldFinish = (animationComplete && stepFinished) || state.phaseElapsed >= duration - 1e-4;
    } else {
      shouldFinish = animationComplete && stepFinished;
    }
  } else {
    shouldFinish = completed;
  }

  if (shouldFinish) {
    this._finishFallPhase(state);
  }
}

function _finishFallPhase(state) {
  if (!state || state.phase !== 'fall') return;
  const animationData = this._tokenAnimationData.get(state.token);
  const profile = animationData?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;
  this._logFallHeightSample(state, 'fall-complete', state.activeStep);
  state.__fallHeightLogTimestamp = 0;
  state.__fallHeightLogBuckets = null;

  const step = state.activeStep;
  let landingWorld = step?.targetWorld ? this._cloneWorld(step.targetWorld) : null;
  if (!landingWorld) {
    landingWorld = this._resolveTokenWorldPosition(state.token);
  }

  const landingVariantKey = state.fallLandingKey || step?.landingVariant || null;
  const landingVariantAllowsTileExit = !!(
    landingVariantKey && LANDING_VARIANTS_ALLOW_TILE_EXIT.has(landingVariantKey)
  );
  const retainLandingGrid = landingVariantAllowsTileExit && !!step;
  const rootTransfer = this._extractRootMotionOffset(state);
  let landingOffset = null;
  if (rootTransfer) {
    if (rootTransfer.offsetWorld) {
      landingOffset = this._sanitizeLandingRootOffset(
        step,
        rootTransfer.offsetWorld,
        state.fallLandingKey
      );
      if (!landingVariantAllowsTileExit && landingOffset && landingWorld) {
        landingOffset = this._clampLandingOffsetToTargetTile(
          step,
          landingWorld,
          landingOffset,
          landingVariantKey
        );
      }
      rootTransfer.offsetWorld = landingOffset || null;
    } else {
      rootTransfer.offsetWorld = null;
    }
  }

  let adjustedLandingWorld = landingWorld;
  if (landingWorld && landingOffset) {
    const offsetX = Number.isFinite(landingOffset.x) ? landingOffset.x : 0;
    const offsetY = Number.isFinite(landingOffset.y) ? landingOffset.y : 0;
    const offsetZ = Number.isFinite(landingOffset.z) ? landingOffset.z : 0;
    adjustedLandingWorld = {
      x: landingWorld.x + offsetX,
      y: landingWorld.y + offsetY,
      z: landingWorld.z + offsetZ,
    };
  }

  const transferTargetWorld = adjustedLandingWorld || landingWorld || null;
  this._transferRootMotionToWorld(state, transferTargetWorld, rootTransfer || undefined);

  const finalizedLandingWorld = transferTargetWorld || this._resolveTokenWorldPosition(state.token);
  if (step && finalizedLandingWorld) {
    step.targetWorld = finalizedLandingWorld;
    const meshForStep = step.mesh || state.mesh;
    if (meshForStep) {
      step.targetPosition = this._composeMeshPosition(finalizedLandingWorld, meshForStep);
    }
    if (!retainLandingGrid) {
      this._applyStepGridFromWorld(step, finalizedLandingWorld);
    }
  }

  if (!state.stepFinalized) {
    this._lockStepAtTarget(state);
  }

  if (finalizedLandingWorld) {
    if (retainLandingGrid) {
      const targetGridX = Number.isFinite(step?.gridTargetX) ? step.gridTargetX : null;
      const targetGridY = Number.isFinite(step?.gridTargetY) ? step.gridTargetY : null;
      if (targetGridX != null) state.token.gridX = targetGridX;
      if (targetGridY != null) state.token.gridY = targetGridY;
    } else {
      this._applyTokenGridFromWorld(state.token, finalizedLandingWorld);
    }
  }

  this._clearFallStepState(state, { force: true });

  const resumed = this._resumeMovementAfterFall(state);
  if (resumed) {
    return;
  }

  this._finalizePostFallState(state, profile);
}

function _finalizePostFallState(state, profileOverride = null) {
  if (!state) return;
  const profile = profileOverride || state.profile || DEFAULT_MOVEMENT_PROFILE;
  state.phase = 'idle';
  this._applyPendingOrientation(state);
  if (!this._shouldHoldMovementState(state)) {
    this._movementStates.delete(state.token);
  }
  this._resetSprintState(state);
  Object.assign(state, {
    intentHold: false,
    pendingStop: false,
    stopTriggered: false,
    fallDuration: 0,
    fallSpeed: 0,
    fallMode: null,
    fallLandingThreshold: 0,
    fallLandingKey: null,
    fallLandingDuration: 0,
  });

  this._setAnimation(state.token, 'idle', {
    fadeIn: profile.idleFadeIn,
    fadeOut: profile.fallFadeOut ?? profile.idleFadeOut,
    force: true,
  });

  this._unlockTokenWorldAuthority(state);
}

// ── Fall Transitions ───────────────────────────────────────────

function _checkFallTransitions(state) {
  if (!state || state.phase !== 'fall' || state.fallMode !== 'loop') return;
  const step = state.activeStep;
  if (!step) return;

  const targetY = step.targetWorld?.y ?? 0;
  const currentY = state.token?.world?.y;
  if (!Number.isFinite(currentY)) return;
  const remainingDrop = Math.max(currentY - targetY, 0);
  const threshold = state.fallLandingThreshold || 0;
  if (!(threshold > 0)) {
    return;
  }
  if (remainingDrop > threshold) {
    return;
  }

  this._transitionFallToLanding(state);
}

function _transitionFallToLanding(state) {
  if (!state || state.phase !== 'fall') return false;
  const data = this._tokenAnimationData.get(state.token);
  const actions = data?.actions;
  const profile = data?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;

  let landingKey = state.fallLandingKey;
  if (landingKey && !actions?.[landingKey]) {
    landingKey = null;
  }
  if (!landingKey) {
    landingKey = this._selectLandingAnimation(actions, 'fall');
  }
  if (!landingKey || !actions?.[landingKey]) {
    return false;
  }

  state.fallLandingKey = landingKey;
  if (!(state.fallLandingDuration > 0)) {
    state.fallLandingDuration = this._getLandingClipDuration(profile, landingKey);
  }

  state.fallMode = 'landing';
  state.phaseElapsed = 0;
  state.fallDuration =
    state.fallLandingDuration ||
    this._extractClipDuration(actions[landingKey]) ||
    this._getLandingClipDuration(profile, landingKey) ||
    0;
  state.fallSpeed = this._calculateFallSpeed(state.activeStep, state.fallDuration, profile);
  if (!(state.fallSpeed > 0)) {
    state.fallSpeed = Math.max(profile.walkSpeed || 0, 0);
  }

  const verticalDistance = Math.max(state.activeStep?.heightDrop || 0, 0);

  this._setAnimation(state.token, landingKey, {
    fadeIn: profile.fallFadeIn,
    fadeOut: profile.fallFadeOut,
    force: true,
  });
  this._logFallHeightSample(state, 'landing-transition', state.activeStep, {
    landingKey,
    verticalDistance,
  });
  return true;
}

// ── Animation Helpers ──────────────────────────────────────────

function _isLandingAnimationComplete(state, animationData) {
  if (!state) return true;
  const data = animationData || this._tokenAnimationData.get(state.token);
  const landingKey = state.fallLandingKey;
  if (!landingKey) return true;
  const action = data?.actions?.[landingKey];
  if (!action) return true;

  try {
    const clip = typeof action.getClip === 'function' ? action.getClip() : action._clip;
    const clipDuration = Number(clip?.duration);
    const currentTime = Number(action.time || 0);
    if (clipDuration > 0) {
      return currentTime >= clipDuration - 1e-3;
    }
  } catch (_) {
    /* ignore action inspection errors */
  }

  const fallbackDuration = state.fallDuration || 0;
  if (fallbackDuration > 0) {
    return state.phaseElapsed >= fallbackDuration - 1e-4;
  }
  return true;
}

// ── Speed & Duration ───────────────────────────────────────────

function _calculateFallSpeed(step, duration, profile) {
  if (!step) return 0;
  const distance = Math.max(step.totalDistance || 0, 0);
  if (!(distance > 0)) return 0;
  if (duration > 1e-3) {
    return distance / duration;
  }
  if (profile?.walkSpeed > 0) {
    return profile.walkSpeed;
  }
  return distance;
}

function _selectLandingAnimation(actions, preferredKey) {
  if (!actions) return null;
  if (preferredKey === 'fallToRoll' && actions.fallToRoll) return 'fallToRoll';
  if (preferredKey === 'hardLanding' && actions.hardLanding) return 'hardLanding';
  if (preferredKey === 'fall' && actions.fall) return 'fall';
  if (actions.fallToRoll) return 'fallToRoll';
  if (actions.hardLanding) return 'hardLanding';
  if (actions.fall) return 'fall';
  return null;
}

function _getLandingClipDuration(profile, landingKey) {
  const base = profile || DEFAULT_MOVEMENT_PROFILE;
  if (landingKey === 'hardLanding') {
    return base.hardLandingClipDuration || base.fallClipDuration || base.fallLoopClipDuration || 0;
  }
  if (landingKey === 'fallToRoll') {
    return (
      base.fallToRollClipDuration ||
      base.hardLandingClipDuration ||
      base.fallClipDuration ||
      base.fallLoopClipDuration ||
      0
    );
  }
  if (landingKey === 'fall') {
    return base.fallClipDuration || base.hardLandingClipDuration || base.fallLoopClipDuration || 0;
  }
  return base.fallClipDuration || base.hardLandingClipDuration || base.fallLoopClipDuration || 0;
}

// ── Fall Entry ─────────────────────────────────────────────────

function _computeLandingThreshold(distance, landingKey) {
  if (!(distance > 0)) return 0;
  const effectiveDistance = Math.max(distance, 0);
  const params = FALL_LANDING_THRESHOLD_CONFIG[landingKey] || FALL_LANDING_THRESHOLD_CONFIG.fall;
  const slope = Number.isFinite(params?.slope) ? params.slope : 0.05;
  const bias = Number.isFinite(params?.bias) ? params.bias : 0.24;
  const lowerBound = Number.isFinite(params?.lower) ? params.lower : 0.35;
  const upperBound = Number.isFinite(params?.upper) ? params.upper : 0.85;
  const base = Math.max(effectiveDistance * slope, 0.2);
  const threshold = base + bias;
  const clampMin = Math.min(lowerBound, effectiveDistance);
  const clampMax = Math.max(Math.min(upperBound, effectiveDistance), clampMin);
  return Math.max(Math.min(threshold, clampMax), clampMin);
}

function _maybeEnterFallPhase(state, animationData) {
  if (!state || !state.activeStep) return false;
  const step = state.activeStep;
  if (!step.requiresFall) return false;
  const data = animationData || this._tokenAnimationData.get(state.token);
  const actions = data?.actions;
  if (!actions?.fall && !actions?.fallLoop) return false;
  const profile = data?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;

  if (!state.__fallResumeContext) {
    state.__fallResumeContext = this._captureFallResumeContext(state);
  }

  step.fallTriggered = true;
  state.phase = 'fall';
  state.phaseElapsed = 0;
  state.pendingStop = false;
  state.stopTriggered = false;
  state.intentHold = false;
  state.hasLoopStarted = false;
  state.__fallStepActive = false;
  state.__fallHeightLogBuckets = Object.create(null);
  this._lockTokenWorldAuthority(state);
  if (!step.fallStartCaptured) {
    const travelRatio =
      step.totalDistance > 0 ? Math.min(step.traveled / step.totalDistance, 1) : 0;
    step.fallStartRatio = travelRatio;
    if (step.mesh?.position) {
      step.fallStartPosition = {
        x: step.mesh.position.x,
        y: step.mesh.position.y,
        z: step.mesh.position.z,
      };
    } else {
      step.fallStartPosition = this._lerp3(step.startPosition, step.targetPosition, travelRatio);
    }

    const worldRef =
      this._cloneWorld(step.tokenEntry?.world) ||
      this._lerp3(step.startWorld, step.targetWorld, travelRatio);
    step.fallStartWorld = worldRef;
    step.fallStartCaptured = true;
  }

  const verticalDistance = Math.max(step.heightDrop || 0, 0);
  const fallLoopMinDrop = Number.isFinite(profile?.fallLoopMinDrop)
    ? profile.fallLoopMinDrop
    : FALL_LOOP_MIN_DROP;
  const preferredLanding = step.landingVariant || 'fall';
  let landingKey = this._selectLandingAnimation(actions, preferredLanding);
  if (!landingKey) {
    landingKey = this._selectLandingAnimation(actions, 'fall');
  }

  state.fallLandingKey = landingKey;
  state.fallLandingDuration = this._getLandingClipDuration(profile, landingKey);
  const fallLoopEligible = actions?.fallLoop && verticalDistance >= fallLoopMinDrop;
  state.fallMode = fallLoopEligible ? 'loop' : 'landing';

  let animationKey = null;
  if (fallLoopEligible) {
    animationKey = 'fallLoop';
  } else if (landingKey) {
    animationKey = landingKey;
    state.fallMode = 'landing';
  }

  if (!animationKey && actions?.fall) {
    animationKey = 'fall';
    state.fallMode = 'landing';
    state.fallLandingKey = 'fall';
    state.fallLandingDuration = this._getLandingClipDuration(profile, 'fall');
  }

  if (!animationKey && actions?.hardLanding) {
    animationKey = 'hardLanding';
    state.fallMode = 'landing';
    state.fallLandingKey = 'hardLanding';
    state.fallLandingDuration = this._getLandingClipDuration(profile, 'hardLanding');
  }

  if (!animationKey && actions?.fallLoop) {
    animationKey = 'fallLoop';
    state.fallMode = 'loop';
  }

  if (!animationKey) {
    animationKey = landingKey || 'fall';
    state.fallMode = animationKey === 'fallLoop' ? 'loop' : 'landing';
  }

  landingKey = state.fallLandingKey;
  state.fallLandingThreshold = landingKey
    ? this._computeLandingThreshold(verticalDistance, landingKey)
    : 0;

  if (state.fallMode === 'loop') {
    const baseVerticalSpeed = Math.max(profile.fallLoopVerticalSpeed || 2.2, 0.25);
    const speedScale = 1 + Math.max(0, verticalDistance - 6) / 10;
    const verticalSpeed = Math.max(baseVerticalSpeed / speedScale, 0.35);
    const minDuration = Math.max(profile.fallLoopMinDuration || 0.7, 0.1);
    const desiredDuration = verticalDistance > 0 ? verticalDistance / verticalSpeed : minDuration;
    let duration = Math.max(desiredDuration, minDuration);
    const configuredMax = profile.fallLoopMaxDuration;
    if (configuredMax && configuredMax > 0) {
      const extraAllowance = Math.max(0, (verticalDistance - 4) / Math.max(verticalSpeed, 0.1));
      const dynamicMax = configuredMax + extraAllowance;
      duration = Math.min(duration, dynamicMax);
    }
    state.fallDuration = duration;
  } else {
    state.fallDuration = state.fallLandingDuration;
    if (!(state.fallDuration > 0) && animationKey && actions?.[animationKey]) {
      state.fallDuration =
        this._extractClipDuration(actions[animationKey]) ||
        this._getLandingClipDuration(profile, animationKey);
    }
  }

  state.fallSpeed = this._calculateFallSpeed(step, state.fallDuration, profile);
  if (!(state.fallSpeed > 0)) {
    state.fallSpeed = Math.max(profile.walkSpeed || 0, 0);
  }
  const priorSpeed = Math.max(
    Number(state.lastMoveSpeed) || 0,
    Number(state.activeSpeed) || 0,
    profile.walkSpeed || 0
  );
  if (priorSpeed > 0 && priorSpeed > state.fallSpeed) {
    state.fallSpeed = priorSpeed;
  }

  const fadeIn =
    animationKey === 'fallLoop'
      ? (profile.fallLoopFadeIn ?? profile.fallFadeIn)
      : profile.fallFadeIn;
  const fadeOut =
    animationKey === 'fallLoop'
      ? (profile.fallLoopFadeOut ?? profile.fallFadeOut)
      : profile.fallFadeOut;

  const fallLoopTimeScale = Math.max(profile.fallLoopTimeScale ?? 1, 0.1);
  const timeScale = animationKey === 'fallLoop' ? fallLoopTimeScale : 1;

  this._setAnimation(state.token, animationKey, {
    fadeIn,
    fadeOut,
    force: true,
    timeScale,
  });
  this._logFallHeightSample(state, 'fall-enter', step, {
    landingKey: state.fallLandingKey,
    verticalDistance,
  });
  return true;
}

// ── Fall State Management ──────────────────────────────────────

function _ensureFallStepActive(state) {
  if (!state || state.phase !== 'walk') return false;
  if (state.activeStep && !state.activeStep.__fallSingleUse) return false;
  if (state.__fallStepActive && state.activeStep?.__fallSingleUse) {
    return true;
  }
  const step = this._createForwardMovementStep(state.token, state.mesh);
  if (!step || !step.requiresFall) {
    return false;
  }
  step.__fallSingleUse = true;
  state.activeStep = step;
  state.stepFinalized = false;
  state.__fallStepActive = true;
  return true;
}

function _clearFallStepState(state, options = {}) {
  if (!state) return;
  const force = options.force === true;
  state.__fallStepActive = false;
  if (state.activeStep?.__fallSingleUse && (force || state.stepFinalized)) {
    state.activeStep = null;
  }
}

// ── Movement Resume ───────────────────────────────────────────

function _captureFallResumeContext(state) {
  if (!state) return null;
  const pathKeyHeld = state.pathKey ? state.forwardKeys?.has(state.pathKey) : false;
  return {
    movementSign: state.movementSign || state.lastMoveSign || 1,
    intentHold: !!state.intentHold,
    pathActive: !!state.pathActive,
    pathSpeedMode: state.pathSpeedMode || null,
    pathKeyActive: pathKeyHeld,
    runDuration: state.runDuration || 0,
    wasSprinting: !!state.isSprinting,
  };
}

function _resumeMovementAfterFall(state) {
  if (!state) return false;
  const resume = state.__fallResumeContext;
  state.__fallResumeContext = null;
  if (!resume) return false;

  const pathStillValid = resume.pathActive && state.pathActive && state.pathGoal;
  const shouldResume = resume.intentHold || pathStillValid;
  if (!shouldResume) {
    return false;
  }

  const movementSign = resume.movementSign || state.movementSign || 1;
  state.phase = 'walk';
  state.phaseElapsed = 0;
  state.intentHold = true;
  state.pendingStop = false;
  state.stopTriggered = false;
  state.stepFinalized = true;
  state.activeStep = null;
  state.movementSign = movementSign;
  state.lastMoveSign = movementSign;

  if (pathStillValid && resume.pathKeyActive && state.pathKey && state.forwardKeys) {
    state.forwardKeys.add(state.pathKey);
  }

  if (!state.pathSpeedMode && resume.pathSpeedMode) {
    state.pathSpeedMode = resume.pathSpeedMode;
  }

  this._applyPendingOrientation(state);
  this._syncMovementVariant(state, movementSign, { force: true });
  this._playLoopAnimation(state, { force: true });
  state.runDuration = resume.runDuration || state.runDuration || 0;
  if (resume.wasSprinting && this._isSprintEligible(state)) {
    state.isSprinting = true;
    state.runDuration = Math.max(state.runDuration, SPRINT_THRESHOLD_SECONDS);
  }
  state.hasLoopStarted = true;
  state.freeStartWorld = this._resolveTokenWorldPosition(state.token);
  state.freeLastWorld = this._cloneWorld(state.freeStartWorld);
  state.freeDistance = 0;

  return true;
}

// ── Module Installation ────────────────────────────────────────

function installFallMethods(prototype) {
  prototype._advanceFallPhase = _advanceFallPhase;
  prototype._finishFallPhase = _finishFallPhase;
  prototype._finalizePostFallState = _finalizePostFallState;
  prototype._checkFallTransitions = _checkFallTransitions;
  prototype._transitionFallToLanding = _transitionFallToLanding;
  prototype._isLandingAnimationComplete = _isLandingAnimationComplete;
  prototype._calculateFallSpeed = _calculateFallSpeed;
  prototype._selectLandingAnimation = _selectLandingAnimation;
  prototype._getLandingClipDuration = _getLandingClipDuration;
  prototype._computeLandingThreshold = _computeLandingThreshold;
  prototype._maybeEnterFallPhase = _maybeEnterFallPhase;
  prototype._ensureFallStepActive = _ensureFallStepActive;
  prototype._clearFallStepState = _clearFallStepState;
  prototype._captureFallResumeContext = _captureFallResumeContext;
  prototype._resumeMovementAfterFall = _resumeMovementAfterFall;
}

export { installFallMethods };
