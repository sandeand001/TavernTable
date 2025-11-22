import { SpatialCoordinator } from '../../src/scene/SpatialCoordinator.js';

describe('SpatialCoordinator', () => {
  test('grid <-> world roundtrip integrity for defaults', () => {
    const sc = new SpatialCoordinator();
    const samples = [
      { gx: 0, gy: 0, elev: 0 },
      { gx: 5, gy: 3, elev: 2 },
      { gx: -2, gy: 7, elev: 1.5 },
    ];
    for (const s of samples) {
      const world = sc.gridToWorld(s.gx, s.gy, s.elev);
      expect(world.x).toBeCloseTo(s.gx, 5);
      expect(world.z).toBeCloseTo(s.gy, 5);
      expect(world.y).toBeCloseTo(s.elev * 0.5, 5);
      const grid = sc.worldToGrid(world.x, world.z);
      expect(grid.gridX).toBe(s.gx);
      expect(grid.gridY).toBe(s.gy);
    }
  });

  test('reconfigure updates scale', () => {
    const sc = new SpatialCoordinator();
    sc.reconfigure({ tileWorldSize: 2, elevationUnit: 1 });
    const w = sc.gridToWorld(2, 3, 4);
    expect(w.x).toBe(4);
    expect(w.z).toBe(6);
    expect(w.y).toBe(4);
  });

  test('worldToGrid floors fractional world coordinates inside a tile', () => {
    const sc = new SpatialCoordinator();
    const samples = [
      { x: 0.99, z: 0.01, gx: 0, gy: 0 },
      { x: 1.01, z: 0.45, gx: 1, gy: 0 },
      { x: 4.75, z: 7.25, gx: 4, gy: 7 },
      { x: -0.01, z: 3.2, gx: -1, gy: 3 },
    ];
    for (const sample of samples) {
      const grid = sc.worldToGrid(sample.x, sample.z);
      expect(grid.gridX).toBe(sample.gx);
      expect(grid.gridY).toBe(sample.gy);
    }
  });
});
