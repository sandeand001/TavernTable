import { shadeMul, lightenColor, darkenColor } from '../../src/utils/ColorUtils.js';

// Minimal tests to lock behavior for shared color helpers

describe('ColorUtils.shadeMul', () => {
  test('matches legacy _shadeHex behavior for typical factors', () => {
    const samples = [0x000000, 0xffffff, 0x123456, 0x89abcd, 0x0044aa, 0xcc3300];
    const factors = [0.4, 0.7, 0.85, 1.0, 1.12, 1.15];

    // Legacy reference implementation from BiomeCanvasPainter._shadeHex
    const legacy = (hexInt, factor) => {
      const r = Math.max(0, Math.min(255, Math.round(((hexInt >> 16) & 255) * factor)));
      const g = Math.max(0, Math.min(255, Math.round(((hexInt >> 8) & 255) * factor)));
      const b = Math.max(0, Math.min(255, Math.round((hexInt & 255) * factor)));
      return (r << 16) | (g << 8) | b;
    };

    for (const c of samples) {
      for (const f of factors) {
        expect(shadeMul(c, f)).toBe(legacy(c, f));
      }
    }
  });

  test('clamps to [0,255] and rounds channels correctly', () => {
    expect(shadeMul(0xff0000, 2.0)).toBe(0xff0000); // clamp
    expect(shadeMul(0x0000ff, 0.49)).toBe(0x00007d); // 255*0.49=124.95 -> 125
  });
});

describe('ColorUtils.lighten/darken', () => {
  test('lighten blends toward white bounded by factor', () => {
    expect(lightenColor(0x000000, 1)).toBe(0xffffff);
    expect(lightenColor(0x123456, 0)).toBe(0x123456);
  });
  test('darken scales toward black bounded by factor', () => {
    expect(darkenColor(0xffffff, 1)).toBe(0x000000);
    expect(darkenColor(0x123456, 0)).toBe(0x123456);
  });
});
