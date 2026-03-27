import {
  DEFAULT_MOVEMENT_PROFILE,
  PATH_NAVIGATION_KEY,
  DEFAULT_CLIMB_DURATION,
  DEFAULT_CLIMB_RECOVER_DURATION,
  MAX_STANDARD_CLIMB_LEVELS,
  HIGH_WALL_SEGMENT_LEVELS,
  DEFAULT_CLIMB_WALL_DURATION,
  CLIMB_WALL_BLEND_LEAD,
  CLIMB_WALL_PROGRESS_EXPONENT,
  CLIMB_WALL_PROGRESS_SCALE,
  CLIMB_RECOVER_DEFAULT_CROUCH_DROP,
  CLIMB_RECOVER_MIN_CROUCH_DROP,
  CLIMB_RECOVER_MAX_CROUCH_DROP,
  CLIMB_RECOVER_CROUCH_HOLD,
  CLIMB_RECOVER_STAND_RELEASE,
} from './MannequinConfig.js';

function _resetClimbWallState(state, options = {}) {
  if (!state) return;
  state.climbWallQueue = null;
  state.climbWallActive = false;
  state.climbWallElapsed = 0;
  state.climbWallDuration = 0;
  state.climbWallStartWorld = null;
  state.climbWallTargetWorld = null;
  state.climbWallBaseDuration = 0;
  state.climbWallAnimationPlaying = false;
  if (!options?.preservePrestart) {
    state.climbAnimationPrestarted = false;
    state.climbPrestartFootWorld = null;
  }
}

function _resetClimbRecoverState(state) {
  if (!state) return;
  state.climbRecoverActive = false;
  state.climbRecoverElapsed = 0;
  state.climbRecoverDuration = 0;
  state.climbRecoverStartWorld = null;
  state.climbRecoverAnchorPosition = null;
  state.climbRecoverCrouchWorld = null;
  state.climbRecoverCrouchDrop = 0;
  state.climbRecoverRiseHold = CLIMB_RECOVER_CROUCH_HOLD;
  state.climbRecoverStandRelease = CLIMB_RECOVER_STAND_RELEASE;
}

function _clearClimbState(state) {
  if (!state) return;
  this._setSelectionIndicatorSuppressed(state, false);
  state.climbQueued = null;
  state.climbPendingInfo = null;
  state.climbActive = false;
  state.climbElapsed = 0;
  state.climbDuration = 0;
  state.climbStartWorld = null;
  state.climbTargetWorld = null;
  state.climbFinalWorld = null;
  state.climbData = null;
  this._resetClimbWallState(state);
  this._resetClimbRecoverState(state);
  state.climbLastWorld = null;
  state.climbAdvanceActive = false;
  state.climbAdvanceTargetWorld = null;
}

function _resolveClimbLandingWorld(state) {
  if (!state) return null;
  const finalWorld = this._cloneWorld(this._resolveClimbFinalWorld(state));
  if (finalWorld) {
    return finalWorld;
  }
  return this._cloneWorldWithFallback(
    state.climbAdvanceTargetWorld,
    state.climbLastWorld,
    state.climbRecoverStartWorld,
    state.climbTargetWorld,
    state.climbStartWorld,
    this._resolveTokenWorldPosition(state.token)
  );
}

function _resolveClimbRecoverWorld(state) {
  if (!state) return null;
  return this._cloneWorldWithFallback(
    state.climbRecoverStartWorld,
    state.climbLastWorld,
    state.climbTargetWorld,
    state.climbStartWorld
  );
}

function _finalizeClimbLanding(state, options = {}) {
  if (!state) return true;
  const allowAdvance = options.allowAdvance !== false;
  const landingWorld =
    options.landingWorld !== undefined
      ? options.landingWorld
      : this._resolveClimbLandingWorld(state);
  const recoverWorld =
    options.recoverWorld !== undefined
      ? options.recoverWorld
      : this._resolveClimbRecoverWorld(state);

  const tokenDescriptor = this._describeTokenForLogs(state.token);
  this._logPathing('climb:finalize-begin', {
    token: tokenDescriptor,
    allowAdvance,
    hasLandingWorld: Boolean(landingWorld),
    hasRecoverWorld: Boolean(recoverWorld),
  });

  if (allowAdvance && this._shouldStartClimbAdvance(state, recoverWorld, landingWorld)) {
    const started = this._startClimbAdvancePhase(state, recoverWorld, landingWorld);
    if (started) {
      this._logPathing('climb:finalize-advance', {
        token: tokenDescriptor,
      });
      return true;
    }
  }

  this._logPathing('climb:finalize-reset', {
    token: tokenDescriptor,
  });
  this._resetClimbLandingState(state, { landingWorld });
  return true;
}

