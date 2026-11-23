import { clipCell } from '../../terrain/ConvexGeometry.js';
import { CONSTRUCTION_MATERIALS } from '../../config/biome/ConstructionPalettes.js';

function materialIndex(span) {
  const index = CONSTRUCTION_MATERIALS[span.materialStyle ?? 'none'];
  if (!Number.isInteger(index)) throw new Error('The rendered construction material is invalid');
  return index;
}

function exposedIntervals(bottom, top, neighbors) {
  let intervals = [[bottom, top]];
  for (const neighbor of neighbors) {
    intervals = intervals.flatMap(([low, high]) => {
      if (neighbor.top <= low || neighbor.bottom >= high) return [[low, high]];
      const result = [];
      if (neighbor.bottom > low) result.push([low, neighbor.bottom]);
      if (neighbor.top < high) result.push([neighbor.top, high]);
      return result;
    });
  }
  return intervals;
}

function clipPolygonAxis(vertices, axis, boundary, keepGreater) {
  const result = [];
  for (let index = 0; index < vertices.length; index++) {
    const first = vertices[index];
    const second = vertices[(index + 1) % vertices.length];
    const firstDistance = (first[axis] - boundary) * (keepGreater ? 1 : -1);
    const secondDistance = (second[axis] - boundary) * (keepGreater ? 1 : -1);
    const firstInside = firstDistance >= -1e-8;
    const secondInside = secondDistance >= -1e-8;
    if (firstInside) result.push(first);
    if (firstInside === secondInside) continue;
    const ratio = firstDistance / (firstDistance - secondDistance);
    result.push({
      x: first.x + (second.x - first.x) * ratio,
      y: first.y + (second.y - first.y) * ratio,
      z: first.z + (second.z - first.z) * ratio,
    });
  }
  return result;
}

function splitLintelFace(polygon, bounds) {
  let inside = polygon.map((point) =>
    Array.isArray(point) ? { x: point[0], y: point[1], z: point[2] } : point
  );
  const result = [];
  for (const [axis, boundary, keepGreater] of [
    ['x', bounds.min.x, true],
    ['x', bounds.max.x, false],
    ['z', bounds.min.z, true],
    ['z', bounds.max.z, false],
  ]) {
    const distances = inside.map((point) => (point[axis] - boundary) * (keepGreater ? 1 : -1));
    if (!distances.some((distance) => distance < -1e-8)) continue;
    if (!distances.some((distance) => distance > 1e-8)) {
      result.push({ points: inside, lintel: false });
      return result;
    }
    const outside = clipPolygonAxis(inside, axis, boundary, !keepGreater);
    if (outside.length >= 3) result.push({ points: outside, lintel: false });
    inside = clipPolygonAxis(inside, axis, boundary, keepGreater);
    if (inside.length < 3) return result;
  }
  result.push({ points: inside, lintel: true });
  return result;
}

function splitBoundaryFace(polygon, cell, geometry, getBoundaryWallCell) {
  const points = polygon.map((point) =>
    Array.isArray(point) ? { x: point[0], y: point[1], z: point[2] } : point
  );
  const ranges = ['x', 'z'].map((axis) => {
    const minimum = Math.min(...points.map((point) => point[axis]));
    const maximum = Math.max(...points.map((point) => point[axis]));
    const extent =
      (axis === 'x' ? geometry.widthFeet : geometry.depthFeet) ??
      geometry.getPartition()[axis].at(-1);
    if (maximum - minimum < 1e-8) {
      const owner = (cell.bounds.min[axis] + cell.bounds.max[axis]) / 2;
      const inside = minimum + Math.sign(owner - minimum) * 1e-7;
      const index = Math.max(0, Math.min(Math.ceil(extent / 5) - 1, Math.floor(inside / 5)));
      return [index, index];
    }
    return [
      Math.max(0, Math.floor((minimum + 1e-8) / 5)),
      Math.min(Math.ceil(extent / 5) - 1, Math.floor((maximum - 1e-8) / 5)),
    ];
  });
  const pieces = [];
  for (let z = ranges[1][0]; z <= ranges[1][1]; z++)
    for (let x = ranges[0][0]; x <= ranges[0][1]; x++) {
      let clipped = points;
      for (const [axis, bound, greater] of [
        ['x', x * 5, true],
        ['x', (x + 1) * 5, false],
        ['z', z * 5, true],
        ['z', (z + 1) * 5, false],
      ])
        clipped = clipPolygonAxis(clipped, axis, bound, greater);
      if (clipped.length >= 3)
        pieces.push({ points: clipped, boundaryCell: getBoundaryWallCell(x, z, cell) });
    }
  return pieces;
}

