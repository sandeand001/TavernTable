import { EXOTIC_BIOME_APPEARANCES } from '../../../config/biome/ExoticBiomeAppearance.js';
import { hash32 } from '../../../terrain/flora/floraHelpers.js';

// ── Appearance Selection ──────────────────────────────────────────

export function resolvePlaceableAppearance(biomeKey, placement = {}) {
  if (!Object.prototype.hasOwnProperty.call(EXOTIC_BIOME_APPEARANCES, biomeKey)) return null;
  const profile = EXOTIC_BIOME_APPEARANCES[biomeKey];
  const seed = Number.isFinite(placement.biomeSeed) ? placement.biomeSeed >>> 0 : 0;
  const identity = [
    biomeKey,
    seed,
    placement.gridX ?? 0,
    placement.gridY ?? 0,
    placement.modelKey || placement.variantKey || '',
  ].join(':');
  const count = Math.max(profile.colors?.length || 0, profile.opacities.length);
  const variant = hash32(identity) % count;
  return {
    key: `exotic:${biomeKey}:${variant}`,
    biomeKey,
    variant,
    tint: profile.colors ? profile.colors[variant % profile.colors.length] : null,
    opacity: profile.opacities[variant % profile.opacities.length],
    glow: profile.glow,
  };
}

// ── Material Ownership ────────────────────────────────────────────

export function preparePlaceableMaterials(three, source, appearance = null) {
  const prepare = (original) => {
    if (!original) return original;
    const material = original.clone();
    material.onBeforeCompile = original.onBeforeCompile;
    material.customProgramCacheKey = original.customProgramCacheKey;
    if (!appearance) return material;

    material.opacity *= appearance.opacity;
    material.transparent = true;
    material.depthWrite = false;
    // Alpha-test thresholds include opacity; scale them to retain the authored cutout.
    material.alphaTest *= appearance.opacity;
    material.userData.exoticAppearance = { ...appearance };
    if (appearance.tint !== null) {
      material.color.setHex(appearance.tint);
      if (material.emissive) {
        material.emissive.setHex(appearance.tint);
        material.emissiveIntensity = appearance.glow;
      }
      if (material.map) installTextureTint(three, material);
    }
    material.needsUpdate = true;
    return material;
  };
  return Array.isArray(source) ? source.map(prepare) : prepare(source);
}

export function disposePlaceableMaterials(materials) {
  const list = Array.isArray(materials) ? materials : [materials];
  for (const material of list) material?.dispose?.();
}

// ── Texture Detail Preservation ───────────────────────────────────

function installTextureTint(three, material) {
  const marker = 'diffuseColor *= sampledDiffuseColor;';
  const source = three.ShaderChunk?.map_fragment;
  if (!source?.includes(marker)) {
    throw new Error('Exotic placeable tinting requires the Three.js diffuse map shader chunk');
  }
  // Tint texture brightness, not its original hue; keep UVs and alpha untouched.
  const chunk = source.replace(
    marker,
    `sampledDiffuseColor.rgb = vec3(dot(sampledDiffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)));
    ${marker}`
  );
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey();
  material.onBeforeCompile = function (shader, renderer) {
    originalCompile.call(this, shader, renderer);
    if (!shader.fragmentShader.includes('#include <map_fragment>')) {
      throw new Error('Exotic placeable material is missing its diffuse map shader seam');
    }
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', chunk);
  };
  material.customProgramCacheKey = () => `${originalKey}|exotic-map-luma-v1`;
}
