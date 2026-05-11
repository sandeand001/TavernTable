import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';

// Minimal GameManager stub for coordinator construction (mirrors public smoke test)
function makeGameManager(cols = 4, rows = 4) {
  const app = { view: document.createElement('canvas') };
  return {
    cols,
    rows,
    tileWidth: 64,
    tileHeight: 32,
    app,
    tokenManager: { placedTokens: [] },
  };
}

describe('TerrainCoordinator.generateBiomeElevationIfFlat integration', () => {
  test('generates elevations on flat grid and updates data store', () => {
    const gm = makeGameManager(5, 3);
    const c = new TerrainCoordinator(gm);

    // Precondition: all heights are default
    const allDefaultBefore =
      c.dataStore.base.every((r) => r.every((v) => v === 0)) &&
      c.dataStore.working.every((r) => r.every((v) => v === 0));
    expect(allDefaultBefore).toBe(true);

    const didGen = c.generateBiomeElevationIfFlat('hills', { seed: 12345 });
    expect(didGen).toBe(true);

    // Data updated (3D mode — no 2D tile drawing, but data store must reflect new heights)
    const allDefaultAfter = c.dataStore.base.every((r) => r.every((v) => v === 0));
    expect(allDefaultAfter).toBe(false);
  });

  test('no-ops when terrain is not flat or when terrain mode is active', () => {
    const gm = makeGameManager(3, 3);
    const c = new TerrainCoordinator(gm);

    // First call generates
    expect(c.generateBiomeElevationIfFlat('grassland', { seed: 1 })).toBe(true);

    // Second call should no-op (not flat anymore)
    expect(c.generateBiomeElevationIfFlat('grassland', { seed: 2 })).toBe(false);

    // Force terrain mode active -> should also no-op
    c.isTerrainModeActive = true;
    expect(c.generateBiomeElevationIfFlat('grassland', { seed: 3 })).toBe(false);
  });
});