export class TerrainVolumeMeshBuilder {
  build({
    geometry,
    three,
    worldUnitsPerFoot,
    visibleLayers = null,
    getColor = (_x, _z, _y, span) => span.materialColor ?? 0x777766,
    getStyle = (_x, _z, _y, span) => materialIndex(span),
    recordRoofSurfaces = false,
    clipFace = null,
    getBoundaryWallCell = null,
    getDungeonLintelBounds = null,
  }) {
    if (!geometry || !three || !Number.isFinite(worldUnitsPerFoot) || worldUnitsPerFoot <= 0) {
      throw new Error('Volume rendering requires map geometry, Three.js and a physical scale');
    }
    if (geometry.hasCurves) {
      return buildCurved({
        geometry,
        three,
        worldUnitsPerFoot,
        visibleLayers,
        getColor,
        getStyle,
        recordRoofSurfaces,
        clipFace,
        getBoundaryWallCell,
        getDungeonLintelBounds,
      });
    }
    const axes = geometry.getPartition();
    const columns = axes.z
      .slice(1)
      .map((z, j) =>
        axes.x
          .slice(1)
          .map((x, i) => geometry.getSolidSpansAt((axes.x[i] + x) / 2, (axes.z[j] + z) / 2))
      );
    const allSpans = columns.flat(2);
    const floor = Math.min(0, ...allSpans.map((span) => span.top)) - 5;
    const positions = [];
    const colors = [];
    const styles = [];
    const roofSurfaces = [];
    const boundaryCells = getBoundaryWallCell ? [] : null;
    const lintelFaces = getDungeonLintelBounds ? [] : null;
    const color = new three.Color();
    const addQuad = (
      points,
      hex,
      shade = 1,
      style = 0,
      roof = false,
      span = null,
      boundaryCell = 0
    ) => {
      color.setHex(hex).multiplyScalar(shade);
      const polygons = clipFace ? clipFace(span, points) : [points];
      for (const polygon of polygons) {
        if (polygon.length < 3) continue;
        const bounds = getDungeonLintelBounds?.(span);
        const parts = bounds
          ? splitLintelFace(polygon, bounds)
          : [{ points: polygon, lintel: false }];
        for (const part of parts)
          for (let index = 1; index < part.points.length - 1; index++)
            for (const point of [part.points[0], part.points[index], part.points[index + 1]]) {
              const values = Array.isArray(point) ? point : [point.x, point.y, point.z];
              positions.push(...values.map((value) => value * worldUnitsPerFoot));
              colors.push(color.r, color.g, color.b);
              styles.push(style);
              if (boundaryCells) boundaryCells.push(boundaryCell);
              if (lintelFaces) lintelFaces.push(part.lintel ? 1 : 0);
              if (recordRoofSurfaces) roofSurfaces.push(roof ? 1 : 0);
            }
      }
    };
    const visible = (span) => visibleLayers === null || visibleLayers.includes(span.layerId);
    for (let j = 0; j < columns.length; j++) {
      for (let i = 0; i < columns[j].length; i++) {
        const x0 = axes.x[i],
          x1 = axes.x[i + 1];
        const z0 = axes.z[j],
          z1 = axes.z[j + 1];
        for (const span of columns[j][i]) {
          if (!visible(span)) continue;
          const top = span.top;
          const bottom = Number.isFinite(span.bottom) ? span.bottom : floor;
          const hex = getColor((x0 + x1) / 2, (z0 + z1) / 2, top, span);
          const style = getStyle((x0 + x1) / 2, (z0 + z1) / 2, top, span);
          const boundaryCell = getBoundaryWallCell
            ? getBoundaryWallCell(Math.floor((x0 + x1) / 10), Math.floor((z0 + z1) / 10), span)
            : 0;
          addQuad(
            [
              [x0, top, z0],
              [x0, top, z1],
              [x1, top, z1],
              [x1, top, z0],
            ],
            hex,
            1,
            style,
            span.layerId === 'roof',
            span,
            boundaryCell
          );
          if (Number.isFinite(span.bottom)) {
            addQuad(
              [
                [x0, bottom, z1],
                [x0, bottom, z0],
                [x1, bottom, z0],
                [x1, bottom, z1],
              ],
              hex,
              0.65,
              style,
              span.layerId === 'roof',
              span,
              boundaryCell
            );
          }
          const sides = [
            {
              neighbors: columns[j - 1]?.[i] || [],
              points: (low, high) => [
                [x0, low, z0],
                [x0, high, z0],
                [x1, high, z0],
                [x1, low, z0],
              ],
            },
            {
              neighbors: columns[j + 1]?.[i] || [],
              points: (low, high) => [
                [x1, low, z1],
                [x1, high, z1],
                [x0, high, z1],
                [x0, low, z1],
              ],
            },
            {
              neighbors: columns[j]?.[i - 1] || [],
              points: (low, high) => [
                [x0, low, z1],
                [x0, high, z1],
                [x0, high, z0],
                [x0, low, z0],
              ],
            },
            {
              neighbors: columns[j]?.[i + 1] || [],
              points: (low, high) => [
                [x1, low, z0],
                [x1, high, z0],
                [x1, high, z1],
                [x1, low, z1],
              ],
            },
          ];
          for (const side of sides) {
            for (const [low, high] of exposedIntervals(bottom, top, side.neighbors)) {
              if (high - low > 1e-7)
                addQuad(
                  side.points(low, high),
                  hex,
                  0.8,
                  style,
                  span.layerId === 'roof',
                  span,
                  boundaryCell
                );
            }
          }
        }
      }
    }
    const result = new three.BufferGeometry();
    result.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
    result.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
    result.setAttribute('constructionMaterial', new three.Float32BufferAttribute(styles, 1));
    if (boundaryCells)
      result.setAttribute('boundaryWallCell', new three.Float32BufferAttribute(boundaryCells, 1));
    if (lintelFaces)
      result.setAttribute('dungeonLintel', new three.Float32BufferAttribute(lintelFaces, 1));
    if (recordRoofSurfaces)
      result.setAttribute('roofSurface', new three.Float32BufferAttribute(roofSurfaces, 1));
    result.computeVertexNormals();
    result.computeBoundingSphere();
    return result;
  }
}

