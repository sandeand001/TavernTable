// ColorUtils3D.js - lightweight brightness & saturation adjustments plus blending helper
// Avoids pulling in heavier 2D painterly pipeline; operates directly on hex ints.

function hexToRgb(hex) {
  return { r: (hex >> 16) & 0xff, g: (hex >> 8) & 0xff, b: hex & 0xff };
}
function rgbToHex(r, g, b) {
  return ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

export function adjustBrightnessSaturation(hex, brightnessScale = 1, saturationScale = 1) {
  const { r, g, b } = hexToRgb(hex);
  // Perceptual-ish luminance
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  // Saturation adjustment: move channel away from luminance
  const sr = lum + (r - lum) * saturationScale;
  const sg = lum + (g - lum) * saturationScale;
  const sb = lum + (b - lum) * saturationScale;
  // Brightness: scale distance from mid pivot (128) to preserve contrast
  const pivot = 128;
  const br = pivot + (sr - pivot) * brightnessScale;
  const bg = pivot + (sg - pivot) * brightnessScale;
  const bb = pivot + (sb - pivot) * brightnessScale;
  return rgbToHex(
    Math.max(0, Math.min(255, Math.round(br))),
    Math.max(0, Math.min(255, Math.round(bg))),
    Math.max(0, Math.min(255, Math.round(bb)))
  );
}

export function getLuminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  // sRGB relative luminance (approx, no gamma linearization for speed)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b; // 0..255
}

export function scaleToLuminance(hex, targetLum, clampFactor = 1.7) {
  const current = getLuminance(hex);
  if (current <= 0) return hex; // avoid division issues
  const factor = Math.min(clampFactor, targetLum / current);
  if (factor <= 1) return hex; // already bright enough
  const { r, g, b } = hexToRgb(hex);
  const nr = Math.min(255, Math.round(r * factor));
  const ng = Math.min(255, Math.round(g * factor));
  const nb = Math.min(255, Math.round(b * factor));
  return rgbToHex(nr, ng, nb);
}

export function blendHex(a, b, t) {
  if (t <= 0) return a;
  if (t >= 1) return b;
  const ar = (a >> 16) & 0xff,
    ag = (a >> 8) & 0xff,
    ab = a & 0xff;
  const br = (b >> 16) & 0xff,
    bg = (b >> 8) & 0xff,
    bb = b & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

export function applyPostAdjustments(baseHex, opts = {}) {
  const bScale = Number.isFinite(opts.brightnessScale) ? opts.brightnessScale : 1.0;
  const sScale = Number.isFinite(opts.saturationScale) ? opts.saturationScale : 1.0;
  if (bScale === 1 && sScale === 1) return baseHex;
  return adjustBrightnessSaturation(baseHex, bScale, sScale);
}

export default {
  adjustBrightnessSaturation,
  blendHex,
  applyPostAdjustments,
  getLuminance,
  scaleToLuminance,
};
