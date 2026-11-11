import {
  createBoxCell,
  clipCell,
  pointInsideSolid,
  boxPlanes,
} from '../../terrain/ConvexGeometry.js';
import { FootprintIndex } from '../../terrain/FootprintIndex.js';

const EPSILON = 1e-5;

function sightFootprint(points) {
  const sorted = [...points]
    .sort((a, b) => a.x - b.x || a.z - b.z)
    .filter(
      (point, index, values) =>
        index === 0 || point.x !== values[index - 1].x || point.z !== values[index - 1].z
    );
  const cross = (a, b, c) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  const half = (values) => {
    const hull = [];
    for (const point of values) {
      while (hull.length > 1 && cross(hull.at(-2), hull.at(-1), point) <= 0) hull.pop();
      hull.push(point);
    }
    return hull;
  };
  const lower = half(sorted),
    upper = half([...sorted].reverse());
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// -- Polygon clipping --

function interpolate(a, b, ratio) {
  return {
    point: a.point.clone().lerp(b.point, ratio),
    values: Object.fromEntries(
      Object.entries(a.values).map(([key, values]) => [
        key,
        values.map((value, index) => value + (b.values[key][index] - value) * ratio),
      ])
    ),
  };
}

function splitPolygon(polygon, plane) {
  const inside = [],
    outside = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i],
      b = polygon[(i + 1) % polygon.length];
    const da = plane.normal.dot(a.point) - plane.distance;
    const db = plane.normal.dot(b.point) - plane.distance;
    if (da <= 0) inside.push(a);
    if (da >= 0) outside.push(a);
    if ((da < 0 && db > 0) || (da > 0 && db < 0)) {
      const crossing = interpolate(a, b, da / (da - db));
      inside.push(crossing);
      outside.push(crossing);
    }
  }
  return { inside, outside };
}

function subtractShadow(polygon, planes) {
  if (
    planes.some((plane) =>
      polygon.every((vertex) => plane.normal.dot(vertex.point) > plane.distance)
    )
  )
    return [polygon];
  const visible = [];
  let remainder = polygon;
  for (const plane of planes) {
    const { inside, outside } = splitPolygon(remainder, plane);
    if (outside.length >= 3) visible.push(outside);
    remainder = inside;
    if (remainder.length < 3) break;
  }
  return visible;
}

// -- Sight masks --

export default class TerrainSightMask {
  constructor({ three, observerFeet = null, obstacles = [], unrestricted = false }) {
    if (
      !three ||
      !Array.isArray(obstacles) ||
      (!unrestricted &&
        (!observerFeet || !['x', 'y', 'z'].every((axis) => Number.isFinite(observerFeet[axis]))))
    )
      throw new Error('Terrain sight requires an observer and physical sight blockers');
    this.three = three;
    this.eye = unrestricted
      ? null
      : new three.Vector3(observerFeet.x, observerFeet.y + 4, observerFeet.z);
    this.index = this.eye ? new FootprintIndex(obstacles) : null;
    this.shadows = new Map();
  }

  apply(
    geometry,
    {
      toCampaign = null,
      toView = null,
      acceptTriangle = null,
      excludeSolids = [],
      excludeSolidsForTriangle = null,
    } = {}
  ) {
    if (geometry.index) {
      const expanded = geometry.toNonIndexed();
      try {
        return this.apply(expanded, {
          toCampaign,
          toView,
          acceptTriangle,
          excludeSolids,
          excludeSolidsForTriangle,
        });
      } finally {
        expanded.dispose();
      }
    }
    const three = this.three;
    const exclusions = excludeSolids.map((solid) => ({
      ...solid,
      clippingPlanes: (solid.planes ?? boxPlanes(solid)).map(({ normal, distance }) => ({
        normal: new three.Vector3(normal.x, normal.y, normal.z),
        distance: distance + 1e-4,
      })),
    }));
    const exclusionIndex = new FootprintIndex(exclusions);
    const attributes = Object.entries(geometry.attributes);
    const output = Object.fromEntries(attributes.map(([key]) => [key, []]));
    const positions = geometry.getAttribute('position');
    const transform = toCampaign ?? new three.Matrix4();
    const normal = new three.Vector3(),
      edge = new three.Vector3(),
      towardEye = new three.Vector3();
    for (let start = 0; start < positions.count; start += 3) {
      if (acceptTriangle && !acceptTriangle(start)) continue;
      const polygon = [];
      for (let index = start; index < start + 3; index++)
        polygon.push({
          point: new three.Vector3().fromBufferAttribute(positions, index).applyMatrix4(transform),
          values: Object.fromEntries(
            attributes.map(([key, attribute]) => [
              key,
              Array.from(
                attribute.array.slice(index * attribute.itemSize, (index + 1) * attribute.itemSize)
              ),
            ])
          ),
        });
      normal
        .subVectors(polygon[1].point, polygon[0].point)
        .cross(edge.subVectors(polygon[2].point, polygon[0].point));
      if (
        normal.lengthSq() < EPSILON ** 4 ||
        (this.eye && normal.dot(towardEye.subVectors(this.eye, polygon[0].point)) <= 0)
      )
        continue;
      const faceBounds = {
        min: { x: Infinity, y: Infinity, z: Infinity },
        max: { x: -Infinity, y: -Infinity, z: -Infinity },
      };
      for (const { point } of polygon)
        for (const axis of ['x', 'y', 'z']) {
          faceBounds.min[axis] = Math.min(faceBounds.min[axis], point[axis]);
          faceBounds.max[axis] = Math.max(faceBounds.max[axis], point[axis]);
        }
      let visible = [polygon];
      if (!excludeSolidsForTriangle || excludeSolidsForTriangle(start, normal))
        for (const solid of exclusionIndex.inBounds(faceBounds)) {
          if (solid.max.y < faceBounds.min.y - EPSILON || solid.min.y > faceBounds.max.y + EPSILON)
            continue;
          visible = visible.flatMap((part) => subtractShadow(part, solid.clippingPlanes));
          if (!visible.length) break;
        }
      if (!visible.length) continue;
      if (this.eye) {
        const bounds = {
          min: { x: this.eye.x, y: this.eye.y, z: this.eye.z },
          max: { x: this.eye.x, y: this.eye.y, z: this.eye.z },
        };
        for (const { point } of polygon)
          for (const axis of ['x', 'y', 'z']) {
            bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
            bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
          }
        for (const solid of this._nearbySolids(polygon)) {
          if (solid.max.y <= bounds.min.y + EPSILON || solid.min.y >= bounds.max.y - EPSILON)
            continue;
          const shadow = this._shadow(solid);
          visible = visible.flatMap((part) => subtractShadow(part, shadow));
          if (!visible.length) break;
        }
      }
      // Clip existing surfaces, not solids: solid clipping invents vertical cut caps.
      for (const part of visible)
        for (let index = 1; index < part.length - 1; index++) {
          const triangle = [part[0], part[index], part[index + 1]];
          normal
            .subVectors(triangle[1].point, triangle[0].point)
            .cross(edge.subVectors(triangle[2].point, triangle[0].point));
          if (normal.lengthSq() < EPSILON ** 4) continue;
          for (const vertex of triangle)
            for (const [key] of attributes) output[key].push(...vertex.values[key]);
        }
    }
    const result = new three.BufferGeometry();
    for (const [key, attribute] of attributes)
      result.setAttribute(key, new three.Float32BufferAttribute(output[key], attribute.itemSize));
    if (toView) result.applyMatrix4(toView);
    result.computeBoundingSphere();
    return result;
  }

