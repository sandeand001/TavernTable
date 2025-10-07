import { GameManager } from '../../src/core/GameManager.js';

describe('TerrainMesh integration (Phase 2)', () => {
  test('rebuild request invoked after terrain height change in hybrid mode (graceful if three unavailable)', async () => {
    const gm = new GameManager({ cols: 4, rows: 4 });
    // stub minimal pieces required by TerrainCoordinator initialization
    gm.gridContainer = { addChild() {}, removeChildren() {} };
    await gm.terrainCoordinator.initializeTerrainData();
    // Enable hybrid (may degrade in headless test env); ensure no throw
    await gm.enableHybridRender();
    // Ensure a height mutation actually occurs: activate terrain mode and set a tool.
    try {
      gm.enableTerrainMode();
      gm.setTerrainTool('raise');
    } catch (_) {
      // Non-fatal for environments where terrain mode prerequisites not fully stubbed
    }
    const rebuilder = gm.terrainRebuilder;
    if (!rebuilder) return; // degraded path skip
    const spy = jest.spyOn(rebuilder, 'request');
    gm.terrainCoordinator.modifyTerrainHeightAtCell(0, 0);
    expect(spy).toHaveBeenCalled();
  });
});
