import GameManager from '../../src/core/GameManager.js';
import { autoPopulateBiomeFlora } from '../../src/coordinators/terrain-coordinator/internals/flora.js';

function makeCoordinator(rows = 40, cols = 40, seed = 1234) {
  // Use the GameManager's internally created terrainCoordinator so any internal
  // identity checks or back-references remain valid (some coordinator logic
  // expects gameManager.terrainCoordinator === instance in use).
  const gm = new GameManager({ rows, cols });
  const c = gm.terrainCoordinator;
  c.setBiomeSeed(seed);
  return c;
}

describe('Swamp / Wetlands flora density', () => {
  test('swamp produces a reasonable number of plants', () => {
    const c = makeCoordinator(48, 48, 777);
    const ok = c.generateBiomeElevation('swamp', { seed: 777, headless: true });
    expect(ok).toBe(true);
    // Count plants
    let count = 0;
    if (!c.terrainManager || !c.terrainManager.placeables) {
      // headless fallback stub
      c.terrainManager = {
        gameManager: c.gameManager || { gridContainer: {} },
        placeables: new Map(),
        placeTerrainItem(x, y, id) {
          const key = `${x},${y}`;
          let arr = this.placeables.get(key);
          if (!arr) {
            arr = [];
            this.placeables.set(key, arr);
          }
          arr.push({ placeableType: 'plant', id, x, y });
          return true;
        },
      };
      autoPopulateBiomeFlora(c, 'swamp', 777);
    }
    for (const [, list] of c.terrainManager.placeables || []) {
      if (Array.isArray(list)) count += list.filter((p) => p?.placeableType === 'plant').length;
    }
    // Expect at least > 2% of tiles but < 60% (sanity bounds)
    const total = 48 * 48;
    expect(count).toBeGreaterThan(total * 0.02);
    expect(count).toBeLessThan(total * 0.6);
  });

  test('wetlands produces plants with new depth logic', () => {
    const c = makeCoordinator(48, 48, 888);
    const ok = c.generateBiomeElevation('wetlands', { seed: 888, headless: true });
    expect(ok).toBe(true);
    let count = 0;
    if (!c.terrainManager || !c.terrainManager.placeables) {
      c.terrainManager = {
        gameManager: c.gameManager || { gridContainer: {} },
        placeables: new Map(),
        placeTerrainItem(x, y, id) {
          const key = `${x},${y}`;
          let arr = this.placeables.get(key);
          if (!arr) {
            arr = [];
            this.placeables.set(key, arr);
          }
          arr.push({ placeableType: 'plant', id, x, y });
          return true;
        },
      };
      autoPopulateBiomeFlora(c, 'wetlands', 888);
    }
    for (const [, list] of c.terrainManager.placeables || []) {
      if (Array.isArray(list)) count += list.filter((p) => p?.placeableType === 'plant').length;
    }
    const total = 48 * 48;
    expect(count).toBeGreaterThan(total * 0.02);
    expect(count).toBeLessThan(total * 0.6);
  });
});
