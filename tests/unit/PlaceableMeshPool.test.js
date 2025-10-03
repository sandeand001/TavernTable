// Mock three with internal class definitions (must be inside factory for Jest static analysis)
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
  class InstancedMesh {
    constructor(geo, mat, capacity) {
      this.geometry = geo;
      this.material = mat;
      this.capacity = capacity;
      this.name = '';
      this.instanceMatrix = { needsUpdate: false };
      this._matrices = new Array(capacity);
    }
    setMatrixAt(index, matrix) {
      this._matrices[index] = matrix;
    }
  }
  class Object3D {
    constructor() {
      this.matrix = {};
      this.position = { set() {} };
      this.scale = { set() {} };
    }
    updateMatrix() {}
  }
  return { PlaneGeometry, MeshBasicMaterial, InstancedMesh, Object3D };
});

describe('PlaceableMeshPool (Phase 4 scaffold)', () => {
  test('adds a placeable and records metrics', async () => {
    const { PlaceableMeshPool } = await import('../../src/scene/PlaceableMeshPool.js');
    const scene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: { scene },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }) },
      is3DModeActive: () => true,
    };
    const pool = new PlaceableMeshPool({ gameManager: gm });
    const placeable = { gridX: 1, gridY: 2, type: 'tree' };
    const handle = await pool.addPlaceable(placeable);
    expect(handle).toBeTruthy();
    expect(placeable.__meshPoolHandle).toBeDefined();
    const stats = pool.getStats();
    expect(stats.groups).toBe(1);
    expect(stats.instances).toBe(1);
    pool.removePlaceable(placeable);
    const statsAfter = pool.getStats();
    expect(statsAfter.instances).toBe(0); // freed
  });
});
