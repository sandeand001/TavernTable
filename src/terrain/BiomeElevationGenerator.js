/**
 * BiomeElevationGenerator.js
 *
 * Purpose: When a biome is selected and the terrain hasn't been edited manually,
 * generate an evocative elevation field tailored to the biome.
 *
 * API:
 *  - generateBiomeElevationField(biomeKey, rows, cols, options?) -> number[][]
 *    options: {
 *      seed?: number,          // deterministic seed
 *      relief?: number,        // overall height magnitude multiplier (default varies by biome)
 *      roughness?: number,     // noise complexity multiplier (0.5..2 typical)
 *      waterBias?: number,     // pushes heights downward (negative) or upward (positive)
 *      orientation?: number,   // degrees for directional features (e.g., dunes)
 *    }
 *
 *  - isAllDefaultHeight(heightArray, defaultHeight?) -> boolean
 *  - applyBiomeElevationIfFlat(heightArray, biomeKey, options?) -> number[][]
 */

import { TERRAIN_CONFIG } from '../config/TerrainConstants.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';

// ------------------------
// Lightweight deterministic noise (fbm)
// ------------------------

function hash2D(x, y, seed = 1337) {
  const X = Math.sin(x * 127.1 + y * 311.7 + seed * 0.73) * 43758.5453;
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
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return (v00 * (1 - u) + v10 * u) * (1 - v) + (v01 * (1 - u) + v11 * u) * v;
}

function fbm2(x, y, seed = 1337, octaves = 4, lacunarity = 2.0, gain = 0.5) {
  let freq = 1.0;
  let amp = 0.5;
  let sum = 0.0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * smoothNoise(x * freq, y * freq, seed + i * 37);
    freq *= lacunarity;
    amp *= gain;
  }
  return sum; // in ~[0,1]
}

