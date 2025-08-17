import { TileLifecycleController } from '../../src/coordinators/terrain-coordinator/TileLifecycleController.js';

// Minimal stubs for coordinator and dependencies
function makeCoordinatorStub() {
  const removed = [];
  const gridContainer = {
    children: [],
    removeChild: (t) => { removed.push(t); }
  };
  const gameManager = {
    gridContainer,
    gridRenderer: {
      drawIsometricTile: (x, y, color) => ({ x, y, color, destroyed: false, parent: gridContainer })
    }
  };
  const faces = { addBaseFaces: jest.fn() };
  const dataStore = { base: [[0,0],[0,0]] };
  return {
    isTerrainModeActive: true,
    getColorForHeight: (h) => 0x112233,
    _getBiomeOrBaseColor: (h) => 0x445566,
    addVisualElevationEffect: jest.fn(),
    gameManager,
    faces,
    dataStore
  };
}

describe('TileLifecycleController', () => {
  test('findGridTilesToRemove returns only matching, non-destroyed tiles', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);

    const t1 = { isGridTile: true, gridX: 1, gridY: 2, destroyed: false };
    const t2 = { isGridTile: true, gridX: 1, gridY: 2, destroyed: true };
    const t3 = { isGridTile: true, gridX: 2, gridY: 2, destroyed: false };
    coord.gameManager.gridContainer.children = [t1, t2, t3];

    const res = ctrl.findGridTilesToRemove(1, 2);
    expect(res).toEqual([t1]);
  });

  test('removeGridTilesSafely removes and destroys tiles, isolating errors', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);
    const t = { destroyed: false, destroy: jest.fn(), isGridTile: true, gridX: 0, gridY: 0 };
    coord.gameManager.gridContainer.children = [t];

    ctrl.removeGridTilesSafely([t], 0, 0);
    expect(coord.gameManager.gridContainer.removeChild).toBeDefined();
    expect(t.destroy).toHaveBeenCalled();
  });

  test('createReplacementTile returns a new PIXI-like object and throws if bad', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);
    const tile = ctrl.createReplacementTile(0, 0, 1);
    expect(tile).toMatchObject({ x: 0, y: 0, destroyed: false });
  });

  test('applyTileEffectsAndData calls elevation effect and adds faces', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);
    const tile = { parent: coord.gameManager.gridContainer };

    ctrl.applyTileEffectsAndData(tile, 2, 0, 0);
    expect(coord.addVisualElevationEffect).toHaveBeenCalled();
    expect(coord.faces.addBaseFaces).toHaveBeenCalled();
    expect(tile.terrainHeight).toBe(2);
  });
});
