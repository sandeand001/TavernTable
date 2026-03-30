// ── Shared Level Utilities ──────────────────────────────────────
import { LOG_LEVEL } from '../enums.js';

const LOG_LEVEL_VALUES = new Set(Object.values(LOG_LEVEL));
const LOG_LEVEL_NAME_LOOKUP = Object.keys(LOG_LEVEL).reduce((map, key) => {
  map[key] = LOG_LEVEL[key];
  map[key.toLowerCase()] = LOG_LEVEL[key];
  return map;
}, {});

export const isValidLogLevel = (level) => LOG_LEVEL_VALUES.has(level);

export const normalizeLevelInput = (value) => {
  if (typeof value === 'number' && isValidLogLevel(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const upper = trimmed.toUpperCase();
    if (LOG_LEVEL_NAME_LOOKUP[upper] != null) return LOG_LEVEL_NAME_LOOKUP[upper];
    const lower = trimmed.toLowerCase();
    if (LOG_LEVEL_NAME_LOOKUP[lower] != null) return LOG_LEVEL_NAME_LOOKUP[lower];
  }
  return null;
};

export const readFromProcessEnv = (keys = []) => {
  for (const key of keys) {
    try {
      const envValue = globalThis?.process?.env?.[key];
      if (typeof envValue === 'string' && envValue.trim()) return envValue;
    } catch (_) {
      /* ignore env access issues */
    }
  }
  return null;
};

export const readFromGlobalFlags = (keys = []) => {
  for (const key of keys) {
    try {
      if (typeof window !== 'undefined' && window[key] != null) return window[key];
    } catch (_) {
      /* ignore window access */
    }
    try {
      if (typeof globalThis !== 'undefined' && key in globalThis && globalThis[key] != null) {
        return globalThis[key];
      }
    } catch (_) {
      /* ignore global access */
    }
  }
  return null;
};

export const resolveLevelOverride = ({ envKeys = [], globalKeys = [] } = {}) => {
  const raw = readFromProcessEnv(envKeys) ?? readFromGlobalFlags(globalKeys);
  return normalizeLevelInput(raw);
};

export const resolveConsoleThreshold = (config) => {
  if (config && isValidLogLevel(config.consoleLevel)) return config.consoleLevel;
  return LOG_LEVEL.WARN;
};

export const shouldEmitToConsole = (config, level) => {
  if (!config?.enableConsole || !isValidLogLevel(level)) return false;
  const threshold = resolveConsoleThreshold(config);
  return level >= threshold;
};

export const emitConsoleFallback = (config, level, ...args) => {
  if (!shouldEmitToConsole(config, level)) return;
  const method = level >= LOG_LEVEL.ERROR ? 'error' : level >= LOG_LEVEL.WARN ? 'warn' : 'log';
  try {
    if (typeof console?.[method] === 'function') {
      console[method](...args);
    }
  } catch (_) {
    /* ignore fallback console errors */
  }
};
