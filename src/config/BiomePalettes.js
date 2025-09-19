/**
 * BiomePalettes.js  — painterly revision
 * ------------------------------------------------------
 * Adds perceptual OKLCH adjustments, macro color flow, shoreline sand bands,
 * aspect-aware lighting, and curated multi-hue ramps per biome.
 *
 * New API:
 *    getBiomeColor(biomeKey, height, x, y, opts) -> { color, fx }
 *    getBiomeColorHex(biomeKey, height, x, y, opts) -> hex
 */

import { ALL_BIOMES } from './BiomeConstants.js';
import { TERRAIN_CONFIG } from './TerrainConstants.js';

const MIN_H = TERRAIN_CONFIG.MIN_HEIGHT ?? -5;
const MAX_H = TERRAIN_CONFIG.MAX_HEIGHT ?? 5;
const ZERO = 0;

// ------------------------
// Basic utilities (RGB + lerp)
// ------------------------

function clampHeight(h) {
  return Math.max(MIN_H, Math.min(MAX_H, h));
}
function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function mix(a, b, t) {
  return a + (b - a) * t;
}
// smoothstep was unused; removed to satisfy linter

function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}
function rgbToHex({ r, g, b }) {
  return (r << 16) | (g << 8) | b;
}
function lerp(a, b, t) {
  return a + (b - a) * t;
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
function lighten(hex, amount = 0.25) {
  const { r, g, b } = hexToRgb(hex);
  return rgbToHex({
    r: Math.min(255, Math.round(r + (255 - r) * amount)),
    g: Math.min(255, Math.round(g + (255 - g) * amount)),
    b: Math.min(255, Math.round(b + (255 - b) * amount)),
  });
}
// darken and desaturate were unused; removed to satisfy linter

// ------------------------
// Perceptual color (OKLab / OKLCH) + macro flow (noise)
// ------------------------

// sRGB gamma helpers
function srgbToLinear01(u8) {
  const c = u8 / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function linear01ToSrgb(lin) {
  const c = lin <= 0.0031308 ? 12.92 * lin : 1.055 * Math.pow(lin, 1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, c)) * 255);
}
function hexToRgb01(hex) {
  const { r, g, b } = hexToRgb(hex);
  return { r: srgbToLinear01(r), g: srgbToLinear01(g), b: srgbToLinear01(b) };
}
function rgb01ToHex({ r, g, b }) {
  return (linear01ToSrgb(r) << 16) | (linear01ToSrgb(g) << 8) | linear01ToSrgb(b);
}

// sRGB (linear) -> OKLab
function rgb01ToOklab({ r, g, b }) {
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  const L = 0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_;
  const a = 1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_;
  const b2 = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_;

  return { L, a, b: b2 };
}
// OKLab -> sRGB (linear)
function oklabToRgb01({ L, a, b }) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: 0.0041960863 * l - 0.7034186147 * m + 1.6990625613 * s,
  };
}
// OKLab <-> OKLCH
function oklabToOklch({ L, a, b }) {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
}
function oklchToOklab({ L, C, h }) {
  const hr = (h * Math.PI) / 180;
  return { L, a: Math.cos(hr) * C, b: Math.sin(hr) * C };
}
function hexToOklch(hex) {
  return oklabToOklch(rgb01ToOklab(hexToRgb01(hex)));
}
function oklchToHex(lch) {
  return rgb01ToHex(oklabToRgb01(oklchToOklab(lch)));
}

function mixAngleDeg(a, b, t) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}
function lerpOklch(lchA, lchB, t) {
  return {
    L: mix(lchA.L, lchB.L, t),
    C: mix(lchA.C, lchB.C, t),
    h: mixAngleDeg(lchA.h, lchB.h, t),
  };
}

// Tiny deterministic 2D noise (for macro flow)
function hash2D(x, y, seed = 1337) {
  const X = Math.sin(x * 127.1 + y * 311.7 + seed * 0.7) * 43758.5453;
  return X - Math.floor(X);
}
function smoothNoise(x, y, seed = 1337) {
  const x0 = Math.floor(x),
    y0 = Math.floor(y);
  const xf = x - x0,
    yf = y - y0;
  const v00 = hash2D(x0, y0, seed);
  const v10 = hash2D(x0 + 1, y0, seed);
  const v01 = hash2D(x0, y0 + 1, seed);
  const v11 = hash2D(x0 + 1, y0 + 1, seed);
  const u = xf * xf * (3 - 2 * xf),
    v = yf * yf * (3 - 2 * yf);
  return mix(mix(v00, v10, u), mix(v01, v11, u), v);
}
function fbm2(x, y, seed = 1337) {
  const n1 = smoothNoise(x, y, seed);
  const n2 = smoothNoise(x * 2.13, y * 2.13, seed + 71);
  return n1 * 0.65 + n2 * 0.35;
}

// ------------------------
// Palette generation
// ------------------------

