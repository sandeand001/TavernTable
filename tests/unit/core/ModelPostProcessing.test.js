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

import { postProcessModel } from '../../../src/core/ModelPostProcessing.js';

const three = { Box3, DoubleSide, SRGBColorSpace, Vector3 };
const textureBase = 'assets/terrain/3d Assets/Textures';

function processMaterial(key, material, descriptor = {}) {
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
});
