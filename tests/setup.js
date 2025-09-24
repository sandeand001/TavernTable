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
