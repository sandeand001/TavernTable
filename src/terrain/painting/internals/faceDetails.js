export function drawRipplesInFace(painter, ctx, cx, cy, w, h, baseColor, alpha = 0.18) {
  painter._clipSingleFace(ctx, cx, cy, w, h);
  ctx.save();
  ctx.strokeStyle = painter._hex(painter._shadeHex(baseColor, 1.15));
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(1, Math.floor(h * 0.06));
  const rx = w * 0.28,
    ry = h * 0.22;
  for (let i = 0; i < 3; i++) {
    const k = 1 + i * 0.25;
    ctx.beginPath();
    for (let t = 0; t <= Math.PI * 2 + 0.001; t += Math.PI / 24) {
      const nx = Math.cos(t) * rx * k;
      const ny = Math.sin(t) * ry * k * 0.9;
      const wob = 1 + painter._valueNoise2D((cx + nx) * 0.02, (cy + ny) * 0.02) * 0.05;
      const x = cx + nx * wob;
      const y = cy + ny * wob;
      if (t === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

export function drawIceGlintsInFace(painter, ctx, cx, cy, w, h, alpha = 0.18) {
  painter._clipSingleFace(ctx, cx, cy, w, h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1, Math.floor(h * 0.04));
  const base = Math.floor(painter._randU(cx, cy, 'iceCount') * 3) + 2;
  for (let i = 0; i < base; i++) {
    const r1 = painter._randU(cx, cy, i + 101);
    const r2 = painter._randU(cx, cy, i + 202);
    const ox = (r1 * 0.3 + 0.1) * w * 0.5;
    const oy = (r2 * 0.2 - 0.1) * h * 0.5;
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

export function drawTuftsInFace(
  painter,
  ctx,
  cx,
  cy,
  w,
  h,
  color,
  alpha = 0.22,
  density = 5,
  lean = 0.2
) {
  painter._clipSingleFace(ctx, cx, cy, w, h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = painter._hex(color);
  ctx.lineWidth = Math.max(1, Math.floor(h * 0.05));
  for (let i = 0; i < density; i++) {
    const rA = painter._randU(cx, cy, i + 301);
    const rB = painter._randU(cx, cy, i + 302);
    const rC = painter._randU(cx, cy, i + 303);
    const ang = -Math.PI / 3 + (rA - 0.5) * 0.3;
    const r = (rB * 0.25 + 0.15) * Math.min(w, h) * 0.5;
    const a = rC * Math.PI * 2;
    const x0 = cx + Math.cos(a) * r * 0.4;
    const y0 = cy + Math.sin(a) * r * 0.4;
    const len = r * (0.8 + painter._randU(cx, cy, i + 304) * 0.4);
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

export function drawCanopyInFace(painter, ctx, cx, cy, w, h, baseColor, alpha = 0.18) {
  painter._clipSingleFace(ctx, cx, cy, w, h);
  const crownColor = painter._shadeHex(baseColor, 0.8);
  const r = Math.min(w, h) * 0.2;
  const count = 3 + Math.floor(painter._randU(cx, cy, 'canopyN') * 4);
  for (let i = 0; i < count; i++) {
    const r1 = painter._randU(cx, cy, i + 401);
    const r2 = painter._randU(cx, cy, i + 402);
    const r3 = painter._randU(cx, cy, i + 403);
    const r4 = painter._randU(cx, cy, i + 404);
    const ox = (r1 - 0.5) * w * 0.2;
    const oy = (r2 - 0.1) * h * 0.25;
    painter._strokeBlob(
      ctx,
      cx + ox,
      cy + oy,
      r * (0.8 + r3 * 0.6),
      crownColor,
      alpha * (0.9 + r4 * 0.2),
      0.1,
      18
    );
  }
  if (painter._randU(cx, cy, 'canopyClear') < 0.15) {
    const light = painter._shadeHex(baseColor, 1.12);
    painter._strokeBlob(ctx, cx, cy + h * 0.05, r * 0.9, light, alpha * 0.4, 0.05, 18);
  }
  ctx.restore();
  ctx.restore();
}

export function drawStriationsInFace(painter, ctx, cx, cy, w, h, color, alpha = 0.18) {
  painter._clipSingleFace(ctx, cx, cy, w, h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = painter._hex(painter._shadeHex(color, 0.7));
  ctx.lineWidth = Math.max(1, Math.floor(h * 0.06));
  const k = 3;
  for (let i = -k; i <= k; i++) {
    const y = cy + (i / k) * h * 0.4 + painter._valueNoise2D((cx + i) * 0.03, cy * 0.03) * h * 0.05;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.45, y);
    ctx.lineTo(cx + w * 0.45, y - h * 0.1);
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

export function drawCrackInFace(painter, ctx, cx, cy, w, h, color, alpha = 0.22) {
  painter._clipSingleFace(ctx, cx, cy, w, h);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = painter._hex(painter._shadeHex(color, 0.4));
  ctx.lineWidth = Math.max(1, Math.floor(h * 0.08));
  const steps = 6;
  ctx.beginPath();
  let x = cx - w * 0.45;
  let y = cy + painter._valueNoise2D(cx * 0.05, cy * 0.05) * h * 0.1;
  ctx.moveTo(x, y);
  for (let i = 0; i < steps; i++) {
    x += w * 0.15;
    const rr = painter._randU(cx, cy, i + 501) - 0.5;
    y += rr * h * 0.25;
    ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}
