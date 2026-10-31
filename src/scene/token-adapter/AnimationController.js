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

import {
  DEFAULT_MOVEMENT_PROFILE,
  CLIMB_WALL_ENTRY_TILE_HALF_RATIO,
  PRONE_ANIMATION_KEYS,
  PRONE_IMPACT_BLEND_SECONDS,
  PRONE_TRANSITION_BLEND_SECONDS,
} from '../../config/token-adapter/MannequinConfig.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { getManualAction } from '../../config/HumanoidActionCatalog.js';
import { cloneHumanoidRig, retargetHumanoidClip } from './HumanoidRig.js';
import { getTokenConditions } from '../../entities/creatures/TokenMovement.js';

// ── Animation Setup & Clip Resolution ────────────────────────────

async function _setupAnimationSet(tokenEntry, container, config, templateBundle) {
  const three = await this._getThree();
  if (!three) throw new Error('Character animation requires Three.js');
  const mixer = new three.AnimationMixer(container);
  const animationsConfig = config.animations || {};
  const actions = {};
  const clips = {};
  const loaded = {};
  const targetCacheKey = String(tokenEntry.type || tokenEntry.creature?.type || 'default');
  const clipOptions = {
    targetRig: templateBundle?.rig,
    targetCacheKey,
    retarget: config.retargetAnimations === true,
  };
  for (const [key, descriptor] of Object.entries(animationsConfig)) {
    if (descriptor.lazy) continue;
    const clip = await this._resolveAnimationClip(descriptor, null, clipOptions);
    if (!clip) throw new Error(`Configured character animation is unavailable: ${key}`);
    loaded[key] = clip;
  }
  if (!animationsConfig.idle) {
    const fallback = this._selectPrimaryClip(templateBundle?.animations);
    if (fallback) loaded.idle = this._cloneClip(fallback);
  }
  const rawTraversalClimb = loaded.climb;
  const preparedClimbs = this._prepareClimbRootMotion(tokenEntry, loaded);
  for (const key of ['climb', 'climbWall', 'climbWallDown', 'climbRecover', 'ledgeHang']) {
    if (preparedClimbs[key]) loaded[key] = preparedClimbs[key];
  }
  for (const [key, clip] of Object.entries(loaded)) {
    const action = mixer.clipAction(clip);
    this._configureAction(action, animationsConfig[key], three, {
      loop: key === 'ledgeHang' ? 'once' : 'repeat',
    });
    if (key === 'ledgeHang') action.clampWhenFinished = true;
    actions[key] = action;
    clips[key] = clip.duration;
  }
  const landingContactTimes = {};
  for (const key of ['fall', 'hardLanding', 'fallToRoll', 'proneLanding', 'prone']) {
    const contactTime = animationsConfig[key]?.contactTime;
    if (contactTime == null) continue;
    if (!Number.isFinite(contactTime) || contactTime < 0 || contactTime > clips[key]) {
      throw new Error(`Invalid ground-contact time for ${key}`);
    }
    landingContactTimes[key] = contactTime;
  }
  const animationData = {
    mixer,
    actions,
    clips,
    profile: this._buildMovementProfile(config.movementProfile, actions, clips),
    rootMotion: preparedClimbs.rootMotion,
    landingContactTimes,
    clipOptions,
    animationsConfig,
    templateRoot: templateBundle?.template,
    current: null,
  };
  animationData.traversal = this._prepareTraversalData(
    tokenEntry,
    animationData,
    rawTraversalClimb,
    three
  );
  this._prepareProneGrounding(tokenEntry, container, animationData, three);
  this._alignLedgeHangGrip(tokenEntry, container, animationData, three);
  this._animationMixers.set(tokenEntry, mixer);
  this._tokenAnimationData.set(tokenEntry, animationData);
  this._movementRangeDirty = true;
  if (actions.idle) this._setAnimation(tokenEntry, 'idle', { immediate: true });
  this._resumeMovementAnimations(tokenEntry);
}

