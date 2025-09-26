import { TerrainMeshBuilder } from '../../src/scene/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../src/scene/TerrainRebuilder.js';

// Simple performance guard: ensures a geometry builds and metrics are recorded.
// Uses a stub three namespace with only what's required by TerrainMeshBuilder.

describe('TerrainRebuildPerformance', () => {
  test('records lastRebuildMs metric and returns mesh', () => {
    // Stub minimal three implementation
    const three = {
      PlaneGeometry: class {
        constructor(w, d, cols, rows) {
          this.parameters = { w, d, cols, rows };
          const verts = (cols + 1) * (rows + 1);
          this.attributes = {
            position: {
              count: verts,
              setY: () => {},
              needsUpdate: false,
            },
          };
        }
        rotateX() {}
        computeVertexNormals() {}
        dispose() {}
      },
      MeshStandardMaterial: class {
        constructor() {}
      },
      Mesh: class {
        constructor(geo, mat) {
          this.geometry = geo;
          this.material = mat;
          this.name = '';
          this.position = { set() {} };
        }
      },
    };

    const gm = {
      cols: 8,
      rows: 8,
      getTerrainHeight: () => 0,
      threeSceneManager: { scene: { getObjectByName: () => null, add: jest.fn() } },
    };

    const builder = new TerrainMeshBuilder({ tileWorldSize: 1, elevationUnit: 0.25 });
    const rebuilder = new TerrainRebuilder({ gameManager: gm, builder, debounceMs: 10 });
    const mesh = rebuilder.rebuild({ three });
    expect(mesh).toBeTruthy();
    if (typeof window !== 'undefined') {
      const metrics = window.__TT_METRICS__?.terrain;
      expect(metrics).toBeTruthy();
      expect(typeof metrics.lastRebuildMs).toBe('number');
      expect(metrics.lastRebuildCols).toBe(8);
      expect(metrics.lastRebuildRows).toBe(8);
      // A very loose upper bound to catch runaway builds without flaking (should be << 50ms in test env)
      expect(metrics.lastRebuildMs).toBeLessThan(200);
    }
  });
});
