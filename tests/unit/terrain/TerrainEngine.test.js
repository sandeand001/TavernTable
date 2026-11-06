/**
 * TerrainEngine integration tests
 * Validates the deep-module event seam: state changes inside fire correct events outside.
 */
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { TERRAIN_CONFIG } from '../../../src/config/terrain/TerrainConstants.js';

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
      e.beginBrushStroke(2, 2);
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

  describe('transactional editing', () => {
    test('a dragged preview does not change gameplay heights or saved terrain until release', () => {
      const e = new TerrainEngine(5, 4);
      const changed = jest.fn();
      const preview = jest.fn();
      e.onChanged(changed);
      e.onBrushMoved(preview);
      e.beginBrushStroke(1, 1);
      e.updateBrushStroke(2, 1);

      expect(e.hasPendingStroke).toBe(true);
      expect(e.getHeightAt(1, 1)).toBe(0);
      expect(e.getHeightAt(2, 1)).toBe(0);
      expect(e.save().heights[1]).toEqual([0, 0, 0, 0, 0]);
      expect(changed).not.toHaveBeenCalled();
      expect(preview).toHaveBeenLastCalledWith(
        expect.objectContaining({
          cells: expect.arrayContaining([
            { x: 1, y: 1, currentHeight: 0, previewHeight: 1 },
            { x: 2, y: 1, currentHeight: 0, previewHeight: 1 },
          ]),
        })
      );

      expect(e.commitBrushStroke()).toBe(true);
      expect(e.hasPendingStroke).toBe(false);
      expect(e.getHeightAt(1, 1)).toBe(1);
      expect(e.getHeightAt(2, 1)).toBe(1);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(e.save().heights[1]).toEqual([0, 1, 1, 0, 0]);
    });

    test('one undo restores the whole gesture, including overlapping brush cells', () => {
      const e = new TerrainEngine(6, 4);
      const before = e.save();
      e.setBrushSize(2);
      e.beginBrushStroke(1, 1);
      e.updateBrushStroke(2, 1);
      e.updateBrushStroke(2, 1);
      e.commitBrushStroke();
      const after = e.save();

      expect(e.getHeightAt(2, 1)).toBe(2);
      expect(e.undo()).toBe(true);
      expect(e.save()).toEqual(before);
      expect(e.canUndo).toBe(false);
      expect(e.canRedo).toBe(true);
      expect(e.redo()).toBe(true);
      expect(e.save()).toEqual(after);
    });

    test('canceling, changing tools, and leaving terrain mode discard an unfinished preview', () => {
      const e = new TerrainEngine(5, 5);
      e.activate();
      const before = e.save();
      e.beginBrushStroke(1, 1);
      e.cancelBrushStroke();
      expect(e.save()).toEqual(before);
      expect(e.canUndo).toBe(false);

      e.beginBrushStroke(2, 2);
      e.setTool('lower');
      expect(e.hasPendingStroke).toBe(false);
      expect(e.save()).toEqual(before);

      e.beginBrushStroke(3, 3);
      e.deactivate();
      expect(e.hasPendingStroke).toBe(false);
      expect(e.save()).toEqual(before);
    });

    test('wall previews follow the current rectangle, exact top level and outline style', () => {
      const e = new TerrainEngine(6, 5);
      e.setHeightAt(2, 2, 7);
      e.setTool('wall');
      e.setWallTopLevel(-3);
      e.setWallFillMode('outline');
      e.beginBrushStroke(1, 1);
      e.updateBrushStroke(5, 4);
      e.updateBrushStroke(3, 3);
      expect(e.getHeightAt(1, 1)).toBe(0);
      expect(e.getHeightAt(2, 2)).toBe(7);
      e.commitBrushStroke();

      expect(e.save().heights).toEqual([
        [0, 0, 0, 0, 0, 0],
        [0, -3, -3, -3, 0, 0],
        [0, -3, 7, -3, 0, 0],
        [0, -3, -3, -3, 0, 0],
        [0, 0, 0, 0, 0, 0],
      ]);
      expect(e.undo()).toBe(true);
      expect(e.getHeightAt(2, 2)).toBe(7);
      expect(e.getHeightAt(1, 1)).toBe(0);
    });

    test('no-op edits and canceled previews preserve redo; a new committed edit replaces it', () => {
      const e = new TerrainEngine(3, 3);
      e.setHeightAt(1, 1, 7);
      e.setHeightAt(1, 1, 8);
      e.undo();
      expect(e.setHeightAt(1, 1, 7)).toBe(false);
      e.beginBrushStroke(0, 0);
      e.cancelBrushStroke();
      expect(e.canRedo).toBe(true);
      expect(e.redo()).toBe(true);
      expect(e.getHeightAt(1, 1)).toBe(8);
      e.undo();
      e.setHeightAt(1, 1, 6);
      expect(e.canRedo).toBe(false);
    });

    test('undo cancels an active preview without also undoing the previous committed edit', () => {
      const e = new TerrainEngine(3, 3);
      e.setHeightAt(1, 1, 4);
      e.beginBrushStroke(2, 2);
      expect(e.undo()).toBe(true);
      expect(e.hasPendingStroke).toBe(false);
      expect(e.getHeightAt(1, 1)).toBe(4);
      expect(e.getHeightAt(2, 2)).toBe(0);
      expect(e.undo()).toBe(true);
      expect(e.getHeightAt(1, 1)).toBe(0);
    });

    test('reset is undoable, while resizing starts a new history and preserves retained cells', () => {
      const e = new TerrainEngine(5, 4);
      e.setHeightAt(3, 2, 8);
      e.reset();
      expect(e.getHeightAt(3, 2)).toBe(0);
      e.undo();
      expect(e.getHeightAt(3, 2)).toBe(8);
      e.beginBrushStroke(1, 1);
      e.resize(6, 3);
      expect(e.cols).toBe(6);
      expect(e.rows).toBe(3);
      expect(e.getHeightAt(3, 2)).toBe(8);
      expect(e.getHeightAt(1, 1)).toBe(0);
      expect(e.hasPendingStroke).toBe(false);
      expect(e.canUndo).toBe(false);
      expect(e.canRedo).toBe(false);
    });

    test('shrinking past a ruined structure discards its dangling breach cuts but keeps retained physical groups', () => {
      const e = new TerrainEngine(12, 12);
      e.placeStructure({
        id: 'outside-ruin',
        kind: 'building',
        xFeet: 20,
        zFeet: 40,
        lengthFeet: 25,
        widthFeet: 20,
        heightFeet: 10,
        ruined: true,
      });
      e.placeStructure({
        id: 'retained',
        kind: 'wall',
        xFeet: 10,
        zFeet: 10,
        lengthFeet: 10,
        widthFeet: 2,
      });
      expect(e.resize(6, 6)).toBe(true);
      expect(e.geometry.getStructures().map((spec) => spec.id)).toEqual(['retained']);
      expect(e.geometry.save().volumes.every((volume) => volume.structureId === 'retained')).toBe(
        true
      );
      const reopened = new TerrainEngine(1, 1);
      reopened.load(e.save());
      expect(reopened.save()).toEqual(e.save());
    });

    test('history retains exactly the configured number of committed edits', () => {
      const e = new TerrainEngine(3, 3);
      for (let i = 0; i < TERRAIN_CONFIG.HISTORY_LIMIT + 5; i++) {
        e.setHeightAt(1, 1, i % 2 === 0 ? 1 : 0);
      }
      for (let i = 0; i < TERRAIN_CONFIG.HISTORY_LIMIT; i++) {
        expect(e.undo()).toBe(true);
      }
      expect(e.canUndo).toBe(false);
      expect(e.undo()).toBe(false);
    });
  });

  describe('validated snapshots', () => {
    test('an empty finite floor retains its explicit geometry snapshot for connected cellar saves', () => {
      const engine = new TerrainEngine(5, 5);
      engine.configureGeometryBase(0.5);
      const saved = engine.save();
      expect(saved.geometry).toEqual({ version: 1, volumes: [] });
      const restored = new TerrainEngine(5, 5);
      restored.configureGeometryBase(0.5);
      restored.load(saved);
      expect(restored.save()).toEqual(saved);
      expect(restored.geometry.getSolidSpansAt(7.5, 7.5)).toEqual([
        { id: 'terrain', layerId: 'ground', bottom: -0.5, top: 0 },
      ]);
    });

    test('versioned and legacy snapshots restore exact non-square dimensions and metadata', () => {
      const e = new TerrainEngine(3, 2);
      e.setHeightAt(2, 1, 6);
      e.setBiome('hills', { seed: 0, generateIfFlat: false });
      e.setElevationScale(12);
      e.setTreeDensityMultiplier(0.5);
      const saved = e.save();
      expect(saved.version).toBe(1);

      const restored = new TerrainEngine(1, 1);
      restored.load(saved);
      expect(restored.save()).toEqual(saved);
      expect(restored.cols).toBe(3);
      expect(restored.rows).toBe(2);
      expect(restored.canUndo).toBe(false);

      restored.load({ heights: [[-2, 1]], biomeKey: null, biomeSeed: 0 });
      expect(restored.cols).toBe(2);
      expect(restored.rows).toBe(1);
      expect(restored.biomeKey).toBeNull();
      expect(restored.biomeSeed).toBe(0);
      expect(restored.getHeightAt(0, 0)).toBe(-2);
    });

    test.each([
      null,
      { heights: [] },
      { heights: [[1], [2, 3]] },
      { heights: [[NaN]] },
      { heights: [[Infinity]] },
      { heights: [[TERRAIN_CONFIG.MAX_HEIGHT + 1]] },
      { version: 2, heights: [[0]] },
    ])('rejects invalid snapshots without changing state or history: %j', (state) => {
      const e = new TerrainEngine(3, 3);
      e.setHeightAt(1, 1, 4);
      const before = e.save();
      expect(() => e.load(state)).toThrow();
      expect(e.save()).toEqual(before);
      expect(e.canUndo).toBe(true);
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
