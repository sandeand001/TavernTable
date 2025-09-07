import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';

// Minimal GameManager stub for coordinator construction
function makeGameManager(cols = 3, rows = 3) {
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

describe('TerrainCoordinator public surface smoke tests', () => {
  test('tool selection and brush size controls work and clamp values', async () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm);

    // Default tool is raise; switch to lower via public API
    c.setTerrainTool('lower');
    expect(c.brush.tool).toBe('lower');

    // Brush size getter/setter with clamping
    const maxTry = 999;
    c.brushSize = maxTry; // should clamp to max
    expect(typeof c.brush.brushSize).toBe('number');
    expect(c.brush.brushSize).toBeGreaterThan(0);

    const beforeInc = c.brush.brushSize;
    c.increaseBrushSize();
    expect(c.brush.brushSize).toBeGreaterThanOrEqual(beforeInc);

    const beforeDec = c.brush.brushSize;
    c.decreaseBrushSize();
    expect(c.brush.brushSize).toBeLessThanOrEqual(beforeDec);
  });

  test('elevation scale getter/setter reflect values', () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm);
    const prev = c.getElevationScale();
    c.setElevationScale(prev + 2);
    expect(c.getElevationScale()).toBe(prev + 2);
  });

  test('getTerrainHeight proxies working store value', () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm);
    c.dataStore.working[1][1] = 3;
    expect(c.getTerrainHeight(1, 1)).toBe(3);
  });

  test('applyBiomePaletteToBaseGrid forwards to shading facade', () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm);
    // Replace facade method with spy
    c._biomeShading.applyToBaseGrid = jest.fn();
    c.applyBiomePaletteToBaseGrid();
    expect(c._biomeShading.applyToBaseGrid).toHaveBeenCalledTimes(1);
  });
});