function ridge(x, y, seed = 1337, octaves = 5) {
  // Ridged multifractal feel for mountains
  let s = 0;
  let weight = 1;
  let freq = 0.9;
  for (let i = 0; i < octaves; i++) {
    const n = smoothNoise(x * freq, y * freq, seed + i * 101);
    const r = 1.0 - Math.abs(2.0 * n - 1.0); // peaked
    s += r * weight;
    weight *= 0.5;
    freq *= 2.15;
  }
  return s / (2 - Math.pow(0.5, octaves)); // normalize ~[0,1]
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
function mix(a, b, t) {
  return a + (b - a) * t;
}

// Deterministic PRNG helper for seeded variation
function randFromSeed(seed, k1 = 0, k2 = 0) {
  let h = (seed | 0) ^ 0x9e3779b9 ^ (k1 | 0) ^ ((k2 | 0) * 0x85ebca6b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x27d4eb2d);
  h ^= h >>> 15;
  h >>>= 0;
  return h / 4294967296; // [0,1)
}

// Shape helpers
function radial(nx, ny, seed, invert = false, scale = 1.0, bump = 0.0) {
  const cx = 0.5,
    cy = 0.5;
  const dx = nx - cx,
    dy = ny - cy;
  const d = Math.sqrt(dx * dx + dy * dy);
  const base = invert ? d : 1.0 - d;
  const n = fbm2(nx * 4.0, ny * 4.0, seed, 4, 2.0, 0.5) - 0.5;
  return base * scale + n * 0.4 + bump;
}

function cliffBand(nx, ny, seed, angleDeg = 0, width = 0.08) {
  const th = (angleDeg * Math.PI) / 180;
  const u = nx * Math.cos(th) + ny * Math.sin(th);
  const edge = Math.tanh((u - 0.5) / width); // sharp transition
  const noise = (fbm2(nx * 8, ny * 8, seed, 3, 2.1, 0.5) - 0.5) * 0.2;
  return edge + noise; // -1..1
}

// ------------------------
// Biome shaping recipes
// ------------------------

function shapeGrassland(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.5;
  const rough = clamp(opts.roughness ?? 1.0, 0.25, 3);
  const n = fbm2(nx * 2.2, ny * 2.2, seed, 4 + Math.round(rough), 1.9, 0.55);
  const h = (n - 0.5) * r; // gentle rolls
  return h;
}

function shapeHills(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 4.0;
  const rough = clamp(opts.roughness ?? 1.1, 0.25, 3);
  const base = fbm2(nx * 2.8, ny * 2.8, seed, 5 + Math.round(rough), 2.05, 0.5);
  const bumps = fbm2(nx * 9.0, ny * 9.0, seed + 999, 3, 2.2, 0.5) * 0.3;
  return (base - 0.5 + bumps) * r;
}

function shapeMountain(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 8.0; // bigger peaks
  const ridged = ridge(nx * 2.2, ny * 2.2, seed, 6);
  const valley = fbm2(nx * 0.7, ny * 0.7, seed + 123, 3, 2.0, 0.6);
  let h = (ridged * 1.1 - 0.55) * r; // center around 0
  h -= (valley - 0.5) * (r * 0.4); // carve valleys
  return h;
}

function shapeDesertHot(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 1.5; // largely flat with mild pans
  const n = fbm2(nx * 3.5, ny * 3.5, seed, 4, 2.2, 0.55);
  const pans = (n - 0.5) * r * 1.2;
  return pans + (opts.waterBias ?? 0); // can bias down to imply basins
}

function shapeSandDunes(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 3.0;
  const dirDeg =
    ((Number.isFinite(opts.orientation)
      ? opts.orientation
      : Math.floor(randFromSeed(seed, 13) * 360)) *
      Math.PI) /
    180;
  const dx = Math.cos(dirDeg),
    dy = Math.sin(dirDeg);
  // Project coords along dune direction to get waves; break up with fbm
  const wave = Math.sin((nx * dx + ny * dy) * 18.0 + seed * 0.001);
  const detail = fbm2(nx * 6.0, ny * 6.0, seed + 77, 4, 2.0, 0.5);
  return (wave * 0.6 + (detail - 0.5) * 0.7) * r;
}

function shapeWetlands(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.0;
  const depress = fbm2(nx * 2.0, ny * 2.0, seed, 4, 2.0, 0.55);
  // Bias negative to create soggy flats and pools
  return (depress - 0.65) * r - Math.abs(opts.waterBias ?? 1.0);
}

function shapeTundra(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 1.5;
  const low = fbm2(nx * 1.7, ny * 1.7, seed, 3, 2.0, 0.6);
  return (low - 0.5) * r;
}

function shapeCoast(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 3.5;
  // Oriented shoreline across axis t; default random by seed when not provided
  const theta = Number.isFinite(opts.orientation)
    ? (opts.orientation * Math.PI) / 180
    : randFromSeed(seed, 71) * Math.PI * 2;
  const ax = Math.cos(theta),
    ay = Math.sin(theta);
  const t = nx * ax + ny * ay; // projection
  const gradient = mix(-1.0, 1.0, t + 0.25);
  const n = fbm2(nx * 3.0, ny * 3.0, seed, 4, 2.0, 0.55) - 0.5;
  return (gradient * 0.9 + n * 0.7) * r;
}

function shapeRiverLake(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.5;
  // Meandering channel with seeded orientation
  const orient = randFromSeed(seed, 29) * Math.PI * 2;
  const u = nx * Math.cos(orient) + ny * Math.sin(orient);
  const v = -nx * Math.sin(orient) + ny * Math.cos(orient);
  const meander = Math.sin(u * 6.0 + Math.sin(v * 2.0 + seed * 0.01));
  const band = Math.exp(-Math.pow(meander * 1.2, 2) * 2.5); // 0..1 near channel center
  const base = (fbm2(nx * 2.2, ny * 2.2, seed, 4, 2.0, 0.55) - 0.5) * (r * 0.6);
  return base - band * (r * 1.2) - Math.abs(opts.waterBias ?? 0.8);
}

// -------------- Additional biome variants (lightweight compositions) --------------

function shapeForestTemperate(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 3.0, roughness: opts.roughness ?? 1.1 };
  return shapeHills(x, y, nx, ny, seed, o);
}

function shapeForestConifer(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 3.8, roughness: (opts.roughness ?? 1.2) + 0.2 };
  // slightly craggier than temperate
  return shapeHills(x, y, nx, ny, seed + 31, o);
}

function shapeSavanna(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 2.2, roughness: opts.roughness ?? 0.9 };
  return shapeGrassland(x, y, nx, ny, seed + 7, o);
}

function shapeSteppe(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 1.8, roughness: opts.roughness ?? 0.7 };
  return shapeGrassland(x, y, nx, ny, seed + 13, o);
}

function shapeDesertCold(x, y, nx, ny, seed, opts) {
  // cold desert: flats with pans, similar to tundra+desert
  const r = opts.relief ?? 1.2;
  const n = fbm2(nx * 2.5, ny * 2.5, seed, 3, 2.0, 0.55) - 0.5;
  return n * r + (opts.waterBias ?? -0.2);
}

function shapeOasis(x, y, nx, ny, seed, opts) {
  // desert with central depression (water) surrounded by slight rim
  const base = shapeDesertHot(x, y, nx, ny, seed, { ...opts, relief: opts.relief ?? 1.5 });
  const bowl = -radial(nx, ny, seed + 5, false, 1.0, 0.0); // negative in center
  return base + bowl * 1.2;
}

function shapeSaltFlats(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 0.8;
  const n = fbm2(nx * 6.0, ny * 6.0, seed + 91, 2, 2.0, 0.5) - 0.5; // fine micro undulations
  return n * r + (opts.waterBias ?? -0.3);
}

