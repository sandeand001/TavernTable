import GameManager from '../../src/core/GameManager.js';

export function createTerrainWorld(cols, rows, pool) {
  const gm = new GameManager({ cols, rows });
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  gm.placeableMeshPool = pool;
  gm.threeSceneManager = {
    canvas,
    clearTerrainBrushPreview: jest.fn(),
    setTerrainBrushPreview: jest.fn(),
  };
  gm.notifyTerrainHeightsChanged = jest.fn();
  gm.sync3DElevationScaling = jest.fn();
  gm.is3DModeActive = () => true;
  gm.interactionManager = { isDragging: false, isSpacePressed: false };
  gm.pickingService = {
    pickGroundSync: (x, y) => (x == null || y == null ? null : { grid: { gx: x, gy: y } }),
  };
  gm.terrainCoordinator.attachScene();
  return {
    gm,
    engine: gm.terrainEngine,
    input: gm.terrainCoordinator.input,
    event: (x, y, extra = {}) => ({
      clientX: x,
      clientY: y,
      target: canvas,
      currentTarget: canvas,
      button: 0,
      buttons: 1,
      preventDefault: jest.fn(),
      stopPropagation: jest.fn(),
      ...extra,
    }),
    dispose() {
      gm.terrainCoordinator.dispose();
      canvas.remove();
    },
  };
}

export function floraContext(gm) {
  return {
    gameManager: gm,
    getTerrainHeight: (x, y) => gm.terrainEngine.getHeightAt(x, y),
    getTreeDensityMultiplier: () => gm.terrainEngine.treeDensityMultiplier,
    _biomeSeed: gm.terrainEngine.biomeSeed,
  };
}
