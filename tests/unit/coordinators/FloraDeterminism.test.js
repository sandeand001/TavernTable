import { TERRAIN_PLACEABLES } from '../../../src/config/terrain/TerrainPlaceables.js';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';

const BARE_IDS = Object.keys(TERRAIN_PLACEABLES).filter((key) => /bare/i.test(key));

function generateFloraSnapshot(biome, seed, cols = 12, rows = 12, structures = true) {
  const plants = [];
  const world = createTerrainWorld(cols, rows, {
    addPlaceable(plant) {
      plants.push(plant);
      return Promise.resolve();
    },
    purgeAll() {
      plants.length = 0;
    },
  });
  try {
    world.engine.setStructureGeneration(structures);
    expect(world.engine.generateBiomeElevation(biome, { seed })).toBe(true);
    return {
      snapshot: plants
        .map((plant) => ({
          id: plant.variantKey,
          x: plant.gridX,
          y: plant.gridY,
        }))
        .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id)),
      count: plants.length,
      heights: world.engine.save().heights,
    };
  } finally {
    world.dispose();
  }
}

describe('Deterministic flora placement', () => {
  test('orchard grid layout repeats with the same seed', () => {
    const first = generateFloraSnapshot('orchard', 777, 16, 12);
    const second = generateFloraSnapshot('orchard', 777, 16, 12);
    expect(first.count).toBeGreaterThan(0);
    expect(first.snapshot).toEqual(second.snapshot);
  });

  test('different orchard seeds change the layout', () => {
    const first = generateFloraSnapshot('orchard', 1001, 16, 12);
    const second = generateFloraSnapshot('orchard', 1002, 16, 12);
    expect(first.snapshot).not.toEqual(second.snapshot);
  });

  test('petrified forest contains only bare trees', () => {
    const run = generateFloraSnapshot('petrifiedForest', 4242, 18, 10);
    expect(run.count).toBeGreaterThan(0);
    expect(run.snapshot.filter((plant) => !BARE_IDS.includes(plant.id))).toHaveLength(0);
  });

  test.each(['ruinedTown', 'ruinedUrban', 'ruinedCastle'])(
    '%s has sparse real overgrowth on its level zero-height ground',
    (biome) => {
      const run = generateFloraSnapshot(biome, 42, 25, 25);
      expect(run.count).toBeGreaterThan(0);
      expect(run.count).toBeLessThanOrEqual(13);
      expect(new Set(run.heights.flat())).toEqual(new Set([0]));
    }
  );

  test.each([false, true])('oasis trees hug the water edge with structures=%s', (structures) => {
    const run = generateFloraSnapshot('oasis', 9999, 24, 16, structures);
    expect(run.count).toBeGreaterThan(0);
    const adjacent = run.snapshot.filter(({ x, y }) =>
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => (run.heights[y + dy]?.[x + dx] ?? 0) <= 0)
    ).length;
    expect(adjacent / run.count).toBeGreaterThanOrEqual(0.7);
  });
});
