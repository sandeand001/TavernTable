import { fbm2, ridge, clamp, randFromSeed, radial, cliffBand } from '../NoisePrimitives.js';

// ── Private Helpers (Biome Shapers) ─────────────────────────

function _shapeGrassland(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.5;
  const rough = clamp(opts.roughness ?? 1.0, 0.25, 3);
  const n = fbm2(nx * 2.2, ny * 2.2, seed, 4 + Math.round(rough), 1.9, 0.55);
  const h = (n - 0.5) * r; // gentle rolls
  return h;
}

function _shapeHills(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 4.0;
  const rough = clamp(opts.roughness ?? 1.1, 0.25, 3);
  const base = fbm2(nx * 2.8, ny * 2.8, seed, 5 + Math.round(rough), 2.05, 0.5);
  const bumps = fbm2(nx * 9.0, ny * 9.0, seed + 999, 3, 2.2, 0.5) * 0.3;
  return (base - 0.5 + bumps) * r;
}

function _shapeMountain(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 8.0; // bigger peaks
  const ridged = ridge(nx * 2.2, ny * 2.2, seed, 6);
  const valley = fbm2(nx * 0.7, ny * 0.7, seed + 123, 3, 2.0, 0.6);
  let h = (ridged * 1.1 - 0.55) * r; // center around 0
  h -= (valley - 0.5) * (r * 0.4); // carve valleys
  return h;
}

function _shapeDesertHot(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 1.5; // largely flat with mild pans
  const n = fbm2(nx * 3.5, ny * 3.5, seed, 4, 2.2, 0.55);
  const pans = (n - 0.5) * r * 1.2;
  return pans + (opts.waterBias ?? 0); // can bias down to imply basins
}

function _shapeSandDunes(x, y, nx, ny, seed, opts) {
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

function _shapeWetlands(x, y, nx, ny, seed, opts) {
  // Goal: patchy shallow pools with gentle slightly raised hummocks; ~55% water coverage.
  const r = opts.relief ?? 2.0;
  const base = fbm2(nx * 1.8, ny * 1.8, seed, 4, 2.0, 0.55); // broad low variations
  const micro = fbm2(nx * 5.5, ny * 5.5, seed + 17, 2, 2.1, 0.55); // small-scale mounds
  // Center base around 0, then depress most of it below 0 slightly
  let h = (base - 0.55) * (r * 0.9) - 0.25; // overall wet bias
  // Add soft mounds (positive bumps) so some tiles rise above water
  const hummock = Math.max(0, micro - 0.55) * 1.1; // only positive part
  h += hummock * 0.9; // gentle uplift
  // Additional seeded broad gradient to avoid uniform pools
  const grad = Math.sin((nx + seed * 0.0003) * Math.PI) * Math.sin((ny + seed * 0.0007) * Math.PI);
  h += grad * 0.15;
  // Water bias parameter (negative lowers water table); allow caller override
  const waterBias = opts.waterBias ?? -0.05;
  h += waterBias;
  return h;
}

function _shapeTundra(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 1.5;
  const low = fbm2(nx * 1.7, ny * 1.7, seed, 3, 2.0, 0.6);
  return (low - 0.5) * r;
}

function _shapeCoast(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 3.0;
  // Oriented shoreline axis; pick seeded orientation if not provided.
  const theta = Number.isFinite(opts.orientation)
    ? (opts.orientation * Math.PI) / 180
    : randFromSeed(seed, 71) * Math.PI * 2;
  const ax = Math.cos(theta);
  const ay = Math.sin(theta);
  // Signed distance along shoreline normal.
  const t = nx * ax + ny * ay; // ~0..1 across board projected onto axis
  // Recenter t around 0: t0 < 0 water side, t0 > 0 land side.
  const t0 = t - 0.5;
  // Base broad slope: push land positive, water negative.
  let slope = t0 * (r * 1.1);
  // Add moderate noise so coast line meanders but stays monotonic overall.
  const n = fbm2(nx * 2.5, ny * 2.5, seed, 3, 2.0, 0.55) - 0.5;
  slope += n * (r * 0.6);
  // Define a controlled shore transition band around height ~0 to avoid water->sand->water artifacts.
  // We'll remap a clamp of slope into a gentle S-curve near zero.
  const shoreWidth = 0.25; // distance band (in t0 units) around 0 for transition
  const dist = t0 / shoreWidth; // normalized distance from shoreline
  // Soft step shaping so only one crossing of 0 occurs.
  const soft = 0.5 + 0.5 * Math.tanh(dist * 1.5); // 0..1 across shore band
  // Compose final height: deep water side capped, land rises smoothly.
  // Negative side: allow some depth but clamp extremes.
  let h = 0;
  if (t0 < -shoreWidth) {
    // deeper water farther out
    h = slope * 0.6 - 0.4; // keep negative
  } else if (t0 > shoreWidth) {
    // inland: slope + mild uplift
    h = slope * 0.7 + 0.3;
  } else {
    // within shore band: interpolate between slightly negative and slightly positive sand shelf
    const shoreFloor = -0.12; // shallow water just before shore
    const shoreCrest = 0.18; // dry sand height
    h = shoreFloor + (shoreCrest - shoreFloor) * soft;
    // Light micro undulations only on sand side (soft > 0.5)
    if (soft > 0.5) {
      const micro = fbm2(nx * 6.0, ny * 6.0, seed + 311, 2, 2.0, 0.6) - 0.5;
      h += micro * 0.05 * (soft - 0.5) * 2; // fades in from shoreline
    }
  }
  // Ensure monotonic transition: clamp tiny accidental negatives just after crest.
  if (t0 > shoreWidth && h < 0.05) h = 0.05 + h * 0.25;
  return h;
}

function _shapeRiverLake(x, y, nx, ny, seed, opts) {
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

// ── Private Helpers (Biome Variant Shapers) ───────────────

function _shapeForestTemperate(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 3.0, roughness: opts.roughness ?? 1.1 };
  return _shapeHills(x, y, nx, ny, seed, o);
}

function _shapeForestConifer(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 3.8, roughness: (opts.roughness ?? 1.2) + 0.2 };
  // slightly craggier than temperate
  return _shapeHills(x, y, nx, ny, seed + 31, o);
}

