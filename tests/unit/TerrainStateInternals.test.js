import { initializeTerrainData } from '../../src/coordinators/terrain-coordinator/internals/init.js';
import { loadBaseTerrainIntoWorkingState } from '../../src/coordinators/terrain-coordinator/internals/state.js';

describe('TerrainCoordinator state internals', () => {
  test('initializeTerrainData resizes datastore for valid grid', () => {
    const c = {
      gameManager: { cols: 5, rows: 4 },
      dataStore: { resize: jest.fn() }
    };
    initializeTerrainData(c);
    expect(c.dataStore.resize).toHaveBeenCalledWith(5, 4);
  });

  test('loadBaseTerrainIntoWorkingState copies when base exists, else initializes', () => {
    const c1 = {
      gameManager: { cols: 3, rows: 3 },
      dataStore: { base: [[0]], loadBaseIntoWorking: jest.fn() },
      initializeTerrainData: jest.fn()
    };
    loadBaseTerrainIntoWorkingState(c1);
    expect(c1.dataStore.loadBaseIntoWorking).toHaveBeenCalled();
    expect(c1.initializeTerrainData).not.toHaveBeenCalled();

    const c2 = {
      gameManager: { cols: 2, rows: 2 },
      dataStore: { base: null },
      initializeTerrainData: jest.fn()
    };
    loadBaseTerrainIntoWorkingState(c2);
    expect(c2.initializeTerrainData).toHaveBeenCalled();
  });
});