function shapeThornscrub(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 2.0, roughness: (opts.roughness ?? 1.0) + 0.2 };
  return shapeGrassland(x, y, nx, ny, seed + 23, o);
}

function shapeGlacier(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.8;
  const slope = cliffBand(nx, ny, seed, randFromSeed(seed, 2) * 180, 0.12);
  const smooth = fbm2(nx * 1.2, ny * 1.2, seed + 212, 3, 1.8, 0.6) - 0.5;
  return (slope * 0.7 + smooth * 0.3) * r;
}

function shapeFrozenLake(x, y, nx, ny, seed, opts) {
  const base = -Math.abs(radial(nx, ny, seed + 9, false, 1.1, 0.0));
  return base * (opts.relief ?? 2.0) - Math.abs(opts.waterBias ?? 0.6);
}

function shapePackIce(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 1.6;
  const cells = (Math.sin(nx * 22 + seed) + Math.sin(ny * 21 + seed * 0.7)) * 0.25;
  const noise = fbm2(nx * 4.0, ny * 4.0, seed + 44, 3, 2.0, 0.55) - 0.5;
  return (cells + noise * 0.5) * r;
}

function shapeScreeSlope(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 4.5;
  const ridgey = ridge(nx * 2.5, ny * 2.5, seed + 55, 5) - 0.5;
  const band = cliffBand(nx, ny, seed + 3, randFromSeed(seed, 17) * 180, 0.08);
  return (ridgey * 0.8 + band * 0.6) * r;
}

function shapeCedarHighlands(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 3.5 };
  return shapeHills(x, y, nx, ny, seed + 66, o);
}

function shapeGeyserBasin(x, y, nx, ny, seed, opts) {
  // rolling with random pits (vents)
  const base = shapeWetlands(x, y, nx, ny, seed, { ...opts, relief: opts.relief ?? 2.0 });
  const pits = fbm2(nx * 10.0, ny * 10.0, seed + 77, 2, 2.0, 0.5) - 0.4;
  return base - pits * 1.2;
}

function shapeFloodplain(x, y, nx, ny, seed, opts) {
  const base = shapeRiverLake(x, y, nx, ny, seed, { ...opts, relief: opts.relief ?? 2.0 });
  return base * 0.8; // gentler
}

function shapeBloodMarsh(x, y, nx, ny, seed, opts) {
  const base = shapeWetlands(x, y, nx, ny, seed + 88, { ...opts, relief: opts.relief ?? 2.2 });
  return base - 0.5; // deeper bogs
}

function shapeMangrove(x, y, nx, ny, seed, opts) {
  // coastal wetlands
  const coast = shapeCoast(x, y, nx, ny, seed, { ...opts, relief: opts.relief ?? 2.5 });
  const wet = shapeWetlands(x, y, nx, ny, seed + 99, { ...opts, relief: opts.relief ?? 2.0 });
  return coast * 0.6 + wet * 0.7;
}

function shapeOcean(x, y, nx, ny, seed, opts) {
  const bowl = -radial(nx, ny, seed + 111, false, 1.2, 0.0);
  const long = fbm2(nx * 1.1, ny * 1.1, seed + 112, 2, 2.0, 0.6) - 0.5;
  return (bowl * 1.2 + long * 0.3) * (opts.relief ?? 3.0) - Math.abs(opts.waterBias ?? 0.5);
}

function shapeCoralReef(x, y, nx, ny, seed, opts) {
  // shallow shelves with ridges
  const ring = radial(nx, ny, seed + 121, true, 1.0, 0.0); // high around edges
  const ridges = ridge(nx * 3.5, ny * 3.5, seed + 122, 4) - 0.5;
  return (ring * 0.8 + ridges * 0.6) * (opts.relief ?? 2.5);
}

function shapeDeadForest(x, y, nx, ny, seed, opts) {
  const base = shapeSteppe(x, y, nx, ny, seed + 131, { ...opts, relief: opts.relief ?? 1.7 });
  return base - 0.3;
}

function shapePetrifiedForest(x, y, nx, ny, seed, opts) {
  const h = shapeHills(x, y, nx, ny, seed + 141, { ...opts, relief: opts.relief ?? 3.2 });
  const cracks = cliffBand(nx, ny, seed + 142, 90, 0.06) + cliffBand(nx, ny, seed + 143, 0, 0.06);
  return h + cracks * 0.6;
}

function shapeBambooThicket(x, y, nx, ny, seed, opts) {
  // gentle longitudinal ridges
  const dir = randFromSeed(seed, 7) * 360;
  const dune = shapeSandDunes(x, y, nx, ny, seed + 151, {
    ...opts,
    relief: opts.relief ?? 2.2,
    orientation: dir,
  });
  return dune * 0.7;
}

