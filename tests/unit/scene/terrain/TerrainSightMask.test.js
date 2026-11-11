import * as three from 'three';
import TerrainSightMask from '../../../../src/scene/terrain/TerrainSightMask.js';

function floor() {
  const geometry = new three.BufferGeometry();
  geometry.setAttribute(
    'position',
    new three.Float32BufferAttribute(
      [5, 0, -10, 5, 0, 10, 15, 0, 10, 5, 0, -10, 15, 0, 10, 15, 0, -10],
      3
    )
  );
  geometry.setAttribute('color', new three.Float32BufferAttribute(Array(18).fill(0.5), 3));
  geometry.setAttribute(
    'constructionMaterial',
    new three.Float32BufferAttribute(Array(6).fill(4), 1)
  );
  geometry.computeVertexNormals();
  return geometry;
}

const walls = [
  { min: { x: 0, y: 0, z: -10 }, max: { x: 1, y: 10, z: -1 } },
  { min: { x: 0, y: 0, z: 1 }, max: { x: 1, y: 10, z: 10 } },
];

function hits(geometry, x, z) {
  const mesh = new three.Mesh(geometry, new three.MeshBasicMaterial({ side: three.DoubleSide }));
  try {
    return new three.Raycaster(new three.Vector3(x, 5, z), new three.Vector3(0, -1, 0))
      .intersectObject(mesh)
      .map((hit) => hit.point.toArray());
  } finally {
    mesh.material.dispose();
  }
}

test('a doorway clips large floor triangles to the real eye-to-aperture sight cone', () => {
  const source = floor();
  const mask = new TerrainSightMask({
    three,
    observerFeet: { x: -5, y: 0, z: 0 },
    obstacles: walls,
  });
  const visible = mask.apply(source);
  try {
    expect(hits(visible, 10, 0).length).toBeGreaterThan(0);
    expect(hits(visible, 10, 5)).toHaveLength(0);
    expect(hits(visible, 10, -5)).toHaveLength(0);
    expect(hits(visible, 10, 2.4).length).toBeGreaterThan(0);
    expect(hits(visible, 10, 2.6)).toHaveLength(0);
    expect([...new Set(visible.getAttribute('constructionMaterial').array)]).toEqual([4]);
    expect([...new Set(visible.getAttribute('color').array)]).toEqual([0.5]);
    expect(Array.from(visible.getAttribute('position').array).every(Number.isFinite)).toBe(true);
    expect(visible.getAttribute('position').count % 3).toBe(0);
  } finally {
    source.dispose();
    visible.dispose();
  }
});

test('closing the doorway removes every hidden-room triangle, not just its center samples', () => {
  const source = floor();
  const visible = new TerrainSightMask({
    three,
    observerFeet: { x: -5, y: 0, z: 0 },
    obstacles: [...walls, { min: { x: 0.4, y: 0, z: -1 }, max: { x: 0.6, y: 8, z: 1 } }],
  }).apply(source);
  try {
    expect(visible.getAttribute('position').count).toBe(0);
  } finally {
    source.dispose();
    visible.dispose();
  }
});

test('surface masking keeps map rotation, render scale and outward normals', () => {
  const source = floor();
  const toView = new three.Matrix4().makeRotationY(Math.PI / 2);
  toView.scale(new three.Vector3(0.4, 0.4, 0.4));
  const visible = new TerrainSightMask({
    three,
    observerFeet: { x: -5, y: 0, z: 0 },
    obstacles: walls,
  }).apply(source, { toView });
  try {
    expect(hits(visible, 0, -4).length).toBeGreaterThan(0);
    expect(hits(visible, 2, -4)).toHaveLength(0);
    expect([...new Set(visible.getAttribute('normal').array)]).toEqual([0, 1]);
  } finally {
    source.dispose();
    visible.dispose();
  }
});

test('room-boundary clipping trims existing faces without creating vertical cap faces', () => {
  const source = floor();
  const visible = new TerrainSightMask({ three, unrestricted: true }).apply(source, {
    excludeSolids: [
      {
        min: { x: -100, y: -1, z: -100 },
        max: { x: 10, y: 100, z: 100 },
      },
    ],
  });
  try {
    expect(hits(visible, 7, 0)).toHaveLength(0);
    expect(hits(visible, 12, 0).length).toBeGreaterThan(0);
    expect([...new Set(visible.getAttribute('normal').array)]).toEqual([0, 1]);
  } finally {
    source.dispose();
    visible.dispose();
  }
});
