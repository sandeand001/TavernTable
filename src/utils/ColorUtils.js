/**
 * ColorUtils.js - Shared color manipulation helpers
 * Centralizes lighten/darken to reduce duplication and keep visuals consistent.
 */

/**
 * Lighten a hex color by blending toward white.
 * @param {number} color - 0xRRGGBB
 * @param {number} factor - 0..1 (0 = no change, 1 = white)
 * @returns {number}
 */
export function lightenColor(color, factor = 0.0) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  const newR = Math.min(255, Math.floor(r + (255 - r) * factor));
  const newG = Math.min(255, Math.floor(g + (255 - g) * factor));
  const newB = Math.min(255, Math.floor(b + (255 - b) * factor));

  return (newR << 16) | (newG << 8) | newB;
}

/**
 * Darken a hex color by scaling channels toward black.
 * @param {number} color - 0xRRGGBB
 * @param {number} factor - 0..1 (0 = no change, 1 = black)
 * @returns {number}
 */
export function darkenColor(color, factor = 0.0) {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;

  const newR = Math.max(0, Math.floor(r * (1 - factor)));
  const newG = Math.max(0, Math.floor(g * (1 - factor)));
  const newB = Math.max(0, Math.floor(b * (1 - factor)));

  return (newR << 16) | (newG << 8) | newB;
}