function buildCurved({
  geometry,
  three,
  worldUnitsPerFoot,
  visibleLayers,
  getColor,
  getStyle,
  recordRoofSurfaces = false,
  clipFace = null,
  getBoundaryWallCell = null,
  getDungeonLintelBounds = null,
}) {
  const cells = geometry.getSolidCells();
  // Cutaways already have finite bottoms; only bottomless earth needs a render cap.
  const openBottom = (cell) =>
    Number.isFinite(cell.unboundedBottomFeet) &&
    Math.abs(cell.bounds.min.y - cell.unboundedBottomFeet) < 1e-6;
  let floor = 0;
  for (const cell of cells) {
    floor = Math.min(floor, cell.bounds.max.y);
    if (!openBottom(cell)) floor = Math.min(floor, cell.bounds.min.y);
  }
  floor -= 5;
  const faces = new Map();
  const coordinate = (point) =>
    [point.x, point.y, point.z].map((value) => Math.round(value * 1e6)).join(',');
  for (const original of cells) {
    if (visibleLayers !== null && !visibleLayers.includes(original.layerId)) continue;
    const cell = openBottom(original)
      ? clipCell(original, { normal: { x: 0, y: -1, z: 0 }, distance: -floor })
      : original;
    if (!cell) continue;
    for (const face of cell.faces) {
      const key = face.vertices.map(coordinate).sort().join(';');
      const previous = faces.get(key);
      if (previous === null) continue;
      if (
        previous &&
        previous.face.plane.normal.x * face.plane.normal.x +
          previous.face.plane.normal.y * face.plane.normal.y +
          previous.face.plane.normal.z * face.plane.normal.z <
          -0.99
      ) {
        faces.set(key, null);
      } else faces.set(key, { face, cell });
    }
  }
  const positions = [];
  const colors = [];
  const styles = [];
  const roofSurfaces = [];
  const boundaryCells = getBoundaryWallCell ? [] : null;
  const lintelFaces = getDungeonLintelBounds ? [] : null;
  const color = new three.Color();
  for (const entry of faces.values()) {
    if (!entry) continue;
    const { face, cell } = entry;
    const center = { x: 0, y: 0, z: 0 };
    for (const point of face.vertices)
      for (const axis of ['x', 'y', 'z']) center[axis] += point[axis] / face.vertices.length;
    const shade = 0.8 + face.plane.normal.y * 0.15;
    color.setHex(getColor(center.x, center.z, center.y, cell)).multiplyScalar(shade);
    const style = getStyle(center.x, center.z, center.y, cell);
    const boundaryCell = getBoundaryWallCell
      ? getBoundaryWallCell(
          Math.floor((cell.bounds.min.x + cell.bounds.max.x) / 10),
          Math.floor((cell.bounds.min.z + cell.bounds.max.z) / 10),
          cell
        )
      : 0;
    const polygons = clipFace ? clipFace(cell, face.vertices) : [face.vertices];
    const lintelBounds = getDungeonLintelBounds?.(cell);
    const parts = polygons.flatMap((polygon) =>
      lintelBounds ? splitLintelFace(polygon, lintelBounds) : [{ points: polygon, lintel: false }]
    );
    const pieces = parts.flatMap((part) =>
      boundaryCell && getBoundaryWallCell
        ? splitBoundaryFace(part.points, cell, geometry, getBoundaryWallCell).map((piece) => ({
            ...piece,
            lintel: part.lintel,
          }))
        : [{ points: part.points, boundaryCell, lintel: part.lintel }]
    );
    for (const piece of pieces)
      for (let i = 1; i < piece.points.length - 1; i++)
        for (const point of [piece.points[0], piece.points[i], piece.points[i + 1]]) {
          positions.push(
            point.x * worldUnitsPerFoot,
            point.y * worldUnitsPerFoot,
            point.z * worldUnitsPerFoot
          );
          colors.push(color.r, color.g, color.b);
          styles.push(style);
          if (boundaryCells) boundaryCells.push(piece.boundaryCell);
          if (lintelFaces) lintelFaces.push(piece.lintel ? 1 : 0);
          if (recordRoofSurfaces) roofSurfaces.push(cell.layerId === 'roof' ? 1 : 0);
        }
  }
  const result = new three.BufferGeometry();
  result.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  result.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
  result.setAttribute('constructionMaterial', new three.Float32BufferAttribute(styles, 1));
  if (boundaryCells)
    result.setAttribute('boundaryWallCell', new three.Float32BufferAttribute(boundaryCells, 1));
  if (lintelFaces)
    result.setAttribute('dungeonLintel', new three.Float32BufferAttribute(lintelFaces, 1));
  if (recordRoofSurfaces)
    result.setAttribute('roofSurface', new three.Float32BufferAttribute(roofSurfaces, 1));
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}
