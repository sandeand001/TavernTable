import { MeshPhongMaterial, ShaderChunk, Texture } from 'three';

import { ALL_BIOMES } from '../../../../../src/config/biome/BiomeConstants.js';
import { EXOTIC_BIOME_APPEARANCES } from '../../../../../src/config/biome/ExoticBiomeAppearance.js';
import {
  preparePlaceableMaterials,
  resolvePlaceableAppearance,
} from '../../../../../src/scene/terrain/materials/placeable-appearance.js';

const three = { ShaderChunk };
const context = { modelKey: 'common-broadleaf-1', gridX: 2, gridY: 3, biomeSeed: 12345 };

describe('Exotic placeable appearance rules', () => {
  test('defines exactly the biomes marked exotic, including exotic entries in other groups', () => {
    const exoticKeys = ALL_BIOMES.filter((biome) => biome.rarity === 'exotic').map(
      (biome) => biome.key
    );
    expect(Object.keys(EXOTIC_BIOME_APPEARANCES).sort()).toEqual(exoticKeys.sort());
  });

  test.each(['grassland', 'mountain', 'crystalFields'])(
    '%s keeps its ordinary appearance',
    (biomeKey) => {
      expect(resolvePlaceableAppearance(biomeKey, context)).toBeNull();
    }
  );

  test('each exotic biome has stable per-object variation and valid opacity levels', () => {
    for (const biomeKey of Object.keys(EXOTIC_BIOME_APPEARANCES)) {
      const first = resolvePlaceableAppearance(biomeKey, context);
      expect(resolvePlaceableAppearance(biomeKey, context)).toEqual(first);
      const variants = Array.from({ length: 30 }, (_, gridX) =>
        resolvePlaceableAppearance(biomeKey, { ...context, gridX })
      );
      expect(new Set(variants.map((variant) => variant.opacity)).size).toBeGreaterThan(1);
      expect(variants.every((variant) => variant.opacity > 0 && variant.opacity < 1)).toBe(true);
    }
  });

  test('Blood Marsh stays red-dominant and Crystal Spires stays blue-purple', () => {
    for (let gridX = 0; gridX < 20; gridX++) {
      const red = resolvePlaceableAppearance('bloodMarsh', { ...context, gridX }).tint;
      expect((red >> 16) & 255).toBeGreaterThan((red >> 8) & 255);
      expect((red >> 16) & 255).toBeGreaterThan(red & 255);
      const blue = resolvePlaceableAppearance('crystalSpires', { ...context, gridX }).tint;
      expect(blue & 255).toBeGreaterThanOrEqual((blue >> 16) & 255);
    }
  });

  test('Astral transparency keeps natural diffuse colors, maps, and shader behavior', () => {
    const source = new MeshPhongMaterial({ color: 0x83b847, map: new Texture() });
    source.alphaTest = 0.05;
    const appearance = resolvePlaceableAppearance('astralPlateau', context);
    const result = preparePlaceableMaterials(three, source, appearance);

    expect(appearance.tint).toBeNull();
    expect(result.color.equals(source.color)).toBe(true);
    expect(result.emissive.equals(source.emissive)).toBe(true);
    expect(result.map).toBe(source.map);
    expect(result.onBeforeCompile).toBe(source.onBeforeCompile);
    expect(result.opacity).toBe(appearance.opacity);
    expect(result.alphaTest).toBeCloseTo(source.alphaTest * appearance.opacity);
  });

  test('fantasy tinting keeps authored textures and alpha instead of substituting the atlas', () => {
    const source = new MeshPhongMaterial({ color: 0x83b847, map: new Texture() });
    source.alphaMap = new Texture();
    const appearance = resolvePlaceableAppearance('arcaneLeyNexus', context);
    const result = preparePlaceableMaterials(three, source, appearance);
    const shader = { fragmentShader: 'void main() {\n#include <map_fragment>\n}' };
    result.onBeforeCompile(shader, null);

    expect(result.map).toBe(source.map);
    expect(result.alphaMap).toBe(source.alphaMap);
    expect(shader.fragmentShader).toContain('sampledDiffuseColor.rgb = vec3');
    expect(shader.fragmentShader).toContain('diffuseColor *= sampledDiffuseColor');
    expect(shader.fragmentShader).not.toContain('sampledDiffuseColor.a =');
    expect(result.customProgramCacheKey()).toContain('exotic-map-luma');
    expect(result.depthWrite).toBe(false);
    expect(source.opacity).toBe(1);
    expect(source.transparent).toBe(false);
  });
});
