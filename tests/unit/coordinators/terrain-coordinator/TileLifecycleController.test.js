import { TileLifecycleController } from '../../../../src/coordinators/terrain-coordinator/TileLifecycleController.js';

// Minimal stubs for coordinator and dependencies
function makeCoordinatorStub() {
  const faces = { addBaseFaces: jest.fn() };
  const dataStore = {
    base: [
      [0, 0],
      [0, 0],
    ],
  };
  return {
    isTerrainModeActive: true,
    getColorForHeight: () => 0x112233,
    _getBiomeOrBaseColor: () => 0x445566,
    addVisualElevationEffect: jest.fn(),
    gameManager: {},
    faces,
    dataStore,
  };
}

describe('TileLifecycleController', () => {
  test('findGridTilesToRemove returns empty array (no 2D tiles in 3D mode)', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);
    const res = ctrl.findGridTilesToRemove(1, 2);
    expect(res).toEqual([]);
  });

  test('removeGridTilesSafely is a safe no-op', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);
    expect(() => ctrl.removeGridTilesSafely([], 0, 0)).not.toThrow();
  });

  test('createReplacementTile throws (2D tile creation removed)', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);
    expect(() => ctrl.createReplacementTile(0, 0, 1)).toThrow();
  });

  test('applyTileEffectsAndData calls elevation effect and adds faces', () => {
    const coord = makeCoordinatorStub();
    const ctrl = new TileLifecycleController(coord);
    const tile = {};

    ctrl.applyTileEffectsAndData(tile, 2, 0, 0);
    expect(coord.addVisualElevationEffect).toHaveBeenCalled();
    expect(coord.faces.addBaseFaces).toHaveBeenCalled();
    expect(tile.terrainHeight).toBe(2);
  });
});
