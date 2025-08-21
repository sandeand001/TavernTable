// Minimal, deterministic tests for palette API stability
import { getBiomeColorHex } from '../../src/config/BiomePalettes.js';

// A tiny stub to avoid depending on real biome constants in tests
const KNOWN_BIOMES = ['grassland', 'desert', 'tundra'];

// Helper: call with stable opts
function sample(biome, height, x=10, y=20) {
  return getBiomeColorHex(biome, height, x, y, {
    intensity: 0.5,
    density: 0.5,
    shoreline: 0.3,
    moisture: 0.4,
    slope: 0.1,
    aspectRad: 0.0,
    seed: 1234,
    mapFreq: 0.02
  });
}

describe('BiomePalettes.getBiomeColorHex', () => {
  test('returns a 24-bit integer color', () => {
    const hex = sample(KNOWN_BIOMES[0], 0);
    expect(typeof hex).toBe('number');
    expect(hex).toBeGreaterThanOrEqual(0x000000);
    expect(hex).toBeLessThanOrEqual(0xFFFFFF);
  });

  test('height clamping yields stable results at extremes', () => {
    const low = sample('desert', -9999);
    const high = sample('desert', 9999);
    expect(low).not.toBeNaN();
    expect(high).not.toBeNaN();
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeGreaterThanOrEqual(0);
  });

  test('deterministic for same inputs', () => {
    const a = sample('grassland', 1, 42, 17);
    const b = sample('grassland', 1, 42, 17);
    expect(a).toBe(b);
  });
});
