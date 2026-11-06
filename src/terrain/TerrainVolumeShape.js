import { createBoxCell, createConvexCell, clipCellToBounds } from './ConvexGeometry.js';

const AXES = ['x', 'y', 'z'];
const finitePoint = (point) =>
  point && !Array.isArray(point) && AXES.every((axis) => Number.isFinite(point[axis]));

export function normalizeVolumeShape(shape, bounds) {
  if (shape === undefined) return null;
  if (shape?.kind === 'polyhedron') {
    if (
      Object.keys(shape).some((key) => !['kind', 'vertices', 'faces'].includes(key)) ||
      !Array.isArray(shape.vertices) ||
      shape.vertices.length < 4 ||
      shape.vertices.length > 64 ||
      shape.vertices.some((point) => !finitePoint(point)) ||
      !Array.isArray(shape.faces) ||
      shape.faces.length < 4 ||
      shape.faces.length > 64 ||
      shape.faces.some(
        (face) =>
          !Array.isArray(face) ||
          face.length < 3 ||
          face.length > 32 ||
          new Set(face).size !== face.length ||
          face.some(
            (index) => !Number.isInteger(index) || index < 0 || index >= shape.vertices.length
          )
      )
    )
      throw new Error('A roof polyhedron needs valid convex vertices and faces');
    const center = Object.fromEntries(
      ['x', 'y', 'z'].map((axis) => [
        axis,
        shape.vertices.reduce((sum, point) => sum + point[axis] / shape.vertices.length, 0),
      ])
    );
    const cell = createConvexCell(
      shape.faces.map((face) => face.map((index) => shape.vertices[index])),
      {},
      center
    );
    const edges = new Map();
    for (const face of shape.faces)
      for (let i = 0; i < face.length; i++) {
        const key = [face[i], face[(i + 1) % face.length]].sort((a, b) => a - b).join(',');
        edges.set(key, (edges.get(key) || 0) + 1);
      }
    if (
      !cell ||
      cell.faces.length !== shape.faces.length ||
      [...edges.values()].some((count) => count !== 2) ||
      cell.faces.some((face) =>
        face.vertices.some(
          (point) =>
            Math.abs(
              face.plane.normal.x * point.x +
                face.plane.normal.y * point.y +
                face.plane.normal.z * point.z -
                face.plane.distance
            ) > 1e-6
        )
      ) ||
      cell.planes.some(({ normal, distance }) =>
        shape.vertices.some(
          (point) => normal.x * point.x + normal.y * point.y + normal.z * point.z > distance + 1e-6
        )
      )
    )
      throw new Error('Roof polyhedra must be convex and closed');
    return JSON.parse(JSON.stringify(shape));
  }
  if (shape?.kind === 'prism') {
    if (
      Object.keys(shape).some((key) => !['kind', 'points'].includes(key)) ||
      !Array.isArray(shape.points) ||
      shape.points.length < 3 ||
      shape.points.length > 32 ||
      shape.points.some((p) => !Number.isFinite(p?.x) || !Number.isFinite(p?.z))
    )
      throw new RangeError('A prism requires a finite convex footprint inside its bounds');
    let sign = 0;
    for (let i = 0; i < shape.points.length; i++) {
      const a = shape.points[i],
        b = shape.points[(i + 1) % shape.points.length],
        c = shape.points[(i + 2) % shape.points.length];
      const turn = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
      if (Math.abs(turn) < 1e-9 || (sign && Math.sign(turn) !== sign))
        throw new RangeError('A prism footprint must be strictly convex');
      sign = Math.sign(turn);
    }
    return { kind: 'prism', points: shape.points.map((p) => ({ x: p.x, z: p.z })) };
  }
  if (
    !shape ||
    !['ellipsoid', 'cylinder'].includes(shape.kind) ||
    Object.keys(shape).some(
      (key) => !['kind', 'axis', 'center', 'radii', 'segments', 'rings', 'yawRadians'].includes(key)
    )
  )
    throw new TypeError('A curved volume requires an ellipsoid or cylinder shape');
  const center =
    shape.center === undefined
      ? Object.fromEntries(AXES.map((axis) => [axis, (bounds.min[axis] + bounds.max[axis]) / 2]))
      : shape.center;
  const radii =
    shape.radii === undefined
      ? Object.fromEntries(AXES.map((axis) => [axis, (bounds.max[axis] - bounds.min[axis]) / 2]))
      : shape.radii;
  const segments = shape.segments === undefined ? 24 : shape.segments;
  const rings = shape.rings === undefined ? 12 : shape.rings;
  const axis = shape.axis === undefined ? 'y' : shape.axis;
  const yawRadians = shape.yawRadians === undefined ? 0 : shape.yawRadians;
  const extents = {
    x: Math.abs(Math.cos(yawRadians)) * radii?.x + Math.abs(Math.sin(yawRadians)) * radii?.z,
    y: radii?.y,
    z: Math.abs(Math.sin(yawRadians)) * radii?.x + Math.abs(Math.cos(yawRadians)) * radii?.z,
  };
  if (
    !finitePoint(center) ||
    !finitePoint(radii) ||
    !Number.isFinite(yawRadians) ||
    AXES.some((axis) => radii[axis] <= 0) ||
    AXES.some(
      (axis) =>
        !Number.isFinite(center[axis] - radii[axis]) || !Number.isFinite(center[axis] + radii[axis])
    ) ||
    !Number.isInteger(segments) ||
    segments < 8 ||
    segments > 64 ||
    segments % 4 !== 0 ||
    !Number.isInteger(rings) ||
    rings < 4 ||
    rings > 32 ||
    rings % 2 !== 0 ||
    (shape.kind === 'cylinder' && (!AXES.includes(axis) || shape.rings !== undefined)) ||
    (shape.kind === 'ellipsoid' && shape.axis !== undefined) ||
    AXES.some(
      (axis) =>
        bounds.min[axis] < center[axis] - extents[axis] - 1e-7 ||
        bounds.max[axis] > center[axis] + extents[axis] + 1e-7
    )
  )
    throw new RangeError('Curved dimensions, tessellation or clipping bounds are invalid');
  return {
    kind: shape.kind,
    center: { ...center },
    radii: { ...radii },
    segments,
    ...(yawRadians ? { yawRadians } : {}),
    ...(shape.kind === 'cylinder' ? { axis } : { rings }),
  };
}

