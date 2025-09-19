import GameManager from '../../src/core/GameManager.js';
import { autoPopulateBiomeFlora } from '../../src/coordinators/terrain-coordinator/internals/flora.js';

/**
 * Dead / Burnt forest composition test
 * Ensures majority of placed plants are bare (charred) trees while allowing a small
 * proportion of survivor greens (columnar, conifer, small saplings) to appear.
 */

describe('Dead / Burnt forest flora composition', () => {
  function generate(seed, biomeKey = 'deadForest') {
    const gm = new GameManager({ rows: 24, cols: 24 });
    // Headless stubs similar to other density tests
    gm.gridContainer = { addChild: () => {} };
    const tc = gm.terrainCoordinator;
    tc.terrainManager = tc.terrainManager || {
      placeables: new Map(),
      gameManager: gm,
      placeTerrainItem(x, y, id) {
        const key = `${x},${y}`;
        const entry = { placeableType: 'plant', id, x, y };
        if (!this.placeables.has(key)) this.placeables.set(key, []);
        this.placeables.get(key).push(entry);
        return true;
      },
    };
    // Provide a trivial heightmap mostly above water (simulate already elevated terrain application)
    tc.getTerrainHeight = (x, y) => 1 + ((x * 37 + y * 17 + seed) % 3) * 0.1; // mild variation > 0
    autoPopulateBiomeFlora(tc, biomeKey, seed);
    return tc.terrainManager.placeables;
  }

  test('bare trees dominate (>75%) with at least one survivor present across seeds', () => {
    let sawAnySurvivor = false;
    for (let s = 0; s < 6; s++) {
      const placeables = generate(1000 + s);
      let total = 0;
      let bare = 0;
      // survivors counter not needed beyond detection; bare dominance is primary assertion
      for (const list of placeables.values()) {
        for (const p of list) {
          if (p.placeableType !== 'plant') continue;
          total++;
          if (/bare/.test(p.id)) bare++;
          if (/green-(columnar|conifer|small)/.test(p.id)) sawAnySurvivor = true;
        }
      }
      if (total === 0) continue; // allow empty edge case but unlikely
      const bareRatio = bare / total;
      expect(bareRatio).toBeGreaterThan(0.75);
    }
    expect(sawAnySurvivor).toBe(true);
  });
});