function _shapeSavanna(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 2.2, roughness: opts.roughness ?? 0.9 };
  return _shapeGrassland(x, y, nx, ny, seed + 7, o);
}

function _shapeSteppe(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 1.8, roughness: opts.roughness ?? 0.7 };
  return _shapeGrassland(x, y, nx, ny, seed + 13, o);
}

function _shapeDesertCold(x, y, nx, ny, seed, opts) {
  // cold desert: flats with pans, similar to tundra+desert
  const r = opts.relief ?? 1.2;
  const n = fbm2(nx * 2.5, ny * 2.5, seed, 3, 2.0, 0.55) - 0.5;
  return n * r + (opts.waterBias ?? -0.2);
}

function _shapeOasis(x, y, nx, ny, seed, opts) {
  // Reworked oasis: single central pool (roughly circular) and predominantly dry sand elsewhere.
  // 1. Base desert floor (flattened) to keep dunes subtle.
  const desert = _shapeDesertHot(x, y, nx, ny, seed, { ...opts, relief: 0.8, roughness: 0.6 });
  const cx = nx - 0.5;
  const cy = ny - 0.5;
  const d = Math.sqrt(cx * cx + cy * cy);
  // 2. Fixed controlled pool radius (slightly jittered for variation) -> smaller than before.
  const jitter = (fbm2(nx * 4.0, ny * 4.0, seed + 502, 2, 2.0, 0.55) - 0.5) * 0.04;
  const radius = 0.22 + jitter; // ~0.20 - 0.24
  const rimRadius = radius * 1.15; // sand ring edge
  // 3. Water bowl depth curve (only inside radius).
  let bowl = 0;
  if (d < radius) {
    const t = d / radius;
    const inv = 1 - t * t * (3 - 2 * t); // smooth inverted step
    bowl = -inv * 1.2; // shallower than previous version
  }
  // 4. Sand uplift outside pool ensuring positive heights (dry). Gradual rise.
  let uplift = 0;
  if (d >= radius) {
    const t = Math.min(1, (d - radius) / (0.7 - radius));
    uplift = 0.38 + t * 0.25; // 0.38 .. 0.63
  }
  // 5. Rim accent (slight mound) just outside water for readable boundary.
  let rim = 0;
  if (d >= radius && d < rimRadius) {
    const rt = (d - radius) / (rimRadius - radius);
    rim = Math.sin(rt * Math.PI) * 0.18;
  }
  // 6. Fine sand ripples only outside pool.
  let ripples = 0;
  if (d >= radius) {
    const micro = fbm2(nx * 10.0, ny * 10.0, seed + 503, 2, 2.0, 0.55) - 0.5;
    ripples = micro * 0.06;
  }
  // 7. Compose final height. Force dryness (>=0.05) outside water bowl.
  let h = desert * 0.3 + bowl + uplift + rim + ripples;
  if (d >= radius && h < 0.05) h = 0.05 + h * 0.2;
  // Ensure bowl remains negative; cap shallows.
  if (d < radius && h > -0.02) h = -0.02;
  return h;
}

