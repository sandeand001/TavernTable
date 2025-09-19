/**
 * SeededRNG.js - lightweight deterministic PRNG utilities (xorshift32 style)
 * Used for terrain generation, flora placement, and any feature requiring reproducibility.
 */
export function createSeededRNG(seed, salt = 0) {
  // Mix seed & salt into 32-bit state (avoid zero)
  let s = (seed ^ (0x9e3779b9 + (salt << 6) + (salt >> 2))) >>> 0;
  if (s === 0) s = 0x1a2b3c4d;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000; // [0,1)
  };
}

export function rngInt(rng, max) {
  return Math.floor(rng() * max);
}

export function rngPick(rng, arr) {
  if (!arr || !arr.length) return undefined;
  return arr[rngInt(rng, arr.length)];
}

export function makeWeightedPicker(weights, rng) {
  const entries = Object.entries(weights || {});
  const total = entries.reduce((a, [, w]) => a + w, 0) || 1;
  return () => {
    let r = rng() * total;
    for (const [id, w] of entries) {
      r -= w;
      if (r <= 0) return id;
    }
    return entries.length ? entries[entries.length - 1][0] : undefined;
  };
}

export default { createSeededRNG, rngInt, rngPick, makeWeightedPicker };
