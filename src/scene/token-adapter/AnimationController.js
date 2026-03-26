/**
 * AnimationController.js
 *
 * Animation methods extracted from Token3DAdapter.  Each function is written
 * with `this` semantics so it can be installed on a class prototype via
 * `installAnimationMethods()`.
 *
 * Responsibilities:
 *   - Loading, caching, and retargeting animation clips
 *   - Building per-token movement profiles from clip metadata
 *   - Driving the AnimationMixer (play / fade / stop)
 *   - Manual (user-triggered) animation state, revert timers, and height offsets
 */

import { DEFAULT_MOVEMENT_PROFILE } from './MannequinConfig.js';

/* ------------------------------------------------------------------ */
/*  Animation setup & clip resolution                                  */
/* ------------------------------------------------------------------ */

async function _setupAnimationSet(tokenEntry, container, config, templateBundle) {
  try {
    const three = await this._getThree();
    if (!three) return;
    const mixer = new three.AnimationMixer(container);
    const animationsConfig = config.animations || {};
    const actions = {};
    const clips = {};

    const loadOptionalAnimation = async (key, options = {}) => {
      if (!key || actions[key]) return;
      const descriptor = animationsConfig[key];
      if (!descriptor) return;
      const clip = await this._resolveAnimationClip(descriptor, null, clipOptions);
      if (!clip) return;
      const action = mixer.clipAction(clip);
      const loopMode = options.loop || 'repeat';
      this._configureAction(action, descriptor, three, { loop: loopMode });
      if (options.clamp === true) {
        action.clampWhenFinished = true;
      }
      actions[key] = action;
      clips[key] = clip.duration || 0;
    };

    const targetCacheKey = (
      tokenEntry.type ||
      tokenEntry.creature?.type ||
      tokenEntry.id ||
      'default'
    )
      .toString()
      .toLowerCase();
    const clipOptions = { targetRoot: container, targetCacheKey };
    const templateFallbackClip = this._selectPrimaryClip(templateBundle?.animations);

    const idleClip = await this._resolveAnimationClip(
      animationsConfig.idle,
      templateFallbackClip,
      clipOptions
    );
    if (idleClip) {
      const action = mixer.clipAction(idleClip);
      this._configureAction(action, animationsConfig.idle, three, { loop: 'repeat' });
      actions.idle = action;
      clips.idle = idleClip.duration || 0;
    }

    const walkClip = await this._resolveAnimationClip(animationsConfig.walk, null, clipOptions);
    if (walkClip) {
      const action = mixer.clipAction(walkClip);
      this._configureAction(action, animationsConfig.walk, three, { loop: 'repeat' });
      actions.walk = action;
      clips.walk = walkClip.duration || 0;
    }

    const walkBackwardClip = await this._resolveAnimationClip(
      animationsConfig.walkBackward,
      null,
      clipOptions
    );
    if (walkBackwardClip) {
      const action = mixer.clipAction(walkBackwardClip);
      this._configureAction(action, animationsConfig.walkBackward, three, { loop: 'repeat' });
      actions.walkBackward = action;
      clips.walkBackward = walkBackwardClip.duration || 0;
    }

    const runClip = await this._resolveAnimationClip(animationsConfig.run, null, clipOptions);
    if (runClip) {
      const action = mixer.clipAction(runClip);
      this._configureAction(action, animationsConfig.run, three, { loop: 'repeat' });
      actions.run = action;
      clips.run = runClip.duration || 0;
    }

    const runBackwardClip = await this._resolveAnimationClip(
      animationsConfig.runBackward,
      null,
      clipOptions
    );
    if (runBackwardClip) {
      const action = mixer.clipAction(runBackwardClip);
      this._configureAction(action, animationsConfig.runBackward, three, { loop: 'repeat' });
      actions.runBackward = action;
      clips.runBackward = runBackwardClip.duration || 0;
    }

    const sprintClip = await this._resolveAnimationClip(animationsConfig.sprint, null, clipOptions);
    if (sprintClip) {
      const action = mixer.clipAction(sprintClip);
      this._configureAction(action, animationsConfig.sprint, three, { loop: 'repeat' });
      actions.sprint = action;
      clips.sprint = sprintClip.duration || 0;
    }

    const runStopClip = await this._resolveAnimationClip(
      animationsConfig.runStop,
      null,
      clipOptions
    );
    if (runStopClip) {
      const action = mixer.clipAction(runStopClip);
      this._configureAction(action, animationsConfig.runStop, three, { loop: 'once' });
      actions.runStop = action;
      clips.runStop = runStopClip.duration || 0;
    }

    const drunkWalkClip = await this._resolveAnimationClip(
      animationsConfig.drunkWalk,
      null,
      clipOptions
    );
    if (drunkWalkClip) {
      const action = mixer.clipAction(drunkWalkClip);
      this._configureAction(action, animationsConfig.drunkWalk, three, { loop: 'repeat' });
      actions.drunkWalk = action;
      clips.drunkWalk = drunkWalkClip.duration || 0;
    }

    const drunkWalkBackwardClip = await this._resolveAnimationClip(
      animationsConfig.drunkWalkBackward,
      null,
      clipOptions
    );
    if (drunkWalkBackwardClip) {
      const action = mixer.clipAction(drunkWalkBackwardClip);
      this._configureAction(action, animationsConfig.drunkWalkBackward, three, {
        loop: 'repeat',
      });
      actions.drunkWalkBackward = action;
      clips.drunkWalkBackward = drunkWalkBackwardClip.duration || 0;
    }

    const drunkRunForwardClip = await this._resolveAnimationClip(
      animationsConfig.drunkRunForward,
      null,
      clipOptions
    );
    if (drunkRunForwardClip) {
      const action = mixer.clipAction(drunkRunForwardClip);
      this._configureAction(action, animationsConfig.drunkRunForward, three, { loop: 'repeat' });
      actions.drunkRunForward = action;
      clips.drunkRunForward = drunkRunForwardClip.duration || 0;
    }

    const drunkRunBackwardClip = await this._resolveAnimationClip(
      animationsConfig.drunkRunBackward,
      null,
      clipOptions
    );
    if (drunkRunBackwardClip) {
      const action = mixer.clipAction(drunkRunBackwardClip);
      this._configureAction(action, animationsConfig.drunkRunBackward, three, {
        loop: 'repeat',
      });
      actions.drunkRunBackward = action;
      clips.drunkRunBackward = drunkRunBackwardClip.duration || 0;
    }

    const fallClip = await this._resolveAnimationClip(animationsConfig.fall, null, clipOptions);
    if (fallClip) {
      const action = mixer.clipAction(fallClip);
      this._configureAction(action, animationsConfig.fall, three, { loop: 'once' });
      actions.fall = action;
      clips.fall = fallClip.duration || 0;
    }

    const climbClip = await this._resolveAnimationClip(animationsConfig.climb, null, clipOptions);
    if (climbClip) {
      const action = mixer.clipAction(climbClip);
      this._configureAction(action, animationsConfig.climb, three, { loop: 'once' });
      action.clampWhenFinished = true;
      actions.climb = action;
      clips.climb = climbClip.duration || 0;
    }

    const climbWallClip = await this._resolveAnimationClip(
      animationsConfig.climbWall,
      null,
      clipOptions
    );
    if (climbWallClip) {
      const action = mixer.clipAction(climbWallClip);
      this._configureAction(action, animationsConfig.climbWall, three, { loop: 'repeat' });
      actions.climbWall = action;
      clips.climbWall = climbWallClip.duration || 0;
    }

    const climbRecoverClip = await this._resolveAnimationClip(
      animationsConfig.climbRecover,
      null,
      clipOptions
    );
    if (climbRecoverClip) {
      const action = mixer.clipAction(climbRecoverClip);
      this._configureAction(action, animationsConfig.climbRecover, three, { loop: 'once' });
      action.clampWhenFinished = true;
      actions.climbRecover = action;
      clips.climbRecover = climbRecoverClip.duration || 0;
    }
    const hardLandingClip = await this._resolveAnimationClip(
      animationsConfig.hardLanding,
      null,
      clipOptions
    );
    if (hardLandingClip) {
      const action = mixer.clipAction(hardLandingClip);
      this._configureAction(action, animationsConfig.hardLanding, three, { loop: 'once' });
      actions.hardLanding = action;
      clips.hardLanding = hardLandingClip.duration || 0;
    }

    const fallToRollClip = await this._resolveAnimationClip(
      animationsConfig.fallToRoll,
      null,
      clipOptions
    );
    if (fallToRollClip) {
      const action = mixer.clipAction(fallToRollClip);
      this._configureAction(action, animationsConfig.fallToRoll, three, { loop: 'once' });
      actions.fallToRoll = action;
      clips.fallToRoll = fallToRollClip.duration || 0;
    }

    const fallLoopClip = await this._resolveAnimationClip(
      animationsConfig.fallLoop,
      null,
      clipOptions
    );
    if (fallLoopClip) {
      const action = mixer.clipAction(fallLoopClip);
      this._configureAction(action, animationsConfig.fallLoop, three, { loop: 'repeat' });
      actions.fallLoop = action;
      clips.fallLoop = fallLoopClip.duration || 0;
    }

    const idleVariantKeys = ['idleVariant2', 'idleVariant3', 'idleVariant4', 'idleVariant5'];
    for (const variantKey of idleVariantKeys) {
      await loadOptionalAnimation(variantKey, { loop: 'repeat' });
    }

    await loadOptionalAnimation('jump', { loop: 'repeat' });
    await loadOptionalAnimation('fancyPose', { loop: 'once', clamp: true });
    await loadOptionalAnimation('dynamicPose', { loop: 'once', clamp: true });
    await loadOptionalAnimation('defeated', { loop: 'once', clamp: true });

    this._animationMixers.set(tokenEntry, mixer);

    const profile = this._buildMovementProfile(config.movementProfile, actions, clips);
    const animationData = {
      mixer,
      actions,
      clips,
      profile,
      current: null,
    };
    this._tokenAnimationData.set(tokenEntry, animationData);

    if (actions.idle) {
      this._setAnimation(tokenEntry, 'idle', { immediate: true });
    }

    this._resumeMovementAnimations(tokenEntry);
  } catch (_) {
    /* ignore animation setup errors */
  }
}

