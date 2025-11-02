// Token3DAdapter.js - Phase 3 enhanced scaffold
// Bridges existing 2D token data structures to emerging 3D scene.
// Responsibilities:
//  - Create either billboard planes (legacy sprites) or true 3D models per token entry
//  - Keep Three.js representation synchronized with grid placement / terrain height
//  - Manage hover/selection highlighting and facing direction parity with 2D tokens

const FEMALE_HUMANOID_MODEL = {
  path: 'assets/animated-sprites/Standing Idle.fbx',
  tileSpan: 1,
  margin: 0.92,
  baseRotation: { x: 0, y: Math.PI / 2, z: 0 },
  animation: {
    autoplay: true,
    loop: true,
    clampWhenFinished: false,
  },
  animations: {
    idle: {
      path: 'assets/animated-sprites/Standing Idle.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    walk: {
      path: 'assets/animated-sprites/Walking.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    walkStart: {
      path: 'assets/animated-sprites/Female Start Walking.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    walkStop: {
      path: 'assets/animated-sprites/Female Stop Walking.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
  },
  movementProfile: {
    startToWalkBlendLead: 0.12,
    stopTravelPortion: 0.58,
    stopBlendLead: 0.14,
    walkFadeIn: 0.18,
    walkFadeOut: 0.18,
    startFadeIn: 0.12,
    startFadeOut: 0.1,
    stopFadeIn: 0.18,
    stopFadeOut: 0.15,
    idleFadeIn: 0.22,
    idleFadeOut: 0.2,
  },
  shadows: {
    cast: true,
    receive: true,
  },
  verticalOffset: 0,
};

const TOKEN_3D_MODELS = {
  'female-humanoid': FEMALE_HUMANOID_MODEL,
  // Preserve legacy saves that still reference the defeated doll identifier.
  'defeated-doll': FEMALE_HUMANOID_MODEL,
};

const DEFAULT_BILLBOARD_SIZE = 0.9;
const DEFAULT_MOVEMENT_PROFILE = {
  startMoveDelay: 0.25,
  startToWalkBlendLead: 0.12,
  stopTravelPortion: 0.55,
  stopBlendLead: 0.12,
  walkFadeIn: 0.18,
  walkFadeOut: 0.18,
  startFadeIn: 0.12,
  startFadeOut: 0.1,
  stopFadeIn: 0.18,
  stopFadeOut: 0.15,
  idleFadeIn: 0.2,
  idleFadeOut: 0.2,
};

export class Token3DAdapter {
  constructor(gameManager) {
    this.gameManager = gameManager;
    this._attached = false;
    this._verticalBias = 0;
    this._hoverToken = null;
    this._selectedToken = null;
    this._originalMaterials = new WeakMap();
    this._threePromise = null;
    this._fbxCtorPromise = null;
    this._skeletonUtilsPromise = null;
    this._modelCache = new Map();
    this._animationMixers = new Map();
    this._animationClipCache = new Map();
    this._tokenAnimationData = new Map();
    this._movementStates = new Map();
    this._rootBones = new Map();
    this._lastFrameTime = null;
    this._lastFacingRight = null;
    this._selectionColor = 0xffcc55;
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    try {
      this.syncAll();
    } catch (_) {
      /* ignore */
    }
    try {
      const gm = this.gameManager;
      if (gm?.threeSceneManager?.addAnimationCallback && !this._frameCallback) {
        this._frameCallback = () => {
          const gmRef = this.gameManager;
          const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
          let delta = 0;
          if (this._lastFrameTime != null) {
            delta = Math.max(0, (now - this._lastFrameTime) / 1000);
            if (delta > 0.1) delta = 0.1;
          }
          this._lastFrameTime = now;

          if (delta > 0) {
            try {
              this._updateForwardMovements(delta);
            } catch (_) {
              /* ignore movement update errors */
            }
          }

          if (delta > 0 && this._animationMixers.size) {
            for (const [tokenEntry, mixer] of this._animationMixers.entries()) {
              try {
                mixer.update(delta);
              } catch (_) {
                /* ignore mixer update */
              }
              try {
                this._neutralizeRootMotion(tokenEntry);
              } catch (_) {
                /* ignore root reset */
              }
            }
          }

          try {
            this._syncFacingDirection();
          } catch (_) {
            /* ignore */
          }

          try {
            const camera = gmRef?.threeSceneManager?.camera;
            if (!camera) return;
            const tokens = gmRef?.placedTokens || [];
            for (const t of tokens) {
              const mesh = t.__threeMesh;
              if (!mesh || typeof mesh.lookAt !== 'function') continue;
              if (mesh.userData?.__ttBillboard === false) continue;
              try {
                mesh.lookAt(camera.position);
              } catch (_) {
                /* ignore */
              }
            }
          } catch (_) {
            /* ignore */
          }
        };
        gm.threeSceneManager.addAnimationCallback(this._frameCallback);
      }
    } catch (_) {
      /* ignore */
    }
  }

  syncAll() {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const scene = gm.threeSceneManager?.scene;
    if (!scene) return;
    const tokens = gm.placedTokens || [];
    for (const t of tokens) this._ensureTokenMesh(t, scene);
  }

  onTokenAdded(tokenEntry) {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const scene = gm.threeSceneManager?.scene;
    if (!scene) return;
    return this._ensureTokenMesh(tokenEntry, scene);
  }

  _ensureTokenMesh(tokenEntry, scene) {
    if (!tokenEntry || tokenEntry.__threeMesh) return;
    const gm = this.gameManager;

    if (gm && gm.__threeTestDouble) {
      try {
        const three = gm.__threeTestDouble;
        const geo = new three.PlaneGeometry(DEFAULT_BILLBOARD_SIZE, DEFAULT_BILLBOARD_SIZE);
        const mat = this._createMaterialForToken(three, tokenEntry);
        const mesh = new three.Mesh(geo, mat);
        this._applyCommonMetadata(mesh, tokenEntry, { billboard: true, verticalOffset: 0 });
        this._positionMesh(mesh, tokenEntry);
        scene.add(mesh);
        tokenEntry.__threeMesh = mesh;
        return Promise.resolve(mesh);
      } catch (_) {
        return Promise.resolve(null);
      }
    }

    const typeKey = (tokenEntry.type || tokenEntry.creature?.type || '').toLowerCase();
    const config = TOKEN_3D_MODELS[typeKey] || null;

    if (config) {
      const promise = this._create3DToken(tokenEntry, scene, config);
      this._attachPromise(tokenEntry, promise);
      return promise;
    }

    const promise = this._createBillboardToken(tokenEntry, scene);
    this._attachPromise(tokenEntry, promise);
    return promise;
  }

  _attachPromise(tokenEntry, promise) {
    if (!promise || typeof promise.then !== 'function') return;
    try {
      Object.defineProperty(tokenEntry, '__threeMeshPromise', {
        value: promise,
        enumerable: false,
      });
    } catch (_) {
      tokenEntry.__threeMeshPromise = promise;
    }
  }

  async _createBillboardToken(tokenEntry, scene) {
    const three = await this._getThree();
    if (!three) return null;
    try {
      const geo = new three.PlaneGeometry(DEFAULT_BILLBOARD_SIZE, DEFAULT_BILLBOARD_SIZE);
      const mat = this._createMaterialForToken(three, tokenEntry);
      const mesh = new three.Mesh(geo, mat);
      this._applyCommonMetadata(mesh, tokenEntry, { billboard: true, verticalOffset: 0 });
      this._positionMesh(mesh, tokenEntry);
      scene.add(mesh);
      tokenEntry.__threeMesh = mesh;
      this.updateTokenOrientation(tokenEntry);
      this._refreshVisualState(tokenEntry);
      return mesh;
    } catch (error) {
      return null;
    }
  }

  async _create3DToken(tokenEntry, scene, config) {
    try {
      const typeKey = (tokenEntry.type || tokenEntry.creature?.type || '').toLowerCase();
      const templateBundle = await this._loadModelTemplate(typeKey, config);
      if (!templateBundle) return null;
      const clone = await this._cloneTemplate(templateBundle.template);
      if (!clone) return null;
      const three = await this._getThree();
      if (!three) return null;

      const container = new three.Group();
      const baseName = tokenEntry.id || tokenEntry.creature?.type || typeKey || 'unk';
      container.name = `Token3D:${baseName}`;
      container.add(clone);

      if (config.baseRotation) {
        container.rotation.set(
          config.baseRotation.x || 0,
          config.baseRotation.y || 0,
          config.baseRotation.z || 0
        );
      }

      clone.traverse?.((child) => {
        if (child.isMesh || child.isSkinnedMesh) {
          const cast = config.shadows?.cast ?? true;
          const receive = config.shadows?.receive ?? true;
          child.castShadow = cast;
          child.receiveShadow = receive;
        }
      });

      this._applyCommonMetadata(container, tokenEntry, {
        billboard: false,
        is3D: true,
        verticalOffset: Number.isFinite(config.verticalOffset) ? config.verticalOffset : 0,
        baseYaw: config.baseRotation?.y || 0,
      });

      this._registerRootBones(tokenEntry, container);

      container.userData.__ttTintMaterials = this._collectTintTargets(container);
      this._positionMesh(container, tokenEntry);
      scene.add(container);
      tokenEntry.__threeMesh = container;
      this.updateTokenOrientation(tokenEntry);
      this._refreshVisualState(tokenEntry);

      await this._setupAnimationSet(tokenEntry, container, config, templateBundle);

      return container;
    } catch (_) {
      return null;
    }
  }

  _registerRootBones(tokenEntry, container) {
    if (!tokenEntry || !container) return;
    try {
      const roots = [];
      container.traverse?.((child) => {
        if (!child?.isBone) return;
        const parentIsBone = child.parent && child.parent.isBone;
        if (parentIsBone) return;
        const basePosition = child.position?.clone?.() || null;
        roots.push({ bone: child, basePosition });
      });
      if (roots.length) {
        container.userData = container.userData || {};
        container.userData.__ttRootBones = roots;
        this._rootBones.set(tokenEntry, roots);
      }
    } catch (_) {
      /* ignore root registration errors */
    }
  }

  _neutralizeRootMotion(tokenEntry) {
    const roots = this._rootBones.get(tokenEntry);
    if (!roots || !roots.length) return;
    for (const info of roots) {
      const bone = info?.bone;
      if (!bone || !bone.position) continue;
      const base = info.basePosition;
      if (base) {
        bone.position.x = base.x;
        bone.position.z = base.z;
      } else {
        bone.position.x = 0;
        bone.position.z = 0;
      }
    }
  }

  beginForwardMovement(tokenEntry) {
    try {
      if (!tokenEntry) return;
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const mesh = tokenEntry.__threeMesh;
      if (!mesh) return;
      const animationData = this._tokenAnimationData.get(tokenEntry);
      if (!animationData) return;

      const existing = this._movementStates.get(tokenEntry);
      if (existing) {
        existing.intentHold = true;
        existing.pendingStop = false;
        return;
      }

      const step = this._createForwardMovementStep(tokenEntry, mesh);
      if (!step) return;

      const profile = animationData.profile || DEFAULT_MOVEMENT_PROFILE;
      const hasStartPhase =
        !!animationData.actions?.walkStart && (profile.startClipDuration || 0) > 0.01;

      const state = {
        token: tokenEntry,
        mesh,
        profile,
        activeStep: step,
        phase: hasStartPhase ? 'start' : 'walk',
        phaseElapsed: 0,
        intentHold: true,
        pendingStop: false,
        stopTriggered: false,
        stopElapsed: 0,
        stopMovementElapsed: 0,
        stopMovementTime: 0,
        stopSpeed: 0,
        stopBlendedToIdle: false,
        stepFinalized: false,
        hasLoopStarted: !hasStartPhase,
      };

      this._movementStates.set(tokenEntry, state);

      if (state.phase === 'start') {
        this._setAnimation(tokenEntry, 'walkStart', {
          fadeIn: profile.startFadeIn,
          fadeOut: profile.startFadeOut,
        });
      } else {
        this._setAnimation(tokenEntry, 'walk', {
          fadeIn: profile.walkFadeIn,
          fadeOut: profile.walkFadeOut,
        });
        state.hasLoopStarted = true;
      }
    } catch (_) {
      /* ignore begin movement errors */
    }
  }

  endForwardMovement(tokenEntry) {
    try {
      const state = this._movementStates.get(tokenEntry);
      if (!state) return;
      state.intentHold = false;
      state.pendingStop = true;
    } catch (_) {
      /* ignore end movement errors */
    }
  }

  async _setupAnimationSet(tokenEntry, container, config, templateBundle) {
    try {
      const three = await this._getThree();
      if (!three) return;
      const mixer = new three.AnimationMixer(container);
      const animationsConfig = config.animations || {};
      const actions = {};
      const clips = {};

      const idleClip = await this._resolveAnimationClip(
        animationsConfig.idle,
        templateBundle?.animations?.[0] || null
      );
      if (idleClip) {
        const action = mixer.clipAction(idleClip);
        this._configureAction(action, animationsConfig.idle, three, { loop: 'repeat' });
        actions.idle = action;
        clips.idle = idleClip.duration || 0;
      }

      const walkClip = await this._resolveAnimationClip(animationsConfig.walk, null);
      if (walkClip) {
        const action = mixer.clipAction(walkClip);
        this._configureAction(action, animationsConfig.walk, three, { loop: 'repeat' });
        actions.walk = action;
        clips.walk = walkClip.duration || 0;
      }

      const walkStartClip = await this._resolveAnimationClip(animationsConfig.walkStart, null);
      if (walkStartClip) {
        const action = mixer.clipAction(walkStartClip);
        this._configureAction(action, animationsConfig.walkStart, three, { loop: 'once' });
        actions.walkStart = action;
        clips.walkStart = walkStartClip.duration || 0;
      }

      const walkStopClip = await this._resolveAnimationClip(animationsConfig.walkStop, null);
      if (walkStopClip) {
        const action = mixer.clipAction(walkStopClip);
        this._configureAction(action, animationsConfig.walkStop, three, { loop: 'once' });
        actions.walkStop = action;
        clips.walkStop = walkStopClip.duration || 0;
      }

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
    } catch (_) {
      /* ignore animation setup errors */
    }
  }

  async _resolveAnimationClip(descriptor, fallbackClip) {
    if (!descriptor) {
      return this._cloneClip(fallbackClip);
    }

    if (typeof descriptor === 'string') {
      const clip = await this._loadAnimationClip(descriptor);
      return clip || this._cloneClip(fallbackClip);
    }

    if (descriptor?.path) {
      const clip = await this._loadAnimationClip(descriptor.path);
      return clip || this._cloneClip(fallbackClip);
    }

    return this._cloneClip(fallbackClip);
  }

  async _loadAnimationClip(path) {
    if (!path) return null;
    const cacheKey = path.toLowerCase?.() || path;
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
      for (const url of variants) {
        try {
          const loader = new FBXLoaderCtor();
          const object = await this._loadFBX(loader, url);
          if (object?.animations?.length) {
            clip = object.animations[0];
            break;
          }
        } catch (_) {
          /* try next */
        }
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

  _cloneClip(clip) {
    if (!clip) return null;
    try {
      return clip.clone();
    } catch (_) {
      return clip;
    }
  }

  _configureAction(action, descriptor, three, defaults = {}) {
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

  _buildMovementProfile(movementOverrides = {}, actions = {}, clips = {}) {
    const tileWorldSize = this.gameManager?.spatial?.tileWorldSize || 1;
    const profile = {
      ...DEFAULT_MOVEMENT_PROFILE,
      ...(movementOverrides || {}),
    };

    profile.startClipDuration =
      this._extractClipDuration(actions.walkStart) || clips.walkStart || 0;
    profile.walkClipDuration = this._extractClipDuration(actions.walk) || clips.walk || 0;
    profile.stopClipDuration = this._extractClipDuration(actions.walkStop) || clips.walkStop || 0;
    profile.idleClipDuration = this._extractClipDuration(actions.idle) || clips.idle || 0;

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
      profile.startMoveDelay = Math.min(Math.max(configuredDelay, defaultDelay), maxDelay);
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

    return profile;
  }

  _extractClipDuration(action) {
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

  _setAnimation(tokenEntry, key, options = {}) {
    const data = this._tokenAnimationData.get(tokenEntry);
    if (!data || !data.actions) return;
    if (!data.actions[key]) return;
    if (!options.force && data.current === key) return;

    const fadeIn = options.immediate ? 0 : (options.fadeIn ?? 0.2);
    const fadeOut = options.immediate ? 0 : (options.fadeOut ?? 0.2);

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

  _updateForwardMovements(delta) {
    if (!this._movementStates.size) return;
    const entries = Array.from(this._movementStates.entries());
    for (const [tokenEntry, state] of entries) {
      if (!state || !state.activeStep) {
        this._movementStates.delete(tokenEntry);
        continue;
      }
      try {
        switch (state.phase) {
          case 'start':
            this._advanceStartPhase(state, delta);
            break;
          case 'walk':
            this._advanceWalkPhase(state, delta);
            break;
          case 'stop':
            this._advanceStopPhase(state, delta);
            break;
          default:
            this._movementStates.delete(tokenEntry);
            break;
        }
      } catch (_) {
        this._movementStates.delete(tokenEntry);
      }
    }
  }

  _advanceStartPhase(state, delta) {
    state.phaseElapsed += delta;
    const profile = state.profile;
    const moveDelay = profile.startMoveDelay || 0;

    if (state.phaseElapsed > moveDelay) {
      const prevElapsed = Math.max(0, state.phaseElapsed - delta - moveDelay);
      const currentElapsed = Math.max(0, state.phaseElapsed - moveDelay);
      const moveDelta = currentElapsed - prevElapsed;
      if (moveDelta > 0) {
        this._advanceMovementStep(state, profile.walkSpeed * moveDelta);
        if (state.phase !== 'start') return;
      }
    }

    const clipDuration = profile.startClipDuration || 0;
    if (!state.hasLoopStarted && clipDuration > 0) {
      const lead = Math.min(profile.startToWalkBlendLead || 0, clipDuration);
      if (state.phaseElapsed >= Math.max(clipDuration - lead, 0)) {
        this._setAnimation(state.token, 'walk', {
          fadeIn: profile.walkFadeIn,
          fadeOut: profile.walkFadeOut,
        });
        state.hasLoopStarted = true;
      }
    }

    if (clipDuration === 0 || state.phaseElapsed >= clipDuration) {
      state.phase = 'walk';
      state.phaseElapsed = 0;
      if (!state.hasLoopStarted) {
        this._setAnimation(state.token, 'walk', {
          fadeIn: profile.walkFadeIn,
          fadeOut: profile.walkFadeOut,
        });
        state.hasLoopStarted = true;
      }
    }
  }

  _advanceWalkPhase(state, delta) {
    const profile = state.profile;
    if (!state.intentHold) {
      state.pendingStop = true;
    }

    this._advanceMovementStep(state, profile.walkSpeed * delta);

    if (!state.stopTriggered && state.pendingStop) {
      const step = state.activeStep;
      if (step) {
        const remaining = Math.max(0, step.totalDistance - step.traveled);
        const speed = Math.max(profile.walkSpeed || 0.01, 0.01);
        const timeRemaining = remaining / speed;
        const stopDuration = Math.max(profile.stopMovementDuration || 0, 0);
        const buffer = 0.05;
        if (timeRemaining <= stopDuration + buffer || remaining <= 0.05) {
          this._triggerStop(state);
          return;
        }
      }
    }
  }

  _advanceStopPhase(state, delta) {
    const profile = state.profile;
    state.stopElapsed += delta;

    if (state.stopMovementTime > 0 && state.stopMovementElapsed < state.stopMovementTime) {
      const remainingTime = state.stopMovementTime - state.stopMovementElapsed;
      const timeSlice = Math.min(delta, remainingTime);
      this._advanceMovementStep(state, state.stopSpeed * timeSlice, { clamp: true });
      state.stopMovementElapsed += timeSlice;
    } else if (!state.stepFinalized) {
      this._lockStepAtTarget(state);
    }

    const clipDuration = profile.stopClipDuration || 0;
    if (!state.stopBlendedToIdle && clipDuration > 0) {
      const lead = Math.min(profile.stopBlendLead || 0, clipDuration);
      if (state.stopElapsed >= Math.max(clipDuration - lead, 0)) {
        this._setAnimation(state.token, 'idle', {
          fadeIn: profile.idleFadeIn,
          fadeOut: profile.stopFadeOut,
        });
        state.stopBlendedToIdle = true;
      }
    }

    if (clipDuration === 0 || state.stopElapsed >= clipDuration - 1e-4) {
      this._finishStopState(state);
    }
  }

  _advanceMovementStep(state, distance) {
    const step = state.activeStep;
    if (!step || distance <= 0) return false;
    const completed = this._applyStepProgress(step, distance);
    if (completed && !state.stepFinalized) {
      this._lockStepAtTarget(state);
      if (state.phase === 'walk' && state.intentHold && !state.pendingStop) {
        const nextStep = this._createForwardMovementStep(state.token, state.mesh);
        if (nextStep) {
          state.activeStep = nextStep;
          state.stepFinalized = false;
          state.phase = 'walk';
          state.phaseElapsed = 0;
          return false;
        }
      }

      if (state.phase !== 'stop' && (!state.intentHold || state.pendingStop)) {
        this._triggerStop(state);
      }

      if (state.phase !== 'stop' && !state.pendingStop && !state.intentHold) {
        this._finishWalkState(state);
      }
    }
    return completed;
  }

  _applyStepProgress(step, distance) {
    const remaining = Math.max(0, step.totalDistance - step.traveled);
    const move = Math.min(distance, remaining);
    if (move <= 0) return remaining <= 1e-5;
    step.traveled += move;
    const ratio = step.totalDistance > 0 ? Math.min(step.traveled / step.totalDistance, 1) : 1;
    const pos = this._lerp3(step.startPosition, step.targetPosition, ratio);
    if (step.mesh?.position) {
      step.mesh.position.set(pos.x, pos.y, pos.z);
    }
    const world = this._lerp3(step.startWorld, step.targetWorld, ratio);
    this._updateTokenWorldDuringMovement(step.tokenEntry, world);
    return step.traveled >= step.totalDistance - 1e-5;
  }

  _lockStepAtTarget(state) {
    const step = state.activeStep;
    if (!step) return;
    if (step.mesh?.position) {
      step.mesh.position.set(step.targetPosition.x, step.targetPosition.y, step.targetPosition.z);
    }
    this._updateTokenWorldDuringMovement(step.tokenEntry, step.targetWorld);
    step.traveled = step.totalDistance;
    state.stepFinalized = true;
    const token = step.tokenEntry;
    token.gridX = step.gridTargetX;
    token.gridY = step.gridTargetY;
    token.world = { ...step.targetWorld };
  }

  _triggerStop(state) {
    if (state.stopTriggered) return;
    state.intentHold = false;
    state.pendingStop = false;
    state.stopTriggered = true;
    state.phase = 'stop';
    state.stopElapsed = 0;
    state.stopMovementElapsed = 0;

    const step = state.activeStep;
    const remainingDistance = step ? Math.max(0, step.totalDistance - step.traveled) : 0;
    state.stopMovementTime = Math.min(
      Math.max(state.profile.stopMovementDuration || 0, 0),
      state.profile.stopClipDuration || 0
    );
    if (state.stopMovementTime > 0 && remainingDistance > 0) {
      state.stopSpeed = remainingDistance / state.stopMovementTime;
    } else {
      state.stopSpeed = 0;
      if (step && !state.stepFinalized) {
        this._lockStepAtTarget(state);
      }
    }

    const animationData = this._tokenAnimationData.get(state.token);
    if (!animationData?.actions?.walkStop) {
      this._setAnimation(state.token, 'idle', {
        fadeIn: state.profile.idleFadeIn,
        fadeOut: state.profile.walkFadeOut,
      });
      this._finishStopState(state);
      return;
    }

    this._setAnimation(state.token, 'walkStop', {
      fadeIn: state.profile.stopFadeIn,
      fadeOut: state.profile.stopFadeOut,
    });
  }

  _finishWalkState(state) {
    this._movementStates.delete(state.token);
    this._setAnimation(state.token, 'idle', {
      fadeIn: state.profile.idleFadeIn,
      fadeOut: state.profile.walkFadeOut,
    });
  }

  _finishStopState(state) {
    this._movementStates.delete(state.token);
    if (!state.stopBlendedToIdle) {
      this._setAnimation(state.token, 'idle', {
        fadeIn: state.profile.idleFadeIn,
        fadeOut: state.profile.stopFadeOut,
      });
    }
  }

  _createForwardMovementStep(tokenEntry, mesh) {
    try {
      const gm = this.gameManager;
      if (!gm?.spatial) return null;
      const rawGridX = Number.isFinite(tokenEntry.gridX) ? tokenEntry.gridX : 0;
      const rawGridY = Number.isFinite(tokenEntry.gridY) ? tokenEntry.gridY : 0;
      const startGridX = Math.round(rawGridX);
      const startGridY = Math.round(rawGridY);
      const yaw = this._getMovementYaw(tokenEntry);
      const { stepX, stepY } = this._getForwardGridDelta(yaw);
      if (stepX === 0 && stepY === 0) return null;

      const targetGridX = startGridX + stepX;
      const targetGridY = startGridY + stepY;

      const startHeight = this._getTerrainHeight(startGridX, startGridY);
      const targetHeight = this._getTerrainHeight(targetGridX, targetGridY);

      const startWorld = tokenEntry.world
        ? { ...tokenEntry.world }
        : gm.spatial.gridToWorld(startGridX + 0.5, startGridY + 0.5, startHeight);
      const targetWorld = gm.spatial.gridToWorld(
        targetGridX + 0.5,
        targetGridY + 0.5,
        targetHeight
      );

      const startPosition = this._composeMeshPosition(startWorld, mesh);
      const targetPosition = this._composeMeshPosition(targetWorld, mesh);

      const dx = targetPosition.x - startPosition.x;
      const dy = targetPosition.y - startPosition.y;
      const dz = targetPosition.z - startPosition.z;
      const totalDistance = Math.hypot(dx, dy, dz);
      if (!(totalDistance > 0.001)) return null;

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
      };
    } catch (_) {
      return null;
    }
  }

  _composeMeshPosition(world, mesh) {
    const baseOffset = mesh?.userData?.__ttVerticalBase || 0;
    return {
      x: world?.x ?? 0,
      y: (world?.y ?? 0) + this._verticalBias + baseOffset,
      z: world?.z ?? 0,
    };
  }

  _getMovementYaw(tokenEntry) {
    const tau = Math.PI * 2;
    const rawFacing = Number.isFinite(tokenEntry?.facingAngle) ? tokenEntry.facingAngle : 0;
    const normalizedFacing = ((rawFacing % tau) + tau) % tau;
    return (tau - normalizedFacing + Math.PI / 2) % tau;
  }

  _getFacingYaw(mesh) {
    try {
      if (mesh?.rotation && typeof mesh.rotation.y === 'number') return mesh.rotation.y;
    } catch (_) {
      /* ignore */
    }
    return 0;
  }

  _getForwardGridDelta(yaw) {
    const rawX = Math.sin(yaw);
    const rawY = -Math.cos(yaw);
    let stepX = Math.round(rawX);
    let stepY = Math.round(rawY);
    if (stepX === 0 && Math.abs(rawX) > 0.2) stepX = rawX > 0 ? 1 : -1;
    if (stepY === 0 && Math.abs(rawY) > 0.2) stepY = rawY > 0 ? 1 : -1;
    if (stepX === 0 && stepY === 0) {
      stepY = -1;
    }
    return { stepX, stepY };
  }

  _getTerrainHeight(gx, gy) {
    try {
      const gm = this.gameManager;
      if (gm?.getTerrainHeight) {
        const h = gm.getTerrainHeight(gx, gy);
        if (Number.isFinite(h)) return h;
      }
    } catch (_) {
      /* ignore */
    }
    return 0;
  }

  _lerp3(a, b, t) {
    const ratio = Math.min(Math.max(t, 0), 1);
    return {
      x: (a?.x ?? 0) + ((b?.x ?? 0) - (a?.x ?? 0)) * ratio,
      y: (a?.y ?? 0) + ((b?.y ?? 0) - (a?.y ?? 0)) * ratio,
      z: (a?.z ?? 0) + ((b?.z ?? 0) - (a?.z ?? 0)) * ratio,
    };
  }

  _updateTokenWorldDuringMovement(tokenEntry, world) {
    if (!tokenEntry || !world) return;
    tokenEntry.world = { x: world.x, y: world.y, z: world.z };
  }

  setVerticalBias(v) {
    if (!Number.isFinite(v)) return;
    this._verticalBias = v;
    this.resyncHeights();
  }

  resyncHeights() {
    try {
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const tokens = gm.placedTokens || [];
      for (const t of tokens) {
        const mesh = t.__threeMesh;
        if (!mesh) continue;
        this._positionMesh(mesh, t);
      }
    } catch (_) {
      /* ignore */
    }
  }

  onTokenRemoved(tokenEntry) {
    if (!tokenEntry || !tokenEntry.__threeMesh) return;
    const mesh = tokenEntry.__threeMesh;
    if (this._hoverToken === tokenEntry) this._hoverToken = null;
    if (this._selectedToken === tokenEntry) this._selectedToken = null;
    this._discardSelectionIndicator(tokenEntry);

    const mixer = this._animationMixers.get(tokenEntry);
    if (mixer) {
      try {
        mixer.stopAllAction();
      } catch (_) {
        /* ignore */
      }
      this._animationMixers.delete(tokenEntry);
    }

    this._rootBones.delete(tokenEntry);
    this._movementStates.delete(tokenEntry);
    this._tokenAnimationData.delete(tokenEntry);

    const gm = this.gameManager;
    const scene = gm?.threeSceneManager?.scene;
    if (scene && typeof scene.remove === 'function') {
      try {
        scene.remove(mesh);
      } catch (_) {
        /* ignore */
      }
    }

    try {
      mesh.traverse?.((child) => {
        if (child.geometry && typeof child.geometry.dispose === 'function') {
          child.geometry.dispose();
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((mat) => {
            if (mat && typeof mat.dispose === 'function') {
              mat.dispose();
            }
          });
        }
      });
    } catch (_) {
      /* ignore */
    }

    try {
      mesh.geometry && typeof mesh.geometry.dispose === 'function' && mesh.geometry.dispose();
    } catch (_) {
      /* ignore */
    }
    try {
      mesh.material && typeof mesh.material.dispose === 'function' && mesh.material.dispose();
    } catch (_) {
      /* ignore */
    }

    delete tokenEntry.__threeMesh;
    delete tokenEntry.__threeMeshPromise;
  }

  _createMaterialForToken(three, tokenEntry) {
    try {
      const sprite = tokenEntry?.creature?.sprite;
      const bt = sprite?.texture?.baseTexture;
      const src = bt?.resource?.source || bt?.resource;
      if (src && (src instanceof HTMLImageElement || src instanceof HTMLCanvasElement)) {
        const tex = new three.Texture(src);
        tex.needsUpdate = true;
        return new three.MeshBasicMaterial({
          map: tex,
          transparent: true,
          alphaTest: 0.05,
          depthWrite: false,
          side: three.DoubleSide,
        });
      }
      if (sprite && typeof document !== 'undefined') {
        const w = Math.max(1, sprite.width || 64);
        const h = Math.max(1, sprite.height || 64);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx && src) {
          ctx.drawImage(src, 0, 0, w, h);
          const tex = new three.Texture(canvas);
          tex.needsUpdate = true;
          return new three.MeshBasicMaterial({
            map: tex,
            transparent: true,
            alphaTest: 0.05,
            depthWrite: false,
            side: three.DoubleSide,
          });
        }
      }
    } catch (_) {
      /* ignore and fallback */
    }
    return new three.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: three.DoubleSide,
    });
  }

  _syncFacingDirection() {
    const gm = this.gameManager;
    if (!gm || !gm.is3DModeActive?.()) return;
    const facingRight = this._getGlobalFacingRight();
    if (facingRight === this._lastFacingRight) return;
    this._lastFacingRight = facingRight;
    try {
      const tokens = gm.placedTokens || [];
      for (const token of tokens) {
        this.updateTokenOrientation(token);
      }
    } catch (_) {
      /* ignore */
    }
  }

  getSelectedToken() {
    return this._selectedToken || null;
  }

  setHoverToken(tokenEntry) {
    if (this._hoverToken === tokenEntry) return;
    const previous = this._hoverToken;
    this._hoverToken = tokenEntry || null;
    if (previous) this._refreshVisualState(previous);
    if (tokenEntry) this._refreshVisualState(tokenEntry);
  }

  setSelectedToken(tokenEntry) {
    if (this._selectedToken === tokenEntry) return;
    const previous = this._selectedToken;
    this._selectedToken = tokenEntry || null;
    if (previous) {
      this._refreshVisualState(previous);
    }
    if (tokenEntry) {
      this._refreshVisualState(tokenEntry);
    }
  }

  updateTokenOrientation(tokenEntry) {
    if (!tokenEntry) return;
    const normalized = this._normalizeAngle(
      Number.isFinite(tokenEntry.facingAngle) ? tokenEntry.facingAngle : 0
    );
    tokenEntry.facingAngle = normalized;

    const mesh = tokenEntry.__threeMesh;
    const globalFlip = this._getGlobalFacingRight() ? 0 : Math.PI;

    if (mesh && mesh.userData?.__tt3DToken) {
      const baseYaw = mesh.userData.__ttBaseYaw || 0;
      const yaw = baseYaw + globalFlip + normalized;
      try {
        if (mesh.rotation) {
          mesh.rotation.y = yaw;
        } else {
          mesh.rotation = { y: yaw };
        }
      } catch (_) {
        /* ignore mesh rotation errors */
      }
      return;
    }

    if (mesh) {
      this._applyBillboardFacing(mesh, globalFlip);
    }

    try {
      const sprite = tokenEntry?.creature?.sprite;
      if (sprite) {
        const sign = globalFlip === 0 ? 1 : -1;
        if (sprite.scale && typeof sprite.scale.x === 'number') {
          const absX = Math.abs(sprite.scale.x || 1);
          sprite.scale.x = sign * absX;
        }
        if (typeof sprite.rotation === 'number') {
          sprite.rotation = normalized;
        }
      }
    } catch (_) {
      /* ignore sprite orientation errors */
    }
  }

  _applyBillboardFacing(mesh, globalFlip) {
    if (!mesh) return;
    const facingRight = globalFlip === 0;
    const sign = facingRight ? 1 : -1;
    if (!mesh.scale) mesh.scale = { x: sign, y: 1, z: 1 };
    mesh.scale.x = sign * Math.abs(mesh.scale.x || 1);
  }

  _getGlobalFacingRight() {
    const gm = this.gameManager;
    try {
      if (gm?.tokenManager?.getTokenFacingRight) {
        return !!gm.tokenManager.getTokenFacingRight();
      }
      if (typeof gm?.tokenManager?.tokenFacingRight === 'boolean') {
        return !!gm.tokenManager.tokenFacingRight;
      }
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  _normalizeAngle(angle) {
    if (!Number.isFinite(angle)) return 0;
    const tau = Math.PI * 2;
    let normalized = angle;
    while (normalized <= -Math.PI) normalized += tau;
    while (normalized > Math.PI) normalized -= tau;
    return normalized;
  }

  clearHighlights() {
    this.setHoverToken(null);
    this.setSelectedToken(null);
  }

  async _showSelectionIndicator(tokenEntry) {
    try {
      const marker = await this._ensureSelectionIndicator(tokenEntry);
      if (marker) marker.visible = true;
    } catch (_) {
      /* ignore */
    }
  }

  _hideSelectionIndicator(tokenEntry) {
    try {
      const marker = tokenEntry?.__ttSelectionIndicator;
      if (marker) marker.visible = false;
    } catch (_) {
      /* ignore */
    }
  }

  _discardSelectionIndicator(tokenEntry) {
    try {
      const marker = tokenEntry?.__ttSelectionIndicator;
      if (marker) {
        marker.visible = false;
        if (marker.parent && typeof marker.parent.remove === 'function') {
          marker.parent.remove(marker);
        }
        if (marker.geometry?.dispose) marker.geometry.dispose();
        if (marker.material?.dispose) marker.material.dispose();
      }
      delete tokenEntry.__ttSelectionIndicator;
    } catch (_) {
      /* ignore */
    }
  }

  async _ensureSelectionIndicator(tokenEntry) {
    if (!tokenEntry || !tokenEntry.__threeMesh) return null;
    if (!tokenEntry.__threeMesh.userData?.__tt3DToken) return null;
    if (tokenEntry.__ttSelectionIndicator) return tokenEntry.__ttSelectionIndicator;
    const three = await this._getThree();
    if (!three) return null;
    try {
      const inner = 0.34;
      const outer = 0.47;
      const geometry = new three.RingGeometry(inner, outer, 48);
      const material = new three.MeshBasicMaterial({
        color: this._selectionColor,
        transparent: true,
        opacity: 0.55,
        depthWrite: false,
        side: three.DoubleSide,
      });
      const ring = new three.Mesh(geometry, material);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.02;
      ring.name = 'TokenSelectionIndicator';
      if (typeof tokenEntry.__threeMesh.add === 'function') {
        tokenEntry.__threeMesh.add(ring);
      }
      tokenEntry.__ttSelectionIndicator = ring;
      return ring;
    } catch (_) {
      return null;
    }
  }

  _refreshVisualState(tokenEntry) {
    const mesh = tokenEntry?.__threeMesh;
    if (!mesh) return;
    const is3DToken = !!mesh.userData?.__tt3DToken;

    if (this._selectedToken === tokenEntry) {
      this._restoreMaterial(mesh);
      if (is3DToken) {
        void this._showSelectionIndicator(tokenEntry);
      } else {
        this._hideSelectionIndicator(tokenEntry);
        this._applyTint(mesh, this._selectionColor);
      }
      return;
    }

    if (this._hoverToken === tokenEntry) {
      this._restoreMaterial(mesh);
      if (is3DToken) {
        this._hideSelectionIndicator(tokenEntry);
      } else {
        this._applyTint(mesh, 0x88ccff);
        this._hideSelectionIndicator(tokenEntry);
      }
      return;
    }

    this._restoreMaterial(mesh);
    this._hideSelectionIndicator(tokenEntry);
  }

  _applyTint(mesh, colorHex) {
    if (!mesh) return;
    const mats = mesh.userData?.__ttTintMaterials || this._collectTintTargets(mesh);
    mesh.userData = mesh.userData || {};
    mesh.userData.__ttTintMaterials = mats;
    if (!mats || !mats.length) return;
    for (const mat of mats) {
      if (!mat) continue;
      if (!this._originalMaterials.has(mat)) {
        this._originalMaterials.set(mat, {
          color: mat.color?.clone?.() || null,
          emissive: mat.emissive?.clone?.() || null,
        });
      }
      try {
        if (mat.color) mat.color.setHex(colorHex);
        if (mat.emissive) mat.emissive.setHex(colorHex);
        mat.needsUpdate = true;
      } catch (_) {
        /* ignore */
      }
    }
  }

  _restoreMaterial(mesh) {
    if (!mesh) return;
    const mats = mesh.userData?.__ttTintMaterials || [];
    for (const mat of mats) {
      if (!mat) continue;
      const snap = this._originalMaterials.get(mat);
      if (!snap) continue;
      try {
        if (snap.color && mat.color) mat.color.copy(snap.color);
        if (snap.emissive && mat.emissive) mat.emissive.copy(snap.emissive);
        mat.needsUpdate = true;
      } catch (_) {
        /* ignore */
      }
    }
  }

  _collectTintTargets(mesh) {
    const materials = [];
    if (!mesh) return materials;
    const push = (mat) => {
      if (!mat) return;
      if (Array.isArray(mat)) {
        mat.forEach(push);
      } else {
        materials.push(mat);
      }
    };
    if (typeof mesh.traverse === 'function') {
      mesh.traverse((child) => {
        if (child.material) push(child.material);
      });
    } else if (mesh.material) {
      push(mesh.material);
    }
    return materials;
  }

  async _getThree() {
    if (this._threePromise) return this._threePromise;
    if (this.gameManager?.threeSceneManager?.three) {
      this._threePromise = Promise.resolve(this.gameManager.threeSceneManager.three);
      return this._threePromise;
    }
    this._threePromise = import('three').then((mod) => mod.default || mod).catch(() => null);
    return this._threePromise;
  }

  async _getFBXLoaderCtor() {
    if (!this._fbxCtorPromise) {
      this._fbxCtorPromise = (async () => {
        try {
          const mod = await import('three/examples/jsm/loaders/FBXLoader.js');
          return mod.FBXLoader || mod.default || null;
        } catch (_) {
          if (typeof window !== 'undefined' && window.FBXLoader) return window.FBXLoader;
          if (typeof globalThis !== 'undefined' && globalThis.FBXLoader) {
            return globalThis.FBXLoader;
          }
          return null;
        }
      })();
    }
    return this._fbxCtorPromise;
  }

  async _getSkeletonUtils() {
    if (!this._skeletonUtilsPromise) {
      this._skeletonUtilsPromise = (async () => {
        try {
          const mod = await import('three/examples/jsm/utils/SkeletonUtils.js');
          if (mod.SkeletonUtils) return mod.SkeletonUtils;
          if (typeof mod.clone === 'function') return mod;
          if (mod.default && typeof mod.default.clone === 'function') return mod.default;
        } catch (_) {
          /* ignore */
        }
        return null;
      })();
    }
    return this._skeletonUtilsPromise;
  }

  _buildPathVariants(path) {
    const base = String(path || '').replace(/\\/g, '/');
    const variants = [];
    const push = (p) => {
      if (!p || variants.includes(p)) return;
      variants.push(p);
    };
    push(base);
    if (!base.startsWith('./')) push(`./${base}`);
    if (!base.startsWith('/')) push(`/${base}`);
    if (base.includes(' ')) push(base.replace(/ /g, '%20'));
    variants.slice().forEach((v) => {
      if (v.includes(' ')) push(v.replace(/ /g, '%20'));
    });
    return variants;
  }

  async _loadModelTemplate(typeKey, config) {
    const key = typeKey?.toLowerCase?.();
    if (!key) return null;
    if (!this._modelCache.has(key)) {
      const promise = (async () => {
        const three = await this._getThree();
        const FBXLoaderCtor = await this._getFBXLoaderCtor();
        if (!three || !FBXLoaderCtor) return null;
        const variants = this._buildPathVariants(config.path);
        let loaded = null;
        for (const url of variants) {
          try {
            const loader = new FBXLoaderCtor();
            loaded = await this._loadFBX(loader, url);
            if (loaded) break;
          } catch (_) {
            /* try next */
          }
        }
        if (!loaded) return null;
        const templateRoot = new three.Group();
        templateRoot.name = `TokenTemplate:${key}`;
        templateRoot.add(loaded);

        const centerBox = new three.Box3().setFromObject(templateRoot);
        const center = new three.Vector3();
        centerBox.getCenter(center);
        loaded.position.sub(center);

        const groundedBox = new three.Box3().setFromObject(templateRoot);
        const minY = groundedBox.min.y;
        loaded.position.y -= minY;

        const sizeBox = new three.Box3().setFromObject(templateRoot);
        const size = new three.Vector3();
        sizeBox.getSize(size);
        const tileSize = this.gameManager?.spatial?.tileWorldSize || 1;
        const span = (config.tileSpan ?? 1) * tileSize;
        const margin = Number.isFinite(config.margin) ? config.margin : 0.92;
        const desired = span * margin;
        const maxXZ = Math.max(size.x, size.z, 0.0001);
        let scaleFactor = config.scale;
        if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) {
          scaleFactor = desired / maxXZ;
        }
        templateRoot.scale.setScalar(scaleFactor);
        templateRoot.updateMatrixWorld(true);

        return {
          template: templateRoot,
          animations: Array.isArray(loaded.animations) ? loaded.animations : [],
        };
      })();
      this._modelCache.set(key, promise);
    }
    return this._modelCache.get(key);
  }

  _loadFBX(loader, url) {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (obj) => {
        if (settled) return;
        settled = true;
        resolve(obj || null);
      };
      try {
        loader.load(
          url,
          (object) => finish(object),
          undefined,
          () => finish(null)
        );
      } catch (_) {
        finish(null);
      }
    });
  }

  async _cloneTemplate(template) {
    if (!template) return null;
    try {
      const SkeletonUtils = await this._getSkeletonUtils();
      if (SkeletonUtils?.clone) {
        return SkeletonUtils.clone(template);
      }
    } catch (_) {
      /* fall through */
    }
    try {
      return template.clone(true);
    } catch (_) {
      return null;
    }
  }

  _applyCommonMetadata(mesh, tokenEntry, options = {}) {
    const type = tokenEntry?.type || tokenEntry?.creature?.type || 'unk';
    mesh.name = mesh.name || `Token3D:${tokenEntry?.id || type}`;
    mesh.userData = mesh.userData || {};
    const billboard = options.billboard !== false;
    mesh.userData.__ttBillboard = billboard;
    mesh.userData.__tt3DToken = !!options.is3D;
    mesh.userData.__ttVerticalBase = Number.isFinite(options.verticalOffset)
      ? options.verticalOffset
      : 0;
    mesh.userData.__ttBaseYaw = Number.isFinite(options.baseYaw) ? options.baseYaw : 0;
    mesh.userData.__ttTokenType = type;
    mesh.userData.__ttTintMaterials = this._collectTintTargets(mesh);
    return mesh;
  }

  _positionMesh(mesh, tokenEntry) {
    try {
      const gm = this.gameManager;
      if (!gm || !gm.spatial) return;
      const activeState = this._movementStates?.get?.(tokenEntry);
      if (activeState?.activeStep && !activeState.stepFinalized) {
        return;
      }
      const storedWorld = tokenEntry?.world;
      const gx = tokenEntry.gridX ?? 0;
      const gy = tokenEntry.gridY ?? 0;
      let worldX;
      let worldZ;
      let worldY;

      if (
        storedWorld &&
        Number.isFinite(storedWorld.x) &&
        Number.isFinite(storedWorld.y) &&
        Number.isFinite(storedWorld.z)
      ) {
        worldX = storedWorld.x;
        worldY = storedWorld.y;
        worldZ = storedWorld.z;
      } else {
        const fallback = gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, 0);
        worldX = fallback.x;
        worldZ = fallback.z;
      }

      let terrainWorldY;
      try {
        const elevation = gm.getTerrainHeight?.(gx, gy);
        if (Number.isFinite(elevation)) {
          terrainWorldY = elevation * gm.spatial.elevationUnit;
        }
      } catch (_) {
        terrainWorldY = undefined;
      }

      if (Number.isFinite(terrainWorldY)) {
        worldY = terrainWorldY;
      }

      if (!Number.isFinite(worldY)) {
        worldY = 0;
      }

      const baseOffset = mesh.userData?.__ttVerticalBase || 0;
      mesh.position.set(worldX, worldY + this._verticalBias + baseOffset, worldZ);
    } catch (_) {
      /* ignore */
    }
  }
}
