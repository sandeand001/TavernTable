import GameManager from '../../../src/core/GameManager.js';
import { BIOME_FLORA_PROFILES } from '../../../src/config/terrain/FloraProfiles.js';
import { ALL_BIOMES } from '../../../src/config/biome/BiomeConstants.js';
import { autoPopulateBiomeFlora } from '../../../src/coordinators/terrain-coordinator/internals/flora.js';

function generate(biomeKey, seed = 12345) {
  const gm = new GameManager({ cols: 25, rows: 25 });
  const placements = [];
  gm.placeableMeshPool = {
    addPlaceable: (item) => {
      placements.push(item);
      return Promise.resolve();
    },
    purgeAll: () => {
      placements.length = 0;
    },
  };
  expect(gm.terrainCoordinator.generateBiomeElevation(biomeKey, { seed })).toBe(true);
  return placements;
}

describe('Biome-appropriate exotic populations', () => {
  test.each(ALL_BIOMES.filter((biome) => biome.rarity === 'exotic').map((biome) => biome.key))(
    '%s generates suitable existing models and captures biome/seed metadata',
    (biomeKey) => {
      const placements = generate(biomeKey);
      expect(placements.length).toBeGreaterThan(0);
      for (const item of placements) {
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
    const gm = new GameManager({ cols: 12, rows: 12 });
    const placements = [];
    gm.placeableMeshPool = {
      addPlaceable: (item) => {
        placements.push(item);
        return Promise.resolve();
      },
    };
    gm.terrainCoordinator.getTerrainHeight = () => -2;
    autoPopulateBiomeFlora(gm.terrainCoordinator, 'eldritchRift', 12345);
    expect(placements.length).toBeGreaterThan(0);

    placements.length = 0;
    autoPopulateBiomeFlora(gm.terrainCoordinator, 'grassland', 12345);
    expect(placements).toHaveLength(0);

    autoPopulateBiomeFlora(gm.terrainCoordinator, 'bloodMarsh', 12345);
    expect(placements.length).toBeGreaterThan(0);
    placements.length = 0;
    gm.terrainCoordinator.getTerrainHeight = () => -4;
    autoPopulateBiomeFlora(gm.terrainCoordinator, 'bloodMarsh', 12345);
    expect(placements).toHaveLength(0);
  });
});
