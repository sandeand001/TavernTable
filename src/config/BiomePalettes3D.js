/**
 * BiomePalettes3D.js
 * ------------------------------------------------------
 * Stylized, mood‑forward 3D biome palette separate from the painterly 2D tile system.
 * Goal: Evoke the FEELING of each biome rather than strict realism. Colors are
 * slightly cleaner, mid‑tones more saturated, shadows cooled or warmed by biome
 * archetype, and high elevations receive a gentle atmospheric lift.
 *
 * Design Principles:
 *  - Readability from oblique camera angles (avoid excessive micro contrast)
 *  - Distinct silhouettes between adjacent biome types (hue family separation)
 *  - Elevation = value shift + subtle chroma drift (not just lighten)
 *  - Water & below‑sea levels shift toward deeper cinematic hues
 *  - Snow / arid tops bloom toward airy, slightly overexposed highlights
 *  - Fantasy biomes lean into accent chroma (fey, eldritch, crystal, volcanic)
 *
 * API:
 *    getBiomeColor3DHex(biomeKey, height, x, y, opts?) -> hex
 *    registerCustom3DBiomePalette(key, triadOrStops)
 *
 * This module intentionally does NOT depend on the heavy perceptual machinery
 * of the 2D painterly system to keep per‑vertex color generation lightweight.
 */

import { TERRAIN_CONFIG } from './TerrainConstants.js';
import { ALL_BIOMES } from './BiomeConstants.js';

const MIN_H = TERRAIN_CONFIG.MIN_HEIGHT ?? -5;
const MAX_H = TERRAIN_CONFIG.MAX_HEIGHT ?? 5;
const ZERO = 0;

// Utility helpers -----------------------------------------------------------
function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function hex(r, g, b) {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
}
function hexToRgb(h) {
  return { r: (h >> 16) & 255, g: (h >> 8) & 255, b: h & 255 };
}
function lerpColor(a, b, t) {
  const A = hexToRgb(a);
  const B = hexToRgb(b);
  return hex(
    Math.round(lerp(A.r, B.r, t)),
    Math.round(lerp(A.g, B.g, t)),
    Math.round(lerp(A.b, B.b, t))
  );
}

// Atmospheric lift: lighten + slight hue push toward cool sky scatter
function applyAtmosphere(baseHex, normHeight) {
  // normHeight 0..1 above ZERO
  const { r, g, b } = hexToRgb(baseHex);
  const t = Math.pow(clamp(normHeight, 0, 1), 1.1); // gentle curve
  const lift = 18 * t; // value lift
  // Subtle cool shift at high altitude
  const cool = 12 * t;
  return hex(
    clamp(Math.round(r + lift * 0.9), 0, 255),
    clamp(Math.round(g + lift + cool * 0.3), 0, 255),
    clamp(Math.round(b + lift + cool), 0, 255)
  );
}

// Subsurface / below sea stylization (deepening + saturation bump)
function applyDepth(baseHex, depth01) {
  // depth01: 0 at sea level, 1 very deep
  const { r, g, b } = hexToRgb(baseHex);
  const d = Math.pow(depth01, 0.85);
  return hex(
    clamp(Math.round(r * (0.72 - 0.15 * d)), 0, 255),
    clamp(Math.round(g * (0.78 - 0.1 * d)), 0, 255),
    clamp(Math.round(b * (0.92 + 0.1 * d)), 0, 255) // bias blue w/ depth
  );
}

