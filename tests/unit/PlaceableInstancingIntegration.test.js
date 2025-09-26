// Integration test: enabling instanced placeables wires placement/removal into PlaceableMeshPool

jest.mock('three', () => {
  // Minimal three stub used by PlaceableMeshPool
  class PlaneGeometry {
    constructor() {}
    rotateX() {}
    dispose() {}
  }
  class MeshBasicMaterial {
    constructor() {}
    dispose() {}
  }
  class InstancedMesh {
    constructor(g, m, c) {
      this.geometry = g;
      this.material = m;
      this.capacity = c;
      this.instanceMatrix = { needsUpdate: false };
      this._matrices = new Array(c);
    }
    setMatrixAt(i, mx) {
      this._matrices[i] = mx;
    }
  }
  class Object3D {
    constructor() {
      this.matrix = {};
      this.position = { set() {} };
    }
    updateMatrix() {}
  }
  return { PlaneGeometry, MeshBasicMaterial, InstancedMesh, Object3D };
});

import { GameManager } from '../../src/core/GameManager.js';
import { TerrainManager } from '../../src/managers/TerrainManager.js';
import { TERRAIN_PLACEABLES } from '../../src/config/TerrainPlaceables.js';

// Provide a minimal subset of TERRAIN_PLACEABLES if not defined fully in environment
// Provide a deterministic test placeable definition
// eslint-disable-next-line camelcase
if (!TERRAIN_PLACEABLES.test_tree) {
  // eslint-disable-next-line camelcase
  TERRAIN_PLACEABLES.test_tree = { id: 'test_tree', type: 'plant', img: ['tree.png'] };
}

// Mock PIXI essentials used by TerrainManager placeables path
global.PIXI = global.PIXI || {};
if (!global.PIXI.Container) {
  class Container {
    constructor() {
      this.children = [];
      this.sortableChildren = false;
    }
    addChild(c) {
      this.children.push(c);
      return c;
    }
    removeChild(c) {
      const i = this.children.indexOf(c);
      if (i >= 0) this.children.splice(i, 1);
    }
    sortChildren() {}
  }
  class Sprite {
    constructor() {
      this.anchor = { set() {} };
      this.scale = { x: 1, y: 1 };
      this.position = { set() {} };
      this.parent = null;
      this.zIndex = 0;
    }
  }
  global.PIXI.Container = Container;
  global.PIXI.Sprite = Sprite;
  global.PIXI.Texture = { from: () => ({}) };
}

// Helper to build a minimal initialized game manager state for placeable placement
async function buildGameWithInstancing() {
  const gm = new GameManager({ cols: 4, rows: 4 });
  gm.features.instancedPlaceables = true; // enable flag BEFORE hybrid enable
  // Minimal grid container expected by TerrainManager
  gm.gridContainer = new PIXI.Container();
  // Inject tokenManager stub for conflict checks
  gm.tokenManager = { findExistingTokenAt: () => null };
  // Create terrain manager manually (since StateCoordinator normally does this) and attach container fields
  const tm = new TerrainManager(gm, gm.terrainCoordinator);
  tm.terrainContainer = new PIXI.Container();
  tm.placeables = new Map();
  gm.terrainCoordinator.terrainManager = tm;
  // Enable hybrid (initializes Three + pool)
  await gm.enableHybridRender();
  return { gm, tm };
}

describe('Placeable Instancing Integration (Phase 4)', () => {
  test('placing and removing a placeable updates instancing metrics when flag enabled', async () => {
    const { gm, tm } = await buildGameWithInstancing();
    expect(gm.placeableMeshPool).toBeTruthy();
    const beforeStats = gm.placeableMeshPool.getStats();
    const placed = tm.placeItem('test_tree', 1, 2);
    expect(placed).toBe(true);
    // Flush async instancing tasks deterministically
    await gm.flushInstancing();
    const midStats = gm.placeableMeshPool.getStats();
    // Instance count should reflect one added placeable
    expect(midStats.instances).toBe(beforeStats.instances + 1);
    // Remove the placed item using public API (id,x,y)
    const removed = tm.removeItem('test_tree', 1, 2);
    expect(removed).toBe(true);
    await gm.flushInstancing();
    const afterStats = gm.placeableMeshPool.getStats();
    expect(afterStats.instances).toBe(beforeStats.instances);
  });
});