async function _resolveAnimationClip(descriptor, fallbackClip, options = {}) {
  if (!descriptor) {
    return this._cloneClip(fallbackClip);
  }

  const mergedOptions =
    descriptor && typeof descriptor === 'object'
      ? { ...options, preserveRootMotion: descriptor.preserveRootMotion === true }
      : options;

  if (typeof descriptor === 'string') {
    const clip = await this._loadAnimationClip(descriptor, mergedOptions);
    return clip || this._cloneClip(fallbackClip);
  }

  if (descriptor?.path) {
    const clip = await this._loadAnimationClip(descriptor.path, mergedOptions);
    return clip || this._cloneClip(fallbackClip);
  }

  return this._cloneClip(fallbackClip);
}

/* ------------------------------------------------------------------ */
/*  Clip loading & caching                                             */
/* ------------------------------------------------------------------ */

async function _loadAnimationClip(path, options = {}) {
  if (!path) return null;
  const cacheKey = this._buildAnimationCacheKey(path, options.targetCacheKey);
  if (this._animationClipCache.has(cacheKey)) {
    const cached = this._animationClipCache.get(cacheKey);
    return cached ? cached.clone() : null;
  }

  try {
    const three = await this._getThree();
    const FBXLoaderCtor = await this._getFBXLoaderCtor();
    if (!three || !FBXLoaderCtor) {
      this._animationClipCache.set(cacheKey, null);
      return null;
    }
    const variants = this._buildPathVariants(path);
    let clip = null;
    let sourceRoot = null;
    for (const url of variants) {
      try {
        const loader = new FBXLoaderCtor();
        const object = await this._loadFBX(loader, url);
        if (object?.animations?.length) {
          clip = this._selectPrimaryClip(object.animations);
          sourceRoot = object;
          break;
        }
      } catch (_) {
        /* try next */
      }
    }
    if (clip && options.targetRoot) {
      clip = await this._retargetAnimationClip(clip, sourceRoot, options.targetRoot, options);
    }
    if (clip) {
      this._animationClipCache.set(cacheKey, clip);
      return clip.clone();
    }
    this._animationClipCache.set(cacheKey, null);
    return null;
  } catch (_) {
    this._animationClipCache.set(cacheKey, null);
    return null;
  }
}

