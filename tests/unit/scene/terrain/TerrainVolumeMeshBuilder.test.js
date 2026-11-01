import * as three from 'three';
import { TerrainGeometry } from '../../../../src/terrain/TerrainGeometry.js';
import { TerrainVolumeMeshBuilder } from '../../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';

test('the actual bridge mesh has a deck, underside and empty space over the lower path', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 50,
    depthFeet: 50,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'bridge',
    layerId: 'bridge',
    bounds: { min: { x: 10, y: 9, z: 10 }, max: { x: 30, y: 10, z: 20 } },
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
  const shoot = (from, direction) => {
    ray.set(new three.Vector3(...from), new three.Vector3(...direction));
    return ray.intersectObject(mesh).map((hit) => hit.point.y);
  };
  expect(shoot([15, 20, 15], [0, -1, 0])[0]).toBeCloseTo(10);
  expect(shoot([15, 5, 15], [0, -1, 0])[0]).toBeCloseTo(0);
  expect(shoot([15, 5, 15], [0, 1, 0])[0]).toBeCloseTo(9);
  ray.set(new three.Vector3(5, 5, 15), new three.Vector3(1, 0, 0));
  expect(ray.intersectObject(mesh)).toHaveLength(0);
  built.dispose();
  material.dispose();
});