function shapeOrchard(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 1.8;
  const grid = Math.sin(nx * 18 + seed * 0.01) * Math.sin(ny * 18 + seed * 0.013);
  const base = fbm2(nx * 2.0, ny * 2.0, seed + 161, 3, 2.0, 0.55) - 0.5;
  return (grid * 0.6 + base * 0.4) * r;
}

function shapeMysticGrove(x, y, nx, ny, seed, opts) {
  const humps =
    radial(nx, ny, seed + 171, true, 1.0, 0.0) +
    (fbm2(nx * 5.0, ny * 5.0, seed + 172, 3, 2.0, 0.5) - 0.5);
  return humps * (opts.relief ?? 2.4);
}

function shapeFeywildBloom(x, y, nx, ny, seed, opts) {
  const petals = Math.sin((nx - 0.5) * 16 + seed) * Math.cos((ny - 0.5) * 16 + seed * 0.5);
  const base = radial(nx, ny, seed + 181, true, 1.0, 0.0);
  return (base * 0.7 + petals * 0.3) * (opts.relief ?? 2.6);
}

function shapeShadowfellForest(x, y, nx, ny, seed, opts) {
  const bowl = -radial(nx, ny, seed + 191, false, 0.8, 0.0);
  const rough = fbm2(nx * 3.0, ny * 3.0, seed + 192, 3, 2.0, 0.6) - 0.5;
  return (bowl + rough * 0.5) * (opts.relief ?? 2.0);
}

function shapeCavern(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 3.0;
  const ceiling = -radial(nx, ny, seed + 201, false, 1.0, 0.0);
  const tunnels = Math.sin(nx * 10 + seed) * Math.cos(ny * 10 + seed * 0.7) * 0.3;
  return (ceiling + tunnels) * r - 0.4;
}

function shapeFungalGrove(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.2;
  const bumps = fbm2(nx * 6.0, ny * 6.0, seed + 211, 4, 2.0, 0.5) - 0.4;
  return bumps * r;
}

function shapeCrystalFields(x, y, nx, ny, seed, opts) {
  const spikes = ridge(nx * 4.0, ny * 4.0, seed + 221, 4) - 0.5;
  return spikes * (opts.relief ?? 3.0);
}

function shapeCrystalSpires(x, y, nx, ny, seed, opts) {
  const rid = ridge(nx * 6.0, ny * 6.0, seed + 231, 5) - 0.5;
  const center = radial(nx, ny, seed + 232, true, 0.8, 0.0);
  return (rid * 0.9 + center * 0.4) * (opts.relief ?? 4.0);
}

function shapeEldritchRift(x, y, nx, ny, seed, opts) {
  const band1 = cliffBand(nx, ny, seed + 241, randFromSeed(seed, 242) * 180, 0.05);
  const band2 = cliffBand(nx, ny, seed + 243, randFromSeed(seed, 244) * 180 + 90, 0.05);
  const base = fbm2(nx * 2.0, ny * 2.0, seed + 245, 3, 2.0, 0.6) - 0.5;
  return (band1 + band2 + base * 0.4) * (opts.relief ?? 3.5);
}

function shapeVolcanic(x, y, nx, ny, seed, opts) {
  const cone = radial(nx, ny, seed + 251, false, 1.2, 0.0); // high center cone
  const caldera = -Math.exp(-((nx - 0.5) ** 2 + (ny - 0.5) ** 2) * 40); // dip at center
  const lava = ridge(nx * 3.0, ny * 3.0, seed + 252, 4) - 0.5;
  return (cone + caldera * 1.5 + lava * 0.4) * (opts.relief ?? 5.0);
}

function shapeObsidianPlain(x, y, nx, ny, seed, opts) {
  const flat = fbm2(nx * 2.0, ny * 2.0, seed + 261, 2, 2.0, 0.55) - 0.5;
  const shards = ridge(nx * 6.0, ny * 6.0, seed + 262, 3) - 0.5;
  return (flat * 0.4 + shards * 0.3) * (opts.relief ?? 1.6);
}

function shapeAshWastes(x, y, nx, ny, seed, opts) {
  const dunes = shapeSandDunes(x, y, nx, ny, seed + 271, { ...opts, relief: opts.relief ?? 2.0 });
  return dunes * 0.7 - 0.4;
}

function shapeLavaFields(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.8;
  const flows =
    Math.sin(nx * 14 + seed) * 0.5 + (fbm2(nx * 3.5, ny * 3.5, seed + 281, 3, 2.0, 0.55) - 0.5);
  return flows * r + 0.3;
}

function shapeWasteland(x, y, nx, ny, seed, opts) {
  const rough = fbm2(nx * 3.0, ny * 3.0, seed + 291, 5, 2.1, 0.5) - 0.5;
  return rough * (opts.relief ?? 3.0) - 0.2;
}

function shapeRuinedUrban(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.0;
  const grid = (Math.sign(Math.sin(nx * 20)) + Math.sign(Math.cos(ny * 20))) * 0.2;
  const rubble = fbm2(nx * 5.0, ny * 5.0, seed + 301, 3, 2.0, 0.55) - 0.5;
  return (grid + rubble) * r;
}

