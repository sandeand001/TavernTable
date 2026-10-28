import * as three from 'three';
import { MovementRangeOverlay } from '../../../../src/scene/token-adapter/MovementRangeOverlay.js';

function range(cells) {
  return {
    tiles: new Map(
      cells.map(([gridX, gridY, height = 0]) => [`${gridX},${gridY}`, { gridX, gridY, height }])
    ),
  };
}

function segments(scene) {
  const object = scene.getObjectByName('TokenMovementRange');
  expect(object.isLineSegments).toBe(true);
  expect(object.isInstancedMesh).not.toBe(true);
  const positions = object.geometry.attributes.position;
  return Array.from({ length: positions.count / 2 }, (_, index) => [
    new three.Vector3().fromBufferAttribute(positions, index * 2),
    new three.Vector3().fromBufferAttribute(positions, index * 2 + 1),
  ]);
}

function key([a, b]) {
  return [`${a.x},${a.z}`, `${b.x},${b.z}`].sort().join('|');
}

describe('Reachable-area perimeter geometry', () => {
  let scene;
  let overlay;
  const spatial = { gridToWorld: (x, y, height) => ({ x, y: height * 0.5, z: y }) };

  beforeEach(() => {
    scene = new three.Scene();
    overlay = new MovementRangeOverlay(three, scene, 100, 1);
  });

  afterEach(() => overlay.dispose());

  test('two adjacent cells have one outer perimeter and no shared interior edge', () => {
    overlay.update(
      range([
        [0, 0],
        [1, 0],
      ]),
      spatial
    );
    const lines = segments(scene);
    expect(lines).toHaveLength(6);
    expect(lines.map(key)).not.toContain('1,0|1,1');
  });

  test('an L-shaped range outlines its shape rather than a rectangular bounding box', () => {
    overlay.update(
      range([
        [0, 0],
        [1, 0],
        [0, 1],
      ]),
      spatial
    );
    const lines = segments(scene);
    expect(lines).toHaveLength(8);
    expect(lines.map(key)).not.toContain('0,1|1,1');
    expect(lines.map(key)).not.toContain('1,0|1,1');
    expect(lines.map(key)).toContain('1,1|2,1');
    expect(lines.map(key)).toContain('1,1|1,2');
  });

  test('unreachable holes receive their own outline without filling the surrounding area', () => {
    const cells = [];
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < 3; x++) {
        if (x !== 1 || y !== 1) cells.push([x, y]);
      }
    overlay.update(range(cells), spatial);
    const lines = segments(scene);
    expect(lines).toHaveLength(16);
    expect(lines.map(key)).toEqual(
      expect.arrayContaining(['1,1|2,1', '2,1|2,2', '1,2|2,2', '1,1|1,2'])
    );
  });

  test('boundary edges follow terrain height and connect vertically at a ledge', () => {
    overlay.update(
      range([
        [0, 0, 0],
        [1, 0, 2],
      ]),
      spatial
    );
    const lines = segments(scene);
    const vertical = lines.filter(([a, b]) => a.x === b.x && a.z === b.z);
    expect(lines).toHaveLength(8);
    expect(vertical).toHaveLength(2);
    for (const [a, b] of vertical) {
      expect(a.x).toBe(1);
      expect(Math.min(a.y, b.y)).toBeCloseTo(0.008);
      expect(Math.max(a.y, b.y)).toBeCloseTo(1.008);
    }
  });

  function wallRange(cells, bands) {
    const result = range(cells);
    result.walls = new Map(
      bands.map(([row, minHeight, maxHeight]) => [
        `0,${row}>1,${row}`,
        {
          low: { gridX: 0, gridY: row, height: 0 },
          high: { gridX: 1, gridY: row, height: 20 },
          bands: [{ minHeight, maxHeight }],
        },
      ])
    );
    return result;
  }

  test('the perimeter continues from ground up a partially reachable sheer wall', () => {
    overlay.update(wallRange([[0, 0]], [[0, 0, 6]]), spatial);
    const lines = segments(scene);
    const wall = lines.filter(
      ([a, b]) => Math.abs(a.x - 0.992) < 1e-6 && Math.abs(b.x - 0.992) < 1e-6
    );
    expect(lines).toHaveLength(6);
    expect(wall).toHaveLength(3);
    expect(Math.max(...wall.flat().map((point) => point.y))).toBeCloseTo(3);
    expect(lines.some(([a, b]) => a.x === 1 && b.x === 1 && a.y === b.y)).toBe(false);
  });

  test('adjacent wall strips omit shared interior vertical edges', () => {
    overlay.update(
      wallRange(
        [
          [0, 0],
          [0, 1],
        ],
        [
          [0, 0, 6],
          [1, 0, 6],
        ]
      ),
      spatial
    );
    const vertical = segments(scene).filter(([a, b]) => a.x === b.x && a.z === b.z);
    expect(vertical).toHaveLength(2);
    expect(vertical.map(([a]) => a.z).sort()).toEqual([0, 2]);
  });

  test('different wall limits join only the exposed part of their shared edge', () => {
    overlay.update(
      wallRange(
        [
          [0, 0],
          [0, 1],
        ],
        [
          [0, 0, 6],
          [1, 0, 4],
        ]
      ),
      spatial
    );
    const middle = segments(scene).filter(
      ([a, b]) => Math.abs(a.x - 0.992) < 1e-6 && a.x === b.x && a.z === 1 && b.z === 1
    );
    expect(middle).toHaveLength(1);
    expect(middle[0].map((point) => point.y).sort()).toEqual([2, 3]);
  });

  test('a hanging-only range outlines its wall band without drawing a path to unreachable ground', () => {
    overlay.update(wallRange([], [[0, 4, 10]]), spatial);
    const lines = segments(scene);
    expect(lines).toHaveLength(4);
    expect(lines.flat().every((point) => point.y >= 2 && point.y <= 5)).toBe(true);
    expect(lines.flat().every((point) => Math.abs(point.x - 0.992) < 1e-6)).toBe(true);
  });

  test('an exactly reachable stable wall boundary is drawn once', () => {
    overlay.update(wallRange([], [[0, 6, 6]]), spatial);
    const lines = segments(scene);
    expect(lines).toHaveLength(1);
    expect(lines[0].every((point) => Math.abs(point.y - 3) < 1e-6)).toBe(true);
  });

  test('wall outlines do not bridge an unreachable range endpoint to ledge tiles', () => {
    overlay.update(wallRange([[1, 0, 20]], [[0, 8, 12]]), spatial);
    const wallLines = segments(scene).filter(
      ([a, b]) => Math.abs(a.x - 0.992) < 1e-6 && Math.abs(b.x - 0.992) < 1e-6
    );
    expect(wallLines).toHaveLength(4);
    expect(wallLines.flat().every((point) => point.y <= 6)).toBe(true);
  });

  test('an affordable edge-hang band connects the upper wall to reachable ledge tiles', () => {
    overlay.update(wallRange([[1, 0, 20]], [[0, 8, 20]]), spatial);
    const wallLines = segments(scene).filter(
      ([a, b]) => Math.abs(a.x - 0.992) < 1e-6 && Math.abs(b.x - 0.992) < 1e-6
    );
    const sides = wallLines.filter(([a, b]) => a.z === b.z);
    expect(sides).toHaveLength(2);
    for (const [a, b] of sides) {
      expect(Math.min(a.y, b.y)).toBe(4);
      expect(Math.max(a.y, b.y)).toBe(10);
    }
  });

  test('uses world scale and grid origin rather than assuming unit tiles at zero', () => {
    overlay.dispose();
    overlay = new MovementRangeOverlay(three, scene, 100, 2);
    overlay.update(range([[3, 4, 2]]), {
      gridToWorld: (x, y, height) => ({ x: x * 2 + 10, y: height * 0.5, z: y * 2 + 20 }),
    });
    const points = segments(scene).flat();
    expect(Math.min(...points.map((p) => p.x))).toBe(16);
    expect(Math.max(...points.map((p) => p.x))).toBe(18);
    expect(Math.min(...points.map((p) => p.z))).toBe(28);
    expect(Math.max(...points.map((p) => p.z))).toBe(30);
    expect(points[0].y).toBeCloseTo(1.016);
  });

  test('an empty reachable set hides the outline', () => {
    overlay.update(range([]), spatial);
    expect(scene.getObjectByName('TokenMovementRange').visible).toBe(false);
  });
});
