export const GEOMETRY_EPSILON = 1e-7;
const AXES = ['x', 'y', 'z'];
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const minus = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const unit = (value) => {
  const length = Math.hypot(value.x, value.y, value.z);
  return { x: value.x / length, y: value.y / length, z: value.z / length };
};
const samePoint = (a, b) => AXES.every((axis) => Math.abs(a[axis] - b[axis]) < GEOMETRY_EPSILON);

function cleanPolygon(points) {
  const result = points.filter((point, i) => !samePoint(point, points[(i + 1) % points.length]));
  return result.length >= 3 ? result : [];
}

function faceFromPoints(points, interior) {
  let vertices = cleanPolygon(points);
  if (vertices.length < 3) return null;
  const edge = minus(vertices[1], vertices[0]);
  let normal;
  for (let i = 2; i < vertices.length; i++) {
    const candidate = cross(edge, minus(vertices[i], vertices[0]));
    if (Math.hypot(candidate.x, candidate.y, candidate.z) > GEOMETRY_EPSILON) {
      normal = unit(candidate);
      break;
    }
  }
  if (!normal) return null;
  if (interior && dot(normal, minus(vertices[0], interior)) < 0) {
    vertices = [...vertices].reverse();
    normal = { x: -normal.x, y: -normal.y, z: -normal.z };
  }
  return { vertices, plane: { normal, distance: dot(normal, vertices[0]) } };
}

function cellFromFaces(faces, metadata) {
  if (faces.length < 4) return null;
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (const face of faces)
    for (const point of face.vertices)
      for (const axis of AXES) {
        bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
        bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
      }
  if (AXES.some((axis) => bounds.max[axis] - bounds.min[axis] <= GEOMETRY_EPSILON)) return null;
  return { ...metadata, bounds, faces, planes: faces.map((face) => face.plane) };
}

export function createConvexCell(polygons, metadata = {}, interior = null) {
  return cellFromFaces(
    polygons.map((points) => faceFromPoints(points, interior)).filter(Boolean),
    metadata
  );
}

export function boxPlanes({ min, max }) {
  return AXES.flatMap((axis) => [
    { normal: { x: 0, y: 0, z: 0, [axis]: -1 }, distance: -min[axis] },
    { normal: { x: 0, y: 0, z: 0, [axis]: 1 }, distance: max[axis] },
  ]);
}

export function createBoxCell({ min, max }, metadata = {}) {
  const p = (x, y, z) => ({ x, y, z });
  return createConvexCell(
    [
      [
        p(min.x, max.y, min.z),
        p(min.x, max.y, max.z),
        p(max.x, max.y, max.z),
        p(max.x, max.y, min.z),
      ],
      [
        p(min.x, min.y, max.z),
        p(min.x, min.y, min.z),
        p(max.x, min.y, min.z),
        p(max.x, min.y, max.z),
      ],
      [
        p(min.x, min.y, min.z),
        p(min.x, max.y, min.z),
        p(max.x, max.y, min.z),
        p(max.x, min.y, min.z),
      ],
      [
        p(max.x, min.y, max.z),
        p(max.x, max.y, max.z),
        p(min.x, max.y, max.z),
        p(min.x, min.y, max.z),
      ],
      [
        p(min.x, min.y, max.z),
        p(min.x, max.y, max.z),
        p(min.x, max.y, min.z),
        p(min.x, min.y, min.z),
      ],
      [
        p(max.x, min.y, min.z),
        p(max.x, max.y, min.z),
        p(max.x, max.y, max.z),
        p(max.x, min.y, max.z),
      ],
    ],
    metadata
  );
}

export function boundsOverlap(a, b, epsilon = GEOMETRY_EPSILON) {
  return (
    a.min.x < b.max.x - epsilon &&
    a.max.x > b.min.x + epsilon &&
    a.min.y < b.max.y - epsilon &&
    a.max.y > b.min.y + epsilon &&
    a.min.z < b.max.z - epsilon &&
    a.max.z > b.min.z + epsilon
  );
}

