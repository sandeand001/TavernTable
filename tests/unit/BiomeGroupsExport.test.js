import { BIOME_GROUPS, ALL_BIOMES } from '../../src/config/BiomeConstants.js';

/**
 * Regression test: ensure BIOME_GROUPS remains exported so SidebarController dynamic menu builds.
 */

describe('Biome groups export', () => {
  test('BIOME_GROUPS has expected structure and at least one common biome', () => {
    expect(BIOME_GROUPS).toBeTruthy();
    expect(typeof BIOME_GROUPS).toBe('object');
    expect(Object.keys(BIOME_GROUPS).length).toBeGreaterThan(0);
    // A representative biome we rely on in UI smoke expectations
    const common = BIOME_GROUPS.Common || BIOME_GROUPS['Common'];
    expect(common).toBeTruthy();
    const grass = common.find((b) => b.key === 'grassland');
    expect(grass).toBeTruthy();
    expect(grass.label).toMatch(/Grassland/i);
  });

  test('ALL_BIOMES flattens BIOME_GROUPS correctly', () => {
    const flattened = Object.values(BIOME_GROUPS).reduce((acc, arr) => acc + arr.length, 0);
    expect(ALL_BIOMES.length).toBe(flattened);
  });
});
