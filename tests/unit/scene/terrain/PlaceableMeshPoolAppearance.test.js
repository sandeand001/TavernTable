import { BoxGeometry, Mesh, MeshPhongMaterial, Scene, Texture } from 'three';

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
    terrainCoordinator: { _lastGeneratedBiomeKey: 'grassland', _biomeSeed: 42 },
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
    gameManager.terrainCoordinator._lastGeneratedBiomeKey = 'arcaneLeyNexus';
    gameManager.modelAssetCache.getModel.mockReturnValue(loading);
    const pending = pool.addPlaceable({ ...placement(undefined) });
    gameManager.terrainCoordinator._lastGeneratedBiomeKey = 'grassland';
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
});