function _resetClimbLandingState(state, options = {}) {
  if (!state) return;
  const info = state.climbData || state.climbQueued || {};
  const landingWorld = options.landingWorld ?? this._resolveClimbLandingWorld(state);
  const tokenDescriptor = this._describeTokenForLogs(state.token);

  this._logPathing('climb:reset-landing', {
    token: tokenDescriptor,
    hasLandingWorld: Boolean(landingWorld),
    hadContinuationGoal: Boolean(state.climbContinuationGoal),
    hadCachedGoal: Boolean(state.lastRequestedGoal),
  });

  const tokenEntry = state.token;
  if (tokenEntry) {
    if (landingWorld) {
      this._transferRootMotionToWorld(state, landingWorld);
    } else {
      this._transferRootMotionToWorld(state);
    }

    const targetGridX = Number.isFinite(info?.targetGridX) ? Math.round(info.targetGridX) : null;
    const targetGridY = Number.isFinite(info?.targetGridY) ? Math.round(info.targetGridY) : null;

    if (targetGridX != null) tokenEntry.gridX = targetGridX;
    if (targetGridY != null) tokenEntry.gridY = targetGridY;

    if (landingWorld) {
      this._syncTokenAndMeshWorld(state, landingWorld, { token: tokenEntry });
    }
  }

  const continuationGoal = this._cloneClimbContinuationGoal(state.climbContinuationGoal);
  let resumeSource = null;

  state.climbContinuationGoal = null;
  state.intentHold = false;
  state.pendingStop = false;
  state.stopTriggered = false;
  state.stopBlendedToIdle = false;
  state.activeStep = null;
  state.stepFinalized = true;
  state.climbAdvanceActive = false;
  state.climbRecoverActive = false;
  state.phase = 'idle';

  this._clearClimbState(state);

  const hadSyntheticPath = Boolean(state.forwardKeys?.has(PATH_NAVIGATION_KEY));
  let resumed = false;

  if (continuationGoal) {
    resumed = this._reissueMaintainedGoal(state, continuationGoal, {
      allowSameTile: true,
    });
    if (resumed) {
      resumeSource = 'continuation-maintained';
    }

    if (!resumed && state?.token) {
      const directOptions = { ...(continuationGoal.options || {}) };
      const directResult = this.navigateToGrid(
        state.token,
        continuationGoal.gridX,
        continuationGoal.gridY,
        directOptions
      );
      resumed = !!directResult;
      if (resumed) {
        resumeSource = 'continuation-direct';
      }
    }
  }

  if (!resumed && state.lastRequestedGoal) {
    resumed = this._resumeCachedPostClimbGoal(state);
    if (resumed) {
      resumeSource = 'cached-maintained';
    }

    if (!resumed && state?.token) {
      const cachedOptions = { ...(state.lastRequestedGoal.options || {}) };
      const cachedResult = this.navigateToGrid(
        state.token,
        state.lastRequestedGoal.gridX,
        state.lastRequestedGoal.gridY,
        cachedOptions
      );
      resumed = !!cachedResult;
      if (resumed) {
        resumeSource = 'cached-direct';
      }
    }
  }

  if (!resumed && hadSyntheticPath && state.forwardKeys) {
    state.forwardKeys.delete(PATH_NAVIGATION_KEY);
    this._logPathing('climb:synthetic-path-cleared', {
      token: tokenDescriptor,
    });
  }

  if (resumed) {
    this._logPathing('climb:resume-success', {
      token: tokenDescriptor,
      resumeSource,
    });
    const probeGoal = continuationGoal || state.lastRequestedGoal || state.pathGoal || null;
    this._armResumeProbe(state, {
      goal: probeGoal,
      resumeSource,
    });
    return;
  }

  if (this._hasActiveIntents(state)) {
    return;
  }

  this._logPathing('climb:resume-failed', {
    token: tokenDescriptor,
  });
  this._clearResumeProbe(state);
  this._resetMovementState(state);
}

function _startClimbPhase(state, climbInfo, options = {}) {
  if (!state || !climbInfo) {
    this._resetMovementState(state);
    return;
  }

  const tokenDescriptor = this._describeTokenForLogs(state.token);
  this._logPathing('climb:phase-start', {
    token: tokenDescriptor,
    target: {
      gridX: climbInfo.targetGridX,
      gridY: climbInfo.targetGridY,
      heightDelta: climbInfo.heightDelta,
    },
    skipWallPlan: !!options?.skipWallPlan,
  });

  const animationData = this._tokenAnimationData.get(state.token);

  if (!options?.skipWallPlan) {
    const planned = this._maybeStartClimbWallSequence(state, climbInfo, animationData);
    if (planned) {
      return;
    }
  }

  const climbAction = animationData?.actions?.climb || null;
  const profile = animationData?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;
  let duration = this._extractClipDuration(climbAction) || profile?.climbClipDuration || 0;
  if (!(duration > 1e-4)) {
    duration = DEFAULT_CLIMB_DURATION;
  }

  const startWorld = this._cloneWorldWithFallback(climbInfo.footWorld, state.token?.world) || {};
  const targetEdge = this._cloneWorldWithFallback(climbInfo.edgeWorld, climbInfo.finalWorld) || {};
  const finalWorld = this._cloneWorldWithFallback(climbInfo.finalWorld, targetEdge) || {};

  state.phase = 'climb';
  state.climbActive = true;
  state.climbElapsed = 0;
  state.climbDuration = duration;
  state.climbStartWorld = startWorld;
  state.climbTargetWorld = targetEdge;
  state.climbFinalWorld = finalWorld;
  state.climbData = {
    targetGridX: climbInfo.targetGridX,
    targetGridY: climbInfo.targetGridY,
    targetHeight: climbInfo.targetHeight,
  };
  this._resetClimbRecoverState(state);
  state.climbLastWorld = this._cloneWorld(startWorld);
  state.intentHold = false;
  state.pendingStop = false;
  state.movementSign = 0;
  state.lastMoveSign = 0;
  state.phaseElapsed = 0;
  state.activeStep = null;
  state.stepFinalized = true;
  this._setSelectionIndicatorSuppressed(state, true);

  if (climbAction) {
    const fadeIn = profile?.climbFadeIn ?? profile.walkFadeIn ?? 0.18;
    const fadeOut = profile?.climbFadeOut ?? profile.walkFadeOut ?? 0.18;
    const shouldRestart = animationData?.current !== 'climb';
    if (shouldRestart) {
      this._setAnimation(state.token, 'climb', {
        fadeIn,
        fadeOut,
        force: true,
      });
    }
  } else {
    this._finalizeClimbLanding(state, { allowAdvance: false });
    state.climbAnimationPrestarted = false;
    state.climbPrestartFootWorld = null;
    return;
  }

  state.climbAnimationPrestarted = false;
  state.climbPrestartFootWorld = null;
}