// High level curated triads (low -> mid -> high). Some biomes gain a 4th accent stop.
// Chosen for cinematic separation & mood.
const BIOME_3D_BASE_TRIADS = {
  grassland: [0x1d4022, 0x3fa23a, 0xd4d179], // Fresh & sunlit
  forestTemperate: [0x0d2618, 0x2c7c47, 0x9adf8c], // Lush emerald canopy
  forestConifer: [0x0a1914, 0x1f6144, 0x83c9b5], // Cool alpine teal greens
  swamp: [0x111b14, 0x2d5138, 0x7fa579], // Murky to moss glow
  wetlands: [0x142116, 0x32623d, 0x94c89a], // Damp vitality
  tundra: [0x222f35, 0x5d7461, 0xe4f6fb], // Desaturated chill
  mountain: [0x242a32, 0x5c646c, 0xf0f4f7], // Granite to airy glare
  alpine: [0x18242e, 0x3e6b78, 0xe6f8fa], // Cold crisp heights
  desertHot: [0x4b1f06, 0xbd6f31, 0xf6d393], // Ember sand blaze
  desertCold: [0x2b313b, 0x6d7786, 0xe8edf3], // Cool slate dunes
  sandDunes: [0x4a3012, 0xc58d4e, 0xf7e1c3], // Honeyed waves
  savanna: [0x3d2810, 0xb88832, 0xf4dfab], // Golden dry breath
  steppe: [0x2f3a24, 0x708c56, 0xd3ddba], // Pale sage openness
  screeSlope: [0x1a1b1b, 0x585b5a, 0xdddede], // Broken rock fade
  volcanic: [0x160704, 0x8f2c10, 0xffc87f], // Lava‑warmed crusts
  ashWastes: [0x141212, 0x4b4646, 0xccc9c6], // Muted ashen pall
  obsidianPlain: [0x050506, 0x34333a, 0xa4adb9], // Glassy charcoal sheen
  lavaFields: [0x280600, 0x922108, 0xffbf56], // Magmatic glow
  ocean: [0x041728, 0x0d4d7b, 0x33b9d9], // Navy abyss to tropical flash
  riverLake: [0x0c2426, 0x1f6b5f, 0x5ed3b4], // Tannin teal to jade
  coast: [0x082b47, 0x1582a3, 0xf3e2c4], // Deep blue to surf sand
  coralReef: [0x083c46, 0x15b9d5, 0xffc6d5], // Cyan pop & coral bloom
  beach: [0x5f5443, 0xbfa780, 0xf7ead5], // Wet umber to pale dune
  glacier: [0x06111d, 0x2879a7, 0xffffff], // Azure cold purity
  frozenLake: [0x08161d, 0x2d83ad, 0xbef3ff], // Blue ice translucence
  packIce: [0x0b1319, 0x3f6078, 0xe9f7ff], // Slate floes to glare
  cave: [0x0a0f14, 0x2f3b47, 0x94a8b5], // Shadowed mineral blues
  cavern: [0x0a0f14, 0x2f3b47, 0x94a8b5], // alias
  fungalGrove: [0x140a1c, 0x602d80, 0xcda0f0], // Sporelit amethyst
  crystalFields: [0x0a1020, 0x2c53a2, 0xaed8ff], // Faceted sapphire gleam
  eldritchRift: [0x04040a, 0x3a0d6c, 0xc85dff], // Arcane void radiance
  mysticGrove: [0x180b2a, 0x6e35a9, 0xe6c2ff], // Enchanted bloom haze
  oasis: [0x06352b, 0x17a28b, 0xdcc28c], // Cool water to desert rim
  floodplain: [0x262a1d, 0x5d7444, 0xc8d89e], // Fertile muted greens
  mangrove: [0x162d27, 0x2d5b52, 0x82d1bc], // Teal canopy & tannin roots
  thornscrub: [0x2e2317, 0x816037, 0xe0bc85], // Dry thorn warmth
  cedarHighlands: [0x142316, 0x2f6e4a, 0x9ee2b4], // Resinous altitude
  geyserBasin: [0x13221f, 0x3e8c80, 0xf4e18d], // Mineral teal & sulfur mist
  wasteland: [0x190b19, 0x622d62, 0xd39bd3], // Haunting violet dust
  graveyard: [0x141618, 0x405058, 0xa9bbc3], // Weathered slate quiet
  ruinedUrban: [0x16181c, 0x4e5661, 0xc0c9d3], // Concrete dusk
  crystalSpires: [0x060c18, 0x324a9a, 0xbcd9ff], // Lofty refracted ice‑blue
};

// Build per-biome height palettes (cache) ----------------------------------
const BIOME_3D_HEIGHT_PALETTES = {};
function buildPalette(triad) {
  const [low, mid, high, apex] = triad;
  const top = apex || high; // optional 4th accent stop
  const result = {};
  for (let h = MIN_H; h <= MAX_H; h++) {
    if (h === ZERO) {
      result[h] = mid;
      continue;
    }
    if (h < ZERO) {
      const t = (h - MIN_H) / (ZERO - MIN_H || 1);
      result[h] = lerpColor(low, mid, t);
    } else {
      const t = h / (MAX_H || 1);
      result[h] = lerpColor(mid, top, t);
    }
  }
  return result;
}

function ensureBiomePalette(keyRaw) {
  const key = String(keyRaw);
  if (!BIOME_3D_HEIGHT_PALETTES[key]) {
    const triad = BIOME_3D_BASE_TRIADS[key] || BIOME_3D_BASE_TRIADS.grassland;
    BIOME_3D_HEIGHT_PALETTES[key] = buildPalette(triad);
  }
  return BIOME_3D_HEIGHT_PALETTES[key];
}

export function registerCustom3DBiomePalette(key, triadOrStops) {
  if (!key || !triadOrStops || !Array.isArray(triadOrStops)) return false;
  BIOME_3D_BASE_TRIADS[key] = triadOrStops.slice(0, 4);
  delete BIOME_3D_HEIGHT_PALETTES[key]; // force rebuild
  return true;
}

// Core lookup ----------------------------------------------------------------
export function getBiomeColor3DHex(biomeKey, height, opts = {}) {
  const palette = ensureBiomePalette(biomeKey);
  const hClamped = Math.max(MIN_H, Math.min(MAX_H, Math.round(height)));
  let base = palette[hClamped] || 0x777777;

  // Depth effect (if below 0)
  if (height < 0) {
    const depth01 = Math.min(1, Math.abs(height) / Math.abs(MIN_H || 10));
    base = applyDepth(base, depth01);
  }

  // Atmospheric lift (if above 0)
  if (height > 0) {
    const t = height / (MAX_H || 1);
    base = applyAtmosphere(base, t);
  }

  // Optional global intensity adjustment
  const intensity =
    opts.intensity ?? (typeof window !== 'undefined' && window?.threeBiomeIntensity) ?? 1.0;
  if (intensity !== 1) {
    const { r, g, b } = hexToRgb(base);
    const pivot = 0.52 * 255;
    const t = intensity - 1; // -1 .. +? (we clamp softly)
    const scale = 1 + 0.85 * t;
    const adj = (c) => clamp(Math.round(pivot + (c - pivot) * scale), 0, 255);
    base = hex(adj(r), adj(g), adj(b));
  }

  return base;
}

// Pre-warm common palettes for shipped biome list (non-blocking, try/catch guarded)
try {
  ALL_BIOMES.forEach((b) => ensureBiomePalette(b.key));
} catch (_) {
  /* ignore */
}

export const BIOME_3D_PALETTE_INFO = {
  MIN_H,
  MAX_H,
  source: 'Stylized 3D palette v1',
  triadCount: Object.keys(BIOME_3D_BASE_TRIADS).length,
};

export default getBiomeColor3DHex;
