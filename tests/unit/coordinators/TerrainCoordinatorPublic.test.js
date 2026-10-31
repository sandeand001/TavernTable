import { TerrainCoordinator } from '../../../src/coordinators/TerrainCoordinator.js';
import { TERRAIN_CONFIG } from '../../../src/config/terrain/TerrainConstants.js';
import { GameValidators, Sanitizers } from '../../../src/utils/Validation.js';

function makeCoordinator(cols = 3, rows = 2) {
  return new TerrainCoordinator({
    cols,
    rows,
    notifyTerrainHeightsChanged: jest.fn(),
  });
}

describe('TerrainCoordinator public behavior', () => {
  test('tool selection and brush size controls honor the exact configured limits', () => {
    const c = makeCoordinator();
    const { MIN_BRUSH_SIZE, MAX_BRUSH_SIZE } = TERRAIN_CONFIG;

    c.setTerrainTool('lower');
    expect(c.brush.tool).toBe('lower');

    c.brushSize = MAX_BRUSH_SIZE + 100;
    expect(c.brushSize).toBe(MAX_BRUSH_SIZE);
    c.increaseBrushSize();
    expect(c.brushSize).toBe(MAX_BRUSH_SIZE);
    c.decreaseBrushSize();
    expect(c.brushSize).toBe(MAX_BRUSH_SIZE - 1);

    c.brushSize = MIN_BRUSH_SIZE - 100;
    expect(c.brushSize).toBe(MIN_BRUSH_SIZE);
    c.decreaseBrushSize();
    expect(c.brushSize).toBe(MIN_BRUSH_SIZE);
    c.increaseBrushSize();
    expect(c.brushSize).toBe(MIN_BRUSH_SIZE + 1);
  });

  test('placeable and terrain brush sizes remain independent', () => {
    const c = makeCoordinator();
    const originalTerrain = c.brushSize;
    const originalPlaceable = c.ptBrushSize;

    expect(originalTerrain).toBe(TERRAIN_CONFIG.DEFAULT_BRUSH_SIZE);
    expect(originalPlaceable).toBe(TERRAIN_CONFIG.DEFAULT_BRUSH_SIZE);

    c.brushSize = originalTerrain + 2;
    expect(c.brushSize).toBe(originalTerrain + 2);
    expect(c.ptBrushSize).toBe(originalPlaceable);

    c.ptBrushSize = originalPlaceable + 3;
    expect(c.ptBrushSize).toBe(originalPlaceable + 3);
    expect(c.brushSize).toBe(originalTerrain + 2);
  });

  test('elevation scale getter/setter reflect values', () => {
    const c = makeCoordinator();
    const prev = c.getElevationScale();
    c.setElevationScale(prev + 2);
    expect(c.getElevationScale()).toBe(prev + 2);
  });

  test('returns working heights at valid coordinates on a non-square grid', () => {
    const c = makeCoordinator();
    c.dataStore.working = [
      [0, 1, 2],
      [3, 4, 5],
    ];
    expect(c.getTerrainHeight(2, 1)).toBe(5);
  });

  test('returns the default height for out-of-bounds or fractional coordinates', () => {
    const c = makeCoordinator(1, 1);
    c.dataStore.set(0, 0, 7);

    for (const [x, y] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [0.5, 0],
      [0, 0.5],
    ]) {
      expect(c.getTerrainHeight(x, y)).toBe(TERRAIN_CONFIG.DEFAULT_HEIGHT);
    }
  });

  test('a brush stroke edits the requested cell and notifies only when heights change', () => {
    const c = makeCoordinator();
    c.brushSize = TERRAIN_CONFIG.MIN_BRUSH_SIZE;

    expect(c.modifyTerrainHeightAtCell(1, 0)).toBe(true);
    expect(c.dataStore.working).toEqual([
      [0, TERRAIN_CONFIG.HEIGHT_STEP, 0],
      [0, 0, 0],
    ]);
    expect(c.gameManager.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);

    c.dataStore.set(1, 0, TERRAIN_CONFIG.MAX_HEIGHT);
    expect(c.modifyTerrainHeightAtCell(1, 0)).toBe(false);
    expect(c.getTerrainHeight(1, 0)).toBe(TERRAIN_CONFIG.MAX_HEIGHT);
    expect(c.gameManager.notifyTerrainHeightsChanged).toHaveBeenCalledTimes(1);
  });

  test('valid and invalid grid coordinates are detected correctly', () => {
    const c = makeCoordinator();
    expect(c.isValidGridPosition(0, 0)).toBe(true);
    expect(c.isValidGridPosition(2, 1)).toBe(true);
    expect(c.isValidGridPosition(3, 0)).toBe(false);
    expect(c.isValidGridPosition(0, 2)).toBe(false);
    expect(c.isValidGridPosition(-1, 0)).toBe(false);
  });

  test('applyBiomePaletteToBaseGrid forwards to shading facade', () => {
    const c = makeCoordinator();
    c._biomeShading.applyToBaseGrid = jest.fn();
    c.applyBiomePaletteToBaseGrid();
    expect(c._biomeShading.applyToBaseGrid).toHaveBeenCalledTimes(1);
  });
});

describe('TerrainCoordinator validation', () => {
  test('accepts correctly shaped working and base arrays', () => {
    const c = makeCoordinator();
    expect(c.validateTerrainDataConsistency()).toBe(true);
  });

  test('rejects mismatched terrain array dimensions', () => {
    const c = makeCoordinator();
    c.dataStore.working = [[0]];
    expect(c.validateTerrainDataConsistency()).toBe(false);
  });

  test('validates well-formed terrain without the removed terrain manager', () => {
    const c = makeCoordinator();
    expect(c.terrainManager).toBeNull();
    expect(c.validateTerrainSystemState()).toBe(true);
  });
});

describe('TerrainCoordinator dependency resolution', () => {
  test('falls back to module defaults when globals are missing', () => {
    const previousValidators = global.GameValidators;
    const previousSanitizers = global.Sanitizers;
    try {
      delete global.GameValidators;
      delete global.Sanitizers;

      const c = makeCoordinator();
      expect(c.GameValidators).toBe(GameValidators);
      expect(c.Sanitizers).toBe(Sanitizers);
    } finally {
      if (previousValidators) global.GameValidators = previousValidators;
      else delete global.GameValidators;
      if (previousSanitizers) global.Sanitizers = previousSanitizers;
      else delete global.Sanitizers;
    }
  });
});
