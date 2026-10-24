import { BoxGeometry, Mesh, MeshBasicMaterial, Scene } from 'three';

import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';

function makeModel() {
  return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
}

function makePool() {
  const scene = new Scene();
  const gameManager = {
    is3DModeActive: () => true,
    threeSceneManager: { scene },
    modelAssetCache: { getModel: jest.fn(async () => makeModel()) },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, y) => ({ x, y: 0, z: y }),
    },
    getTerrainHeight: () => 0,
  };
  const pool = new PlaceableMeshPool({ gameManager, initialCapacity: 8 });
  return { pool, gameManager, scene };
}

function makePlaceable(gridX = 0) {
  return {
    gridX,
    gridY: 0,
    type: 'plant',
    modelKey: 'common-broadleaf-1',
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Asynchronous placeable group ownership', () => {
  test('concurrent placements share one scene mesh and retain every instance', async () => {
    const { pool, gameManager, scene } = makePool();
    const handles = await Promise.all([0, 1, 2].map((x) => pool.addPlaceable(makePlaceable(x))));

    expect(gameManager.modelAssetCache.getModel).toHaveBeenCalledTimes(1);
    expect(scene.children).toHaveLength(1);
    expect(pool.getStats()).toMatchObject({ groups: 1, instances: 3 });
    expect(handles.map((handle) => handle.index)).toEqual([0, 1, 2]);

    pool.clearAll();
    expect(pool.getStats().instances).toBe(0);
    expect(scene.children.every((mesh) => mesh.count === 0)).toBe(true);
  });

  test.each(['clearAll', 'fullReset', 'purgeAll'])(
    '%s prevents a late old model from replacing the current generation',
    async (reset) => {
      const { pool, gameManager, scene } = makePool();
      const oldModel = deferred();
      const started = deferred();
      const currentModel = makeModel();
      gameManager.modelAssetCache.getModel
        .mockImplementationOnce(() => {
          started.resolve();
          return oldModel.promise;
        })
        .mockResolvedValueOnce(currentModel);

      const oldPlacement = pool.addPlaceable(makePlaceable());
      await started.promise;
      await pool[reset]();
      const currentHandle = await pool.addPlaceable(makePlaceable(1));
      oldModel.resolve(makeModel());

      expect(await oldPlacement).toBeNull();
      expect(currentHandle).toBeTruthy();
      expect(pool.getStats()).toMatchObject({ groups: 1, instances: 1 });
      expect(scene.children).toHaveLength(1);
      expect(scene.children[0].geometry).toBe(currentModel.geometry);
    }
  );

  test('dispose cancels pending models instead of adding a mesh after disposal', async () => {
    const { pool, gameManager, scene } = makePool();
    const model = deferred();
    const started = deferred();
    gameManager.modelAssetCache.getModel.mockImplementationOnce(() => {
      started.resolve();
      return model.promise;
    });

    const placement = pool.addPlaceable(makePlaceable());
    await started.promise;
    pool.dispose();
    model.resolve(makeModel());

    expect(await placement).toBeNull();
    expect(scene.children).toHaveLength(0);
    expect(pool.getStats()).toMatchObject({ groups: 0, instances: 0 });
  });
});