function generateHeightGradient(lowHex, midHex, highHex) {
  const palette = {};
  for (let h = MIN_H; h <= MAX_H; h++) {
    let hex;
    if (h === ZERO) hex = midHex;
    else if (h < ZERO) {
      const t = (h - MIN_H) / (ZERO - MIN_H || 1);
      hex = lerpColor(lowHex, midHex, t);
    } else {
      const t = (h - ZERO) / (MAX_H - ZERO || 1);
      hex = lerpColor(midHex, highHex, t);
    }
    palette[h] = hex;
  }
  return palette;
}
function generateFromStops(stops) {
  const palette = {};
  const sorted = [...stops]
    .map((s) => ({ h: clampHeight(s.h), color: s.color }))
    .sort((a, b) => a.h - b.h);
  for (let h = MIN_H; h <= MAX_H; h++) {
    const exact = sorted.find((s) => s.h === h);
    if (exact) {
      palette[h] = exact.color;
      continue;
    }
    // If outside the range of provided stops, clamp to nearest stop color
    if (h <= sorted[0].h) {
      palette[h] = sorted[0].color;
      continue;
    }
    if (h >= sorted[sorted.length - 1].h) {
      palette[h] = sorted[sorted.length - 1].color;
      continue;
    }
    // Otherwise, find the bracket and interpolate
    let lower = sorted[0];
    let upper = sorted[sorted.length - 1];
    for (let i = 0; i < sorted.length - 1; i++) {
      if (h >= sorted[i].h && h <= sorted[i + 1].h) {
        lower = sorted[i];
        upper = sorted[i + 1];
        break;
      }
    }
    if (lower.h === upper.h) {
      palette[h] = lower.color;
    } else {
      const t = (h - lower.h) / (upper.h - lower.h);
      palette[h] = lerpColor(lower.color, upper.color, t);
    }
  }
  return palette;
}

/**
 * Curated base triads (used when no stop map is provided)
 */
const BIOME_BASE_TRIADS = {
  grassland: [0x1d3a22, 0x3f8c2f, 0xd6c46b], // moss -> green -> straw
  hills: [0x2a371a, 0x5f7c36, 0xc8b67a], // earthier highs
  forestTemperate: [0x0e2414, 0x2e7a3b, 0x95d56e], // deep cool -> sunlit canopy
  forestConifer: [0x0a1a12, 0x1f5a3a, 0x7bb0a0], // blue-green tops
  savanna: [0x4a2a0f, 0xb88a2e, 0xf1dda3], // red soil -> golden grass
  steppe: [0x39452a, 0x768f5e, 0xcfd7b0], // silvery sage
  desertHot: [0x5e2604, 0xb86f38, 0xf2e0b8], // warm sand
  desertCold: [0x2b2f38, 0x7a8092, 0xe7e9f2], // cool violets/blue-greys
  sandDunes: [0x4a3316, 0xc09358, 0xf5e6c8], // dune golds
  oasis: [0x074339, 0x1aa28e, 0x7ff0e3], // palm greens + aqua
  saltFlats: [0x2a2c2f, 0xcfd6dd, 0xfff3f0], // cooler whites w/ pink cast
  thornscrub: [0x2e2216, 0x7e5f3a, 0xdab875],

  tundra: [0x23323a, 0x6f8259, 0xe6f3fb], // lichen ochres into snow
  glacier: [0x0a1422, 0x2f6e9d, 0xffffff],
  frozenLake: [0x0b1820, 0x2a80a6, 0xbef1ff],
  packIce: [0x0a1016, 0x3f5f77, 0xe9f6ff],

  mountain: [0x2a2e34, 0x5b6068, 0xe9eef4], // granite greys
  alpine: [0x1a2630, 0x3c6672, 0xe4f2f7], // colder, airy highs
  screeSlope: [0x1d1d1d, 0x595959, 0xdadada],
  cedarHighlands: [0x152418, 0x2f6d46, 0x97d7ab],
  geyserBasin: [0x1a2422, 0x3d877c, 0xf5e089], // warmer sulfur hint

  swamp: [0x10180f, 0x2f4a2e, 0x8aa26a], // peatier
  wetlands: [0x172317, 0x3a5f3a, 0x98c08f],
  floodplain: [0x2a2b1e, 0x587247, 0xc2d39b],
  bloodMarsh: [0x2a0a0e, 0x70242b, 0xf58b98],
  mangrove: [0x1b2d29, 0x295b53, 0x7ec8b4], // mud + teal water

  coast: [0x0a2c4a, 0x1a7fa8, 0xf2e6c9], // deep sea -> cyan shallows -> sand
  riverLake: [0x0e2d2f, 0x2b7f6d, 0xd8c6a3], // dark teal -> green shallows -> sandbars
  ocean: [0x071a2f, 0x0d4e7a, 0x34b6d6], // navy -> blue -> cyan
  coralReef: [0x0b3a44, 0x18b3cf, 0xffc1cf], // turquoise + coral pink

  deadForest: [0x1a0f07, 0x4a3a2e, 0xa28d7e],
  petrifiedForest: [0x18110e, 0x614b40, 0xd9bea9],
  bambooThicket: [0x0b2a12, 0x169245, 0x7cef9b],
  orchard: [0x13220b, 0x449636, 0xb2f074],
  mysticGrove: [0x1a0e2c, 0x6a37a6, 0xe2c0ff],
  feywildBloom: [0x1f0038, 0x8520b0, 0xffd5ff],
  shadowfellForest: [0x07080b, 0x2a2e37, 0x95a0b0],

  cavern: [0x0a0f14, 0x2f3b47, 0x8da0ae],
  fungalGrove: [0x120a19, 0x5b2d7a, 0xc59ce8],
  crystalFields: [0x0b1022, 0x2e55a5, 0xaad6ff],
  crystalSpires: [0x050a18, 0x324b9e, 0xbcd6ff],
  eldritchRift: [0x02030a, 0x3a0d6a, 0xc455ff],

  volcanic: [0x1b0600, 0x8a2a07, 0xffc27a],
  obsidianPlain: [0x070707, 0x343138, 0x9aa1ad],
  ashWastes: [0x141212, 0x4c4646, 0xccc7c4],
  lavaFields: [0x290700, 0x8f2105, 0xffb952],

  wasteland: [0x130a13, 0x5e2f5e, 0xda9fda],
  ruinedUrban: [0x121317, 0x4b525d, 0xb8c1cd],
  graveyard: [0x151719, 0x415057, 0xa2b4bc],

  astralPlateau: [0x070a22, 0x2f3ba9, 0xaedaff],
  arcaneLeyNexus: [0x14003a, 0x7600de, 0xe6b2ff],

  // New explicit sand-focused biome
  beach: [0x6e5e49, 0xcdb88f, 0xf6ecd5], // wet sand -> dry sand
};