export function volumeCell(volume) {
  const { shape, bounds, id, layerId } = volume;
  const metadata = {
    id,
    layerId,
    ...(volume.structureId ? { structureId: volume.structureId } : {}),
    ...(volume.materialRole !== undefined ? { materialRole: volume.materialRole } : {}),
    ...(volume.materialColor !== undefined ? { materialColor: volume.materialColor } : {}),
    ...(volume.materialStyle !== undefined ? { materialStyle: volume.materialStyle } : {}),
    ...(volume.source !== undefined ? { source: volume.source } : {}),
  };
  if (!shape) return createBoxCell(bounds, metadata);
  if (shape.kind === 'polyhedron') {
    const center = Object.fromEntries(
      ['x', 'y', 'z'].map((axis) => [
        axis,
        shape.vertices.reduce((sum, point) => sum + point[axis] / shape.vertices.length, 0),
      ])
    );
    return clipCellToBounds(
      createConvexCell(
        shape.faces.map((face) => face.map((index) => shape.vertices[index])),
        metadata,
        center
      ),
      bounds
    );
  }
  if (shape.kind === 'prism') {
    const bottom = shape.points.map((p) => ({ ...p, y: bounds.min.y }));
    const top = shape.points.map((p) => ({ ...p, y: bounds.max.y }));
    const polygons = [bottom, top];
    for (let i = 0; i < bottom.length; i++) {
      const next = (i + 1) % bottom.length;
      polygons.push([bottom[i], top[i], top[next], bottom[next]]);
    }
    const center = {
      x: shape.points.reduce((sum, p) => sum + p.x / bottom.length, 0),
      y: (bounds.min.y + bounds.max.y) / 2,
      z: shape.points.reduce((sum, p) => sum + p.z / bottom.length, 0),
    };
    return clipCellToBounds(createConvexCell(polygons, metadata, center), bounds);
  }
  const { center, radii, segments } = shape;
  const polygons = [];
  if (shape.kind === 'ellipsoid') {
    const point = (ring, segment) => {
      const latitude = -Math.PI / 2 + (ring * Math.PI) / shape.rings;
      const angle = ((segment - 0.5) * 2 * Math.PI) / segments;
      return {
        x: center.x + radii.x * Math.cos(latitude) * Math.cos(angle),
        y: center.y + radii.y * Math.sin(latitude),
        z: center.z + radii.z * Math.cos(latitude) * Math.sin(angle),
      };
    };
    for (let ring = 0; ring < shape.rings; ring++)
      for (let segment = 0; segment < segments; segment++)
        polygons.push([
          point(ring, segment),
          point(ring + 1, segment),
          point(ring + 1, segment + 1),
          point(ring, segment + 1),
        ]);
  } else {
    const radial = AXES.filter((axis) => axis !== shape.axis);
    const point = (end, segment) => {
      const angle = ((segment - 0.5) * 2 * Math.PI) / segments;
      return {
        ...center,
        [shape.axis]: center[shape.axis] + end * radii[shape.axis],
        [radial[0]]: center[radial[0]] + radii[radial[0]] * Math.cos(angle),
        [radial[1]]: center[radial[1]] + radii[radial[1]] * Math.sin(angle),
      };
    };
    for (let segment = 0; segment < segments; segment++)
      polygons.push([
        point(-1, segment),
        point(1, segment),
        point(1, segment + 1),
        point(-1, segment + 1),
      ]);
    polygons.push(
      Array.from({ length: segments }, (_, segment) => point(-1, segment)),
      Array.from({ length: segments }, (_, segment) => point(1, segment))
    );
  }
  const cosine = Math.cos(shape.yawRadians || 0);
  const sine = Math.sin(shape.yawRadians || 0);
  const rotated = shape.yawRadians
    ? polygons.map((polygon) =>
        polygon.map((p) => ({
          x: center.x + (p.x - center.x) * cosine - (p.z - center.z) * sine,
          y: p.y,
          z: center.z + (p.x - center.x) * sine + (p.z - center.z) * cosine,
        }))
      )
    : polygons;
  return clipCellToBounds(createConvexCell(rotated, metadata, center), bounds);
}

export function volumeIntervalAt(volume, cell, x, z) {
  const { min, max } = volume.bounds;
  if (x < min.x || x >= max.x || z < min.z || z >= max.z) return null;
  let bottom = min.y;
  let top = max.y;
  if (volume.shape) {
    if (!cell) return null;
    for (const { normal, distance } of cell.planes) {
      const height = distance - normal.x * x - normal.z * z;
      if (Math.abs(normal.y) < 1e-12) {
        if (height < -1e-7) return null;
      } else if (normal.y > 0) top = Math.min(top, height / normal.y);
      else bottom = Math.max(bottom, height / normal.y);
      if (top - bottom <= 1e-7) return null;
    }
    if (Math.abs(bottom - min.y) < 1e-7) bottom = min.y;
    if (Math.abs(top - max.y) < 1e-7) top = max.y;
  }
  return { bottom, top };
}