function _alignLedgeHangGrip(tokenEntry, container, data, three) {
  const action = data.actions.ledgeHang;
  const rootInfo = data.rootMotion?.rootInfo;
  if (!action || !rootInfo) return;
  const hands = this._findFirstSkinnedMesh(container)?.skeleton?.bones.filter((bone) =>
    /(LeftHand|RightHand)$/.test(bone.name)
  );
  const track = action
    .getClip()
    .tracks.find((entry) => entry.name === `${rootInfo.bone.name}.position`);
  if (hands?.length !== 2 || !track)
    throw new Error('Ledge hanging requires two hand bones and a root position track');
  action.setEffectiveWeight(1).play();
  action.paused = true;
  try {
    data.mixer.update(0);
    container.updateWorldMatrix(true, false);
    container.updateMatrixWorld(true);
    const grip = hands[0]
      .getWorldPosition(new three.Vector3())
      .add(hands[1].getWorldPosition(new three.Vector3()))
      .multiplyScalar(0.5);
    const world = this._resolveTokenWorldPosition(tokenEntry);
    const spatial = this.gameManager.spatial;
    const standOff = spatial.tileWorldSize * (1 - CLIMB_WALL_ENTRY_TILE_HALF_RATIO) * 0.5;
    const forward = this._getDirectionalVectorFromYaw(this._getMovementYaw(tokenEntry), 1);
    const target = new three.Vector3(
      world.x + forward.x * standOff,
      world.y + this._resolveClimbMantleHeight(data, spatial.elevationUnit),
      world.z + forward.z * standOff
    );
    const parent = rootInfo.bone.parent;
    const offset = parent.worldToLocal(target).sub(parent.worldToLocal(grip));
    for (let i = 0; i < track.values.length; i += 3) {
      track.values[i] += offset.x;
      track.values[i + 1] += offset.y;
      track.values[i + 2] += offset.z;
    }
  } finally {
    action.stop();
  }
}

