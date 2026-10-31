import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';
import { TerrainBrushController } from '../../../src/terrain/brush/TerrainBrushController.js';
import { TerrainDataStore } from '../../../src/terrain/TerrainDataStore.js';

function fixture() {
  const canvas = document.createElement('canvas');
  const gm = {
    cols: 8,
    rows: 6,
    getEventCanvas: () => canvas,
    notifyTerrainHeightsChanged: jest.fn(),
    interactionManager: { isDragging: false, isSpacePressed: false },
    threeSceneManager: {
      setTerrainBrushPreview: jest.fn(),
      clearTerrainBrushPreview: jest.fn(),
    },
  };
  const c = new TerrainCoordinator(gm);
  gm.terrainCoordinator = c;
  c.isTerrainModeActive = true;
  c.setTerrainTool('wall');
  c.setWallTopLevel(4);
  c.getGridCoordinatesFromEvent = jest.fn((event) => event.cell);
  const event = (x, y, extra = {}) => ({
    button: 0,
    buttons: 1,
    target: canvas,
    cell: x == null ? null : { gridX: x, gridY: y },
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    ...extra,
  });
  return { c, gm, brush: c.brush, input: c._inputHandlers, event };
}

describe('terrain wall brush', () => {
  test('accepts a wall tool and exposes a separate adjustable top level', () => {
    const brush = new TerrainBrushController(new TerrainDataStore(8, 6));
    brush.setTool('wall');
    expect(brush.tool).toBe('wall');
    brush.setWallTopLevel(6);
    expect(brush.wallTopLevel).toBe(6);
  });

  test.each([NaN, Infinity, -11, 11, 1.5])('rejects invalid wall top level %s', (value) => {
    const brush = new TerrainBrushController(new TerrainDataStore(8, 6));
    const previous = brush.wallTopLevel;
    expect(() => brush.setWallTopLevel(value)).toThrow(RangeError);
    expect(brush.wallTopLevel).toBe(previous);
  });

  test('a single-row drag stays one cell thick and cuts higher terrain to the exact level', () => {
    const { brush, c } = fixture();
    brush.brushSize = 5;
    c.dataStore.set(3, 2, 7);
    brush.beginWallStroke(1, 2);
    expect(brush.getFootprintCells(6, 2)).toEqual(
      Array.from({ length: 6 }, (_, index) => ({ x: index + 1, y: 2 }))
    );
    expect(brush.applyAt(6, 2)).toBe(true);
    expect(c.dataStore.working[2]).toEqual([0, 4, 4, 4, 4, 4, 4, 0]);
    expect(c.dataStore.working[3].every((height) => height === 0)).toBe(true);
    expect(brush.applyAt(6, 2)).toBe(false);
  });

  test('a reverse single-column drag and single-cell walls remain supported', () => {
    const { brush, c } = fixture();
    brush.beginWallStroke(5, 4);
    const cells = brush.getFootprintCells(5, 0);
    expect(cells).toHaveLength(5);
    expect(cells.every((cell) => cell.x === 5)).toBe(true);
    expect(brush.applyAt(5, 0)).toBe(true);
    expect(c.dataStore.working.slice(0, 5).every((row) => row[5] === 4)).toBe(true);
    brush.cancelWallStroke();
    expect(brush.getFootprintCells(2, 3)).toEqual([{ x: 2, y: 3 }]);
  });

  test.each(['filled', 'outline'])(
    '%s mode keeps lines and points free of duplicate cells',
    (mode) => {
      const { brush, c } = fixture();
      c.setWallFillMode(mode);
      brush.beginWallStroke(1, 2);
      expect(brush.getFootprintCells(6, 2)).toEqual(
        Array.from({ length: 6 }, (_, index) => ({ x: index + 1, y: 2 }))
      );
      brush.beginWallStroke(5, 4);
      expect(brush.getFootprintCells(5, 0)).toEqual(
        Array.from({ length: 5 }, (_, y) => ({ x: 5, y }))
      );
      brush.beginWallStroke(3, 3);
      expect(brush.getFootprintCells(3, 3)).toEqual([{ x: 3, y: 3 }]);
    }
  );

  test.each(['', 'both', 'invalid', null])('rejects invalid box fill mode %s', (mode) => {
    const { brush } = fixture();
    expect(() => brush.setWallFillMode(mode)).toThrow(RangeError);
    expect(brush.wallFillMode).toBe('filled');
  });

  test.each(
    ['filled', 'outline'].flatMap((mode) =>
      [
        [1, 1, 4, 3],
        [4, 3, 1, 1],
        [1, 3, 4, 1],
        [4, 1, 1, 3],
      ].map((corners) => [mode, ...corners])
    )
  )('%s box uses both axes from (%s,%s) to (%s,%s)', (mode, sx, sy, ex, ey) => {
    const { brush, c } = fixture();
    c.setWallFillMode(mode);
    c.setWallTopLevel(-4);
    brush.brushSize = 5;
    c.dataStore.set(2, 2, 7);
    const rectangle = [1, 2, 3].flatMap((y) => [1, 2, 3, 4].map((x) => ({ x, y })));
    const expected =
      mode === 'filled'
        ? rectangle
        : rectangle.filter(({ x, y }) => x === 1 || x === 4 || y === 1 || y === 3);
    brush.beginWallStroke(sx, sy);
    expect(brush.getFootprintCells(ex, ey)).toEqual(expected);
    expect(new Set(expected.map(({ x, y }) => `${x},${y}`)).size).toBe(expected.length);
    expect(brush.applyAt(ex, ey)).toBe(true);
    expect(c.dataStore.working).toEqual([
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, -4, -4, -4, -4, 0, 0, 0],
      mode === 'filled' ? [0, -4, -4, -4, -4, 0, 0, 0] : [0, -4, 7, 0, -4, 0, 0, 0],
      [0, -4, -4, -4, -4, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
      [0, 0, 0, 0, 0, 0, 0, 0],
    ]);
    expect(brush.applyAt(ex, ey)).toBe(false);
  });

  test.each(['filled', 'outline'])(
    '%s rectangles include board edges without duplicates',
    (mode) => {
      const { brush, c } = fixture();
      c.setWallFillMode(mode);
      brush.beginWallStroke(7, 5);
      const cells = brush.getFootprintCells(0, 0);
      expect(cells).toHaveLength(mode === 'filled' ? 48 : 24);
      expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(cells.length);
      expect(cells.every(({ x, y }) => x >= 0 && x < 8 && y >= 0 && y < 6)).toBe(true);
    }
  );
});

