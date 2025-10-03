// PickingService.test.js - validates basic ground plane picking -> grid mapping integration

jest.mock('three', () => {
  class Vector2 {
    constructor(x = 0, y = 0) {
      this.x = x;
      this.y = y;
    }
    set(x, y) {
      this.x = x;
      this.y = y;
    }
  }
  class Vector3 {
    constructor(x = 0, y = 0, z = 0) {
      this.x = x;
      this.y = y;
      this.z = z;
    }
  }
  class Plane {
    constructor(normal, constant) {
      this.normal = normal;
      this.constant = constant;
    }
  }
  class Ray {
    constructor() {
      this.origin = { x: 0, y: 10, z: 0 };
      this.direction = { x: 0, y: -1, z: 0 };
    }
    intersectPlane(plane, target) {
      target.x = 0;
      target.y = 0;
      target.z = 0;
      return target;
    }
  }
  class Raycaster {
    constructor() {
      this.ray = new Ray();
    }
    setFromCamera(v2, cam) {
      // store last for inspection if needed
      this.last = { v2, cam };
    }
  }
  return { Vector2, Vector3, Plane, Raycaster };
});

import { GameManager } from '../../src/core/GameManager.js';
import { PickingService } from '../../src/scene/PickingService.js';

// Minimal stub for ThreeSceneManager so PickingService finds camera + canvas bounds
class FakeCamera {}
class FakeThreeSceneManager {
  constructor() {
    this.camera = new FakeCamera();
    this.canvas = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }),
    };
    this.scene = {};
    this.isReady = () => true;
  }
}

describe('PickingService (Phase 6 groundwork)', () => {
  test('pickGround returns grid + world structure in hybrid mode', async () => {
    const gm = new GameManager({ cols: 10, rows: 10 });
    // Force hybrid prerequisites without full Three init
    gm.renderMode = '3d-hybrid';
    gm.threeSceneManager = new FakeThreeSceneManager();
    const ps = new PickingService({ gameManager: gm });
    const result = await ps.pickGround(100, 100); // center of canvas -> ndc (0,0)
    expect(result).toBeTruthy();
    expect(result.world).toBeTruthy();
    expect(result.grid).toBeTruthy();
    // Grid coords should be numeric
    expect(typeof result.grid.gx).toBe('number');
    expect(typeof result.grid.gy).toBe('number');
  });

  test('pickGround returns null when not in hybrid mode', async () => {
    const gm = new GameManager({ cols: 4, rows: 4 });
    const ps = new PickingService({ gameManager: gm });
    const result = await ps.pickGround(10, 10);
    expect(result).toBeNull();
  });
});