function shapeGraveyard(x, y, nx, ny, seed, opts) {
  const hummocks = fbm2(nx * 6.0, ny * 6.0, seed + 311, 3, 2.0, 0.55) - 0.5;
  return hummocks * (opts.relief ?? 1.8) - 0.1;
}

function shapeAstralPlateau(x, y, nx, ny, seed, opts) {
  const plateau = radial(nx, ny, seed + 321, false, 1.0, 0.0);
  return plateau * (opts.relief ?? 3.0) + 0.5; // lifted
}

function shapeArcaneLeyNexus(x, y, nx, ny, seed, opts) {
  const bandA = cliffBand(nx, ny, seed + 331, 0, 0.04);
  const bandB = cliffBand(nx, ny, seed + 332, 90, 0.04);
  const base = fbm2(nx * 2.0, ny * 2.0, seed + 333, 2, 2.0, 0.6) - 0.5;
  return (bandA + bandB + base * 0.4) * (opts.relief ?? 3.2);
}

const RECIPE_INDEX = {
  grassland: shapeGrassland,
  hills: shapeHills,
  mountain: shapeMountain,
  alpine: shapeMountain,
  desertHot: shapeDesertHot,
  sandDunes: shapeSandDunes,
  wetlands: shapeWetlands,
  swamp: shapeWetlands,
  tundra: shapeTundra,
  coast: shapeCoast,
  riverLake: shapeRiverLake,
  // Forest & plains variants
  forestTemperate: shapeForestTemperate,
  forestConifer: shapeForestConifer,
  savanna: shapeSavanna,
  steppe: shapeSteppe,
  // Desert variants
  desertCold: shapeDesertCold,
  oasis: shapeOasis,
  saltFlats: shapeSaltFlats,
  thornscrub: shapeThornscrub,
  // Arctic
  glacier: shapeGlacier,
  frozenLake: shapeFrozenLake,
  packIce: shapePackIce,
  // Mountain
  screeSlope: shapeScreeSlope,
  cedarHighlands: shapeCedarHighlands,
  geyserBasin: shapeGeyserBasin,
  // Wetlands
  floodplain: shapeFloodplain,
  bloodMarsh: shapeBloodMarsh,
  mangrove: shapeMangrove,
  // Aquatic
  ocean: shapeOcean,
  coralReef: shapeCoralReef,
  // Forest variants
  deadForest: shapeDeadForest,
  petrifiedForest: shapePetrifiedForest,
  bambooThicket: shapeBambooThicket,
  orchard: shapeOrchard,
  mysticGrove: shapeMysticGrove,
  feywildBloom: shapeFeywildBloom,
  shadowfellForest: shapeShadowfellForest,
  // Underground
  cavern: shapeCavern,
  fungalGrove: shapeFungalGrove,
  crystalFields: shapeCrystalFields,
  crystalSpires: shapeCrystalSpires,
  eldritchRift: shapeEldritchRift,
  // Volcanic
  volcanic: shapeVolcanic,
  obsidianPlain: shapeObsidianPlain,
  ashWastes: shapeAshWastes,
  lavaFields: shapeLavaFields,
  // Wasteland
  wasteland: shapeWasteland,
  ruinedUrban: shapeRuinedUrban,
  graveyard: shapeGraveyard,
  // Exotic
  astralPlateau: shapeAstralPlateau,
  arcaneLeyNexus: shapeArcaneLeyNexus,
};

function pickRecipe(biomeKey) {
  return RECIPE_INDEX[biomeKey] || shapeGrassland;
}

// Desired maximum absolute elevation (in levels) per biome for better thematic variety.
// Values represent the target |height| amplitude, subject to perception scaling and config bounds.
const BIOME_AMPLITUDE_BY_KEY = {
  // Plains/grass
  grassland: 5,
  hills: 7,
  mountain: 10,
  alpine: 10,
  // Deserts
  desertHot: 3,
  sandDunes: 8,
  desertCold: 2,
  oasis: 3,
  saltFlats: 1,
  thornscrub: 3,
  // Wet/flat
  wetlands: 3,
  swamp: 3,
  floodplain: 3,
  bloodMarsh: 3,
  mangrove: 3,
  riverLake: 4,
  // Cold
  tundra: 2,
  glacier: 6,
  frozenLake: 3,
  packIce: 3,
  // Coasts/oceanic
  coast: 5,
  ocean: 5,
  coralReef: 6,
  // Forests & variants
  forestTemperate: 5,
  forestConifer: 6,
  savanna: 4,
  steppe: 3,
  deadForest: 3,
  petrifiedForest: 6,
  bambooThicket: 4,
  orchard: 3,
  mysticGrove: 4,
  feywildBloom: 5,
  shadowfellForest: 4,
  // Underground/oddities
  cavern: 5,
  fungalGrove: 4,
  crystalFields: 7,
  crystalSpires: 9,
  eldritchRift: 8,
  // Volcanic/wastes
  volcanic: 9,
  obsidianPlain: 3,
  ashWastes: 4,
  lavaFields: 6,
  wasteland: 5,
  ruinedUrban: 4,
  graveyard: 2,
  // Exotic
  astralPlateau: 7,
  arcaneLeyNexus: 8,
};