function _buildAnimationCacheKey(path, targetKey) {
  const base = path?.toLowerCase?.() || String(path || '');
  if (!targetKey) return base;
  return `${base}::${targetKey}`;
}

/* ------------------------------------------------------------------ */
/*  Retargeting                                                        */
/* ------------------------------------------------------------------ */

async function _retargetAnimationClip(clip, sourceRoot, targetRoot, options = {}) {
  if (!clip || !targetRoot || !sourceRoot) return clip;
  try {
    const SkeletonUtils = await this._getSkeletonUtils();
    if (SkeletonUtils?.retargetClip) {
      const targetMesh = this._findFirstSkinnedMesh(targetRoot) || targetRoot;
      const sourceMesh = this._findFirstSkinnedMesh(sourceRoot) || sourceRoot;
      if (targetMesh && sourceMesh) {
        const targetClone = SkeletonUtils.clone ? SkeletonUtils.clone(targetMesh) : null;
        const sourceClone = SkeletonUtils.clone ? SkeletonUtils.clone(sourceMesh) : null;
        const targetForRetarget = targetClone || targetMesh.clone?.(true) || targetMesh;
        const sourceForRetarget = sourceClone || sourceMesh.clone?.(true) || sourceMesh;
        const retargeted = SkeletonUtils.retargetClip(targetForRetarget, sourceForRetarget, clip, {
          useFirstFramePosition: options.preserveRootMotion ? false : true,
        });
        if (retargeted) return retargeted;
      }
    }
  } catch (_) {
    /* ignore retarget errors */
  }
  return clip;
}

