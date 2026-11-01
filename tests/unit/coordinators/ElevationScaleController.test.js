import { createTerrainWorld } from '../../helpers/terrainWorld.js';
import { TerrainHeightUtils } from '../../../src/utils/terrain/TerrainHeightUtils.js';

test('changing elevation perception updates the shared unit and notifies the 3D adapter once', () => {
  const world = createTerrainWorld(5, 5, null);
  const previous = TerrainHeightUtils.getElevationUnit();
  try {
    world.engine.setElevationScale(previous + 3);
    expect(world.engine.elevationScale).toBe(previous + 3);
    expect(TerrainHeightUtils.getElevationUnit()).toBe(previous + 3);
    expect(world.gm.sync3DElevationScaling).toHaveBeenCalledWith({ rebuild: false });
    expect(world.gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
  } finally {
    world.dispose();
    TerrainHeightUtils.setElevationUnit(previous);
  }
});
