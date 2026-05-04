import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';

function makeGameManager(cols = 2, rows = 2) {
  return {
    cols,
    rows,
    gridContainer: { children: [], addChild() {}, removeChild() {} },
    app: { view: document.createElement('canvas') },
    gridRenderer: { drawIsometricTile: jest.fn() },
    tokenManager: { placedTokens: [] },
  };
}

describe('TerrainCoordinator validation wrappers', () => {
  test('validateTerrainDataConsistency returns true for correctly shaped arrays', () => {
    const gm = makeGameManager(3, 2);
    const c = new TerrainCoordinator(gm);
    // Created in constructor via TerrainDataStore; adjust to proper dimensions
    c.dataStore.working = Array(gm.rows)
      .fill(null)
      .map(() => Array(gm.cols).fill(0));
    c.dataStore.base = Array(gm.rows)
      .fill(null)
      .map(() => Array(gm.cols).fill(0));
    expect(c.validateTerrainDataConsistency()).toBe(true);
  });

  test('validateTerrainDataConsistency returns false for mismatched dimensions', () => {
    const gm = makeGameManager(3, 2);
    const c = new TerrainCoordinator(gm);
    c.dataStore.working = [[0]]; // wrong shape
    c.dataStore.base = [
      [0, 0, 0],
      [0, 0, 0],
    ];
    expect(c.validateTerrainDataConsistency()).toBe(false);
  });

  test('validateTerrainSystemState returns true when terrainManager is null (ADR-0001: manager deleted)', () => {
    const gm = makeGameManager(2, 2);
    const c = new TerrainCoordinator(gm);
    // terrainManager is null (deleted); validation should succeed without throwing
    expect(() => c.validateTerrainSystemState()).not.toThrow();
  });

  test('validateTerrainSystemState returns true when data is well-formed', () => {
    const gm = makeGameManager(2, 2);
    const c = new TerrainCoordinator(gm);
    // Ensure data arrays exist and look valid
    c.dataStore.working = Array(gm.rows)
      .fill(null)
      .map(() => Array(gm.cols).fill(0));
    c.dataStore.base = Array(gm.rows)
      .fill(null)
      .map(() => Array(gm.cols).fill(0));
    expect(c.validateTerrainSystemState()).toBe(true);
  });
});