/* ------------------------------------------------------------------ */
/*  Clip utilities                                                     */
/* ------------------------------------------------------------------ */

function _cloneClip(clip) {
  if (!clip) return null;
  try {
    return clip.clone();
  } catch (_) {
    return clip;
  }
}

function _scoreAnimationClip(clip) {
  if (!clip) return -Infinity;
  const trackCount = Array.isArray(clip.tracks) ? clip.tracks.length : 0;
  const duration = Number.isFinite(clip.duration) ? clip.duration : 0;
  if (trackCount <= 0 || duration <= 1e-4) {
    return duration > 0 ? duration : -Infinity;
  }
  return trackCount * duration;
}

function _selectPrimaryClip(clips) {
  if (!Array.isArray(clips) || !clips.length) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const clip of clips) {
    if (!clip) continue;
    const score = this._scoreAnimationClip(clip);
    if (score > bestScore) {
      best = clip;
      bestScore = score;
    }
  }
  return best || clips[0] || null;
}

/* ------------------------------------------------------------------ */
/*  Action configuration                                               */
/* ------------------------------------------------------------------ */

function _configureAction(action, descriptor, three, defaults = {}) {
  if (!action || !three) return;
  const loopMode = (descriptor?.loop || defaults.loop || 'repeat').toLowerCase();
  switch (loopMode) {
    case 'once':
      action.setLoop(three.LoopOnce, 0);
      break;
    case 'pingpong':
      action.setLoop(three.LoopPingPong, Infinity);
      break;
    default:
      action.setLoop(three.LoopRepeat, Infinity);
      break;
  }
  if (descriptor?.clampWhenFinished) {
    action.clampWhenFinished = true;
  }
  action.enabled = true;
  action.setEffectiveWeight?.(0);
  action.paused = false;
  action.reset();
  action.stop();
}