describe('wall placement gesture', () => {
  test.each(Array.from({ length: 21 }, (_, index) => index - 10))(
    'preview and placement both use the exact selected level %s',
    (level) => {
      const { c, gm, input, event } = fixture();
      c.dataStore.set(2, 2, -6);
      c.dataStore.set(3, 2, 7);
      c.dataStore.set(4, 2, -10);
      c.dataStore.set(5, 2, 10);
      c.setWallTopLevel(level);
      const original = c.dataStore.working[2].slice();
      input.handleMouseDown(event(1, 2));
      input.handleMouseMove(event(6, 2));
      expect(c.dataStore.working[2]).toEqual(original);
      expect(gm.threeSceneManager.setTerrainBrushPreview).toHaveBeenLastCalledWith(
        Array.from({ length: 6 }, (_, index) => ({
          x: index + 1,
          y: 2,
          currentHeight: original[index + 1],
          previewHeight: level,
        })),
        expect.any(Object)
      );
      input.handleMouseUp(event(6, 2));
      expect(c.dataStore.working[2]).toEqual([0, level, level, level, level, level, level, 0]);
      expect(c.dataStore.working[3].every((height) => height === 0)).toBe(true);
      expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
      expect(c.brush.wallStart).toBeNull();
    }
  );

  test('previews the complete height and footprint but edits only once on release', () => {
    const { c, gm, input, event, brush } = fixture();
    input.handleMouseDown(event(1, 2));
    input.handleMouseMove(event(6, 2));
    expect(c.dataStore.working.flat().every((height) => height === 0)).toBe(true);
    expect(gm.notifyTerrainHeightsChanged).not.toHaveBeenCalled();
    expect(gm.threeSceneManager.setTerrainBrushPreview).toHaveBeenLastCalledWith(
      Array.from({ length: 6 }, (_, index) => ({
        x: index + 1,
        y: 2,
        currentHeight: 0,
        previewHeight: 4,
      })),
      expect.any(Object)
    );

    input.handleMouseUp(event(6, 2));
    expect(c.dataStore.working[2]).toEqual([0, 4, 4, 4, 4, 4, 4, 0]);
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
    expect(c.isDragging).toBe(false);
    expect(brush.wallStart).toBeNull();
    input.handleMouseUp(event(6, 2));
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
  });

  test('a click places exactly one wall cell at the chosen top level', () => {
    const { c, input, event } = fixture();
    c.setWallTopLevel(2);
    input.handleMouseDown(event(3, 1));
    input.handleMouseUp(event(3, 1));
    expect(c.dataStore.get(3, 1)).toBe(2);
    expect(c.dataStore.working.flat().filter((height) => height !== 0)).toHaveLength(1);
  });

  test.each(
    ['filled', 'outline'].flatMap((mode) =>
      [
        ['Escape', (f) => f.input.handleKeyDown({ code: 'Escape', preventDefault: jest.fn() })],
        ['Space pan', (f) => f.input.handleKeyDown({ code: 'Space', preventDefault: jest.fn() })],
        ['mouse leave', (f) => f.input.handleMouseLeave()],
        ['blur cancellation', (f) => f.input.cancelStroke()],
        ['tool change', (f) => f.c.setTerrainTool('raise')],
        ['mode off', (f) => f.c.disableTerrainMode()],
        ['resize', (f) => f.c.handleGridResize(7, 5)],
        ['off-board release', (f) => f.input.handleMouseUp(f.event(null, null))],
        ['release over UI', (f) => f.input.handleMouseUp(f.event(5, 2, { target: document.body }))],
      ].map(([name, cancel]) => [mode, name, cancel])
    )
  )('%s %s cancels an uncommitted box without editing terrain', (mode, _, cancel) => {
    const f = fixture();
    f.c.setWallFillMode(mode);
    f.input.handleMouseDown(f.event(1, 2));
    f.input.handleMouseMove(f.event(5, 4));
    f.gm.threeSceneManager.clearTerrainBrushPreview.mockClear();
    cancel(f);
    f.input.handleMouseUp(f.event(5, 4));
    expect(f.c.dataStore.working.flat().every((height) => height === 0)).toBe(true);
    expect(f.brush.wallStart).toBeNull();
    expect(f.c.isDragging).toBe(false);
    expect(f.gm.threeSceneManager.clearTerrainBrushPreview).toHaveBeenCalled();
  });

  test('right dragging and Space panning do not begin a wall', () => {
    const { c, input, event, gm } = fixture();
    input.handleMouseDown(event(1, 2, { button: 2 }));
    expect(c.isDragging).toBe(false);
    gm.interactionManager.isSpacePressed = true;
    input.handleMouseDown(event(1, 2));
    expect(c.isDragging).toBe(false);
    expect(c.dataStore.working.flat().every((height) => height === 0)).toBe(true);
  });

  test('height changes update the preview without committing a pending wall', () => {
    const { c, gm, input, event } = fixture();
    input.handleMouseDown(event(1, 2));
    input.handleMouseMove(event(5, 2));
    c.setWallTopLevel(6);
    expect(gm.threeSceneManager.setTerrainBrushPreview).toHaveBeenLastCalledWith(
      expect.arrayContaining([expect.objectContaining({ previewHeight: 6 })]),
      expect.any(Object)
    );
    expect(c.dataStore.working.flat().every((height) => height === 0)).toBe(true);
  });

  test('changing Filled to Outline updates a pending box preview without editing terrain', () => {
    const { c, gm, input, event } = fixture();
    input.handleMouseDown(event(1, 1));
    input.handleMouseMove(event(4, 3));
    expect(gm.threeSceneManager.setTerrainBrushPreview.mock.lastCall[0]).toHaveLength(12);
    c.setWallFillMode('outline');
    const cells = gm.threeSceneManager.setTerrainBrushPreview.mock.lastCall[0];
    expect(cells).toHaveLength(10);
    expect(cells.some(({ x, y }) => x === 2 && y === 2)).toBe(false);
    expect(c.dataStore.working.flat().every((height) => height === 0)).toBe(true);
    expect(c.brush.wallStart).toEqual({ x: 1, y: 1 });
  });

  test.each(['filled', 'outline'])('%s boxes preview before a single release commit', (mode) => {
    const { c, gm, input, event } = fixture();
    c.setWallFillMode(mode);
    c.setWallTopLevel(-3);
    c.dataStore.set(2, 2, 6);
    const original = c.dataStore.working.map((row) => row.slice());
    input.handleMouseDown(event(1, 1));
    input.handleMouseMove(event(4, 3));
    expect(c.dataStore.working).toEqual(original);
    expect(gm.threeSceneManager.setTerrainBrushPreview.mock.lastCall[0]).toHaveLength(
      mode === 'filled' ? 12 : 10
    );
    input.handleMouseUp(event(4, 3));
    expect(c.dataStore.get(2, 2)).toBe(mode === 'filled' ? -3 : 6);
    expect(c.dataStore.get(1, 2)).toBe(-3);
    expect(c.dataStore.get(4, 3)).toBe(-3);
    expect(c.dataStore.get(0, 0)).toBe(0);
    expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
    expect(c.brush.wallStart).toBeNull();
    expect(c.wallFillMode).toBe(mode);
  });
});