// Optional: per-biome post-process profiles to refine feel beyond amplitude alone.
// Fields:
// - minAmp, maxAmp: clamp the final target amplitude (levels)
// - smoothRadius, smoothIterations: small box blur before quantization
// - ridgePower: >1 sharpens relief (mountains); <1 softens (dunes/flats); 1 = no change
// - waterShift: constant level shift (negative for wetter biomes)
// - jumpPx: desired typical visual elevation jump between neighboring tiles in pixels; converted to a level step using current elevation unit
// - quantStep: fixed level step fallback if jumpPx not provided
const BIOME_ELEVATION_PROFILES = (() => {
  /** @type {Record<string, {minAmp?:number,maxAmp?:number,smoothRadius?:number,smoothIterations?:number,ridgePower?:number,waterShift?:number,quantStep?:number}>} */
  const p = {};

  // Helpers to assign multiple keys
  const set = (keys, cfg) => {
    keys.forEach((k) => {
      p[k] = { ...(p[k] || {}), ...cfg };
    });
  };

  // Very flat
  set(['saltFlats', 'frozenLake', 'obsidianPlain', 'ashWastes'], {
    minAmp: 1,
    maxAmp: 3,
    smoothRadius: 2,
    smoothIterations: 2,
    ridgePower: 0.95,
    jumpPx: 1.5,
  });

  // Rolling
  set(['grassland', 'savanna', 'steppe', 'orchard', 'tundra'], {
    minAmp: 3,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 1,
    ridgePower: 1.0,
    jumpPx: 2.5,
  });
  // Dunes: extra smooth
  set(['sandDunes'], {
    minAmp: 4,
    maxAmp: 7,
    smoothRadius: 2,
    smoothIterations: 2,
    ridgePower: 0.95,
    jumpPx: 2.0,
  });

  // Undulating/rugged forests
  set(['forestTemperate', 'forestConifer', 'wasteland', 'deadForest', 'bambooThicket'], {
    minAmp: 4,
    maxAmp: 7,
    smoothRadius: 1,
    smoothIterations: 1,
    ridgePower: 1.05,
    jumpPx: 3.5,
  });

  // Hilly
  set(['hills', 'cedarHighlands', 'petrifiedForest'], {
    minAmp: 6,
    maxAmp: 9,
    ridgePower: 1.12,
    jumpPx: 5.0,
  });

  // Mountainous
  set(['mountain', 'alpine', 'screeSlope', 'crystalSpires', 'volcanic'], {
    minAmp: 8,
    maxAmp: 10,
    ridgePower: 1.25,
    jumpPx: 10.0,
  });

  // Wet/lowland
  set(['wetlands', 'swamp', 'floodplain', 'mangrove', 'riverLake', 'geyserBasin', 'bloodMarsh'], {
    minAmp: 3,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 2,
    ridgePower: 0.98,
    waterShift: -1,
    jumpPx: 2.5,
  });

  // Aquatic
  set(['ocean'], {
    minAmp: 4,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 2,
    ridgePower: 1.0,
    waterShift: -2,
    jumpPx: 3.5,
  });
  set(['coralReef'], {
    minAmp: 5,
    maxAmp: 7,
    smoothRadius: 1,
    smoothIterations: 1,
    ridgePower: 1.12,
    waterShift: -1,
    jumpPx: 4.5,
  });

  // Cold
  set(['glacier'], { minAmp: 5, maxAmp: 7, ridgePower: 1.12, jumpPx: 6.0 });
  set(['packIce'], { minAmp: 4, maxAmp: 6, smoothRadius: 1, smoothIterations: 1, jumpPx: 3.5 });

  // Underground/exotic
  set(['cavern'], {
    minAmp: 4,
    maxAmp: 6,
    smoothRadius: 1,
    smoothIterations: 1,
    waterShift: -1,
    jumpPx: 3.0,
  });
  set(['fungalGrove'], { minAmp: 3, maxAmp: 5, smoothRadius: 1, smoothIterations: 1, jumpPx: 2.5 });
  set(['crystalFields'], { minAmp: 6, maxAmp: 8, ridgePower: 1.18, jumpPx: 6.0 });
  set(['eldritchRift'], { minAmp: 7, maxAmp: 9, ridgePower: 1.2, jumpPx: 7.0 });
  set(['astralPlateau'], { minAmp: 6, maxAmp: 8, ridgePower: 1.05, waterShift: 1, jumpPx: 4.0 });
  set(['arcaneLeyNexus'], { minAmp: 7, maxAmp: 9, ridgePower: 1.15, jumpPx: 6.5 });

  // Coasts
  set(['coast'], {
    minAmp: 4,
    maxAmp: 6,
    smoothRadius: 2,
    smoothIterations: 1,
    ridgePower: 1.0,
    waterShift: -1,
    jumpPx: 3.0,
  });

  // Defaults are permissive; missing keys will fall back gracefully.
  return p;
})();

