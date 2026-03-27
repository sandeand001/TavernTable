// NoisePrimitives.js — Hash, smooth noise, fbm, ridge noise for terrain generation.
// Extracted from BiomeElevationGenerator.js (Phase 8). Pure functions, no state.

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

export { hash2D, smoothNoise, fbm2, ridge, clamp, randFromSeed, radial, cliffBand };
