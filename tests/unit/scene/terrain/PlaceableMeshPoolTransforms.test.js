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
import * as three from 'three';

import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';
import { ThreeSceneManager } from '../../../../src/scene/ThreeSceneManager.js';
import { createPlaceableModelGeometry } from '../../../../src/scene/terrain/placeableModelGeometry.js';
import { prepareBiomePlacements } from '../../../../src/scene/terrain/PrepareBiomePlacements.js';

function preparationFixture() {
  const model = new Mesh(new BoxGeometry(0.5, 2, 0.5), new MeshStandardMaterial());
  model.position.y = 1;
  const liveScene = new Scene();
  const marker = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial());
  liveScene.add(marker);
  const gameManager = {
    threeSceneManager: { scene: liveScene },
    modelAssetCache: { getModel: jest.fn(async () => model) },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, y) => ({ x, y: 0, z: y }),
    },
  };
  const plan = {
    biomeKey: 'forestTemperate',
    seed: 42,
    heights: Array.from({ length: 5 }, () => Array(5).fill(2)),
    placements: [
      {
        type: 'plant',
        modelKey: 'common-broadleaf-1',
        variantKey: 'tree-green-deciduous',
        placeableId: 'tree-green-deciduous',
        generatedBiome: true,
        biomeKey: 'forestTemperate',
        biomeSeed: 42,
        gridX: 2,
        gridY: 2,
      },
    ],
  };
  return { gameManager, liveScene, marker, model, plan };
}

