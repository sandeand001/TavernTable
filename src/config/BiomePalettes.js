/**
 * BiomePalettes.js (Baseline Reset)
 * ---------------------------------
 * Stripped-down, deterministic, height-indexed color look.
 * All expressive / painterly experimentation removed per user request.
 * Keep only what callers need: getBiomeColor / getBiomeColorHex plus
 * legacy helpers. No noise, no perceptual color math, no sand/snow logic.
 */

import { ALL_BIOMES } from './BiomeConstants.js';
import { TERRAIN_CONFIG } from './TerrainConstants.js';

// Height bounds (defaults if not provided)
const MIN_H = TERRAIN_CONFIG.MIN_HEIGHT ?? -5;
const MAX_H = TERRAIN_CONFIG.MAX_HEIGHT ?? 5;

// Single unified palette mode (previous multi-mode removed)

// ------------------------
// Basic helpers
// ------------------------
function clampHeight(h) {
  return Math.max(MIN_H, Math.min(MAX_H, h));
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}
function rgbToHex({ r, g, b }) {
  return (r << 16) | (g << 8) | b;
}
function lerpColor(aHex, bHex, t) {
  const a = hexToRgb(aHex);
  const b = hexToRgb(bHex);
  return rgbToHex({
    r: Math.round(lerp(a.r, b.r, t)),
    g: Math.round(lerp(a.g, b.g, t)),
    b: Math.round(lerp(a.b, b.b, t)),
  });
}

// ------------------------
// Palette construction (simple low/mid/high gradient per biome)
// ------------------------
function generateHeightGradient(lowHex, midHex, highHex) {
  const palette = {};
  for (let h = MIN_H; h <= MAX_H; h++) {
    let hex;
    if (h === 0) hex = midHex;
    else if (h < 0) {
      const t = (h - MIN_H) / (0 - MIN_H || 1); // 0 at MIN_H -> 1 at -1
      hex = lerpColor(lowHex, midHex, t);
    } else {
      const t = (h - 0) / (MAX_H - 0 || 1); // 0 at 0 -> 1 at MAX_H
      hex = lerpColor(midHex, highHex, t);
    }
    palette[h] = hex;
  }
  return palette;
}