function _maybeStartClimbWallSequence(state, climbInfo, animationData) {
  if (!state || !climbInfo) return false;
  const plan = this._planClimbWallSegments(state, climbInfo, animationData);
  if (!plan || !plan.segments?.length) {
    return false;
  }

  const queue = plan.segments.map((segment) => ({
    startWorld: this._cloneWorld(segment.startWorld),
    targetWorld: this._cloneWorld(segment.targetWorld),
    ratio: Number.isFinite(segment.ratio) ? segment.ratio : 1,
  }));

  if (!queue.length) {
    return false;
  }

  const clampedDelta = Math.min(
    MAX_STANDARD_CLIMB_LEVELS,
    Math.max(Number(climbInfo.heightDelta) || 0, 0)
  );
  const pendingInfo = this._cloneClimbWorldInfo(climbInfo) || {};
  pendingInfo.footWorld = this._cloneWorld(plan.finalStartWorld) || pendingInfo.footWorld;
  pendingInfo.heightDelta = clampedDelta;
  pendingInfo.extraWallLevels = 0;
  pendingInfo.wallWorldTravel = 0;

  state.climbPendingInfo = pendingInfo;
  this._resetClimbWallState(state, { preservePrestart: true });
  state.climbWallQueue = queue;
  state.climbWallBaseDuration = plan.baseDuration;

  this._setSelectionIndicatorSuppressed(state, true);

  this._logPathing('climbWall:plan', {
    token: this._describeTokenForLogs(state.token),
    segments: queue.length,
    baseDuration: state.climbWallBaseDuration,
    pendingHeightDelta: pendingInfo.heightDelta,
  });

  return this._startNextClimbWallSegment(state, animationData);
}

function _planClimbWallSegments(state, climbInfo, animationData) {
  if (!state || !climbInfo) return null;
  const totalHeight = Number.isFinite(climbInfo.heightDelta) ? climbInfo.heightDelta : 0;
  if (!(totalHeight > MAX_STANDARD_CLIMB_LEVELS)) return null;
  if (!animationData?.actions?.climbWall) return null;

  const footWorld =
    climbInfo.footWorld || state.climbLastWorld || this._resolveTokenWorldPosition(state.token);
  const edgeWorld = climbInfo.edgeWorld || climbInfo.finalWorld;
  if (!footWorld || !edgeWorld) return null;

  const elevationUnit =
    Number.isFinite(climbInfo.elevationUnit) && climbInfo.elevationUnit > 0
      ? climbInfo.elevationUnit
      : this.gameManager?.spatial?.elevationUnit || 0.5;
  const referenceHeight = Math.max(HIGH_WALL_SEGMENT_LEVELS * elevationUnit, 1e-4);
  const baseDuration =
    this._extractClipDuration(animationData.actions.climbWall) ||
    animationData?.profile?.climbWallClipDuration ||
    animationData?.profile?.climbClipDuration ||
    DEFAULT_CLIMB_WALL_DURATION;

  const availableWallHeight = Math.max((edgeWorld.y ?? 0) - (footWorld.y ?? 0), 0);
  const maxStandardWorldHeight = MAX_STANDARD_CLIMB_LEVELS * elevationUnit;
  const defaultWallTravel = Math.max(availableWallHeight - maxStandardWorldHeight, 0);
  const requestedWallTravel = Number.isFinite(climbInfo.wallWorldTravel)
    ? Math.max(climbInfo.wallWorldTravel, 0)
    : defaultWallTravel;
  const travelWorld = Math.min(Math.max(requestedWallTravel, 0), defaultWallTravel);
  if (!(travelWorld > 1e-4)) {
    return null;
  }

  const segments = [];
  let remaining = travelWorld;
  let cursor = this._cloneWorld(footWorld) || {};
  let guard = 0;

  while (remaining > 1e-4 && guard < 32) {
    const portion = Math.min(referenceHeight, remaining);
    const target = {
      x: cursor.x,
      z: cursor.z,
      y: cursor.y + portion,
    };
    const ratio = referenceHeight > 1e-4 ? portion / referenceHeight : 1;
    segments.push({
      startWorld: this._cloneWorld(cursor),
      targetWorld: target,
      ratio,
    });
    cursor = this._cloneWorld(target) || target;
    remaining -= portion;
    guard += 1;
  }

  if (!segments.length) {
    return null;
  }

  return {
    segments,
    finalStartWorld: cursor,
    baseDuration,
    referenceHeight,
  };
}

