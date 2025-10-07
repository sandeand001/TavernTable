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

  test('throttles rebuild requests during continuous painting', () => {
    jest.useFakeTimers({ now: 0 });
    const rebuilder = new TerrainRebuilder({ gameManager: {}, builder: {}, debounceMs: 60 });
    rebuilder.rebuild = jest.fn();

    // First request flushes immediately
    rebuilder.request();
    expect(rebuilder.rebuild).toHaveBeenCalledTimes(1);

    // Rapid subsequent requests should defer until the throttle window elapses
    jest.setSystemTime(10);
    rebuilder.request();
    rebuilder.request();
    expect(rebuilder.rebuild).toHaveBeenCalledTimes(1);

    // Advance near the throttle window; still no rebuild
    jest.advanceTimersByTime(49);
    expect(rebuilder.rebuild).toHaveBeenCalledTimes(1);

    // Crossing the threshold triggers a trailing rebuild
    jest.advanceTimersByTime(1);
    expect(rebuilder.rebuild).toHaveBeenCalledTimes(2);

    // After the interval, a fresh request should rebuild immediately again
    jest.setSystemTime(130);
    rebuilder.request();
    expect(rebuilder.rebuild).toHaveBeenCalledTimes(3);

    jest.useRealTimers();
  });
});
