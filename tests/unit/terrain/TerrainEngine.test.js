/**
 * TerrainEngine integration tests
 * Validates the deep-module event seam: state changes inside fire correct events outside.
 */
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

describe('TerrainEngine', () => {
  describe('construction', () => {
    test('creates an engine with given grid dimensions', () => {
      const e = new TerrainEngine(5, 4);
      expect(e.cols).toBe(5);
      expect(e.rows).toBe(4);
      expect(e.isActive).toBe(false);
      expect(e.tool).toBe('raise');
      expect(e.brushSize).toBeGreaterThanOrEqual(1);
    });
  });

  describe('activation lifecycle', () => {
    test('activate emits activationChanged with active=true', () => {
      const e = new TerrainEngine(4, 4);
      const seen = [];
      e.onActivationChanged((p) => seen.push(p));
      e.activate();
      expect(e.isActive).toBe(true);
      expect(seen).toEqual([{ active: true }]);
    });

    test('activate is idempotent', () => {
      const e = new TerrainEngine(4, 4);
      const seen = [];
      e.onActivationChanged((p) => seen.push(p));
      e.activate();
      e.activate();
      expect(seen.length).toBe(1);
    });

    test('deactivate emits activationChanged with active=false', () => {
      const e = new TerrainEngine(4, 4);
      e.activate();
      const seen = [];
      e.onActivationChanged((p) => seen.push(p));
      e.deactivate();
      expect(e.isActive).toBe(false);
      expect(seen).toEqual([{ active: false }]);
    });
  });

  describe('brush stroke event flow', () => {
    test('applyBrushAt emits heightChanged and tileChanged for affected cells', () => {
      const e = new TerrainEngine(5, 5);
      const heights = [];
      const tiles = [];
      e.onHeightChanged((p) => heights.push(p));
      e.onTileChanged((p) => tiles.push(p));

      e.setTool('raise');
      const changed = e.applyBrushAt(2, 2);

      expect(changed).toBe(true);
      expect(heights.length).toBeGreaterThan(0);
      expect(tiles.length).toBeGreaterThan(0);
      // Center cell should be in the events
      const centerHit = heights.find((h) => h.gridX === 2 && h.gridY === 2);
      expect(centerHit).toBeDefined();
      expect(centerHit.height).toBeGreaterThan(0);
    });

    test('moveBrushTo emits brushMoved with footprint cells', () => {
      const e = new TerrainEngine(5, 5);
      const events = [];
      e.onBrushMoved((p) => events.push(p));
      e.moveBrushTo(1, 1);
      expect(events.length).toBe(1);
      expect(events[0].gridX).toBe(1);
      expect(events[0].gridY).toBe(1);
      expect(Array.isArray(events[0].cells)).toBe(true);
      expect(events[0].cells.length).toBeGreaterThan(0);
    });

    test('commitBrushStroke emits brushCommitted with affected cells', () => {
      const e = new TerrainEngine(5, 5);
      e.applyBrushAt(2, 2);
      const committed = [];
      e.onBrushCommitted((p) => committed.push(p));
      e.commitBrushStroke();
      expect(committed.length).toBe(1);
      expect(committed[0].affectedCells.length).toBeGreaterThan(0);
    });

    test('lower tool decreases height', () => {
      const e = new TerrainEngine(5, 5);
      e.applyBrushAt(2, 2); // raise
      const beforeH = e.getHeightAt(2, 2);
      e.setTool('lower');
      e.applyBrushAt(2, 2);
      expect(e.getHeightAt(2, 2)).toBeLessThan(beforeH);
    });
  });

  describe('subscription management', () => {
    test('unsubscribe stops further callbacks', () => {
      const e = new TerrainEngine(4, 4);
      let count = 0;
      const off = e.onHeightChanged(() => {
        count++;
      });
      e.applyBrushAt(1, 1);
      const after1 = count;
      off();
      e.applyBrushAt(2, 2);
      expect(count).toBe(after1);
    });

    test('listener errors do not break the emit loop', () => {
      const e = new TerrainEngine(4, 4);
      let secondCalled = false;
      e.onHeightChanged(() => {
        throw new Error('boom');
      });
      e.onHeightChanged(() => {
        secondCalled = true;
      });
      expect(() => e.applyBrushAt(1, 1)).not.toThrow();
      expect(secondCalled).toBe(true);
    });
  });

  describe('persistence', () => {
    test('save/load round-trips heights', () => {
      const e1 = new TerrainEngine(4, 4);
      e1.applyBrushAt(1, 1);
      e1.applyBrushAt(2, 2);
      e1.commitBrushStroke();
      const snap = e1.save();

      const e2 = new TerrainEngine(4, 4);
      e2.load(snap);
      expect(e2.getHeightAt(1, 1)).toBe(e1.getHeightAt(1, 1));
      expect(e2.getHeightAt(2, 2)).toBe(e1.getHeightAt(2, 2));
    });

    test('save preserves biome metadata', () => {
      const e = new TerrainEngine(3, 3);
      e.setBiome('grassland', { seed: 42, generateIfFlat: false });
      const snap = e.save();
      expect(snap.biomeKey).toBe('grassland');
      expect(snap.biomeSeed).toBe(42);
    });
  });

  describe('reset', () => {
    test('reset clears all heights and emits tileChanged', () => {
      const e = new TerrainEngine(3, 3);
      e.applyBrushAt(1, 1);
      const events = [];
      e.onTileChanged((p) => events.push(p));
      e.reset();
      // Should emit for every cell (3x3 = 9)
      expect(events.length).toBe(9);
    });
  });

  describe('placeables', () => {
    test('setSelectedPlaceable rejects when in removal mode', () => {
      const e = new TerrainEngine(3, 3);
      e.setPlaceableRemovalMode(true);
      const ok = e.setSelectedPlaceable('tree-oak');
      expect(ok).toBe(false);
      expect(e.getSelectedPlaceable()).toBe(null);
    });

    test('emitPlaceableChanged fires the placeableChanged event', () => {
      const e = new TerrainEngine(3, 3);
      const seen = [];
      e.onPlaceableChanged((p) => seen.push(p));
      e.emitPlaceableChanged(1, 2, 'tree-oak', 'tall');
      expect(seen).toEqual([{ gridX: 1, gridY: 2, placeableId: 'tree-oak', variant: 'tall' }]);
    });
  });

  describe('zero-knowledge of rendering', () => {
    test('TerrainEngine module imports no PIXI or Three.js', () => {
      // eslint-disable-next-line global-require
      const fs = require('fs');
      // eslint-disable-next-line global-require
      const path = require('path');
      const enginePath = path.resolve(process.cwd(), 'src/terrain/TerrainEngine.js');
      const src = fs.readFileSync(enginePath, 'utf8');
      expect(src).not.toMatch(/from ['"]pixi/i);
      expect(src).not.toMatch(/from ['"]three/i);
      expect(src).not.toMatch(/PixiStub/);
    });
  });
});
