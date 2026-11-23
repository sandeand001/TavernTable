import * as three from 'three';
import { TerrainGeometry } from '../../../../src/terrain/TerrainGeometry.js';
import { TerrainMeshBuilder } from '../../../../src/scene/terrain/TerrainMeshBuilder.js';
import { TerrainVolumeMeshBuilder } from '../../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import { BoundaryWallCutaway } from '../../../../src/scene/terrain/BoundaryWallCutaway.js';

const cols = 9;
const rows = 9;
const floor = -8;
const elevationUnit = 0.3;

function fixture({
  interior = false,
  connectedInterior = false,
  volume = false,
  curved = false,
  perspective = false,
} = {}) {
  const heights = Array.from({ length: rows }, (_, z) =>
    Array.from({ length: cols }, (_, x) =>
      x === 0 || z === 0 || x === cols - 1 || z === rows - 1 ? 8 : floor
    )
  );
  if (interior) heights[5][4] = 8;
  if (connectedInterior) for (let x = 1; x <= 4; x++) heights[5][x] = 8;
  const getHeight = (x, z) => heights[z][x];
  const cutaway = new BoundaryWallCutaway({
    cols,
    rows,
    getHeight,
    tileWorldSize: 1,
    elevationUnit,
    three,
  });
  let geometry;
  let physical;
  if (volume || curved) {
    physical = new TerrainGeometry({
      widthFeet: cols * 5,
      depthFeet: rows * 5,
      getTerrainHeightFeet: (x, z) =>
        getHeight(Math.floor(x / 5), Math.floor(z / 5)) * elevationUnit * 5,
    });
    if (volume)
      physical.addSolid({
        id: 'interior-wall',
        layerId: 'castle',
        bounds: {
          min: { x: 20, y: floor * elevationUnit * 5, z: 25 },
          max: { x: 25, y: 10, z: 30 },
        },
      });
    if (curved)
      physical.addSolid({
        id: 'curved-interior',
        layerId: 'castle',
        bounds: {
          min: { x: 5, y: floor * elevationUnit * 5, z: 5 },
          max: { x: 10, y: 5, z: 10 },
        },
        shape: { kind: 'ellipsoid' },
      });
    geometry = new TerrainVolumeMeshBuilder().build({
      geometry: physical,
      three,
      worldUnitsPerFoot: 0.2,
      getBoundaryWallCell: (x, z, span) => cutaway.boundaryCell(x, z, span),
    });
  } else {
    geometry = new TerrainMeshBuilder({
      tileWorldSize: 1,
      elevationUnit,
      forceAdvanced: true,
    }).build({
      cols,
      rows,
      getHeight,
      three,
      getBoundaryWallCell: (x, z) => cutaway.boundaryCell(x, z),
    });
  }
  const material = new three.MeshBasicMaterial({ side: three.DoubleSide });
  const mesh = new three.Mesh(geometry, material);
  cutaway.attach(mesh);
  const target = new three.Vector3(4.5, floor * elevationUnit, 4.5);
  const camera = perspective
    ? new three.PerspectiveCamera(60, 1, 0.1, 100)
    : new three.OrthographicCamera(-12, 12, 12, -12, 0.1, 100);
  const look = (z, y = 5) => {
    camera.position.set(4.5, y, z);
    camera.lookAt(target);
    camera.updateProjectionMatrix();
    cutaway.update(camera);
  };
  const hitFloorTarget = () => {
    const projected = target.clone().project(camera);
    const ray = new three.Raycaster();
    ray.setFromCamera(new three.Vector2(projected.x, projected.y), camera);
    return ray.intersectObject(mesh)[0];
  };
  const hitWallFromFloor = (direction) => {
    const ray = new three.Raycaster(
      new three.Vector3(4.5, floor * elevationUnit + 1, 4.5),
      new three.Vector3(0, 0, direction)
    );
    return ray.intersectObject(mesh)[0];
  };
  const dispose = () => {
    geometry.dispose();
    material.dispose();
  };
  return {
    cutaway,
    target,
    camera,
    mesh,
    look,
    hitFloorTarget,
    hitWallFromFloor,
    physical,
    dispose,
  };
}

test('only the foreground boundary changes with the camera, retaining floor and far wall', () => {
  const view = fixture();
  try {
    view.look(18);
    expect(view.hitFloorTarget().point.distanceTo(view.target)).toBeLessThan(1e-5);
    expect(view.hitWallFromFloor(-1)).toBeDefined();
    expect(view.hitWallFromFloor(1)).toBeUndefined();
    view.look(-9);
    expect(view.hitFloorTarget().point.distanceTo(view.target)).toBeLessThan(1e-5);
    expect(view.hitWallFromFloor(1)).toBeDefined();
    expect(view.hitWallFromFloor(-1)).toBeUndefined();
    view.camera.position.set(4.5, 30, 4.5);
    view.camera.lookAt(view.target);
    view.cutaway.update(view.camera);
    expect(view.hitWallFromFloor(1)).toBeDefined();
    expect(view.hitWallFromFloor(-1)).toBeDefined();
  } finally {
    view.dispose();
  }
});

test('floor corners as well as tile centers remain pickable behind the foreground rim', () => {
  const view = fixture();
  try {
    view.look(18);
    const ray = new three.Raycaster();
    for (const x of [1.05, 2.5, 4.5, 6.5, 7.95])
      for (const z of [1.05, 2.5, 4.5, 6.5, 7.95]) {
        const target = new three.Vector3(x, floor * elevationUnit, z);
        const point = target.clone().project(view.camera);
        if (Math.abs(point.x) > 1 || Math.abs(point.y) > 1) continue;
        ray.setFromCamera(new three.Vector2(point.x, point.y), view.camera);
        expect(ray.intersectObject(view.mesh)[0].point.distanceTo(target)).toBeLessThan(1e-5);
      }
  } finally {
    view.dispose();
  }
});

test('interior terrain remains visible when it obstructs a floor', () => {
  const view = fixture({ interior: true });
  try {
    view.look(18);
    expect(view.hitFloorTarget().point.z).toBeGreaterThan(5);
  } finally {
    view.dispose();
  }
});

test('a boundary-connected partition behind foreground floor remains visible', () => {
  const view = fixture({ connectedInterior: true });
  try {
    view.look(18);
    expect(view.hitFloorTarget().point.z).toBeGreaterThan(5);
  } finally {
    view.dispose();
  }
});

test('raised boundary caps cannot intercept the floor in perspective view', () => {
  const view = fixture({ perspective: true });
  try {
    view.look(18, 13);
    expect(view.hitFloorTarget().point.distanceTo(view.target)).toBeLessThan(1e-5);
  } finally {
    view.dispose();
  }
});

test('constructed interior walls remain visible and physical geometry is unchanged', () => {
  const view = fixture({ volume: true });
  try {
    const before = view.physical.save();
    view.look(18);
    expect(view.hitFloorTarget().point.z).toBeGreaterThan(5);
    expect(view.physical.save()).toEqual(before);
  } finally {
    view.dispose();
  }
});

test('the cutaway also follows terrain provenance in curved volume geometry', () => {
  const view = fixture({ curved: true });
  try {
    view.look(18);
    expect(view.hitFloorTarget().point.distanceTo(view.target)).toBeLessThan(1e-5);
    expect(view.hitWallFromFloor(-1)).toBeDefined();
  } finally {
    view.dispose();
  }
});