function _shapeSaltFlats(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 0.8;
  const n = fbm2(nx * 6.0, ny * 6.0, seed + 91, 2, 2.0, 0.5) - 0.5; // fine micro undulations
  return n * r + (opts.waterBias ?? -0.3);
}

function _shapeThornscrub(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 2.0, roughness: (opts.roughness ?? 1.0) + 0.2 };
  return _shapeGrassland(x, y, nx, ny, seed + 23, o);
}

function _shapeGlacier(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.8;
  const slope = cliffBand(nx, ny, seed, randFromSeed(seed, 2) * 180, 0.12);
  const smooth = fbm2(nx * 1.2, ny * 1.2, seed + 212, 3, 1.8, 0.6) - 0.5;
  return (slope * 0.7 + smooth * 0.3) * r;
}

function _shapeFrozenLake(x, y, nx, ny, seed, opts) {
  const base = -Math.abs(radial(nx, ny, seed + 9, false, 1.1, 0.0));
  return base * (opts.relief ?? 2.0) - Math.abs(opts.waterBias ?? 0.6);
}

function _shapePackIce(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 1.6;
  const cells = (Math.sin(nx * 22 + seed) + Math.sin(ny * 21 + seed * 0.7)) * 0.25;
  const noise = fbm2(nx * 4.0, ny * 4.0, seed + 44, 3, 2.0, 0.55) - 0.5;
  return (cells + noise * 0.5) * r;
}

function _shapeScreeSlope(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 4.5;
  const ridgey = ridge(nx * 2.5, ny * 2.5, seed + 55, 5) - 0.5;
  const band = cliffBand(nx, ny, seed + 3, randFromSeed(seed, 17) * 180, 0.08);
  return (ridgey * 0.8 + band * 0.6) * r;
}

function _shapeCedarHighlands(x, y, nx, ny, seed, opts) {
  const o = { ...opts, relief: opts.relief ?? 3.5 };
  return _shapeHills(x, y, nx, ny, seed + 66, o);
}

function _shapeGeyserBasin(x, y, nx, ny, seed, opts) {
  // rolling with random pits (vents)
  const base = _shapeWetlands(x, y, nx, ny, seed, { ...opts, relief: opts.relief ?? 2.0 });
  const pits = fbm2(nx * 10.0, ny * 10.0, seed + 77, 2, 2.0, 0.5) - 0.4;
  return base - pits * 1.2;
}

function _shapeFloodplain(x, y, nx, ny, seed, opts) {
  const base = _shapeRiverLake(x, y, nx, ny, seed, { ...opts, relief: opts.relief ?? 2.0 });
  return base * 0.8; // gentler
}

