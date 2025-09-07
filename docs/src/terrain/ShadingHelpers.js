// ShadingHelpers.js — painterly tile shading utilities (extracted from TerrainCoordinator)
import { lightenColor, darkenColor } from '../utils/ColorUtils.js';

export function shadeRand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return (s & 0xffffffff) / 0x100000000;
  };
}

export function drawShadeDesertBands(
  container,
  baseColor,
  w,
  h,
  alpha,
  seed,
  density = 1.0,
  simplify = false
) {
  const rnd = shadeRand(seed);
  let bandCount = 2 + Math.floor(rnd() * 2);
  bandCount = Math.max(1, Math.round(bandCount * density));
  if (simplify) bandCount = Math.min(2, bandCount);
  for (let i = 0; i < bandCount; i++) {
    const t = (i + 1) / (bandCount + 1);
    const y = h * (0.2 + 0.6 * t + (rnd() - 0.5) * 0.04);
    const thickness = h * (0.08 + rnd() * 0.04) * (simplify ? 0.8 : 1);
    const c = lightenColor(baseColor, 0.1 + 0.1 * (t - 0.5));
    const g = new PIXI.Graphics();
    g.beginFill(c, alpha * 0.85);
    g.moveTo(0, y - thickness / 2);
    g.lineTo(w / 2, y - thickness);
    g.lineTo(w, y - thickness / 2);
    g.lineTo(w / 2, y + thickness);
    g.closePath();
    g.endFill();
    container.addChild(g);
  }
}

export function drawShadeForestDapples(
  container,
  baseColor,
  w,
  h,
  alpha,
  seed,
  density = 1.0,
  simplify = false
) {
  const rnd = shadeRand(seed);
  let spots = 4 + Math.floor(rnd() * 2);
  spots = Math.max(2, Math.round(spots * density));
  if (simplify) spots = Math.min(4, spots);
  for (let i = 0; i < spots; i++) {
    const cx = w * (0.2 + rnd() * 0.6);
    const cy = h * (0.25 + rnd() * 0.5);
    const rx = w * (0.07 + rnd() * 0.05) * (simplify ? 0.9 : 1);
    const ry = h * (0.05 + rnd() * 0.04) * (simplify ? 0.9 : 1);
    const c = i % 2 === 0 ? lightenColor(baseColor, 0.1) : darkenColor(baseColor, 0.1);
    const g = new PIXI.Graphics();
    g.beginFill(c, alpha * 0.9);
    g.drawEllipse(cx, cy, rx, ry);
    g.endFill();
    container.addChild(g);
  }
}

export function drawShadeSwampMottling(
  container,
  baseColor,
  w,
  h,
  alpha,
  seed,
  density = 1.0,
  simplify = false
) {
  const rnd = shadeRand(seed);
  let blobs = 3 + Math.floor(rnd() * 2);
  blobs = Math.max(2, Math.round(blobs * density));
  if (simplify) blobs = Math.min(3, blobs);
  for (let i = 0; i < blobs; i++) {
    const cx = w * (0.2 + rnd() * 0.6);
    const cy = h * (0.3 + rnd() * 0.4);
    const r = Math.min(w, h) * (0.06 + rnd() * 0.06) * (simplify ? 0.85 : 1);
    const g = new PIXI.Graphics();
    const shade = i % 2 === 0 ? darkenColor(baseColor, 0.16) : darkenColor(baseColor, 0.08);
    g.beginFill(shade, alpha * 0.8);
    g.drawCircle(cx, cy, r);
    g.endFill();
    container.addChild(g);
  }
}

export function drawShadeIcyFacets(
  container,
  baseColor,
  w,
  h,
  alpha,
  seed,
  density = 1.0,
  simplify = false
) {
  const rnd = shadeRand(seed);
  let facets = 2 + Math.floor(rnd() * 2);
  facets = Math.max(1, Math.round(facets * density));
  if (simplify) facets = Math.min(2, facets);
  const hi = lightenColor(baseColor, 0.16);
  const mid = lightenColor(baseColor, 0.05);
  const lo = darkenColor(baseColor, 0.09);
  const palette = [hi, mid, lo];
  for (let i = 0; i < facets; i++) {
    const g = new PIXI.Graphics();
    const c = palette[i % palette.length];
    g.beginFill(c, alpha);
    const x1 = w * (0.25 + rnd() * 0.5);
    const y1 = h * (0.15 + rnd() * 0.3);
    const x2 = w * (0.15 + rnd() * 0.7);
    const y2 = h * (0.5 + rnd() * 0.2);
    const x3 = w * (0.35 + rnd() * 0.4);
    const y3 = h * (0.7 + rnd() * 0.25);
    g.moveTo(x1, y1);
    g.lineTo(x2, y2);
    g.lineTo(x3, y3);
    g.closePath();
    g.endFill();
    container.addChild(g);
  }
}

