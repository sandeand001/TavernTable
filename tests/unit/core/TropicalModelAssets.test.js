import fs from 'fs';
import path from 'path';
import { TextDecoder } from 'util';
import * as three from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

import ModelAssetCache from '../../../src/core/ModelAssetCache.js';
import { computeTargetHeight } from '../../../src/core/ModelPostProcessing.js';
import { PlaceableMeshPool } from '../../../src/scene/terrain/PlaceableMeshPool.js';

const models = [
  ['tropical-palm-a', 'SM_MZRa_Palm_B081'],
  ['tropical-palm-b', 'SM_MZRa_Palm_B082'],
  ['tropical-banana-a', 'SM_MZRa_Banana_B091'],
  ['tropical-banana-b', 'SM_MZRa_Banana_B092'],
  ['tropical-monstera-a', 'tree006SM_MZRa_Monstera_B071'],
  ['tropical-monstera-b', 'tree007SM_MZRa_Monstera_B072'],
  ['tropical-fern-a', 'SM_MZRa_Fern_B051'],
  ['tropical-fern-b', 'SM_MZRa_Fern_B052'],
  ['tropical-fern-c', 'SM_MZRa_Fern_B053'],
];

function groundBounds(root) {
  root.updateMatrixWorld(true);
  const box = new three.Box3().setFromObject(root, true);
  const ground = new three.Box3();
  const point = new three.Vector3();
  const ceiling = box.min.y + (box.max.y - box.min.y) * 0.02;
  root.traverse((node) => {
    if (!node.isMesh) return;
    const position = node.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
      if (point.y <= ceiling) ground.expandByPoint(point);
    }
  });
  return ground;
}

describe('Real tropical plant assets', () => {
  let pack;
  let textureLoad;
  const originalDecoder = globalThis.TextDecoder;

  beforeAll(() => {
    globalThis.TextDecoder = TextDecoder;
    textureLoad = jest.spyOn(three.TextureLoader.prototype, 'load').mockImplementation((url) => {
      const texture = new three.Texture();
      texture.userData.url = url;
      return texture;
    });
    const bytes = fs.readFileSync(
      path.resolve(
        __dirname,
        '..',
        '..',
        '..',
        'assets',
        'terrain',
        '3d Assets',
        'Tropical',
        'source',
        'MZRa_Pack_M02P.fbx'
      )
    );
    pack = new FBXLoader().parse(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      ''
    );
  });

  afterAll(() => {
    textureLoad.mockRestore();
    if (originalDecoder === undefined) delete globalThis.TextDecoder;
    else globalThis.TextDecoder = originalDecoder;
  });

  test.each(models)(
    '%s selects one intended species and instances its calibrated shape',
    async (key, name) => {
      const cache = new ModelAssetCache();
      const descriptor = cache._loadRegistryEntry(key);
      const root = cache._selectFBXNode(three, pack, descriptor, key);
      const meshes = [];
      root.traverse((node) => {
        if (node.isMesh) meshes.push(node);
      });
      expect(meshes.map((mesh) => mesh.name)).toEqual([name]);
      cache._postProcess(three, root, key, descriptor.path, 'FBX', descriptor);
      cache._centerAndGround(three, root, descriptor.centerAndGround);
      const bounds = new three.Box3().setFromObject(root, true);
      const base = groundBounds(root).getCenter(new three.Vector3());

      expect(bounds.max.y - bounds.min.y).toBeCloseTo(computeTargetHeight(key), 5);
      expect(bounds.min.y).toBeCloseTo(0, 5);
      expect(base.x).toBeCloseTo(0, 5);
      expect(base.z).toBeCloseTo(0, 5);

      const pool = new PlaceableMeshPool({
        gameManager: {
          is3DModeActive: () => true,
          threeSceneManager: { scene: new three.Scene() },
          modelAssetCache: { getModel: async () => root.clone(true) },
          spatial: {
            tileWorldSize: 1,
            elevationUnit: 0.5,
            gridToWorld: (x, y) => ({ x, y: 0, z: y }),
          },
          getTerrainHeight: () => 1,
        },
        initialCapacity: 4,
      });
      const handle = await pool.addPlaceable({ type: 'plant', modelKey: key, gridX: 2, gridY: 2 });
      const geometry = pool._groups.get(handle.key).instancedMesh.geometry;
      geometry.computeBoundingBox();
      for (const axis of ['x', 'y', 'z']) {
        expect(geometry.boundingBox.min[axis]).toBeCloseTo(bounds.min[axis], 4);
        expect(geometry.boundingBox.max[axis]).toBeCloseTo(bounds.max[axis], 4);
      }
      pool.dispose();
    }
  );

  test('does not substitute the complete asset pack when a requested node is missing', () => {
    const cache = new ModelAssetCache();
    expect(() =>
      cache._selectFBXNode(three, pack, { node: 'missing-plant' }, 'missing-plant')
    ).toThrow(/node.*not found/i);
  });
});
