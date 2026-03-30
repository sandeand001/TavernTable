/**
 * PathingLogger.js
 *
 * Pathing telemetry, debug logging, and fall-height sampling helpers.
 * Every function uses `this` and is designed to be installed on a class
 * prototype via `installPathingLoggerMethods(prototype)`.
 */

import {
  PATHING_LOG_LOCAL_STORAGE_KEY,
  PATHING_LOG_ENV_FLAG,
  PATHING_LOG_PREFIX,
  PATHING_LOG_ARCHIVE_LIMIT,
  FALL_HEIGHT_VERBOSE_STORAGE_KEYS,
} from '../../../config/token-adapter/MannequinConfig.js';

// ── Logging Toggle ─────────────────────────────────────────────────

function setPathingLoggingEnabled(isEnabled) {
  if (typeof isEnabled === 'boolean') {
    this._pathingLoggingEnabledOverride = isEnabled;
  } else {
    this._pathingLoggingEnabledOverride = undefined;
  }
}

function _isPathingLoggingEnabled() {
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
      typeof globalThis !== 'undefined' && globalThis.process ? globalThis.process.env : undefined;
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

// ── Token Description ──────────────────────────────────────────────

function _describeTokenForLogs(tokenEntry) {
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

// ── Core Logging ───────────────────────────────────────────────────

function _logPathing(event, payload = {}, level = 'info') {
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

function _archivePathingLog(entry) {
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

function getPathingLogArchive(limit = PATHING_LOG_ARCHIVE_LIMIT) {
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

function clearPathingLogArchive() {
  if (this._pathingLogArchive) {
    this._pathingLogArchive.length = 0;
  }
}

function _logPathingOnce(state, flag, event, payload = {}, level = 'info') {
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

// ── Fall-Height Logging ────────────────────────────────────────────

function _isFallHeightLoggingEnabled() {
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

function _resolveFallHeightLoggingEnabled() {
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

function _isFallHeightVerboseMode() {
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

function _resolveFallHeightVerboseMode() {
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

function _logFallHeightSample(state, label, step = null, extra = {}) {
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
  const baseOffset = this._getMeshVerticalOffset(mesh);
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

function _emitConsoleFallHeightSample(payload) {
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

// ── Timestamp ──────────────────────────────────────────────────────

function _getPathingTimestamp() {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return performance.now();
  }
  return Date.now();
}

// ── Install ────────────────────────────────────────────────────────

/**
 * Attach all pathing/logging methods to the given prototype.
 */
function installPathingLoggerMethods(prototype) {
  prototype.setPathingLoggingEnabled = setPathingLoggingEnabled;
  prototype._isPathingLoggingEnabled = _isPathingLoggingEnabled;
  prototype._describeTokenForLogs = _describeTokenForLogs;
  prototype._logPathing = _logPathing;
  prototype._archivePathingLog = _archivePathingLog;
  prototype.getPathingLogArchive = getPathingLogArchive;
  prototype.clearPathingLogArchive = clearPathingLogArchive;
  prototype._logPathingOnce = _logPathingOnce;
  prototype._isFallHeightLoggingEnabled = _isFallHeightLoggingEnabled;
  prototype._resolveFallHeightLoggingEnabled = _resolveFallHeightLoggingEnabled;
  prototype._isFallHeightVerboseMode = _isFallHeightVerboseMode;
  prototype._resolveFallHeightVerboseMode = _resolveFallHeightVerboseMode;
  prototype._logFallHeightSample = _logFallHeightSample;
  prototype._emitConsoleFallHeightSample = _emitConsoleFallHeightSample;
  prototype._getPathingTimestamp = _getPathingTimestamp;
}

export { installPathingLoggerMethods };
