import GameManager from '../../../../src/core/GameManager.js';
import { TerrainCoordinator } from '../../../../src/coordinators/TerrainCoordinator.js';

describe('Orchard layout', () => {
  test('single species, uniform row counts with slight spacing & jitter', () => {
    const gm = new GameManager({ rows: 24, cols: 24 });
    gm.gridContainer = { addChild: () => {} };
    const c = new TerrainCoordinator(gm);
    const orchardPlants = [];
    gm.placeableMeshPool = {
      addPlaceable(p) {
        orchardPlants.push(p);
        return Promise.resolve();
      },
      purgeAll() {
        orchardPlants.length = 0;
      },
    };
    const ok = c.generateBiomeElevation('orchard', { seed: 555 });
    expect(ok).toBe(true);

    // Gather elevations and compute variance
    const heights = [];
    for (let y = 0; y < gm.rows; y++) {
      for (let x = 0; x < gm.cols; x++) heights.push(c.getTerrainHeight(x, y));
    }
    const mean = heights.reduce((a, b) => a + b, 0) / heights.length;
    const variance = heights.reduce((a, b) => a + (b - mean) * (b - mean), 0) / heights.length;
    expect(variance).toBeLessThan(0.3);

    const plants = orchardPlants;
    expect(plants.length).toBeGreaterThan(0);
    const ids = new Set(plants.map((p) => p.variantKey));
    expect(ids.size).toBe(1); // single cultivar

    // Collect rows: group by y
    const rowsMap = new Map();
    for (const p of plants) {
      const y = p.gridY ?? p.y;
      if (!rowsMap.has(y)) rowsMap.set(y, []);
      rowsMap.get(y).push(p);
    }
    const rowEntries = [...rowsMap.entries()].sort((a, b) => a[0] - b[0]);
    expect(rowEntries.length).toBeGreaterThan(2);
    const counts = rowEntries.map(([, list]) => list.length);
    const minCount = Math.min(...counts);
    const maxCount = Math.max(...counts);
    expect(maxCount - minCount).toBeLessThanOrEqual(1);

    const firstRow = rowEntries[0][1].sort((a, b) => (a.gridX ?? a.x) - (b.gridX ?? b.x));
    const baseXs = firstRow.map((p) => p.gridX ?? p.x).sort((a, b) => a - b);
    const baseDiffs = baseXs.slice(1).map((v, i) => v - baseXs[i]);
    // Allow slight horizontal jitter: each spacing should be close to a multiple of 4
    for (const d of baseDiffs) {
      const mod = d % 4;
      const dist = Math.min(mod, 4 - mod);
      expect(dist).toBeLessThanOrEqual(2); // tolerate up to 2 tiles jitter due to jitterX
    }
    const ys = rowEntries.map(([y]) => y);
    const yDiffs = ys.slice(1).map((v, i) => v - ys[i]);
    for (const d of yDiffs) expect(d).toBeGreaterThanOrEqual(3);
    for (const d of yDiffs) expect(d).toBeLessThanOrEqual(6);
    expect(new Set(yDiffs).size).toBeGreaterThan(0);
  });
});
