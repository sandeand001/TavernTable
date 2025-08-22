/**
 * Environment helpers to avoid direct process access in browser code
 */

/**
 * Detect if running under Jest workers.
 * Returns true if JEST_WORKER_ID is present in process.env.
 */
export function isJest() {
    try {
        return !!(typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env && globalThis.process.env.JEST_WORKER_ID);
    } catch (_) {
        return false;
    }
}

/**
 * Get NODE_ENV from process.env if available. Defaults to 'development'.
 */
export function getNodeEnv() {
    try {
        return (typeof globalThis !== 'undefined' && globalThis.process && globalThis.process.env && globalThis.process.env.NODE_ENV) || 'development';
    } catch (_) {
        return 'development';
    }
}