function _startNextClimbWallSegment(state, animationData) {
  if (!state) return false;
  if (!Array.isArray(state.climbWallQueue) || state.climbWallQueue.length === 0) {
    this._resumeStandardClimbAfterWall(state);
    return false;
  }

  const segment = state.climbWallQueue.shift();
  if (!segment?.startWorld || !segment?.targetWorld) {
    this._resumeStandardClimbAfterWall(state);
    return false;
  }

  const data = animationData || this._tokenAnimationData.get(state.token);
  const profile = data?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;
  const baseDuration =
    state.climbWallBaseDuration && state.climbWallBaseDuration > 1e-4
      ? state.climbWallBaseDuration
      : profile?.climbWallClipDuration || DEFAULT_CLIMB_WALL_DURATION;
  const ratio = Number.isFinite(segment.ratio) && segment.ratio > 1e-4 ? segment.ratio : 1;

  state.phase = 'climb-wall';
  state.climbWallActive = true;
  state.climbWallElapsed = 0;
  state.climbWallDuration = Math.max(baseDuration * ratio, 1e-4);
  state.climbWallStartWorld = this._cloneWorld(segment.startWorld);
  state.climbWallTargetWorld = this._cloneWorld(segment.targetWorld);
  state.climbLastWorld = this._cloneWorld(segment.startWorld);
  state.phaseElapsed = 0;
  this._setSelectionIndicatorSuppressed(state, true);

  const fadeIn = profile?.climbWallFadeIn ?? profile.walkFadeIn ?? 0.18;
  const fadeOut = profile?.climbWallFadeOut ?? profile.walkFadeOut ?? 0.18;
  if (!state.climbWallAnimationPlaying) {
    this._setAnimation(state.token, 'climbWall', { fadeIn, fadeOut, force: true });
    state.climbWallAnimationPlaying = true;
  }

  this._logPathing('climbWall:segment-start', {
    token: this._describeTokenForLogs(state.token),
    duration: state.climbWallDuration,
    startWorld: state.climbWallStartWorld,
    targetWorld: state.climbWallTargetWorld,
  });

  return true;
}

function _advanceClimbWallPhase(state, delta) {
  if (!state?.climbWallActive) {
    this._resumeStandardClimbAfterWall(state);
    return;
  }

  const duration = state.climbWallDuration || this._resolveClimbWallDuration(state);
  if (!(duration > 1e-4)) {
    state.climbWallActive = false;
    this._resumeStandardClimbAfterWall(state);
    return;
  }

  state.climbWallElapsed = Math.min(state.climbWallElapsed + Math.max(delta, 0), duration);
  const anchorWorld =
    state.climbWallStartWorld ||
    state.climbLastWorld ||
    this._resolveTokenWorldPosition(state.token);
  const targetWorld = state.climbWallTargetWorld || anchorWorld;

  let currentWorld = this._cloneWorld(anchorWorld);
  let appliedWithHelper = false;
  if (anchorWorld && targetWorld) {
    const progress = duration > 1e-4 ? state.climbWallElapsed / duration : 1;
    let easedProgress = progress;
    if (progress > 0 && progress < 1 - 1e-4) {
      easedProgress = Math.pow(progress, CLIMB_WALL_PROGRESS_EXPONENT);
      easedProgress = Math.min(easedProgress, progress * CLIMB_WALL_PROGRESS_SCALE);
    } else if (progress >= 1 - 1e-4) {
      easedProgress = 1;
    }
    currentWorld = this._lerp3(anchorWorld, targetWorld, easedProgress);
    this._syncTokenAndMeshWorld(state, currentWorld);
    appliedWithHelper = true;
    state.climbLastWorld = this._cloneWorld(currentWorld);
    if (state.climbAnimationPrestarted) {
      state.climbPrestartFootWorld = this._cloneWorld(currentWorld);
    }
  }

  if (!appliedWithHelper && currentWorld) {
    this._applyMeshWorldPosition(state.mesh, currentWorld);
  }

  this._maybePrestartClimbAnimation(state, duration);

  if (state.climbWallElapsed >= duration - 1e-4) {
    this._logPathing('climbWall:segment-complete', {
      token: this._describeTokenForLogs(state.token),
      remainingQueue: Array.isArray(state.climbWallQueue) ? state.climbWallQueue.length : 0,
    });
    state.climbWallActive = false;
    const animationData = this._tokenAnimationData.get(state.token);
    this._startNextClimbWallSegment(state, animationData);
  }
}