// Expressive multi-stop ramps (reworked most water, coasts, grasses, deserts, wetlands)
const BIOME_STOP_MAP = {
  // Arid
  desertHot: [
    { h: -10, color: 0x3a1606 },
    { h: -4, color: 0x7e3b1a },
    { h: 0, color: 0xb86f38 },
    { h: 5, color: 0xe9c085 },
    { h: 10, color: 0xf6e8cc },
  ],
  desertCold: [
    { h: -10, color: 0x262a33 },
    { h: -3, color: 0x555b6b },
    { h: 0, color: 0x7a8092 },
    { h: 6, color: 0xd7dae4 },
    { h: 10, color: 0xedeff7 },
  ],
  sandDunes: [
    { h: -10, color: 0x3e2a10 },
    { h: -3, color: 0xa67a45 },
    { h: 0, color: 0xcfa767 },
    { h: 4, color: 0xebd7a8 },
    { h: 10, color: 0xf7edd3 },
  ],
  saltFlats: [
    { h: -10, color: 0x2a2c2f },
    { h: -2, color: 0x9fa8b0 },
    { h: 0, color: 0xdde3e8 },
    { h: 6, color: 0xfff3f0 },
    { h: 10, color: 0xffffff },
  ],
  thornscrub: [
    { h: -10, color: 0x2e2216 },
    { h: -2, color: 0x6f5430 },
    { h: 0, color: 0x9b7c47 },
    { h: 6, color: 0xdaba86 },
  ],
  oasis: [
    // Reworked: negative heights (water bowl) use aqua/teal; >=0 shifts quickly to warm sand so biome not all "sea".
    { h: -10, color: 0x06322a }, // deep water shadowed
    { h: -4, color: 0x0d675a }, // mid-depth teal
    { h: -1, color: 0x139b85 }, // shallow rim aqua
    { h: 0, color: 0xc49a54 }, // immediate sand edge
    { h: 3, color: 0xdabf80 }, // dry inner dune ring
    { h: 7, color: 0xecdcb8 }, // sunbleached outer
    { h: 10, color: 0xf5e9cf },
  ],

  // Grass & Forest
  grassland: [
    { h: -10, color: 0x18321d },
    { h: -3, color: 0x2f6f2a },
    { h: 0, color: 0x3f8c2f },
    { h: 5, color: 0xaec76a },
    { h: 10, color: 0xd6c46b },
  ],
  steppe: [
    { h: -10, color: 0x303a28 },
    { h: -2, color: 0x627a54 },
    { h: 0, color: 0x768f5e },
    { h: 6, color: 0xbac7a2 },
    { h: 10, color: 0xcfd7b0 },
  ],
  savanna: [
    { h: -10, color: 0x39230e },
    { h: -2, color: 0x8e6a27 },
    { h: 0, color: 0xb88a2e },
    { h: 6, color: 0xe6c77f },
    { h: 10, color: 0xf1dda3 },
  ],
  forestTemperate: [
    { h: -10, color: 0x0b1d12 },
    { h: -3, color: 0x23633a },
    { h: 0, color: 0x2e7a3b },
    { h: 5, color: 0x84cb7f },
    { h: 10, color: 0xc4f0b2 },
  ],
  forestConifer: [
    { h: -10, color: 0x0a1510 },
    { h: -3, color: 0x1c5236 },
    { h: 0, color: 0x1f5a3a },
    { h: 5, color: 0x6aa894 },
    { h: 10, color: 0xa3d8c8 },
  ],

  // Wetlands
  swamp: [
    { h: -10, color: 0x11180f },
    { h: -6, color: 0x1a2d1b },
    { h: -2, color: 0x24442a },
    { h: 0, color: 0x2f4a2e },
    { h: 5, color: 0x7b9566 },
    { h: 10, color: 0xaec59b },
  ],
  wetlands: [
    { h: -10, color: 0x172317 },
    { h: -4, color: 0x2f5a37 },
    { h: 0, color: 0x3a5f3a },
    { h: 5, color: 0x86b68a },
    { h: 10, color: 0xbdddc0 },
  ],
  floodplain: [
    { h: -10, color: 0x242818 },
    { h: -2, color: 0x4d6a42 },
    { h: 0, color: 0x587247 },
    { h: 6, color: 0xb3ca8f },
    { h: 10, color: 0xd6e6b8 },
  ],
  mangrove: [
    { h: -10, color: 0x1b2d29 },
    { h: -4, color: 0x244b44 },
    { h: 0, color: 0x295b53 },
    { h: 6, color: 0x6db4a3 },
    { h: 10, color: 0xa6e3d3 },
  ],

  // Arctic / Alpine
  glacier: [
    { h: -10, color: 0x06101c },
    { h: -5, color: 0x133a5c },
    { h: -1, color: 0x2a6e9e },
    { h: 0, color: 0x49a8d8 },
    { h: 5, color: 0xb8e9f9 },
    { h: 10, color: 0xffffff },
  ],
  tundra: [
    { h: -10, color: 0x223039 },
    { h: -4, color: 0x3a585e },
    { h: 0, color: 0x6f8259 },
    { h: 4, color: 0xc9dfd1 },
    { h: 10, color: 0xffffff },
  ],
  frozenLake: [
    { h: -10, color: 0x0b1820 },
    { h: -4, color: 0x1d5672 },
    { h: 0, color: 0x2a80a6 },
    { h: 6, color: 0x83d3eb },
    { h: 10, color: 0xbef1ff },
  ],
  packIce: [
    { h: -10, color: 0x0a1016 },
    { h: -3, color: 0x2f4a5e },
    { h: 0, color: 0x3f5f77 },
    { h: 6, color: 0xbfe6fb },
    { h: 10, color: 0xe9f6ff },
  ],

  // Mountain
  mountain: [
    { h: -10, color: 0x242a30 },
    { h: -4, color: 0x4a5159 },
    { h: 0, color: 0x5b6068 },
    { h: 6, color: 0xbcc6d0 },
    { h: 10, color: 0xe9eef4 },
  ],
  alpine: [
    { h: -10, color: 0x182330 },
    { h: -3, color: 0x335d6a },
    { h: 0, color: 0x3c6672 },
    { h: 4, color: 0x7fb08e }, // alpine meadow hint
    { h: 10, color: 0xe4f2f7 },
  ],
  cedarHighlands: [
    { h: -10, color: 0x132016 },
    { h: -4, color: 0x235838 },
    { h: 0, color: 0x2f6d46 },
    { h: 6, color: 0x78c89d },
    { h: 10, color: 0xb5e6cb },
  ],
  screeSlope: [
    { h: -10, color: 0x1b1b1b },
    { h: -2, color: 0x454545 },
    { h: 0, color: 0x595959 },
    { h: 6, color: 0xb9b9b9 },
    { h: 10, color: 0xe3e3e3 },
  ],

  // Aquatic / Coastal (+ sand band)
  ocean: [
    { h: -10, color: 0x071a2f }, // deep navy
    { h: -6, color: 0x0b3a5e },
    { h: -2, color: 0x126b94 },
    { h: 0, color: 0x2fbfd0 }, // cyan at surface
  ],
  riverLake: [
    { h: -10, color: 0x0e2d2f }, // tannin-dark
    { h: -6, color: 0x1f5d55 },
    { h: -2, color: 0x2b7f6d }, // greenish shallow
    { h: 0, color: 0x67c7a9 }, // pale jade near bank
  ],
  coast: [
    { h: -10, color: 0x0a2c4a }, // offshore blue
    { h: -3, color: 0x146a8e }, // nearshore blue-green
    { h: -1, color: 0x2fb3c8 }, // turquoise shallows
    { h: 0, color: 0x46cbd2 }, // surf
    { h: 1, color: 0xd7c5a6 }, // wet sand
    { h: 3, color: 0xf2e6c9 }, // dry sand / dunes
  ],
  coralReef: [
    { h: -10, color: 0x0b3a44 }, // teal deep
    { h: -3, color: 0x14a9cf }, // reef blue
    { h: -1, color: 0x35d0d4 }, // aqua bright
    { h: 0, color: 0x88efe0 }, // glint
    { h: 2, color: 0xf7b3c6 }, // coral pink
    { h: 4, color: 0xffeadd }, // bleached sandbar
  ],
  beach: [
    { h: -2, color: 0x6e5e49 }, // wet dark sand
    { h: -1, color: 0x8c775c },
    { h: 0, color: 0xbba47b },
    { h: 2, color: 0xdac6a3 },
    { h: 6, color: 0xf2e6c9 },
  ],

  // Exotic / Arcane keep as-is (already non-monochrome)
  eldritchRift: [
    { h: -10, color: 0x03040c },
    { h: -6, color: 0x140a2a },
    { h: -2, color: 0x33115d },
    { h: 0, color: 0x5a1990 },
    { h: 4, color: 0x8d3ad1 },
    { h: 10, color: 0xe0b3ff },
  ],
  mysticGrove: [
    { h: -10, color: 0x120826 },
    { h: -4, color: 0x311157 },
    { h: 0, color: 0x5d2f8a },
    { h: 4, color: 0x9c63d8 },
    { h: 10, color: 0xf4e6ff },
  ],
};

