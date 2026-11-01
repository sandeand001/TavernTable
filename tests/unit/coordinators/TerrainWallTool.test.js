import { TerrainBrushController } from '../../../src/terrain/brush/TerrainBrushController.js';
import { TerrainDataStore } from '../../../src/terrain/TerrainDataStore.js';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';

function brushFixture() {
  const data = new TerrainDataStore(8, 6);
  const brush = new TerrainBrushController(data);
  brush.setTool('wall');
  brush.setWallTopLevel(4);
  return { data, brush };
}

function editor() {
  const world = createTerrainWorld(8, 6, null);
  world.engine.activate();
  world.engine.setTool('wall');
  world.engine.setWallTopLevel(4);
  world.gm.notifyTerrainHeightsChanged.mockClear();
  return world;
}

describe('Terrain wall brush', () => {
  test.each([NaN, Infinity, -11, 11, 1.5])('rejects invalid top level %s', (value) => {
    const { brush } = brushFixture();
    expect(() => brush.setWallTopLevel(value)).toThrow(RangeError);
    expect(brush.wallTopLevel).toBe(4);
  });

  test.each(['', 'both', 'invalid', null])('rejects invalid fill style %s', (mode) => {
    const { brush } = brushFixture();
    expect(() => brush.setWallFillMode(mode)).toThrow(RangeError);
    expect(brush.wallFillMode).toBe('filled');
  });

  test.each(['filled', 'outline'])('%s lines and points stay one cell thick', (mode) => {
    const { data, brush } = brushFixture();
    brush.setWallFillMode(mode);
    brush.brushSize = 5;
    data.set(3, 2, 7);
    brush.beginWallStroke(1, 2);
    expect(brush.getFootprintCells(6, 2)).toEqual(
      Array.from({ length: 6 }, (_, index) => ({ x: index + 1, y: 2 }))
    );
    expect(brush.applyAt(6, 2)).toBe(true);
    expect(data.working[2]).toEqual([0, 4, 4, 4, 4, 4, 4, 0]);
    expect(brush.applyAt(6, 2)).toBe(false);
    brush.beginWallStroke(5, 4);
    expect(brush.getFootprintCells(5, 0)).toEqual(
      Array.from({ length: 5 }, (_, y) => ({ x: 5, y }))
    );
    brush.cancelWallStroke();
    expect(brush.getFootprintCells(3, 3)).toEqual([{ x: 3, y: 3 }]);
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
  )(
    '%s rectangle from (%s,%s) to (%s,%s) sets the exact negative elevation',
    (mode, sx, sy, ex, ey) => {
      const { data, brush } = brushFixture();
      brush.setWallFillMode(mode);
      brush.setWallTopLevel(-4);
      data.set(2, 2, 7);
      brush.beginWallStroke(sx, sy);
      const rectangle = [1, 2, 3].flatMap((y) => [1, 2, 3, 4].map((x) => ({ x, y })));
      const expected =
        mode === 'filled'
          ? rectangle
          : rectangle.filter(({ x, y }) => x === 1 || x === 4 || y === 1 || y === 3);
      expect(brush.getFootprintCells(ex, ey)).toEqual(expected);
      expect(new Set(expected.map(({ x, y }) => `${x},${y}`)).size).toBe(expected.length);
      brush.applyAt(ex, ey);
      expect(data.get(1, 2)).toBe(-4);
      expect(data.get(2, 2)).toBe(mode === 'filled' ? -4 : 7);
      expect(data.get(0, 0)).toBe(0);
    }
  );

  test.each(['filled', 'outline'])('%s full-board footprints have no duplicates', (mode) => {
    const { brush } = brushFixture();
    brush.setWallFillMode(mode);
    brush.beginWallStroke(7, 5);
    const cells = brush.getFootprintCells(0, 0);
    expect(cells).toHaveLength(mode === 'filled' ? 48 : 24);
    expect(new Set(cells.map(({ x, y }) => `${x},${y}`)).size).toBe(cells.length);
  });
});

describe('Wall placement through the authoritative editing interface', () => {
  test.each(Array.from({ length: 21 }, (_, index) => index - 10))(
    'preview and release use the exact selected top level %s',
    (level) => {
      const world = editor();
      const { engine, input, event, gm } = world;
      try {
        engine.setHeightAt(2, 2, -6);
        engine.setHeightAt(3, 2, 7);
        engine.setHeightAt(4, 2, -10);
        engine.setHeightAt(5, 2, 10);
        engine.setWallTopLevel(level);
        const before = engine.save().heights;
        gm.notifyTerrainHeightsChanged.mockClear();
        input.handleMouseDown(event(1, 2));
        input.handleMouseMove(event(6, 2));
        expect(engine.save().heights).toEqual(before);
        expect(gm.notifyTerrainHeightsChanged).not.toHaveBeenCalled();
        expect(gm.threeSceneManager.setTerrainBrushPreview).toHaveBeenLastCalledWith(
          Array.from({ length: 6 }, (_, index) => ({
            x: index + 1,
            y: 2,
            currentHeight: before[2][index + 1],
            previewHeight: level,
          })),
          expect.any(Object)
        );
        input.handleMouseUp(event(6, 2));
        input.handleMouseUp(event(6, 2));
        expect(engine.save().heights[2]).toEqual([0, level, level, level, level, level, level, 0]);
        expect(engine.hasPendingStroke).toBe(false);
        expect(gm.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
      } finally {
        world.dispose();
      }
    }
  );

  test.each(
    ['filled', 'outline'].flatMap((mode) =>
      [
        ['Escape', (w) => w.input.handleKeyDown({ code: 'Escape', preventDefault: jest.fn() })],
        ['Space', (w) => w.input.handleKeyDown({ code: 'Space', preventDefault: jest.fn() })],
        ['leave', (w) => w.input.handleMouseLeave()],
        ['blur', () => window.dispatchEvent(new Event('blur'))],
        ['tool change', (w) => w.engine.setTool('raise')],
        ['mode off', (w) => w.engine.deactivate()],
        ['resize', (w) => w.engine.resize(7, 5)],
        ['off-board release', (w) => w.input.handleMouseUp(w.event(null, null))],
        ['UI release', (w) => w.input.handleMouseUp(w.event(5, 2, { target: document.body }))],
      ].map(([name, cancel]) => [mode, name, cancel])
    )
  )('%s %s cancels the complete preview', (mode, _, cancel) => {
    const world = editor();
    try {
      world.engine.setWallFillMode(mode);
      world.input.handleMouseDown(world.event(1, 2));
      world.input.handleMouseMove(world.event(5, 4));
      cancel(world);
      world.input.handleMouseUp(world.event(5, 4));
      expect(
        world.engine
          .save()
          .heights.flat()
          .every((height) => height === 0)
      ).toBe(true);
      expect(world.engine.hasPendingStroke).toBe(false);
    } finally {
      world.dispose();
    }
  });

  test('adjusting height or fill style preserves the pending rectangle without applying it', () => {
    const world = editor();
    try {
      world.input.handleMouseDown(world.event(1, 1));
      world.input.handleMouseMove(world.event(4, 3));
      world.engine.setWallTopLevel(6);
      world.engine.setWallFillMode('outline');
      const cells = world.gm.threeSceneManager.setTerrainBrushPreview.mock.lastCall[0];
      expect(cells).toHaveLength(10);
      expect(cells.every((cell) => cell.previewHeight === 6)).toBe(true);
      expect(cells.some(({ x, y }) => x === 2 && y === 2)).toBe(false);
      expect(world.engine.hasPendingStroke).toBe(true);
      expect(
        world.engine
          .save()
          .heights.flat()
          .every((height) => height === 0)
      ).toBe(true);
      world.input.handleMouseUp(world.event(4, 3));
      expect(world.engine.getHeightAt(1, 2)).toBe(6);
      expect(world.engine.getHeightAt(2, 2)).toBe(0);
    } finally {
      world.dispose();
    }
  });

  test('right dragging and Space panning do not start a terrain gesture', () => {
    const world = editor();
    try {
      world.input.handleMouseDown(world.event(1, 2, { button: 2 }));
      expect(world.engine.hasPendingStroke).toBe(false);
      world.gm.interactionManager.isSpacePressed = true;
      world.input.handleMouseDown(world.event(1, 2));
      expect(world.engine.hasPendingStroke).toBe(false);
    } finally {
      world.dispose();
    }
  });
});