function _resumeStandardClimbAfterWall(state) {
  if (!state) return;
  const pending = this._cloneClimbWorldInfo(state.climbPendingInfo);

  this._logPathing('climbWall:resume-standard', {
    token: this._describeTokenForLogs(state.token),
    hasPending: Boolean(pending),
  });

  this._resetClimbWallState(state, { preservePrestart: true });

  if (pending) {
    if (state.climbPrestartFootWorld) {
      pending.footWorld = this._cloneWorld(state.climbPrestartFootWorld);
    } else if (state.climbLastWorld) {
      pending.footWorld = this._cloneWorld(state.climbLastWorld);
    }
    state.climbPendingInfo = null;
    this._commitClimbWallPose(state, pending.footWorld);
    state.climbPrestartFootWorld = null;
    this._startClimbPhase(state, pending, { skipWallPlan: true });
  } else if (!state.climbActive && !state.climbRecoverActive) {
    this._resetMovementState(state);
  }

  state.climbAnimationPrestarted = false;
  if (!pending) {
    state.climbPrestartFootWorld = null;
  }
}

function _commitClimbWallPose(state, anchorWorld) {
  if (!state) return;
  const target =
    anchorWorld ||
    state.climbLastWorld ||
    state.climbWallTargetWorld ||
    state.climbWallStartWorld ||
    this._resolveTokenWorldPosition(state.token);
  if (!target) return;

  this._transferRootMotionToWorld(state, target);
  this._syncTokenAndMeshWorld(state, target);
  state.climbLastWorld = this._cloneWorld(target);
}

function _maybePrestartClimbAnimation(state, duration) {
  if (!state || state.climbAnimationPrestarted) return;
  if (!state.climbPendingInfo) return;
  if (Array.isArray(state.climbWallQueue) && state.climbWallQueue.length) return;
  if (!(duration > 0)) return;

  const remaining = duration - (state.climbWallElapsed || 0);
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  const lead = profile?.climbWallTransitionLead ?? CLIMB_WALL_BLEND_LEAD;
  if (!(lead > 0) || remaining > lead) return;

  const animationData = this._tokenAnimationData.get(state.token);
  if (!animationData?.actions?.climb) return;

  const fadeIn = profile?.climbFadeIn ?? profile.walkFadeIn ?? 0.18;
  const fadeOut = profile?.climbWallFadeOut ?? profile.walkFadeOut ?? 0.18;
  state.climbAnimationPrestarted = true;
  state.climbPrestartFootWorld = this._cloneWorld(state.climbLastWorld);
  this._setAnimation(state.token, 'climb', {
    fadeIn,
    fadeOut,
    force: true,
  });
}

function _resolveClimbWallDuration(state) {
  if (!state) return DEFAULT_CLIMB_WALL_DURATION;
  if (state.climbWallBaseDuration && state.climbWallBaseDuration > 1e-4) {
    return state.climbWallBaseDuration;
  }
  const animationData = this._tokenAnimationData.get(state.token);
  const actionDuration = this._extractClipDuration(animationData?.actions?.climbWall) || 0;
  if (actionDuration > 1e-4) {
    return actionDuration;
  }
  const profileDuration = animationData?.profile?.climbWallClipDuration;
  if (profileDuration > 1e-4) {
    return profileDuration;
  }
  return DEFAULT_CLIMB_WALL_DURATION;
}

function _advanceClimbPhase(state, delta) {
  if (!state?.climbActive) {
    return;
  }

  const duration = state.climbDuration || DEFAULT_CLIMB_DURATION;
  if (!(duration > 1e-4)) {
    this._finalizeClimbLanding(state, { allowAdvance: false });
    return;
  }

  state.climbElapsed = Math.min(state.climbElapsed + Math.max(delta, 0), duration);
  const anchorWorld = state.climbStartWorld || this._resolveTokenWorldPosition(state.token);
  if (anchorWorld) {
    this._applyMeshWorldPosition(state.mesh, anchorWorld);
  }

  const targetWorld = state.climbTargetWorld || state.climbFinalWorld || anchorWorld;
  let appliedWorld = null;
  if (anchorWorld && targetWorld) {
    const progress = duration > 1e-4 ? state.climbElapsed / duration : 1;
    const currentWorld = this._lerp3(anchorWorld, targetWorld, progress);
    this._syncTokenAndMeshWorld(state, currentWorld, { mesh: null });
    appliedWorld = currentWorld;
  } else if (anchorWorld) {
    this._syncTokenAndMeshWorld(state, anchorWorld, { mesh: null });
    appliedWorld = anchorWorld;
  }

  if (appliedWorld) {
    state.climbLastWorld = this._cloneWorld(appliedWorld);
  }

  if (state.climbElapsed >= duration - 1e-4) {
    this._startClimbRecoverPhase(state);
  }
}

