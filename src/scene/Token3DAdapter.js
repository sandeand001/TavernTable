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
    walkBackward: {
      path: 'assets/animated-sprites/Walk Backward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    run: {
      path: 'assets/animated-sprites/running.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    runBackward: {
      path: 'assets/animated-sprites/Run Backward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    sprint: {
      path: 'assets/animated-sprites/Sprint.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    runStop: {
      path: 'assets/animated-sprites/run to stop.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    drunkWalk: {
      path: 'assets/animated-sprites/drunk walk.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    drunkWalkBackward: {
      path: 'assets/animated-sprites/drunk walk backwards.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    drunkRunForward: {
      path: 'assets/animated-sprites/drunk run forward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    drunkRunBackward: {
      path: 'assets/animated-sprites/drunk run backward.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    fall: {
      path: 'assets/animated-sprites/Falling To Landing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    hardLanding: {
      path: 'assets/animated-sprites/hard landing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    fallLoop: {
      path: 'assets/animated-sprites/falling idle.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
  },
  movementProfile: {
    startMoveDelay: 1,
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
    fallFadeIn: 0.08,
    fallFadeOut: 0.12,
    fallLoopFadeIn: 0.08,
    fallLoopFadeOut: 0.12,
    fallLoopVerticalSpeed: 9,
    fallLoopMinDuration: 0.24,
    fallLoopMaxDuration: 1.2,
    fallLoopTimeScale: 4.5,
    runSpeedMultiplier: 1.7,
    drunkWalkSpeedMultiplier: 0.65,
    drunkRunSpeedMultiplier: 1.35,
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
  fallFadeIn: 0.1,
  fallFadeOut: 0.12,
  fallLoopFadeIn: 0.1,
  fallLoopFadeOut: 0.12,
  fallLoopVerticalSpeed: 6.75,
  fallLoopMinDuration: 0.27,
  fallLoopMaxDuration: 1.33,
  fallLoopTimeScale: 4.5,
};

