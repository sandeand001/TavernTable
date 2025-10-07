// Verify that PlaceableMeshPool.resyncHeights updates Y after terrain changes

jest.mock('three', () => {
  class PlaneGeometry {
    rotateX() {}
  }
  class MeshBasicMaterial {
    constructor() {}
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
      this.scale = {
        x: 1,
        y: 1,
        z: 1,
        set: (x, y, z) => {
          this.scale.x = x;
          this.scale.y = y;
          this.scale.z = z;
        },
      };
    }
    updateMatrix() {
      this.matrix = { position: { ...this.position } };
    }
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
  return { PlaneGeometry, MeshBasicMaterial, Object3D, InstancedMesh };
});

import { PlaceableMeshPool } from '../../src/scene/PlaceableMeshPool.js';

function buildGM(heights) {
  return {
    renderMode: '3d-hybrid',
    threeSceneManager: { scene: { add() {}, remove() {} } },
    is3DModeActive: () => true,
    spatial: { elevationUnit: 0.5, gridToWorld: (x, y) => ({ x, y: 0, z: y }) },
    getTerrainHeight: (gx, gy) => (heights[gy] && heights[gy][gx]) || 0,
  };
}

describe('PlaceableMeshPool.resyncHeights', () => {
  test('updates instance Y after terrain edit + notify', async () => {
    // Initial flat terrain (all 0)
    const heights = [[], [], [], []];
    const gm = buildGM(heights);
    const pool = new PlaceableMeshPool({ gameManager: gm, initialCapacity: 4 });

    const a = { gridX: 1, gridY: 1, type: 'plant' };
    const b = { gridX: 2, gridY: 1, type: 'plant' };
    await pool.addPlaceable(a);
    await pool.addPlaceable(b);

    const group = [...pool._groups.values()][0];
    const beforeA = group.instancedMesh._matrices[a.__meshPoolHandle.index].position.y;
    const beforeB = group.instancedMesh._matrices[b.__meshPoolHandle.index].position.y;
    expect(beforeA).toBeCloseTo(0.005, 6);
    expect(beforeB).toBeCloseTo(0.005, 6);

    // Raise terrain at (1,1) to elevation 4 and (2,1) to elevation 2
    heights[1][1] = 4; // worldY expected 4 * 0.5 = 2
    heights[1][2] = 2; // worldY expected 1

    // Simulate terrain change notification path
    await pool.resyncHeights();

    const afterA = group.instancedMesh._matrices[a.__meshPoolHandle.index].position.y;
    const afterB = group.instancedMesh._matrices[b.__meshPoolHandle.index].position.y;
    expect(afterA).toBeCloseTo(2.005, 5);
    expect(afterB).toBeCloseTo(1.005, 5);
  });
});
