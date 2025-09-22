import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';

describe('TerrainCoordinator.modifyTerrainHeightAtCell (delegated)', () => {
  test('calls brush.applyAt with provided coordinates', () => {
    const gameManager = { cols: 2, rows: 2 };
    const c = new TerrainCoordinator(gameManager);
    c.brush.applyAt = jest.fn();
    c.modifyTerrainHeightAtCell(1, 0);
    expect(c.brush.applyAt).toHaveBeenCalledWith(1, 0);
  });
});
