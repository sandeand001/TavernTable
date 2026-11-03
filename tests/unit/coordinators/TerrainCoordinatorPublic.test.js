import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';
import { TERRAIN_CONFIG } from '../../../src/config/terrain/TerrainConstants.js';

describe('Authoritative terrain controls', () => {
  test('terrain wiring refuses to create a second terrain owner', () => {
    expect(() => new TerrainCoordinator({ cols: 3, rows: 2 })).toThrow(/authoritative/);
  });

  test('tool selection and brush size controls honor the exact configured limits', () => {
    const e = new TerrainEngine(3, 2);
    const { MIN_BRUSH_SIZE, MAX_BRUSH_SIZE } = TERRAIN_CONFIG;
    e.setTool('lower');
    expect(e.tool).toBe('lower');
    e.setBrushSize(MAX_BRUSH_SIZE + 100);
    expect(e.brushSize).toBe(MAX_BRUSH_SIZE);
    e.increaseBrush();
    expect(e.brushSize).toBe(MAX_BRUSH_SIZE);
    e.decreaseBrush();
    expect(e.brushSize).toBe(MAX_BRUSH_SIZE - 1);
    e.setBrushSize(MIN_BRUSH_SIZE - 100);
    e.decreaseBrush();
    expect(e.brushSize).toBe(MIN_BRUSH_SIZE);
    e.increaseBrush();
    expect(e.brushSize).toBe(MIN_BRUSH_SIZE + 1);
  });

  test('placeable and terrain brush sizes remain independent', () => {
    const e = new TerrainEngine(5, 5);
    const original = TERRAIN_CONFIG.DEFAULT_BRUSH_SIZE;
    e.setBrushSize(original + 2);
    expect(e.ptBrushSize).toBe(original);
    e.setPlaceableBrushSize(original + 3);
    expect(e.ptBrushSize).toBe(original + 3);
    expect(e.brushSize).toBe(original + 2);
  });

  test('returns committed heights at valid coordinates on a non-square grid', () => {
    const e = new TerrainEngine(3, 2, [
      [0, 1, 2],
      [3, 4, 5],
    ]);
    expect(e.getHeightAt(2, 1)).toBe(5);
  });

  test('returns default heights for out-of-bounds and fractional queries', () => {
    const e = new TerrainEngine(1, 1);
    e.setHeightAt(0, 0, 7);
    for (const [x, y] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [0.5, 0],
      [0, 0.5],
    ]) {
      expect(e.getHeightAt(x, y)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
    }
  });

  test('a programmatic brush edit notifies once, and a clamped no-op does not notify', () => {
    const e = new TerrainEngine(3, 2);
    const changed = jest.fn();
    e.onChanged(changed);
    expect(e.applyBrushAt(1, 0)).toBe(true);
    expect(e.save().heights).toEqual([
      [0, TERRAIN_CONFIG.HEIGHT_STEP, 0],
      [0, 0, 0],
    ]);
    expect(changed).toHaveBeenCalledTimes(1);
    e.setHeightAt(1, 0, TERRAIN_CONFIG.MAX_HEIGHT);
    changed.mockClear();
    expect(e.applyBrushAt(1, 0)).toBe(false);
    expect(changed).not.toHaveBeenCalled();
  });

  test('coordinate validation is exact and invalid edits are explicit errors', () => {
    const e = new TerrainEngine(3, 2);
    expect(e.isValidGridPosition(0, 0)).toBe(true);
    expect(e.isValidGridPosition(2, 1)).toBe(true);
    expect(e.isValidGridPosition(3, 0)).toBe(false);
    expect(e.isValidGridPosition(0, 2)).toBe(false);
    expect(e.isValidGridPosition(-1, 0)).toBe(false);
    expect(() => e.applyBrushAt(3, 0)).toThrow(RangeError);
    expect(() => e.setTool('unknown')).toThrow(RangeError);
  });
});