/* ------------------------------------------------------------------ */
/*  Movement profile                                                   */
/* ------------------------------------------------------------------ */

function _buildMovementProfile(movementOverrides = {}, actions = {}, clips = {}) {
  const tileWorldSize = this.gameManager?.spatial?.tileWorldSize || 1;
  const profile = {
    ...DEFAULT_MOVEMENT_PROFILE,
    ...(movementOverrides || {}),
  };

  profile.startClipDuration = 0;
  profile.walkClipDuration = this._extractClipDuration(actions.walk) || clips.walk || 0;
  profile.walkBackwardClipDuration =
    this._extractClipDuration(actions.walkBackward) || clips.walkBackward || 0;
  profile.stopClipDuration = 0;
  profile.idleClipDuration = this._extractClipDuration(actions.idle) || clips.idle || 0;
  profile.runClipDuration = this._extractClipDuration(actions.run) || clips.run || 0;
  profile.runBackwardClipDuration =
    this._extractClipDuration(actions.runBackward) || clips.runBackward || 0;
  profile.runStopClipDuration = this._extractClipDuration(actions.runStop) || clips.runStop || 0;
  profile.drunkWalkClipDuration =
    this._extractClipDuration(actions.drunkWalk) || clips.drunkWalk || 0;
  profile.drunkWalkBackwardClipDuration =
    this._extractClipDuration(actions.drunkWalkBackward) || clips.drunkWalkBackward || 0;
  profile.drunkRunForwardClipDuration =
    this._extractClipDuration(actions.drunkRunForward) || clips.drunkRunForward || 0;
  profile.drunkRunBackwardClipDuration =
    this._extractClipDuration(actions.drunkRunBackward) || clips.drunkRunBackward || 0;
  profile.fallClipDuration = this._extractClipDuration(actions.fall) || clips.fall || 0;
  profile.climbClipDuration = this._extractClipDuration(actions.climb) || clips.climb || 0;
  profile.climbWallClipDuration =
    this._extractClipDuration(actions.climbWall) || clips.climbWall || profile.climbClipDuration;
  profile.hardLandingClipDuration =
    this._extractClipDuration(actions.hardLanding) || clips.hardLanding || 0;
  profile.fallToRollClipDuration =
    this._extractClipDuration(actions.fallToRoll) || clips.fallToRoll || 0;
  profile.fallLoopClipDuration =
    this._extractClipDuration(actions.fallLoop) || clips.fallLoop || profile.fallClipDuration || 0;

  if (!Number.isFinite(profile.walkSpeed) || profile.walkSpeed <= 0) {
    const duration = Math.max(profile.walkClipDuration || 0, 1e-3);
    profile.walkSpeed = tileWorldSize / duration;
  }

  if (profile.startClipDuration > 0) {
    const lead = Math.min(
      Math.max(profile.startToWalkBlendLead ?? 0.25, 0.05),
      profile.startClipDuration
    );
    const defaultDelay = Math.max(profile.startClipDuration - lead - 0.05, 0);
    const maxDelay = Math.max(0, profile.startClipDuration - 0.02);
    const configuredDelay = Number.isFinite(profile.startMoveDelay)
      ? Math.max(profile.startMoveDelay, 0)
      : defaultDelay;
    profile.startMoveDelay = Math.min(configuredDelay, maxDelay);
    profile.startToWalkBlendLead = lead;
  } else {
    profile.startMoveDelay = 0;
    profile.startToWalkBlendLead = 0;
  }

  profile.stopTravelPortion = Math.min(Math.max(profile.stopTravelPortion ?? 0.55, 0), 1);
  profile.stopBlendLead = Math.max(
    Math.min(profile.stopBlendLead ?? 0.12, profile.stopClipDuration),
    0
  );
  profile.stopMovementDuration = profile.stopClipDuration * profile.stopTravelPortion;

  const runMultiplier = Number.isFinite(profile.runSpeedMultiplier)
    ? Math.max(profile.runSpeedMultiplier, 0.1)
    : 1.6;
  const drunkWalkMultiplier = Number.isFinite(profile.drunkWalkSpeedMultiplier)
    ? Math.max(profile.drunkWalkSpeedMultiplier, 0.1)
    : 0.65;
  const drunkRunMultiplier = Number.isFinite(profile.drunkRunSpeedMultiplier)
    ? Math.max(profile.drunkRunSpeedMultiplier, 0.1)
    : runMultiplier;

  if (!Number.isFinite(profile.runSpeed) || profile.runSpeed <= 0) {
    const runDuration = Math.max(profile.runClipDuration || profile.walkClipDuration || 0, 0);
    if (runDuration > 1e-3) {
      profile.runSpeed = tileWorldSize / runDuration;
    } else {
      profile.runSpeed = Math.max(profile.walkSpeed * runMultiplier, profile.walkSpeed);
    }
  }

  if (!Number.isFinite(profile.drunkWalkSpeed) || profile.drunkWalkSpeed <= 0) {
    const drunkWalkDuration = Math.max(
      profile.drunkWalkClipDuration || profile.walkClipDuration || 0,
      0
    );
    if (drunkWalkDuration > 1e-3) {
      profile.drunkWalkSpeed = tileWorldSize / drunkWalkDuration;
    } else {
      profile.drunkWalkSpeed = Math.max(profile.walkSpeed * drunkWalkMultiplier, 0.1);
    }
  }

  if (profile.drunkWalkSpeed > profile.walkSpeed) {
    profile.drunkWalkSpeed = Math.max(profile.walkSpeed * drunkWalkMultiplier, 0.1);
  }

  if (!Number.isFinite(profile.drunkRunSpeed) || profile.drunkRunSpeed <= 0) {
    const drunkRunDuration = Math.max(
      profile.drunkRunForwardClipDuration ||
        profile.drunkRunBackwardClipDuration ||
        profile.runClipDuration ||
        profile.walkClipDuration ||
        0,
      0
    );
    const base = Math.max(profile.drunkWalkSpeed, 0.1);
    const fallback = Math.max(base * drunkRunMultiplier, base);
    const runBaseline = Math.max(profile.runSpeed || fallback, fallback);
    const speedFloor = Math.max(runBaseline * 0.95, fallback);
    if (drunkRunDuration > 1e-3) {
      const durationSpeed = tileWorldSize / drunkRunDuration;
      profile.drunkRunSpeed = Math.max(durationSpeed, speedFloor);
    } else {
      profile.drunkRunSpeed = speedFloor;
    }
  }

  return profile;
}

