import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';

// Minimal GameManager stub for coordinator construction (mirrors public smoke test)
function makeGameManager(cols = 4, rows = 4) {
  const gridContainer = {
    children: [],
    sortChildren: jest.fn(),
    addChild(child) {
      this.children.push(child);
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
    },
    getChildIndex(child) {
      return this.children.indexOf(child);
    },
    sortableChildren: true,
  };
  const app = { view: document.createElement('canvas') };
  const gridRenderer = {
    drawIsometricTile: jest.fn((x, y) => {
      const g = new PIXI.Graphics();
      g.isGridTile = true;
      g.gridX = x;
      g.gridY = y;
      g.baseIsoY = 100;
      g.y = 100;
      g.depthValue = x + y;
      g.clear = jest.fn();
      g.lineStyle = jest.fn();
      g.beginFill = jest.fn();
      g.moveTo = jest.fn();
      g.lineTo = jest.fn();
      g.endFill = jest.fn();
      g.addChild = jest.fn();
      g.parent = gridContainer;
      return g;
    }),
  };
  return {
    cols,
    rows,
    tileWidth: 64,
    tileHeight: 32,
    gridContainer,
    app,
    gridRenderer,
    tokenManager: { placedTokens: [] },
  };
}

describe('TerrainCoordinator.generateBiomeElevationIfFlat integration', () => {
  test('generates elevations on flat grid and repaints base tiles', () => {
    const gm = makeGameManager(5, 3);
    const c = new TerrainCoordinator(gm);

    // Precondition: all heights are default
    const allDefaultBefore =
      c.dataStore.base.every((r) => r.every((v) => v === 0)) &&
      c.dataStore.working.every((r) => r.every((v) => v === 0));
    expect(allDefaultBefore).toBe(true);

    const didGen = c.generateBiomeElevationIfFlat('hills', { seed: 12345 });
    expect(didGen).toBe(true);

    // Data updated
    const allDefaultAfter = c.dataStore.base.every((r) => r.every((v) => v === 0));
    expect(allDefaultAfter).toBe(false);

    // Repaint called for at least some tiles
    expect(gm.gridRenderer.drawIsometricTile).toHaveBeenCalled();
  });

  test('no-ops when terrain is not flat or when terrain mode is active', () => {
    const gm = makeGameManager(3, 3);
    const c = new TerrainCoordinator(gm);

    // First call generates
    expect(c.generateBiomeElevationIfFlat('grassland', { seed: 1 })).toBe(true);
    const drawCallsAfterFirst = gm.gridRenderer.drawIsometricTile.mock.calls.length;

    // Second call should no-op (not flat anymore)
    expect(c.generateBiomeElevationIfFlat('grassland', { seed: 2 })).toBe(false);
    expect(gm.gridRenderer.drawIsometricTile.mock.calls.length).toBe(drawCallsAfterFirst);

    // Force terrain mode active -> should also no-op
    c.isTerrainModeActive = true;
    expect(c.generateBiomeElevationIfFlat('grassland', { seed: 3 })).toBe(false);
  });
});
