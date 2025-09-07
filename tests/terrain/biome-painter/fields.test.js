import {
  computeSlopeAspect,
  computeMoistureField,
} from '../../../src/terrain/biome-painter/fields.js';

// Minimal fake gameManager with grid dimensions
const gm = (cols, rows) => ({ cols, rows });

describe('biome-painter fields helpers', () => {
  test('computeSlopeAspect returns arrays of correct shape and finite values', () => {
    const cols = 3,
      rows = 3;
    const heights = [
      [0, 0, 0],
      [0, 1, 2],
      [0, 1, 3],
    ];
    const { slope, aspect } = computeSlopeAspect(gm(cols, rows), heights);
    expect(slope.length).toBe(rows);
    expect(aspect.length).toBe(rows);
    for (let y = 0; y < rows; y++) {
      expect(slope[y].length).toBe(cols);
      expect(aspect[y].length).toBe(cols);
      for (let x = 0; x < cols; x++) {
        expect(Number.isFinite(slope[y][x])).toBe(true);
        expect(Number.isFinite(aspect[y][x])).toBe(true);
        // aspect should be within -pi..pi
        expect(aspect[y][x]).toBeGreaterThanOrEqual(-Math.PI - 1e-6);
        expect(aspect[y][x]).toBeLessThanOrEqual(Math.PI + 1e-6);
      }
    }
    // There should be some slope where heights change
    expect(slope[1][1]).toBeGreaterThan(0);
    expect(slope[1][2]).toBeGreaterThan(0);
  });

  test('computeMoistureField decays with distance from water sources', () => {
    const cols = 5,
      rows = 5;
    const heights = Array.from({ length: rows }, () => Array(cols).fill(0));
    // Mark center as below sea level (water source)
    heights[2][2] = -1;
    const moisture = computeMoistureField(gm(cols, rows), heights);
    expect(moisture.length).toBe(rows);
    expect(moisture[0].length).toBe(cols);

    const center = moisture[2][2];
    const near = moisture[2][3]; // dist=1
    const far = moisture[0][0]; // farthest corner

    expect(center).toBeGreaterThan(near);
    expect(near).toBeGreaterThan(far);
    // All values clamped 0..1
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        expect(moisture[y][x]).toBeGreaterThanOrEqual(0);
        expect(moisture[y][x]).toBeLessThanOrEqual(1);
      }
    }
  });
});
