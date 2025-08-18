// Jest setup file
// Keep minimal to avoid side effects during cleanup passes.

// Mock PIXI if not available in test environment
if (typeof global.PIXI === 'undefined') {
  global.PIXI = {
    Container: class { constructor(){ this.children=[]; this.visible=true; } addChild(){} addChildAt(){} removeChild(){} removeChildren(){ this.children=[]; } },
    Graphics: class { constructor(){ this.children=[]; this.destroyed=false; } lineStyle(){} beginFill(){} endFill(){} moveTo(){} lineTo(){} closePath(){} addChild(){} destroy(){ this.destroyed=true; } },
  };
}

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
    }
  };
}
