import * as three from 'three';
import { TerrainGeometry } from '../../../../src/terrain/TerrainGeometry.js';
import { TerrainVolumeMeshBuilder } from '../../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import { clipCellToBounds } from '../../../../src/terrain/ConvexGeometry.js';

test('only unbounded outdoor earth gets an artificial render bottom, not finite clipped underground walls', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 50,
    depthFeet: 50,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'curve',
    layerId: 'roof',
    bounds: { min: { x: 20, y: 0, z: 20 }, max: { x: 30, y: 10, z: 30 } },
    shape: { kind: 'ellipsoid' },
  });
  const earth = geometry
    .getSolidCells()
    .find((cell) => cell.id === 'terrain' && cell.bounds.min.x === 0 && cell.bounds.min.z === 0);
  expect(earth.unboundedBottomFeet).toBe(earth.bounds.min.y);
  const clipped = clipCellToBounds(earth, {
    min: { x: 1, y: -30, z: 1 },
    max: { x: 4, y: -10, z: 4 },
  });
  expect(clipped.unboundedBottomFeet).toBe(earth.unboundedBottomFeet);
  expect(clipped.bounds.min.y).toBe(-30);
  const builder = new TerrainVolumeMeshBuilder();
  const outdoor = builder.build({ geometry, three, worldUnitsPerFoot: 1 });
  const underground = builder.build({
    geometry: { hasCurves: true, getSolidCells: () => [clipped] },
    three,
    worldUnitsPerFoot: 1,
  });
  try {
    outdoor.computeBoundingBox();
    underground.computeBoundingBox();
    expect(outdoor.boundingBox.min.y).toBe(-5);
    expect(underground.boundingBox.min.y).toBe(-30);
    expect(geometry.save().volumes[0].unboundedBottomFeet).toBeUndefined();
  } finally {
    outdoor.dispose();
    underground.dispose();
  }
});

test('curved mesh hits agree with physical supports, ceilings and the empty bounding-box corners', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 50,
    depthFeet: 50,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'shell',
    layerId: 'roof',
    bounds: { min: { x: 10, y: 0, z: 10 }, max: { x: 30, y: 10, z: 30 } },
    shape: {
      kind: 'ellipsoid',
      center: { x: 20, y: 0, z: 20 },
      radii: { x: 10, y: 10, z: 10 },
    },
  });
  geometry.carve({
    id: 'inside',
    bounds: { min: { x: 12, y: 0, z: 12 }, max: { x: 28, y: 8, z: 28 } },
    shape: {
      kind: 'ellipsoid',
      center: { x: 20, y: 0, z: 20 },
      radii: { x: 8, y: 8, z: 8 },
    },
  });
  const built = new TerrainVolumeMeshBuilder().build({
    geometry,
    three,
    worldUnitsPerFoot: 1,
  });
  const material = new three.MeshBasicMaterial();
  const mesh = new three.Mesh(built, material);
  mesh.updateMatrixWorld(true);
  const ray = new three.Raycaster();
  const shoot = (x, y, z, direction) => {
    ray.set(new three.Vector3(x, y, z), new three.Vector3(0, direction, 0));
    return ray.intersectObject(mesh)[0]?.point.y;
  };
  for (const [x, z] of [
    [20, 20],
    [24, 20],
    [23, 23],
    [17, 24],
    [10.5, 10.5],
  ]) {
    const surfaces = geometry.getSurfacesAt(x, z);
    expect(shoot(x, 30, z, -1)).toBeCloseTo(surfaces.at(-1).heightFeet, 4);
    if (surfaces[0].ceilingFeet !== null) {
      expect(shoot(x, 1, z, 1)).toBeCloseTo(surfaces[0].ceilingFeet, 4);
      expect(shoot(x, 1, z, -1)).toBeCloseTo(0, 4);
    }
  }
  expect(shoot(10.5, 5, 10.5, -1)).toBeCloseTo(0, 4);
  const normals = built.getAttribute('normal');
  expect(
    Array.from({ length: normals.count }, (_, i) =>
      [normals.getX(i), normals.getY(i), normals.getZ(i)].filter((value) => Math.abs(value) > 0.05)
    ).some((components) => components.length > 1)
  ).toBe(true);
  built.dispose();
  material.dispose();
});

test('a curved union emits one top face where a round deck overlaps a wall walkway', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 50,
    depthFeet: 50,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'walkway',
    bounds: { min: { x: 0, y: 0, z: 20 }, max: { x: 25, y: 10, z: 30 } },
  });
  geometry.addSolid({
    id: 'round-deck',
    bounds: { min: { x: 20, y: 9, z: 15 }, max: { x: 40, y: 10, z: 35 } },
    shape: { kind: 'cylinder', axis: 'y' },
  });
  const built = new TerrainVolumeMeshBuilder().build({
    geometry,
    three,
    worldUnitsPerFoot: 1,
  });
  const material = new three.MeshBasicMaterial();
  const mesh = new three.Mesh(built, material);
  mesh.updateMatrixWorld(true);
  const ray = new three.Raycaster(
    new three.Vector3(24.123, 30, 24.456),
    new three.Vector3(0, -1, 0)
  );
  expect(ray.intersectObject(mesh).filter((hit) => Math.abs(hit.point.y - 10) < 1e-5)).toHaveLength(
    1
  );
  built.dispose();
  material.dispose();
});
