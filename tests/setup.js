// Jest setup file
// Keep minimal to avoid side effects during cleanup passes.

// Mock PIXI if not available in test environment
if (typeof global.PIXI === 'undefined') {
  global.PIXI = {
    Container: class { constructor(){ this.children=[]; this.visible=true; } addChild(){} addChildAt(){} removeChild(){} removeChildren(){ this.children=[]; } },
    Graphics: class { constructor(){ this.children=[]; this.destroyed=false; } lineStyle(){} beginFill(){} endFill(){} moveTo(){} lineTo(){} closePath(){} addChild(){} destroy(){ this.destroyed=true; } },
  };
}