function _extractClipDuration(action) {
  if (!action) return 0;
  try {
    if (typeof action.getClip === 'function') {
      const clip = action.getClip();
      if (clip && Number.isFinite(clip.duration)) return clip.duration;
    }
    if (action._clip && Number.isFinite(action._clip.duration)) {
      return action._clip.duration;
    }
  } catch (_) {
    /* ignore */
  }
  return 0;
}

/* ------------------------------------------------------------------ */
/*  Playback                                                           */
/* ------------------------------------------------------------------ */

function _setAnimation(tokenEntry, key, options = {}) {
  const data = this._tokenAnimationData.get(tokenEntry);
  if (!data || !data.actions) return;
  if (!data.actions[key]) return;
  if (!options.force && data.current === key) return;

  const manualState = this._getManualAnimationState(tokenEntry);
  const manualActive = !!manualState;
  const isManualOverride = options.__manualOverride === true;
  const releaseManual = options.__releaseManual === true;

  if (manualActive && !isManualOverride && !releaseManual) {
    return;
  }

  if (releaseManual || !isManualOverride) {
    this._clearManualAnimationState(tokenEntry);
  }

  const fadeIn = options.immediate ? 0 : (options.fadeIn ?? 0.2);
  const fadeOut = options.immediate ? 0 : (options.fadeOut ?? 0.2);
  const timeScale =
    Number.isFinite(options.timeScale) && options.timeScale > 0 ? options.timeScale : 1;

  if (data.current && data.actions[data.current]) {
    const currentAction = data.actions[data.current];
    try {
      if (options.immediate || fadeOut <= 0) {
        currentAction.stop();
      } else {
        currentAction.fadeOut(fadeOut);
      }
    } catch (_) {
      /* ignore */
    }
  }

  const next = data.actions[key];
  try {
    next.setEffectiveTimeScale?.(timeScale);
    next.reset();
    if (options.immediate || fadeIn <= 0) {
      next.setEffectiveWeight?.(1);
      next.play();
    } else {
      next.setEffectiveWeight?.(1);
      next.fadeIn(fadeIn).play();
    }
    data.current = key;
  } catch (_) {
    /* ignore */
  }
}

