import { BoxGeometry, Group, Matrix4, Mesh, MeshStandardMaterial, Scene, Vector3 } from 'three';

import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';

function fixture(width = 1.2, getHeight = () => 3, canopyWidth = 0) {
  const model = new Group();
  const trunk = new Mesh(
    new BoxGeometry(width, 4, width).translate(0, 2, 0),
    new MeshStandardMaterial()
  );
  model.add(trunk);
  if (canopyWidth) {
    const leaves = new Mesh(
      new BoxGeometry(canopyWidth, 1, canopyWidth).translate(0, 3.5, 0),
      new MeshStandardMaterial()
    );
    model.add(leaves);
  }
  const gameManager = {
    cols: 5,
    rows: 5,
    is3DModeActive: () => true,
    threeSceneManager: { scene: new Scene() },
    modelAssetCache: { getModel: async () => model },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, y) => ({ x, y: 0, z: y }),
    },
    getTerrainHeight: getHeight,
  };
  return { gameManager, pool: new PlaceableMeshPool({ gameManager }) };
}

function tree(overrides = {}) {
  return {
    type: 'plant',
    modelKey: 'common-broadleaf-1',
    placeableId: 'tree-green-deciduous',
    generatedBiome: true,
    gridX: 2,
    gridY: 2,
    ...overrides,
  };
}

function instanceScale(pool, handle) {
  const matrix = new Matrix4();
  pool._groups.get(handle.key).instancedMesh.getMatrixAt(handle.index, matrix);
  return new Vector3().setFromMatrixScale(matrix);
}

describe('Generated tree trunk support', () => {
  test('keeps the normal size when the whole trunk base is supported', async () => {
    const { pool } = fixture();
    const handle = await pool.addPlaceable(tree());
    expect(instanceScale(pool, handle).toArray()).toEqual([1, 1, 1]);
    pool.dispose();
  });

  test('shrinks uniformly just enough to keep a trunk clear of a lower neighboring tile', async () => {
    const { pool } = fixture(1.2, (x) => (x === 3 ? 0 : 3));
    const handle = await pool.addPlaceable(tree());
    const scale = instanceScale(pool, handle);

    expect(scale.x).toBeCloseTo(0.816666, 4);
    expect(scale.y).toBeCloseTo(scale.x);
    expect(scale.z).toBeCloseTo(scale.x);
    expect(2.5 + 0.6 * scale.x).toBeLessThanOrEqual(2.990001);
    pool.dispose();
  });

  test('does not let trunks extend outside the board', async () => {
    const { pool } = fixture();
    const handle = await pool.addPlaceable(tree({ gridX: 0 }));
    const scale = instanceScale(pool, handle);
    expect(scale.x).toBeCloseTo(0.816666, 4);
    expect(0.5 - 0.6 * scale.x).toBeGreaterThanOrEqual(0.009999);
    pool.dispose();
  });

  test('skips a site that would require shrinking below 65 percent', async () => {
    const { pool } = fixture(1.8, (x, y) => (x === 2 && y === 2 ? 3 : 0));
    expect(await pool.addPlaceable(tree())).toBeNull();
    expect(pool.getStats().instances).toBe(0);
    pool.dispose();
  });

  test('allows canopy overhang when the actual trunk base fits', async () => {
    const { pool } = fixture(0.6, () => 3, 6);
    const handle = await pool.addPlaceable(tree({ gridX: 0 }));
    expect(instanceScale(pool, handle).toArray()).toEqual([1, 1, 1]);
    pool.dispose();
  });

  test('does not resize manually placed trees', async () => {
    const { pool } = fixture(1.8, (x, y) => (x === 2 && y === 2 ? 3 : 0));
    const handle = await pool.addPlaceable(tree({ generatedBiome: false }));
    expect(instanceScale(pool, handle).toArray()).toEqual([1, 1, 1]);
    pool.dispose();
  });

  test('preserves the fitted size when terrain elevation is refreshed', async () => {
    const { pool, gameManager } = fixture(1.2, (x) => (x === 3 ? 0 : 3));
    const handle = await pool.addPlaceable(tree());
    const before = instanceScale(pool, handle);
    expect(before.x).toBeLessThan(1);
    gameManager.spatial.elevationUnit = 0.75;

    await pool.resyncHeights();

    expect(instanceScale(pool, handle).toArray()).toEqual(before.toArray());
    const matrix = new Matrix4();
    pool._groups.get(handle.key).instancedMesh.getMatrixAt(handle.index, matrix);
    expect(matrix.elements[13]).toBeCloseTo(2.25);
    pool.dispose();
  });
});
