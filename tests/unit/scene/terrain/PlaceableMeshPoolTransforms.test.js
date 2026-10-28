import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
} from 'three';

import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';
import { createPlaceableModelGeometry } from '../../../../src/scene/terrain/placeableModelGeometry.js';

describe('Instanced model transforms', () => {
  test('mirrored model transforms retain outward-facing triangle winding', () => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    geometry.computeVertexNormals();
    const root = new Mesh(geometry, new MeshStandardMaterial());
    root.scale.x = -1;

    const prepared = createPlaceableModelGeometry({ Box3, Vector3 }, root);
    const positions = prepared.geometry.attributes.position;
    const index = prepared.geometry.index;
    const a = new Vector3().fromBufferAttribute(positions, index.getX(0));
    const b = new Vector3().fromBufferAttribute(positions, index.getX(1));
    const c = new Vector3().fromBufferAttribute(positions, index.getX(2));
    const faceNormal = b.sub(a).cross(c.sub(a)).normalize();
    const vertexNormal = new Vector3().fromBufferAttribute(
      prepared.geometry.attributes.normal,
      index.getX(0)
    );
    expect(faceNormal.dot(vertexNormal)).toBeCloseTo(1);
    prepared.geometry.computeBoundingBox();
    expect(prepared.geometry.boundingBox.min.x).toBe(-1);
    expect(geometry.index).toBeNull();
    prepared.geometry.dispose();
  });

  test('preserves the cached model scale, child placement, and grounded pivot', async () => {
    const geometry = new BoxGeometry(2, 8, 2);
    geometry.computeBoundingBox();
    const originalBounds = geometry.boundingBox.clone();
    const model = new Group();
    model.scale.setScalar(0.5);
    model.position.set(-2, 0, 1);
    const mesh = new Mesh(geometry, new MeshStandardMaterial());
    mesh.position.set(4, 4, -2);
    model.add(mesh);
    model.updateMatrixWorld(true);
    const expected = new Box3().setFromObject(model);
    const gameManager = {
      is3DModeActive: () => true,
      threeSceneManager: { scene: new Scene() },
      modelAssetCache: { getModel: jest.fn(async () => model) },
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 0.5,
        gridToWorld: (x, y) => ({ x, y: 0, z: y }),
      },
      getTerrainHeight: () => 1,
    };
    const pool = new PlaceableMeshPool({ gameManager });

    const handle = await pool.addPlaceable({
      type: 'plant',
      modelKey: 'tropical-palm-a',
      variantKey: 'tree-single-palm',
      gridX: 4,
      gridY: 5,
    });
    const instanced = pool._groups.get(handle.key).instancedMesh;
    instanced.geometry.computeBoundingBox();
    const actual = instanced.geometry.boundingBox;

    for (const axis of ['x', 'y', 'z']) {
      expect(actual.min[axis]).toBeCloseTo(expected.min[axis], 6);
      expect(actual.max[axis]).toBeCloseTo(expected.max[axis], 6);
    }
    expect(geometry.boundingBox.equals(originalBounds)).toBe(true);
    pool.dispose();
  });

  test('renders every mesh and material in a compound model without changing cached geometry', async () => {
    const model = new Group();
    const trunk = new Mesh(new BoxGeometry(1, 4, 1), new MeshStandardMaterial());
    trunk.position.y = 2;
    const leaves = new Mesh(new BoxGeometry(5, 1, 5), new MeshStandardMaterial());
    leaves.position.set(1, 4, 0);
    model.add(trunk, leaves);
    const sourceDisposals = [
      jest.spyOn(trunk.geometry, 'dispose'),
      jest.spyOn(leaves.geometry, 'dispose'),
    ];
    const expected = new Box3().setFromObject(model);
    const gameManager = {
      is3DModeActive: () => true,
      threeSceneManager: { scene: new Scene() },
      modelAssetCache: { getModel: async () => model },
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 0.5,
        gridToWorld: (x, y) => ({ x, y: 0, z: y }),
      },
      getTerrainHeight: () => 1,
    };
    const pool = new PlaceableMeshPool({ gameManager });
    const handle = await pool.addPlaceable({
      type: 'plant',
      modelKey: 'common-broadleaf-1',
      gridX: 2,
      gridY: 2,
    });
    const instanced = pool._groups.get(handle.key).instancedMesh;
    instanced.geometry.computeBoundingBox();

    expect(instanced.geometry.boundingBox.getSize(new Vector3()).toArray()).toEqual(
      expected.getSize(new Vector3()).toArray()
    );
    expect(instanced.material).toHaveLength(2);
    expect(new Set(instanced.geometry.groups.map((group) => group.materialIndex))).toEqual(
      new Set([0, 1])
    );
    pool.dispose();
    for (const disposal of sourceDisposals) expect(disposal).not.toHaveBeenCalled();
  });
});