// Build per-biome height palettes
export const BIOME_HEIGHT_PALETTES = {};
const DEFAULT_TRIAD = [0x253035, 0x607078, 0xbfd3e1];
for (const biome of ALL_BIOMES) {
  let palette;
  if (BIOME_STOP_MAP[biome.key]) palette = generateFromStops(BIOME_STOP_MAP[biome.key]);
  else {
    const triad = BIOME_BASE_TRIADS[biome.key] || DEFAULT_TRIAD;
    palette = generateHeightGradient(triad[0], triad[1], triad[2]);
  }
  BIOME_HEIGHT_PALETTES[biome.key] = palette;
}

/**
 * Simple height-indexed color lookup for a biome. Used by legacy paths and as a
 * fallback inside getBiomeColor. Prefer getBiomeColor/getBiomeColorHex for
 * painterly results.
 */
export function getBiomeHeightColor(biomeKey, height) {
  const key = normalizeBiomeKey(biomeKey);
  const h = clampHeight(Math.round(height));
  // Ensure palette exists (may not be in ALL_BIOMES list if custom key provided)
  if (!BIOME_HEIGHT_PALETTES[key]) {
    if (BIOME_STOP_MAP[key]) {
      BIOME_HEIGHT_PALETTES[key] = generateFromStops(BIOME_STOP_MAP[key]);
    } else {
      const triad = BIOME_BASE_TRIADS[key] || DEFAULT_TRIAD;
      BIOME_HEIGHT_PALETTES[key] = generateHeightGradient(triad[0], triad[1], triad[2]);
    }
  }
  const palette = BIOME_HEIGHT_PALETTES[key];
  return palette && palette[h] != null ? palette[h] : 0x808080;
}