export function drawShadeWaterWaves(
  container,
  baseColor,
  w,
  h,
  alpha,
  seed,
  coral = false,
  density = 1.0,
  simplify = false
) {
  const rnd = shadeRand(seed);
  let lanes = 2 + Math.floor(rnd() * 1);
  lanes = Math.max(1, Math.round(lanes * density));
  if (simplify) lanes = Math.min(2, lanes);
  for (let i = 0; i < lanes; i++) {
    const t = (i + 1) / (lanes + 1);
    const y = h * (0.2 + 0.6 * t + (rnd() - 0.5) * 0.04);
    const thickness = h * (0.05 + rnd() * 0.035) * (simplify ? 0.85 : 1);
    const c = lightenColor(baseColor, 0.1 + 0.06 * (0.5 - Math.abs(0.5 - t)));
    const g = new PIXI.Graphics();
    g.beginFill(c, alpha * 0.85);
    g.moveTo(0, y - thickness / 2);
    g.lineTo(w / 2, y - thickness * 0.9);
    g.lineTo(w, y - thickness / 2);
    g.lineTo(w / 2, y + thickness * 0.9);
    g.closePath();
    g.endFill();
    container.addChild(g);
  }
  if (coral && !simplify) {
    let spots = 4 + Math.floor(rnd() * 3);
    spots = Math.max(2, Math.round(spots * density));
    for (let i = 0; i < spots; i++) {
      const cx = w * (0.2 + rnd() * 0.6);
      const cy = h * (0.25 + rnd() * 0.5);
      const r = Math.min(w, h) * (0.02 + rnd() * 0.015);
      const pink = lightenColor(0xff6fa3, 0.15 * (rnd() - 0.5));
      const g = new PIXI.Graphics();
      g.beginFill(pink, Math.min(1, alpha + 0.05));
      g.drawCircle(cx, cy, r);
      g.endFill();
      container.addChild(g);
    }
  }
}

export function drawShadeVolcanicVeins(
  container,
  baseColor,
  w,
  h,
  alpha,
  seed,
  density = 1.0,
  simplify = false
) {
  const rnd = shadeRand(seed);
  let veins = 2 + Math.floor(rnd() * 1);
  veins = Math.max(1, Math.round(veins * density));
  if (simplify) veins = Math.min(2, veins);
  for (let i = 0; i < veins; i++) {
    const g = new PIXI.Graphics();
    g.lineStyle(2, lightenColor(0xff6a00, 0.1), Math.min(1, alpha + 0.1));
    const x0 = w * (0.15 + rnd() * 0.7);
    const y0 = h * (0.2 + rnd() * 0.6);
    const x1 = x0 + w * (0.15 * (rnd() - 0.5));
    const y1 = y0 + h * (0.25 * (rnd() - 0.5));
    const x2 = x1 + w * (0.2 * (rnd() - 0.5));
    const y2 = y1 + h * (0.3 * (rnd() - 0.5));
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.lineTo(x2, y2);
    container.addChild(g);
  }
}

export function drawShadeRuinGrid(
  container,
  baseColor,
  w,
  h,
  alpha,
  seed,
  density = 1.0,
  simplify = false
) {
  const g = new PIXI.Graphics();
  const lineC = darkenColor(baseColor, 0.22);
  g.lineStyle(1, lineC, alpha * 0.8);
  let rows = 3,
    cols = 3;
  rows = Math.max(2, Math.round(rows * density));
  cols = Math.max(2, Math.round(cols * density));
  if (simplify) {
    rows = Math.min(rows, 3);
    cols = Math.min(cols, 3);
  }
  for (let i = 1; i < rows; i++) {
    const ty = h * (i / rows);
    g.moveTo(w * 0.2, ty);
    g.lineTo(w * 0.8, ty);
  }
  for (let j = 1; j < cols; j++) {
    const tx = w * (j / cols);
    g.moveTo(tx, h * 0.2);
    g.lineTo(tx, h * 0.8);
  }
  container.addChild(g);
}
