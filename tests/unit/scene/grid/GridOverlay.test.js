import * as three from 'three';
import { installGridOverlayMethods } from '../../../../src/scene/grid/GridOverlay.js';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';

test('cavern grid fills and lines stay on low floors rather than the tall rock ridges', () => {
  const engine = new TerrainEngine(25, 25);
  engine.generateBiomeElevation('cavern', { seed: 42 });
  const prototype = {};
  installGridOverlayMethods(prototype);
  const manager = Object.assign(Object.create(prototype), {
    three,
    scene: new three.Scene(),
    gameManager: { terrainEngine: engine },
    showBootstrapGrid: true,
    _gridOverlayBaseStyle: {
      fillColor: 0x777777,
      fillAlpha: 0.32,
      borderColor: 0xaaaaaa,
      borderAlpha: 0.5,
    },
    _getBoardMetrics: () => ({ cols: 25, rows: 25, tileSize: 1 }),
    _computeTileHeights: () => ({
      heights: engine
        .save()
        .heights.flat()
        .map((height) => height * 0.5),
      elevationUnit: 0.5,
    }),
  });
  manager._rebuildGridOverlay();
  const fill = manager.scene.getObjectByName('GridBaseFill');
  expect(fill.count).toBeGreaterThan(200);
  expect(fill.count).toBeLessThan(625);
  const lines = manager.scene.getObjectByName('GridLineFrame').geometry.getAttribute('position');
  let outsideCorner = false;
  for (let i = 0; i < lines.count; i++)
    if (lines.getX(i) === 0 && lines.getZ(i) === 0) outsideCorner = true;
  expect(outsideCorner).toBe(false);
  for (const mesh of manager._gridOverlayGroup.children) {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
});
