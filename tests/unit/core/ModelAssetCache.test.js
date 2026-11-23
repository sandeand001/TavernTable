import ModelAssetCache from '../../../src/core/ModelAssetCache.js';
import fs from 'node:fs';
import path from 'node:path';
import { LoadingManager } from 'three';

test('a rejected in-flight model load is retired so the next request retries', async () => {
  const cache = new ModelAssetCache();
  cache._three = {};
  cache._registry.retry = { path: 'retry.obj', format: 'OBJ' };
  let reject;
  const pending = new Promise((_resolve, fail) => {
    reject = fail;
  });
  const root = { clone: jest.fn(() => ({ id: 'retry-copy' })) };
  cache._loadOBJ = jest.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(root);

  const first = cache.getModel('retry');
  const concurrent = cache.getModel('retry');
  expect(cache._loadOBJ).toHaveBeenCalledTimes(1);
  const failure = new Error('transient load failure');
  reject(failure);
  expect((await Promise.allSettled([first, concurrent])).map(({ status }) => status)).toEqual([
    'rejected',
    'rejected',
  ]);
  expect(cache._loading.has('retry')).toBe(false);

  await expect(cache.getModel('retry')).resolves.toEqual({ id: 'retry-copy' });
  expect(cache._loadOBJ).toHaveBeenCalledTimes(2);
  expect(root.clone).toHaveBeenCalledWith(true);
});

test('all callers get the same missing-model result when a shared load has no model', async () => {
  const cache = new ModelAssetCache();
  cache._three = {};
  cache._registry.missing = { path: 'missing.glb', format: 'GLB' };
  cache._loadGLTF = jest.fn().mockResolvedValue(null);
  await expect(
    Promise.all([cache.getModel('missing'), cache.getModel('missing')])
  ).resolves.toEqual([null, null]);
  expect(cache._loadGLTF).toHaveBeenCalledTimes(1);
});

test('representative source-pack models are registered with existing runtime formats and files', () => {
  const cache = new ModelAssetCache();
  const expected = {
    'source-medieval-wall-door': [
      'GLTF',
      'assets/terrain/representatives/village/Wall_Plaster_Door_Flat.gltf',
    ],
    'source-dungeon-wall': ['FBX', 'assets/terrain/representatives/dungeon/Wall_Modular.fbx'],
    'source-cave-entrance': ['GLB', 'assets/terrain/representatives/cave-cc0/mine-frame.glb'],
    'source-cave-stalagmite': [
      'GLB',
      'assets/terrain/representatives/cave-cc0/stalagmite-cluster.glb',
    ],
    'source-cave-column': ['GLB', 'assets/terrain/representatives/cave-cc0/stone-column.glb'],
    'source-iron-chest': ['FBX', 'assets/terrain/representatives/chest-cc0/dungeon-chest.fbx'],
    'mushroom-glow': [
      'FBX',
      'assets/terrain/representatives/fungal/Purple_Mushrooms_Cluster_3.fbx',
    ],
    'mushroom-giant-cap': ['FBX', 'assets/terrain/representatives/fungal/Fly_Agaric_Big.fbx'],
  };
  for (const [key, [format, file]] of Object.entries(expected)) {
    const descriptor = cache._loadRegistryEntry(key);
    expect(descriptor).toMatchObject({ format, path: file });
    expect(fs.existsSync(path.resolve(file))).toBe(true);
  }
  expect(cache._loadRegistryEntry('source-iron-chest')).toMatchObject({
    opaqueMaterials: true,
    inferTextures: false,
    centerAndGround: { alignXZ: true, alignY: true },
  });
});

test('GLTF/GLB descriptors use the scene root and keep later variants retryable', async () => {
  const cache = new ModelAssetCache();
  cache._three = { LoadingManager };
  cache._registry.sample = { path: 'sample.glb', format: 'GLB' };
  cache._postProcess = jest.fn();
  cache._centerAndGround = jest.fn();
  cache._pruneFBXArtifacts = jest.fn();
  const copy = { id: 'sample-copy' };
  const root = { clone: jest.fn(() => copy) };
  class Loader {
    load(_url, success) {
      success({ scene: root });
    }
  }
  cache._ensureGLTFLoaderCtor = jest.fn().mockResolvedValue(Loader);
  await expect(cache.getModel('sample')).resolves.toEqual(copy);
  expect(cache._postProcess).toHaveBeenCalledWith(
    cache._three,
    root,
    'sample',
    'sample.glb',
    'GLB',
    expect.objectContaining({ format: 'GLB' })
  );
  expect(cache._centerAndGround).toHaveBeenCalledWith(cache._three, root);
  expect(cache._pruneFBXArtifacts).not.toHaveBeenCalled();
});
