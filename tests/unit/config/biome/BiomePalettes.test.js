// Minimal, deterministic tests for palette API stability
import { getBiomeColorHex } from '../../../../src/config/biome/BiomePalettes.js';
import { TERRAIN_CONFIG } from '../../../../src/config/terrain/TerrainConstants.js';

const KNOWN_BIOMES = ['grassland', 'desertHot', 'tundra', 'desert'];

// Helper: call with stable opts
function sample(biome, height, x = 10, y = 20) {
  return getBiomeColorHex(biome, height, x, y, {
    intensity: 0.5,
    density: 0.5,
    shoreline: 0.3,
    moisture: 0.4,
    slope: 0.1,
    aspectRad: 0.0,
    seed: 1234,
    mapFreq: 0.02,
  });
}

describe('BiomePalettes.getBiomeColorHex', () => {
  test('returns a 24-bit integer color', () => {
    for (const biome of KNOWN_BIOMES) {
      const hex = sample(biome, 0);
      expect(Number.isInteger(hex)).toBe(true);
      expect(hex).toBeGreaterThanOrEqual(0x000000);
      expect(hex).toBeLessThanOrEqual(0xffffff);
    }
  });

  test('out-of-range heights match the configured minimum and maximum endpoint colors', () => {
    for (const biome of KNOWN_BIOMES) {
      expect(sample(biome, TERRAIN_CONFIG.MIN_HEIGHT - 9999)).toBe(
        sample(biome, TERRAIN_CONFIG.MIN_HEIGHT)
      );
      expect(sample(biome, TERRAIN_CONFIG.MAX_HEIGHT + 9999)).toBe(
        sample(biome, TERRAIN_CONFIG.MAX_HEIGHT)
      );
    }
  });

  test('deterministic for same inputs and equivalent desert names', () => {
    for (const biome of KNOWN_BIOMES) {
      expect(sample(biome, 1, 42, 17)).toBe(sample(biome, 1, 42, 17));
    }
    expect(sample('desert', 1, 42, 17)).toBe(sample('desertHot', 1, 42, 17));
  });
});
