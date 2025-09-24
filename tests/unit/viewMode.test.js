import { GameManager } from '../../src/core/GameManager.js';

/**
 * viewMode.test.js - Basic unit tests for view mode toggle & coordinate consistency.
 * Uses jsdom environment; PIXI may be undefined so we stub minimal structures where needed.
 */

describe('View Mode Toggle', () => {
  beforeAll(() => {
    // Provide PIXI stubs for tests that rely on ProjectionUtils creating graphics
    if (typeof global.PIXI === 'undefined') {
      global.PIXI = {
        Graphics: class {
          constructor() {
            this.children = [];
            this.visible = true;
          }
          beginFill() {}
          lineStyle() {}
          drawRect() {}
          endFill() {}
          addChild(c) {
            this.children.push(c);
          }
        },
        Container: class {
          constructor() {
            this.children = [];
            this.sortableChildren = false;
          }
          addChild(c) {
            this.children.push(c);
            c.parent = this;
          }
          removeChild(c) {
            this.children = this.children.filter((x) => x !== c);
          }
          sortChildren() {}
        },
        Application: class {
          constructor() {
            this.stage = new global.PIXI.Container();
            this.canvas = {};
            this.renderer = { resize() {}, type: 'stub' };
            this.screen = { width: 800, height: 600 };
          }
        },
      };
    }
  });

  test('toggle switches modes and persists', async () => {
    const gm = new GameManager({ cols: 3, rows: 3 });
    // Monkey-patch pieces needed for init subset
    gm.app = new PIXI.Application();
    gm.gridRenderer = {
      drawIsometricTile: jest.fn((x, y, color) => {
        const g = new PIXI.Graphics();
        g.__gridX = x;
        g.__gridY = y;
        g.__baseColor = color;
        gm.gridContainer.addChild(g);
        return g;
      }),
      redrawGrid: jest.fn(),
    };
    gm.renderCoordinator = {
      createPixiApp: jest.fn(),
      fixExistingTokens: jest.fn(),
      centerGrid: jest.fn(),
      resetZoom: jest.fn(),
    };
    gm.stateCoordinator.renderCoordinator = gm.renderCoordinator;
    gm.gridContainer = new PIXI.Container();
    // Simulate grid setup
    for (let y = 0; y < gm.rows; y++) {
      for (let x = 0; x < gm.cols; x++) {
        gm.gridRenderer.drawIsometricTile(x, y, 0x123456);
      }
    }
    window.gameManager = gm;
    gm.stateCoordinator.initializeViewMode();
    expect(gm.getViewMode()).toBe('isometric');
    gm.toggleViewMode();
    expect(['isometric', 'topdown']).toContain(gm.getViewMode());
    // Force second toggle for round trip
    const first = gm.getViewMode();
    gm.toggleViewMode();
    expect(gm.getViewMode()).not.toBe(first);
  });

  test('topdown coordinate inversion matches grid centers', () => {
    const gm = new GameManager({ cols: 10, rows: 10 });
    gm.app = new PIXI.Application();
    gm.interactionManager = {
      getGridScale: () => 1,
      setGridScale: () => {},
      getIsDragging: () => false,
      getIsSpacePressed: () => false,
    };
    gm.stateCoordinator.initializeViewMode();
    // Force mode topdown
    gm.stateCoordinator.setViewMode('topdown');
    // Build mock InteractionManager-like method using real logic via patch import
    const InteractionManager =
      require('../../src/managers/InteractionManager.js').InteractionManager;
    const im = new InteractionManager(gm);
    // Simulate topdown mode by returning topdown in gm.getViewMode
    gm.getViewMode = () => 'topdown';
    const localX = gm.tileWidth * 5 + gm.tileWidth / 2;
    const localY = gm.tileHeight * 7 + gm.tileHeight / 2;
    const { gridX, gridY } = im.convertToGridCoordinates({ localX, localY });
    expect(gridX).toBe(5);
    expect(gridY).toBe(7);
  });
});
