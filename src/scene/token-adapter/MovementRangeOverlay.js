const EDGES = [
  { dx: 0, dy: -1, from: [0, 0], to: [1, 0] },
  { dx: 1, dy: 0, from: [1, 0], to: [1, 1] },
  { dx: 0, dy: 1, from: [1, 1], to: [0, 1] },
  { dx: -1, dy: 0, from: [0, 1], to: [0, 0] },
];

export class MovementRangeOverlay {
  constructor(three, scene, capacity, tileSize) {
    this.three = three;
    this.scene = scene;
    this.capacity = capacity;
    this.tileSize = tileSize;
    const geometry = new three.BufferGeometry();
    const material = new three.LineBasicMaterial({
      color: 0x64b5f6,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    });
    this.mesh = new three.LineSegments(geometry, material);
    this.mesh.name = 'TokenMovementRange';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.raycast = () => {};
    scene.add(this.mesh);
  }

  update(range, spatial) {
    const positions = [];
    const corners = new Map();
    const wallEdges = new Map();
    const wallCorners = new Set();
    const planes = new Map();
    for (const face of range.walls?.values() || []) {
      const dx = face.high.gridX - face.low.gridX;
      const dy = face.high.gridY - face.low.gridY;
      const x = (face.low.gridX + face.high.gridX + 1) * 0.5;
      const y = (face.low.gridY + face.high.gridY + 1) * 0.5;
      const from = dx ? [x, face.low.gridY] : [face.low.gridX, y];
      const to = dx ? [x, face.low.gridY + 1] : [face.low.gridX + 1, y];
      const along = dx ? face.low.gridY : face.low.gridX;
      const plane = `${dx},${dy}:${dx ? x : y}`;
      const intervals = mergeIntervals(face.bands.map((band) => [band.minHeight, band.maxHeight]));
      const wall = { face, dx, dy, from, to, along, plane, intervals };
      wallEdges.set(
        `${face.low.gridX},${face.low.gridY}>${face.high.gridX},${face.high.gridY}`,
        wall
      );
      wallEdges.set(
        `${face.high.gridX},${face.high.gridY}>${face.low.gridX},${face.low.gridY}`,
        wall
      );
      for (const point of [from, to]) wallCorners.add(point.join(','));
      if (!planes.has(plane)) planes.set(plane, new Map());
      planes.get(plane).set(along, wall);
    }
    const addPoint = (gridX, gridY, height) => {
      const world = spatial.gridToWorld(gridX, gridY, height);
      const y = world.y + this.tileSize * 0.008;
      positions.push(world.x, y, world.z);
      const key = `${gridX},${gridY}`;
      if (!corners.has(key)) corners.set(key, { x: world.x, z: world.z, heights: new Set() });
      corners.get(key).heights.add(y);
    };
    for (const cell of range.tiles.values()) {
      for (const edge of EDGES) {
        const neighborKey = `${cell.gridX + edge.dx},${cell.gridY + edge.dy}`;
        const wall = wallEdges.get(`${cell.gridX},${cell.gridY}>${neighborKey}`);
        if (
          wall?.intervals.some(
            ([low, high]) => cell.height >= low - 1e-9 && cell.height <= high + 1e-9
          )
        )
          continue;
        if (range.tiles.has(neighborKey) && !wall) continue;
        addPoint(cell.gridX + edge.from[0], cell.gridY + edge.from[1], cell.height);
        addPoint(cell.gridX + edge.to[0], cell.gridY + edge.to[1], cell.height);
      }
    }
    // Join perimeter sections where their terrain heights meet a vertical ledge.
    for (const [key, corner] of corners) {
      if (wallCorners.has(key)) continue;
      const heights = [...corner.heights].sort((a, b) => a - b);
      for (let i = 1; i < heights.length; i++) {
        if (heights[i] - heights[i - 1] <= 1e-6) continue;
        positions.push(corner.x, heights[i - 1], corner.z, corner.x, heights[i], corner.z);
      }
    }
    const addWallPoint = (wall, point, height) => {
      const world = spatial.gridToWorld(point[0], point[1], height);
      const offset = this.tileSize * 0.008;
      positions.push(world.x - wall.dx * offset, world.y, world.z - wall.dy * offset);
    };
    for (const strip of planes.values()) {
      for (const wall of strip.values()) {
        const { face, from, to } = wall;
        for (const [low, high] of wall.intervals) {
          const joinsLow =
            Math.abs(low - face.low.height) < 1e-9 &&
            range.tiles.has(`${face.low.gridX},${face.low.gridY}`);
          const joinsHigh =
            Math.abs(high - face.high.height) < 1e-9 &&
            range.tiles.has(`${face.high.gridX},${face.high.gridY}`);
          if (!joinsLow) {
            addWallPoint(wall, from, low);
            addWallPoint(wall, to, low);
          }
          if (!joinsHigh && high - low > 1e-9) {
            addWallPoint(wall, from, high);
            addWallPoint(wall, to, high);
          }
          for (const [point, neighbor] of [
            [from, strip.get(wall.along - 1)],
            [to, strip.get(wall.along + 1)],
          ]) {
            for (const [start, end] of subtractIntervals([low, high], neighbor?.intervals || [])) {
              addWallPoint(wall, point, start);
              addWallPoint(wall, point, end);
            }
          }
        }
      }
    }
    const geometry = new this.three.BufferGeometry();
    geometry.setAttribute('position', new this.three.Float32BufferAttribute(positions, 3));
    if (positions.length) geometry.computeBoundingSphere();
    this.mesh.geometry.dispose();
    this.mesh.geometry = geometry;
    this.mesh.visible = positions.length > 0;
  }

  hide() {
    this.mesh.visible = false;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

function mergeIntervals(intervals) {
  const merged = [];
  for (const [low, high] of intervals.sort((a, b) => a[0] - b[0])) {
    const last = merged.at(-1);
    if (last && low <= last[1] + 1e-9) last[1] = Math.max(last[1], high);
    else merged.push([low, high]);
  }
  return merged;
}

function subtractIntervals([low, high], intervals) {
  const result = [];
  let cursor = low;
  for (const [start, end] of intervals) {
    if (start > cursor + 1e-9) result.push([cursor, Math.min(start, high)]);
    cursor = Math.max(cursor, end);
    if (cursor >= high - 1e-9) break;
  }
  if (cursor < high - 1e-9) result.push([cursor, high]);
  return result.filter(([start, end]) => end > start + 1e-9);
}