function getProfileForBiome(biomeKey) {
  return BIOME_ELEVATION_PROFILES[biomeKey] || {};
}

// Small, separable-ish box blur for smoothing before quantization
function smoothHeightsInPlace(arr, rows, cols, radius = 1, iterations = 1) {
  if (!radius || radius <= 0 || !iterations || iterations <= 0) return;
  const tmp = TerrainHeightUtils.createHeightArray(rows, cols, 0);
  for (let it = 0; it < iterations; it++) {
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        let sum = 0,
          count = 0;
        const y0 = Math.max(0, y - radius),
          y1 = Math.min(rows - 1, y + radius);
        const x0 = Math.max(0, x - radius),
          x1 = Math.min(cols - 1, x + radius);
        for (let yy = y0; yy <= y1; yy++) {
          for (let xx = x0; xx <= x1; xx++) {
            sum += arr[yy][xx];
            count++;
          }
        }
        tmp[y][x] = count > 0 ? sum / count : arr[y][x];
      }
    }
    // copy back
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        arr[y][x] = tmp[y][x];
      }
    }
  }
}

function applyRidgePowerInPlace(arr, rows, cols, power = 1.0) {
  if (!power || power === 1) return;
  const p = Math.max(0.5, Math.min(2.0, power));
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = arr[y][x];
      const s = v >= 0 ? 1 : -1;
      const a = Math.abs(v);
      arr[y][x] = s * Math.pow(a, p);
    }
  }
}

// ------------------------
// Public API
// ------------------------

export function isAllDefaultHeight(heightArray, defaultHeight = TERRAIN_CONFIG.DEFAULT_HEIGHT) {
  if (!Array.isArray(heightArray) || heightArray.length === 0 || !Array.isArray(heightArray[0]))
    return false;
  for (let y = 0; y < heightArray.length; y++) {
    const row = heightArray[y];
    for (let x = 0; x < row.length; x++) {
      if (row[x] !== defaultHeight) return false;
    }
  }
  return true;
}

