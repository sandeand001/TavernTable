// Jest setup file
// Keep minimal to avoid side effects during cleanup passes.

// Mock PIXI if not available in test environment
if (typeof global.PIXI === 'undefined') {
  global.PIXI = {
    Application: class {
      constructor() {
        this.stage = { addChild: () => { } };
        // Simple ticker with addOnce executing immediately
        this.ticker = {
          addOnce: (fn) => {
            // Execute immediately in test environment to bypass animation frames
            try {
              fn(performance.now());
            } catch (_) {
              /* ignore */
            }
          },
        };
        this.renderer = { resize() { } };
      }
    },
    Container: class {
      constructor() {
        this.children = [];
        this.visible = true;
      }
      addChild() { }
      addChildAt() { }
      removeChild() { }
      removeChildren() {
        this.children = [];
      }
    },
    Graphics: class {
      constructor() {
        this.children = [];
        this.destroyed = false;
      }
      lineStyle() { }
      beginFill() { }
      endFill() { }
      moveTo() { }
      lineTo() { }
      closePath() { }
      addChild() { }
      destroy() {
        this.destroyed = true;
      }
    },
    Texture: { from: () => ({}) },
    Sprite: class {
      constructor(tex) {
        this.texture = tex;
        this.destroyed = false;
        this.x = 0;
        this.y = 0;
        this.zIndex = 0;
      }
      destroy() {
        this.destroyed = true;
      }
    },
  };
}

// Disable animated view mode transitions in all tests for deterministic behavior
if (typeof global.window === 'undefined') {
  global.window = {};
}
global.window.viewModeAnimation = false;

// Provide minimal global validators/sanitizers expected by TerrainCoordinator.validateDependencies
if (typeof global.GameValidators === 'undefined') {
  global.GameValidators = {};
}

if (typeof global.Sanitizers === 'undefined') {
  global.Sanitizers = {
    enum(value, allowed = [], defaultValue) {
      return Array.isArray(allowed) && allowed.includes(value) ? value : defaultValue;
    },
    integer(value, min, max, defaultValue = 0) {
      const n = Math.trunc(Number(value));
      if (!Number.isFinite(n)) return defaultValue;
      if (Number.isFinite(min) && n < min) return min;
      if (Number.isFinite(max) && n > max) return max;
      return n;
    },
  };
}

// === Test environment resource tracking to eliminate lingering timers/RAFs ===
(() => {
  if (!global.__TT_TEST_TRACKING__) {
    const originalRAF = global.requestAnimationFrame || ((cb) => setTimeout(() => cb(Date.now()), 16));
    const originalCAF = global.cancelAnimationFrame || clearTimeout;
    const originalSetTimeout = global.setTimeout;
    const originalSetInterval = global.setInterval;
    const originalClearTimeout = global.clearTimeout;
    const originalClearInterval = global.clearInterval;

    const rafHandles = new Set();
    const timeoutHandles = new Set();
    const intervalHandles = new Set();
    const threeManagers = new Set();

    global.requestAnimationFrame = (cb) => {
      const h = originalRAF((ts) => {
        try { cb(ts); } finally { rafHandles.delete(h); }
      });
      rafHandles.add(h);
      return h;
    };
    global.cancelAnimationFrame = (h) => {
      rafHandles.delete(h);
      try { originalCAF(h); } catch (_) { /* ignore */ }
    };
    global.setTimeout = (fn, ms, ...rest) => {
      const h = originalSetTimeout(() => {
        try { fn(); } finally { timeoutHandles.delete(h); }
      }, ms, ...rest);
      timeoutHandles.add(h);
      return h;
    };
    global.setInterval = (fn, ms, ...rest) => {
      const h = originalSetInterval(fn, ms, ...rest);
      intervalHandles.add(h);
      return h;
    };
    global.clearTimeout = (h) => {
      timeoutHandles.delete(h);
      try { originalClearTimeout(h); } catch (_) { /* ignore */ }
    };
    global.clearInterval = (h) => {
      intervalHandles.delete(h);
      try { originalClearInterval(h); } catch (_) { /* ignore */ }
    };

    // Expose registration function for ThreeSceneManager instances (patched in its module via prototype guard)
    global.__TT_REGISTER_THREE__ = (mgr) => { if (mgr) threeManagers.add(mgr); };

    global.__TT_CLEANUP__ = () => {
      // Dispose Three managers
      for (const mgr of Array.from(threeManagers)) {
        try { mgr.dispose?.(); } catch (_) { /* ignore */ }
      }
      threeManagers.clear();
      // Cancel RAFs
      for (const h of Array.from(rafHandles)) {
        try { originalCAF(h); } catch (_) { /* ignore */ }
      }
      rafHandles.clear();
      // Clear timeouts
      for (const h of Array.from(timeoutHandles)) {
        try { originalClearTimeout(h); } catch (_) { /* ignore */ }
      }
      timeoutHandles.clear();
      // Clear intervals
      for (const h of Array.from(intervalHandles)) {
        try { originalClearInterval(h); } catch (_) { /* ignore */ }
      }
      intervalHandles.clear();
    };

    // Jest hooks (if present)
    if (typeof afterEach === 'function') {
      afterEach(() => {
        try { global.__TT_CLEANUP__(); } catch (_) { /* ignore */ }
      });
    }

    if (typeof afterAll === 'function') {
      afterAll(() => {
        // One final sweep and diagnostic log (will be silenced in normal runs unless leak persists)
        try { global.__TT_CLEANUP__(); } catch (_) { /* ignore */ }
        // Introspect internal sets if still defined
        const leftovers = {};
        try {
          leftovers.rafCount = (rafHandles && rafHandles.size) || 0;
          leftovers.timeoutCount = (timeoutHandles && timeoutHandles.size) || 0;
          leftovers.intervalCount = (intervalHandles && intervalHandles.size) || 0;
          leftovers.threeManagers = (threeManagers && threeManagers.size) || 0;
        } catch (_) { /* ignore */ }
        const total = Object.values(leftovers).reduce((a, b) => a + b, 0);
        if (total > 0) {
          // eslint-disable-next-line no-console
            console.warn('[TEST_CLEANUP] Residual handles afterAll', leftovers);
          try {
            const active =
              typeof process !== 'undefined' && process._getActiveHandles
                ? process._getActiveHandles()
                : [];
            const summary = active.map((h) => (h && h.constructor ? h.constructor.name : typeof h));
            // eslint-disable-next-line no-console
            console.warn('[TEST_CLEANUP] Active handle types', summary);
          } catch (_) {
            /* ignore */
          }
        }
      });
    }

    global.__TT_TEST_TRACKING__ = true;
  }
})();
