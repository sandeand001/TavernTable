// Global and face-level painterly motif helpers extracted from BiomeCanvasPainter.
// These are pure-ish helpers that rely on a provided utils object for RNG, color ops, and field sampling.

/** Stroke a soft, perturbed blob shape. */
export function strokeBlob(ctx, cx, cy, r, color, alpha, jag = 0.12, steps = 24, u) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = u.hex(color);
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const wob = 1 + u.valueNoise2D(Math.cos(t) * 3 + cx * 0.01, Math.sin(t) * 3 + cy * 0.01) * jag;
    const rr = r * wob;
    const x = cx + Math.cos(t) * rr;
    const y = cy + Math.sin(t) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Long ribbon stroke for dunes/waves, following a noisy direction field. */
export function strokeRibbon(ctx, sx, sy, len, width, color, alpha, orient = 0, u) {
  let x = sx,
    y = sy;
  const step = Math.max(8, width * 0.6);
  ctx.save();
  ctx.strokeStyle = u.hex(color);
  ctx.globalAlpha = alpha;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  for (let d = 0; d < len; d += step) {
    const localAspect = u.sampleFieldAtCanvas(u.aspectFieldForStroke, x, y, u.bounds) || 0;
    const localSlope = u.sampleFieldAtCanvas(u.slopeFieldForStroke, x, y, u.bounds) || 0;
    const slopeGain = u.slopeGainForStroke;
    const sNorm = Math.max(0, Math.min(1, localSlope * 1.5));
    const sW = Math.pow(sNorm, Math.max(0.1, slopeGain));
    const alongFlow = u.ribbonAlongFlow === true;
    const aspectDir = alongFlow ? localAspect + Math.PI : localAspect + Math.PI / 2;
    const blended = (1 - 0.5 * sW) * orient + 0.5 * sW * aspectDir;
    const noise = u.valueNoise2D(x * 0.01, y * 0.01) * 0.7;
    const angle = blended + noise;
    x += Math.cos(angle) * step;
    y += Math.sin(angle) * step * 0.6;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Parallel striations across current clip at a given angle. */
export function globalStriations(
  ctx,
  canvas,
  color,
  alpha = 0.16,
  angle = Math.PI / 6,
  gap = 40,
  u
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = u.hex(u.shadeHex(color, 0.7));
  ctx.lineWidth = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) * 0.01));
  const diag = Math.hypot(canvas.width, canvas.height);
  const cx = canvas.width / 2,
    cy = canvas.height / 2;
  const count = Math.ceil(diag / gap) + 2;
  for (let i = -count; i <= count; i++) {
    const offset = i * gap;
    const nx = Math.cos(angle + Math.PI / 2),
      ny = Math.sin(angle + Math.PI / 2);
    const px = cx + nx * offset;
    const py = cy + ny * offset;
    const dx = Math.cos(angle) * diag;
    const dy = Math.sin(angle) * diag;
    ctx.beginPath();
    ctx.moveTo(px - dx, py - dy);
    ctx.lineTo(px + dx, py + dy);
    ctx.stroke();
  }
  ctx.restore();
}

/** Crack network across current clip. */
export function globalCracks(
  ctx,
  canvas,
  color,
  alpha = 0.22,
  count = 8,
  step = 48,
  jitter = 0.25,
  u
) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = u.hex(u.shadeHex(color, 0.4));
  ctx.lineWidth = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) * 0.01));
  const len = Math.max(canvas.width, canvas.height) * 0.9;
  for (let i = 0; i < count; i++) {
    let x = u.randU('crack', i, 1) * canvas.width;
    let y = u.randU('crack', i, 2) * canvas.height;
    const theta = (u.randU('crack', i, 3) - 0.5) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let t = 0; t < len; t += step) {
      const j = (u.randU('crack', i, t) - 0.5) * jitter;
      x += Math.cos(theta + j) * step;
      y += Math.sin(theta + j) * step;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Scatter soft blobs across the clip. */
export function scatterBlobsGlobal(
  ctx,
  canvas,
  count,
  rBase,
  rVar,
  color,
  alpha = 0.16,
  jag = 0.08,
  steps = 18,
  u
) {
  for (let i = 0; i < count; i++) {
    const x = u.randU('blob', i, 1) * canvas.width;
    const y = u.randU('blob', i, 2) * canvas.height;
    const r = rBase * (1 + u.randU('blob', i, 3) * rVar);
    strokeBlob(ctx, x, y, r, color, alpha, jag, steps, u);
  }
}

/** Scatter grassy/reedy tufts across the clip. */
export function scatterTuftsGlobal(ctx, canvas, count, len, color, alpha = 0.2, lean = 0.15, u) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = u.hex(color);
  ctx.lineWidth = Math.max(1, Math.floor(Math.min(canvas.width, canvas.height) * 0.008));
  for (let i = 0; i < count; i++) {
    const x0 = u.randU('tuft', i, 1) * canvas.width;
    const y0 = u.randU('tuft', i, 2) * canvas.height;
    const ang = -Math.PI / 3 + (u.randU('tuft', i, 3) - 0.5) * 0.3;
    const x1 = x0 + Math.cos(ang) * len * (1 + lean);
    const y1 = y0 + Math.sin(ang) * len * (1 - lean);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  ctx.restore();
}
