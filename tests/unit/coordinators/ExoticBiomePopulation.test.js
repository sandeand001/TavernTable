import { createTerrainWorld, floraContext } from '../../helpers/terrainWorld.js';
import { BIOME_FLORA_PROFILES } from '../../../src/config/terrain/FloraProfiles.js';
import { ALL_BIOMES } from '../../../src/config/biome/BiomeConstants.js';
import { autoPopulateBiomeFlora } from '../../../src/coordinators/terrain-coordinator/internals/flora.js';

function generate(biomeKey, seed = 12345) {
  const placements = [];
  const world = createTerrainWorld(25, 25, {
    addPlaceable: (item) => {
      placements.push(item);
      return Promise.resolve();
    },
    purgeAll: () => {
      placements.length = 0;
    },
  });
  try {
    expect(world.engine.generateBiomeElevation(biomeKey, { seed })).toBe(true);
    return placements;
  } finally {
    world.dispose();
  }
}

describe('Biome-appropriate exotic populations', () => {
  test.each(ALL_BIOMES.filter((biome) => biome.rarity === 'exotic').map((biome) => biome.key))(
    '%s generates suitable existing models and captures biome/seed metadata',
    (biomeKey) => {
      const placements = generate(biomeKey);
      expect(placements.length).toBeGreaterThan(0);
      for (const item of placements) {
        expect(item.generatedBiome).toBe(true);
        expect(item.modelKey).toBeTruthy();
        expect(item.biomeKey).toBe(biomeKey);
        expect(item.biomeSeed).toBe(12345);
      }
    }
  );

  test('Lava Fields contains rocks and pebbles, never trees or foliage', () => {
    const placements = generate('lavaFields');
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((item) => /^(rock|pebble)-/.test(item.placeableId))).toBe(true);
    const profile = BIOME_FLORA_PROFILES.find((entry) => entry.re.test('lavaFields'));
    expect(Object.keys(profile.weights).every((id) => /^(rock|pebble)-/.test(id))).toBe(true);
  });

  test('Crystal Spires uses rocky assets and Eldritch Rift permits fitting dead trees and fungi', () => {
    expect(
      generate('crystalSpires').every((item) => /^(rock|pebble)-/.test(item.placeableId))
    ).toBe(true);
    const profile = BIOME_FLORA_PROFILES.find((entry) => entry.re.test('eldritchRift'));
    const ids = Object.keys(profile.weights);
    expect(ids.some((id) => id.startsWith('tree-dead-'))).toBe(true);
    expect(ids.some((id) => id.startsWith('mushroom-'))).toBe(true);
  });

  test('rare Crystal Fields remains bare rather than gaining exotic-only population changes', () => {
    expect(generate('crystalFields')).toHaveLength(0);
  });

  test('the solid rift floor permits below-zero assets without populating ordinary water', () => {
    const placements = [];
    const world = createTerrainWorld(12, 12, {
      addPlaceable: (item) => {
        placements.push(item);
        return Promise.resolve();
      },
    });
    try {
      world.engine.load({ heights: Array.from({ length: 12 }, () => Array(12).fill(-2)) });
      const context = floraContext(world.gm);
      autoPopulateBiomeFlora(context, 'eldritchRift', 12345);
      expect(placements.length).toBeGreaterThan(0);
      placements.length = 0;
      autoPopulateBiomeFlora(context, 'grassland', 12345);
      expect(placements).toHaveLength(0);
      autoPopulateBiomeFlora(context, 'bloodMarsh', 12345);
      expect(placements.length).toBeGreaterThan(0);
      placements.length = 0;
      world.engine.load({ heights: Array.from({ length: 12 }, () => Array(12).fill(-4)) });
      autoPopulateBiomeFlora(context, 'bloodMarsh', 12345);
      expect(placements).toHaveLength(0);
    } finally {
      world.dispose();
    }
  });
});
