import { TerrainValidation } from '../../src/utils/TerrainValidation.js';
import { TERRAIN_CONFIG } from '../../src/config/TerrainConstants.js';

describe('TerrainValidation.validateTerrainCoordinates', () => {
  test('accepts in-bounds integer coordinates', () => {
    const res = TerrainValidation.validateTerrainCoordinates(0, 0, { cols: 3, rows: 2 });
    expect(res.isValid).toBe(true);
    expect(res.error).toBeNull();
  });

  test('rejects non-integer or out-of-bounds', () => {
    expect(TerrainValidation.validateTerrainCoordinates(1.2, 0, { cols: 3, rows: 2 }).isValid).toBe(
      false
    );
    expect(TerrainValidation.validateTerrainCoordinates(0, 'a', { cols: 3, rows: 2 }).isValid).toBe(
      false
    );
    expect(TerrainValidation.validateTerrainCoordinates(-1, 0, { cols: 3, rows: 2 }).isValid).toBe(
      false
    );
    expect(TerrainValidation.validateTerrainCoordinates(3, 0, { cols: 3, rows: 2 }).isValid).toBe(
      false
    );
    expect(TerrainValidation.validateTerrainCoordinates(0, 2, { cols: 3, rows: 2 }).isValid).toBe(
      false
    );
  });
});

describe('TerrainValidation.validateHeightModification', () => {
  test('blocks at MIN when lowering and at MAX when raising', () => {
    const min = TERRAIN_CONFIG.MIN_HEIGHT;
    const max = TERRAIN_CONFIG.MAX_HEIGHT;
    const step = TERRAIN_CONFIG.HEIGHT_STEP;

    const atMinLower = TerrainValidation.validateHeightModification(min, 'lower');
    expect(atMinLower.isValid).toBe(true);
    expect(atMinLower.canModify).toBe(false);
    expect(atMinLower.newHeight).toBe(min);

    const atMaxRaise = TerrainValidation.validateHeightModification(max, 'raise');
    expect(atMaxRaise.isValid).toBe(true);
    expect(atMaxRaise.canModify).toBe(false);
    expect(atMaxRaise.newHeight).toBe(max);

    const middleRaise = TerrainValidation.validateHeightModification(0, 'raise');
    expect(middleRaise.isValid).toBe(true);
    expect(middleRaise.canModify).toBe(true);
    expect(middleRaise.newHeight).toBe(Math.min(0 + step, max));
  });

  test('invalid tool and invalid bounds are rejected', () => {
    const badTool = TerrainValidation.validateHeightModification(0, 'paint');
    expect(badTool.isValid).toBe(false);
    expect(badTool.error).toMatch(/Invalid tool/i);

    const badBounds = TerrainValidation.validateHeightModification(0, 'raise', {
      minHeight: 5,
      maxHeight: 4,
    });
    expect(badBounds.isValid).toBe(false);
    expect(badBounds.error).toMatch(/Invalid height bounds/i);

    const badStep = TerrainValidation.validateHeightModification(0, 'raise', { heightStep: 0 });
    expect(badStep.isValid).toBe(false);
    expect(badStep.error).toMatch(/Invalid height step/i);
  });
});

describe('TerrainValidation.validateTerrainConfig', () => {
  test('validates the shipped TERRAIN_CONFIG as valid', () => {
    const res = TerrainValidation.validateTerrainConfig(TERRAIN_CONFIG);
    expect(res.isValid).toBe(true);
    expect(res.errors).toEqual([]);
  });

  test('rejects missing required properties', () => {
    const bad = { ...TERRAIN_CONFIG };
    delete bad.HEIGHT_STEP;
    const res = TerrainValidation.validateTerrainConfig(bad);
    expect(res.isValid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/missing required property/i);
  });
});

describe('TerrainValidation.validateTerrainModeTransition', () => {
  test('detects no-op transitions', () => {
    const res = TerrainValidation.validateTerrainModeTransition(true, true, {});
    expect(res.isValid).toBe(true);
    expect(res.canTransition).toBe(false);
    expect(res.details.reason).toBe('Already in target mode');
  });

  test('entering mode emits warnings if state incomplete but still valid', () => {
    const res = TerrainValidation.validateTerrainModeTransition(false, true, {});
    expect(res.isValid).toBe(true);
    expect(res.canTransition).toBe(true);
    expect(Array.isArray(res.warnings)).toBe(true);
  });
});

describe('TerrainValidation message helpers', () => {
  test('getErrorMessage aggregates errors and respects single error field', () => {
    expect(TerrainValidation.getErrorMessage(null)).toBe('');
    expect(TerrainValidation.getErrorMessage({ isValid: true })).toBe('');
    expect(TerrainValidation.getErrorMessage({ isValid: false, error: 'oops' })).toBe('oops');
    expect(TerrainValidation.getErrorMessage({ isValid: false, errors: ['a', 'b'] })).toMatch(
      /a; b/
    );
  });

  test('getWarningMessages returns [] for invalid inputs and passes warnings array through', () => {
    expect(Array.isArray(TerrainValidation.getWarningMessages(null))).toBe(true);
    expect(TerrainValidation.getWarningMessages(null).length).toBe(0);
    const warnings = ['w1', 'w2'];
    expect(TerrainValidation.getWarningMessages({ warnings })).toEqual(warnings);
  });
});
