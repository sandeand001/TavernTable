// GameManager.placeTokenAtPointer integration test (3D hybrid token placement helper)

jest.mock('three', () => {
  class Vector2 {
    constructor() {}
    set() {}
  }
  class Vector3 {
    constructor() {
      this.x = 0;
      this.y = 0;
      this.z = 0;
    }
  }
  class Plane {
    constructor() {}
  }
  class Ray {
    constructor() {
      this.origin = {};
      this.direction = {};
    }
    intersectPlane(_p, target) {
      target.x = 1;
      target.y = 0;
      target.z = 2;
      return target;
    }
  }
  class Raycaster {
    constructor() {
      this.ray = new Ray();
    }
    setFromCamera() {}
  }
  return { Vector2, Vector3, Plane, Raycaster };
});

import { GameManager } from '../../src/core/GameManager.js';

// Provide minimal token manager & dependencies
function buildHybridGM() {
  const gm = new GameManager({ cols: 10, rows: 10 });
  gm.renderMode = '3d';
  gm.threeSceneManager = {
    camera: {},
    canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) },
    scene: {},
    isReady: () => true,
  };
  gm.tokenManager = {
    getSelectedTokenType: () => 'goblin',
    getTokenFacingRight: () => true,
    getPlacedTokens: () => [],
    findExistingTokenAt: () => null,
    removeToken: () => {},
    placeNewToken: jest.fn(),
    addTokenToCollection: () => {},
    setSelectedTokenType: () => {},
    setTokenFacingRight: () => {},
  };
  gm.gridContainer = { addChild: () => {}, sortChildren: () => {} };
  return gm;
}

describe('GameManager.placeTokenAtPointer', () => {
  test('places a token via picking when in hybrid mode', async () => {
    const gm = buildHybridGM();
    // Manually init picking service (hybrid enable path normally does this)
    await gm.enableHybridRender?.(); // ensures pickingService if not already
    if (!gm.pickingService) {
      // fallback instantiation if enableHybridRender was a no-op due to mocked scene
      const { PickingService } = await import('../../src/scene/PickingService.js');
      gm.pickingService = new PickingService({ gameManager: gm });
    }
    const placed = await gm.placeTokenAtPointer(50, 50);
    expect(placed).toBe(true);
    expect(gm.tokenManager.placeNewToken).toHaveBeenCalled();
  });

  test('returns false when not in hybrid mode', async () => {
    const gm = buildHybridGM();
    gm.renderMode = '2d-iso';
    const res = await gm.placeTokenAtPointer(10, 10);
    expect(res).toBe(false);
  });
});
