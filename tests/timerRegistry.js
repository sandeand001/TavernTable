// tests/timerRegistry.js
// NFC Timer Registry: Wraps global setTimeout/setInterval in test environment to track
// and automatically clear timers after each test, mitigating open-handle Jest warnings.
// Does not modify production code; only active when imported by Jest setup.

const originalSetTimeout = global.setTimeout;
const originalSetInterval = global.setInterval;
const originalClearTimeout = global.clearTimeout;
const originalClearInterval = global.clearInterval;

const activeTimeouts = new Set();
const activeIntervals = new Set();

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
  return id;
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
}

function install() {
  if (global.__TIMER_REGISTRY_INSTALLED__) return;
  global.__TIMER_REGISTRY_INSTALLED__ = true;
  global.setTimeout = wrappedSetTimeout;
  global.setInterval = wrappedSetInterval;
  global.clearTimeout = wrappedClearTimeout;
  global.clearInterval = wrappedClearInterval;
  // Expose helpers for debugging if needed.
  global.__getActiveTimers = () => ({
    timeouts: activeTimeouts.size,
    intervals: activeIntervals.size,
  });
  global.__forceClearTimers = clearAllTimers;
}

function afterEachHook() {
  clearAllTimers();
}

module.exports = { install, afterEachHook };