// Core (legacy-like) biome triads (low, mid, high)
const BIOME_BASE_TRIADS = {
  // Extended triads (added custom entries for previously default biomes; placeholder hex values to be tuned)
  grassland: [0x1d3a22, 0x3f8c2f, 0xd6c46b],
  forestTemperate: [0x0e2414, 0x2e7a3b, 0x95d56e],
  forestConifer: [0x0a1a12, 0x1f5a3a, 0x7bb0a0],
  hills: [0x2a371a, 0x5f7c36, 0xc8b67a],
  mountain: [0x2a2e34, 0x5b6068, 0xe9eef4],
  alpine: [0x1a2630, 0x3c6672, 0xe4f2f7],
  tundra: [0x23323a, 0x6f8259, 0xe6f3fb],
  desertHot: [0x5e2604, 0xb86f38, 0xf2e0b8],
  desertCold: [0x2b2f38, 0x7a8092, 0xe7e9f2],
  sandDunes: [0x4a3316, 0xc09358, 0xf5e6c8],
  // Coast: deep water -> shoreline sand -> brighter dry sand
  coast: [0x0a2c4a, 0xd8c89f, 0xf6edd5],
  riverLake: [0x0e2d2f, 0x2b7f6d, 0xd8c6a3],
  ocean: [0x071a2f, 0x0d4e7a, 0x34b6d6],
  swamp: [0x10180f, 0x2f4a2e, 0x8aa26a],
  wetlands: [0x172317, 0x3a5f3a, 0x98c08f],
  floodplain: [0x2a2b1e, 0x587247, 0xc2d39b],
  mangrove: [0x1b2d29, 0x295b53, 0x7ec8b4],
  screeSlope: [0x1d1d1d, 0x595959, 0xdadada],
  glacier: [0x0a1422, 0x2f6e9d, 0xffffff],
  frozenLake: [0x0b1820, 0x2a80a6, 0xbef1ff],
  packIce: [0x0a1016, 0x3f5f77, 0xe9f6ff],
  beach: [0x6e5e49, 0xbba47b, 0xf2e6c9],
  coralReef: [0x0b3a44, 0x18b3cf, 0xffc1cf],
  // Oasis: deep pool water -> surrounding sand -> pale dry outer sand
  oasis: [0x0b3d4a, 0xd9c18d, 0xf4e7cf],
  volcanic: [0x1b0600, 0x8a2a07, 0xffc27a],
  ashWastes: [0x141212, 0x4c4646, 0xccc7c4],
  obsidianPlain: [0x070707, 0x343138, 0x9aa1ad],
  lavaFields: [0x290700, 0x8f2105, 0xffb952],
  // Newly added / customized
  savanna: [0x3b2d14, 0xa88632, 0xe8d9a3],
  steppe: [0x2f2a1d, 0x8a7a45, 0xd8cfa8],
  cedarHighlands: [0x142418, 0x365c34, 0xc9b497],
  geyserBasin: [0x3a2712, 0xcf8f2a, 0xf3eddc],
  saltFlats: [0xb7bcc2, 0xe2e6eb, 0xffffff],
  thornscrub: [0x312a18, 0x6e5d33, 0xc3b38a],
  bloodMarsh: [0x16070a, 0x641b29, 0xbf6977],
  mysticGrove: [0x1b0628, 0x6a2fa8, 0xf2b4ff],
  feywildBloom: [0x1b2435, 0x5cb5d4, 0xfff0c9],
  shadowfellForest: [0x08090a, 0x303438, 0x8a949c],
  petrifiedForest: [0x2b241f, 0x6a5b4d, 0xd9cebf],
  bambooThicket: [0x0d1f12, 0x1f6a34, 0x9ed38b],
  orchard: [0x3d2714, 0x5f7f2a, 0xc8d68f],
  deadForest: [0x0c0c0c, 0x3a3a3a, 0x8d8d8d],
  fungalGrove: [0x1a1410, 0x4d3a27, 0xbfa37c],
  crystalFields: [0x0f1c24, 0x2f8cab, 0xbcefff],
  crystalSpires: [0x0a1218, 0x2e6e9a, 0xe1f5ff],
  eldritchRift: [0x0a0412, 0x421b5f, 0xb58dff],
  wasteland: [0x1a1f12, 0x48502b, 0x9e9f6a],
  ruinedUrban: [0x1a1d1f, 0x535a60, 0xb9c1c7],
  graveyard: [0x14110f, 0x3e3d3a, 0x9ea4a8],
  astralPlateau: [0x040a24, 0x182f6a, 0xbad4ff],
  arcaneLeyNexus: [0x07132a, 0x264d8f, 0xe6d8ff],
};

const DEFAULT_TRIAD = [0x253035, 0x607078, 0xbfd3e1];

// Build static palettes & canonical mid-tone map for fidelity mode
export const BIOME_HEIGHT_PALETTES = {};
export const BIOME_CANONICAL_COLOR = {}; // biomeKey -> mid triad hex
for (const biome of ALL_BIOMES) {
  const triad = BIOME_BASE_TRIADS[biome.key] || DEFAULT_TRIAD;
  BIOME_HEIGHT_PALETTES[biome.key] = generateHeightGradient(triad[0], triad[1], triad[2]);
  BIOME_CANONICAL_COLOR[biome.key] = triad[1];
}

// Biome key normalization (minimal)
function normalizeBiomeKey(key) {
  const lc = String(key || '').toLowerCase();
  if (lc === 'desert') return 'desertHot';
  if (lc === 'colddesert') return 'desertCold';
  if (lc === 'shore') return 'coast';
  if (lc === 'bog') return 'wetlands';
  return key;
}

