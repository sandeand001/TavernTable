import GameManager from '../../../../src/core/GameManager.js';

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
    const plants = [];
    c.gameManager.placeableMeshPool = {
      addPlaceable(p) {
        plants.push(p);
        return Promise.resolve();
      },
      purgeAll() {
        plants.length = 0;
      },
    };
    const ok = c.generateBiomeElevation('swamp', { seed: 777, headless: true });
    expect(ok).toBe(true);
    const count = plants.filter((p) => p?.type === 'plant').length;
    const total = 48 * 48;
    expect(count).toBeGreaterThan(total * 0.02);
    expect(count).toBeLessThan(total * 0.6);
  });

  test('wetlands produces plants with new depth logic', () => {
    const c = makeCoordinator(48, 48, 888);
    const plants = [];
    c.gameManager.placeableMeshPool = {
      addPlaceable(p) {
        plants.push(p);
        return Promise.resolve();
      },
      purgeAll() {
        plants.length = 0;
      },
    };
    const ok = c.generateBiomeElevation('wetlands', { seed: 888, headless: true });
    expect(ok).toBe(true);
    const count = plants.filter((p) => p?.type === 'plant').length;
    const total = 48 * 48;
    expect(count).toBeGreaterThan(total * 0.02);
    expect(count).toBeLessThan(total * 0.6);
  });
});