// Also prebuild sand palette for shoreline blending
const SAND_PALETTE = generateFromStops(BIOME_STOP_MAP.beach);

// Snow/light overlays for cold high elevations (mild; detailed snow handled in getBiomeColor)
const SNOWCAP_BIOMES = new Set(['mountain', 'alpine', 'glacier', 'tundra']);
const SNOW_START_BASE = Math.min(3, MAX_H - 1);
for (const key of SNOWCAP_BIOMES) {
  const pal = BIOME_HEIGHT_PALETTES[key];
  if (!pal) continue;
  for (let h = SNOW_START_BASE; h <= MAX_H; h++) {
    const t = (h - SNOW_START_BASE) / (MAX_H - SNOW_START_BASE || 1);
    pal[h] = lighten(pal[h], 0.18 + 0.18 * t);
  }
}

// ------------------------
// Biome normalization and groups
// ------------------------

const SUBTERRANEAN_BIOMES = new Set([
  'cavern',
  'fungalGrove',
  'crystalFields',
  'crystalSpires',
  'eldritchRift',
]);

function normalizeBiomeKey(biomeKey) {
  const raw = String(biomeKey || '');
  const lc = raw.toLowerCase().replace(/\s+/g, '');
  if (lc === 'desert' || lc === 'hotdesert') return 'desertHot';
  if (lc === 'colddesert') return 'desertCold';
  if (lc === 'sand' || lc === 'sanddunes') return 'sandDunes';
  if (lc === 'shore' || lc === 'beach') return 'beach';
  if (lc === 'bog' || lc === 'peatbog') return 'wetlands';
  if (lc === 'moor' || lc === 'heath') return 'steppe';
  if (lc === 'chaparral' || lc === 'maquis') return 'savanna';
  if (lc === 'rainforest' || lc === 'tropicalforest') return 'forestTemperate';
  if (lc === 'monsoonforest') return 'bambooThicket';
  if (lc === 'riparian' || lc === 'delta') return 'floodplain';
  if (lc === 'badlands') return 'screeSlope';
  if (lc === 'karst' || lc === 'limestone') return 'cavern';
  return biomeKey;
}

/**
 * Legacy fast color — RGB palette with small corrections.
 * Kept for reference. Prefer getBiomeColor()/getBiomeColorHex() below.
 */
