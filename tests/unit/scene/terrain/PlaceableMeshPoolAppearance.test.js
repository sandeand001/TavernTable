import {
  BoxGeometry,
  Matrix4,
  Mesh,
  MeshPhongMaterial,
  Raycaster,
  Scene,
  Texture,
  Vector3,
} from 'three';

import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';

function makePool(initialCapacity = 8) {
  const texture = new Texture();
  const bark = new MeshPhongMaterial({ name: 'Bark_NormalTree', color: 0x96735c, map: texture });
  const leaves = new MeshPhongMaterial({
    name: 'Leaves_NormalTree',
    color: 0x8abb55,
    map: texture,
    alphaTest: 0.05,
  });
  leaves.userData.__foliageCandidate = true;
  const model = new Mesh(new BoxGeometry(1, 1, 1), [bark, leaves]);
  const scene = new Scene();
  const gameManager = {
    is3DModeActive: () => true,
    threeSceneManager: { scene },
    terrainEngine: { biomeKey: 'grassland', biomeSeed: 42 },
    modelAssetCache: { getModel: jest.fn(async () => model.clone()) },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, y) => ({ x, y: 0, z: y }),
    },
    getTerrainHeight: () => 0,
  };
  const pool = new PlaceableMeshPool({ gameManager, initialCapacity, maxCapacity: 16 });
  return { pool, gameManager, scene, model, bark, leaves, texture };
}

function placement(biomeKey, gridX = 1) {
  return {
    biomeKey,
    biomeSeed: 42,
    modelKey: 'common-broadleaf-1',
    variantKey: 'tree-green-deciduous',
    type: 'plant',
    gridX,
    gridY: 2,
  };
}

function materialFor(pool, handle) {
  return pool._groups.get(handle.key).instancedMesh.material;
}

