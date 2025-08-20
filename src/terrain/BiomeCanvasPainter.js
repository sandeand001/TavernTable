/**
 * BiomeCanvasPainter.js
 * ------------------------------------------------------
 * Paints a continuous, painterly biome canvas that ignores tile boundaries
 * while responding to elevation. Renders into an HTMLCanvasElement and uses
 * it as a PIXI texture for efficient display.
 */

import { getBiomeColorHex } from '../config/BiomePalettes.js';
import { shadeMul as _sharedShadeMul } from '../utils/ColorUtils.js';
import { TerrainHeightUtils } from '../utils/TerrainHeightUtils.js';
import { styleForBiome } from './biome-painter/style.js';
import { strokeBlob as motifStrokeBlob, strokeRibbon as motifStrokeRibbon, globalStriations as motifGlobalStriations, globalCracks as motifGlobalCracks, scatterBlobsGlobal as motifScatterBlobsGlobal, scatterTuftsGlobal as motifScatterTuftsGlobal } from './biome-painter/motifs.js';
import { computeSlopeAspect, computeMoistureField } from './biome-painter/fields.js';
import { traceDiamondFacePath2D } from '../utils/CanvasShapeUtils.js';

export class BiomeCanvasPainter {
  constructor(gameManager) {
    this.gameManager = gameManager;
    // Per-depth band layers so paint sits on the topmost faces in draw order
    // Map<depth:number, { canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, sprite: PIXI.Sprite }>
    this.layers = new Map();
    this.bounds = null; // { minX, minY, maxX, maxY, width, height }
    // Seed for spatial noise to keep patterns semi-stable
    this._seed = Math.floor((typeof window !== 'undefined' && Number.isFinite(window?.richShadingSettings?.seed))
      ? (window.richShadingSettings.seed >>> 0)
      : (Math.random() * 1e9)) >>> 0;
  }
  /** Optionally set a deterministic seed so palette noise and strokes are coherent across systems. */
  setSeed(seed) {
    if (Number.isFinite(seed)) this._seed = (seed >>> 0);
  }
  _hex(colorInt) {
    const u = (colorInt >>> 0) & 0xFFFFFF;
    return `#${u.toString(16).padStart(6, '0')}`;
  }

  /** Deterministic PRNG in [0,1) seeded from painter seed and integer keys. */
  _randU(k1 = 0, k2 = 0, k3 = 0) {
    // Convert floats to ints if needed
    const toInt = (v) => {
      if (typeof v === 'number') return (Math.fround(v) * 2654435761) | 0;
      if (typeof v === 'string') {
        let h = 2166136261;
        for (let i = 0; i < v.length; i++) { h ^= v.charCodeAt(i); h = Math.imul(h, 16777619); }
        return h | 0;
      }
      return 0;
    };
    let h = (this._seed | 0) ^ 0x9e3779b9;
    h ^= toInt(k1); h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
    h ^= toInt(k2); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    h ^= toInt(k3); h ^= (h >>> 16);
    // Final scramble
    h = Math.imul(h, 0x27d4eb2d);
    h ^= h >>> 15;
    return ((h >>> 0) / 4294967296);
  }

  // ========================= TERRAIN FIELD HELPERS =========================
  // field helpers moved to biome-painter/fields.js

