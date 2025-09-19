// tests/timerRegistry.js
// NFC Timer Registry: Wraps global setTimeout/setInterval in test environment to track
// and automatically clear timers after each test, mitigating open-handle Jest warnings.
// Does not modify production code; only active when imported by Jest setup.

const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalSetImmediate = global.setImmediate;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;
const originalClearImmediate = global.clearImmediate || ((id) => clearImmediate(id));
const originalRequestAnimationFrame = global.requestAnimationFrame;
const originalCancelAnimationFrame = global.cancelAnimationFrame;

const activeTimeouts = new Set();
const activeIntervals = new Set();
const activeImmediates = new Set();
const activeAnimationFrames = new Set();
const creationMeta = new WeakMap(); // id (object or function) -> { type, stack }

// Capture stacks only if env var set to avoid noise & perf hit
const CAPTURE_STACKS = process.env.TEST_TIMER_CAPTURE_STACKS === '1';

function wrappedSetTimeout(fn, delay, ...args) {
  const id = originalSetTimeout(
    () => {
      try {
        fn();
      } finally {
        activeTimeouts.delete(id);
      }
    },
    delay,
    ...args
  );
  if (typeof id === 'object' && typeof id.unref === 'function') {
    try {
      id.unref();
    } catch (_) {
      /* noop */
    }
  }
  activeTimeouts.add(id);
  if (CAPTURE_STACKS) {
    creationMeta.set(id, { type: 'timeout', stack: new Error().stack });
  }
  return id;
}

function wrappedSetInterval(fn, delay, ...args) {
  const id = originalSetInterval(fn, delay, ...args);
  if (typeof id === 'object' && typeof id.unref === 'function') {
    try {
      id.unref();
    } catch (_) {
      /* noop */
    }
  }
  activeIntervals.add(id);
  if (CAPTURE_STACKS) {
    creationMeta.set(id, { type: 'interval', stack: new Error().stack });
  }
  return id;
}

function wrappedSetImmediate(fn, ...args) {
  if (!originalSetImmediate) return fn(...args);
  const id = originalSetImmediate(
    () => {
      try {
        fn();
      } finally {
        activeImmediates.delete(id);
      }
    },
    ...args
  );
  activeImmediates.add(id);
  if (CAPTURE_STACKS) {
    creationMeta.set(id, { type: 'immediate', stack: new Error().stack });
  }
  return id;
}

function wrappedRequestAnimationFrame(fn) {
  if (!originalRequestAnimationFrame) return 0;
  const id = originalRequestAnimationFrame((ts) => {
    try {
      fn(ts);
    } finally {
      activeAnimationFrames.delete(id);
    }
  });
  activeAnimationFrames.add(id);
  if (CAPTURE_STACKS) {
    // Using Map instead of WeakMap entry: RAF id is numeric
    creationMeta.set?.(id, { type: 'raf', stack: new Error().stack });
  }
  return id;
}

function wrappedCancelAnimationFrame(id) {
  activeAnimationFrames.delete(id);
  if (originalCancelAnimationFrame) originalCancelAnimationFrame(id);
}

function wrappedClearTimeout(id) {
  activeTimeouts.delete(id);
  return originalClearTimeout(id);
}

function wrappedClearInterval(id) {
  activeIntervals.delete(id);
  return originalClearInterval(id);
}

function clearAllTimers() {
  for (const t of Array.from(activeTimeouts)) {
    try {
      originalClearTimeout(t);
    } catch (_) {
      /* noop */
    }
  }
  activeTimeouts.clear();
  for (const i of Array.from(activeIntervals)) {
    try {
      originalClearInterval(i);
    } catch (_) {
      /* noop */
    }
  }
  activeIntervals.clear();
  for (const im of Array.from(activeImmediates)) {
    try {
      originalClearImmediate(im);
    } catch (_) {
      /* noop */
    }
  }
  activeImmediates.clear();
  for (const raf of Array.from(activeAnimationFrames)) {
    try {
      if (originalCancelAnimationFrame) originalCancelAnimationFrame(raf);
    } catch (_) {
      /* noop */
    }
  }
  activeAnimationFrames.clear();
}

function install() {
  if (global.__TIMER_REGISTRY_INSTALLED__) return;
  global.__TIMER_REGISTRY_INSTALLED__ = true;
  global.setTimeout = wrappedSetTimeout;
  global.setInterval = wrappedSetInterval;
  if (originalSetImmediate) global.setImmediate = wrappedSetImmediate;
  if (originalRequestAnimationFrame) {
    global.requestAnimationFrame = wrappedRequestAnimationFrame;
    global.cancelAnimationFrame = wrappedCancelAnimationFrame;
  }
  global.clearTimeout = wrappedClearTimeout;
  global.clearInterval = wrappedClearInterval;
  if (originalClearImmediate) global.clearImmediate = originalClearImmediate;
  // Expose helpers for debugging if needed.
  global.__getActiveTimers = () => ({
    timeouts: activeTimeouts.size,
    intervals: activeIntervals.size,
    immediates: activeImmediates.size,
    animationFrames: activeAnimationFrames.size,
  });
  global.__forceClearTimers = clearAllTimers;
}

function afterEachHook() {
  clearAllTimers();
}

function afterAllHook() {
  const remaining = global.__getActiveTimers();
  const leakDetected = remaining.timeouts || remaining.intervals || remaining.immediates;
  if (leakDetected) {
    // eslint-disable-next-line no-console
    console.warn('[timer-registry] Remaining handles after all tests:', remaining);
    if (CAPTURE_STACKS) {
      // Dump up to 5 stacks for each type
      let shown = 0;
      for (const [id, meta] of creationMeta.entries()) {
        if (shown >= 10) break;
        if (
          (meta.type === 'timeout' && activeTimeouts.has(id)) ||
          (meta.type === 'interval' && activeIntervals.has(id)) ||
          (meta.type === 'immediate' && activeImmediates.has(id))
        ) {
          // eslint-disable-next-line no-console
          console.warn(`[timer-registry] Leak candidate (${meta.type})`, meta.stack);
          shown += 1;
        }
      }
    }
  }
}

module.exports = { install, afterEachHook, afterAllHook };