export function getBiomeColorLegacy(biomeKey, height, x, y, opts = {}) {
  const {
    moisture = 0.5,
    slope = 0.0,
    aspectRad = 0.0, // 0=N, π/2=E, π=S, 3π/2=W
    seed = 1337,
    mapFreq = 0.05,
    shorelineSandStrength = typeof window !== 'undefined' &&
    Number.isFinite(window?.richShadingSettings?.shorelineSandStrength)
      ? window.richShadingSettings.shorelineSandStrength
      : 1.0,
  } = opts;

  const key = normalizeBiomeKey(biomeKey);
  const isSubterranean = SUBTERRANEAN_BIOMES.has(key);

  // Effective height: subterranean acts as if below sea level for *all* logic
  const effHeight = isSubterranean ? Math.min(height, -1) : height;
  const hIndex = clampHeight(Math.round(effHeight));
  const belowSea = effHeight < 0;

  // Base hex from curated palette
  let basePalette = BIOME_HEIGHT_PALETTES[key];
  if (!basePalette && BIOME_STOP_MAP[key]) {
    basePalette = generateFromStops(BIOME_STOP_MAP[key]);
    BIOME_HEIGHT_PALETTES[key] = basePalette;
  }
  const baseHex = (basePalette && basePalette[hIndex]) || getBiomeHeightColor(key, hIndex);

  // Macro flow drift in OKLCH
  const n = fbm2(x * mapFreq, y * mapFreq, seed);
  const drift = n - 0.5;
  let lch = hexToOklch(baseHex);
  lch.L = Math.min(1, Math.max(0, lch.L + 0.02 * drift));
  lch.C = Math.max(0, lch.C + 0.015 * drift);
  lch.h = (lch.h + 4 * drift + 360) % 360;

  // Aspect lighting (skip for subterranean)
  if (!isSubterranean) {
    const northness = Math.cos(aspectRad || 0); // 1=N, -1=S
    const southness = -northness;
    lch.L = Math.min(1, Math.max(0, lch.L + 0.02 * southness - 0.01 * Math.max(0, northness)));
    lch.h = (lch.h + southness * -2) % 360;
  }

  // Water implication when below sea level (or subterranean)
  if (belowSea) {
    const depth = Math.min(1, Math.max(0, -effHeight / (Math.abs(MIN_H) || 10)));
    const flatness = 1 - Math.min(1, Math.max(0, slope));
    const wetness = Math.min(1, Math.max(0, moisture));
    const waterBlend = Math.min(1, Math.max(0, depth * (0.6 * flatness + 0.4 * wetness)));

    const waterKey =
      key === 'ocean' || key === 'coast' || key === 'coralReef'
        ? key
        : slope < 0.15
          ? 'riverLake'
          : 'coast';

    const shallowHex = getBiomeHeightColor(waterKey, Math.max(hIndex, -2));
    const lchWater = hexToOklch(shallowHex);

    if (waterKey === 'ocean' || waterKey === 'coast') {
      const hDeep = 220,
        hShal = 190;
      const t = depth;
      lchWater.h = (hShal + (((hDeep - hShal + 540) % 360) - 180) * t + 360) % 360;
      lchWater.L = Math.min(1, Math.max(0, lchWater.L - 0.18 * depth));
      lchWater.C = Math.min(1, Math.max(0, lchWater.C + 0.03 * (1 - slope)));
    } else {
      const hDeep = 190,
        hShal = 155;
      const t = depth;
      lchWater.h = (hShal + (((hDeep - hShal + 540) % 360) - 180) * t + 360) % 360;
      lchWater.L = Math.min(1, Math.max(0, lchWater.L - 0.12 * depth));
      lchWater.C = Math.min(1, Math.max(0, lchWater.C + 0.04 * (1 - slope)));
    }

    const tBlend = waterBlend * waterBlend;
    lch = {
      L: lch.L + (lchWater.L - lch.L) * tBlend,
      C: Math.max(0, lch.C + (lchWater.C - lch.C) * tBlend),
      h: (lch.h + (((lchWater.h - lch.h + 540) % 360) - 180) * tBlend + 360) % 360,
    };
  }

  // Shoreline sand band around sea level (uses effective height)
  const beachCandidates =
    key === 'coast' ||
    key === 'beach' ||
    key === 'riverLake' ||
    key === 'mangrove' ||
    key === 'floodplain' ||
    key === 'coralReef';
  if (beachCandidates) {
    const dist = Math.abs(effHeight - 0.6);
    const band = Math.min(1, Math.max(0, 1 - dist / 2.2));
    const dryness = 1 - moisture;
    const flatness = 1 - Math.min(1, Math.max(0, slope));
    const sandBias = key === 'beach' ? 1.0 : 0.6;
    let sandT = Math.min(1, Math.max(0, band * flatness * sandBias * (0.6 + 0.4 * dryness)));
    sandT = Math.min(1, Math.max(0, sandT * shorelineSandStrength));
    if (sandT > 0) {
      const sandHex = SAND_PALETTE[clampHeight(Math.round(effHeight))];
      const lchSand = hexToOklch(sandHex);
      if (effHeight <= 0) {
        lchSand.L = Math.min(1, Math.max(0, lchSand.L - 0.06));
        lchSand.C *= 0.95;
      }
      lch = {
        L: lch.L + (lchSand.L - lch.L) * sandT,
        C: Math.max(0, lch.C + (lchSand.C - lch.C) * sandT),
        h: (lch.h + (((lchSand.h - lch.h + 540) % 360) - 180) * sandT + 360) % 360,
      };
    }
  }

  // Wetlands vs deserts (only if not “below sea”)
  if (!belowSea) {
    const isWetlandish =
      key === 'swamp' || key === 'wetlands' || key === 'mangrove' || key === 'floodplain';
    const isDesertish =
      key === 'desertHot' ||
      key === 'desertCold' ||
      key === 'sandDunes' ||
      key === 'saltFlats' ||
      key === 'thornscrub';
    if (isWetlandish) {
      lch.L = Math.min(1, Math.max(0, lch.L - 0.04 * moisture));
      lch.C = Math.max(0, lch.C - 0.05 * moisture);
    } else if (isDesertish) {
      lch.L = Math.min(1, Math.max(0, lch.L + 0.03 * (1 - moisture)));
      if (slope > 0.4) lch.h = (lch.h + (((250 - lch.h + 540) % 360) - 180) * 0.05 + 360) % 360;
    }
  }

  // Snow on cold families (use effHeight)
  const coldFamily =
    key === 'mountain' ||
    key === 'alpine' ||
    key === 'glacier' ||
    key === 'tundra' ||
    key === 'packIce' ||
    key === 'frozenLake';
  const SNOW_START = SNOW_START_BASE;
  if (coldFamily && effHeight >= SNOW_START && !belowSea) {
    const northness = Math.cos(aspectRad || 0);
    const slopeScour = Math.min(1, Math.max(0, slope));
    const snowBias = 0.5 * (1 + northness) * (1 - 0.6 * slopeScour);
    const snowT = Math.min(
      1,
      Math.max(0, ((effHeight - SNOW_START) / (MAX_H - SNOW_START || 1)) * (0.7 + 0.3 * snowBias))
    );
    lch.L = Math.min(1, Math.max(0, lch.L + 0.25 * snowT));
    lch.C = Math.max(0, lch.C - 0.35 * snowT);
  }

  return { color: oklchToHex(lch), fx: {} };
}

/**
 * NEW: Naturalistic, flowing color per tile.
 */
