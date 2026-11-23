import {
  BoxGeometry,
  Frustum,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OrthographicCamera,
  Scene,
} from 'three';

import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';

function makeModel() {
  return new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial());
}

function makePool(initialCapacity = 8) {
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
  const pool = new PlaceableMeshPool({ gameManager, initialCapacity });
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
  test('growing an instance group keeps new placements at their actual positions', async () => {
    const { pool } = makePool(2);
    const handles = [];
    for (const x of [1, 2, 3]) handles.push(await pool.addPlaceable(makePlaceable(x)));
    const mesh = pool._groups.get(handles[0].key).instancedMesh;
    expect(mesh.count).toBe(3);
    const matrix = new Matrix4();
    for (let index = 0; index < handles.length; index++) {
      mesh.getMatrixAt(handles[index].index, matrix);
      expect(matrix.elements[12]).toBeCloseTo(index + 1.5);
    }
    pool.dispose();
  });

  test.each(['append', 'regenerate'])(
    'visible instances survive frustum culling after %s',
    async (operation) => {
      const { pool } = makePool();
      const first = await pool.addPlaceable(makePlaceable(20));
      const mesh = pool._groups.get(first.key).instancedMesh;
      mesh.computeBoundingSphere();
      if (operation === 'regenerate') pool.clearAll();
      await pool.addPlaceable(makePlaceable(1));
      const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
      camera.position.set(1.5, 10, 0.5);
      camera.lookAt(1.5, 0, 0.5);
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld(true);
      mesh.updateMatrixWorld(true);
      const frustum = new Frustum().setFromProjectionMatrix(
        new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      );
      expect(frustum.intersectsObject(mesh)).toBe(true);
      pool.dispose();
    }
  );

  test('height resynchronization refreshes instance visibility bounds', async () => {
    const { pool, gameManager } = makePool();
    gameManager.getTerrainHeight = () => 100;
    const handle = await pool.addPlaceable(makePlaceable(1));
    const mesh = pool._groups.get(handle.key).instancedMesh;
    mesh.computeBoundingSphere();
    gameManager.getTerrainHeight = () => 0;
    await pool.resyncHeights();
    const camera = new OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    camera.position.set(1.5, 10, 0.5);
    camera.lookAt(1.5, 0, 0.5);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld(true);
    mesh.updateMatrixWorld(true);
    const frustum = new Frustum().setFromProjectionMatrix(
      new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    );
    expect(frustum.intersectsObject(mesh)).toBe(true);
    pool.dispose();
  });

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
      expect(scene.children[0].geometry).not.toBe(currentModel.geometry);
      scene.children[0].geometry.computeBoundingBox();
      currentModel.geometry.computeBoundingBox();
      expect(scene.children[0].geometry.boundingBox.equals(currentModel.geometry.boundingBox)).toBe(
        true
      );
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

  test('a cleared pending crystal model disposes its uncommitted depth pass', async () => {
    const { pool, gameManager, scene } = makePool();
    const model = deferred();
    const started = deferred();
    gameManager.modelAssetCache.getModel.mockImplementationOnce(() => {
      started.resolve();
      return model.promise;
    });
    const dispose = jest.spyOn(MeshBasicMaterial.prototype, 'dispose');
    try {
      const placement = pool.addPlaceable({
        ...makePlaceable(),
        modelKey: 'source-cave-stalagmite',
        placeableId: 'source-cave-stalagmite',
        biomeKey: 'crystalSpires',
        biomeSeed: 42,
      });
      await started.promise;
      pool.clearAll();
      model.resolve(makeModel());
      expect(await placement).toBeNull();
      expect(scene.children).toHaveLength(0);
      expect(
        dispose.mock.instances.some((material) => material.name === 'CrystalSpiresDepth')
      ).toBe(true);
    } finally {
      dispose.mockRestore();
      pool.dispose();
    }
  });
});