describe('Biome-specific model appearances', () => {
  test('glowing mushrooms use owned emissive materials and scale with the map grid', async () => {
    const { pool, gameManager, bark, leaves, texture } = makePool();
    gameManager.spatial.tileWorldSize = 0.8;
    const handle = await pool.addPlaceable({
      ...placement('fungalGrove'),
      modelKey: 'mushroom-glow',
      placeableId: 'mushroom-glow',
    });
    const materials = materialFor(pool, handle);
    expect(materials.every((material) => material.emissiveIntensity > 0)).toBe(true);
    expect(materials.every((material) => material.emissiveMap === texture)).toBe(true);
    expect(bark.emissive.getHex()).toBe(0);
    expect(leaves.emissive.getHex()).toBe(0);
    expect(pool._metadata.get(handle.key).get(handle.index).scale).toEqual({
      x: 0.8,
      y: 0.8,
      z: 0.8,
    });
  });

  test('untextured cavern formations stay readable without changing cached source materials', async () => {
    const { pool, bark, leaves } = makePool();
    bark.map = null;
    leaves.map = null;
    bark.color.setHex(0x4c463f);
    leaves.color.setHex(0x393836);
    const handle = await pool.addPlaceable({
      ...placement('cavern'),
      modelKey: 'source-cave-stalagmite',
      placeableId: 'source-cave-stalagmite',
    });
    const materials = materialFor(pool, handle);
    expect(materials[0].color.r).toBeGreaterThan(bark.color.r);
    expect(materials[1].color.g).toBeGreaterThan(leaves.color.g);
    expect(bark.color.getHex()).toBe(0x4c463f);
    expect(leaves.color.getHex()).toBe(0x393836);
  });

  test('textured cavern formations keep their stone detail without overbrightening the map', async () => {
    const { pool, bark, leaves, texture } = makePool();
    const handle = await pool.addPlaceable({
      ...placement('cavern'),
      modelKey: 'source-cave-stalagmite',
      placeableId: 'source-cave-stalagmite',
    });
    const materials = materialFor(pool, handle);
    expect(materials[0].map).toBe(texture);
    expect(materials[0].color.equals(bark.color)).toBe(true);
    expect(materials[1].color.equals(leaves.color)).toBe(true);
  });

  test('a model rests on a below-zero underground floor using its actual support anchor', async () => {
    const { pool, gameManager, model } = makePool();
    model.position.y = 0.75;
    model.updateMatrixWorld(true);
    gameManager.getTerrainHeight = () => -2;
    const handle = await pool.addPlaceable(placement('crystalSpires'));
    const group = pool._groups.get(handle.key);
    const matrix = new Matrix4();
    group.instancedMesh.getMatrixAt(handle.index, matrix);
    group.instancedMesh.geometry.computeBoundingBox();
    const bounds = group.instancedMesh.geometry.boundingBox.clone().applyMatrix4(matrix);

    expect(bounds.min.y).toBeCloseTo(-1, 6);
    gameManager.getTerrainHeight = () => -4;
    await pool.resyncHeights();
    group.instancedMesh.getMatrixAt(handle.index, matrix);
    bounds.copy(group.instancedMesh.geometry.boundingBox).applyMatrix4(matrix);
    expect(bounds.min.y).toBeCloseTo(-2, 6);
  });

  test('Arcane models have isolated translucent materials without changing cached assets', async () => {
    const { pool, bark, leaves, texture } = makePool();
    const handle = await pool.addPlaceable(placement('arcaneLeyNexus'));
    const materials = materialFor(pool, handle);

    expect(materials[0]).not.toBe(bark);
    expect(materials[1]).not.toBe(leaves);
    for (const material of materials) {
      expect(material.transparent).toBe(true);
      expect(material.opacity).toBeGreaterThan(0);
      expect(material.opacity).toBeLessThan(1);
      expect(material.map).toBe(texture);
      expect(material.customProgramCacheKey()).toContain('exotic-map-luma');
    }
    expect(bark.opacity).toBe(1);
    expect(leaves.opacity).toBe(1);
    expect(bark.color.getHex()).toBe(0x96735c);
    expect(leaves.color.getHex()).toBe(0x8abb55);
  });

  test('Astral models retain natural texture and diffuse colors with varying transparency', async () => {
    const { pool, bark, leaves } = makePool();
    const handle = await pool.addPlaceable(placement('astralPlateau'));
    const materials = materialFor(pool, handle);

    expect(materials[0].color.equals(bark.color)).toBe(true);
    expect(materials[1].color.equals(leaves.color)).toBe(true);
    expect(materials[1].map).toBe(leaves.map);
    expect(materials[1].opacity).toBeLessThan(1);
    expect(materials[1].customProgramCacheKey()).not.toContain('exotic-map-luma');
  });

  test('ordinary and exotic instances never share appearance groups or cached material state', async () => {
    const { pool, leaves } = makePool();
    const exotic = await pool.addPlaceable(placement('bloodMarsh'));
    const ordinary = await pool.addPlaceable(placement('grassland'));

    expect(exotic.key).not.toBe(ordinary.key);
    const normalLeaves = materialFor(pool, ordinary)[1];
    expect(normalLeaves.color.equals(leaves.color)).toBe(true);
    expect(normalLeaves.opacity).toBe(1);
    expect(normalLeaves.transparent).toBe(false);
    expect(normalLeaves.customProgramCacheKey()).not.toContain('exotic-map-luma');
  });

  test('captures the generated biome before awaiting a model load', async () => {
    const { pool, gameManager, model } = makePool();
    let release;
    const loading = new Promise((resolve) => {
      release = resolve;
    });
    gameManager.terrainEngine.biomeKey = 'arcaneLeyNexus';
    gameManager.modelAssetCache.getModel.mockReturnValue(loading);
    const pending = pool.addPlaceable({ ...placement(undefined) });
    gameManager.terrainEngine.biomeKey = 'grassland';
    release(model);

    const handle = await pending;
    expect(pool._groups.get(handle.key).appearance.biomeKey).toBe('arcaneLeyNexus');
    expect(materialFor(pool, handle)[1].opacity).toBeLessThan(1);
  });

  test('capacity expansion preserves magical materials and shadow state', async () => {
    const { pool } = makePool(1);
    const first = await pool.addPlaceable(placement('crystalSpires'));
    const originalMaterial = materialFor(pool, first);
    const second = await pool.addPlaceable(placement('crystalSpires'));
    const group = pool._groups.get(second.key);

    expect(first.key).toBe(second.key);
    expect(group.capacity).toBe(2);
    expect(group.instancedMesh.material).toBe(originalMaterial);
    expect(group.instancedMesh.material[1].opacity).toBeLessThan(1);
    expect(group.instancedMesh.castShadow).toBe(false);
  });

  test.each(['purgeAll', 'fullReset', 'dispose'])(
    'crystal depth follows growth, height changes and %s cleanup',
    async (operation) => {
      const { pool, bark, leaves, model, scene } = makePool(1);
      model.geometry.clearGroups();
      model.geometry.addGroup(0, model.geometry.index.count, 0);
      const first = await pool.addPlaceable({
        ...placement('crystalSpires'),
        modelKey: 'source-cave-stalagmite',
        placeableId: 'source-cave-stalagmite',
      });
      const group = pool._groups.get(first.key);
      const original = group.instancedMesh;
      const depth = group.depthPrepass;
      const materialDispose = jest.spyOn(depth.material, 'dispose');
      const meshDispose = jest.spyOn(depth, 'dispose');
      const sourceDisposals = [jest.spyOn(bark, 'dispose'), jest.spyOn(leaves, 'dispose')];
      depth.computeBoundingSphere();

      await pool.addPlaceable({
        ...placement('crystalSpires'),
        modelKey: 'source-cave-stalagmite',
        placeableId: 'source-cave-stalagmite',
      });
      expect(group.instancedMesh).not.toBe(original);
      expect(depth.parent).toBe(group.instancedMesh);
      expect(depth.instanceMatrix).toBe(group.instancedMesh.instanceMatrix);
      expect(depth.count).toBe(2);
      expect(depth.boundingSphere).toBeNull();
      scene.updateMatrixWorld(true);
      const ray = new Raycaster(new Vector3(1.5, 0.5, -5), new Vector3(0, 0, 1));
      const hits = ray.intersectObject(group.instancedMesh, true);
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.every(({ object }) => object === group.instancedMesh)).toBe(true);
      depth.computeBoundingSphere();
      await pool.resyncHeights();
      expect(depth.boundingSphere).toBeNull();

      pool.clearAll();
      expect(depth.count).toBe(0);
      await pool[operation]();
      expect(materialDispose).toHaveBeenCalledTimes(1);
      expect(meshDispose).toHaveBeenCalledTimes(1);
      expect(depth.parent).toBeNull();
      for (const dispose of sourceDisposals) expect(dispose).not.toHaveBeenCalled();
    }
  );

  test('depth prepass is limited to Crystal Spires cave formations', async () => {
    const { pool } = makePool();
    const cavern = await pool.addPlaceable({
      ...placement('cavern'),
      modelKey: 'source-cave-stalagmite',
      placeableId: 'source-cave-stalagmite',
    });
    const tree = await pool.addPlaceable(placement('crystalSpires'));
    const column = await pool.addPlaceable({
      ...placement('crystalSpires'),
      modelKey: 'source-cave-column',
      placeableId: 'source-cave-column',
    });
    expect(pool._groups.get(cavern.key).depthPrepass).toBeNull();
    expect(pool._groups.get(tree.key).depthPrepass).toBeNull();
    expect(pool._groups.get(column.key).depthPrepass).not.toBeNull();
    pool.purgeAll();
  });

  test('purging disposes owned material arrays without disposing cached source materials', async () => {
    const { pool, bark, leaves } = makePool();
    const sourceDisposals = [jest.spyOn(bark, 'dispose'), jest.spyOn(leaves, 'dispose')];
    const handle = await pool.addPlaceable(placement('arcaneLeyNexus'));
    const ownedDisposals = materialFor(pool, handle).map((material) =>
      jest.spyOn(material, 'dispose')
    );
    pool.purgeAll();

    for (const dispose of ownedDisposals) expect(dispose).toHaveBeenCalledTimes(1);
    for (const dispose of sourceDisposals) expect(dispose).not.toHaveBeenCalled();
  });

  test('saved logical placements preserve deleted trees, effective appearances and resolved scales', async () => {
    const first = makePool();
    const removed = placement(undefined, 1);
    const kept = {
      ...placement('arcaneLeyNexus', 2),
      persistedScale: { x: 0.4, y: 0.7, z: 0.5 },
      heightOffset: 0.03,
    };
    await Promise.all([first.pool.addPlaceable(removed), first.pool.addPlaceable(kept)]);
    first.pool.removePlaceable(removed);
    const saved = await first.pool.snapshotPlacements();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      gridX: 2,
      biomeKey: 'arcaneLeyNexus',
      biomeSeed: 42,
      modelKey: 'common-broadleaf-1',
      variantKey: 'tree-green-deciduous',
      persistedScale: kept.persistedScale,
      heightOffset: 0.03,
    });
    const second = makePool();
    await second.pool.restorePlacements(saved);
    expect(await second.pool.snapshotPlacements()).toEqual(saved);
  });

  test('grid removal hides plant instances and preserves buildings and neighboring cells', async () => {
    const { pool } = makePool();
    const plant = placement('grassland', 1);
    const handle = await pool.addPlaceable(plant);
    await pool.addPlaceable({ ...placement('grassland', 1), type: 'structure' });
    await pool.addPlaceable(placement('grassland', 2));
    expect(pool.removePlantsAt(1, 2)).toBe(1);
    expect(pool.removePlantsAt(1, 2)).toBe(0);
    const saved = await pool.snapshotPlacements();
    expect(saved).toHaveLength(2);
    expect(saved.some((entry) => entry.type === 'structure' && entry.gridX === 1)).toBe(true);
    expect(saved.some((entry) => entry.type === 'plant' && entry.gridX === 2)).toBe(true);
    const group = pool._groups.get(handle.key);
    const matrix = group.instancedMesh.instanceMatrix.array.slice(
      handle.index * 16,
      (handle.index + 1) * 16
    );
    expect(matrix[0]).toBe(0);
    expect(matrix[5]).toBe(0);
    expect(matrix[10]).toBe(0);
  });
});