export function getBiomeColor(biomeKey, height, x, y, opts = {}) {
  const {
    moisture = 0.5,
    slope = 0.0,
    aspectRad = 0.0, // 0=N, π/2=E, π=S, 3π/2=W
    seed = 1337,
    mapFreq = 0.05,
    shorelineSandStrength = typeof window !== 'undefined' &&
    Number.isFinite(window?.richShadingSettings?.shorelineSandStrength)
      ? window.richShadingSettings.shorelineSandStrength
      : 1.0,
    // Shading intensity (0.0..1.5 typically). If not provided by caller, fall back to global UI state if available.
    intensity = typeof window !== 'undefined' &&
    Number.isFinite(window?.richShadingSettings?.intensity)
      ? window.richShadingSettings.intensity
      : 1.0,
  } = opts;

  const key = normalizeBiomeKey(biomeKey);
  const isSubterranean = SUBTERRANEAN_BIOMES.has(key);
  const h = clampHeight(Math.round(isSubterranean ? Math.min(height, -1) : height));

  // Base hex from our curated palette
  let basePalette = BIOME_HEIGHT_PALETTES[key];
  if (!basePalette && BIOME_STOP_MAP[key]) {
    basePalette = generateFromStops(BIOME_STOP_MAP[key]);
    BIOME_HEIGHT_PALETTES[key] = basePalette;
  }
  const baseHex = (basePalette && basePalette[h]) || getBiomeHeightColor(key, h);

  // Macro flow: gentle drift in L/C/h so colors flow across tiles
  const n = fbm2(x * mapFreq, y * mapFreq, seed); // 0..1
  const drift = n - 0.5;
  const driftL = clamp01(0.02 * drift);
  const driftC = 0.015 * drift;
  const driftH = 4 * drift;

  let lch = hexToOklch(baseHex);
  lch.L = clamp01(lch.L + driftL);
  lch.C = Math.max(0, lch.C + driftC);
  lch.h = (lch.h + driftH + 360) % 360;

  // Aspect-based light: warm south faces, cool north faces (subtle)
  if (!isSubterranean) {
    const northness = Math.cos(aspectRad || 0); // 1=N, -1=S
    const southness = -northness;
    lch.L = clamp01(lch.L + 0.02 * southness - 0.01 * (northness > 0 ? northness : 0));
    // tiny warm shift for sunlit faces
    lch.h = (lch.h + southness * -2) % 360; // negative => warmer
  }

  // Water implication below sea level
  const belowSea = height < 0;
  let waterBlend = 0;
  if (belowSea) {
    const depth = clamp01(Math.min(1, -height / (Math.abs(MIN_H) || 10)));
    const flatness = 1 - clamp01(slope);
    const wetness = clamp01(moisture);
    waterBlend = clamp01(depth * (0.6 * flatness + 0.4 * wetness)); // 0..1

    // Pick water family
    const waterKey =
      key === 'coast' || key === 'ocean' || key === 'coralReef'
        ? key
        : slope < 0.15
          ? 'riverLake'
          : 'coast';
    const shallowHex = getBiomeHeightColor(waterKey, Math.max(h, -2));
    const lchWater = hexToOklch(shallowHex);

    // Depth-based hue target (more cyan in shallows)
    if (waterKey === 'ocean' || waterKey === 'coast') {
      const hDeep = 220,
        hShal = 190;
      const t = clamp01(depth);
      const targetH = mixAngleDeg(hShal, hDeep, t);
      lchWater.h = targetH;
      lchWater.L = clamp01(lchWater.L - 0.18 * depth);
      lchWater.C = clamp01(lchWater.C + 0.03 * (1 - slope));
    } else {
      // river/lake tilt green in shallows
      const hDeep = 190,
        hShal = 155;
      const t = clamp01(depth);
      lchWater.h = mixAngleDeg(hShal, hDeep, t);
      lchWater.L = clamp01(lchWater.L - 0.12 * depth);
      lchWater.C = clamp01(lchWater.C + 0.04 * (1 - slope));
    }

    const tBlend = waterBlend * waterBlend;
    lch = lerpOklch(lch, lchWater, tBlend);
  }

  // Shoreline sand band for coast/beach/river banks (height ~ [-1 .. +2])
  const beachCandidates =
    key === 'coast' ||
    key === 'beach' ||
    key === 'riverLake' ||
    key === 'mangrove' ||
    key === 'floodplain' ||
    key === 'coralReef';
  if (beachCandidates) {
    const dist = Math.abs(height - 0.6); // center slightly above 0
    const band = clamp01(1 - dist / 2.2); // ~[-1.6..+2.8] effective
    const dryness = 1 - moisture;
    const flatness = 1 - clamp01(slope);
    const sandBias = key === 'beach' ? 1.0 : 0.6;
    let sandT = clamp01(band * flatness * sandBias * (0.6 + 0.4 * dryness));
    sandT = clamp01(sandT * shorelineSandStrength);
    // Guarantee a subtle sand presence near sea level for beach/coast
    const nearShore = height >= -1.5 && height <= 2.5;
    if (nearShore) {
      const basePresence =
        key === 'beach'
          ? height >= 0
            ? 0.18
            : 0.1
          : key === 'coast'
            ? height >= 0
              ? 0.1
              : 0.06
            : 0.0;
      const minPresence = clamp01(basePresence * shorelineSandStrength);
      sandT = Math.max(sandT, minPresence);
    }
    if (sandT > 0) {
      const sandHex = SAND_PALETTE[clampHeight(Math.round(height))];
      const lchSand = hexToOklch(sandHex);
      // wet sand darker near/below 0
      if (height <= 0) {
        lchSand.L = clamp01(lchSand.L - 0.06);
        lchSand.C *= 0.95;
      }
      const tS = sandT; // linear so it doesn’t overpower shallow water cyan
      lch = lerpOklch(lch, lchSand, tS);
    }
  }

  // Wetlands bogginess; deserts sun-bleach above sea
  if (!belowSea) {
    const isWetlandish =
      key === 'swamp' || key === 'wetlands' || key === 'mangrove' || key === 'floodplain';
    const isDesertish =
      key === 'desertHot' ||
      key === 'desertCold' ||
      key === 'sandDunes' ||
      key === 'saltFlats' ||
      key === 'thornscrub';
    if (isWetlandish) {
      lch.L = clamp01(lch.L - 0.04 * moisture);
      lch.C = Math.max(0, lch.C - 0.05 * moisture);
    } else if (isDesertish) {
      lch.L = clamp01(lch.L + 0.03 * (1 - moisture));
      // cool shadows a hair on steep slopes
      if (slope > 0.4) lch.h = mixAngleDeg(lch.h, 250, 0.05);
    }
  }

  // Aspect-aware snow (cold families)
  const coldFamily =
    key === 'mountain' ||
    key === 'alpine' ||
    key === 'glacier' ||
    key === 'tundra' ||
    key === 'packIce' ||
    key === 'frozenLake';
  const SNOW_START = SNOW_START_BASE;
  if (coldFamily && height >= SNOW_START && !belowSea) {
    const northness = Math.cos(aspectRad || 0);
    const slopeScour = clamp01(slope);
    const snowBias = 0.5 * (1 + northness) * (1 - 0.6 * slopeScour);
    const snowT = clamp01(
      ((height - SNOW_START) / (MAX_H - SNOW_START || 1)) * (0.7 + 0.3 * snowBias)
    );
    lch.L = clamp01(lch.L + 0.25 * snowT);
    lch.C = Math.max(0, lch.C - 0.35 * snowT);
  }

  // Apply intensity-driven contrast in OKLCH space.
  // - Push L away from mid-gray (0.5) by a scale proportional to (intensity-1)
  // - Amplify C to boost colorfulness; hue is preserved
  // Keeps edges/patterns stable since geometry/alpha are unchanged.
  if (Number.isFinite(intensity)) {
    const t = intensity - 1.0; // -1..+0.5 in normal UI ranges
    const lScale = Math.max(0, 1 + 0.65 * t);
    const cScale = Math.max(0, 1 + 0.85 * t);
    lch.L = clamp01(0.5 + (lch.L - 0.5) * lScale);
    lch.C = Math.max(0, lch.C * cScale);
  }

  const finalHex = oklchToHex(lch);

  // FX hints (optional)
  const fx = {};
  if (belowSea) {
    fx.caustics = clamp01((1 - slope) * (0.6 + 0.4 * moisture) * 0.9);
    fx.shimmer = clamp01(waterBlend * 0.8);
  } else if (key === 'swamp' || key === 'wetlands' || key === 'mangrove' || key === 'floodplain') {
    fx.fog = clamp01(0.2 + 0.5 * moisture);
    fx.mottle = clamp01(0.25 + 0.5 * (1 - slope));
  } else if (
    key === 'volcanic' ||
    key === 'ashWastes' ||
    key === 'obsidianPlain' ||
    key === 'lavaFields'
  ) {
    fx.embers = clamp01(0.15 + 0.35 * (1 - moisture));
    fx.grain = 0.2;
  } else if (coldFamily) {
    fx.crisp = clamp01(0.2 + 0.5 * slope);
  }

  return { color: finalHex, fx };
}