  _nearbySolids(polygon) {
    const footprint = sightFootprint([this.eye, ...polygon.map((vertex) => vertex.point)]);
    let minZ = Infinity,
      maxZ = -Infinity;
    for (const point of footprint) {
      minZ = Math.min(minZ, point.z);
      maxZ = Math.max(maxZ, point.z);
    }
    const nearby = new Set();
    const first = Math.max(this.index.minZ, Math.floor(minZ / 5));
    const last = Math.min(this.index.maxZ, Math.floor(maxZ / 5));
    for (let row = first; row <= last; row++) {
      const z0 = row * 5,
        z1 = z0 + 5;
      let minX = Infinity,
        maxX = -Infinity;
      for (let index = 0; index < footprint.length; index++) {
        const a = footprint[index],
          b = footprint[(index + 1) % footprint.length];
        if (Math.min(a.z, b.z) > z1 || Math.max(a.z, b.z) < z0) continue;
        const dz = b.z - a.z;
        const xAt = (z) =>
          Math.abs(dz) < EPSILON
            ? null
            : a.x + (b.x - a.x) * Math.max(0, Math.min(1, (z - a.z) / dz));
        const x0 = xAt(z0),
          x1 = xAt(z1);
        minX = Math.min(minX, x0 ?? a.x, x1 ?? b.x);
        maxX = Math.max(maxX, x0 ?? a.x, x1 ?? b.x);
      }
      if (!Number.isFinite(minX)) continue;
      for (const solid of this.index.inBounds({
        min: { x: minX, y: 0, z: z0 },
        max: { x: maxX, y: 0, z: z1 - EPSILON },
      }))
        nearby.add(solid);
    }
    return nearby;
  }

  _shadow(solid) {
    const cached = this.shadows.get(solid);
    if (cached) return cached;
    if (pointInsideSolid(this.eye, solid)) {
      this.shadows.set(solid, []);
      return [];
    }
    let cell = createBoxCell(solid);
    if (solid.planes)
      for (const plane of solid.planes) {
        cell = clipCell(cell, plane);
        if (!cell) throw new Error('A sight blocker has no physical solid');
      }
    const three = this.three;
    const planes = cell.planes
      .filter(({ normal, distance }) => this.eye.dot(normal) > distance + EPSILON)
      .map(({ normal, distance }) => ({
        normal: new three.Vector3(normal.x, normal.y, normal.z),
        distance: distance - EPSILON,
      }));
    const points = cell.faces.flatMap((face) =>
      face.vertices.map((point) => new three.Vector3(point.x, point.y, point.z))
    );
    const seen = new Set();
    for (const face of cell.faces)
      for (let index = 0; index < face.vertices.length; index++) {
        const a = face.vertices[index],
          b = face.vertices[(index + 1) % face.vertices.length];
        const normal = new three.Vector3(a.x, a.y, a.z)
          .sub(this.eye)
          .cross(new three.Vector3(b.x, b.y, b.z).sub(this.eye));
        if (normal.lengthSq() < EPSILON ** 4) continue;
        normal.normalize();
        const distance = normal.dot(this.eye);
        let min = Infinity,
          max = -Infinity;
        for (const point of points) {
          const side = normal.dot(point) - distance;
          min = Math.min(min, side);
          max = Math.max(max, side);
        }
        if (min < -EPSILON && max > EPSILON) continue;
        if (max > EPSILON) normal.negate();
        const key = normal
          .toArray()
          .map((value) => Math.round(value / EPSILON))
          .join(',');
        if (seen.has(key)) continue;
        seen.add(key);
        planes.push({ normal, distance: normal.dot(this.eye) });
      }
    this.shadows.set(solid, planes);
    return planes;
  }
}