function _startClimbRecoverPhase(state) {
  if (!state) return;

  this._resetClimbRecoverState(state);

  const tokenDescriptor = this._describeTokenForLogs(state.token);

  const recoverStartWorld =
    state.climbLastWorld ||
    state.climbTargetWorld ||
    state.climbFinalWorld ||
    state.climbStartWorld ||
    this._resolveTokenWorldPosition(state.token);

  this._logPathing('climb:recover-start', {
    token: tokenDescriptor,
    recoverStartWorld,
  });

  const rootTransfer = this._transferRootMotionToWorld(state) || null;

  let adjustedWorld = this._cloneWorld(recoverStartWorld);
  if (!adjustedWorld) {
    adjustedWorld = this._resolveTokenWorldPosition(state.token);
  }
  if (adjustedWorld) {
    state.climbRecoverStartWorld = this._cloneWorld(adjustedWorld);
    this._syncTokenAndMeshWorld(state, adjustedWorld, { mesh: null });
  } else {
    state.climbRecoverStartWorld = null;
  }

  const crouchDrop = this._resolveClimbRecoverCrouchDrop(state, rootTransfer);
  state.climbRecoverCrouchDrop = crouchDrop;
  if (state.climbRecoverStartWorld && crouchDrop > 1e-4) {
    state.climbRecoverCrouchWorld = {
      x: state.climbRecoverStartWorld.x,
      y: state.climbRecoverStartWorld.y - crouchDrop,
      z: state.climbRecoverStartWorld.z,
    };
  } else if (state.climbRecoverStartWorld) {
    state.climbRecoverCrouchWorld = this._cloneWorld(state.climbRecoverStartWorld);
  } else {
    state.climbRecoverCrouchWorld = null;
  }

  const riseWindow = this._resolveClimbRecoverRiseWindow(state);
  state.climbRecoverRiseHold = riseWindow.hold;
  state.climbRecoverStandRelease = riseWindow.release;

  const meshAnchorWorld =
    state.climbRecoverCrouchWorld || state.climbRecoverStartWorld || recoverStartWorld;

  if (state.climbRecoverCrouchWorld) {
    this._syncTokenAndMeshWorld(state, state.climbRecoverCrouchWorld, { mesh: null });
  }

  if (meshAnchorWorld) {
    this._assignClimbRecoverAnchorPosition(state, meshAnchorWorld);
  } else {
    this._assignClimbRecoverAnchorPosition(state, null);
  }

  if (meshAnchorWorld) {
    state.climbLastWorld = this._cloneWorld(meshAnchorWorld);
  } else if (state.climbRecoverStartWorld) {
    state.climbLastWorld = this._cloneWorld(state.climbRecoverStartWorld);
  } else {
    state.climbLastWorld = null;
  }

  const animationData = this._tokenAnimationData.get(state.token);
  const recoverAction = animationData?.actions?.climbRecover || null;
  const profile = animationData?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;
  const duration =
    this._extractClipDuration(recoverAction) ||
    animationData?.clips?.climbRecover ||
    profile?.climbRecoverDuration ||
    DEFAULT_CLIMB_RECOVER_DURATION;

  state.climbActive = false;
  if (!recoverAction || !(duration > 1e-4)) {
    this._finalizeClimbLanding(state, {
      landingWorld: state.climbRecoverStartWorld || state.climbLastWorld,
      recoverWorld: state.climbRecoverStartWorld,
      allowAdvance: false,
    });
    return;
  }

  state.phase = 'climb-recover';
  state.climbRecoverActive = true;
  state.climbRecoverElapsed = 0;
  state.climbRecoverDuration = duration;
  state.phaseElapsed = 0;

  const fadeIn = profile?.climbRecoverFadeIn ?? profile.stopFadeIn ?? profile.walkFadeIn ?? 0.18;
  const fadeOut =
    profile?.climbRecoverFadeOut ?? profile.stopFadeOut ?? profile.walkFadeOut ?? 0.18;
  this._setAnimation(state.token, 'climbRecover', {
    fadeIn,
    fadeOut,
    force: true,
  });
}

function _advanceClimbRecoverPhase(state, delta) {
  const finalizeRecover = () => {
    if (!state) return;
    const landingWorld = this._resolveClimbLandingWorld(state);
    const recoverWorld = this._resolveClimbRecoverWorld(state);
    this._finalizeClimbLanding(state, { landingWorld, recoverWorld });
  };

  if (!state?.climbRecoverActive) {
    finalizeRecover();
    return;
  }

  const duration = state.climbRecoverDuration || DEFAULT_CLIMB_RECOVER_DURATION;
  if (!(duration > 1e-4)) {
    state.climbRecoverActive = false;
    finalizeRecover();
    return;
  }

  state.climbRecoverElapsed = Math.min(state.climbRecoverElapsed + Math.max(delta, 0), duration);
  const startWorld =
    state.climbRecoverStartWorld ||
    state.climbTargetWorld ||
    state.climbStartWorld ||
    this._resolveTokenWorldPosition(state.token);
  const crouchWorld = state.climbRecoverCrouchWorld || startWorld;
  const progress = duration > 1e-4 ? state.climbRecoverElapsed / duration : 1;
  const riseRatio = this._resolveClimbRecoverRiseRatio(state, progress);

  let currentWorld = null;
  if (startWorld && crouchWorld) {
    currentWorld = this._lerp3(crouchWorld, startWorld, riseRatio);
  } else {
    currentWorld = startWorld || crouchWorld || null;
  }

  if (currentWorld) {
    const composed = this._syncTokenAndMeshWorld(state, currentWorld);
    if (composed) {
      state.climbRecoverAnchorPosition = { x: composed.x, y: composed.y, z: composed.z };
    }
    state.climbLastWorld = this._cloneWorld(currentWorld);
  }

  if (state.climbRecoverElapsed >= duration - 1e-4) {
    state.climbRecoverActive = false;
    finalizeRecover();
  }
}

