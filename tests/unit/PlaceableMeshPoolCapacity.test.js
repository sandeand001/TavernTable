// PlaceableMeshPool capacity expansion test (Phase 4)

jest.mock('three', () => {
  class PlaneGeometry {
    constructor() {}
    rotateX() {}
    dispose() {}
  }
  class MeshBasicMaterial {
    constructor() {}
    dispose() {}
  }
  class Matrix4 {
    constructor() {
      this.elements = new Array(16).fill(0);
    }
  }
  class InstancedMesh {
    constructor(g, m, c) {
      this.geometry = g;
      this.material = m;
      this.capacity = c;
      this.instanceMatrix = { needsUpdate: false };
      this._matrices = new Array(c);
      this.name = 'InstancedMesh';
    }
    setMatrixAt(i, mx) {
      this._matrices[i] = mx;
    }
    dispose() {}
  }
  class Object3D {
    constructor() {
      this.matrix = {};
      this.position = { set() {} };
      this.scale = { set() {} };
    }
    updateMatrix() {}
  }
  return { PlaneGeometry, MeshBasicMaterial, InstancedMesh, Object3D, Matrix4 };
});

import { PlaceableMeshPool } from '../../src/scene/PlaceableMeshPool.js';

function buildStubGM() {
  return {
    renderMode: '3d-hybrid',
    features: { instancedPlaceables: true },
    threeSceneManager: { scene: { add() {}, remove() {} } },
    is3DModeActive: () => true,
    spatial: {
      elevationUnit: 0.5,
      gridToWorld(x, y, z) {
        return { x, y, z };
      },
    },
    getTerrainHeight() {
      return 0;
    },
  };
}

describe('PlaceableMeshPool capacity growth', () => {
  test('auto-grows capacity and updates metrics', async () => {
    const gm = buildStubGM();
    const pool = new PlaceableMeshPool({ gameManager: gm, initialCapacity: 2, maxCapacity: 8 });

    // Add 5 placeables (forcing two expansions: 2->4, 4->8)
    for (let i = 0; i < 5; i++) {
      await pool.addPlaceable({ gridX: i, gridY: 0, type: 'plant' });
    }

    const stats = pool.getStats();
    expect(stats.groups).toBe(1);
    expect(stats.instances).toBe(5);
    expect(stats.capacityExpansions).toBe(2); // 2->4 and 4->8
  });

  test('does not exceed maxCapacity', async () => {
    const gm = buildStubGM();
    const pool = new PlaceableMeshPool({ gameManager: gm, initialCapacity: 2, maxCapacity: 4 });
    // Add 5 attempts; only 4 should succeed because after growth (2->4) we hit max.
    let successCount = 0;
    for (let i = 0; i < 5; i++) {
      const handle = await pool.addPlaceable({ gridX: i, gridY: 1, type: 'plant' });
      if (handle) successCount += 1;
    }
    const stats = pool.getStats();
    expect(successCount).toBe(4);
    expect(stats.instances).toBe(4);
    expect(stats.capacityExpansions).toBe(1); // only 2->4
  });
});
