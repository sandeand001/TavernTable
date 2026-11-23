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

function gridManager({ cols, rows, heights, cavern = null }) {
  const prototype = {};
  installGridOverlayMethods(prototype);
  return Object.assign(Object.create(prototype), {
    three,
    scene: new three.Scene(),
    gameManager: {
      terrainEngine: cavern
        ? {
            cavern,
            isActive: false,
            getHeightAt: (x, y) => heights[y * cols + x],
          }
        : null,
    },
    showBootstrapGrid: true,
    _gridOverlayBaseStyle: {
      fillColor: 0x777777,
      fillAlpha: 0.32,
      borderColor: 0xaaaaaa,
      borderAlpha: 0.5,
    },
    _getBoardMetrics: () => ({ cols, rows, tileSize: 1 }),
    _computeTileHeights: () => ({ heights, elevationUnit: 0 }),
  });
}

test('public cavern render style keeps the grid off boundary rock', () => {
  const manager = gridManager({
    cols: 3,
    rows: 3,
    heights: [8, 8, 8, 8, -8, 8, 8, 8, 8],
    cavern: { version: 6 },
  });
  manager.gameManager.terrainEngine.cavern = null;
  manager.gameManager.campaignMapId = 'cavern';
  manager.gameManager.campaignWorld = {
    getMap: () => ({ terrain: { renderStyle: 'cavern' } }),
  };
  manager._rebuildGridOverlay();
  expect(manager.scene.getObjectByName('GridBaseFill').count).toBe(1);
});

test('a flat grid emits each shared edge once', () => {
  const cols = 3,
    rows = 2,
    manager = gridManager({ cols, rows, heights: Array(cols * rows).fill(0) });
  manager._rebuildGridOverlay();
  const positions = manager.scene
    .getObjectByName('GridLineFrame')
    .geometry.getAttribute('position');
  const actualSegments = positions.count / 2;
  expect(actualSegments).toBe(2 * cols * rows + cols + rows);
});

test('unequal adjacent tile heights retain both physical edge levels', () => {
  const manager = gridManager({ cols: 2, rows: 1, heights: [0, 1] });
  manager._rebuildGridOverlay();
  const positions = manager.scene
    .getObjectByName('GridLineFrame')
    .geometry.getAttribute('position');
  const levels = [];
  for (let i = 0; i < positions.count; i += 2) {
    if (Math.abs(positions.getX(i) - 1) < 1e-8 && Math.abs(positions.getX(i + 1) - 1) < 1e-8)
      levels.push(positions.getY(i));
  }
  expect(levels).toHaveLength(2);
  expect(levels.sort((a, b) => a - b)).toEqual(
    expect.arrayContaining([expect.closeTo(0.004), expect.closeTo(1.004)])
  );
});
