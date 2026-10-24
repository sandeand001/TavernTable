import {
  BIOME_FLORA_PROFILES,
  DEFAULT_PROFILE,
} from '../../../../src/config/terrain/FloraProfiles.js';
import { TERRAIN_PLACEABLES } from '../../../../src/config/terrain/TerrainPlaceables.js';

describe('Biome flora model selection', () => {
  test('automatic generation selects concrete model-backed plants, not menu families', () => {
    const invalid = [];
    for (const profile of [...BIOME_FLORA_PROFILES, DEFAULT_PROFILE]) {
      for (const id of Object.keys(profile.weights || {})) {
        const definition = TERRAIN_PLACEABLES[id];
        if (definition?.type !== 'plant' || !definition.modelKey) {
          invalid.push(id);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  test('grassland retains real deciduous trees without selecting the family menu entry', () => {
    const profile = BIOME_FLORA_PROFILES.find((entry) => entry.re.test('grassland'));
    const ids = Object.keys(profile.weights);
    expect(ids).not.toContain('family-deciduous');
    expect(ids.some((id) => /deciduous|oval|willow/.test(id))).toBe(true);
    expect(ids.every((id) => TERRAIN_PLACEABLES[id].modelKey)).toBe(true);
  });
});
