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
  build({ geometry, three, worldUnitsPerFoot, visibleLayers = null, getColor = () => 0x777766 }) {
    if (!geometry || !three || !Number.isFinite(worldUnitsPerFoot) || worldUnitsPerFoot <= 0) {
      throw new Error('Volume rendering requires map geometry, Three.js and a physical scale');
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
    const color = new three.Color();
    const addQuad = (points, hex, shade = 1) => {
      color.setHex(hex).multiplyScalar(shade);
      for (const index of [0, 1, 2, 0, 2, 3]) {
        positions.push(...points[index].map((value) => value * worldUnitsPerFoot));
        colors.push(color.r, color.g, color.b);
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
          addQuad(
            [
              [x0, top, z0],
              [x0, top, z1],
              [x1, top, z1],
              [x1, top, z0],
            ],
            hex
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
              0.65
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
              if (high - low > 1e-7) addQuad(side.points(low, high), hex, 0.8);
            }
          }
        }
      }
    }
    const result = new three.BufferGeometry();
    result.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
    result.setAttribute('color', new three.Float32BufferAttribute(colors, 3));
    result.computeVertexNormals();
    result.computeBoundingSphere();
    return result;
  }
}