export function generateBiomeElevationField(biomeKey, rows, cols, options = {}) {
  const seed = Number.isFinite(options.seed)
    ? options.seed
    : Math.floor((options.seed || Date.now()) % 2147483647);
  const reliefMul = Number.isFinite(options.relief) ? options.relief : undefined;
  const roughness = Number.isFinite(options.roughness) ? options.roughness : undefined;
  const waterBias = Number.isFinite(options.waterBias) ? options.waterBias : undefined;
  const orientation = Number.isFinite(options.orientation) ? options.orientation : undefined;

  const recipe = pickRecipe(biomeKey);
  const profile = getProfileForBiome(biomeKey);

  // First pass: compute raw heights from the biome recipe (floating)
  const raw = TerrainHeightUtils.createHeightArray(rows, cols, 0);
  let minH = Infinity,
    maxH = -Infinity;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const nx = cols > 1 ? x / (cols - 1) : 0.5;
      const ny = rows > 1 ? y / (rows - 1) : 0.5;
      const h = recipe(x, y, nx, ny, seed, {
        relief: reliefMul,
        roughness,
        waterBias,
        orientation,
      });
      raw[y][x] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  // Determine scaling that preserves water bias (scale relative to 0, do NOT recenter on mean)
  const maxAbsRaw = Math.max(Math.abs(minH), Math.abs(maxH));

  const maxAbsLevel = Math.max(
    Math.abs(TERRAIN_CONFIG.MIN_HEIGHT),
    Math.abs(TERRAIN_CONFIG.MAX_HEIGHT)
  );
  // Biome-themed amplitude (in levels), only scaled by optional relief; perception affects quantization, not amplitude
  const biomeBase = BIOME_AMPLITUDE_BY_KEY[biomeKey] ?? Math.round(maxAbsLevel * 0.6);
  const reliefFactor = Number.isFinite(reliefMul) ? reliefMul : 1;
  let targetAmplitude = Math.max(1, Math.min(maxAbsLevel, Math.round(biomeBase * reliefFactor)));
  // Clamp by biome profile range if provided
  if (Number.isFinite(profile.minAmp)) targetAmplitude = Math.max(profile.minAmp, targetAmplitude);
  if (Number.isFinite(profile.maxAmp)) targetAmplitude = Math.min(profile.maxAmp, targetAmplitude);

  // Determine quantization step by desired visual jump size and current elevation unit
  const baseUnit = TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET || 8;
  const currentUnit = TerrainHeightUtils.getElevationUnit();
  const unitPx = currentUnit > 0 ? currentUnit : baseUnit;
  let step = TERRAIN_CONFIG.HEIGHT_STEP || 1;
  if (typeof profile.jumpPx === 'number' && profile.jumpPx > 0 && unitPx > 0) {
    const levelsPerJump = profile.jumpPx / unitPx; // levels that produce desired px jump
    // Round to at least 1 step and prefer multiples of base step
    const raw = Math.max(levelsPerJump, step);
    // Snap to nearest multiple of base step
    const mult = Math.max(1, Math.round(raw / step));
    step = mult * step;
  } else if (typeof profile.quantStep === 'number' && profile.quantStep > 0) {
    step = profile.quantStep;
  }
  const out = TerrainHeightUtils.createHeightArray(rows, cols, TERRAIN_CONFIG.DEFAULT_HEIGHT);

  if (!(maxAbsRaw > 1e-6)) {
    // Degenerate case: flat field from recipe; just return zeros (default height)
    return out;
  }

  // Work buffer for scaled floats prior to quantization
  const work = TerrainHeightUtils.createHeightArray(rows, cols, 0);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      // Scale relative to 0 to preserve net waterBias and absolute offsets from recipes
      work[y][x] = (raw[y][x] / maxAbsRaw) * targetAmplitude;
    }
  }

  // Optional smoothing for specific biomes to ensure rolling/flat feel
  if (
    profile.smoothRadius &&
    profile.smoothRadius > 0 &&
    profile.smoothIterations &&
    profile.smoothIterations > 0
  ) {
    smoothHeightsInPlace(work, rows, cols, profile.smoothRadius, profile.smoothIterations);
  }

  // Optional ridge/soften power curve
  if (profile.ridgePower && profile.ridgePower !== 1) {
    applyRidgePowerInPlace(work, rows, cols, profile.ridgePower);
  }

  // Optional water shift to bias below or above sea level (0)
  const shift = Number.isFinite(profile.waterShift) ? profile.waterShift : 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const v = work[y][x] + shift;
      const quantized = Math.round(v / step) * step;
      out[y][x] = TerrainHeightUtils.clampHeight(quantized);
    }
  }

  return out;
}

/**
 * If the provided height array is entirely at the default height (no manual edits),
 * return a new biome-shaped array. Otherwise, return a defensive copy of the original.
 */
export function applyBiomeElevationIfFlat(heightArray, biomeKey, options = {}) {
  if (!TerrainHeightUtils.isValidHeightArray(heightArray)) {
    return heightArray;
  }
  const rows = heightArray.length;
  const cols = heightArray[0].length;
  if (isAllDefaultHeight(heightArray, TERRAIN_CONFIG.DEFAULT_HEIGHT)) {
    return generateBiomeElevationField(biomeKey, rows, cols, options);
  }
  return TerrainHeightUtils.copyHeightArray(heightArray);
}

// Biome-specific default elevation perception (pixels per level) for UI slider.
// This does not force generation outcome by itself; it sets the runtime unit so
// visuals and quantization (which uses getElevationUnit) align with the biome.
const BIOME_UNIT_BY_KEY = {
  // Mountainous
  mountain: 12,
  alpine: 12,
  screeSlope: 12,
  crystalSpires: 12,
  volcanic: 12,
  // Hilly
  hills: 10,
  cedarHighlands: 10,
  petrifiedForest: 10,
  // Forest/rugged
  forestTemperate: 8,
  forestConifer: 8,
  wasteland: 8,
  deadForest: 8,
  bambooThicket: 8,
  // Rolling plains
  grassland: 6,
  savanna: 6,
  steppe: 6,
  orchard: 6,
  tundra: 6,
  // Dunes
  sandDunes: 6,
  // Very flat
  saltFlats: 5,
  frozenLake: 5,
  ashWastes: 5,
  obsidianPlain: 5,
  // Wet/coastal/riverine
  wetlands: 6,
  swamp: 6,
  floodplain: 6,
  mangrove: 6,
  riverLake: 6,
  geyserBasin: 6,
  bloodMarsh: 6,
  coast: 7,
  // Aquatic
  ocean: 7,
  coralReef: 8,
  // Arctic
  glacier: 9,
  packIce: 7,
  // Underground/exotic
  cavern: 7,
  fungalGrove: 6,
  crystalFields: 9,
  eldritchRift: 10,
  astralPlateau: 8,
  arcaneLeyNexus: 9,
};

export function getBiomeElevationScaleHint(biomeKey) {
  return BIOME_UNIT_BY_KEY[biomeKey] || TERRAIN_CONFIG.ELEVATION_SHADOW_OFFSET || 8;
}
