// ErrorHandler enums extracted for clarity. No behavior change.
export const ERROR_SEVERITY = Object.freeze({
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  CRITICAL: 'critical'
});

export const ERROR_CATEGORY = Object.freeze({
  INITIALIZATION: 'initialization',
  RENDERING: 'rendering',
  INPUT: 'input',
  ASSETS: 'assets',
  VALIDATION: 'validation',
  NETWORK: 'network',
  COORDINATE: 'coordinate',
  TOKEN: 'token',
  GAME_STATE: 'game_state',
  PERFORMANCE: 'performance',
  SECURITY: 'security',
  SYSTEM: 'system'
});

export const RECOVERY_STRATEGY = Object.freeze({
  NONE: 'none',
  RETRY: 'retry',
  FALLBACK: 'fallback',
  RELOAD: 'reload',
  RESET: 'reset',
  GRACEFUL_DEGRADATION: 'graceful'
});
