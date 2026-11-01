import { createTerrainWorld } from '../../../helpers/terrainWorld.js';

describe('Swamp / Wetlands flora density', () => {
  test.each([
    ['swamp', 777],
    ['wetlands', 888],
  ])('%s retains the established plant-density limits through the scene adapter', (biome, seed) => {
    const plants = [];
    const world = createTerrainWorld(48, 48, {
      addPlaceable(plant) {
        plants.push(plant);
        return Promise.resolve();
      },
      purgeAll() {
        plants.length = 0;
      },
    });
    try {
      expect(world.engine.generateBiomeElevation(biome, { seed, headless: true })).toBe(true);
      const count = plants.filter((plant) => plant.type === 'plant').length;
      expect(count).toBeGreaterThan(48 * 48 * 0.02);
      expect(count).toBeLessThan(48 * 48 * 0.6);
    } finally {
      world.dispose();
    }
  });
});
