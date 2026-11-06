const states = new WeakMap();

export function hasConstructionMaterials(geometry) {
  return !!geometry.getAttribute?.('constructionMaterial')?.array.some((value) => value > 0);
}

const varyings = `
varying float vConstructionMaterial;
varying vec3 vConstructionPoint;
varying vec3 vConstructionNormal;
`;

const surface = `
float constructionHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float constructionBlocks(vec2 p, vec2 size, float joint) {
  float row = floor(p.y / size.y);
  p.x += mod(row, 2.0) * size.x * 0.5;
  vec2 cell = floor(p / size);
  vec2 f = fract(p / size);
  float edge = min(min(f.x, 1.0-f.x)*size.x, min(f.y, 1.0-f.y)*size.y);
  float mortar = smoothstep(joint*0.5, joint*1.7, edge);
  return mix(0.73, 0.92 + constructionHash(cell)*0.16, mortar);
}
vec3 constructionSurface(vec3 base) {
  float style = vConstructionMaterial;
  if (style < 0.5) return base;
  vec3 p = vConstructionPoint;
  vec3 n = normalize(vConstructionNormal);
  vec2 uv = abs(n.y) > 0.65 ? p.xz : abs(n.x) > abs(n.z) ? vec2(p.z,p.y) : p.xy;
  if (style < 1.5) return base*(0.98+0.04*constructionHash(floor(uv*24.0)));
  if (style < 2.5) return base*constructionBlocks(uv,vec2(1.65,0.65),0.035);
  if (style < 3.5) {
    float plank = smoothstep(0.0,0.06,min(fract(uv.x/1.4),1.0-fract(uv.x/1.4)));
    float grain = sin(uv.x*63.0 + sin(uv.y*1.7)*2.0);
    return base*mix(0.78,0.95+grain*0.035,plank);
  }
  if (style < 4.5) return base*constructionBlocks(uv,vec2(3.2,1.35),0.055);
  if (style < 6.5) {
    uv = abs(n.x) > abs(n.z) ? p.zx : p.xz;
    float tiles = constructionBlocks(uv,vec2(0.95,0.65),0.025);
    return base*tiles;
  }
  if (style < 7.5) return base*constructionBlocks(p.xz,vec2(1.4,1.1),0.045);
  if (style < 8.5) return base*(0.94+0.12*constructionHash(floor(p.xz*2.0)));
  float broad = constructionHash(floor(uv*0.45));
  float grain = constructionHash(floor(uv*9.0));
  float vein = smoothstep(0.82,0.99,sin(uv.y*0.85+sin(uv.x*0.32)*1.8));
  return base*(0.84+0.15*broad+0.06*grain+0.06*vein);
}
`;

export function configureConstructionMaterial(material, worldUnitsPerFoot) {
  if (!Number.isFinite(worldUnitsPerFoot) || worldUnitsPerFoot <= 0)
    throw new Error('Construction texturing requires a positive physical render scale');
  if (!material?.isMaterial) return material;
  const existing = states.get(material);
  if (existing) {
    existing.scale.value = worldUnitsPerFoot;
    return material;
  }
  const state = { scale: { value: worldUnitsPerFoot } };
  states.set(material, state);
  const prior = material.onBeforeCompile;
  const key = material.customProgramCacheKey();
  material.defaultAttributeValues = {
    ...material.defaultAttributeValues,
    constructionMaterial: [0],
  };
  material.onBeforeCompile = (shader, renderer) => {
    prior.call(material, shader, renderer);
    shader.uniforms.uConstructionScale = state.scale;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute float constructionMaterial;
uniform float uConstructionScale;
${varyings}`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vConstructionMaterial=constructionMaterial;
vConstructionPoint=(modelMatrix*vec4(transformed,1.0)).xyz/uConstructionScale;
vConstructionNormal=mat3(modelMatrix)*normal;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
${varyings}
${surface}`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
diffuseColor.rgb=constructionSurface(diffuseColor.rgb);`
      );
  };
  material.customProgramCacheKey = () => `${key}:construction-surfaces-v2`;
  material.needsUpdate = true;
  return material;
}

export function cloneConstructionMaterial(material) {
  const clone = material.clone();
  const state = states.get(material);
  if (state) configureConstructionMaterial(clone, state.scale.value);
  return clone;
}