  /** Compute a representative orientation for a depth band, weighted by slope and optional predicate. */
  _bandOrientationForDepth(d, heights, slope, aspect, predicateFn = null, slopeGain = 1.0) {
    const cols = this.gameManager.cols;
    const rows = this.gameManager.rows;
    let vx = 0, vy = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if ((x + y) !== d) continue;
        if (typeof predicateFn === 'function' && !predicateFn(x, y)) continue;
        const sRaw = slope[y][x] || 0;
        // Normalize slope roughly to [0..1] then apply gain to emphasize relief
        const sNorm = Math.max(0, Math.min(1, sRaw * 1.5));
        const s = Math.pow(sNorm, Math.max(0.1, slopeGain));
        const a = aspect[y][x] || 0;
        const w = Math.min(1.0, Math.max(0, s));
        vx += Math.cos(a) * w;
        vy += Math.sin(a) * w;
      }
    }
    return Math.atan2(vy, vx);
  }

  /** Average a scalar field over tiles at depth band d, optionally filtered. */
  _bandAverage(field, d, predicateFn = null) {
    const cols = this.gameManager.cols;
    const rows = this.gameManager.rows;
    let sum = 0;
    let count = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if ((x + y) !== d) continue;
        if (typeof predicateFn === 'function' && !predicateFn(x, y)) continue;
        const v = Number.isFinite(field?.[y]?.[x]) ? field[y][x] : 0;
        sum += v;
        count++;
      }
    }
    return count > 0 ? (sum / count) : 0;
  }

  /** Sample a per-tile field at canvas pixel coordinates by nearest tile. */
  _sampleFieldAtCanvas(field, px, py, bounds) {
    const w = this.gameManager.tileWidth;
    const h = this.gameManager.tileHeight;
    const cols = this.gameManager.cols;
    const rows = this.gameManager.rows;
    // Convert canvas px to isometric tile coordinates (approximate inverse)
    const Xp = px + (bounds?.minX ?? 0) - (w / 2);
    const Yp = py + (bounds?.minY ?? 0) - (h / 2);
    const A = (2 * Xp) / w; // x - y
    const B = (2 * Yp) / h; // x + y
    let gx = Math.round((A + B) * 0.5);
    let gy = Math.round((B - A) * 0.5);
    // Clamp to grid
    if (gx < 0) gx = 0; else if (gx >= cols) gx = cols - 1;
    if (gy < 0) gy = 0; else if (gy >= rows) gy = rows - 1;
    return Number.isFinite(field?.[gy]?.[gx]) ? field[gy][gx] : 0;
  }

  /** Compute canvas bounds that cover all tile top faces across elevation. */
  _computeGridBounds(heights = null) {
    const cols = this.gameManager.cols;
    const rows = this.gameManager.rows;
    const w = this.gameManager.tileWidth;
    const h = this.gameManager.tileHeight;
    const minX = -(rows - 1) * (w / 2);
    const maxX = (cols - 1) * (w / 2) + w;

    // Base (no elevation) vertical extents for top faces
    const baseMinY = 0; // top vertex of (0,0) face
    const baseMaxY = ((cols - 1) + (rows - 1)) * (h / 2) + h; // bottom vertex of (cols-1,rows-1)

    // Expand by elevation extremes so elevated faces fit fully
    let minElev = 0, maxElev = 0;
    if (Array.isArray(heights)) {
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const hv = Number.isFinite(heights?.[y]?.[x]) ? heights[y][x] : 0;
          const e = TerrainHeightUtils.calculateElevationOffset(hv);
          if (e < minElev) minElev = e;
          if (e > maxElev) maxElev = e;
        }
      }
    }
    // Top vertex of any face could move up by maxElev; bottom vertex could move down by minElev
    const minY = Math.min(baseMinY, baseMinY + minElev - h * 0.0); // allow up-shift
    const maxY = Math.max(baseMaxY, baseMaxY + maxElev + h * 0.0); // allow down-shift

    return { minX, minY, maxX, maxY, width: Math.max(8, Math.ceil(maxX - minX)), height: Math.max(8, Math.ceil(maxY - minY)) };
  }

  _ensureLayerCanvas(depth, bounds) {
    let layer = this.layers.get(depth);
    if (!layer) {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      const sprite = null; // lazy-create when painting
      layer = { canvas, ctx, sprite };
      this.layers.set(depth, layer);
    }
    if (layer.canvas.width !== bounds.width || layer.canvas.height !== bounds.height) {
      layer.canvas.width = bounds.width;
      layer.canvas.height = bounds.height;
      // If a sprite already exists, replace its texture so baseTexture matches new canvas size
      if (layer.sprite && !layer.sprite.destroyed) {
        try {
          const hasPIXI = (typeof window !== 'undefined') && window.PIXI;
          if (hasPIXI) {
            const tex = window.PIXI.Texture.from(layer.canvas);
            layer.sprite.texture = tex;
          } else if (typeof PIXI !== 'undefined') {
            const tex = PIXI.Texture.from(layer.canvas);
            layer.sprite.texture = tex;
          } else {
            // Fallback: mark sprite for rebuild in next paint pass
            try { layer.sprite.destroy?.({ children: false, texture: false, baseTexture: false }); } catch (_) { /* ignore */ }
            layer.sprite = null;
          }
        } catch (_) {
          // If texture replacement fails, drop sprite; it will be recreated below
          try { layer.sprite.destroy?.(); } catch (_) { /* ignore */ }
          layer.sprite = null;
        }
      }
    }
    return layer;
  }

  /** Lightweight value-noise helper for organic strokes. */
  _valueNoise2D(nx, ny) {
    // Apply a seed offset so the noise field varies across sessions but remains coherent
    const seedX = (this._seed & 0xffff) / 65535;
    const seedY = (this._seed >>> 16) / 65535;
    const ix = Math.floor(nx + seedX), iy = Math.floor(ny + seedY);
    const fx = nx - ix, fy = ny - iy;
    const s = (ix, iy) => {
      const h = ((ix * 374761393) ^ (iy * 668265263)) >>> 0;
      const a = (h ^ (h >>> 13)) >>> 0;
      const r = ((a * 1274126177) >>> 0) / 4294967296;
      return r * 2 - 1;
    };
    const v00 = s(ix, iy), v10 = s(ix + 1, iy), v01 = s(ix, iy + 1), v11 = s(ix + 1, iy + 1);
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = v00 + u * (v10 - v00);
    const b = v01 + u * (v11 - v01);
    return a + v * (b - a);
  }

  /** 0..1 fractal noise at grid coordinates (tile space), for patchy distributions. */
  _noise01(x, y, scale = 0.12, octaves = 2, lac = 2.0, gain = 0.5) {
    let amp = 0.5, freq = scale, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      const n = this._valueNoise2D(x * freq, y * freq);
      sum += (n * 0.5 + 0.5) * amp;
      norm += amp;
      amp *= gain;
      freq *= lac;
    }
    return norm > 0 ? sum / norm : 0.5;
  }

  /**
     * Convert grid tile (x,y) to canvas pixel coordinate near tile center.
     */
  _tileCenterToCanvas(x, y, bounds) {
    const w = this.gameManager.tileWidth;
    const h = this.gameManager.tileHeight;
    const px = (x - y) * (w / 2) - bounds.minX + (w / 2);
    const py = (x + y) * (h / 2) - bounds.minY + (h / 2);
    return { x: px, y: py };
  }

  /** Solid fill for a diamond face (no feather), draws directly into ctx. */
  _fillFaceSolid(ctx, cx, cy, w, h, colorInt, alpha = 1.0) {
    const color = this._hex(colorInt);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    traceDiamondFacePath2D(ctx, cx, cy, w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  /** Clip the 2D context to the union of tile top faces at their elevated Y, optionally filtered. */
  _applyFaceClip(ctx, bounds, heights, filterFn) {
    const cols = this.gameManager.cols;
    const rows = this.gameManager.rows;
    const w = this.gameManager.tileWidth;
    const h = this.gameManager.tileHeight;
    ctx.save();
    ctx.beginPath();
    for (let gy = 0; gy < rows; gy++) {
      for (let gx = 0; gx < cols; gx++) {
        if (typeof filterFn === 'function' && !filterFn(gx, gy)) continue;
        const { x: cx0, y: cy0 } = this._tileCenterToCanvas(gx, gy, bounds);
        const height = Number.isFinite(heights?.[gy]?.[gx]) ? heights[gy][gx] : 0;
        const elev = TerrainHeightUtils.calculateElevationOffset(height);
        const cx = cx0;
        const cy = cy0 + elev;
        // Diamond top face path at elevation
        traceDiamondFacePath2D(ctx, cx, cy, w, h);
        ctx.closePath();
      }
    }
    ctx.clip();
  }

  /** Painterly stroke: large soft disc with slightly perturbed contour. */
  _strokeBlob(ctx, cx, cy, r, color, alpha, jag = 0.12, steps = 24) {
    motifStrokeBlob(ctx, cx, cy, r, color, alpha, jag, steps, this._motifUtils());
  }

  /** Long ribbon stroke for dunes/waves, following a noisy direction field. */
  _strokeRibbon(ctx, sx, sy, len, width, color, alpha, orient = 0) {
    motifStrokeRibbon(ctx, sx, sy, len, width, color, alpha, orient, this._motifUtils());
  }

  /** Utility: clip to a single diamond face centered at (cx,cy). Must be balanced with ctx.restore(). */
  _clipSingleFace(ctx, cx, cy, w, h) {
    ctx.save();
    ctx.beginPath();
    traceDiamondFacePath2D(ctx, cx, cy, w, h);
    ctx.closePath();
    ctx.clip();
  }

  /** Small helper to shade a color (hex int) lighter/darker by factor (e.g., 1.1 lighter, 0.9 darker). */
  _shadeHex(hexInt, factor) {
    // Delegate to shared implementation to avoid duplication; behavior preserved
    return _sharedShadeMul(hexInt >>> 0, factor);
  }

  /** Draw concentric soft ripples centered in a face. */
  _drawRipplesInFace(ctx, cx, cy, w, h, baseColor, alpha = 0.18) {
    this._clipSingleFace(ctx, cx, cy, w, h);
    ctx.save();
    ctx.strokeStyle = this._hex(this._shadeHex(baseColor, 1.15));
    ctx.globalAlpha = alpha;
    ctx.lineWidth = Math.max(1, Math.floor(h * 0.06));
    const rx = w * 0.28, ry = h * 0.22;
    for (let i = 0; i < 3; i++) {
      const k = 1 + i * 0.25;
      ctx.beginPath();
      for (let t = 0; t <= Math.PI * 2 + 0.001; t += Math.PI / 24) {
        const nx = Math.cos(t) * rx * k;
        const ny = Math.sin(t) * ry * k * 0.9;
        const wob = 1 + this._valueNoise2D((cx + nx) * 0.02, (cy + ny) * 0.02) * 0.05;
        const x = cx + nx * wob;
        const y = cy + ny * wob;
        if (t === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore(); // from _clipSingleFace
  }

  /** Draw icy specular glints as short thin strokes in a face. */
  _drawIceGlintsInFace(ctx, cx, cy, w, h, alpha = 0.18) {
    this._clipSingleFace(ctx, cx, cy, w, h);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, Math.floor(h * 0.04));
    const base = Math.floor(this._randU(cx, cy, 'iceCount') * 3) + 2;
    for (let i = 0; i < base; i++) {
      const r1 = this._randU(cx, cy, i + 101);
      const r2 = this._randU(cx, cy, i + 202);
      const ox = (r1 * 0.3 + 0.1) * w * 0.5;
      const oy = ((r2 * 0.2) - 0.1) * h * 0.5;
      const x0 = cx + ox;
      const y0 = cy - oy;
      const x1 = x0 + w * 0.18;
      const y1 = y0 - h * 0.14;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  /** Draw short grassy tufts or reeds in a face (directional hatch marks). */
  _drawTuftsInFace(ctx, cx, cy, w, h, color, alpha = 0.22, density = 5, lean = 0.2) {
    this._clipSingleFace(ctx, cx, cy, w, h);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this._hex(color);
    ctx.lineWidth = Math.max(1, Math.floor(h * 0.05));
    for (let i = 0; i < density; i++) {
      const rA = this._randU(cx, cy, i + 301);
      const rB = this._randU(cx, cy, i + 302);
      const rC = this._randU(cx, cy, i + 303);
      const ang = -Math.PI / 3 + (rA - 0.5) * 0.3;
      const r = (rB * 0.25 + 0.15) * Math.min(w, h) * 0.5;
      const a = rC * Math.PI * 2;
      const x0 = cx + Math.cos(a) * r * 0.4;
      const y0 = cy + Math.sin(a) * r * 0.4;
      const len = r * (0.8 + this._randU(cx, cy, i + 304) * 0.4);
      const x1 = x0 + Math.cos(ang) * len * (1 + lean);
      const y1 = y0 + Math.sin(ang) * len * (1 - lean);
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  /** Draw small crown-like canopy blobs inside a face. */
  _drawCanopyInFace(ctx, cx, cy, w, h, baseColor, alpha = 0.18) {
    this._clipSingleFace(ctx, cx, cy, w, h);
    const crownColor = this._shadeHex(baseColor, 0.8);
    const r = Math.min(w, h) * 0.20;
    const count = 3 + Math.floor(this._randU(cx, cy, 'canopyN') * 4);
    for (let i = 0; i < count; i++) {
      const r1 = this._randU(cx, cy, i + 401);
      const r2 = this._randU(cx, cy, i + 402);
      const r3 = this._randU(cx, cy, i + 403);
      const r4 = this._randU(cx, cy, i + 404);
      const ox = (r1 - 0.5) * w * 0.2;
      const oy = (r2 - 0.1) * h * 0.25;
      this._strokeBlob(ctx, cx + ox, cy + oy, r * (0.8 + r3 * 0.6), crownColor, alpha * (0.9 + r4 * 0.2), 0.1, 18);
    }
    // occasional small clearing (lighter patch)
    if (this._randU(cx, cy, 'canopyClear') < 0.15) {
      const light = this._shadeHex(baseColor, 1.12);
      this._strokeBlob(ctx, cx, cy + h * 0.05, r * 0.9, light, alpha * 0.4, 0.05, 18);
    }
    ctx.restore();
    ctx.restore();
  }

  /** Draw rock striations across a face (alpine/mountain). */
  _drawStriationsInFace(ctx, cx, cy, w, h, color, alpha = 0.18) {
    this._clipSingleFace(ctx, cx, cy, w, h);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this._hex(this._shadeHex(color, 0.7));
    ctx.lineWidth = Math.max(1, Math.floor(h * 0.06));
    const k = 3;
    for (let i = -k; i <= k; i++) {
      const y = cy + (i / k) * h * 0.4 + this._valueNoise2D((cx + i) * 0.03, cy * 0.03) * h * 0.05;
      ctx.beginPath();
      ctx.moveTo(cx - w * 0.45, y);
      ctx.lineTo(cx + w * 0.45, y - h * 0.10);
      ctx.stroke();
    }
    ctx.restore();
    ctx.restore();
  }

  /** Draw dark crack line across a face (volcanic or dry ground). */
  _drawCrackInFace(ctx, cx, cy, w, h, color, alpha = 0.22) {
    this._clipSingleFace(ctx, cx, cy, w, h);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = this._hex(this._shadeHex(color, 0.4));
    ctx.lineWidth = Math.max(1, Math.floor(h * 0.08));
    const steps = 6;
    ctx.beginPath();
    let x = cx - w * 0.45;
    let y = cy + this._valueNoise2D(cx * 0.05, cy * 0.05) * h * 0.1;
    ctx.moveTo(x, y);
    for (let i = 0; i < steps; i++) {
      x += w * 0.15;
      const rr = this._randU(cx, cy, i + 501) - 0.5;
      y += rr * h * 0.25;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
    ctx.restore();
  }

  // ========================= GLOBAL (CANVAS-WIDE) MOTIFS =========================
  /** Draw multiple long ribbons across the current clip (e.g., dunes/waves). */
  _globalRibbons(ctx, canvas, count, width, color, alpha, orient = 0) {
    for (let i = 0; i < count; i++) {
      // Deterministic placement independent of count for stability
      const y0 = this._randU('ribbon', i, 1) * canvas.height;
      const side = this._randU('ribbon', i, 2) > 0.5 ? 1 : 0;
      const x0 = side ? canvas.width * 0.12 : 0;
      this._strokeRibbon(ctx, x0, y0, canvas.width * 1.5, width, color, alpha, orient);
    }
  }

  /** Parallel striations across current clip at a given angle. */
  _globalStriations(ctx, canvas, color, alpha = 0.16, angle = Math.PI / 6, gap = 40) {
    motifGlobalStriations(ctx, canvas, color, alpha, angle, gap, this._motifUtils());
  }

  /** Crack network across current clip. */
  _globalCracks(ctx, canvas, color, alpha = 0.22, count = 8, step = 48, jitter = 0.25) {
    motifGlobalCracks(ctx, canvas, color, alpha, count, step, jitter, this._motifUtils());
  }

  /** Scatter soft canopy blobs across current clip. */
  _scatterBlobsGlobal(ctx, canvas, count, rBase, rVar, color, alpha = 0.16, jag = 0.08, steps = 18) {
    motifScatterBlobsGlobal(ctx, canvas, count, rBase, rVar, color, alpha, jag, steps, this._motifUtils());
  }

  /** Scatter grassy/reedy tufts across current clip. */
  _scatterTuftsGlobal(ctx, canvas, count, len, color, alpha = 0.2, lean = 0.15) {
    motifScatterTuftsGlobal(ctx, canvas, count, len, color, alpha, lean, this._motifUtils());
  }



  _styleForBiome(biome) { return styleForBiome(biome); }

  // Build a utils bag to pass to motif helpers, binding this instance methods/fields.
  _motifUtils() {
    return {
      hex: (c) => this._hex(c),
      shadeHex: (c, f) => this._shadeHex(c, f),
      valueNoise2D: (x, y) => this._valueNoise2D(x, y),
      sampleFieldAtCanvas: (field, x, y, bounds) => this._sampleFieldAtCanvas(field, x, y, bounds),
      randU: (a, b, c) => this._randU(a, b, c),
      bounds: this.bounds,
      aspectFieldForStroke: this._aspectFieldForStroke,
      slopeFieldForStroke: this._slopeFieldForStroke,
      slopeGainForStroke: this._slopeGainForStroke,
      ribbonAlongFlow: this._ribbonAlongFlow
    };
  }

  /** Paint the canvas for the given biome and heights. */
  paint(biomeKey, heights, tilesHiddenCallback = null) {
    if (!this.gameManager?.gridContainer || !Array.isArray(heights)) return;
    const cols = this.gameManager.cols;
    const rows = this.gameManager.rows;
    this.bounds = this._computeGridBounds(heights);
    // Precompute terrain derivatives once
    const { slope, aspect } = computeSlopeAspect(this.gameManager, heights);
    const moisture = computeMoistureField(this.gameManager, heights);

    // Expose fields to stroke helpers
    this._aspectFieldForStroke = aspect;
    this._slopeFieldForStroke = slope;

    const w = this.gameManager.tileWidth;
    const h = this.gameManager.tileHeight;
    const perf = (typeof window !== 'undefined' && window.richShadingSettings?.performance) ? 0.6 : 1.0;
    const densityMul = (typeof window !== 'undefined' && window.richShadingSettings?.density) || 1.0;
    const intensity = (typeof window !== 'undefined' && window.richShadingSettings?.intensity) || 1.0;
    const mapFreq = (typeof window !== 'undefined' && window.richShadingSettings?.mapFreq) || 0.05;
    const shorelineSandStrength = (typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.shorelineSandStrength)) ? Math.max(0, window.richShadingSettings.shorelineSandStrength) : 1.0;
    // Allow an external seed override for determinism
    const extSeed = (typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.seed)) ? (window.richShadingSettings.seed >>> 0) : null;
    const seed = (extSeed ?? this._seed) >>> 0;
    // How strongly should slope influence directions (1=soft, 2+=strong)
    this._slopeGainForStroke = (typeof window !== 'undefined' && Number.isFinite(window.richShadingSettings?.slopeGain)) ? Math.max(0.1, window.richShadingSettings.slopeGain) : 1.5;
    const baseRadius = Math.max(w, h) * 0.9;
    const style = this._styleForBiome(biomeKey);

    const minDepth = 0;
    const maxDepth = (cols - 1) + (rows - 1);
    // Track depths we painted to remove stale layers later
    const paintedDepths = new Set();

    for (let d = minDepth; d <= maxDepth; d++) {
      // Ensure layer and clear
      const layer = this._ensureLayerCanvas(d, this.bounds);
      const { canvas, ctx } = layer;
      // Clear buffer
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Clip to this depth's faces so all passes stay on top faces
      const filter = (gx, gy) => (gx + gy) === d;
      this._applyFaceClip(ctx, this.bounds, heights, filter);

      // Base per-face solid fill (no feather)
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if ((x + y) !== d) continue;
          const heightVal = Number.isFinite(heights?.[y]?.[x]) ? heights[y][x] : 0;
          const color = getBiomeColorHex(
            biomeKey,
            heightVal,
            x,
            y,
            {
              moisture: (moisture?.[y]?.[x]) ?? 0.5,
              slope: (slope?.[y]?.[x]) ?? 0.0,
              aspectRad: (aspect?.[y]?.[x]) ?? 0.0,
              seed,
              mapFreq,
              intensity
            }
          );
          const { x: cx0, y: cy0 } = this._tileCenterToCanvas(x, y, this.bounds);
          const elev = TerrainHeightUtils.calculateElevationOffset(heightVal);
          const cx = cx0;
          const cy = cy0 + elev;
          this._fillFaceSolid(ctx, cx, cy, w, h, color, 1.0);
        }
      }

      // Painterly blobs per tile in this depth
      // Density controls percentage of tiles that receive painterly overlays
      const tilePatternProb = Math.max(0, Math.min(1, (densityMul - 0.5) / 1.0));
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          if ((x + y) !== d) continue;
          if (this._randU(x, y, 'tileOverlay') > tilePatternProb) continue;
          const hv = heights[y][x];
          const color = getBiomeColorHex(
            biomeKey,
            hv,
            x,
            y,
            {
              moisture: (moisture?.[y]?.[x]) ?? 0.5,
              slope: (slope?.[y]?.[x]) ?? 0.0,
              aspectRad: (aspect?.[y]?.[x]) ?? 0.0,
              seed,
              mapFreq,
              intensity
            }
          );
          const { x: px0, y: py0 } = this._tileCenterToCanvas(x, y, this.bounds);
          const elev = TerrainHeightUtils.calculateElevationOffset(hv);
          const px = px0;
          const py = py0 + elev;
          const rJitter = (this._valueNoise2D(px * 0.01, py * 0.01) + 1) * 0.5;
          const r = baseRadius * (1.4 + rJitter * 0.6);
          const a = 0.20 * perf; // keep alpha stable; intensity affects color contrast in palette
          this._strokeBlob(ctx, px, py, r, color, a, 0.10 + 0.1 * rJitter, 28);
          const a2 = 0.14 * perf;
          const r2 = baseRadius * (0.9 + (hv > 0 ? 0.25 : 0.08));
          this._strokeBlob(ctx, px + 6, py + 4, r2, color, a2, 0.08, 22);
        }
      }

      // Biome-specific global passes (continuous strokes across the band clip)
      const longCount = Math.floor(12 * perf * densityMul);
      // Derive a band orientation (ribbons/striations follow terrain). For water/wetland, bias slightly to shallow downhill.
      const bandOrient = this._bandOrientationForDepth(d, heights, slope, aspect, null, this._slopeGainForStroke);
      const avgSlope = this._bandAverage(slope, d);
      if (style === 'plains') {
        // Wind-swept tufts scattered across the band
        const col = getBiomeColorHex(
          biomeKey,
          0,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d),
            slope: avgSlope,
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        const avgMoist = this._bandAverage(moisture, d);
        const density = (rows + cols) * (0.6 + avgMoist * 0.6) * perf;
        this._scatterTuftsGlobal(ctx, canvas, Math.floor(density), Math.min(w, h) * 0.35, this._shadeHex(col, 0.75), 0.18, 0.12);
      } else if (style === 'arid') {
        const col = getBiomeColorHex(
          biomeKey,
          2,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d),
            slope: avgSlope,
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        if (/salt|flat/i.test(String(biomeKey))) {
          this._globalCracks(ctx, canvas, col, 0.22, 8 + Math.floor(4 * densityMul));
        } else {
          // Dunes prefer along-contour undulations (perpendicular to flow)
          this._ribbonAlongFlow = false;
          this._globalRibbons(ctx, canvas, longCount, Math.max(2, h * 0.18), col, 0.10, bandOrient + Math.PI);
          // Some savanna/steppe tufts layered sparsely
          if (/savanna|steppe|prairie|grass/i.test(String(biomeKey))) {
            this._scatterTuftsGlobal(ctx, canvas, Math.floor((rows + cols) * 0.4 * perf), Math.min(w, h) * 0.3, this._shadeHex(col, 0.7), 0.16, 0.15);
          }
        }
      } else if (style === 'forest') {
        const col = getBiomeColorHex(
          biomeKey,
          0,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d),
            slope: avgSlope,
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        const avgMoist = this._bandAverage(moisture, d);
        const count = (rows + cols) * (0.7 + avgMoist * 0.8) * perf;
        this._scatterBlobsGlobal(ctx, canvas, Math.floor(count), Math.min(w, h) * 0.26, 0.7, this._shadeHex(col, 0.85), 0.16, 0.08, 18);
      } else if (style === 'wetland') {
        // Two clips: depressions get ripples, others get reeds
        // 1) Ripples on negative tiles of this band
        ctx.save();
        this._applyFaceClip(ctx, this.bounds, heights, (gx, gy) => (gx + gy) === d && (heights[gy][gx] || 0) < 0);
        const wetOrient = this._bandOrientationForDepth(d, heights, slope, aspect, (x, y) => (heights[y][x] || 0) < 0, this._slopeGainForStroke);
        const negMoist = this._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) < 0);
        const negSlope = this._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) < 0);
        const waterCol = getBiomeColorHex(
          biomeKey,
          -2,
          0,
          0,
          {
            moisture: negMoist,
            slope: negSlope,
            aspectRad: wetOrient,
            seed,
            mapFreq
          }
        );
        // Water flows downhill -> align ribbons along flow
        this._ribbonAlongFlow = true;
        this._globalRibbons(ctx, canvas, longCount + 4, Math.max(2, h * 0.16), waterCol, 0.10, wetOrient + Math.PI);
        ctx.restore();
        // 2) Reeds on non-negative faces of this band
        ctx.save();
        this._applyFaceClip(ctx, this.bounds, heights, (gx, gy) => (gx + gy) === d && (heights[gy][gx] || 0) >= 0);
        const reedCol = getBiomeColorHex(
          biomeKey,
          0,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) >= 0),
            slope: this._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) >= 0),
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        const bandMoist = this._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) >= 0);
        const reedCount = (rows + cols) * (0.6 + bandMoist * 0.8) * perf;
        this._scatterTuftsGlobal(ctx, canvas, Math.floor(reedCount), Math.min(w, h) * 0.32, this._shadeHex(reedCol, 0.6), 0.18, 0.08);
        ctx.restore();
      } else if (style === 'alpine') {
        // Striations across band; then ice glints on high or frozen
        const midCol = getBiomeColorHex(
          biomeKey,
          0,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d),
            slope: avgSlope,
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        this._globalStriations(ctx, canvas, midCol, 0.14, bandOrient + Math.PI / 2, Math.max(28, Math.floor(h * 0.7)));
        // High/frozen sub-clip for glints
        ctx.save();
        this._applyFaceClip(ctx, this.bounds, heights, (gx, gy) => (gx + gy) === d && (heights[gy][gx] || 0) > 1);
        this._globalStriations(ctx, canvas, 0xffffff, 0.10, bandOrient - Math.PI / 3, Math.max(36, Math.floor(h * 0.8)));
        ctx.restore();
      } else if (style === 'water') {
        // Water strokes only on underwater tiles (h<0)
        const waterCol = getBiomeColorHex(
          biomeKey,
          -2,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) < 0),
            slope: this._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) < 0),
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        ctx.save();
        this._applyFaceClip(ctx, this.bounds, heights, (gx, gy) => (gx + gy) === d && (heights[gy][gx] || 0) < 0);
        this._ribbonAlongFlow = true;
        this._globalRibbons(ctx, canvas, longCount + 6, Math.max(2, h * 0.16), waterCol, 0.10, bandOrient + Math.PI);
        ctx.restore();

        // For coast/beach on land (h>=0), ensure sand presence by a light scatter of blobs in sand tone
        if (/coast|beach|shore/i.test(String(biomeKey))) {
          const sandCol = getBiomeColorHex(
            'beach',
            2, // dry-ish sand reference
            0,
            0,
            {
              moisture: this._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) >= 0),
              slope: this._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) >= 0),
              aspectRad: bandOrient,
              seed,
              mapFreq
            }
          );
          ctx.save();
          this._applyFaceClip(ctx, this.bounds, heights, (gx, gy) => (gx + gy) === d && (heights[gy][gx] || 0) >= 0);
          // scale density and alpha by shorelineSandStrength
          const landCount = Math.floor((rows + cols) * 0.35 * perf * shorelineSandStrength);
          const landAlpha = 0.10 * Math.min(1.5, Math.max(0.4, shorelineSandStrength));
          this._scatterBlobsGlobal(ctx, canvas, landCount, Math.min(w, h) * 0.18, 0.5, sandCol, landAlpha, 0.04, 14);
          ctx.restore();

          // Add shallow-water speckles of sand just below sea level to suggest suspended sandbars
          const wetSandCol = getBiomeColorHex(
            'beach',
            0, // wet sand
            0,
            0,
            {
              moisture: this._bandAverage(moisture, d, (x, y) => (heights[y][x] || 0) < 0),
              slope: this._bandAverage(slope, d, (x, y) => (heights[y][x] || 0) < 0),
              aspectRad: bandOrient,
              seed,
              mapFreq
            }
          );
          ctx.save();
          this._applyFaceClip(ctx, this.bounds, heights, (gx, gy) => (gx + gy) === d && (heights[gy][gx] || 0) < 0 && (heights[gy][gx] || 0) > -2);
          const waterCount = Math.floor((rows + cols) * 0.15 * perf * shorelineSandStrength);
          const waterAlpha = 0.06 * Math.min(1.5, Math.max(0.4, shorelineSandStrength));
          this._scatterBlobsGlobal(ctx, canvas, waterCount, Math.min(w, h) * 0.14, 0.4, wetSandCol, waterAlpha, 0.03, 12);
          ctx.restore();
        }
      } else if (style === 'volcanic') {
        const col = getBiomeColorHex(
          biomeKey,
          -1,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d),
            slope: avgSlope,
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        this._globalCracks(ctx, canvas, col, 0.24, 10 + Math.floor(4 * densityMul));
      } else if (style === 'arcane') {
        const col = getBiomeColorHex(
          biomeKey,
          0,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d),
            slope: avgSlope,
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        this._globalRibbons(ctx, canvas, Math.floor(longCount * 0.7), Math.max(2, h * 0.14), col, 0.10, 0.2);
      } else {
        // Generic: light scatter to avoid flatness
        const col = getBiomeColorHex(
          biomeKey,
          0,
          0,
          0,
          {
            moisture: this._bandAverage(moisture, d),
            slope: avgSlope,
            aspectRad: bandOrient,
            seed,
            mapFreq
          }
        );
        this._scatterBlobsGlobal(ctx, canvas, Math.floor((rows + cols) * 0.3 * perf), Math.min(w, h) * 0.20, 0.5, col, 0.10, 0.05, 14);
      }
      // Release face clip for this layer
      try { ctx.restore(); } catch { /* ignore missing restore */ }

      // Create/update sprite for this depth
      if (!layer.sprite || layer.sprite.destroyed) {
        let sprite = null;
        try {
          const hasPIXI = (typeof window !== 'undefined') && window.PIXI;
          const tex = hasPIXI ? window.PIXI.Texture.from(canvas)
            : (typeof PIXI !== 'undefined' ? PIXI.Texture.from(canvas) : null);
          if (tex) {
            sprite = hasPIXI ? new window.PIXI.Sprite(tex)
              : (typeof PIXI !== 'undefined' ? new PIXI.Sprite(tex) : null);
          }
        } catch (_) { /* ignore */ }
        if (!sprite) { continue; }
        sprite.name = `BiomeCanvasPainterSprite_${d}`;
        // Place just under the top-face borders for this depth to avoid z-fighting
        sprite.zIndex = d * 100 - 1; // tiles are depth*100; tokens start at +1
        this.gameManager.gridContainer.addChild(sprite);
        layer.sprite = sprite;
      } else {
        try {
          const tex = layer.sprite.texture;
          // Force a reupload of the canvas to the GPU
          tex.baseTexture?.update?.();
          tex.update?.(); // fallback; harmless if no-op
        } catch (_) { /* ignore */ }
      }
      if (layer.sprite && !layer.sprite.destroyed) {
        layer.sprite.x = this.bounds.minX;
        layer.sprite.y = this.bounds.minY;
      }
      paintedDepths.add(d);
    }

    // Remove any stale layer sprites from previous paints
    for (const [d, layer] of this.layers.entries()) {
      if (!paintedDepths.has(d)) {
        if (layer.sprite && !layer.sprite.destroyed) {
          try { this.gameManager.gridContainer.removeChild(layer.sprite); } catch { /* ignore removal errors */ }
          try { layer.sprite.destroy?.(); } catch { /* ignore destroy errors */ }
        }
        this.layers.delete(d);
      }
    }

    if (typeof this.gameManager.gridContainer.sortChildren === 'function') {
      try { this.gameManager.gridContainer.sortChildren(); } catch (_) { /* ignore sort errors */ }
    }

    if (typeof tilesHiddenCallback === 'function') tilesHiddenCallback(true);
  }

  /** Remove the painter sprite and optionally restore tiles. */
  clear(tilesHiddenCallback = null) {
    for (const [, layer] of this.layers.entries()) {
      if (layer.sprite && !layer.sprite.destroyed) {
        try { this.gameManager.gridContainer.removeChild(layer.sprite); } catch { /* ignore removal errors */ }
        try { layer.sprite.destroy?.(); } catch { /* ignore destroy errors */ }
      }
    }
    this.layers.clear();
    if (typeof tilesHiddenCallback === 'function') tilesHiddenCallback(false);
  }
}

export default BiomeCanvasPainter;