export function getBiomeHeightColor(biomeKey, height) {
  const k = normalizeBiomeKey(biomeKey);
  const h = clampHeight(Math.round(height));
  // Specialized water->sand multi-stop handling for coast & oasis.
  if ((k === 'coast' || k === 'oasis') && h < 0) {
    // Provide a discrete shallow gradient independent of the (deepWater -> wetSand) triad interpolation.
    // Negative integer heights typically span MIN_H..-1 (e.g. -5..-1). We map bands to deep/mid/shallow water hues.
    // Coast water palette (deep -> mid -> shallow)
    const coastWater = [0x062036, 0x0d4e7a, 0x1b86b5];
    // Oasis water palette (deeper lagoon -> mid teal -> bright aqua)
    const oasisWater = [0x05323d, 0x0b5f73, 0x1594a8];
    const pal = k === 'coast' ? coastWater : oasisWater;
    // Determine relative depth index: collapse full negative range into 0..(pal.length-1)
    const minNeg = MIN_H; // e.g. -5
    const maxNeg = -1;
    const span = maxNeg - minNeg || 1; // positive number (e.g. 4)
    const depthT = (h - minNeg) / span; // 0 at deepest, 1 at -1 (shallow)
    const scaled = depthT * (pal.length - 1);
    const i0 = Math.floor(scaled);
    const i1 = Math.min(pal.length - 1, i0 + 1);
    const localT = scaled - i0;
    const c0 = pal[i0];
    const c1 = pal[i1];
    return lerpColor(c0, c1, localT);
  }
  const pal = BIOME_HEIGHT_PALETTES[k];
  if (pal && pal[h] != null) return pal[h];
  // If unknown biome at runtime, lazily assign default palette once
  if (!pal) {
    BIOME_HEIGHT_PALETTES[k] = generateHeightGradient(...DEFAULT_TRIAD);
    BIOME_CANONICAL_COLOR[k] = DEFAULT_TRIAD[1];
    return BIOME_HEIGHT_PALETTES[k][h];
  }
  return 0x808080;
}

// Optional hydrology band blending (simple approach): export helper for shoreline tint blending.
export const BIOME_HYDROLOGY = {
  // Coast: small shore band; light wet-sand tint near water (not darkening)
  coast: { shoreBand: [0, 0.4], tint: 0xc4ae84 },
  riverLake: { shoreBand: [0, 0.5], tint: 0x2d2218 },
  floodplain: { shoreBand: [0, 0.7], tint: 0x4a3d26 },
  swamp: { floodedMin: -3.2, floodedSoft: -0.8, emergentMax: 0.8, tint: 0x1d2618 },
  mangrove: { shoreBand: [0, 0.5], floodedMin: -2.2, tint: 0x16241d },
  // Oasis: tighter shore band; subtle damp-sand tint
  oasis: { shoreBand: [0, 0.25], tint: 0xc8a568 },
};

function blendHex(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const br = (b >> 16) & 255;
  const bg = (b >> 8) & 255;
  const bb = b & 255;
  const rr = Math.round(ar + (br - ar) * t);
  const rg = Math.round(ag + (bg - ag) * t);
  const rb = Math.round(ab + (bb - ab) * t);
  return (rr << 16) | (rg << 8) | rb;
}

export function getBiomeColorWithHydrology(biomeKey, height) {
  const base = getBiomeHeightColor(biomeKey, height);
  const hcfg = BIOME_HYDROLOGY[biomeKey];
  if (!hcfg) return base;
  // Shore band blending if defined and height in positive range.
  if (hcfg.shoreBand) {
    const [minH, maxH] = hcfg.shoreBand;
    if (height >= minH && height <= maxH) {
      const t = (height - minH) / Math.max(0.0001, maxH - minH);
      return blendHex(base, hcfg.tint, 1 - t * 0.6); // stronger tint near waterline
    }
  }
  // Flooded / soft bands (darker/murkier) for negatives
  if (hcfg.floodedMin != null && height <= 0 && height >= hcfg.floodedMin) {
    // Map floodedMin..0 -> 0.9..0.2 blending
    const t = (height - hcfg.floodedMin) / Math.max(0.0001, 0 - hcfg.floodedMin);
    return blendHex(base, hcfg.tint, 0.9 - t * 0.7);
  }
  return base;
}

// Primary public API (baseline)
export function getBiomeColor(biomeKey, height) {
  return { color: getBiomeHeightColor(biomeKey, height), fx: {} };
}
export function getBiomeColorHex(biomeKey, height) {
  return getBiomeHeightColor(biomeKey, height);
}

// Legacy helper retained (simple blend)
export function blendWithBiome(baseHex, biomeKey, height, weight = 0.6) {
  const biomeHex = getBiomeHeightColor(biomeKey, height);
  const a = hexToRgb(baseHex);
  const b = hexToRgb(biomeHex);
  const mixed = {
    r: Math.round(lerp(a.r, b.r, weight)),
    g: Math.round(lerp(a.g, b.g, weight)),
    b: Math.round(lerp(a.b, b.b, weight)),
  };
  return rgbToHex(mixed);
}

export default BIOME_HEIGHT_PALETTES;