function clipPolygon(vertices, plane) {
  const result = [];
  let previous = vertices.at(-1);
  let previousDistance = dot(plane.normal, previous) - plane.distance;
  for (const point of vertices) {
    const distance = dot(plane.normal, point) - plane.distance;
    if (distance <= 0 !== previousDistance <= 0) {
      const ratio = previousDistance / (previousDistance - distance);
      result.push({
        x: previous.x + (point.x - previous.x) * ratio,
        y: previous.y + (point.y - previous.y) * ratio,
        z: previous.z + (point.z - previous.z) * ratio,
      });
    }
    if (distance <= 0) result.push(point);
    previous = point;
    previousDistance = distance;
  }
  return cleanPolygon(result);
}

function capPolygon(points, normal) {
  const unique = [];
  for (const point of points)
    if (!unique.some((other) => samePoint(point, other))) unique.push(point);
  if (unique.length < 3) return [];
  const center = { x: 0, y: 0, z: 0 };
  for (const point of unique) for (const axis of AXES) center[axis] += point[axis] / unique.length;
  const reference = Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = unit(cross(reference, normal));
  const v = cross(normal, u);
  const angle = (point) => {
    const relative = minus(point, center);
    return Math.atan2(dot(relative, v), dot(relative, u));
  };
  return unique.sort((a, b) => angle(a) - angle(b));
}

export function clipCell(cell, plane) {
  if (!cell) return null;
  let inside = false;
  let outside = false;
  for (const face of cell.faces)
    for (const point of face.vertices) {
      const distance = dot(plane.normal, point) - plane.distance;
      if (distance < -GEOMETRY_EPSILON) inside = true;
      if (distance > GEOMETRY_EPSILON) outside = true;
    }
  if (!outside) return cell;
  if (!inside) return null;
  const faces = [];
  const boundary = [];
  for (const face of cell.faces) {
    const vertices = clipPolygon(face.vertices, plane);
    if (vertices.length < 3) continue;
    faces.push({ ...face, vertices });
    for (const point of vertices)
      if (Math.abs(dot(plane.normal, point) - plane.distance) < GEOMETRY_EPSILON * 10)
        boundary.push(point);
  }
  const cap = capPolygon(boundary, plane.normal);
  if (cap.length >= 3) faces.push({ vertices: cap, plane });
  return cellFromFaces(faces, {
    id: cell.id,
    layerId: cell.layerId,
    ...(cell.unboundedBottomFeet !== undefined
      ? { unboundedBottomFeet: cell.unboundedBottomFeet }
      : {}),
    ...(cell.structureId ? { structureId: cell.structureId } : {}),
    ...(cell.materialRole !== undefined ? { materialRole: cell.materialRole } : {}),
    ...(cell.materialColor !== undefined ? { materialColor: cell.materialColor } : {}),
    ...(cell.materialStyle !== undefined ? { materialStyle: cell.materialStyle } : {}),
    ...(cell.source !== undefined ? { source: cell.source } : {}),
  });
}

export function clipCellToBounds(cell, bounds) {
  if (!cell || !boundsOverlap(cell.bounds, bounds)) return null;
  for (const plane of boxPlanes(bounds)) {
    cell = clipCell(cell, plane);
    if (!cell) break;
  }
  return cell;
}

export function subtractCell(cell, cutter) {
  if (!boundsOverlap(cell.bounds, cutter.bounds)) return [cell];
  const outside = [];
  let remaining = cell;
  for (const plane of cutter.planes) {
    const fragment = clipCell(remaining, {
      normal: { x: -plane.normal.x, y: -plane.normal.y, z: -plane.normal.z },
      distance: -plane.distance,
    });
    if (fragment) outside.push(fragment);
    remaining = clipCell(remaining, plane);
    if (!remaining) break;
  }
  return outside;
}