function _resolveClimbRecoverCrouchDrop(state, rootTransfer) {
  const profile = state?.profile || DEFAULT_MOVEMENT_PROFILE;
  const minDrop = Math.max(profile?.climbRecoverCrouchMinDrop ?? CLIMB_RECOVER_MIN_CROUCH_DROP, 0);
  const maxDrop = Math.max(
    profile?.climbRecoverCrouchMaxDrop ?? CLIMB_RECOVER_MAX_CROUCH_DROP,
    minDrop
  );
  const configuredDrop = profile?.climbRecoverCrouchDrop;
  if (Number.isFinite(configuredDrop)) {
    return Math.min(Math.max(configuredDrop, minDrop), maxDrop);
  }
  if (Number.isFinite(rootTransfer?.offsetWorld?.y) && rootTransfer.offsetWorld.y < -1e-4) {
    const measured = Math.abs(rootTransfer.offsetWorld.y);
    return Math.min(Math.max(measured, minDrop), maxDrop);
  }
  return Math.min(Math.max(CLIMB_RECOVER_DEFAULT_CROUCH_DROP, minDrop), maxDrop);
}

function _resolveClimbRecoverRiseWindow(state) {
  const profile = state?.profile || DEFAULT_MOVEMENT_PROFILE;
  const holdRaw = profile?.climbRecoverCrouchHold;
  const releaseRaw = profile?.climbRecoverStandRelease;
  const hold = Number.isFinite(holdRaw)
    ? Math.min(Math.max(holdRaw, 0), 0.6)
    : CLIMB_RECOVER_CROUCH_HOLD;
  const releaseDefault = Math.max(CLIMB_RECOVER_STAND_RELEASE, hold + 0.1);
  let release = Number.isFinite(releaseRaw)
    ? Math.min(Math.max(releaseRaw, hold + 0.05), 0.95)
    : releaseDefault;
  release = Math.max(release, hold + 0.05);
  return { hold, release };
}

function _resolveClimbRecoverRiseRatio(state, progress) {
  const hold = Number.isFinite(state?.climbRecoverRiseHold)
    ? state.climbRecoverRiseHold
    : CLIMB_RECOVER_CROUCH_HOLD;
  const release = Number.isFinite(state?.climbRecoverStandRelease)
    ? state.climbRecoverStandRelease
    : CLIMB_RECOVER_STAND_RELEASE;
  if (!(release > hold + 1e-4)) {
    return progress >= release ? 1 : 0;
  }
  if (progress <= hold + 1e-4) {
    return 0;
  }
  if (progress >= release - 1e-4) {
    return 1;
  }
  const span = Math.max(release - hold, 1e-4);
  const local = Math.min(Math.max((progress - hold) / span, 0), 1);
  return local * local * (3 - 2 * local);
}

function _advanceClimbAdvancePhase(state, delta) {
  const finalizeAdvance = () => {
    if (!state) return;
    this._finalizeClimbLanding(state, { allowAdvance: false });
  };

  if (!state?.climbAdvanceActive || !state.activeStep) {
    finalizeAdvance();
    return;
  }

  state.phaseElapsed += Math.max(delta, 0);
  const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
  const speed = Math.max(
    state.activeSpeed ?? profile.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed ?? 0,
    0
  );
  const slice = Math.max(delta, 0) * speed;
  const completed = slice > 0 ? this._advanceMovementStep(state, slice, { clamp: true }) : false;
  state.climbLastWorld = this._resolveTokenWorldPosition(state.token);

  if (completed || state.stepFinalized) {
    this._logPathing('climb:advance-complete', {
      token: this._describeTokenForLogs(state.token),
      step: state.activeStep
        ? {
            gridTargetX: state.activeStep.gridTargetX,
            gridTargetY: state.activeStep.gridTargetY,
          }
        : null,
    });
    finalizeAdvance();
  }
}

function _startClimbAdvancePhase(state, startWorld, finalWorld) {
  if (!state || !startWorld || !finalWorld) return false;
  const step = this._createClimbAdvanceStep(state, startWorld, finalWorld);
  if (!step) return false;

  state.phase = 'climb-advance';
  state.climbAdvanceActive = true;
  state.activeStep = step;
  state.stepFinalized = false;
  state.phaseElapsed = 0;
  state.climbAdvanceTargetWorld = this._cloneWorld(finalWorld);

  state.movementSign = 1;
  state.lastMoveSign = 1;
  state.intentHold = false;
  state.pendingStop = false;

  this._orientTokenTowardsWorld(state.token, finalWorld);
  this._playLoopAnimation(state, { force: true });

  this._logPathing('climb:advance-start', {
    token: this._describeTokenForLogs(state.token),
    startWorld,
    finalWorld,
  });
  return true;
}