function _shapeBloodMarsh(x, y, nx, ny, seed, opts) {
  const base = _shapeWetlands(x, y, nx, ny, seed + 88, { ...opts, relief: opts.relief ?? 2.2 });
  return base - 0.5; // deeper bogs
}

function _shapeMangrove(x, y, nx, ny, seed, opts) {
  // coastal wetlands
  const coast = _shapeCoast(x, y, nx, ny, seed, { ...opts, relief: opts.relief ?? 2.5 });
  const wet = _shapeWetlands(x, y, nx, ny, seed + 99, { ...opts, relief: opts.relief ?? 2.0 });
  return coast * 0.6 + wet * 0.7;
}

function _shapeOcean(x, y, nx, ny, seed, opts) {
  const bowl = -radial(nx, ny, seed + 111, false, 1.2, 0.0);
  const long = fbm2(nx * 1.1, ny * 1.1, seed + 112, 2, 2.0, 0.6) - 0.5;
  return (bowl * 1.2 + long * 0.3) * (opts.relief ?? 3.0) - Math.abs(opts.waterBias ?? 0.5);
}

function _shapeCoralReef(x, y, nx, ny, seed, opts) {
  // shallow shelves with ridges
  const ring = radial(nx, ny, seed + 121, true, 1.0, 0.0); // high around edges
  const ridges = ridge(nx * 3.5, ny * 3.5, seed + 122, 4) - 0.5;
  return (ring * 0.8 + ridges * 0.6) * (opts.relief ?? 2.5);
}

function _shapeDeadForest(x, y, nx, ny, seed, opts) {
  const base = _shapeSteppe(x, y, nx, ny, seed + 131, { ...opts, relief: opts.relief ?? 1.7 });
  return base - 0.3;
}

function _shapePetrifiedForest(x, y, nx, ny, seed, opts) {
  const h = _shapeHills(x, y, nx, ny, seed + 141, { ...opts, relief: opts.relief ?? 3.2 });
  const cracks = cliffBand(nx, ny, seed + 142, 90, 0.06) + cliffBand(nx, ny, seed + 143, 0, 0.06);
  return h + cracks * 0.6;
}

function _shapeBambooThicket(x, y, nx, ny, seed, opts) {
  // gentle longitudinal ridges
  const dir = randFromSeed(seed, 7) * 360;
  const dune = _shapeSandDunes(x, y, nx, ny, seed + 151, {
    ...opts,
    relief: opts.relief ?? 2.2,
    orientation: dir,
  });
  return dune * 0.7;
}

function _shapeOrchard(x, y, nx, ny, seed) {
  // Orchard: intentionally near-flat to showcase regular planting rows.
  // Replace previous noisy grid interference with a gentle single-axis tilt plus subtle micro-variation.
  // Target variance < ~0.25. Relief scaling kept minimal regardless of opts.relief to preserve flatness.
  const tiltAxis = seed % 2 === 0 ? 'x' : 'y';
  const tilt = tiltAxis === 'x' ? (nx - 0.5) * 0.15 : (ny - 0.5) * 0.15; // gentle gradient
  const micro = (fbm2(nx * 6.0, ny * 6.0, seed + 161, 2, 2.0, 0.55) - 0.5) * 0.12; // small ripples
  const base = 0.4; // elevated slightly above waterline
  return base + tilt + micro; // typically ~0.3..0.5 range
}

function _shapeMysticGrove(x, y, nx, ny, seed, opts) {
  const humps =
    radial(nx, ny, seed + 171, true, 1.0, 0.0) +
    (fbm2(nx * 5.0, ny * 5.0, seed + 172, 3, 2.0, 0.5) - 0.5);
  return humps * (opts.relief ?? 2.4);
}

function _shapeFeywildBloom(x, y, nx, ny, seed, opts) {
  const petals = Math.sin((nx - 0.5) * 16 + seed) * Math.cos((ny - 0.5) * 16 + seed * 0.5);
  const base = radial(nx, ny, seed + 181, true, 1.0, 0.0);
  return (base * 0.7 + petals * 0.3) * (opts.relief ?? 2.6);
}