function hasAnimation(tokenEntry, key) {
  if (!tokenEntry || !key) return false;
  const data = this._tokenAnimationData.get(tokenEntry);
  return !!data?.actions?.[key];
}

function playTokenAnimation(tokenEntry, animationKey, options = {}) {
  if (!tokenEntry || !animationKey) return false;
  const data = this._tokenAnimationData.get(tokenEntry);
  if (!data || !data.actions?.[animationKey]) {
    return false;
  }

  const fadeOptions = {
    fadeIn: options.fadeIn,
    fadeOut: options.fadeOut,
    immediate: options.immediate,
    timeScale: options.timeScale,
    force: options.force !== false,
  };
  fadeOptions.__manualOverride = true;

  this._clearManualAnimationRevert(tokenEntry);
  const clipDurationMs = Math.max((data.clips?.[animationKey] || 0) * 1000, 0);
  const defaultLockMs = clipDurationMs > 0 ? clipDurationMs + 120 : 900;
  const movementLockMsRaw = options.movementLockMs;
  const movementLockMs =
    movementLockMsRaw === Infinity
      ? Infinity
      : movementLockMsRaw != null
        ? Math.max(movementLockMsRaw, 0)
        : defaultLockMs;
  let lockUntil = null;
  if (movementLockMs === Infinity) {
    lockUntil = Infinity;
  } else if (movementLockMs > 0) {
    lockUntil = Date.now() + movementLockMs;
  }

  this._clearManualAnimationState(tokenEntry);
  this._setAnimation(tokenEntry, animationKey, fadeOptions);
  this._setManualAnimationState(tokenEntry, {
    key: animationKey,
    allowRootMotion: !!options.allowRootMotion,
    lockUntil,
    releaseOnMovement: options.releaseOnMovement === true,
  });

  if (options.autoRevert) {
    const revertDelayMs = Number.isFinite(options.revertDelayMs)
      ? Math.max(options.revertDelayMs, 0)
      : clipDurationMs;
    const revertKey = options.revertAnimationKey || 'idle';
    const revertOptions = options.revertOptions || {};
    if (revertDelayMs > 0) {
      this._scheduleManualAnimationRevert(tokenEntry, revertDelayMs, revertKey, revertOptions);
    } else {
      this._clearManualAnimationState(tokenEntry);
      this._setAnimation(tokenEntry, revertKey, {
        ...revertOptions,
        __releaseManual: true,
      });
    }
  }

  return true;
}

/* ------------------------------------------------------------------ */
/*  Manual animation state                                             */
/* ------------------------------------------------------------------ */

function _clearManualAnimationRevert(tokenEntry) {
  if (!tokenEntry) return;
  const handle = this._manualAnimationRevertTimers.get(tokenEntry);
  if (handle) {
    clearTimeout(handle);
    this._manualAnimationRevertTimers.delete(tokenEntry);
  }
}

function _setManualAnimationState(tokenEntry, state) {
  if (!tokenEntry) return;
  if (state) {
    this._manualAnimationStates.set(tokenEntry, state);
  } else {
    this._manualAnimationStates.delete(tokenEntry);
  }
  this._applyManualHeightOffset(tokenEntry, state);
}

function _clearManualAnimationState(tokenEntry) {
  if (!tokenEntry) return;
  this._manualAnimationStates.delete(tokenEntry);
  this._applyManualHeightOffset(tokenEntry, null);
}

