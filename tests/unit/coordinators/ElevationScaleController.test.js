/* eslint-disable no-unused-vars */
import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';
import { TerrainHeightUtils } from '../../../src/utils/terrain/TerrainHeightUtils.js';

// Minimal GameManager stub for coordinator
function makeGameManager(cols = 2, rows = 2) {
  const gridContainer = {
    children: [],
    sortChildren: jest.fn(),
    addChild: function (child) {
      this.children.push(child);
    },
    removeChild: function (child) {
      this.children = this.children.filter((c) => c !== child);
    },
    getChildIndex: function (child) {
      return this.children.indexOf(child);
    },
    sortableChildren: true,
  };
  const app = { view: document.createElement('canvas') };
  const gridRenderer = {
    drawIsometricTile: jest.fn((x, y) => {
      const g = {
        children: [],
        destroyed: false,
        isGridTile: true,
        gridX: x,
        gridY: y,
        baseIsoY: 100,
        y: 100,
        depthValue: x + y,
        clear: jest.fn(),
        lineStyle: jest.fn(),
        beginFill: jest.fn(),
        moveTo: jest.fn(),
        lineTo: jest.fn(),
        endFill: jest.fn(),
        addChild: jest.fn(),
        parent: gridContainer,
      };
      return g;
    }),
  };
  const tokenManager = { placedTokens: [] };
  return {
    cols,
    rows,
    tileWidth: 64,
    tileHeight: 32,
    gridContainer,
    app,
    gridRenderer,
    tokenManager,
  };
}

describe('ElevationScaleController.apply', () => {
  test('updates TerrainHeightUtils unit and re-adds faces for base tiles', async () => {
    const gm = makeGameManager(2, 2);
    // Construct a coordinator with the stub GameManager
    const c = new TerrainCoordinator(gm);

    // Seed grid with a base tile and height data
    // Initialize terrainManager requirements to avoid calls that depend on it
    c.terrainManager = {
      refreshAllTerrainDisplay: jest.fn(),
      hideAllTerrainTiles: jest.fn(),
      clearAllTerrainTiles: jest.fn(),
    };

    // Create two tiles with different heights to ensure faces are added on boundaries
    const t0 = gm.gridRenderer.drawIsometricTile(0, 0, 0xffffff);
    const t1 = gm.gridRenderer.drawIsometricTile(1, 0, 0xffffff);
    gm.gridContainer.addChild(t0);
    gm.gridContainer.addChild(t1);

    // Put heights into base and working store to enable face comparison
    c.dataStore.base[0][0] = 2;
    c.dataStore.working[0][0] = 2;
    c.dataStore.base[0][1] = 0;
    c.dataStore.working[0][1] = 0;
    // Tag the tiles with terrainHeight to mimic base tiles
    t0.terrainHeight = 2;
    t1.terrainHeight = 0;

    // Sanity: elevation unit starts at default
    const prevUnit = TerrainHeightUtils.getElevationUnit();

    // Apply a new elevation scale
    c.setElevationScale(prevUnit + 3);

    // Unit should update
    expect(TerrainHeightUtils.getElevationUnit()).toBe(prevUnit + 3);

    // Note: baseSideFaces rendering via TerrainFacesRenderer has been removed (ADR-0001)
    // The elevation unit update is the authoritative signal that scale was applied
  });
});