function _shapeShadowfellForest(x, y, nx, ny, seed, opts) {
  const bowl = -radial(nx, ny, seed + 191, false, 0.8, 0.0);
  const rough = fbm2(nx * 3.0, ny * 3.0, seed + 192, 3, 2.0, 0.6) - 0.5;
  return (bowl + rough * 0.5) * (opts.relief ?? 2.0);
}

function _shapeCavern(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 3.0;
  const ceiling = -radial(nx, ny, seed + 201, false, 1.0, 0.0);
  const tunnels = Math.sin(nx * 10 + seed) * Math.cos(ny * 10 + seed * 0.7) * 0.3;
  return (ceiling + tunnels) * r - 0.4;
}

function _shapeFungalGrove(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.2;
  const bumps = fbm2(nx * 6.0, ny * 6.0, seed + 211, 4, 2.0, 0.5) - 0.4;
  return bumps * r;
}

function _shapeCrystalFields(x, y, nx, ny, seed, opts) {
  const spikes = ridge(nx * 4.0, ny * 4.0, seed + 221, 4) - 0.5;
  return spikes * (opts.relief ?? 3.0);
}

function _shapeCrystalSpires(x, y, nx, ny, seed, opts) {
  const rid = ridge(nx * 6.0, ny * 6.0, seed + 231, 5) - 0.5;
  const center = radial(nx, ny, seed + 232, true, 0.8, 0.0);
  return (rid * 0.9 + center * 0.4) * (opts.relief ?? 4.0);
}

function _shapeEldritchRift(x, y, nx, ny, seed, opts) {
  const band1 = cliffBand(nx, ny, seed + 241, randFromSeed(seed, 242) * 180, 0.05);
  const band2 = cliffBand(nx, ny, seed + 243, randFromSeed(seed, 244) * 180 + 90, 0.05);
  const base = fbm2(nx * 2.0, ny * 2.0, seed + 245, 3, 2.0, 0.6) - 0.5;
  return (band1 + band2 + base * 0.4) * (opts.relief ?? 3.5);
}

function _shapeVolcanic(x, y, nx, ny, seed, opts) {
  const cone = radial(nx, ny, seed + 251, false, 1.2, 0.0); // high center cone
  const caldera = -Math.exp(-((nx - 0.5) ** 2 + (ny - 0.5) ** 2) * 40); // dip at center
  const lava = ridge(nx * 3.0, ny * 3.0, seed + 252, 4) - 0.5;
  return (cone + caldera * 1.5 + lava * 0.4) * (opts.relief ?? 5.0);
}

function _shapeObsidianPlain(x, y, nx, ny, seed, opts) {
  const flat = fbm2(nx * 2.0, ny * 2.0, seed + 261, 2, 2.0, 0.55) - 0.5;
  const shards = ridge(nx * 6.0, ny * 6.0, seed + 262, 3) - 0.5;
  return (flat * 0.4 + shards * 0.3) * (opts.relief ?? 1.6);
}

function _shapeAshWastes(x, y, nx, ny, seed, opts) {
  const dunes = _shapeSandDunes(x, y, nx, ny, seed + 271, { ...opts, relief: opts.relief ?? 2.0 });
  return dunes * 0.7 - 0.4;
}

function _shapeLavaFields(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.8;
  const flows =
    Math.sin(nx * 14 + seed) * 0.5 + (fbm2(nx * 3.5, ny * 3.5, seed + 281, 3, 2.0, 0.55) - 0.5);
  return flows * r + 0.3;
}

function _shapeWasteland(x, y, nx, ny, seed, opts) {
  const rough = fbm2(nx * 3.0, ny * 3.0, seed + 291, 5, 2.1, 0.5) - 0.5;
  return rough * (opts.relief ?? 3.0) - 0.2;
}

