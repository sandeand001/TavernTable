import fs from 'fs';
import path from 'path';
import { TextDecoder } from 'util';
import * as three from 'three';

import GameManager from '../../../src/core/GameManager.js';
import ModelAssetCache from '../../../src/core/ModelAssetCache.js';
import { PlaceableMeshPool } from '../../../src/scene/terrain/PlaceableMeshPool.js';

const projectRoot = path.resolve(__dirname, '..', '..', '..');

describe('Generated biome trunks with actual model assets', () => {
  let fileLoad;
  let textureLoad;
  const originalDecoder = globalThis.TextDecoder;

  beforeAll(() => {
    globalThis.TextDecoder = TextDecoder;
    textureLoad = jest.spyOn(three.TextureLoader.prototype, 'load').mockImplementation(() => {
      return new three.Texture();
    });
    fileLoad = jest
      .spyOn(three.FileLoader.prototype, 'load')
      .mockImplementation(function (url, onLoad, onProgress, onError) {
        let bytes;
        try {
          bytes = fs.readFileSync(
            path.resolve(projectRoot, ...decodeURIComponent(url).split(/[\\/]/))
          );
        } catch (error) {
          queueMicrotask(() => onError(error));
          return;
        }
        const response =
          this.responseType === 'arraybuffer'
            ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
            : bytes.toString('utf8');
        queueMicrotask(() => onLoad(response));
      });
  });

  afterAll(() => {
    fileLoad.mockRestore();
    textureLoad.mockRestore();
    if (originalDecoder === undefined) delete globalThis.TextDecoder;
    else globalThis.TextDecoder = originalDecoder;
  });

  test.each([
    ['oasis', 12345],
    ['oasis', 1583664074],
    ['forestTemperate', 12345],
    ['mysticGrove', 24680],
  ])('%s seed %s leaves every rendered trunk base on supported ground', async (biome, seed) => {
    const gm = new GameManager({ cols: 25, rows: 25 });
    gm.renderMode = '3d';
    gm.threeSceneManager = { scene: new three.Scene(), isReady: () => true };
    gm.modelAssetCache = new ModelAssetCache();
    const pool = new PlaceableMeshPool({ gameManager: gm });
    gm.placeableMeshPool = pool;
    const add = pool.addPlaceable.bind(pool);
    const placements = [];
    pool.addPlaceable = (item) => {
      const pending = add(item);
      placements.push({ item, pending });
      return pending;
    };

    expect(gm.terrainCoordinator.generateBiomeElevation(biome, { seed })).toBe(true);
    const handles = await Promise.all(placements.map(({ pending }) => pending));
    expect(handles.filter(Boolean).length).toBeGreaterThan(0);
    const matrix = new three.Matrix4();
    const point = new three.Vector3();
    const origin = gm.spatial.gridToWorld(0, 0, 0);
    const tileSize = gm.spatial.tileWorldSize;
    let checkedTrunks = 0;

    for (let i = 0; i < placements.length; i++) {
      const { item } = placements[i];
      const handle = handles[i];
      if (!handle || !item.placeableId.startsWith('tree-')) continue;
      const instance = pool._groups.get(handle.key).instancedMesh;
      instance.getMatrixAt(handle.index, matrix);
      const scale = new three.Vector3().setFromMatrixScale(matrix);
      expect(scale.x).toBeGreaterThanOrEqual(0.65 - 1e-6);
      expect(scale.x).toBeLessThanOrEqual(1);
      expect(scale.y).toBeCloseTo(scale.x);
      expect(scale.z).toBeCloseTo(scale.x);
      instance.geometry.computeBoundingBox();
      const bounds = instance.geometry.boundingBox;
      const ceiling = bounds.min.y + (bounds.max.y - bounds.min.y) * 0.02 + 1e-7;
      const positions = instance.geometry.attributes.position;
      const baseHeight = gm.getTerrainHeight(item.gridX, item.gridY);
      let checkedVertices = 0;
      for (let vertex = 0; vertex < positions.count; vertex++) {
        point.fromBufferAttribute(positions, vertex);
        if (point.y > ceiling) continue;
        point.applyMatrix4(matrix);
        const x = Math.floor((point.x - origin.x) / tileSize);
        const y = Math.floor((point.z - origin.z) / tileSize);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(gm.cols);
        expect(y).toBeLessThan(gm.rows);
        expect(gm.getTerrainHeight(x, y)).toBeCloseTo(baseHeight, 4);
        checkedVertices++;
      }
      expect(checkedVertices).toBeGreaterThan(0);
      checkedTrunks++;
    }
    if (biome !== 'oasis') expect(checkedTrunks).toBeGreaterThan(0);
    pool.dispose();
  });
});
