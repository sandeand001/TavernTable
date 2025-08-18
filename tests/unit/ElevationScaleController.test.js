import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';
import { TerrainHeightUtils } from '../../src/utils/TerrainHeightUtils.js';

// Minimal GameManager stub for coordinator
function makeGameManager(cols = 2, rows = 2) {
  const gridContainer = {
    children: [],
    sortChildren: jest.fn(),
    addChild: function(child) { this.children.push(child); },
    removeChild: function(child) { this.children = this.children.filter(c => c !== child); },
    getChildIndex: function(child) { return this.children.indexOf(child); },
    sortableChildren: true
  };
  const app = { view: document.createElement('canvas') };
  const gridRenderer = {
    drawIsometricTile: jest.fn((x, y, color) => {
      const g = new PIXI.Graphics();
      g.isGridTile = true;
      g.gridX = x; g.gridY = y;
      g.baseIsoY = 100; g.y = 100;
      g.depthValue = (x + y);
      g.clear = jest.fn();
      g.lineStyle = jest.fn();
      g.beginFill = jest.fn();
      g.moveTo = jest.fn();
      g.lineTo = jest.fn();
      g.endFill = jest.fn();
      g.addChild = jest.fn();
      g.parent = gridContainer;
      return g;
    })
  };
  const tokenManager = { placedTokens: [] };
  return {
    cols, rows,
    tileWidth: 64, tileHeight: 32,
    gridContainer,
    app,
    gridRenderer,
    tokenManager,
  };
}

describe('ElevationScaleController.apply', () => {
  test('updates TerrainHeightUtils unit and re-adds faces for base tiles', async () => {
    const gm = makeGameManager(2,2);
    // Construct a coordinator with the stub GameManager
    const c = new TerrainCoordinator(gm);

    // Seed grid with a base tile and height data
    // Initialize terrainManager requirements to avoid calls that depend on it
    c.terrainManager = { refreshAllTerrainDisplay: jest.fn(), hideAllTerrainTiles: jest.fn(), clearAllTerrainTiles: jest.fn() };

    // Create two tiles with different heights to ensure faces are added on boundaries
    const t0 = gm.gridRenderer.drawIsometricTile(0, 0, 0xffffff);
    const t1 = gm.gridRenderer.drawIsometricTile(1, 0, 0xffffff);
    gm.gridContainer.addChild(t0);
    gm.gridContainer.addChild(t1);

    // Put heights into base and working store to enable face comparison
    c.dataStore.base[0][0] = 2; c.dataStore.working[0][0] = 2;
    c.dataStore.base[0][1] = 0; c.dataStore.working[0][1] = 0;
    // Tag the tiles with terrainHeight to mimic base tiles
    t0.terrainHeight = 2;
    t1.terrainHeight = 0;

    // Sanity: elevation unit starts at default
    const prevUnit = TerrainHeightUtils.getElevationUnit();

    // Apply a new elevation scale
    c.setElevationScale(prevUnit + 3);

    // Unit should update
    expect(TerrainHeightUtils.getElevationUnit()).toBe(prevUnit + 3);

    // Faces should be (re)added on t0 since it is higher than right neighbor
    // The controller removes baseSideFaces first, then re-adds via tile lifecycle
    // So we just verify property is set
    expect(t0.baseSideFaces || null).not.toBeNull();
  });
});
