import { reprojectAll } from '../../src/utils/ProjectionUtils.js';
import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';

function makeGameManager() {
  return {
    cols: 10,
    rows: 10,
    tileWidth: 64,
    tileHeight: 32,
    gridContainer: { children: [], addChild() {}, sortableChildren: false },
    getViewMode() {
      return this._mode || 'iso';
    },
    setViewMode(m) {
      this._mode = m;
    },
    renderCoordinator: { centerGrid() {} },
    interactionManager: { setGridScale() {} },
    app: { screen: { width: 1024, height: 768 } },
  };
}

describe('Projection placeables visibility', () => {
  test('placeable remains visible after iso -> topdown -> iso cycle', () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm, null, null, {});

    // Stub terrainManager + one placeable
    const placeable = {
      id: 'tree-oak',
      gridX: 2,
      gridY: 3,
      x: 0,
      y: 0,
      visible: true,
      renderable: true,
    };
    c.terrainManager = {
      placeables: new Map([['2,3', [placeable]]]),
    };
    gm.terrainCoordinator = c;

    // Initial isometric projection
    reprojectAll(gm, 'isometric');
    expect(placeable.visible).toBe(true);
    expect(placeable.renderable).toBe(true);
    const isoX = placeable.x;
    const isoY = placeable.y;

    // Switch to topdown
    reprojectAll(gm, 'topdown');
    expect(placeable.visible).toBe(true); // stays visible in top-down
    expect(placeable.renderable).toBe(true);

    // Simulate bug where something else hid the placeable (regression guard)
    placeable.visible = false;
    placeable.renderable = false;

    // Back to isometric should force visible/renderable true due to patch
    reprojectAll(gm, 'isometric');
    expect(placeable.visible).toBe(true);
    expect(placeable.renderable).toBe(true);
    // Position restored (either original or recomputed)
    expect(typeof placeable.x).toBe('number');
    expect(typeof placeable.y).toBe('number');
    // If original cached, should match
    if (placeable.__originalIsoCaptured) {
      expect(placeable.x).toBe(isoX);
      expect(placeable.y).toBe(isoY);
    }
  });
});
