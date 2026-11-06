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

export class TerrainVolumeMeshBuilder {
  build({
    geometry,
    three,
    worldUnitsPerFoot,
    visibleLayers = null,
    getColor = (_x, _z, _y, span) => span.materialColor ?? 0x777766,
    getStyle = (_x, _z, _y, span) => materialIndex(span),
  }) {
    if (!geometry || !three || !Number.isFinite(worldUnitsPerFoot) || worldUnitsPerFoot <= 0) {
      throw new Error('Volume rendering requires map geometry, Three.js and a physical scale');
    }
    if (geometry.hasCurves) {
      return buildCurved({ geometry, three, worldUnitsPerFoot, visibleLayers, getColor, getStyle });
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
    const color = new three.Color();
    const addQuad = (points, hex, shade = 1, style = 0) => {
      color.setHex(hex).multiplyScalar(shade);
      for (const index of [0, 1, 2, 0, 2, 3]) {
        positions.push(...points[index].map((value) => value * worldUnitsPerFoot));
        colors.push(color.r, color.g, color.b);
        styles.push(style);
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
          addQuad(
            [
              [x0, top, z0],
              [x0, top, z1],
              [x1, top, z1],
              [x1, top, z0],
            ],
            hex,
            1,
            style
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
              style
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
              if (high - low > 1e-7) addQuad(side.points(low, high), hex, 0.8, style);
            }
          }
        }
      }
    }
    const result = new three.BufferGeometry();
    result.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
    result.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
    result.setAttribute('constructionMaterial', new three.Float32BufferAttribute(styles, 1));
    result.computeVertexNormals();
    result.computeBoundingSphere();
    return result;
  }
}

function buildCurved({ geometry, three, worldUnitsPerFoot, visibleLayers, getColor, getStyle }) {
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
    for (let i = 1; i < face.vertices.length - 1; i++)
      for (const point of [face.vertices[0], face.vertices[i], face.vertices[i + 1]]) {
        positions.push(
          point.x * worldUnitsPerFoot,
          point.y * worldUnitsPerFoot,
          point.z * worldUnitsPerFoot
        );
        colors.push(color.r, color.g, color.b);
        styles.push(style);
      }
  }
  const result = new three.BufferGeometry();
  result.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
  result.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
  result.setAttribute('constructionMaterial', new three.Float32BufferAttribute(styles, 1));
  result.computeVertexNormals();
  result.computeBoundingSphere();
  return result;
}