const DEFAULT_FALL_TRIGGER_PROGRESS = 0.38;
const DEFAULT_HEIGHT_SNAP_PROGRESS = 0.62;
const HARD_LANDING_HEIGHT_THRESHOLD = 8;
const CONTINUOUS_ROTATION_SPEED = Math.PI;
const SPRINT_THRESHOLD_SECONDS = 3;
const SPRINT_SPEED_MULTIPLIER = 1.15;
const SPRINT_LEAN_RADIANS = 0;
const PATH_NAVIGATION_KEY = '__path_nav';
const PATH_SPEED_WALK_MAX = 3;
const PATH_SPEED_RUN_MAX = 6;
const PATH_SPEED_DEFAULT_TOLERANCE = 0.35;
const PATH_SPEED_MODES = {
  WALK: 'walk',
  RUN: 'run',
  SPRINT: 'sprint',
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
    this._modifiers = { shift: false };
    this._raycastScratch = [];
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

      container.userData = container.userData || {};
      container.userData.__ttBaseRotation = {
        x: container.rotation.x,
        y: container.rotation.y,
        z: container.rotation.z,
      };

      container.userData.__ttBaseRotation = {
        x: container.rotation.x,
        y: container.rotation.y,
        z: container.rotation.z,
      };

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
        const baseQuaternion = child.quaternion?.clone?.() || null;
        roots.push({ bone: child, basePosition, baseQuaternion });
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
      const baseQuat = info.baseQuaternion;
      if (baseQuat && bone.quaternion && typeof bone.quaternion.copy === 'function') {
        bone.quaternion.copy(baseQuat);
      } else if (
        baseQuat &&
        bone.rotation &&
        typeof bone.rotation.setFromQuaternion === 'function'
      ) {
        bone.rotation.setFromQuaternion(baseQuat);
      }
    }
  }

  _ensureMovementState(tokenEntry) {
    if (!tokenEntry) return null;
    let state = this._movementStates.get(tokenEntry);
    const mesh = tokenEntry.__threeMesh;
    const animationData = this._tokenAnimationData.get(tokenEntry);
    if (state && (!mesh || state.mesh !== mesh)) {
      state = null;
    }
    if (!state) {
      if (!mesh || !animationData) return null;
      state = {
        token: tokenEntry,
        mesh,
        profile: animationData.profile || DEFAULT_MOVEMENT_PROFILE,
        phase: 'idle',
        phaseElapsed: 0,
        activeStep: null,
        stepFinalized: true,
        hasLoopStarted: false,
        pendingFacingAngle: undefined,
        forwardKeys: new Set(),
        backwardKeys: new Set(),
        rotationLeftKeys: new Set(),
        rotationRightKeys: new Set(),
        movementSign: 0,
        lastMoveSign: 0,
        intentHold: false,
        pendingStop: false,
        stopTriggered: false,
        stopElapsed: 0,
        stopMovementElapsed: 0,
        stopMovementTime: 0,
        stopSpeed: 0,
        stopBlendedToIdle: false,
        stopMovementDuration: 0,
        freeStartWorld: null,
        freeLastWorld: null,
        freeDistance: 0,
        lastMoveSpeed: 0,
        rotationDirection: 0,
        rotationSpeed: CONTINUOUS_ROTATION_SPEED,
        fallMode: null,
        fallSpeed: 0,
        fallDuration: 0,
        fallLandingKey: null,
        fallLandingDuration: 0,
        fallLandingThreshold: 0,
        runDuration: 0,
        isSprinting: false,
        movementStyle: 'standard',
        isRunning: false,
        loopActionKey: 'walk',
        startActionKey: null,
        stopActionKey: null,
        startDuration: 0,
        loopDuration: 0,
        stopDuration: 0,
        startMoveDelay:
          animationData.profile?.startMoveDelay ?? DEFAULT_MOVEMENT_PROFILE.startMoveDelay,
        startBlendLead:
          animationData.profile?.startToWalkBlendLead ??
          DEFAULT_MOVEMENT_PROFILE.startToWalkBlendLead,
        stopBlendLead:
          animationData.profile?.stopBlendLead ?? DEFAULT_MOVEMENT_PROFILE.stopBlendLead,
        activeSpeed: animationData.profile?.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed,
        activeDirectionSign: 1,
        stopTravelPortionCurrent:
          animationData.profile?.stopTravelPortion ?? DEFAULT_MOVEMENT_PROFILE.stopTravelPortion,
        pathActive: false,
        pathGoal: null,
        pathSpeedMode: null,
        pathKey: null,
        pathTolerance: 0,
        pathReached: false,
      };
      this._movementStates.set(tokenEntry, state);
    } else if (!state.profile || state.profile === DEFAULT_MOVEMENT_PROFILE) {
      state.profile = animationData.profile || DEFAULT_MOVEMENT_PROFILE;
    }
    return state;
  }

  _recalculateMovementIntent(state) {
    if (!state) return 0;
    const forwardActive = state.forwardKeys?.size > 0;
    const backwardActive = state.backwardKeys?.size > 0;
    if (forwardActive && backwardActive) return 0;
    if (forwardActive) return 1;
    if (backwardActive) return -1;
    return 0;
  }

  _computeRotationIntent(state) {
    if (!state) return 0;
    const rightActive = state.rotationRightKeys?.size > 0;
    const leftActive = state.rotationLeftKeys?.size > 0;
    if (rightActive && leftActive) return 0;
    if (rightActive) return 1;
    if (leftActive) return -1;
    return 0;
  }

  _captureMovementStyleSnapshot(state) {
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

  _movementStyleSnapshotEquals(previous, state) {
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

  _resolveAvailableActionKey(tokenEntry, key, fallback) {
    const data = this._tokenAnimationData.get(tokenEntry);
    if (key && data?.actions?.[key]) return key;
    if (fallback && data?.actions?.[fallback]) return fallback;
    return null;
  }

  _getActionDuration(tokenEntry, actionKey) {
    if (!actionKey) return 0;
    const data = this._tokenAnimationData.get(tokenEntry);
    if (!data?.actions?.[actionKey]) return 0;
    return this._extractClipDuration(data.actions[actionKey]) || 0;
  }

  _playLoopAnimation(state, options = {}) {
    if (!state) return;
    const key = state.loopActionKey || 'walk';
    const data = this._tokenAnimationData.get(state.token);
    if (!data?.actions?.[key]) return;
    const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
    this._setAnimation(state.token, key, {
      fadeIn: options.fadeIn ?? profile.walkFadeIn,
      fadeOut: options.fadeOut ?? profile.walkFadeOut,
      force: options.force ?? false,
    });
  }

  _setHasKey(set, key) {
    if (!set || !key) return false;
    try {
      return set.has(key);
    } catch (_) {
      return false;
    }
  }

  _findFirstSkinnedMesh(root) {
    if (!root) return null;
    if (root.isSkinnedMesh) return root;
    if (Array.isArray(root.children)) {
      for (const child of root.children) {
        const found = this._findFirstSkinnedMesh(child);
        if (found) return found;
      }
    }
    return null;
  }

  _applySprintLean(state) {
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

  _isSprintEligible(state) {
    if (!state?.token) return false;
    const typeKey = (state.token.type || state.token.creature?.type || '').toLowerCase();
    if (typeKey !== 'female-humanoid' && typeKey !== 'defeated-doll') return false;
    const data = this._tokenAnimationData.get(state.token);
    if (!data?.actions?.sprint) return false;
    return state.movementStyle === 'standard';
  }

  _resetSprintState(state) {
    if (!state) return;
    state.runDuration = 0;
    state.isSprinting = false;
    if (state.mesh) {
      this._applySprintLean(state);
    }
  }

  _updateRunningDuration(state, delta, directionSign) {
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

  _updateMovementFlags(state, directionOverride) {
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

  _handleMovementStyleChange(state, previousSnapshot, options = {}) {
    if (!state) return;
    const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
    const styleChanged =
      options.force || !this._movementStyleSnapshotEquals(previousSnapshot, state);
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

  _syncMovementVariant(state, directionOverride, options = {}) {
    if (!state) return;
    const snapshot = this._captureMovementStyleSnapshot(state);
    this._updateMovementFlags(state, directionOverride);
    this._handleMovementStyleChange(state, snapshot, options);
  }

  _startMovementPhase(state, newSign) {
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
    state.freeLastWorld = state.freeStartWorld ? { ...state.freeStartWorld } : null;
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
  }

  _abortStopPhase(state) {
    if (!state || state.phase !== 'stop') return;
    state.phase = 'walk';
    state.activeStep = null;
    state.stopTriggered = false;
    state.pendingStop = false;
    state.stepFinalized = false;
    state.stopBlendedToIdle = false;
  }

  _resolveTokenWorldPosition(tokenEntry) {
    if (!tokenEntry) return { x: 0, y: 0, z: 0 };
    try {
      const world = tokenEntry.world;
      if (world && Number.isFinite(world.x) && Number.isFinite(world.z)) {
        const y = Number.isFinite(world.y) ? world.y : 0;
        return { x: world.x, y, z: world.z };
      }
      const gm = this.gameManager;
      const rawX = Number.isFinite(tokenEntry.gridX) ? tokenEntry.gridX : 0;
      const rawY = Number.isFinite(tokenEntry.gridY) ? tokenEntry.gridY : 0;
      const gx = Math.round(rawX);
      const gy = Math.round(rawY);
      const height = this._getTerrainHeight(gx, gy);
      if (gm?.spatial?.gridToWorld) {
        return gm.spatial.gridToWorld(gx + 0.5, gy + 0.5, height);
      }
      return { x: gx, y: height, z: gy };
    } catch (_) {
      return { x: 0, y: 0, z: 0 };
    }
  }

  _computeMovementBounds() {
    try {
      const gm = this.gameManager;
      const tile = gm?.spatial?.tileWorldSize || 1;
      const cols = Number.isFinite(gm?.cols) ? gm.cols : null;
      const rows = Number.isFinite(gm?.rows) ? gm.rows : null;
      const minX = cols != null ? tile * 0.5 : -Infinity;
      const maxX = cols != null ? tile * (cols - 0.5) : Infinity;
      const minZ = rows != null ? tile * 0.5 : -Infinity;
      const maxZ = rows != null ? tile * (rows - 0.5) : Infinity;
      return { minX, maxX, minZ, maxZ, tileSize: tile };
    } catch (_) {
      return { minX: -Infinity, maxX: Infinity, minZ: -Infinity, maxZ: Infinity, tileSize: 1 };
    }
  }

  _getDirectionalVectorFromYaw(yaw, directionSign = 1) {
    if (!Number.isFinite(yaw) || directionSign === 0) {
      return { x: 0, z: 0 };
    }
    const sign = directionSign >= 0 ? 1 : -1;
    const x = Math.sin(yaw) * sign;
    const z = -Math.cos(yaw) * sign;
    const mag = Math.hypot(x, z) || 1;
    return { x: x / mag, z: z / mag };
  }

  _sampleWorldHeight(x, z, fallbackY = 0) {
    try {
      const gm = this.gameManager;
      const spatial = gm?.spatial;
      if (!spatial) return fallbackY;

      const tileSize =
        Number.isFinite(spatial.tileWorldSize) && spatial.tileWorldSize > 0
          ? spatial.tileWorldSize
          : 1;

      const gridX = Math.floor(x / tileSize);
      const gridY = Math.floor(z / tileSize);
      const heightLevel = this._getTerrainHeight(gridX, gridY);
      if (!Number.isFinite(heightLevel)) {
        return fallbackY;
      }

      if (typeof spatial.elevationToWorldY === 'function') {
        return spatial.elevationToWorldY(heightLevel);
      }

      const unit = Number.isFinite(spatial.elevationUnit) ? spatial.elevationUnit : 1;
      return heightLevel * unit;
    } catch (_) {
      return fallbackY;
    }
  }

  _estimateHeightFromWorld(worldY, gridX, gridY) {
    if (Number.isFinite(worldY)) {
      try {
        const gm = this.gameManager;
        const unit = Number.isFinite(gm?.spatial?.elevationUnit) ? gm.spatial.elevationUnit : 1;
        if (unit > 0) {
          return worldY / unit;
        }
      } catch (_) {
        /* ignore */
      }
    }
    return this._getTerrainHeight(gridX, gridY);
  }

  _isGridWithinBounds(gx, gy) {
    const gm = this.gameManager;
    if (Number.isFinite(gm?.cols) && (gx < 0 || gx >= gm.cols)) return false;
    if (Number.isFinite(gm?.rows) && (gy < 0 || gy >= gm.rows)) return false;
    return true;
  }

  _advanceRotationState(state, delta) {
    if (!state || !(delta > 0)) return;
    const intent = this._computeRotationIntent(state);
    if (intent === 0) {
      state.rotationDirection = 0;
      if (state.phase === 'idle' && !this._hasActiveIntents(state)) {
        this._movementStates.delete(state.token);
      }
      return;
    }

    state.rotationDirection = intent;
    const speed =
      Number.isFinite(state.rotationSpeed) && state.rotationSpeed > 0
        ? state.rotationSpeed
        : CONTINUOUS_ROTATION_SPEED;
    const deltaAngle = -speed * delta * intent;
    const token = state.token;
    const current = Number.isFinite(token?.facingAngle) ? token.facingAngle : 0;
    token.facingAngle = this._normalizeAngle(current + deltaAngle);
    this.updateTokenOrientation(token);
  }

  _hasActiveIntents(state) {
    if (!state) return false;
    const movementActive =
      (state.forwardKeys?.size || 0) > 0 || (state.backwardKeys?.size || 0) > 0;
    const rotationActive =
      (state.rotationLeftKeys?.size || 0) > 0 || (state.rotationRightKeys?.size || 0) > 0;
    return movementActive || rotationActive;
  }

  beginForwardMovement(tokenEntry, sourceKey = '__forward') {
    this._beginDirectionalMovement(tokenEntry, 1, sourceKey);
  }

  endForwardMovement(tokenEntry, sourceKey = '__forward') {
    this._endDirectionalMovement(tokenEntry, 1, sourceKey);
  }

  beginBackwardMovement(tokenEntry, sourceKey = '__backward') {
    this._beginDirectionalMovement(tokenEntry, -1, sourceKey);
  }

  endBackwardMovement(tokenEntry, sourceKey = '__backward') {
    this._endDirectionalMovement(tokenEntry, -1, sourceKey);
  }

  setShiftModifier(isActive) {
    if (!this._modifiers) {
      this._modifiers = { shift: false };
    }
    const active = !!isActive;
    if (this._modifiers.shift === active) return;
    this._modifiers.shift = active;
    for (const state of this._movementStates.values()) {
      if (!state) continue;
      const direction = state.movementSign || state.lastMoveSign || state.activeDirectionSign || 1;
      this._syncMovementVariant(state, direction, { force: false });
    }
  }

  navigateToGrid(tokenEntry, gridX, gridY, options = {}) {
    try {
      if (!tokenEntry) return null;
      const gm = this.gameManager;
      if (!gm?.is3DModeActive?.()) return null;
      const spatial = gm.spatial;
      if (!spatial || typeof spatial.gridToWorld !== 'function') return null;

      const state = this._ensureMovementState(tokenEntry);
      if (!state) return null;

      const currentGridX = Number.isFinite(tokenEntry.gridX) ? Math.round(tokenEntry.gridX) : 0;
      const currentGridY = Number.isFinite(tokenEntry.gridY) ? Math.round(tokenEntry.gridY) : 0;

      const targetGridX = Number.isFinite(gridX) ? Math.round(gridX) : currentGridX;
      const targetGridY = Number.isFinite(gridY) ? Math.round(gridY) : currentGridY;

      const sameTile = currentGridX === targetGridX && currentGridY === targetGridY;
      if (sameTile) {
        this._clearPathState(state);
        if (state.phase !== 'idle') {
          state.pendingStop = true;
        }
        return { goal: null, speedMode: null, distance: 0 };
      }

      const walkThreshold =
        Number.isFinite(options.walkThreshold) && options.walkThreshold >= 0
          ? options.walkThreshold
          : PATH_SPEED_WALK_MAX;
      const runThreshold =
        Number.isFinite(options.runThreshold) && options.runThreshold >= walkThreshold
          ? options.runThreshold
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

      const baseHeight = Number.isFinite(options.elevation)
        ? options.elevation
        : (tokenEntry.world?.y ?? 0);
      const gridCenterX = targetGridX + 0.5;
      const gridCenterY = targetGridY + 0.5;
      let rawWorld = null;
      try {
        rawWorld = spatial.gridToWorld(gridCenterX, gridCenterY, baseHeight);
      } catch (_) {
        rawWorld = null;
      }
      const currentWorld = this._resolveTokenWorldPosition(tokenEntry);
      const targetWorld = {
        x: Number.isFinite(rawWorld?.x) ? rawWorld.x : gridCenterX,
        z: Number.isFinite(rawWorld?.z) ? rawWorld.z : gridCenterY,
        y: this._sampleWorldHeight(
          Number.isFinite(rawWorld?.x) ? rawWorld.x : gridCenterX,
          Number.isFinite(rawWorld?.z) ? rawWorld.z : gridCenterY,
          Number.isFinite(rawWorld?.y) ? rawWorld.y : (currentWorld?.y ?? baseHeight)
        ),
      };

      const tolerance =
        Number.isFinite(options.tolerance) && options.tolerance > 0
          ? options.tolerance
          : PATH_SPEED_DEFAULT_TOLERANCE;

      this._orientTokenTowardsWorld(tokenEntry, targetWorld);

      this._clearPathState(state);
      state.pathActive = true;
      state.pathGoal = { gridX: targetGridX, gridY: targetGridY, world: targetWorld };
      state.pathSpeedMode = speedMode;
      state.pathTolerance = tolerance;
      state.pathReached = false;
      state.pathKey = PATH_NAVIGATION_KEY;

      if (state.forwardKeys && typeof state.forwardKeys.clear === 'function') {
        state.forwardKeys.clear();
      }
      if (state.backwardKeys && typeof state.backwardKeys.clear === 'function') {
        state.backwardKeys.clear();
      }
      state.forwardKeys.add(PATH_NAVIGATION_KEY);

      state.freeStartWorld = currentWorld ? { ...currentWorld } : null;
      state.freeLastWorld = currentWorld ? { ...currentWorld } : null;
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

      return { goal: state.pathGoal, speedMode, distance };
    } catch (_) {
      return null;
    }
  }

  beginRotation(tokenEntry, direction = 1, sourceKey = '__rotate') {
    try {
      if (!tokenEntry) return;
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const state = this._ensureMovementState(tokenEntry);
      if (!state) return;
      const key = sourceKey || `rotate_${direction}`;
      if (direction >= 0) {
        state.rotationRightKeys.add(key);
      } else {
        state.rotationLeftKeys.add(key);
      }
      state.rotationDirection = this._computeRotationIntent(state);
    } catch (_) {
      /* ignore rotation begin errors */
    }
  }

  endRotation(tokenEntry, direction = 1, sourceKey = '__rotate') {
    try {
      const state = this._movementStates.get(tokenEntry);
      if (!state) return;
      const key = sourceKey || `rotate_${direction}`;
      if (direction >= 0) {
        state.rotationRightKeys.delete(key);
      } else {
        state.rotationLeftKeys.delete(key);
      }
      state.rotationDirection = this._computeRotationIntent(state);
      if (state.phase === 'idle' && !this._hasActiveIntents(state)) {
        this._movementStates.delete(tokenEntry);
      }
    } catch (_) {
      /* ignore rotation end errors */
    }
  }

  _beginDirectionalMovement(tokenEntry, directionSign, sourceKey) {
    try {
      if (!tokenEntry || !directionSign) return;
      const gm = this.gameManager;
      if (!gm || !gm.is3DModeActive?.()) return;
      const mesh = tokenEntry.__threeMesh;
      if (!mesh) return;
      const animationData = this._tokenAnimationData.get(tokenEntry);
      if (!animationData) return;

      const state = this._ensureMovementState(tokenEntry);
      if (!state) return;

      const key = sourceKey || `move_${directionSign}`;
      if (directionSign > 0) {
        state.forwardKeys.add(key);
      } else {
        state.backwardKeys.add(key);
      }

      if (state.phase && state.phase !== 'idle') {
        this._syncMovementVariant(state, directionSign);
      }

      const netIntent = this._recalculateMovementIntent(state);
      if (netIntent === 0) return;

      if (state.phase === 'idle') {
        this._startMovementPhase(state, netIntent);
        return;
      }

      if (state.phase === 'stop') {
        this._abortStopPhase(state);
        this._startMovementPhase(state, netIntent);
        return;
      }

      state.movementSign = netIntent;
      state.lastMoveSign = netIntent;
      state.intentHold = true;
      state.pendingStop = false;
      state.stopTriggered = false;
    } catch (_) {
      /* ignore directional begin errors */
    }
  }

  _endDirectionalMovement(tokenEntry, directionSign, sourceKey) {
    try {
      const state = this._movementStates.get(tokenEntry);
      if (!state) return;
      const key = sourceKey || `move_${directionSign}`;
      if (directionSign > 0) {
        state.forwardKeys.delete(key);
      } else {
        state.backwardKeys.delete(key);
      }

      if (state.phase && state.phase !== 'idle') {
        this._syncMovementVariant(state, directionSign);
      }

      const netIntent = this._recalculateMovementIntent(state);
      if (netIntent === 0) {
        state.intentHold = false;
        state.pendingStop = true;
        state.movementSign = 0;
        if (state.phase === 'idle' && !this._hasActiveIntents(state)) {
          this._movementStates.delete(tokenEntry);
        }
        return;
      }

      if (state.phase === 'stop') {
        this._abortStopPhase(state);
      }

      if (netIntent !== state.movementSign) {
        state.freeStartWorld = this._resolveTokenWorldPosition(tokenEntry);
        state.freeLastWorld = state.freeStartWorld ? { ...state.freeStartWorld } : null;
        state.freeDistance = 0;
        state.phaseElapsed = 0;
      }

      state.movementSign = netIntent;
      state.lastMoveSign = netIntent;
      state.intentHold = true;
      state.pendingStop = false;
    } catch (_) {
      /* ignore directional end errors */
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

      const sprintClip = await this._resolveAnimationClip(
        animationsConfig.sprint,
        null,
        clipOptions
      );
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

  async _resolveAnimationClip(descriptor, fallbackClip, options = {}) {
    if (!descriptor) {
      return this._cloneClip(fallbackClip);
    }

    if (typeof descriptor === 'string') {
      const clip = await this._loadAnimationClip(descriptor, options);
      return clip || this._cloneClip(fallbackClip);
    }

    if (descriptor?.path) {
      const clip = await this._loadAnimationClip(descriptor.path, options);
      return clip || this._cloneClip(fallbackClip);
    }

    return this._cloneClip(fallbackClip);
  }

  async _loadAnimationClip(path, options = {}) {
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
        clip = await this._retargetAnimationClip(clip, sourceRoot, options.targetRoot);
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

  _buildAnimationCacheKey(path, targetKey) {
    const base = path?.toLowerCase?.() || String(path || '');
    if (!targetKey) return base;
    return `${base}::${targetKey}`;
  }

  async _retargetAnimationClip(clip, sourceRoot, targetRoot) {
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
          const retargeted = SkeletonUtils.retargetClip(
            targetForRetarget,
            sourceForRetarget,
            clip,
            {
              useFirstFramePosition: true,
            }
          );
          if (retargeted) return retargeted;
        }
      }
    } catch (_) {
      /* ignore retarget errors */
    }
    return clip;
  }

  _cloneClip(clip) {
    if (!clip) return null;
    try {
      return clip.clone();
    } catch (_) {
      return clip;
    }
  }

  _scoreAnimationClip(clip) {
    if (!clip) return -Infinity;
    const trackCount = Array.isArray(clip.tracks) ? clip.tracks.length : 0;
    const duration = Number.isFinite(clip.duration) ? clip.duration : 0;
    if (trackCount <= 0 || duration <= 1e-4) {
      return duration > 0 ? duration : -Infinity;
    }
    return trackCount * duration;
  }

  _selectPrimaryClip(clips) {
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
    profile.hardLandingClipDuration =
      this._extractClipDuration(actions.hardLanding) || clips.hardLanding || 0;
    profile.fallLoopClipDuration =
      this._extractClipDuration(actions.fallLoop) ||
      clips.fallLoop ||
      profile.fallClipDuration ||
      0;

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

  _updateForwardMovements(delta) {
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
            } else if (!this._hasActiveIntents(state)) {
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

        if (state.phase === 'idle' && !this._hasActiveIntents(state)) {
          this._movementStates.delete(tokenEntry);
        }
      } catch (_) {
        this._movementStates.delete(tokenEntry);
      }
    }
  }

  _advanceStartPhase(state, delta, bounds) {
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

  _advanceWalkPhase(state, delta, bounds) {
    if (!state) return;
    const netIntent = this._recalculateMovementIntent(state);
    if (netIntent === 0) {
      this._updateRunningDuration(state, delta, netIntent);
      state.intentHold = false;
      state.pendingStop = true;
      return;
    }

    if (netIntent !== state.movementSign) {
      state.freeStartWorld = this._resolveTokenWorldPosition(state.token);
      state.freeLastWorld = state.freeStartWorld ? { ...state.freeStartWorld } : null;
      state.freeDistance = 0;
      state.phaseElapsed = 0;
    }

    state.movementSign = netIntent;
    state.lastMoveSign = netIntent;
    state.intentHold = true;
    state.pendingStop = false;

    this._syncMovementVariant(state, netIntent);
    this._updateRunningDuration(state, delta, netIntent);

    if (delta > 0) {
      this._advanceFreeMovement(state, delta, bounds);
    }
  }

  _initiateStopPhase(state) {
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
        const duration = Math.max(
          state.stopMovementDuration ?? profile.stopMovementDuration ?? 0,
          0
        );
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
      this._finishStopState(state);
    }
  }

  _advanceStopPhase(state, delta) {
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
      this._finishStopState(state);
    }
  }

  _advanceFallPhase(state, delta) {
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

  _finishFallPhase(state) {
    if (!state || state.phase !== 'fall') return;
    const animationData = this._tokenAnimationData.get(state.token);
    const profile = animationData?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;

    if (!state.stepFinalized) {
      this._lockStepAtTarget(state);
    }
    this._applyPendingOrientation(state);
    this._movementStates.delete(state.token);
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
  }

  _checkFallTransitions(state) {
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

  _transitionFallToLanding(state) {
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

    this._setAnimation(state.token, landingKey, {
      fadeIn: profile.fallFadeIn,
      fadeOut: profile.fallFadeOut,
      force: true,
    });
    return true;
  }

  _isLandingAnimationComplete(state, animationData) {
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

  _calculateFallSpeed(step, duration, profile) {
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

  _selectLandingAnimation(actions, preferredKey) {
    if (!actions) return null;
    if (preferredKey === 'hardLanding' && actions.hardLanding) return 'hardLanding';
    if (preferredKey === 'fall' && actions.fall) return 'fall';
    if (actions.fall) return 'fall';
    if (actions.hardLanding) return 'hardLanding';
    return null;
  }

  _getLandingClipDuration(profile, landingKey) {
    const base = profile || DEFAULT_MOVEMENT_PROFILE;
    if (landingKey === 'hardLanding') {
      return (
        base.hardLandingClipDuration || base.fallClipDuration || base.fallLoopClipDuration || 0
      );
    }
    if (landingKey === 'fall') {
      return (
        base.fallClipDuration || base.hardLandingClipDuration || base.fallLoopClipDuration || 0
      );
    }
    return base.fallClipDuration || base.hardLandingClipDuration || base.fallLoopClipDuration || 0;
  }

  _computeLandingThreshold(distance, landingKey) {
    if (!(distance > 0)) return 0;
    const effectiveDistance = Math.max(distance, 0);
    const base = Math.max(effectiveDistance * 0.05, 0.2);
    const landingBias = landingKey === 'hardLanding' ? 0.18 : 0.24;
    const lowerBound = landingKey === 'hardLanding' ? 0.32 : 0.35;
    const upperBound = landingKey === 'hardLanding' ? 0.65 : 0.85;
    const threshold = base + landingBias;
    return Math.max(Math.min(threshold, upperBound), lowerBound);
  }

  _maybeEnterFallPhase(state, animationData) {
    if (!state || !state.activeStep) return false;
    const step = state.activeStep;
    if (!step.requiresFall) return false;
    const data = animationData || this._tokenAnimationData.get(state.token);
    const actions = data?.actions;
    if (!actions?.fall && !actions?.fallLoop) return false;
    const profile = data?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;

    step.fallTriggered = true;
    state.phase = 'fall';
    state.phaseElapsed = 0;
    state.pendingStop = false;
    state.stopTriggered = false;
    state.intentHold = false;
    state.hasLoopStarted = false;
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

      const worldRef = step.tokenEntry?.world
        ? { ...step.tokenEntry.world }
        : this._lerp3(step.startWorld, step.targetWorld, travelRatio);
      step.fallStartWorld = worldRef;
      step.fallStartCaptured = true;
    }

    const verticalDistance = Math.max(step.heightDrop || 0, 0);
    const preferredLanding = step.landingVariant === 'hardLanding' ? 'hardLanding' : 'fall';
    let landingKey = this._selectLandingAnimation(actions, preferredLanding);
    if (!landingKey) {
      landingKey = this._selectLandingAnimation(actions, 'fall');
    }

    state.fallLandingKey = landingKey;
    state.fallLandingDuration = this._getLandingClipDuration(profile, landingKey);
    state.fallMode = actions?.fallLoop ? 'loop' : 'landing';

    let animationKey = null;
    if (state.fallMode === 'loop' && actions?.fallLoop) {
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
    return true;
  }

  _advanceMovementStep(state, distance, options = {}) {
    const step = state.activeStep;
    if (!step || distance <= 0) return false;
    const completed = this._applyStepProgress(step, distance, state, options);
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
      if (state.phase === 'walk' && state.intentHold && !state.pendingStop) {
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
        this._finishWalkState(state);
      }
    }
    return completed;
  }

  _advanceFreeMovement(state, delta, bounds) {
    if (!state || !(delta > 0)) return;
    const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;
    const speed = Math.max(
      state.activeSpeed ?? profile.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed ?? 1,
      0
    );
    if (!(speed > 0)) return;

    const sign = state.movementSign || 0;
    if (sign === 0) return;

    const yaw = this._getMovementYaw(state.token);
    let direction = this._getDirectionalVectorFromYaw(yaw, sign);
    if (!direction || (Math.abs(direction.x) < 1e-6 && Math.abs(direction.z) < 1e-6)) {
      return;
    }

    let distance = speed * delta;
    if (!(distance > 0)) return;

    const currentWorld = this._resolveTokenWorldPosition(state.token);
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
      nextWorld.y = goalWorld.y;
    } else {
      nextWorld.y = this._sampleWorldHeight(nextWorld.x, nextWorld.z, currentWorld.y);
    }

    const composed = this._composeMeshPosition(nextWorld, state.mesh);
    if (state.mesh?.position?.set) {
      state.mesh.position.set(composed.x, composed.y, composed.z);
    }

    this._updateTokenWorldDuringMovement(state.token, nextWorld);

    const actualDistance = Math.hypot(nextWorld.x - currentWorld.x, nextWorld.z - currentWorld.z);
    if (delta > 1e-4 && actualDistance > 0) {
      state.lastMoveSpeed = actualDistance / delta;
    }

    if (!state.freeStartWorld) {
      state.freeStartWorld = { ...currentWorld };
    }
    state.freeLastWorld = { ...nextWorld };
    state.freeDistance += actualDistance;
    state.activeStep = null;
    state.stepFinalized = false;

    if (goalWorld) {
      const remainingAfter = Math.hypot(goalWorld.x - nextWorld.x, goalWorld.z - nextWorld.z);
      state.pathReached = remainingAfter <= Math.max(tolerance, 0.05);
    } else {
      state.pathReached = false;
    }
  }

  _clearPathState(state) {
    if (!state) return;
    if (state.pathKey && state.forwardKeys?.has(state.pathKey)) {
      state.forwardKeys.delete(state.pathKey);
    }
    state.pathActive = false;
    state.pathGoal = null;
    state.pathSpeedMode = null;
    state.pathKey = null;
    state.pathTolerance = 0;
    state.pathReached = false;
  }

  _completePath(state) {
    if (!state) return;
    const goal = state.pathGoal;
    const tokenEntry = state.token;
    const mesh = state.mesh;

    this._clearPathState(state);
    state.intentHold = false;
    state.pendingStop = false;
    state.movementSign = 0;
    state.lastMoveSign = 0;

    if (goal) {
      if (Number.isFinite(goal.gridX)) tokenEntry.gridX = goal.gridX;
      if (Number.isFinite(goal.gridY)) tokenEntry.gridY = goal.gridY;
      if (goal.world) {
        tokenEntry.world = { ...goal.world };
        if (mesh?.position) {
          const composed = this._composeMeshPosition(goal.world, mesh);
          mesh.position.set(composed.x, composed.y, composed.z);
        }
      }
    }

    this._finishWalkState(state);
  }

  _orientTokenTowardsWorld(tokenEntry, targetWorld) {
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

  _computeGridDistance(ax, ay, bx, by) {
    const fromX = Number.isFinite(ax) ? Math.round(ax) : 0;
    const fromY = Number.isFinite(ay) ? Math.round(ay) : 0;
    const toX = Number.isFinite(bx) ? Math.round(bx) : 0;
    const toY = Number.isFinite(by) ? Math.round(by) : 0;
    return Math.abs(fromX - toX) + Math.abs(fromY - toY);
  }

  _applyStepProgress(step, distance, state, options = {}) {
    const remaining = Math.max(0, step.totalDistance - step.traveled);
    const move = Math.min(distance, remaining);
    if (move <= 0) return remaining <= 1e-5;
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

    if (step.mesh?.position) {
      step.mesh.position.set(pos.x, pos.y, pos.z);
    }
    step.horizontalTraveled = Math.hypot(
      pos.x - step.startPosition.x,
      pos.z - step.startPosition.z
    );
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
    step.horizontalTraveled = step.horizontalDistance;
    state.stepFinalized = true;
    const token = step.tokenEntry;
    token.gridX = step.gridTargetX;
    token.gridY = step.gridTargetY;
    token.world = { ...step.targetWorld };
  }

  _createStopGlideStep(state, profile) {
    try {
      const tokenEntry = state?.token;
      if (!tokenEntry) return null;
      const mesh = state?.mesh || tokenEntry.__threeMesh;
      if (!mesh) return null;

      const lastSign = state?.lastMoveSign || state?.movementSign || 0;
      if (lastSign === 0) return null;

      const duration = Math.max(
        state?.stopMovementDuration ?? profile?.stopMovementDuration ?? 0,
        0
      );
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

      return {
        tokenEntry,
        mesh,
        startWorld: { ...currentWorld },
        targetWorld,
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

  _triggerStop(state) {
    if (!state || state.phase === 'stop') return;
    this._initiateStopPhase(state);
  }

  _finishWalkState(state) {
    if (!state) return;
    this._clearPathState(state);
    this._resetSprintState(state);
    this._applyPendingOrientation(state);
    state.phase = 'idle';
    state.activeStep = null;
    state.stepFinalized = true;
    state.intentHold = false;
    if (!state.stopBlendedToIdle) {
      this._setAnimation(state.token, 'idle', {
        fadeIn: state.profile.idleFadeIn,
        fadeOut: state.profile.walkFadeOut,
      });
    }
    if (!this._hasActiveIntents(state)) {
      this._movementStates.delete(state.token);
    }
  }

  _finishStopState(state) {
    if (!state) return;
    this._clearPathState(state);
    this._resetSprintState(state);
    this._applyPendingOrientation(state);
    state.phase = 'idle';
    state.activeStep = null;
    state.stepFinalized = true;
    state.stopTriggered = false;
    state.pendingStop = false;
    state.intentHold = false;
    if (!state.stopBlendedToIdle) {
      this._setAnimation(state.token, 'idle', {
        fadeIn: state.profile.idleFadeIn,
        fadeOut: state.profile.stopFadeOut,
      });
    }
    if (!this._hasActiveIntents(state)) {
      this._movementStates.delete(state.token);
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
      const heightDrop =
        Number.isFinite(startHeight) && Number.isFinite(targetHeight)
          ? startHeight - targetHeight
          : 0;

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

      const horizontalDistance = Math.hypot(dx, dz);
      const tileSize = gm.spatial?.tileWorldSize || 1;
      const edgeDistance = Math.min(horizontalDistance, tileSize * 0.52);
      const fallTriggerProgress = horizontalDistance > 0 ? edgeDistance / horizontalDistance : 1;
      const normalizedTrigger = Math.min(
        Math.max(fallTriggerProgress || DEFAULT_FALL_TRIGGER_PROGRESS, 0.35),
        0.98
      );
      const requiresFall = heightDrop >= 3;
      const landingVariant = heightDrop > HARD_LANDING_HEIGHT_THRESHOLD ? 'hardLanding' : 'fall';

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

    const state = this._movementStates.get(tokenEntry);
    if (this._shouldDeferOrientation(state)) {
      state.pendingFacingAngle = normalized;
      return;
    }

    this._applyOrientationImmediate(tokenEntry, normalized);
    if (state) {
      state.pendingFacingAngle = undefined;
    }
  }

  _shouldDeferOrientation(state) {
    if (!state) return false;
    if (state.phase === 'stop') return false;
    if (!state.activeStep) return false;
    if (state.stepFinalized) return false;
    return true;
  }

  _applyPendingOrientation(state) {
    if (!state || state.pendingFacingAngle == null) return;
    this._applyOrientationImmediate(state.token, state.pendingFacingAngle);
    state.pendingFacingAngle = undefined;
  }

  _applyOrientationImmediate(tokenEntry, angle) {
    const mesh = tokenEntry?.__threeMesh;
    const globalFlip = this._getGlobalFacingRight() ? 0 : Math.PI;

    if (mesh && mesh.userData?.__tt3DToken) {
      const baseYaw = mesh.userData.__ttBaseYaw || 0;
      const yaw = baseYaw + globalFlip + angle;
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
          sprite.rotation = angle;
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

  pickTokenByRay(raycaster) {
    try {
      if (!raycaster) return null;
      const gm = this.gameManager;
      const tokens = gm?.placedTokens || [];
      if (!tokens.length) return null;
      const scratch = this._raycastScratch || (this._raycastScratch = []);
      let closest = null;
      let minDistance = Infinity;

      for (const tokenEntry of tokens) {
        const mesh = tokenEntry?.__threeMesh;
        if (!mesh || mesh.visible === false) {
          continue;
        }
        scratch.length = 0;
        let intersections = null;
        try {
          intersections = raycaster.intersectObject(mesh, true, scratch);
        } catch (_) {
          intersections = scratch;
        }
        if (!intersections || !intersections.length) {
          continue;
        }
        const hit = intersections[0];
        const distance = typeof hit?.distance === 'number' ? hit.distance : Infinity;
        if (distance >= minDistance) {
          continue;
        }
        const point = hit?.point;
        closest = {
          token: tokenEntry,
          distance,
          point: point && typeof point.clone === 'function' ? point.clone() : point || null,
        };
        minDistance = distance;
      }

      scratch.length = 0;
      return closest;
    } catch (_) {
      return null;
    }
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
