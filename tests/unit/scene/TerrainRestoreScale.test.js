import GameManager from '../../../src/core/GameManager.js';
import { TerrainEngineSceneAdapter } from '../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import { TerrainHeightUtils } from '../../../src/utils/terrain/TerrainHeightUtils.js';

test('loading saved terrain retains its configured physical scale while restoring perception settings', () => {
  const previousPixels = TerrainHeightUtils.getElevationUnit();
  const gm = new GameManager({ cols: 4, rows: 4 });
  gm.renderMode = '3d';
  gm.threeSceneManager = {
    canvas: document.createElement('canvas'),
    scene: {},
    isReady: () => true,
    clearTerrainBrushPreview() {},
  };
  const adapter = new TerrainEngineSceneAdapter({
    engine: gm.terrainEngine,
    gameManager: gm,
    threeSceneManager: gm.threeSceneManager,
  });
  adapter.attach();
  const worldElevationUnit = 0.73;
  const feetPerLevel = (worldElevationUnit * 5) / gm.spatial.tileWorldSize;
  gm.spatial.reconfigure({ elevationUnit: worldElevationUnit });
  gm.terrainEngine.configureGeometryScale(feetPerLevel);
  gm.terrainEngine.setHeightAt(1, 1, 1);
  const physicalSpan = gm.terrainEngine.geometry.getSolidSpansAt(7.5, 7.5);
  const saved = gm.terrainEngine.save();
  saved.elevationScale = previousPixels + 3;
  try {
    gm.terrainEngine.load(saved);
    expect(TerrainHeightUtils.getElevationUnit()).toBe(saved.elevationScale);
    expect(gm.spatial.elevationUnit).toBe(worldElevationUnit);
    expect(gm.terrainEngine.geometry.getSolidSpansAt(7.5, 7.5)).toEqual(physicalSpan);
    gm.terrainEngine.setElevationScale(saved.elevationScale + 1);
    expect(TerrainHeightUtils.getElevationUnit()).toBe(saved.elevationScale + 1);
    expect(gm.spatial.elevationUnit).not.toBe(worldElevationUnit);
  } finally {
    adapter.detach();
    gm.terrainCoordinator.dispose();
    TerrainHeightUtils.setElevationUnit(previousPixels);
  }
});