function _shapeRuinedUrban(x, y, nx, ny, seed, opts) {
  const r = opts.relief ?? 2.0;
  const grid = (Math.sign(Math.sin(nx * 20)) + Math.sign(Math.cos(ny * 20))) * 0.2;
  const rubble = fbm2(nx * 5.0, ny * 5.0, seed + 301, 3, 2.0, 0.55) - 0.5;
  return (grid + rubble) * r;
}

function _shapeGraveyard(x, y, nx, ny, seed, opts) {
  const hummocks = fbm2(nx * 6.0, ny * 6.0, seed + 311, 3, 2.0, 0.55) - 0.5;
  return hummocks * (opts.relief ?? 1.8) - 0.1;
}

function _shapeAstralPlateau(x, y, nx, ny, seed, opts) {
  const plateau = radial(nx, ny, seed + 321, false, 1.0, 0.0);
  return plateau * (opts.relief ?? 3.0) + 0.5; // lifted
}

function _shapeArcaneLeyNexus(x, y, nx, ny, seed, opts) {
  const bandA = cliffBand(nx, ny, seed + 331, 0, 0.04);
  const bandB = cliffBand(nx, ny, seed + 332, 90, 0.04);
  const base = fbm2(nx * 2.0, ny * 2.0, seed + 333, 2, 2.0, 0.6) - 0.5;
  return (bandA + bandB + base * 0.4) * (opts.relief ?? 3.2);
}

// ── Constants ───────────────────────────────────────────────

const RECIPE_INDEX = {
  grassland: _shapeGrassland,
  hills: _shapeHills,
  mountain: _shapeMountain,
  alpine: _shapeMountain,
  desertHot: _shapeDesertHot,
  sandDunes: _shapeSandDunes,
  wetlands: _shapeWetlands,
  swamp: _shapeWetlands,
  tundra: _shapeTundra,
  coast: _shapeCoast,
  riverLake: _shapeRiverLake,
  // Forest & plains variants
  forestTemperate: _shapeForestTemperate,
  forestConifer: _shapeForestConifer,
  savanna: _shapeSavanna,
  steppe: _shapeSteppe,
  // Desert variants
  desertCold: _shapeDesertCold,
  oasis: _shapeOasis,
  saltFlats: _shapeSaltFlats,
  thornscrub: _shapeThornscrub,
  // Arctic
  glacier: _shapeGlacier,
  frozenLake: _shapeFrozenLake,
  packIce: _shapePackIce,
  // Mountain
  screeSlope: _shapeScreeSlope,
  cedarHighlands: _shapeCedarHighlands,
  geyserBasin: _shapeGeyserBasin,
  // Wetlands
  floodplain: _shapeFloodplain,
  bloodMarsh: _shapeBloodMarsh,
  mangrove: _shapeMangrove,
  // Aquatic
  ocean: _shapeOcean,
  coralReef: _shapeCoralReef,
  // Forest variants
  deadForest: _shapeDeadForest,
  petrifiedForest: _shapePetrifiedForest,
  bambooThicket: _shapeBambooThicket,
  orchard: _shapeOrchard,
  mysticGrove: _shapeMysticGrove,
  feywildBloom: _shapeFeywildBloom,
  shadowfellForest: _shapeShadowfellForest,
  // Underground
  cavern: _shapeCavern,
  fungalGrove: _shapeFungalGrove,
  crystalFields: _shapeCrystalFields,
  crystalSpires: _shapeCrystalSpires,
  eldritchRift: _shapeEldritchRift,
  // Volcanic
  volcanic: _shapeVolcanic,
  obsidianPlain: _shapeObsidianPlain,
  ashWastes: _shapeAshWastes,
  lavaFields: _shapeLavaFields,
  // Wasteland
  wasteland: _shapeWasteland,
  ruinedUrban: _shapeRuinedUrban,
  graveyard: _shapeGraveyard,
  // Exotic
  astralPlateau: _shapeAstralPlateau,
  arcaneLeyNexus: _shapeArcaneLeyNexus,
};

export function pickRecipe(biomeKey) {
  return RECIPE_INDEX[biomeKey] || _shapeGrassland;
}
