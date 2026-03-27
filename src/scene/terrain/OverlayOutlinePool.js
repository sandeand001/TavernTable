function buildOutlineMaterial(three, baseColor, lineAlpha, lineWidth) {
  const material = new three.LineBasicMaterial({
    color: typeof baseColor === 'number' ? baseColor : 0xffffff,
    transparent: true,
    opacity: Number.isFinite(lineAlpha) ? lineAlpha : 0.9,
    linewidth: Number.isFinite(lineWidth) ? lineWidth : 2,
  });
  material.toneMapped = false;
  material.depthWrite = false;
  material.depthTest = false;
  return material;
}

function buildOutlineGeometry(three) {
  if (three.EdgesGeometry && three.PlaneGeometry) {
    const plane = new three.PlaneGeometry(1, 1);
    plane.rotateX(-Math.PI * 0.5);
    const geometry = new three.EdgesGeometry(plane);
    plane.dispose?.();
    return geometry;
  }

  const fallbackPlane = new three.PlaneGeometry(1, 1);
  fallbackPlane.rotateX(-Math.PI * 0.5);
  if (three.EdgesGeometry) {
    const geometry = new three.EdgesGeometry(fallbackPlane);
    fallbackPlane.dispose?.();
    return geometry;
  }

  const manual = new three.BufferGeometry();
  const corners = [
    [-0.5, 0, -0.5],
    [0.5, 0, -0.5],
    [0.5, 0, 0.5],
    [-0.5, 0, 0.5],
  ];
  const pts = [];
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    pts.push(a[0], a[1], a[2], b[0], b[1], b[2]);
  }
  const arr = new Float32Array(pts);
  if (three.Float32BufferAttribute) {
    manual.setAttribute('position', new three.Float32BufferAttribute(arr, 3));
  } else {
    manual.setAttribute('position', new three.BufferAttribute(arr, 3));
  }
  fallbackPlane.dispose?.();
  manual.computeBoundingSphere?.();
  return manual;
}

export function ensureOutlinePool({
  three,
  group,
  pool = [],
  material,
  required,
  baseColor,
  lineAlpha,
  lineWidth,
}) {
  if (!group || !three?.LineSegments) {
    return { pool, material };
  }

  let outlineMaterial = material;
  if (!outlineMaterial || !(outlineMaterial instanceof three.LineBasicMaterial)) {
    outlineMaterial = buildOutlineMaterial(three, baseColor, lineAlpha, lineWidth);
  }

  const outlinePool = Array.isArray(pool) ? pool : [];
  while (outlinePool.length < required) {
    const geometry = buildOutlineGeometry(three);
    const line = new three.LineSegments(geometry, outlineMaterial);
    line.name = `TerrainBrushOutline_${outlinePool.length}`;
    line.visible = false;
    line.frustumCulled = false;
    line.renderOrder = 12;
    group.add(line);
    outlinePool.push(line);
  }

  return { pool: outlinePool, material: outlineMaterial };
}

export function syncOutlineStyle(material, colorHex, lineAlpha, lineWidth) {
  if (!material) return;
  try {
    if (typeof colorHex === 'number') material.color.set(colorHex);
    if (Number.isFinite(lineAlpha)) material.opacity = lineAlpha;
    if (Number.isFinite(lineWidth)) material.linewidth = lineWidth;
    material.needsUpdate = true;
  } catch (_) {
    /* ignore */
  }
}
