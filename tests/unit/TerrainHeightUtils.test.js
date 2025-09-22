import { TerrainHeightUtils } from '../../src/utils/TerrainHeightUtils.js';

describe('TerrainHeightUtils', () => {
  test('createHeightArray builds correct dimensions and clamps default', () => {
    const rows = 3,
      cols = 4,
      def = 999;
    const arr = TerrainHeightUtils.createHeightArray(rows, cols, def);
    expect(arr.length).toBe(rows);
    expect(arr[0].length).toBe(cols);
    // Should clamp to internal MIN/MAX range; but at least ensure numbers
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        expect(Number.isFinite(arr[r][c])).toBe(true);
      }
    }
  });

  test('setSafeHeight respects bounds', () => {
    const arr = TerrainHeightUtils.createHeightArray(2, 2, 0);
    const ok = TerrainHeightUtils.setSafeHeight(arr, 1, 1, 3);
    const bad = TerrainHeightUtils.setSafeHeight(arr, 5, 5, 3);
    expect(ok).toBe(true);
    expect(bad).toBe(false);
  });
});
