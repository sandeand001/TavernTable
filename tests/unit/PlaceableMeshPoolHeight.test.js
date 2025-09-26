// Test that terrain height influences Y placement for instanced placeables

jest.mock('three', () => {
  class PlaneGeometry {
    constructor() {}
    rotateX() {}
    dispose() {}
  }
  class MeshBasicMaterial {
    constructor(o) {
      this.opts = o;
    }
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
      this.matrix = null;
      this.position = {
        x: 0,
        y: 0,
        z: 0,
        set: (x, y, z) => {
          this.position.x = x;
          this.position.y = y;
          this.position.z = z;
        },
      };
    }
    updateMatrix() {
      this.matrix = { position: { ...this.position } };
    }
  }
  return { PlaneGeometry, MeshBasicMaterial, InstancedMesh, Object3D };
});

import { PlaceableMeshPool } from '../../src/scene/PlaceableMeshPool.js';

describe('PlaceableMeshPool terrain height Y mapping', () => {
  test('applies elevationUnit * height as world Y', async () => {
    const scene = { add: jest.fn(), remove: jest.fn() };
    const gm = {
      renderMode: '3d-hybrid',
      threeSceneManager: { scene },
      spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }), elevationUnit: 0.5 },
      getTerrainHeight: (gx, gy) => (gx === 2 && gy === 3 ? 4 : 0), // elevation levels
    };
    const pool = new PlaceableMeshPool({ gameManager: gm });
    const rec = { gridX: 2, gridY: 3, type: 'tree' };
    await pool.addPlaceable(rec);
    const group = [...pool._groups.values()][0];
    const storedMatrix = group.instancedMesh._matrices[0];
    expect(storedMatrix).toBeTruthy();
    // Expect worldY = height(4) * elevationUnit(0.5) = 2
    expect(storedMatrix.position.y).toBeCloseTo(2, 5);
  });
});