/** Convenience: hex color only (painterly). */
export function getBiomeColorHex(biomeKey, height, x = 0, y = 0, opts = {}) {
  // Special post-color adjustment for oasis: introduce lush green ring just above waterline
  if (biomeKey === 'oasis') {
    // Compute distance from center heuristically assuming square normalized coords using optional width/height if provided
    // If width/height unavailable, approximate center radius using x,y parity noise for subtle variation.
    const w = opts.mapWidth || 1;
    const hDim = opts.mapHeight || 1;
    let rx = 0.5,
      ry = 0.5;
    if (Number.isFinite(w) && Number.isFinite(hDim) && w > 0 && hDim > 0) {
      rx = (x + 0.5) / w;
      ry = (y + 0.5) / hDim;
    }
    const dx = rx - 0.5;
    const dy = ry - 0.5;
    const dist = Math.sqrt(dx * dx + dy * dy); // ~0 center to ~0.707 corner
    // Lush band region: just outside inner water bowl (~0.32-0.36 radius) up to ~0.45
    const lush = dist > 0.33 && dist < 0.46 && height > 0 && height < 1.5;
    if (lush) {
      // Temporarily sample normal color, then blend with a vibrant green accent
      const res = getBiomeColor(biomeKey, height, x, y, opts);
      const baseHex = res.color;
      // Vibrant palm green accent
      const accent = 0x2fae6b;
      const a = (baseHex & 0xff0000) >> 16;
      const b = (baseHex & 0x00ff00) >> 8;
      const c = baseHex & 0x0000ff;
      const aa = (accent & 0xff0000) >> 16;
      const ab = (accent & 0x00ff00) >> 8;
      const ac = accent & 0x0000ff;
      const t = 0.55; // blend factor
      const mix =
        ((Math.round(a + (aa - a) * t) & 0xff) << 16) |
        ((Math.round(b + (ab - b) * t) & 0xff) << 8) |
        (Math.round(c + (ac - c) * t) & 0xff);
      return mix;
    }
  }
  return getBiomeColor(biomeKey, height, x, y, opts).color;
}

/** Legacy helper: blend terrain base with biome tint (kept) */
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