async function _resolveAnimationClip(descriptor, fallbackClip, options = {}) {
  if (!descriptor) {
    return this._cloneClip(fallbackClip);
  }

  const mergedOptions =
    descriptor && typeof descriptor === 'object'
      ? {
          ...options,
          preserveRootMotion: descriptor.preserveRootMotion === true,
          retarget: descriptor.retarget ?? options.retarget,
        }
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

// ── Clip Loading & Caching ────────────────────────────────────────

async function _loadAnimationClip(path, options = {}) {
  if (!path) return null;
  const cacheKey = this._buildAnimationCacheKey(path, options.targetCacheKey, options.retarget);
  if (this._animationClipCache.has(cacheKey)) {
    const cached = await this._animationClipCache.get(cacheKey);
    return cached.clone();
  }
  const loading = (async () => {
    const source = await this._loadAnimationSource(path);
    return options.retarget === true
      ? this._retargetAnimationClip(source.clip, source.rig, options.targetRig)
      : source.clip;
  })();
  this._animationClipCache.set(cacheKey, loading);
  try {
    const clip = await loading;
    this._animationClipCache.set(cacheKey, clip);
    return clip.clone();
  } catch (error) {
    this._animationClipCache.delete(cacheKey);
    throw error;
  }
}

async function _loadAnimationSource(path) {
  const cacheKey = path.toLowerCase();
  if (this._animationSourceCache.has(cacheKey)) {
    return this._animationSourceCache.get(cacheKey);
  }
  const loading = (async () => {
    const [three, FBXLoaderCtor] = await Promise.all([this._getThree(), this._getFBXLoaderCtor()]);
    if (!three || !FBXLoaderCtor) throw new Error('FBX animation loading is unavailable');
    const variants = this._buildPathVariants(path);
    for (const url of variants) {
      const object = await this._loadFBX(new FBXLoaderCtor(), url);
      const clip = this._selectPrimaryClip(object?.animations);
      if (clip) {
        return { clip, rig: cloneHumanoidRig(object, three) };
      }
    }
    throw new Error(`Unable to load configured FBX animation: ${path}`);
  })();
  this._animationSourceCache.set(cacheKey, loading);
  try {
    return await loading;
  } catch (error) {
    this._animationSourceCache.delete(cacheKey);
    throw error;
  }
}

function _buildAnimationCacheKey(path, targetKey, retarget) {
  const base = path?.toLowerCase?.() || String(path || '');
  return `${base}::${targetKey || 'source'}::${retarget === true ? 'retarget' : 'reference'}`;
}

// ── Retargeting ───────────────────────────────────────────────────

async function _retargetAnimationClip(clip, sourceRoot, targetRoot) {
  const [three, skeletonUtils] = await Promise.all([this._getThree(), this._getSkeletonUtils()]);
  return retargetHumanoidClip(clip, sourceRoot, targetRoot, three, skeletonUtils);
}

// ── Clip Utilities ───────────────────────────────────────────────

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

// ── Action Configuration ──────────────────────────────────────────

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

// ── Movement Profile ─────────────────────────────────────────────

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
  profile.climbWallDownClipDuration =
    this._extractClipDuration(actions.climbWallDown) || clips.climbWallDown || 0;
  profile.hardLandingClipDuration =
    this._extractClipDuration(actions.hardLanding) || clips.hardLanding || 0;
  profile.fallToRollClipDuration =
    this._extractClipDuration(actions.fallToRoll) || clips.fallToRoll || 0;
  profile.fallLoopClipDuration =
    this._extractClipDuration(actions.fallLoop) || clips.fallLoop || profile.fallClipDuration || 0;
  profile.proneLandingClipDuration =
    this._extractClipDuration(actions.proneLanding) || clips.proneLanding || 0;

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

// ── Playback ─────────────────────────────────────────────────────

function _setAnimation(tokenEntry, key, options = {}) {
  if (key === 'idle' && getTokenConditions(tokenEntry).includes('prone')) key = 'prone';
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

  let fadeIn = options.immediate ? 0 : (options.fadeIn ?? 0.2);
  let fadeOut = options.immediate ? 0 : (options.fadeOut ?? 0.2);
  if (
    !options.immediate &&
    !isManualOverride &&
    data.current !== key &&
    data.actions[data.current] &&
    (PRONE_ANIMATION_KEYS.has(data.current) || PRONE_ANIMATION_KEYS.has(key))
  ) {
    const minimum =
      data.current === 'fallLoop' ? PRONE_IMPACT_BLEND_SECONDS : PRONE_TRANSITION_BLEND_SECONDS;
    const duration = Math.max(fadeIn, fadeOut, minimum);
    fadeIn = duration;
    fadeOut = duration;
  }
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

async function playTokenAction(tokenEntry, commandId) {
  const definition = getManualAction(commandId);
  if (!definition) throw new Error(`Unknown manual action: ${commandId}`);
  const data = this._tokenAnimationData.get(tokenEntry);
  if (!data) throw new Error('Creature animations are not ready yet');
  if (data.loadingManualAction) throw new Error('Another creature action is still loading');
  const requireGrounded = () => {
    if (
      this.isMovementInProgress(tokenEntry) ||
      this.isWallAttached(tokenEntry) ||
      this._movementRoutes.has(tokenEntry)
    ) {
      throw new Error("Finish this creature's movement or climb before playing a manual action");
    }
    if (this._tokenAnimationData.get(tokenEntry) !== data || !tokenEntry.__threeMesh) {
      throw new Error('The creature was removed while this action was loading');
    }
  };
  requireGrounded();
  const availability = this.getManualActionAvailability(tokenEntry, commandId);
  if (!availability.allowed) throw new Error(availability.reason);
  data.loadingManualAction = commandId;
  try {
    const choices = definition.choices?.filter((key) => data.actions[key]);
    const key = choices?.length
      ? choices[Math.floor(Math.random() * choices.length)]
      : definition.animation?.key;
    if (!key) throw new Error(`Manual action has no available animation: ${commandId}`);
    const descriptors = [definition.animation, definition.returnAnimation].filter(Boolean);
    for (const descriptor of descriptors) {
      if (data.actions[descriptor.key]) continue;
      const clip = await this._resolveAnimationClip(descriptor, null, data.clipOptions);
      if (!clip) throw new Error(`Manual action animation is unavailable: ${commandId}`);
      requireGrounded();
      const three = await this._getThree();
      requireGrounded();
      const action = data.mixer.clipAction(clip);
      this._configureAction(action, descriptor, three);
      data.actions[descriptor.key] = action;
      data.clips[descriptor.key] = clip.duration;
    }
    const placement = await this._prepareManualActionMotion(tokenEntry, definition, key);
    requireGrounded();
    if (definition.revertTo && !data.actions[definition.revertTo]) {
      throw new Error(`Manual action recovery is unavailable: ${definition.revertTo}`);
    }
    const played = this.playTokenAnimation(tokenEntry, key, definition.playback);
    if (!played || data.current !== key) throw new Error(`Unable to start action: ${commandId}`);
    const manual = this._manualAnimationStates.get(tokenEntry);
    manual.coverPlacement = placement;
    this._movementRangeDirty = true;
    if (definition.revertTo || placement) {
      const action = data.actions[key];
      const finished = (event) => {
        if (event.action !== action) return;
        if (this._getManualAnimationState(tokenEntry)?.key !== key) return;
        if (placement) {
          this._finishCoverPlacement(tokenEntry, placement);
          data.mixer.removeEventListener('finished', finished);
          return;
        }
        this._clearManualAnimationState(tokenEntry);
        this._setAnimation(tokenEntry, definition.revertTo, {
          fadeIn: definition.playback.fadeOut,
          fadeOut: definition.playback.fadeOut,
          __releaseManual: true,
        });
      };
      data.mixer.addEventListener('finished', finished);
      this._manualAnimationStates.get(tokenEntry).onRelease = () =>
        data.mixer.removeEventListener('finished', finished);
    }
    return true;
  } finally {
    data.loadingManualAction = null;
  }
}

function playTokenAnimation(tokenEntry, animationKey, options = {}) {
  if (!tokenEntry || !animationKey) return false;
  if (getTokenConditions(tokenEntry).includes('prone')) {
    GameErrors.input(new Error('Stand up from Prone before playing a visual action'), {
      component: 'Token3DAdapter',
      operation: 'playTokenAnimation',
      tokenId: tokenEntry.id,
    });
    return false;
  }
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
    inPlace: options.inPlace === true,
    blocksMovement: options.blocksMovement === true,
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

// ── Manual Animation State ───────────────────────────────────────

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
  const state = this._manualAnimationStates.get(tokenEntry);
  this._manualAnimationStates.delete(tokenEntry);
  state?.onRelease?.();
  this._movementRangeDirty = true;
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
    this._updateSelectionIndicatorTransform(tokenEntry);
  } catch (error) {
    GameErrors.rendering(error, {
      component: 'Token3DAdapter',
      operation: 'adjustManualAnimationHeight',
      tokenId: tokenEntry.id,
    });
  }
}

function _getManualAnimationState(tokenEntry) {
  if (!tokenEntry) return null;
  const state = this._manualAnimationStates.get(tokenEntry);
  if (!state) return null;
  if (Number.isFinite(state.lockUntil) && state.lockUntil <= Date.now()) {
    this._clearManualAnimationState(tokenEntry);
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

export function installAnimationMethods(prototype) {
  prototype._setupAnimationSet = _setupAnimationSet;
  prototype._alignLedgeHangGrip = _alignLedgeHangGrip;
  prototype._resolveAnimationClip = _resolveAnimationClip;
  prototype._loadAnimationClip = _loadAnimationClip;
  prototype._loadAnimationSource = _loadAnimationSource;
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
  prototype.playTokenAction = playTokenAction;
  prototype.playTokenAnimation = playTokenAnimation;
  prototype._clearManualAnimationRevert = _clearManualAnimationRevert;
  prototype._setManualAnimationState = _setManualAnimationState;
  prototype._clearManualAnimationState = _clearManualAnimationState;
  prototype._applyManualHeightOffset = _applyManualHeightOffset;
  prototype._getManualAnimationState = _getManualAnimationState;
  prototype._releaseManualAnimationForMovement = _releaseManualAnimationForMovement;
  prototype._scheduleManualAnimationRevert = _scheduleManualAnimationRevert;
}