describe('Instanced model transforms', () => {
  test.each(['cavern', 'crystalSpires'])(
    '%s formations vary substantially in size and have natural within-tile offsets',
    async (biomeKey) => {
      const { gameManager, model, plan } = preparationFixture();
      plan.biomeKey = biomeKey;
      plan.heights = Array.from({ length: 5 }, () => Array(5).fill(-8));
      plan.placements = Array.from({ length: 25 }, (_, index) => ({
        type: 'plant',
        modelKey: 'source-cave-stalagmite',
        variantKey: 'source-cave-stalagmite',
        placeableId: 'source-cave-stalagmite',
        generatedBiome: true,
        biomeKey,
        biomeSeed: 42,
        gridX: index % 5,
        gridY: Math.floor(index / 5),
      }));
      const { placements } = await prepareBiomePlacements(gameManager, plan);
      const heights = placements.map(({ persistedScale }) => persistedScale.y);
      expect(Math.max(...heights) / Math.min(...heights)).toBeGreaterThan(2.5);
      expect(
        placements.some(
          ({ gridOffsetX, gridOffsetY }) => Math.abs(gridOffsetX) + Math.abs(gridOffsetY) > 0.05
        )
      ).toBe(true);
      model.geometry.dispose();
      model.material.dispose();
    }
  );

  test('formation orientation remains stable after height changes and save/restore', async () => {
    const { gameManager, model } = preparationFixture();
    gameManager.is3DModeActive = () => true;
    gameManager.getTerrainHeight = () => -8;
    gameManager.terrainEngine = { biomeKey: 'cavern', biomeSeed: 42 };
    const pool = new PlaceableMeshPool({ gameManager });
    const formation = {
      type: 'plant',
      modelKey: 'source-cave-stalagmite',
      placeableId: 'source-cave-stalagmite',
      generatedBiome: true,
      biomeKey: 'cavern',
      biomeSeed: 42,
      gridX: 1,
      gridY: 2,
    };
    const handle = await pool.addPlaceable(formation, { strict: true });
    const initial = new three.Matrix4();
    pool._groups.get(handle.key).instancedMesh.getMatrixAt(handle.index, initial);
    const [saved] = await pool.snapshotPlacements();
    expect(saved.angleRadians).toBeCloseTo(Math.PI / 2);
    expect(Math.abs(saved.gridOffsetX) + Math.abs(saved.gridOffsetY)).toBeGreaterThan(0);
    await pool.resyncHeights();
    const resynced = new three.Matrix4();
    pool._groups.get(handle.key).instancedMesh.getMatrixAt(handle.index, resynced);
    expect(resynced.elements).toEqual(initial.elements);
    await pool.restorePlacements([saved]);
    const [restored] = await pool.snapshotPlacements();
    expect(restored).toEqual(saved);
    const entry = [...pool._metadata.entries()][0];
    const index = [...entry[1].keys()][0];
    const reopened = new three.Matrix4();
    pool._groups.get(entry[0]).instancedMesh.getMatrixAt(index, reopened);
    expect(reopened.elements).toEqual(initial.elements);
    pool.dispose();
    model.geometry.dispose();
    model.material.dispose();
  });

  test('purchased trees stay upright, vary their orientation and restore it from saved placements', async () => {
    const { gameManager, model } = preparationFixture();
    Object.assign(gameManager, {
      cols: 5,
      rows: 5,
      is3DModeActive: () => true,
      getTerrainHeight: () => 2,
      terrainEngine: { biomeKey: 'forestConifer', biomeSeed: 42 },
    });
    const pool = new PlaceableMeshPool({ gameManager });
    const tree = (gridX) => ({
      type: 'plant',
      modelKey: 'pure-poly-fir-01',
      placeableId: 'pure-poly-fir-01',
      generatedBiome: true,
      biomeKey: 'forestConifer',
      biomeSeed: 42,
      gridX,
      gridY: 2,
    });
    const first = await pool.addPlaceable(tree(2), { strict: true });
    await pool.addPlaceable(tree(3), { strict: true });
    const saved = await pool.snapshotPlacements();
    expect(saved).toHaveLength(2);
    expect(saved[0].angleRadians).not.toBe(saved[1].angleRadians);
    const matrix = new three.Matrix4();
    pool._groups.get(first.key).instancedMesh.getMatrixAt(first.index, matrix);
    expect(matrix.elements[1]).toBeCloseTo(0);
    expect(matrix.elements[4]).toBeCloseTo(0);
    expect(matrix.elements[6]).toBeCloseTo(0);
    expect(matrix.elements[5]).toBeGreaterThan(0);
    await pool.restorePlacements(saved);
    expect(await pool.snapshotPlacements()).toEqual(saved);
    pool.dispose();
    model.geometry.dispose();
    model.material.dispose();
  });

  test('previously saved centered formations do not shift on restore', async () => {
    const { gameManager, model, plan } = preparationFixture();
    plan.biomeKey = 'cavern';
    plan.placements = [
      {
        type: 'plant',
        modelKey: 'source-cave-stalagmite',
        placeableId: 'source-cave-stalagmite',
        biomeKey: 'cavern',
        biomeSeed: 42,
        gridX: 1,
        gridY: 2,
        angleRadians: Math.PI / 2,
        persistedScale: { x: 0.6, y: 1.1, z: 0.6 },
      },
    ];
    const first = await prepareBiomePlacements(gameManager, plan);
    expect(first.placements[0].gridOffsetX).toBeUndefined();
    expect(first.placements[0].gridOffsetY).toBeUndefined();
    expect(first.placements[0].persistedScale).toEqual({ x: 0.6, y: 1.1, z: 0.6 });
    expect(first.sightBounds[0].min.x + first.sightBounds[0].max.x).toBeCloseTo(3);
    expect(first.sightBounds[0].min.z + first.sightBounds[0].max.z).toBeCloseTo(5);
    model.geometry.dispose();
    model.material.dispose();
  });

  test('cavern formations are grounded and occlude sight while translucent spires do not', async () => {
    const { gameManager, model, plan } = preparationFixture();
    plan.biomeKey = 'cavern';
    plan.heights = Array.from({ length: 5 }, () => Array(5).fill(-8));
    plan.placements = [
      {
        type: 'plant',
        modelKey: 'source-cave-stalagmite',
        variantKey: 'source-cave-stalagmite',
        placeableId: 'source-cave-stalagmite',
        generatedBiome: true,
        biomeKey: 'cavern',
        biomeSeed: 42,
        gridX: 2,
        gridY: 2,
      },
    ];
    const cavern = await prepareBiomePlacements(gameManager, plan);
    expect(cavern.sightBounds).toHaveLength(1);
    expect(cavern.sightBounds[0].min.y).toBeCloseTo(-4);
    const again = await prepareBiomePlacements(gameManager, plan);
    expect(again).toEqual(cavern);

    plan.biomeKey = 'crystalSpires';
    plan.placements[0].biomeKey = 'crystalSpires';
    const crystals = await prepareBiomePlacements(gameManager, plan);
    expect(crystals.sightBounds).toHaveLength(0);
    expect(crystals.placements[0].persistedScale.y).toBeGreaterThan(
      cavern.placements[0].persistedScale.y
    );
    model.geometry.dispose();
    model.material.dispose();
  });

  test('a placed torch light follows terrain height changes and is removed with its source', async () => {
    let height = 0;
    const flame = new MeshStandardMaterial();
    flame.name = 'Fire';
    const model = new Mesh(new BoxGeometry(0.25, 0.9, 0.25), flame);
    model.position.y = 0.45;
    const gm = {
      cols: 5,
      rows: 5,
      is3DModeActive: () => true,
      modelAssetCache: { getModel: async () => model },
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 0.5,
        gridToWorld: (x, y) => ({ x, y: 0, z: y }),
      },
      getTerrainHeight: () => height,
    };
    const manager = new ThreeSceneManager(gm);
    gm.threeSceneManager = manager;
    manager.scene = new Scene();
    manager.three = three;
    manager.setSceneLightingBiome('dungeon');
    const pool = new PlaceableMeshPool({ gameManager: gm });
    const torch = { type: 'plant', modelKey: 'source-dungeon-torch', gridX: 2, gridY: 2 };
    await pool.addPlaceable(torch, { strict: true });
    manager.refreshLocalLighting();
    const first = manager.scene.getObjectByName('UndergroundLocalLights').children[0].position.y;
    height = 2;
    await pool.resyncHeights();
    manager.refreshLocalLighting();
    const moved = manager.scene.getObjectByName('UndergroundLocalLights').children[0].position.y;
    expect(moved - first).toBeCloseTo(1);
    pool.removePlaceable(torch);
    manager.refreshLocalLighting();
    expect(manager.scene.getObjectByName('UndergroundLocalLights').children).toHaveLength(0);
    pool.dispose();
    manager.disposeLocalLighting();
    model.geometry.dispose();
    flame.dispose();
  });

  test('prepares grounded placements without changing the live scene or plan', async () => {
    const { gameManager, liveScene, marker, model, plan } = preparationFixture();
    const before = JSON.parse(JSON.stringify(plan));
    const disposeGeometry = jest.spyOn(model.geometry, 'dispose');
    const previousMetrics = window.__TT_METRICS__;
    window.__TT_METRICS__ = { placeables: { groups: 7, liveInstances: 9 } };
    try {
      const prepared = await prepareBiomePlacements(gameManager, plan);
      expect(prepared.placements).toHaveLength(1);
      expect(prepared.placements[0].persistedScale).toEqual({ x: 1, y: 1, z: 1 });
      expect(prepared.sightBounds).toHaveLength(1);
      expect(liveScene.children).toEqual([marker]);
      expect(window.__TT_METRICS__.placeables).toEqual({ groups: 7, liveInstances: 9 });
      expect(plan).toEqual(before);
      expect(disposeGeometry).not.toHaveBeenCalled();
    } finally {
      window.__TT_METRICS__ = previousMetrics;
      disposeGeometry.mockRestore();
    }
  });

  test('a missing model rejects preparation without changing the live scene', async () => {
    const { gameManager, liveScene, marker, plan } = preparationFixture();
    gameManager.modelAssetCache.getModel.mockResolvedValue(null);
    await expect(prepareBiomePlacements(gameManager, plan)).rejects.toThrow(/common-broadleaf-1/i);
    expect(liveScene.children).toEqual([marker]);
  });

  test('an unsupported tree site is skipped without treating it as an asset failure', async () => {
    const { gameManager, model, plan } = preparationFixture();
    model.geometry.dispose();
    model.geometry = new BoxGeometry(3, 2, 3);
    plan.placements[0].gridX = 0;
    const prepared = await prepareBiomePlacements(gameManager, plan);
    expect(prepared.placements).toEqual([]);
    expect(prepared.sightBounds).toEqual([]);
  });

  test('a generated tree is skipped when its roots extend beyond physical floor support', async () => {
    const { gameManager, model, plan } = preparationFixture();
    model.geometry.dispose();
    model.geometry = new BoxGeometry(3, 2, 3);
    const prepared = await prepareBiomePlacements(gameManager, plan, {
      isTerrainSupported: (x, y) => x === 2 && y === 2,
    });
    expect(prepared.placements).toEqual([]);
  });

  test('out-of-bounds placements fail before any model is loaded', async () => {
    const { gameManager, plan } = preparationFixture();
    plan.placements[0].gridX = 5;
    await expect(prepareBiomePlacements(gameManager, plan)).rejects.toThrow(/outside its grid/i);
    expect(gameManager.modelAssetCache.getModel).not.toHaveBeenCalled();
  });

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