function _applyManualHeightOffset(tokenEntry, manualState) {
  const mesh = tokenEntry?.__threeMesh;
  if (!mesh || !mesh.userData) return;
  const previous = Number.isFinite(mesh.userData.__ttManualVerticalOffset)
    ? mesh.userData.__ttManualVerticalOffset
    : 0;
  const gm = this.gameManager;
  const elevationUnitRaw = gm?.spatial?.elevationUnit;
  const elevationUnit = Number.isFinite(elevationUnitRaw) ? elevationUnitRaw : 1;
  let lift = 0;
  if (manualState?.key === 'dynamicPose') {
    lift = elevationUnit * 3;
  }
  if (previous === lift) return;
  mesh.userData.__ttManualVerticalOffset = lift;
  try {
    const updated = this._positionMesh(mesh, tokenEntry);
    if (!updated && mesh.position && Number.isFinite(previous) && Number.isFinite(lift)) {
      mesh.position.y += lift - previous;
    }
    this._updateSelectionColliderHeight(mesh);
    this._updateSelectionIndicatorHeight(tokenEntry);
  } catch (_) {
    /* ignore position adjustments */
  }
}

function _getManualAnimationState(tokenEntry) {
  if (!tokenEntry) return null;
  const state = this._manualAnimationStates.get(tokenEntry);
  if (!state) return null;
  if (Number.isFinite(state.lockUntil) && state.lockUntil <= Date.now()) {
    this._manualAnimationStates.delete(tokenEntry);
    return null;
  }
  return state;
}

function _releaseManualAnimationForMovement(tokenEntry) {
  if (!tokenEntry) return;
  const state = this._getManualAnimationState(tokenEntry);
  if (!state) return;
  if (state.releaseOnMovement) {
    this._clearManualAnimationState(tokenEntry);
  }
}

function _scheduleManualAnimationRevert(tokenEntry, delayMs, revertKey, revertOptions = {}) {
  if (!tokenEntry || !(delayMs > 0)) return;
  const handle = setTimeout(() => {
    this._manualAnimationRevertTimers.delete(tokenEntry);
    try {
      this._clearManualAnimationState(tokenEntry);
      this._setAnimation(tokenEntry, revertKey, {
        ...revertOptions,
        __releaseManual: true,
      });
    } catch (_) {
      /* ignore */
    }
  }, delayMs);
  this._manualAnimationRevertTimers.set(tokenEntry, handle);
}

/* ------------------------------------------------------------------ */
/*  Prototype installer                                                */
/* ------------------------------------------------------------------ */

export function installAnimationMethods(prototype) {
  prototype._setupAnimationSet = _setupAnimationSet;
  prototype._resolveAnimationClip = _resolveAnimationClip;
  prototype._loadAnimationClip = _loadAnimationClip;
  prototype._buildAnimationCacheKey = _buildAnimationCacheKey;
  prototype._retargetAnimationClip = _retargetAnimationClip;
  prototype._cloneClip = _cloneClip;
  prototype._scoreAnimationClip = _scoreAnimationClip;
  prototype._selectPrimaryClip = _selectPrimaryClip;
  prototype._configureAction = _configureAction;
  prototype._buildMovementProfile = _buildMovementProfile;
  prototype._extractClipDuration = _extractClipDuration;
  prototype._setAnimation = _setAnimation;
  prototype.hasAnimation = hasAnimation;
  prototype.playTokenAnimation = playTokenAnimation;
  prototype._clearManualAnimationRevert = _clearManualAnimationRevert;
  prototype._setManualAnimationState = _setManualAnimationState;
  prototype._clearManualAnimationState = _clearManualAnimationState;
  prototype._applyManualHeightOffset = _applyManualHeightOffset;
  prototype._getManualAnimationState = _getManualAnimationState;
  prototype._releaseManualAnimationForMovement = _releaseManualAnimationForMovement;
  prototype._scheduleManualAnimationRevert = _scheduleManualAnimationRevert;
}