export function boundsIntersectSolid(bounds, solid, epsilon = GEOMETRY_EPSILON) {
  if (!boundsOverlap(bounds, solid, epsilon)) return false;
  if (!solid.planes) return true;
  const crossing = [];
  for (const plane of solid.planes) {
    let low = 0;
    let high = 0;
    for (const axis of AXES) {
      const a = plane.normal[axis] * bounds.min[axis];
      const b = plane.normal[axis] * bounds.max[axis];
      low += Math.min(a, b);
      high += Math.max(a, b);
    }
    if (low >= plane.distance - GEOMETRY_EPSILON) return false;
    if (high > plane.distance + GEOMETRY_EPSILON) crossing.push(plane);
  }
  if (!crossing.length) return true;
  let intersection = createBoxCell({
    min: Object.fromEntries(
      AXES.map((axis) => [axis, Math.max(bounds.min[axis], solid.min[axis])])
    ),
    max: Object.fromEntries(
      AXES.map((axis) => [axis, Math.min(bounds.max[axis], solid.max[axis])])
    ),
  });
  for (const plane of crossing) {
    intersection = clipCell(intersection, plane);
    if (!intersection) return false;
  }
  return true;
}

export function sweptBodyCell(start, end, radius, bottom, top) {
  const points = [start, end].flatMap((point) =>
    [-radius, radius].flatMap((x) =>
      [-radius, radius].map((z) => ({ x: point.x + x, z: point.z + z }))
    )
  );
  points.sort((a, b) => a.x - b.x || a.z - b.z);
  const turn = (a, b, c) => (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
  const half = (values) => {
    const result = [];
    for (const point of values) {
      while (result.length > 1 && turn(result.at(-2), result.at(-1), point) <= GEOMETRY_EPSILON)
        result.pop();
      result.push(point);
    }
    return result;
  };
  const hull = [...half(points).slice(0, -1), ...half([...points].reverse()).slice(0, -1)];
  const low = hull.map((p) => ({ ...p, y: bottom })),
    high = hull.map((p) => ({ ...p, y: top }));
  const polygons = [low, high];
  for (let i = 0; i < low.length; i++) {
    const j = (i + 1) % low.length;
    polygons.push([low[i], high[i], high[j], low[j]]);
  }
  return createConvexCell(
    polygons,
    {},
    {
      x: (start.x + end.x) / 2,
      y: (bottom + top) / 2,
      z: (start.z + end.z) / 2,
    }
  );
}

export function cellIntersectsSolid(cell, solid) {
  let intersection = clipCellToBounds(cell, solid);
  if (!intersection) return false;
  for (const plane of solid.planes || []) {
    intersection = clipCell(intersection, plane);
    if (!intersection) return false;
  }
  return true;
}

export function pointInsideSolid(point, solid) {
  return (
    AXES.every((axis) => point[axis] >= solid.min[axis] && point[axis] <= solid.max[axis]) &&
    (solid.planes || []).every(
      ({ normal, distance }) => dot(normal, point) <= distance + GEOMETRY_EPSILON
    )
  );
}

export function segmentIntersectsSolid(start, end, solid) {
  let low = 0;
  let high = 1;
  for (const axis of AXES) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < GEOMETRY_EPSILON) {
      if (start[axis] < solid.min[axis] || start[axis] > solid.max[axis]) return false;
    } else {
      const a = (solid.min[axis] - start[axis]) / delta;
      const b = (solid.max[axis] - start[axis]) / delta;
      low = Math.max(low, Math.min(a, b));
      high = Math.min(high, Math.max(a, b));
      if (low > high) return false;
    }
  }
  const direction = minus(end, start);
  for (const { normal, distance } of solid.planes || []) {
    const offset = dot(normal, start) - distance;
    const delta = dot(normal, direction);
    if (Math.abs(delta) < GEOMETRY_EPSILON) {
      if (offset > GEOMETRY_EPSILON) return false;
    } else {
      const ratio = -offset / delta;
      if (delta > 0) high = Math.min(high, ratio);
      else low = Math.max(low, ratio);
      if (low > high) return false;
    }
  }
  return high > GEOMETRY_EPSILON && low < 1 - GEOMETRY_EPSILON;
}