function _createClimbAdvanceStep(state, startWorld, finalWorld) {
  if (!state || !startWorld || !finalWorld) return null;
  const tokenEntry = state.token;
  const mesh = state.mesh || tokenEntry?.__threeMesh;
  if (!tokenEntry || !mesh) return null;

  const startPosition = this._composeMeshPosition(startWorld, mesh);
  const targetPosition = this._composeMeshPosition(finalWorld, mesh);
  const dx = targetPosition.x - startPosition.x;
  const dy = targetPosition.y - startPosition.y;
  const dz = targetPosition.z - startPosition.z;
  const totalDistance = Math.hypot(dx, dy, dz);
  if (!(totalDistance > 1e-4)) return null;
  const horizontalDistance = Math.hypot(dx, dz);

  const gridStartX = Number.isFinite(tokenEntry.gridX) ? Number(tokenEntry.gridX) : 0;
  const gridStartY = Number.isFinite(tokenEntry.gridY) ? Number(tokenEntry.gridY) : 0;
  const gridTargetX = Number.isFinite(state.climbData?.targetGridX)
    ? state.climbData.targetGridX
    : gridStartX;
  const gridTargetY = Number.isFinite(state.climbData?.targetGridY)
    ? state.climbData.targetGridY
    : gridStartY;

  return {
    tokenEntry,
    mesh,
    startWorld: this._cloneWorld(startWorld) || startWorld,
    targetWorld: this._cloneWorld(finalWorld) || finalWorld,
    startPosition,
    targetPosition,
    totalDistance,
    traveled: 0,
    gridStartX,
    gridStartY,
    gridTargetX,
    gridTargetY,
    startHeight: startWorld.y ?? 0,
    targetHeight: finalWorld.y ?? startWorld.y ?? 0,
    heightDrop: (startWorld.y ?? 0) - (finalWorld.y ?? startWorld.y ?? 0),
    requiresFall: false,
    fallTriggerProgress: 1,
    fallTriggered: false,
    horizontalDistance,
    horizontalTraveled: 0,
    verticalSnapProgress: 1,
    landingVariant: null,
  };
}

function _shouldStartClimbAdvance(state, startWorld, finalWorld) {
  if (!state || state.climbAdvanceActive) return false;
  if (!(state.climbRecoverDuration > 1e-4)) return false;
  if (!startWorld || !finalWorld) return false;
  const dx = (finalWorld.x || 0) - (startWorld.x || 0);
  const dz = (finalWorld.z || 0) - (startWorld.z || 0);
  return dx * dx + dz * dz > 1e-4;
}

function _resolveClimbFinalWorld(state) {
  if (!state) return null;
  return (
    state.climbFinalWorld ||
    state.climbAdvanceTargetWorld ||
    state.climbLastWorld ||
    state.climbRecoverStartWorld ||
    state.climbTargetWorld ||
    state.climbStartWorld ||
    null
  );
}

function installClimbMethods(prototype) {
  prototype._resetClimbWallState = _resetClimbWallState;
  prototype._resetClimbRecoverState = _resetClimbRecoverState;
  prototype._clearClimbState = _clearClimbState;
  prototype._resolveClimbLandingWorld = _resolveClimbLandingWorld;
  prototype._resolveClimbRecoverWorld = _resolveClimbRecoverWorld;
  prototype._finalizeClimbLanding = _finalizeClimbLanding;
  prototype._resetClimbLandingState = _resetClimbLandingState;
  prototype._startClimbPhase = _startClimbPhase;
  prototype._maybeStartClimbWallSequence = _maybeStartClimbWallSequence;
  prototype._planClimbWallSegments = _planClimbWallSegments;
  prototype._startNextClimbWallSegment = _startNextClimbWallSegment;
  prototype._advanceClimbWallPhase = _advanceClimbWallPhase;
  prototype._resumeStandardClimbAfterWall = _resumeStandardClimbAfterWall;
  prototype._commitClimbWallPose = _commitClimbWallPose;
  prototype._maybePrestartClimbAnimation = _maybePrestartClimbAnimation;
  prototype._resolveClimbWallDuration = _resolveClimbWallDuration;
  prototype._advanceClimbPhase = _advanceClimbPhase;
  prototype._startClimbRecoverPhase = _startClimbRecoverPhase;
  prototype._advanceClimbRecoverPhase = _advanceClimbRecoverPhase;
  prototype._resolveClimbRecoverCrouchDrop = _resolveClimbRecoverCrouchDrop;
  prototype._resolveClimbRecoverRiseWindow = _resolveClimbRecoverRiseWindow;
  prototype._resolveClimbRecoverRiseRatio = _resolveClimbRecoverRiseRatio;
  prototype._advanceClimbAdvancePhase = _advanceClimbAdvancePhase;
  prototype._startClimbAdvancePhase = _startClimbAdvancePhase;
  prototype._createClimbAdvanceStep = _createClimbAdvanceStep;
  prototype._shouldStartClimbAdvance = _shouldStartClimbAdvance;
  prototype._resolveClimbFinalWorld = _resolveClimbFinalWorld;
}

export { installClimbMethods };
