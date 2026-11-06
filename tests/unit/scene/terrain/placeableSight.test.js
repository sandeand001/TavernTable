import * as three from 'three';
import { opaqueModelBounds } from '../../../../src/scene/terrain/placeableSight.js';
import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';

test('opaque tree parts block sight without treating the leaf canopy as a solid box', () => {
  const root = new three.Group();
  const trunk = new three.Mesh(new three.BoxGeometry(0.5, 5, 0.5), new three.MeshBasicMaterial());
  trunk.position.y = 2.5;
  const leaves = new three.Mesh(new three.BoxGeometry(8, 3, 8), new three.MeshBasicMaterial());
  leaves.position.y = 5;
  leaves.material.userData.__foliageCandidate = true;
  root.add(trunk, leaves);
  const bounds = opaqueModelBounds(three, root);
  expect(bounds.min.toArray()).toEqual([-0.25, 0, -0.25]);
  expect(bounds.max.toArray()).toEqual([0.25, 5, 0.25]);
  trunk.geometry.dispose();
  trunk.material.dispose();
  leaves.geometry.dispose();
  leaves.material.dispose();
});

test('saved sight blockers follow actual instance scales, height offsets and physical roots', () => {
  const pool = new PlaceableMeshPool();
  pool._three = three;
  const mesh = new three.InstancedMesh(
    new three.BoxGeometry(1, 5, 1),
    new three.MeshBasicMaterial(),
    2
  );
  mesh.setMatrixAt(0, new three.Matrix4().makeScale(2, 3, 2).setPosition(10, 4, 20));
  mesh.setMatrixAt(1, new three.Matrix4().makeTranslation(30, 0, 40));
  pool._groups.set('tree', {
    instancedMesh: mesh,
    sightBounds: new three.Box3(
      new three.Vector3(-0.25, 0, -0.25),
      new three.Vector3(0.25, 5, 0.25)
    ),
  });
  pool._metadata.set(
    'tree',
    new Map([
      [0, { source: { type: 'plant', placeableId: 'tree-oak' } }],
      [1, { source: { type: 'plant', placeableId: 'flower' } }],
    ])
  );
  expect(pool.sightBlockingBounds()).toEqual([
    {
      min: { x: 9.5, y: 4, z: 19.5 },
      max: { x: 10.5, y: 19, z: 20.5 },
    },
  ]);
  mesh.geometry.dispose();
  mesh.material.dispose();
});
