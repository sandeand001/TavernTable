import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';

// Minimal GameManager stub
function makeGameManager(cols = 5, rows = 5) {
  return {
    cols,
    rows,
    tileWidth: 64,
    tileHeight: 32,
    gridContainer: { addChild() {}, removeChildren() {}, sortableChildren: false },
    app: { view: { addEventListener() {} } },
    getViewMode() {
      return 'iso';
    },
  };
}

describe('PlaceableRemovalMode', () => {
  test('enabling placeable removal mode clears selected placeable', async () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm, null, null, {});
    c._selectedPlaceable = 'tree-oak';
    c.setPlaceableRemovalMode(true);
    expect(c.isPlaceableRemovalMode()).toBe(true);
    expect(c.getSelectedPlaceable()).toBe(null);
  });

  test('removes plant placeables on click when placeable removal mode active', async () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm, null, null, {});
    // Provide a terrainManager stub with placeables and removal implementation
    c.terrainManager = {
      placeables: new Map(),
      removeTerrainItem(x, y, id) {
        const key = `${x},${y}`;
        const arr = this.placeables.get(key) || [];
        const idx = arr.findIndex((s) => s.id === id);
        if (idx !== -1) arr.splice(idx, 1);
        if (arr.length === 0) this.placeables.delete(key);
        return true;
      },
      flushUpdateQueue() {},
    };

    // Seed a tile with two plant sprites and one non-plant (structure) to ensure filtering works
    const key = '2,3';
    c.terrainManager.placeables.set(key, [
      { id: 'tree-oak', placeableType: 'plant' },
      { id: 'tree-pine', placeableType: 'plant' },
      { id: 'hut-small', placeableType: 'structure' },
    ]);

    // Enable removal mode
    c.setPlaceableRemovalMode(true);

    // Patch coordinate helper to return target cell
    c.getGridCoordinatesFromEvent = () => ({ gridX: 2, gridY: 3 });
    // Provide brush + ptBrush size properties used in handler
    c.brush = { brushSize: 1 };
    c.ptBrushSize = 1;
    c.isTerrainModeActive = false;

    // Instantiate input handlers and invoke mousedown
    const h = c._inputHandlers;
    const evt = { button: 0, preventDefault() {}, stopPropagation() {} };
    h.handleMouseDown(evt);

    // After removal, structure should remain, plants removed
    const remaining = c.terrainManager.placeables.get(key) || [];
    expect(remaining.length).toBe(1);
    expect(remaining[0].id).toBe('hut-small');
  });

  test('selection is blocked while placeable removal mode active', () => {
    const gm = makeGameManager();
    const c = new TerrainCoordinator(gm, null, null, {});
    expect(c.getSelectedPlaceable()).toBe(null);
    // Enable removal mode
    c.setPlaceableRemovalMode(true);
    const result = c.setSelectedPlaceable('tree-oak');
    expect(result).toBe(false);
    expect(c.getSelectedPlaceable()).toBe(null);
    // Disable removal mode and try again
    c.setPlaceableRemovalMode(false);
    const result2 = c.setSelectedPlaceable('tree-oak');
    expect(result2).toBe(true);
    expect(c.getSelectedPlaceable()).toBe('tree-oak');
  });
});

// keep ES module semantics for potential future shared helpers
