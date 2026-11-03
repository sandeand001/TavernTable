import { createTerrainWorld, floraContext } from '../../../helpers/terrainWorld.js';
import { autoPopulateBiomeFlora } from '../../../../src/coordinators/terrain-coordinator/internals/flora.js';

/**
 * Dead / Burnt forest composition test
 * Ensures majority of placed plants are bare (charred) trees while allowing a small
 * proportion of survivor greens (columnar, conifer, small saplings) to appear.
 */

describe('Dead / Burnt forest flora composition', () => {
  function generate(seed, biomeKey = 'deadForest') {
    const plants = [];
    const world = createTerrainWorld(24, 24, {
      addPlaceable(p) {
        plants.push(p);
        return Promise.resolve();
      },
      purgeAll() {
        plants.length = 0;
      },
    });
    try {
      world.engine.load({
        heights: Array.from({ length: 24 }, (_, y) =>
          Array.from({ length: 24 }, (_, x) => 1 + ((x * 37 + y * 17 + seed) % 3) * 0.1)
        ),
        biomeSeed: seed,
      });
      autoPopulateBiomeFlora(floraContext(world.gm), biomeKey, seed);
      return plants;
    } finally {
      world.dispose();
    }
  }

  test('bare trees dominate (>75%) with at least one survivor present across seeds', () => {
    let sawAnySurvivor = false;
    for (let s = 0; s < 6; s++) {
      const placeables = generate(1000 + s);
      let total = 0;
      let bare = 0;
      for (const p of placeables) {
        if (p.type !== 'plant') continue;
        total++;
        if (/bare/.test(p.variantKey)) bare++;
        if (/green-(columnar|conifer|small)/.test(p.variantKey)) sawAnySurvivor = true;
      }
      if (total === 0) continue; // allow empty edge case but unlikely
      const bareRatio = bare / total;
      expect(bareRatio).toBeGreaterThan(0.75);
    }
    expect(sawAnySurvivor).toBe(true);
  });
});
