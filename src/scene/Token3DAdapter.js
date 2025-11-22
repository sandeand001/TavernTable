// Token3DAdapter.js - Phase 3 enhanced scaffold
// Bridges existing 2D token data structures to emerging 3D scene.
// Responsibilities:
//  - Create either billboard planes (legacy sprites) or true 3D models per token entry
//  - Keep Three.js representation synchronized with grid placement / terrain height
//  - Manage hover/selection highlighting and facing direction parity with 2D tokens

const MANNEQUIN_MODEL = {
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
    climb: {
      path: 'assets/animated-sprites/Climbing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    climbWall: {
      path: 'assets/animated-sprites/Climbing Up Wall.fbx',
      loop: 'repeat',
      clampWhenFinished: false,
    },
    climbRecover: {
      path: 'assets/animated-sprites/Crouched To Standing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    hardLanding: {
      path: 'assets/animated-sprites/hard landing.fbx',
      loop: 'once',
      clampWhenFinished: true,
    },
    fallToRoll: {
      path: 'assets/animated-sprites/falling to roll.fbx',
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
    fallLoopMinDrop: 4.5,
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
  mannequin: MANNEQUIN_MODEL,
  // Preserve legacy saves that still reference the defeated doll identifier.
  'defeated-doll': MANNEQUIN_MODEL,
  'female-humanoid': MANNEQUIN_MODEL,
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
  fallLoopMinDrop: 4.5,
};

const DEFAULT_FALL_TRIGGER_PROGRESS = 0.38;
const DEFAULT_HEIGHT_SNAP_PROGRESS = 0.62;
const HARD_LANDING_HEIGHT_THRESHOLD = 5;
const ROLLING_LANDING_HEIGHT_THRESHOLD = 8;
const FALL_MIN_HEIGHT_THRESHOLD = 3;
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
const DEFAULT_CLIMB_DURATION = 1.2;
const DEFAULT_CLIMB_RECOVER_DURATION = 0.95;
const MAX_STANDARD_CLIMB_LEVELS = 4;
const HIGH_WALL_SEGMENT_LEVELS = 4;
const DEFAULT_CLIMB_WALL_DURATION = 1.2;
const CLIMB_WALL_BLEND_LEAD = 0.2;
const CLIMB_WALL_PROGRESS_EXPONENT = 1.35;
const CLIMB_WALL_PROGRESS_SCALE = 0.5;
const CLIMB_WALL_ENTRY_TILE_HALF_RATIO = 0.68;
const CLIMB_WALL_ENTRY_MIN_RATIO = -0.45; // allow sprint stop point to retreat slightly into approach tile
const CLIMB_WALL_ENTRY_RUN_BACKOFF_RATIO = 0.32;
const CLIMB_WALL_ENTRY_SPRINT_BACKOFF_RATIO = 1.1;
const FALL_EDGE_TRIGGER_TILE_RATIO = 1 - CLIMB_WALL_ENTRY_TILE_HALF_RATIO * 0.5;
const FALL_LANDING_THRESHOLD_CONFIG = {
  fall: { slope: 0.05, bias: 0.24, lower: 0.35, upper: 0.85 },
  hardLanding: { slope: 0.045, bias: 0.18, lower: 0.32, upper: 0.65 },
  fallToRoll: { slope: 0.06, bias: 0.3, lower: 0.45, upper: 1.0 },
};
const FALL_LOOP_MIN_DROP = 4.5;
const LANDING_VARIANTS_ALLOW_TILE_EXIT = new Set(['fallToRoll']);
const LANDING_OFFSET_SANITIZE_LIMITS = {
  default: {
    horizontalMultiplier: 2.1,
    horizontalBonusTiles: 0.45,
    horizontalMaxTiles: 4,
  },
  fall: {
    horizontalMultiplier: 2.1,
    horizontalBonusTiles: 0.45,
    horizontalMaxTiles: 4,
  },
  hardLanding: {
    horizontalMultiplier: 1.35,
    horizontalBonusTiles: 0.35,
    horizontalMaxTiles: 2,
  },
  fallToRoll: {
    horizontalMultiplier: 1.55,
    horizontalBonusTiles: 0.4,
    horizontalMaxTiles: 2,
  },
};
const CLIMB_APPROACH_TOLERANCE_MIN = 0.04;
const CLIMB_APPROACH_TOLERANCE_RUN_SCALE = 0.65;
const CLIMB_APPROACH_TOLERANCE_SPRINT_SCALE = 0.45;
const MAX_INTERMEDIATE_CLIMB_CHAIN = 4;
const PATH_STALL_REPATH_DELAY = 0.35;
const SELECTION_COLLIDER_HEIGHT = 2.3;
const SELECTION_COLLIDER_RADIUS_RATIO = 0.46;
const CLIMB_RECOVER_DEFAULT_CROUCH_DROP = 0.05;
const CLIMB_RECOVER_MIN_CROUCH_DROP = 0.01;
const CLIMB_RECOVER_MAX_CROUCH_DROP = 0.25;
const CLIMB_RECOVER_CROUCH_HOLD = 0.24;
const CLIMB_RECOVER_STAND_RELEASE = 0.78;
const PATHING_LOG_LOCAL_STORAGE_KEY = 'tt:pathingLogs';
const PATHING_LOG_ENV_FLAG = 'TT_PATHING_LOGS';
const PATHING_LOG_PREFIX = '[Token3DAdapter]';
const PATHING_LOG_ARCHIVE_LIMIT = 300;
const FALL_HEIGHT_VERBOSE_STORAGE_KEYS = ['tt:fallHeightVerbose', 'ttFallHeightVerbose'];
const TOKEN_WORLD_LOCK_PROP = '__ttWorldLock';

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
    this._pathingLoggingEnabledOverride = undefined;
    this._pathingLogArchive = [];
  }

  setPathingLoggingEnabled(isEnabled) {
    if (typeof isEnabled === 'boolean') {
      this._pathingLoggingEnabledOverride = isEnabled;
    } else {
      this._pathingLoggingEnabledOverride = undefined;
    }
  }

  _isPathingLoggingEnabled() {
    if (this._pathingLoggingEnabledOverride !== undefined) {
      return this._pathingLoggingEnabledOverride;
    }

    let enabled = true;
    let overrideApplied = false;
    try {
      if (typeof window !== 'undefined') {
        if (window.__TT_DEBUG && 'pathing' in window.__TT_DEBUG) {
          enabled = !!window.__TT_DEBUG.pathing;
          overrideApplied = true;
        } else if (window.localStorage) {
          const stored = window.localStorage.getItem(PATHING_LOG_LOCAL_STORAGE_KEY);
          if (stored != null) {
            enabled = stored !== '0' && stored !== 'false';
            overrideApplied = true;
          }
        }
      }
    } catch (_) {
      /* ignore */
    }

    try {
      const env =
        typeof globalThis !== 'undefined' && globalThis.process
          ? globalThis.process.env
          : undefined;
      if (env) {
        const envValue = env[PATHING_LOG_ENV_FLAG];
        if (envValue !== undefined) {
          enabled = envValue !== '0' && envValue !== 'false';
          overrideApplied = true;
        } else if (!overrideApplied && env.NODE_ENV === 'production') {
          enabled = false;
        }
      }
    } catch (_) {
      /* ignore */
    }

    return enabled;
  }

  _describeTokenForLogs(tokenEntry) {
    if (!tokenEntry) {
      return { id: null, label: null, type: null };
    }
    const typeKey =
      (tokenEntry.type || tokenEntry.creature?.type || tokenEntry.kind || '').toLowerCase() || null;
    return {
      id: tokenEntry.id ?? tokenEntry.creature?.id ?? null,
      label: tokenEntry.name ?? tokenEntry.label ?? tokenEntry.creature?.name ?? null,
      type: typeKey,
    };
  }

  _logPathing(event, payload = {}, level = 'info') {
    if (!this._isPathingLoggingEnabled()) return;
    const entry = {
      source: PATHING_LOG_PREFIX,
      event,
      payload: payload ? { ...payload } : undefined,
      level,
      timestamp: this._getPathingTimestamp(),
    };
    this._archivePathingLog(entry);
  }

  _archivePathingLog(entry) {
    if (!entry) return;
    if (!this._pathingLogArchive) {
      this._pathingLogArchive = [];
    }
    this._pathingLogArchive.push(entry);
    if (this._pathingLogArchive.length > PATHING_LOG_ARCHIVE_LIMIT) {
      this._pathingLogArchive.splice(
        0,
        Math.max(this._pathingLogArchive.length - PATHING_LOG_ARCHIVE_LIMIT, 0)
      );
    }
    let handledByDebugSink = false;
    try {
      if (typeof window !== 'undefined' && window.__TT_DEBUG) {
        const sink = window.__TT_DEBUG.onPathingLog || window.__TT_DEBUG.pathingSink;
        if (typeof sink === 'function') {
          sink(entry);
          handledByDebugSink = true;
        } else if (Array.isArray(window.__TT_DEBUG.pathingHistory)) {
          window.__TT_DEBUG.pathingHistory.push(entry);
          handledByDebugSink = true;
        }
      }
    } catch (_) {
      /* ignore */
    }
    if (
      !handledByDebugSink &&
      typeof entry?.event === 'string' &&
      entry.event.startsWith('fall:height') &&
      this._isFallHeightLoggingEnabled()
    ) {
      try {
        if (typeof console !== 'undefined' && console.log) {
          console.log(`${PATHING_LOG_PREFIX} ${entry.event}`, entry.payload || {});
        }
      } catch (_) {
        /* ignore */
      }
    }
  }

  getPathingLogArchive(limit = PATHING_LOG_ARCHIVE_LIMIT) {
    if (!this._pathingLogArchive || !this._pathingLogArchive.length) {
      return [];
    }
    const normalizedLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : null;
    const startIndex = normalizedLimit
      ? Math.max(this._pathingLogArchive.length - normalizedLimit, 0)
      : 0;
    return this._pathingLogArchive.slice(startIndex).map((entry) => ({
      ...entry,
      payload: entry?.payload ? { ...entry.payload } : undefined,
    }));
  }

  clearPathingLogArchive() {
    if (this._pathingLogArchive) {
      this._pathingLogArchive.length = 0;
    }
  }

  _logPathingOnce(state, flag, event, payload = {}, level = 'info') {
    if (!state) {
      this._logPathing(event, payload, level);
      return;
    }
    if (!state.__pathingLogFlags) {
      state.__pathingLogFlags = new Set();
    }
    if (state.__pathingLogFlags.has(flag)) {
      return;
    }
    state.__pathingLogFlags.add(flag);
    this._logPathing(event, payload, level);
  }

  _isFallHeightLoggingEnabled() {
    const now = this._getPathingTimestamp();
    const lastCheck = this._fallHeightLoggingCheckTime || 0;
    if (
      this._fallHeightLoggingEnabled === undefined ||
      !Number.isFinite(lastCheck) ||
      now - lastCheck > 1000
    ) {
      this._fallHeightLoggingEnabled = this._resolveFallHeightLoggingEnabled();
      this._fallHeightLoggingCheckTime = now;
    }
    return !!this._fallHeightLoggingEnabled;
  }

  _resolveFallHeightLoggingEnabled() {
    try {
      if (typeof window !== 'undefined') {
        if (window.__TT_DEBUG?.fallHeightLogging) {
          return true;
        }
        const stored =
          window.localStorage?.getItem?.('tt:fallHeightLogging') ??
          window.localStorage?.getItem?.('ttFallHeightLogging');
        if (stored && stored !== '0' && stored.toLowerCase?.() !== 'false') {
          return true;
        }
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  _isFallHeightVerboseMode() {
    const now = this._getPathingTimestamp();
    const lastCheck = this._fallHeightVerboseCheckTime || 0;
    if (
      this._fallHeightVerboseEnabled === undefined ||
      !Number.isFinite(lastCheck) ||
      now - lastCheck > 1000
    ) {
      this._fallHeightVerboseEnabled = this._resolveFallHeightVerboseMode();
      this._fallHeightVerboseCheckTime = now;
    }
    return !!this._fallHeightVerboseEnabled;
  }

  _resolveFallHeightVerboseMode() {
    try {
      if (typeof window !== 'undefined') {
        if (window.__TT_DEBUG && 'fallHeightVerbose' in window.__TT_DEBUG) {
          return !!window.__TT_DEBUG.fallHeightVerbose;
        }
        const storage = window.localStorage;
        if (storage) {
          for (const key of FALL_HEIGHT_VERBOSE_STORAGE_KEYS) {
            const stored = storage.getItem?.(key);
            if (stored != null) {
              return stored !== '0' && stored.toLowerCase?.() !== 'false';
            }
          }
        }
      }
    } catch (_) {
      /* ignore */
    }
    return false;
  }

  _logFallHeightSample(state, label, step = null, extra = {}) {
    if (!state || !this._isFallHeightLoggingEnabled()) return;
    const isStepLabel = label === 'fall-step' || label === 'landing-step';
    const verboseMode = this._isFallHeightVerboseMode();
    if (isStepLabel && !verboseMode) {
      const phaseElapsed = Number.isFinite(state.phaseElapsed) ? state.phaseElapsed : 0;
      const bucketSize = label === 'landing-step' ? 0.2 : 0.3;
      const bucketIndex = Math.floor(phaseElapsed / bucketSize);
      if (!state.__fallHeightLogBuckets) {
        state.__fallHeightLogBuckets = Object.create(null);
      }
      const bucketKey = label;
      if (!extra?.stepFinished && state.__fallHeightLogBuckets[bucketKey] === bucketIndex) {
        return;
      }
      state.__fallHeightLogBuckets[bucketKey] = bucketIndex;
    }
    const now = this._getPathingTimestamp();
    const throttleMs = isStepLabel ? (verboseMode ? 80 : 250) : 0;
    const last = state.__fallHeightLogTimestamp || 0;
    if (throttleMs > 0 && now - last < throttleMs) {
      return;
    }
    state.__fallHeightLogTimestamp = now;

    const tokenEntry = state.token;
    const mesh = state.mesh;
    const meshPos = mesh?.position;
    const world = tokenEntry?.world;
    const animationData = this._tokenAnimationData?.get?.(tokenEntry) || null;
    const animationKey =
      extra?.animationKey ||
      animationData?.current ||
      (state?.fallMode === 'loop' ? 'fallLoop' : state?.fallLandingKey) ||
      null;
    const baseOffset = mesh?.userData?.__ttVerticalBase || 0;
    const worldY = Number.isFinite(world?.y) ? world.y : null;
    const meshY = Number.isFinite(meshPos?.y) ? meshPos.y : null;
    const computedMeshY = worldY !== null ? worldY + this._verticalBias + baseOffset : null;
    const offsetY = meshY !== null && computedMeshY !== null ? meshY - computedMeshY : null;
    let stepInfo;
    if (step) {
      stepInfo = {
        startWorldY: Number.isFinite(step.startWorld?.y) ? step.startWorld.y : null,
        targetWorldY: Number.isFinite(step.targetWorld?.y) ? step.targetWorld.y : null,
        traveled: step.traveled ?? null,
        totalDistance: step.totalDistance ?? null,
        requiresFall: !!step.requiresFall,
        fallTriggered: !!step.fallTriggered,
      };
    }

    const payload = {
      tokenId: tokenEntry?.id,
      label,
      phase: state.phase,
      fallMode: state.fallMode,
      landingKey: state.fallLandingKey,
      phaseElapsed: Number.isFinite(state.phaseElapsed)
        ? Number(state.phaseElapsed.toFixed(3))
        : null,
      meshY,
      worldY,
      verticalBias: this._verticalBias,
      baseOffset,
      measuredOffsetY: offsetY,
      fallSpeed: state.fallSpeed ?? null,
      animation: animationKey,
      extra,
    };
    if (stepInfo) payload.step = stepInfo;

    this._emitConsoleFallHeightSample(payload);
    this._logPathing('fall:height', payload, 'debug');
  }

  _emitConsoleFallHeightSample(payload) {
    if (!payload || !this._isFallHeightLoggingEnabled()) return;
    try {
      if (typeof console === 'undefined' || typeof console.log !== 'function') {
        return;
      }
      const format = (value) =>
        Number.isFinite(value) ? Number(value).toFixed(3) : value === null ? '—' : String(value);
      const summaryParts = [
        `${payload.label || 'fall'}`,
        `meshY=${format(payload.meshY)}`,
        `worldY=${format(payload.worldY)}`,
        `offset=${format(payload.measuredOffsetY)}`,
        `phase=${payload.phase || 'unknown'}`,
        `anim=${payload.animation || 'n/a'}`,
      ];
      if (Number.isFinite(payload.phaseElapsed)) {
        summaryParts.push(`t=${format(payload.phaseElapsed)}s`);
      }
      console.log(`${PATHING_LOG_PREFIX} fall-sample :: ${summaryParts.join(' | ')}`, payload);
    } catch (_) {
      /* ignore */
    }
  }

  _getPathingTimestamp() {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return performance.now();
    }
    return Date.now();
  }

  _armResumeProbe(state, payload = {}) {
    if (!state) return;
    const now = this._getPathingTimestamp();
    const goal = payload.goal || null;
    let normalizedGoal = null;
    if (goal && (Number.isFinite(goal.gridX) || Number.isFinite(goal.gridY))) {
      normalizedGoal = {
        gridX: Number.isFinite(goal.gridX) ? Math.round(goal.gridX) : null,
        gridY: Number.isFinite(goal.gridY) ? Math.round(goal.gridY) : null,
        options: goal.options ? { ...goal.options } : undefined,
      };
    }
    state.__resumeProbe = {
      startedAt: now,
      resumeSource: payload.resumeSource || null,
      baselineDistance: state.freeDistance || 0,
      goal: normalizedGoal,
      retries: 0,
    };
  }

  _clearResumeProbe(state) {
    if (!state) return;
    state.__resumeProbe = null;
  }

  _abortResumeProbe(state, reason = 'unknown', extra = {}) {
    if (!state?.__resumeProbe) return;
    const probe = state.__resumeProbe;
    this._logPathing('movement:resume-aborted', {
      token: this._describeTokenForLogs(state.token),
      resumeSource: probe.resumeSource,
      reason,
      retries: probe.retries || 0,
      ...extra,
    });
    state.__resumeProbe = null;
  }

  _handleResumeProbeProgress(state) {
    if (!state?.__resumeProbe) return;
    const probe = state.__resumeProbe;
    const distanceDelta = Math.abs((state.freeDistance || 0) - (probe.baselineDistance || 0));
    if (distanceDelta <= 1e-4) {
      return;
    }
    this._logPathing('movement:resume-progress', {
      token: this._describeTokenForLogs(state.token),
      resumeSource: probe.resumeSource,
      distanceDelta,
    });
    state.__resumeProbe = null;
  }

  _checkResumeProbe(state) {
    if (!state?.__resumeProbe) return;
    const probe = state.__resumeProbe;
    const now = this._getPathingTimestamp();
    const elapsed = now - (probe.startedAt || 0);
    const distanceDelta = Math.abs((state.freeDistance || 0) - (probe.baselineDistance || 0));

    if (distanceDelta > 1e-4) {
      this._logPathing('movement:resume-progress-delayed', {
        token: this._describeTokenForLogs(state.token),
        resumeSource: probe.resumeSource,
        elapsed,
        distanceDelta,
      });
      state.__resumeProbe = null;
      return;
    }

    const pathActive = !!state.pathActive;
    const intentsActive = !!state.intentHold && state.movementSign !== 0;

    if (elapsed < 600) {
      return;
    }

    const pathInactive = !pathActive || !intentsActive;
    const retryTarget = probe.goal || state.lastRequestedGoal || null;
    if (!retryTarget || probe.retries >= 1) {
      let reason;
      if (probe.retries >= 1) {
        reason = 'no-progress-after-retry';
      } else if (pathInactive) {
        reason = 'path-inactive';
      } else {
        reason = 'no-target';
      }
      this._logPathing('movement:resume-stalled', {
        token: this._describeTokenForLogs(state.token),
        resumeSource: probe.resumeSource,
        reason,
      });
      state.__resumeProbe = null;
      return;
    }

    if (!probe.goal && retryTarget) {
      probe.goal = {
        gridX: retryTarget.gridX ?? null,
        gridY: retryTarget.gridY ?? null,
        options: retryTarget.options ? { ...retryTarget.options } : undefined,
      };
    }

    const retried = this._reissueMaintainedGoal(state, retryTarget, { allowSameTile: true });
    this._logPathing('movement:resume-retry', {
      token: this._describeTokenForLogs(state.token),
      resumeSource: probe.resumeSource,
      goal: retryTarget
        ? { gridX: retryTarget.gridX ?? null, gridY: retryTarget.gridY ?? null }
        : null,
      retried,
      reason: pathInactive ? 'path-inactive' : 'no-progress',
    });

    if (retried) {
      probe.retries += 1;
      probe.startedAt = now;
      probe.baselineDistance = state.freeDistance || 0;
    } else {
      state.__resumeProbe = null;
    }
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

      this._attachSelectionCollider(container, three, config);

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
    const state = this._movementStates.get(tokenEntry);
    const climbTranslationActive =
      state?.phase === 'climb' ||
      state?.climbActive ||
      state?.phase === 'climb-wall' ||
      state?.climbWallActive;
    const climbRotationActive =
      climbTranslationActive || state?.phase === 'climb-recover' || state?.climbRecoverActive;
    const isFallPhase = state?.phase === 'fall';
    const preserveRootTranslation = isFallPhase;
    const allowRootRotation = climbRotationActive || isFallPhase;
    const allowRootTranslation = climbTranslationActive || preserveRootTranslation;
    const clampClimbWallPlanarOffset =
      state?.phase === 'climb-wall' || state?.climbWallActive ? true : false;
    for (const info of roots) {
      const bone = info?.bone;
      if (!bone || !bone.position) continue;
      const base = info.basePosition;
      if (!allowRootTranslation) {
        if (base) {
          bone.position.x = base.x;
          bone.position.y = base.y;
          bone.position.z = base.z;
        } else {
          bone.position.x = 0;
          bone.position.y = 0;
          bone.position.z = 0;
        }
      } else if (clampClimbWallPlanarOffset) {
        if (base) {
          bone.position.x = base.x;
          bone.position.z = base.z;
        } else {
          bone.position.x = 0;
          bone.position.z = 0;
        }
      }
      const baseQuat = info.baseQuaternion;
      if (!allowRootRotation) {
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
  }

  _extractRootMotionOffset(state) {
    if (!state?.token) return null;
    const roots = this._rootBones.get(state.token);
    if (!roots?.length) return null;
    const yaw = state.mesh?.rotation?.y || 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const epsilon = 1e-4;
    for (const rootInfo of roots) {
      const bone = rootInfo?.bone;
      const base = rootInfo?.basePosition;
      if (!bone?.position || !base) {
        continue;
      }
      const offsetLocal = {
        x:
          Number.isFinite(bone.position.x) && Number.isFinite(base.x)
            ? bone.position.x - base.x
            : 0,
        y:
          Number.isFinite(bone.position.y) && Number.isFinite(base.y)
            ? bone.position.y - base.y
            : 0,
        z:
          Number.isFinite(bone.position.z) && Number.isFinite(base.z)
            ? bone.position.z - base.z
            : 0,
      };
      if (
        Math.abs(offsetLocal.x) < epsilon &&
        Math.abs(offsetLocal.y) < epsilon &&
        Math.abs(offsetLocal.z) < epsilon
      ) {
        continue;
      }
      const offsetWorld = {
        x: offsetLocal.x * cos - offsetLocal.z * sin,
        z: offsetLocal.x * sin + offsetLocal.z * cos,
        y: offsetLocal.y,
      };
      return {
        rootInfo,
        offsetLocal,
        offsetWorld,
      };
    }
    return null;
  }

  _resetRootBonePose(rootInfo) {
    if (!rootInfo?.bone) return;
    const { bone, basePosition, baseQuaternion } = rootInfo;
    if (bone.position && basePosition) {
      if (typeof bone.position.copy === 'function') {
        bone.position.copy(basePosition);
      } else {
        bone.position.x = basePosition.x;
        bone.position.y = basePosition.y;
        bone.position.z = basePosition.z;
      }
    } else if (bone.position) {
      bone.position.x = 0;
      bone.position.y = 0;
      bone.position.z = 0;
    }
    if (bone.quaternion) {
      if (baseQuaternion && typeof bone.quaternion.copy === 'function') {
        bone.quaternion.copy(baseQuaternion);
      } else if (baseQuaternion && bone.rotation?.setFromQuaternion) {
        bone.rotation.setFromQuaternion(baseQuaternion);
      }
    }
  }

  _applyWorldOffsetToState(state, offset) {
    if (!state || !offset) return;
    const dx = Number.isFinite(offset.x) ? offset.x : 0;
    const dy = Number.isFinite(offset.y) ? offset.y : 0;
    const dz = Number.isFinite(offset.z) ? offset.z : 0;
    const epsilon = 1e-5;
    if (Math.abs(dx) < epsilon && Math.abs(dy) < epsilon && Math.abs(dz) < epsilon) {
      return;
    }
    if (state.mesh?.position) {
      state.mesh.position.x = (state.mesh.position.x || 0) + dx;
      state.mesh.position.y = (state.mesh.position.y || 0) + dy;
      state.mesh.position.z = (state.mesh.position.z || 0) + dz;
    }
    const currentWorld = this._resolveTokenWorldPosition(state.token) || { x: 0, y: 0, z: 0 };
    const updatedWorld = {
      x: (currentWorld.x || 0) + dx,
      y: (currentWorld.y || 0) + dy,
      z: (currentWorld.z || 0) + dz,
    };
    this._updateTokenWorldDuringMovement(state.token, updatedWorld);
  }

  _lockTokenWorldAuthority(state) {
    if (!state || !state.token || state.__worldLockActive) return;
    const token = state.token;
    const current = Number(token[TOKEN_WORLD_LOCK_PROP]) || 0;
    token[TOKEN_WORLD_LOCK_PROP] = current + 1;
    state.__worldLockActive = true;
  }

  _unlockTokenWorldAuthority(state) {
    if (!state || !state.token || !state.__worldLockActive) return;
    const token = state.token;
    const current = Number(token[TOKEN_WORLD_LOCK_PROP]) || 0;
    const next = current - 1;
    if (next > 0) {
      token[TOKEN_WORLD_LOCK_PROP] = next;
      state.__worldLockActive = true;
      return;
    }

    delete token[TOKEN_WORLD_LOCK_PROP];
    state.__worldLockActive = false;

    if (state.__pendingMovementResetOptions) {
      const pendingOptions = state.__pendingMovementResetOptions;
      state.__pendingMovementResetOptions = null;
      this._applyMovementResetCore(state, pendingOptions);
    }
  }

  _transferRootMotionToWorld(state, targetWorld = null, precomputedTransfer = null) {
    if (!state) return null;
    const transfer = precomputedTransfer || this._extractRootMotionOffset(state);
    const currentWorld = this._resolveTokenWorldPosition(state.token);
    let combinedOffset = null;

    if (transfer?.offsetWorld) {
      combinedOffset = {
        x: transfer.offsetWorld.x || 0,
        y: transfer.offsetWorld.y || 0,
        z: transfer.offsetWorld.z || 0,
      };
    }

    if (targetWorld && currentWorld) {
      const planned = combinedOffset || { x: 0, y: 0, z: 0 };
      const correction = {
        x: targetWorld.x - (currentWorld.x + planned.x),
        y: targetWorld.y - (currentWorld.y + planned.y),
        z: targetWorld.z - (currentWorld.z + planned.z),
      };
      const hasCorrection =
        Math.abs(correction.x) > 1e-5 ||
        Math.abs(correction.y) > 1e-5 ||
        Math.abs(correction.z) > 1e-5;
      if (hasCorrection) {
        if (!combinedOffset) {
          combinedOffset = correction;
        } else {
          combinedOffset.x += correction.x;
          combinedOffset.y += correction.y;
          combinedOffset.z += correction.z;
        }
      }
    }

    if (combinedOffset) {
      this._applyWorldOffsetToState(state, combinedOffset);
    }

    if (transfer) {
      this._resetRootBonePose(transfer.rootInfo);
    }

    return transfer || null;
  }

  _sanitizeLandingRootOffset(step, offsetWorld, landingKey = null) {
    if (!offsetWorld) return null;
    const tileSize = Math.max(this.gameManager?.spatial?.tileWorldSize || 1, 0.25);
    const offsetX = Number.isFinite(offsetWorld.x) ? offsetWorld.x : 0;
    const offsetY = Number.isFinite(offsetWorld.y) ? offsetWorld.y : 0;
    const offsetZ = Number.isFinite(offsetWorld.z) ? offsetWorld.z : 0;
    if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY) || !Number.isFinite(offsetZ)) {
      return null;
    }

    const landingVariant = landingKey || step?.landingVariant || null;
    const variantConfig =
      LANDING_OFFSET_SANITIZE_LIMITS[landingVariant] || LANDING_OFFSET_SANITIZE_LIMITS.default;
    const horizontalMultiplier = Math.max(Number(variantConfig?.horizontalMultiplier) || 1.5, 0.25);
    const horizontalBonusTiles = Math.max(Number(variantConfig?.horizontalBonusTiles) || 0, 0);
    const horizontalMaxTiles = Math.max(Number(variantConfig?.horizontalMaxTiles) || 0, 0) || 4;

    const horizontalMagnitude = Math.hypot(offsetX, offsetZ);
    const stepHorizontal = Math.max(step?.horizontalDistance || 0, 0);
    const horizontalLimitBase = stepHorizontal > 0 ? stepHorizontal : tileSize * 0.85;
    const configuredMax = horizontalMaxTiles > 0 ? horizontalMaxTiles : 6;
    const horizontalLimit = Math.max(
      Math.min(
        horizontalLimitBase * horizontalMultiplier + tileSize * horizontalBonusTiles,
        tileSize * configuredMax
      ),
      tileSize * 0.25
    );
    let clampedX = offsetX;
    let clampedZ = offsetZ;
    if (horizontalLimit > 0 && horizontalMagnitude > horizontalLimit + 1e-4) {
      const scale = horizontalLimit / horizontalMagnitude;
      clampedX *= scale;
      clampedZ *= scale;
    }

    const startWorldY = Number.isFinite(step?.startWorld?.y) ? step.startWorld.y : null;
    const targetWorldY = Number.isFinite(step?.targetWorld?.y) ? step.targetWorld.y : null;
    const verticalDelta =
      startWorldY != null && targetWorldY != null ? Math.abs(targetWorldY - startWorldY) : 0;
    const heightDrop = Math.max(Math.abs(step?.heightDrop || 0), verticalDelta);
    const verticalLimitBase = Math.max(heightDrop, tileSize * 0.35);
    const verticalLimit = Math.max(
      Math.min(verticalLimitBase * 1.5 + 0.35, tileSize * 5),
      tileSize * 0.2
    );

    let clampedY;
    if (verticalLimit > 0) {
      const verticalClamp = Math.min(Math.max(offsetY, -verticalLimit), verticalLimit);
      clampedY = verticalClamp;
    } else {
      clampedY = offsetY;
    }

    const epsilon = 1e-4;
    if (
      Math.abs(clampedX) < epsilon &&
      Math.abs(clampedY) < epsilon &&
      Math.abs(clampedZ) < epsilon
    ) {
      return null;
    }

    return { x: clampedX, y: clampedY, z: clampedZ };
  }

  _clampLandingOffsetToTargetTile(step, landingWorld, offset, landingKey = null) {
    if (!step || !landingWorld || !offset) return offset;
    const landingVariant = landingKey || step?.landingVariant || null;
    if (landingVariant && LANDING_VARIANTS_ALLOW_TILE_EXIT.has(landingVariant)) {
      return offset;
    }
    const targetGridX = Number.isFinite(step.gridTargetX) ? step.gridTargetX : null;
    const targetGridY = Number.isFinite(step.gridTargetY) ? step.gridTargetY : null;
    if (targetGridX == null && targetGridY == null) {
      return offset;
    }

    const withinTargetTile = (world) => {
      if (!world) return true;
      const mapped = this._mapWorldToGrid(world);
      if (!mapped) return true;
      if (targetGridX != null && mapped.gridX !== targetGridX) return false;
      if (targetGridY != null && mapped.gridY !== targetGridY) return false;
      return true;
    };

    const composeWorld = (baseWorld, appliedOffset) => ({
      x: (baseWorld?.x || 0) + (appliedOffset?.x || 0),
      y: (baseWorld?.y || 0) + (appliedOffset?.y || 0),
      z: (baseWorld?.z || 0) + (appliedOffset?.z || 0),
    });

    const initialWorld = composeWorld(landingWorld, offset);
    if (withinTargetTile(initialWorld)) {
      return offset;
    }

    let lo = 0;
    let hi = 1;
    let bestOffset = null;
    for (let i = 0; i < 15; i += 1) {
      const mid = (lo + hi) / 2;
      const scaledOffset = {
        x: offset.x * mid,
        y: offset.y * mid,
        z: offset.z * mid,
      };
      const scaledWorld = composeWorld(landingWorld, scaledOffset);
      if (withinTargetTile(scaledWorld)) {
        bestOffset = scaledOffset;
        lo = mid;
      } else {
        hi = mid;
      }
      if (hi - lo < 1e-3) {
        break;
      }
    }

    if (!bestOffset) {
      return null;
    }

    const epsilon = 1e-4;
    if (
      Math.abs(bestOffset.x) < epsilon &&
      Math.abs(bestOffset.y) < epsilon &&
      Math.abs(bestOffset.z) < epsilon
    ) {
      return null;
    }
    return bestOffset;
  }

  _ensureMovementState(tokenEntry) {
    if (!tokenEntry) return null;
    let state = this._movementStates.get(tokenEntry);
    const mesh = tokenEntry.__threeMesh;
    const animationData = this._tokenAnimationData.get(tokenEntry);
    if (state && mesh && state.mesh !== mesh) {
      state = null;
    }
    if (!state) {
      state = {
        token: tokenEntry,
        mesh: mesh || null,
        profile: animationData?.profile || DEFAULT_MOVEMENT_PROFILE,
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
          animationData?.profile?.startMoveDelay ?? DEFAULT_MOVEMENT_PROFILE.startMoveDelay,
        startBlendLead:
          animationData?.profile?.startToWalkBlendLead ??
          DEFAULT_MOVEMENT_PROFILE.startToWalkBlendLead,
        stopBlendLead:
          animationData?.profile?.stopBlendLead ?? DEFAULT_MOVEMENT_PROFILE.stopBlendLead,
        activeSpeed: animationData?.profile?.walkSpeed ?? DEFAULT_MOVEMENT_PROFILE.walkSpeed,
        activeDirectionSign: 1,
        stopTravelPortionCurrent:
          animationData?.profile?.stopTravelPortion ?? DEFAULT_MOVEMENT_PROFILE.stopTravelPortion,
        pathActive: false,
        pathGoal: null,
        pathSpeedMode: null,
        pathKey: null,
        pathTolerance: 0,
        pathReached: false,
        pathStallTime: 0,
        lastRequestedGoal: null,
        climbQueued: null,
        climbPendingInfo: null,
        climbActive: false,
        climbElapsed: 0,
        climbDuration: 0,
        climbStartWorld: null,
        climbTargetWorld: null,
        climbFinalWorld: null,
        climbData: null,
        climbWallQueue: null,
        climbWallActive: false,
        climbWallElapsed: 0,
        climbWallDuration: 0,
        climbWallStartWorld: null,
        climbWallTargetWorld: null,
        climbWallBaseDuration: 0,
        climbWallAnimationPlaying: false,
        climbRecoverActive: false,
        climbRecoverElapsed: 0,
        climbRecoverDuration: 0,
        climbRecoverStartWorld: null,
        climbRecoverAnchorPosition: null,
        climbRecoverCrouchWorld: null,
        climbRecoverCrouchDrop: 1.0,
        climbRecoverRiseHold: CLIMB_RECOVER_CROUCH_HOLD,
        climbRecoverStandRelease: CLIMB_RECOVER_STAND_RELEASE,
        rollRecoverActive: false,
        rollRecoverElapsed: 0,
        rollRecoverDuration: 0,
        rollRecoverAnchorWorld: null,
        climbLastWorld: null,
        climbAdvanceActive: false,
        climbAdvanceTargetWorld: null,
        climbContinuationGoal: null,
        __pathingLogFlags: new Set(),
        __resumeProbe: null,
      };
      this._movementStates.set(tokenEntry, state);
    } else {
      if (!state.mesh && mesh) {
        state.mesh = mesh;
      }
      if (!state.profile || state.profile === DEFAULT_MOVEMENT_PROFILE) {
        state.profile = animationData?.profile || DEFAULT_MOVEMENT_PROFILE;
      }
    }

    if (typeof state.pathStallTime !== 'number') {
      state.pathStallTime = 0;
    }
    if (!Object.prototype.hasOwnProperty.call(state, 'lastRequestedGoal')) {
      state.lastRequestedGoal = null;
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
    if (typeKey !== 'mannequin' && typeKey !== 'female-humanoid' && typeKey !== 'defeated-doll') {
      return false;
    }
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
      pathGoal: state.pathGoal
        ? { gridX: state.pathGoal.gridX, gridY: state.pathGoal.gridY }
        : null,
      movementSign: state.movementSign,
    });
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
      if (
        state.phase === 'idle' &&
        !this._hasActiveIntents(state) &&
        !this._shouldHoldMovementState(state)
      ) {
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

  _shouldHoldMovementState(state) {
    return Boolean(state?.__resumeProbe);
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

      const requestOptions = { ...options };
      const preferredSpeedMode = this._normalizePathSpeedMode(requestOptions.__preferredSpeedMode);
      const preserveLastGoal = !!requestOptions.__maintainLastRequestedGoal;
      if (preserveLastGoal) {
        delete requestOptions.__maintainLastRequestedGoal;
      }

      const state = this._ensureMovementState(tokenEntry);
      if (!state) return null;
      if (!preserveLastGoal) {
        this._clearResumeProbe(state);
        state.climbContinuationGoal = null;
      }
      state.pathStallTime = 0;
      const tokenDescriptor = this._describeTokenForLogs(tokenEntry);

      const currentGridX = Number.isFinite(tokenEntry.gridX) ? Math.round(tokenEntry.gridX) : 0;
      const currentGridY = Number.isFinite(tokenEntry.gridY) ? Math.round(tokenEntry.gridY) : 0;

      let targetGridX = Number.isFinite(gridX) ? Math.round(gridX) : currentGridX;
      let targetGridY = Number.isFinite(gridY) ? Math.round(gridY) : currentGridY;
      const requestedTargetGridX = targetGridX;
      const requestedTargetGridY = targetGridY;

      this._logPathing('navigate:start', {
        token: tokenDescriptor,
        from: { gridX: currentGridX, gridY: currentGridY },
        requested: { gridX: requestedTargetGridX, gridY: requestedTargetGridY },
        preserveLastGoal,
        options: { ...requestOptions },
      });

      if (!preserveLastGoal) {
        state.lastRequestedGoal = {
          gridX: requestedTargetGridX,
          gridY: requestedTargetGridY,
          options: { ...requestOptions },
        };
      }

      const sameTile = currentGridX === targetGridX && currentGridY === targetGridY;
      if (sameTile) {
        if (!preserveLastGoal) {
          state.lastRequestedGoal = null;
        }
        this._clearPathState(state, { silentResumeProbe: true });
        if (state.phase !== 'idle') {
          state.pendingStop = true;
        }
        this._logPathing('navigate:already-at-target', {
          token: tokenDescriptor,
          grid: { gridX: currentGridX, gridY: currentGridY },
        });
        return { goal: null, speedMode: null, distance: 0 };
      }

      const walkThreshold =
        Number.isFinite(requestOptions.walkThreshold) && requestOptions.walkThreshold >= 0
          ? requestOptions.walkThreshold
          : PATH_SPEED_WALK_MAX;
      const runThreshold =
        Number.isFinite(requestOptions.runThreshold) && requestOptions.runThreshold >= walkThreshold
          ? requestOptions.runThreshold
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
      if (preferredSpeedMode) {
        speedMode = preferredSpeedMode;
      }
      if (state.lastRequestedGoal?.options) {
        state.lastRequestedGoal.options.__preferredSpeedMode = speedMode;
      }

      let startHeightLevel = this._getTerrainHeight(currentGridX, currentGridY);
      let targetHeightLevel = this._getTerrainHeight(targetGridX, targetGridY);
      let heightDelta =
        Number.isFinite(startHeightLevel) && Number.isFinite(targetHeightLevel)
          ? targetHeightLevel - startHeightLevel
          : 0;

      const climbChainDepth = Number.isFinite(requestOptions.__intermediateClimbDepth)
        ? Math.max(0, requestOptions.__intermediateClimbDepth)
        : 0;
      let continuationGoal = state.climbContinuationGoal || null;

      if (climbChainDepth < MAX_INTERMEDIATE_CLIMB_CHAIN) {
        const intermediatePlan = this._planIntermediateClimbTraversal(
          currentGridX,
          currentGridY,
          targetGridX,
          targetGridY
        );
        if (intermediatePlan) {
          const planDiffersFromOriginal =
            intermediatePlan.climbGridX !== requestedTargetGridX ||
            intermediatePlan.climbGridY !== requestedTargetGridY;

          if (planDiffersFromOriginal) {
            continuationGoal = {
              gridX: requestedTargetGridX,
              gridY: requestedTargetGridY,
              options: {
                ...requestOptions,
                __intermediateClimbDepth: climbChainDepth + 1,
                __preferredSpeedMode: speedMode,
              },
            };
          }
          this._logPathing('navigate:intermediate-climb', {
            token: tokenDescriptor,
            intermediate: {
              approachGridX: intermediatePlan.approachGridX,
              approachGridY: intermediatePlan.approachGridY,
              climbGridX: intermediatePlan.climbGridX,
              climbGridY: intermediatePlan.climbGridY,
              heightDelta: intermediatePlan.heightDelta,
            },
            continuationGoal: continuationGoal
              ? { gridX: continuationGoal.gridX, gridY: continuationGoal.gridY }
              : null,
          });
          targetGridX = intermediatePlan.climbGridX;
          targetGridY = intermediatePlan.climbGridY;
          targetHeightLevel = this._getTerrainHeight(targetGridX, targetGridY);
          heightDelta =
            Number.isFinite(startHeightLevel) && Number.isFinite(targetHeightLevel)
              ? targetHeightLevel - startHeightLevel
              : heightDelta;
        }
      }
      const currentWorld = this._resolveTokenWorldPosition(tokenEntry);
      const fallbackHeight = Number.isFinite(options.elevation)
        ? options.elevation
        : (currentWorld?.y ?? 0);

      const targetCenterX = targetGridX + 0.5;
      const targetCenterY = targetGridY + 0.5;
      let targetCenterWorld = null;
      try {
        targetCenterWorld = spatial.gridToWorld(
          targetCenterX,
          targetCenterY,
          Number.isFinite(targetHeightLevel) ? targetHeightLevel : fallbackHeight
        );
      } catch (_) {
        targetCenterWorld = null;
      }

      const resolvedTargetX = Number.isFinite(targetCenterWorld?.x)
        ? targetCenterWorld.x
        : targetCenterX;
      const resolvedTargetZ = Number.isFinite(targetCenterWorld?.z)
        ? targetCenterWorld.z
        : targetCenterY;
      const resolvedTargetY = this._sampleWorldHeight(
        resolvedTargetX,
        resolvedTargetZ,
        Number.isFinite(targetCenterWorld?.y) ? targetCenterWorld.y : fallbackHeight
      );
      const targetWorld = {
        x: resolvedTargetX,
        z: resolvedTargetZ,
        y: resolvedTargetY,
      };

      const startWorldY = currentWorld?.y;
      const targetWorldReferenceY = Number.isFinite(targetCenterWorld?.y)
        ? targetCenterWorld.y
        : targetWorld?.y;

      const derivedStartHeightLevel = this._estimateHeightFromWorld(
        startWorldY,
        currentGridX,
        currentGridY
      );
      let resolvedStartHeightLevel = Number.isFinite(startHeightLevel)
        ? startHeightLevel
        : derivedStartHeightLevel;
      if (!Number.isFinite(resolvedStartHeightLevel)) {
        resolvedStartHeightLevel = 0;
      } else if (
        Number.isFinite(derivedStartHeightLevel) &&
        Math.abs(derivedStartHeightLevel - resolvedStartHeightLevel) > 1e-3
      ) {
        resolvedStartHeightLevel = derivedStartHeightLevel;
      }

      const derivedTargetHeightLevel = this._estimateHeightFromWorld(
        targetWorldReferenceY,
        targetGridX,
        targetGridY
      );
      let resolvedTargetHeightLevel = Number.isFinite(targetHeightLevel)
        ? targetHeightLevel
        : derivedTargetHeightLevel;
      if (!Number.isFinite(resolvedTargetHeightLevel)) {
        resolvedTargetHeightLevel = resolvedStartHeightLevel;
      } else if (
        Number.isFinite(derivedTargetHeightLevel) &&
        Math.abs(derivedTargetHeightLevel - resolvedTargetHeightLevel) > 1e-3
      ) {
        resolvedTargetHeightLevel = derivedTargetHeightLevel;
      }

      startHeightLevel = resolvedStartHeightLevel;
      targetHeightLevel = resolvedTargetHeightLevel;
      heightDelta =
        Number.isFinite(targetHeightLevel) && Number.isFinite(startHeightLevel)
          ? targetHeightLevel - startHeightLevel
          : 0;

      const climbEligible = heightDelta >= MAX_STANDARD_CLIMB_LEVELS;
      const elevationUnit =
        Number.isFinite(spatial?.elevationUnit) && spatial.elevationUnit > 0
          ? spatial.elevationUnit
          : 0.5;
      const toleranceBase =
        Number.isFinite(requestOptions.tolerance) && requestOptions.tolerance > 0
          ? requestOptions.tolerance
          : PATH_SPEED_DEFAULT_TOLERANCE;

      let pathGoalGridX = targetGridX;
      let pathGoalGridY = targetGridY;
      let pathGoalWorld = targetWorld;
      let pathTolerance = toleranceBase;

      if (climbEligible) {
        const stepX = Math.sign(targetGridX - currentGridX);
        const stepY = Math.sign(targetGridY - currentGridY);

        let approachGridX = targetGridX - stepX;
        let approachGridY = targetGridY - stepY;

        if (!Number.isFinite(approachGridX)) approachGridX = currentGridX;
        if (!Number.isFinite(approachGridY)) approachGridY = currentGridY;

        if (!this._isGridWithinBounds(approachGridX, approachGridY)) {
          approachGridX = currentGridX;
          approachGridY = currentGridY;
        }

        if (approachGridX === targetGridX && approachGridY === targetGridY) {
          approachGridX = currentGridX;
          approachGridY = currentGridY;
        }

        const approachHeightLevel = this._getTerrainHeight(approachGridX, approachGridY);
        let approachCenterWorld = null;
        try {
          approachCenterWorld = spatial.gridToWorld(
            approachGridX + 0.5,
            approachGridY + 0.5,
            Number.isFinite(approachHeightLevel) ? approachHeightLevel : fallbackHeight
          );
        } catch (_) {
          approachCenterWorld = null;
        }
        const approachX = Number.isFinite(approachCenterWorld?.x)
          ? approachCenterWorld.x
          : approachGridX + 0.5;
        const approachZ = Number.isFinite(approachCenterWorld?.z)
          ? approachCenterWorld.z
          : approachGridY + 0.5;
        const approachY = this._sampleWorldHeight(
          approachX,
          approachZ,
          Number.isFinite(approachCenterWorld?.y) ? approachCenterWorld.y : fallbackHeight
        );
        const approachWorld = { x: approachX, z: approachZ, y: approachY };

        const tileHalf =
          Number.isFinite(spatial?.tileWorldSize) && spatial.tileWorldSize > 0
            ? spatial.tileWorldSize * 0.5
            : 0.5;

        const dirX = targetWorld.x - approachWorld.x;
        const dirZ = targetWorld.z - approachWorld.z;
        const dirLen = Math.hypot(dirX, dirZ);
        const baseEntryRatio = Math.min(Math.max(CLIMB_WALL_ENTRY_TILE_HALF_RATIO, 0.05), 1);
        const entryVector = dirLen > 1e-4 ? { x: dirX / dirLen, z: dirZ / dirLen } : { x: 0, z: 0 };

        let wallEntryDepth = tileHalf * baseEntryRatio;
        if (dirLen > 1e-4) {
          wallEntryDepth = Math.min(Math.max(wallEntryDepth, 0), dirLen);
        } else {
          wallEntryDepth = 0;
        }

        const wallEntryWorld = this._cloneWorld(approachWorld) || approachWorld;
        wallEntryWorld.x += entryVector.x * wallEntryDepth;
        wallEntryWorld.z += entryVector.z * wallEntryDepth;

        let stopDepth = wallEntryDepth;
        const extraBackoff = (() => {
          if (speedMode === PATH_SPEED_MODES.RUN) {
            return tileHalf * CLIMB_WALL_ENTRY_RUN_BACKOFF_RATIO;
          }
          if (speedMode === PATH_SPEED_MODES.SPRINT) {
            return tileHalf * CLIMB_WALL_ENTRY_SPRINT_BACKOFF_RATIO;
          }
          return 0;
        })();
        const minStopDepth = CLIMB_WALL_ENTRY_MIN_RATIO * tileHalf;
        stopDepth = Math.max(wallEntryDepth - extraBackoff, minStopDepth);
        if (dirLen > 1e-4) {
          stopDepth = Math.min(stopDepth, dirLen);
        } else {
          stopDepth = 0;
        }

        const stopWorld = this._cloneWorld(approachWorld) || approachWorld;
        stopWorld.x += entryVector.x * stopDepth;
        stopWorld.z += entryVector.z * stopDepth;

        const edgeTopWorld = {
          x: wallEntryWorld.x,
          z: wallEntryWorld.z,
          y: targetWorld.y,
        };

        const availableWallHeight = Math.max((edgeTopWorld.y ?? 0) - (wallEntryWorld.y ?? 0), 0);
        const maxStandardWorldHeight = MAX_STANDARD_CLIMB_LEVELS * elevationUnit;
        const wallWorldTravel = Math.max(0, availableWallHeight - maxStandardWorldHeight);
        const extraWallLevels = Math.max(0, heightDelta - MAX_STANDARD_CLIMB_LEVELS);

        state.climbQueued = {
          targetGridX,
          targetGridY,
          targetHeight: targetHeightLevel,
          footWorld: this._cloneWorld(wallEntryWorld) || wallEntryWorld,
          edgeWorld: this._cloneWorld(edgeTopWorld) || edgeTopWorld,
          finalWorld: this._cloneWorld(targetWorld) || targetWorld,
          heightDelta,
          elevationUnit,
          extraWallLevels,
          wallWorldTravel,
        };

        this._logPathing('climb:queued', {
          token: tokenDescriptor,
          target: {
            gridX: targetGridX,
            gridY: targetGridY,
            heightDelta,
            extraWallLevels,
          },
          continuationGoal: continuationGoal
            ? { gridX: continuationGoal.gridX, gridY: continuationGoal.gridY }
            : null,
        });

        pathGoalGridX = approachGridX;
        pathGoalGridY = approachGridY;
        pathGoalWorld = stopWorld;
        pathTolerance = Math.min(toleranceBase, PATH_SPEED_DEFAULT_TOLERANCE * 0.5);
        if (speedMode === PATH_SPEED_MODES.RUN) {
          pathTolerance = Math.max(
            pathTolerance * CLIMB_APPROACH_TOLERANCE_RUN_SCALE,
            CLIMB_APPROACH_TOLERANCE_MIN
          );
        } else if (speedMode === PATH_SPEED_MODES.SPRINT) {
          pathTolerance = Math.max(
            pathTolerance * CLIMB_APPROACH_TOLERANCE_SPRINT_SCALE,
            CLIMB_APPROACH_TOLERANCE_MIN
          );
        }
      } else {
        state.climbQueued = null;
      }

      if (continuationGoal) {
        state.climbContinuationGoal = continuationGoal;
      }

      const orientationWorld = climbEligible ? pathGoalWorld : targetWorld;
      this._orientTokenTowardsWorld(tokenEntry, orientationWorld);

      const clearOptions = { silentResumeProbe: true };
      if (state.__resumeProbe) {
        clearOptions.preserveResumeProbe = true;
      }
      this._clearPathState(state, clearOptions);
      state.pathActive = true;
      state.pathGoal = { gridX: pathGoalGridX, gridY: pathGoalGridY, world: pathGoalWorld };
      state.pathSpeedMode = speedMode;
      state.pathTolerance = pathTolerance;
      state.pathReached = false;
      state.pathKey = PATH_NAVIGATION_KEY;

      if (state.forwardKeys && typeof state.forwardKeys.clear === 'function') {
        state.forwardKeys.clear();
      }
      if (state.backwardKeys && typeof state.backwardKeys.clear === 'function') {
        state.backwardKeys.clear();
      }
      state.forwardKeys.add(PATH_NAVIGATION_KEY);

      state.freeStartWorld = this._cloneWorld(currentWorld);
      state.freeLastWorld = this._cloneWorld(currentWorld);
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

      this._logPathing('navigate:path-issued', {
        token: tokenDescriptor,
        goal: state.pathGoal
          ? {
              gridX: state.pathGoal.gridX,
              gridY: state.pathGoal.gridY,
              world: state.pathGoal.world
                ? {
                    x: state.pathGoal.world.x,
                    y: state.pathGoal.world.y,
                    z: state.pathGoal.world.z,
                  }
                : null,
            }
          : null,
        speedMode,
        hasClimbQueued: Boolean(state.climbQueued),
        continuationGoal: state.climbContinuationGoal
          ? {
              gridX: state.climbContinuationGoal.gridX,
              gridY: state.climbContinuationGoal.gridY,
            }
          : null,
      });

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
      if (
        state.phase === 'idle' &&
        !this._hasActiveIntents(state) &&
        !this._shouldHoldMovementState(state)
      ) {
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
        if (
          state.phase === 'idle' &&
          !this._hasActiveIntents(state) &&
          !this._shouldHoldMovementState(state)
        ) {
          this._movementStates.delete(tokenEntry);
        }
        return;
      }

      if (state.phase === 'stop') {
        this._abortStopPhase(state);
      }

      if (netIntent !== state.movementSign) {
        state.freeStartWorld = this._resolveTokenWorldPosition(tokenEntry);
        state.freeLastWorld = this._cloneWorld(state.freeStartWorld);
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
    profile.climbClipDuration = this._extractClipDuration(actions.climb) || clips.climb || 0;
    profile.climbWallClipDuration =
      this._extractClipDuration(actions.climbWall) || clips.climbWall || profile.climbClipDuration;
    profile.hardLandingClipDuration =
      this._extractClipDuration(actions.hardLanding) || clips.hardLanding || 0;
    profile.fallToRollClipDuration =
      this._extractClipDuration(actions.fallToRoll) || clips.fallToRoll || 0;
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
          case 'climb-wall':
            this._advanceClimbWallPhase(state, delta);
            break;
          case 'climb':
            this._advanceClimbPhase(state, delta);
            break;
          case 'climb-recover':
            this._advanceClimbRecoverPhase(state, delta);
            break;
          case 'roll-recover':
            this._advanceRollRecoverPhase(state, delta);
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
      this._resetMovementState(state, { useStopBlend: true, clearStopFlags: true });
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
      this._resetMovementState(state, { useStopBlend: true, clearStopFlags: true });
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

  _finishFallPhase(state) {
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

    const finalizedLandingWorld =
      transferTargetWorld || this._resolveTokenWorldPosition(state.token);
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

    const recoverStarted = this._initiateRollRecover(state, finalizedLandingWorld);
    if (recoverStarted) {
      return;
    }

    const resumed = this._resumeMovementAfterFall(state);
    if (resumed) {
      return;
    }

    this._finalizePostFallState(state, profile);
  }

  _finalizePostFallState(state, profileOverride = null) {
    if (!state) return;
    const profile = profileOverride || state.profile || DEFAULT_MOVEMENT_PROFILE;
    state.phase = 'idle';
    state.rollRecoverActive = false;
    state.rollRecoverElapsed = 0;
    state.rollRecoverDuration = 0;
    state.rollRecoverAnchorWorld = null;
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

  _initiateRollRecover(state, anchorWorld) {
    if (!state) return false;
    const animationData = this._tokenAnimationData.get(state.token);
    const recoverAction = animationData?.actions?.climbRecover;
    if (!recoverAction) return false;
    const profile = animationData?.profile || state.profile || DEFAULT_MOVEMENT_PROFILE;
    const duration =
      this._extractClipDuration(recoverAction) ||
      animationData?.clips?.climbRecover ||
      profile?.climbRecoverDuration ||
      DEFAULT_CLIMB_RECOVER_DURATION;
    if (!(duration > 1e-4)) {
      return false;
    }

    const anchor = anchorWorld
      ? this._cloneWorld(anchorWorld)
      : this._resolveTokenWorldPosition(state.token);
    if (anchor) {
      this._syncTokenAndMeshWorld(state, anchor);
    }

    state.phase = 'roll-recover';
    state.rollRecoverActive = true;
    state.rollRecoverElapsed = 0;
    state.rollRecoverDuration = duration;
    state.rollRecoverAnchorWorld = anchor;
    state.intentHold = false;
    state.pendingStop = false;
    state.stopTriggered = false;

    const fadeIn = profile?.climbRecoverFadeIn ?? profile.walkFadeIn ?? 0.18;
    const fadeOut = profile?.climbRecoverFadeOut ?? profile.walkFadeOut ?? 0.18;
    this._setAnimation(state.token, 'climbRecover', {
      fadeIn,
      fadeOut,
      force: true,
    });
    return true;
  }

  _advanceRollRecoverPhase(state, delta) {
    if (!state) return;
    if (!state.rollRecoverActive) {
      this._completeRollRecover(state);
      return;
    }

    const duration = state.rollRecoverDuration || DEFAULT_CLIMB_RECOVER_DURATION;
    if (!(duration > 1e-4)) {
      state.rollRecoverActive = false;
      this._completeRollRecover(state);
      return;
    }

    state.rollRecoverElapsed = Math.min(state.rollRecoverElapsed + Math.max(delta, 0), duration);
    const anchor = state.rollRecoverAnchorWorld;
    if (anchor) {
      this._syncTokenAndMeshWorld(state, anchor);
    }

    if (state.rollRecoverElapsed >= duration - 1e-4) {
      state.rollRecoverActive = false;
      this._completeRollRecover(state);
    }
  }

  _completeRollRecover(state) {
    if (!state) return;
    const anchorWorld = state.rollRecoverAnchorWorld
      ? this._cloneWorld(state.rollRecoverAnchorWorld)
      : null;
    if (anchorWorld) {
      this._syncTokenAndMeshWorld(state, anchorWorld);
      this._applyTokenGridFromWorld(state.token, anchorWorld);
    }
    state.rollRecoverActive = false;
    state.rollRecoverDuration = 0;
    state.rollRecoverElapsed = 0;
    state.rollRecoverAnchorWorld = null;
    state.phase = 'idle';
    const resumed = this._resumeMovementAfterFall(state);
    if (resumed) {
      return;
    }
    this._finalizePostFallState(state);
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
    if (preferredKey === 'fallToRoll' && actions.fallToRoll) return 'fallToRoll';
    if (preferredKey === 'hardLanding' && actions.hardLanding) return 'hardLanding';
    if (preferredKey === 'fall' && actions.fall) return 'fall';
    if (actions.fallToRoll) return 'fallToRoll';
    if (actions.hardLanding) return 'hardLanding';
    if (actions.fall) return 'fall';
    return null;
  }

  _getLandingClipDuration(profile, landingKey) {
    const base = profile || DEFAULT_MOVEMENT_PROFILE;
    if (landingKey === 'hardLanding') {
      return (
        base.hardLandingClipDuration || base.fallClipDuration || base.fallLoopClipDuration || 0
      );
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
      return (
        base.fallClipDuration || base.hardLandingClipDuration || base.fallLoopClipDuration || 0
      );
    }
    return base.fallClipDuration || base.hardLandingClipDuration || base.fallLoopClipDuration || 0;
  }

  _computeLandingThreshold(distance, landingKey) {
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

  _maybeEnterFallPhase(state, animationData) {
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

  _advanceMovementStep(state, distance, options = {}) {
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

    step.horizontalTraveled = Math.hypot(
      pos.x - step.startPosition.x,
      pos.z - step.startPosition.z
    );
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

  _advanceFreeMovement(state, delta, bounds) {
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

  _clearPathState(state, options = {}) {
    if (!state) return;
    const {
      silentResumeProbe = false,
      resumeProbeReason = 'path-cleared',
      resumeProbeDetails = {},
      preserveResumeProbe = false,
    } = options;
    if (state.pathKey && state.forwardKeys?.has(state.pathKey)) {
      state.forwardKeys.delete(state.pathKey);
    }
    state.pathActive = false;
    state.pathGoal = null;
    state.pathSpeedMode = null;
    state.pathKey = null;
    state.pathTolerance = 0;
    state.pathReached = false;
    state.__pathAdvanceLogAt = 0;
    if (!preserveResumeProbe) {
      if (silentResumeProbe) {
        this._clearResumeProbe(state);
      } else {
        this._abortResumeProbe(state, resumeProbeReason, resumeProbeDetails);
      }
    }
    if (state.__pathingLogFlags && typeof state.__pathingLogFlags.clear === 'function') {
      state.__pathingLogFlags.clear();
    }
  }

  _resetClimbWallState(state, options = {}) {
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

  _resetClimbRecoverState(state) {
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

  _clearClimbState(state) {
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

  _resolveClimbLandingWorld(state) {
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

  _resolveClimbRecoverWorld(state) {
    if (!state) return null;
    return this._cloneWorldWithFallback(
      state.climbRecoverStartWorld,
      state.climbLastWorld,
      state.climbTargetWorld,
      state.climbStartWorld
    );
  }

  _finalizeClimbLanding(state, options = {}) {
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

  _resetClimbLandingState(state, options = {}) {
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
  _completePath(state) {
    if (!state) return;
    const goal = state.pathGoal;
    const tokenEntry = state.token;
    const mesh = state.mesh;
    const climbInfo = this._cloneClimbWorldInfo(state.climbQueued);

    const tokenDescriptor = this._describeTokenForLogs(tokenEntry);
    this._logPathing('path:complete', {
      token: tokenDescriptor,
      goal: goal
        ? {
            gridX: goal.gridX,
            gridY: goal.gridY,
          }
        : null,
      hadClimbQueued: Boolean(climbInfo),
    });

    this._clearPathState(state);
    state.intentHold = false;
    state.pendingStop = false;
    state.movementSign = 0;
    state.lastMoveSign = 0;

    if (goal) {
      if (Number.isFinite(goal.gridX)) tokenEntry.gridX = goal.gridX;
      if (Number.isFinite(goal.gridY)) tokenEntry.gridY = goal.gridY;
      const goalWorld = this._cloneWorld(goal.world);
      if (goalWorld) {
        this._syncTokenAndMeshWorld(state, goalWorld, { token: tokenEntry, mesh });
      }
    }

    if (climbInfo) {
      this._logPathing('path:complete-start-climb', {
        token: tokenDescriptor,
        target: {
          gridX: climbInfo.targetGridX,
          gridY: climbInfo.targetGridY,
          heightDelta: climbInfo.heightDelta,
        },
      });
      this._startClimbPhase(state, climbInfo);
      return;
    }

    this._resetMovementState(state);
  }

  _startClimbPhase(state, climbInfo, options = {}) {
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
    const targetEdge =
      this._cloneWorldWithFallback(climbInfo.edgeWorld, climbInfo.finalWorld) || {};
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

  _maybeStartClimbWallSequence(state, climbInfo, animationData) {
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

  _planClimbWallSegments(state, climbInfo, animationData) {
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

  _startNextClimbWallSegment(state, animationData) {
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

  _advanceClimbWallPhase(state, delta) {
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

  _resumeStandardClimbAfterWall(state) {
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

  _commitClimbWallPose(state, anchorWorld) {
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

  _maybePrestartClimbAnimation(state, duration) {
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

  _resolveClimbWallDuration(state) {
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

  _advanceClimbPhase(state, delta) {
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

  _startClimbRecoverPhase(state) {
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

  _advanceClimbRecoverPhase(state, delta) {
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

  _resolveClimbRecoverCrouchDrop(state, rootTransfer) {
    const profile = state?.profile || DEFAULT_MOVEMENT_PROFILE;
    const minDrop = Math.max(
      profile?.climbRecoverCrouchMinDrop ?? CLIMB_RECOVER_MIN_CROUCH_DROP,
      0
    );
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

  _resolveClimbRecoverRiseWindow(state) {
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

  _resolveClimbRecoverRiseRatio(state, progress) {
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

  _advanceClimbAdvancePhase(state, delta) {
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

  _startClimbAdvancePhase(state, startWorld, finalWorld) {
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

  _createClimbAdvanceStep(state, startWorld, finalWorld) {
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

  _shouldStartClimbAdvance(state, startWorld, finalWorld) {
    if (!state || state.climbAdvanceActive) return false;
    if (!(state.climbRecoverDuration > 1e-4)) return false;
    if (!startWorld || !finalWorld) return false;
    const dx = (finalWorld.x || 0) - (startWorld.x || 0);
    const dz = (finalWorld.z || 0) - (startWorld.z || 0);
    return dx * dx + dz * dz > 1e-4;
  }

  _resolveClimbFinalWorld(state) {
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

  _reissueMaintainedGoal(state, goal, options = {}) {
    if (!state?.token || !goal) return false;
    const gm = this.gameManager;
    if (!gm?.is3DModeActive?.()) return false;

    const tokenDescriptor = this._describeTokenForLogs(state.token);

    const targetGridX = Number.isFinite(goal.gridX) ? Math.round(goal.gridX) : null;
    const targetGridY = Number.isFinite(goal.gridY) ? Math.round(goal.gridY) : null;
    if (targetGridX == null || targetGridY == null) {
      return false;
    }

    this._logPathing('path:reissue-goal:attempt', {
      token: tokenDescriptor,
      goal: { gridX: targetGridX, gridY: targetGridY },
      allowSameTile: !!options?.allowSameTile,
    });

    if (!options?.allowSameTile) {
      const currentGridX = Number.isFinite(state.token.gridX)
        ? Math.round(state.token.gridX)
        : null;
      const currentGridY = Number.isFinite(state.token.gridY)
        ? Math.round(state.token.gridY)
        : null;
      if (currentGridX != null && currentGridY != null) {
        if (currentGridX === targetGridX && currentGridY === targetGridY) {
          return false;
        }
      }
    }

    const requestOptions = {
      ...(goal.options || {}),
      __maintainLastRequestedGoal: true,
    };

    const result = this.navigateToGrid(state.token, targetGridX, targetGridY, requestOptions);
    const succeeded = !!result;
    this._logPathing('path:reissue-goal:result', {
      token: tokenDescriptor,
      goal: { gridX: targetGridX, gridY: targetGridY },
      succeeded,
    });
    return succeeded;
  }

  _resumeCachedPostClimbGoal(state) {
    return this._reissueMaintainedGoal(state, state?.lastRequestedGoal);
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

  _normalizePathSpeedMode(mode) {
    if (!mode) return null;
    const value = typeof mode === 'string' ? mode.toLowerCase() : mode;
    if (value === PATH_SPEED_MODES.WALK) return PATH_SPEED_MODES.WALK;
    if (value === PATH_SPEED_MODES.RUN) return PATH_SPEED_MODES.RUN;
    if (value === PATH_SPEED_MODES.SPRINT) return PATH_SPEED_MODES.SPRINT;
    return null;
  }

  _computeGridDistance(ax, ay, bx, by) {
    const fromX = Number.isFinite(ax) ? Math.round(ax) : 0;
    const fromY = Number.isFinite(ay) ? Math.round(ay) : 0;
    const toX = Number.isFinite(bx) ? Math.round(bx) : 0;
    const toY = Number.isFinite(by) ? Math.round(by) : 0;
    return Math.abs(fromX - toX) + Math.abs(fromY - toY);
  }

  _planIntermediateClimbTraversal(startGridX, startGridY, targetGridX, targetGridY) {
    if (startGridX === targetGridX && startGridY === targetGridY) return null;
    const gm = this.gameManager;
    if (!gm?.spatial) return null;

    const evaluateStep = (fromX, fromY, toX, toY, stepIndex) => {
      if (!this._isGridWithinBounds(toX, toY)) {
        return null;
      }
      const prevHeight = this._getTerrainHeight(fromX, fromY);
      const nextHeight = this._getTerrainHeight(toX, toY);
      const heightDelta =
        Number.isFinite(prevHeight) && Number.isFinite(nextHeight) ? nextHeight - prevHeight : 0;
      if (heightDelta >= MAX_STANDARD_CLIMB_LEVELS) {
        return {
          approachGridX: fromX,
          approachGridY: fromY,
          climbGridX: toX,
          climbGridY: toY,
          heightDelta,
          stepIndex,
        };
      }
      return null;
    };

    const evaluateLineTraversal = () => {
      const dx = targetGridX - startGridX;
      const dy = targetGridY - startGridY;
      if (dx === 0 && dy === 0) return null;
      const stepX = dx === 0 ? 0 : dx > 0 ? 1 : -1;
      const stepY = dy === 0 ? 0 : dy > 0 ? 1 : -1;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);
      let cursorX = startGridX;
      let cursorY = startGridY;
      let err = absDx - absDy;
      let stepIndex = 0;
      while (cursorX !== targetGridX || cursorY !== targetGridY) {
        const prevX = cursorX;
        const prevY = cursorY;
        const err2 = err * 2;
        if (err2 > -absDy) {
          err -= absDy;
          cursorX += stepX;
        }
        if (err2 < absDx) {
          err += absDx;
          cursorY += stepY;
        }
        const plan = evaluateStep(prevX, prevY, cursorX, cursorY, stepIndex);
        if (plan) {
          return plan;
        }
        stepIndex += 1;
      }
      return null;
    };

    const linePlan = evaluateLineTraversal();
    if (linePlan) {
      return linePlan;
    }

    const evaluateOrder = (axesOrder) => {
      let cursorX = startGridX;
      let cursorY = startGridY;
      let stepIndex = 0;
      for (const axis of axesOrder) {
        const targetValue = axis === 'x' ? targetGridX : targetGridY;
        const delta = (axis === 'x' ? targetValue - cursorX : targetValue - cursorY) || 0;
        const step = Math.sign(delta);
        if (step === 0) continue;
        while ((axis === 'x' ? cursorX : cursorY) !== targetValue) {
          const nextX = axis === 'x' ? cursorX + step : cursorX;
          const nextY = axis === 'y' ? cursorY + step : cursorY;
          const plan = evaluateStep(cursorX, cursorY, nextX, nextY, stepIndex);
          if (plan) {
            return plan;
          }
          cursorX = nextX;
          cursorY = nextY;
          stepIndex += 1;
        }
      }
      return null;
    };

    const plans = [];
    const axisOrders = [
      ['x', 'y'],
      ['y', 'x'],
    ];
    for (const order of axisOrders) {
      const plan = evaluateOrder(order);
      if (plan) {
        plans.push(plan);
      }
    }

    if (!plans.length) return null;
    plans.sort((a, b) => a.stepIndex - b.stepIndex);
    const best = plans[0];
    if (!best) return null;
    return {
      approachGridX: best.approachGridX,
      approachGridY: best.approachGridY,
      climbGridX: best.climbGridX,
      climbGridY: best.climbGridY,
      heightDelta: best.heightDelta,
    };
  }

  _attemptIntermediateClimbRedirect(state) {
    if (!state || !state.token) return false;
    const continuationGoal = state.climbContinuationGoal;
    const fallbackGoal = state.lastRequestedGoal;
    const targetGoal = continuationGoal || fallbackGoal;
    if (!targetGoal) {
      return false;
    }

    const tokenDescriptor = this._describeTokenForLogs(state.token);
    this._logPathing('path:attempt-intermediate-redirect', {
      token: tokenDescriptor,
      targetGoal: {
        gridX: targetGoal.gridX,
        gridY: targetGoal.gridY,
      },
      source: continuationGoal ? 'continuation' : 'fallback',
    });

    const resumed = this._reissueMaintainedGoal(state, targetGoal, {
      allowSameTile: true,
    });

    if (resumed && targetGoal) {
      state.climbContinuationGoal = this._cloneClimbContinuationGoal(targetGoal);
    }

    this._logPathing('path:attempt-intermediate-redirect:result', {
      token: tokenDescriptor,
      resumed,
    });

    return resumed;
  }

  _lockStepAtTarget(state) {
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

  _triggerStop(state) {
    if (!state || state.phase === 'stop') return;
    this._initiateStopPhase(state);
  }

  _resetMovementState(state, options = {}) {
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

  _mergePendingMovementResetOptions(state, options = {}) {
    if (!state) return;
    const pending = state.__pendingMovementResetOptions || {};
    state.__pendingMovementResetOptions = {
      useStopBlend: pending.useStopBlend || Boolean(options.useStopBlend),
      clearStopFlags: pending.clearStopFlags || Boolean(options.clearStopFlags),
    };
  }

  _applyMovementResetCore(state, options = {}) {
    if (!state) return;
    const { useStopBlend = false, clearStopFlags = false } = options;
    const profile = state.profile || DEFAULT_MOVEMENT_PROFILE;

    state.__pendingMovementResetOptions = null;
    state.phase = 'idle';
    state.activeStep = null;
    state.stepFinalized = true;
    state.intentHold = false;
    state.rollRecoverActive = false;
    state.rollRecoverElapsed = 0;
    state.rollRecoverDuration = 0;
    state.rollRecoverAnchorWorld = null;

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

      const startWorld =
        this._cloneWorld(tokenEntry.world) ||
        gm.spatial.gridToWorld(startGridX + 0.5, startGridY + 0.5, startHeight);
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

  _ensureFallStepActive(state) {
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

  _clearFallStepState(state, options = {}) {
    if (!state) return;
    const force = options.force === true;
    state.__fallStepActive = false;
    if (state.activeStep?.__fallSingleUse && (force || state.stepFinalized)) {
      state.activeStep = null;
    }
  }

  _captureFallResumeContext(state) {
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

  _resumeMovementAfterFall(state) {
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

  _cloneWorld(world) {
    return world ? { ...world } : null;
  }

  _cloneClimbWorldInfo(info) {
    if (!info) return null;
    return {
      ...info,
      footWorld: this._cloneWorld(info.footWorld),
      edgeWorld: this._cloneWorld(info.edgeWorld),
      finalWorld: this._cloneWorld(info.finalWorld),
    };
  }

  _cloneWorldWithFallback(...worlds) {
    for (const world of worlds) {
      const cloned = this._cloneWorld(world);
      if (cloned) return cloned;
    }
    return null;
  }

  _cloneClimbContinuationGoal(goal) {
    if (!goal) return null;
    return {
      gridX: goal.gridX,
      gridY: goal.gridY,
      options: goal.options ? { ...goal.options } : undefined,
    };
  }

  _assignClimbRecoverAnchorPosition(state, anchorWorld) {
    if (!state) return;
    const mesh = state.mesh;
    if (anchorWorld) {
      const composed = this._applyMeshWorldPosition(mesh, anchorWorld);
      if (composed) {
        state.climbRecoverAnchorPosition = { x: composed.x, y: composed.y, z: composed.z };
        return;
      }
    }
    if (mesh?.position) {
      state.climbRecoverAnchorPosition = {
        x: Number(mesh.position.x) || 0,
        y: Number(mesh.position.y) || 0,
        z: Number(mesh.position.z) || 0,
      };
    } else {
      state.climbRecoverAnchorPosition = null;
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

  _applyMeshWorldPosition(mesh, world) {
    if (!mesh?.position?.set) return null;
    const composed = this._composeMeshPosition(world, mesh);
    mesh.position.set(composed.x, composed.y, composed.z);
    return composed;
  }

  _syncTokenAndMeshWorld(state, world, options = {}) {
    if (!state || !world) return null;
    const tokenEntry = options.token ?? state.token;
    if (!tokenEntry) return null;
    const meshOption = options.mesh;
    const mesh = meshOption === undefined ? state.mesh || tokenEntry.__threeMesh : meshOption;
    this._updateTokenWorldDuringMovement(tokenEntry, world);
    if (!mesh) {
      return null;
    }
    return this._applyMeshWorldPosition(mesh, world);
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

  _mapWorldToGrid(world) {
    if (!world) return null;
    const spatial = this.gameManager?.spatial;
    if (!spatial?.worldToGrid) return null;
    try {
      const mapped = spatial.worldToGrid(world.x, world.z);
      const gridX = Number.isFinite(mapped?.gridX) ? Math.round(mapped.gridX) : null;
      const gridY = Number.isFinite(mapped?.gridY) ? Math.round(mapped.gridY) : null;
      if (gridX == null && gridY == null) {
        return null;
      }
      return { gridX, gridY };
    } catch (_) {
      return null;
    }
  }

  _applyTokenGridFromWorld(tokenEntry, world) {
    if (!tokenEntry || !world) return;
    const mapped = this._mapWorldToGrid(world);
    if (!mapped) return;
    if (mapped.gridX != null) tokenEntry.gridX = mapped.gridX;
    if (mapped.gridY != null) tokenEntry.gridY = mapped.gridY;
  }

  _applyStepGridFromWorld(step, world) {
    if (!step || !world) return;
    const mapped = this._mapWorldToGrid(world);
    if (!mapped) return;
    if (mapped.gridX != null) step.gridTargetX = mapped.gridX;
    if (mapped.gridY != null) step.gridTargetY = mapped.gridY;
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
    delete tokenEntry[TOKEN_WORLD_LOCK_PROP];
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
    if (previous) void this._refreshVisualState(previous);
    if (tokenEntry) void this._refreshVisualState(tokenEntry);
  }

  async setSelectedToken(tokenEntry) {
    if (this._selectedToken === tokenEntry) return;
    const previous = this._selectedToken;
    this._selectedToken = tokenEntry || null;
    if (previous) {
      await this._refreshVisualState(previous);
    }
    if (tokenEntry) {
      await this._refreshVisualState(tokenEntry);
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
  }

  _applyOrientationImmediate(tokenEntry, angle) {
    const mesh = tokenEntry?.__threeMesh;
    const globalFlip = this._getGlobalFacingRight() ? 0 : Math.PI;

    const is3DToken = !!mesh?.userData?.__tt3DToken;
    if (mesh && is3DToken) {
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
    } else if (mesh) {
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
    while (normalized < -Math.PI) normalized += tau;
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
    if (tokenEntry.__threeMesh.userData?.__tt3DToken === false) return null;
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

  _setSelectionIndicatorSuppressed(state, suppressed) {
    if (!state) return;
    const next = !!suppressed;
    if (state.selectionIndicatorSuppressed === next) return;
    state.selectionIndicatorSuppressed = next;
    if (next) {
      this._hideSelectionIndicator(state.token);
    } else if (this._selectedToken === state.token) {
      this._refreshVisualState(state.token);
    }
  }

  _refreshVisualState(tokenEntry) {
    const mesh = tokenEntry?.__threeMesh;
    if (!mesh) return null;
    const is3DToken = mesh.userData?.__tt3DToken !== false;
    const state = this._movementStates.get(tokenEntry);
    const indicatorSuppressed = !!state?.selectionIndicatorSuppressed;
    const canShowSelectionIndicator = is3DToken && !indicatorSuppressed;

    if (this._selectedToken === tokenEntry) {
      this._restoreMaterial(mesh);
      if (is3DToken) {
        if (canShowSelectionIndicator) {
          return this._showSelectionIndicator(tokenEntry);
        } else {
          this._hideSelectionIndicator(tokenEntry);
        }
      } else {
        this._hideSelectionIndicator(tokenEntry);
        this._applyTint(mesh, this._selectionColor);
      }
      return null;
    }

    if (this._hoverToken === tokenEntry) {
      this._restoreMaterial(mesh);
      if (is3DToken) {
        this._hideSelectionIndicator(tokenEntry);
      } else {
        this._applyTint(mesh, 0x88ccff);
        this._hideSelectionIndicator(tokenEntry);
      }
      return null;
    }

    this._restoreMaterial(mesh);
    this._hideSelectionIndicator(tokenEntry);
    return null;
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

  _attachSelectionCollider(container, three, config = {}) {
    if (!container || !three) return;
    if (!container.userData) container.userData = {};
    if (container.userData.__ttSelectionCollider) return;

    try {
      const tileSize = Math.max(this.gameManager?.spatial?.tileWorldSize || 1, 1e-4);
      const radiusSetting = Number.isFinite(config.selectionColliderRadius)
        ? config.selectionColliderRadius
        : tileSize * SELECTION_COLLIDER_RADIUS_RATIO;
      const heightSetting = Number.isFinite(config.selectionColliderHeight)
        ? config.selectionColliderHeight
        : SELECTION_COLLIDER_HEIGHT;
      const radius = Math.max(radiusSetting, tileSize * 0.3);
      const height = Math.max(heightSetting, tileSize * 0.8);

      const geometry = new three.CylinderGeometry(radius, radius, height, 14, 1, false);
      const material = new three.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        depthTest: false,
      });
      const collider = new three.Mesh(geometry, material);
      collider.name = 'TokenSelectionCollider';
      collider.position.y = height * 0.5;
      collider.renderOrder = -10;
      container.add(collider);
      container.userData.__ttSelectionCollider = collider;
    } catch (_) {
      /* ignore collider issues */
    }
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
