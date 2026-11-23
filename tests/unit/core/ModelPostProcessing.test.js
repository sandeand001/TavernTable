import {
  Box3,
  BoxGeometry,
  DoubleSide,
  Mesh,
  MeshStandardMaterial,
  SRGBColorSpace,
  Texture,
  Vector3,
} from 'three';

import { autoScaleModel, postProcessModel } from '../../../src/core/ModelPostProcessing.js';
import ModelAssetCache from '../../../src/core/ModelAssetCache.js';

const three = { Box3, DoubleSide, SRGBColorSpace, Vector3 };
const textureBase = 'assets/terrain/3d Assets/Textures';

function processMaterial(key, material, descriptor = {}, nodeName = '') {
  const cache = {
    _textureLoader: {
      load: jest.fn((path) => {
        const texture = new Texture();
        texture.image = { src: path };
        return texture;
      }),
    },
    _textureCache: new Map(),
  };
  const root = new Mesh(new BoxGeometry(1, 1, 1), material);
  root.name = nodeName;
  postProcessModel(cache, three, root, key, 'fixture.obj', 'OBJ', descriptor);
  return cache;
}

describe('Authored plant material textures', () => {
  test.each([
    ['tall-thick-1', 'Leaves_TallThick', 'Leaves_TallThick_C.png'],
    ['tall-thick-2', 'Leaves_TallThick', 'Leaves_TallThick_C.png'],
    ['giant-pine-1', 'Leaves_GiantPine', 'Leaves_GiantPine_C.png'],
    ['pine-conifer-1', 'Leaves_Pine', 'Leaf_Pine_C.png'],
    ['tall-thick-1', 'Bark_Pine', 'Bark_PineTree.png'],
    ['flower-1-group', 'Flowers', 'Flowers.png'],
  ])('%s maps %s to its dedicated texture', (key, name, file) => {
    const material = new MeshStandardMaterial({ name });
    processMaterial(key, material);

    expect(material.map.image.src).toBe(`${textureBase}/${file}`);
    expect(material.map.colorSpace).toBe(SRGBColorSpace);
    if (name.startsWith('Leaves') || name === 'Flowers') {
      expect(material.userData.__foliageCandidate).toBe(true);
      expect(material.alphaTest).toBeGreaterThan(0);
      expect(material.side).toBe(DoubleSide);
    }
  });

  test('preserves an existing diffuse and opacity map instead of replacing authored textures', () => {
    const map = new Texture();
    map.image = { src: 'assets/custom-leaves.png' };
    const alphaMap = new Texture();
    const material = new MeshStandardMaterial({ name: 'Leaves_TallThick', map, alphaMap });
    const cache = processMaterial('tall-thick-1', material, { foliageAlphaTest: 0.2 });

    expect(material.map).toBe(map);
    expect(material.alphaMap).toBe(alphaMap);
    expect(material.alphaTest).toBe(0.2);
    expect(cache._textureLoader.load).not.toHaveBeenCalled();
  });

  test.each(['MI_MZRa_Monstera_B07a1', 'MI_MZRa_Monstera_B07a2'])(
    '%s uses its authored RGBA cutout instead of the missing FBX opacity mask',
    (name) => {
      const map = new Texture();
      const material = new MeshStandardMaterial({ name, map, alphaMap: new Texture() });

      processMaterial('tropical-monstera-a', material);

      expect(material.map).toBe(map);
      expect(material.alphaMap).toBeNull();
      expect(material.alphaTest).toBeGreaterThan(0);
      expect(material.transparent).toBe(false);
      expect(material.side).toBe(DoubleSide);
    }
  );
});

test('model readiness waits for required post-processed textures and reports load failures', async () => {
  const cache = new ModelAssetCache();
  let rejectTexture;
  cache._textureLoader = {
    load: jest.fn((_url, _onLoad, _onProgress, onError) => {
      rejectTexture = onError;
      return new Texture();
    }),
  };
  const root = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ name: 'Leaves_TallThick' })
  );
  postProcessModel(cache, three, root, 'tall-thick-1', 'fixture.obj', 'OBJ', {});
  cache._cache.set('tall-thick-1', root);
  let settled = false;
  const ready = cache.whenModelReady('tall-thick-1').finally(() => {
    settled = true;
  });
  await Promise.resolve();
  expect(settled).toBe(false);
  rejectTexture(new Error('Texture unavailable'));
  await expect(ready).rejects.toThrow(/texture/i);
});

test('the Dungeon wall import corrects invisible source materials without changing other models', () => {
  const dungeon = new MeshStandardMaterial({ opacity: 0, transparent: true });
  const other = new MeshStandardMaterial({ opacity: 0, transparent: true });
  const descriptor = new ModelAssetCache()._loadRegistryEntry('source-dungeon-wall');

  processMaterial('source-dungeon-wall', dungeon, descriptor);
  processMaterial('other-model', other);

  expect(dungeon.opacity).toBe(1);
  expect(dungeon.transparent).toBe(false);
  expect(dungeon.depthWrite).toBe(true);
  expect(other.opacity).toBe(0);
  expect(other.transparent).toBe(true);
});

test.each([
  ['source-cave-stalagmite', 'Cave Limestone Warm Grey', 'Closed_Limestone_Bedrock_Mesh001'],
  ['source-cave-column', 'Cave Stone Warm', 'Continuous_Fractured_Column_Mesh'],
])('%s keeps its authored untextured stone materials', (key, name, nodeName) => {
  const descriptor = new ModelAssetCache()._loadRegistryEntry(key);
  const material = new MeshStandardMaterial({ name, color: 0x4c463f });
  const cache = processMaterial(key, material, descriptor, nodeName);
  expect(material.map).toBeNull();
  expect(material.color.getHex()).toBe(0x4c463f);
  expect(material.userData.__foliageCandidate).toBe(false);
  expect(cache._textureLoader.load).not.toHaveBeenCalled();
});

describe('Authored model scale', () => {
  test('height calibration preserves existing nonuniform scale instead of replacing it', () => {
    const root = new Mesh(new BoxGeometry(1, 2, 1), new MeshStandardMaterial());
    root.scale.set(2, 3, 4);

    autoScaleModel(three, root, 6);

    expect(root.scale.toArray()).toEqual([2, 3, 4]);
    expect(new Box3().setFromObject(root).getSize(new Vector3()).y).toBeCloseTo(6);
  });
});
