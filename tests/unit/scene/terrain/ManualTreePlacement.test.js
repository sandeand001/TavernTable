import * as three from 'three';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { TerrainEngineSceneAdapter } from '../../../../src/scene/terrain/TerrainEngineSceneAdapter.js';
import { PlaceableMeshPool } from '../../../../src/scene/terrain/PlaceableMeshPool.js';
import { GameErrors } from '../../../../src/utils/error/ErrorHandler.js';

async function waitFor(condition) {
  const deadline = Date.now() + 1000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Tree preview did not settle');
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function fixture(width = 1.2, height = (x) => (x === 3 ? 0 : 3)) {
  const engine = new TerrainEngine(5, 5);
  engine.load({
    heights: Array.from({ length: 5 }, (_, y) => Array.from({ length: 5 }, (_, x) => height(x, y))),
  });
  const model = new three.Group();
  model.add(
    new three.Mesh(
      new three.BoxGeometry(width, 4, width).translate(0, 2, 0),
      new three.MeshStandardMaterial()
    )
  );
  const scene = {
    three,
    scene: new three.Scene(),
    setTerrainBrushPreview: jest.fn(),
    clearTerrainBrushPreview: jest.fn(),
  };
  const gameManager = {
    cols: 5,
    rows: 5,
    terrainEngine: engine,
    is3DModeActive: () => true,
    threeSceneManager: scene,
    modelAssetCache: { getModel: jest.fn(async () => model) },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      gridToWorld: (x, y) => ({ x, y: 0, z: y }),
    },
    getTerrainHeight: (x, y) => engine.getHeightAt(x, y),
  };
  const pool = new PlaceableMeshPool({ gameManager });
  gameManager.placeableMeshPool = pool;
  const adapter = new TerrainEngineSceneAdapter({ engine, gameManager, threeSceneManager: scene });
  adapter.attach();
  engine.setPlaceablesPanelVisible(true);
  return {
    engine,
    scene,
    pool,
    gameManager,
    dispose() {
      adapter.detach();
      pool.dispose();
    },
  };
}

test('a tree preview and its placed model agree on reduced trunk support', async () => {
  const { engine, scene, pool, dispose } = fixture();
  try {
    engine.setSelectedPlaceable('tree-birch-a');
    engine.moveBrushTo(2, 2);
    await waitFor(() =>
      scene.setTerrainBrushPreview.mock.calls.some(([cells]) =>
        cells.some((cell) => cell.color === 0xf59e0b)
      )
    );
    engine.emitPlaceableChanged(2, 2, 'tree-birch-a');
    await pool.whenSettled();
    const [placed] = await pool.snapshotPlacements();
    expect(placed.placeableId).toBe('tree-birch-a');
    expect(placed.persistedScale.x).toBeCloseTo(0.816666, 4);
  } finally {
    dispose();
  }
});

test('a family preview places its chosen concrete tree model', async () => {
  const { engine, scene, pool, dispose } = fixture();
  const random = jest.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValue(0.99);
  try {
    engine.setSelectedPlaceable('family-birch');
    engine.moveBrushTo(2, 2);
    await waitFor(() =>
      scene.setTerrainBrushPreview.mock.calls.some(([cells]) =>
        cells.some((cell) => cell.color === 0xf59e0b)
      )
    );
    const previewCount = scene.setTerrainBrushPreview.mock.calls.length;
    engine.emitPlaceableChanged(2, 2, 'family-birch');
    await pool.whenSettled();
    const [placed] = await pool.snapshotPlacements();
    expect(placed).toMatchObject({
      type: 'plant',
      placeableId: 'tree-birch-a',
      variantKey: 'tree-birch-a',
      modelKey: 'birch-1',
    });
    expect(placed.persistedScale.x).toBeCloseTo(0.816666, 4);
    await waitFor(() => scene.setTerrainBrushPreview.mock.calls.length > previewCount);
    engine.emitPlaceableChanged(2, 2, 'family-birch');
    await pool.whenSettled();
    const placements = await pool.snapshotPlacements();
    expect(placements.map(({ placeableId }) => placeableId)).toEqual([
      'tree-birch-a',
      'tree-birch-e',
    ]);
  } finally {
    random.mockRestore();
    dispose();
  }
});

test('a mixed tree brush marks supported and blocked cells independently', async () => {
  const { engine, scene, dispose } = fixture(1.8);
  try {
    engine.setSelectedPlaceable('tree-birch-a');
    engine.setPlaceableBrushSize(2);
    engine.moveBrushTo(1, 2);
    await waitFor(() =>
      scene.setTerrainBrushPreview.mock.calls.some(([cells]) =>
        cells.some((cell) => cell.color === 0xef4444)
      )
    );
    const [cells] = scene.setTerrainBrushPreview.mock.calls.at(-1);
    expect(cells.find(({ x, y }) => x === 1 && y === 2).color).toBe(0x22d3ee);
    expect(cells.find(({ x, y }) => x === 2 && y === 2).color).toBe(0xef4444);
  } finally {
    dispose();
  }
});

test('an unsupported manual tree is rejected with a user-facing explanation', async () => {
  const { engine, scene, pool, dispose } = fixture(1.8, (x, y) => (x === 2 && y === 2 ? 3 : 0));
  const report = jest.spyOn(GameErrors, 'input').mockImplementation(() => {});
  try {
    engine.setSelectedPlaceable('tree-birch-a');
    engine.moveBrushTo(2, 2);
    await waitFor(() =>
      scene.setTerrainBrushPreview.mock.calls.some(([cells]) =>
        cells.some((cell) => cell.color === 0xef4444)
      )
    );
    engine.emitPlaceableChanged(2, 2, 'tree-birch-a');
    await expect(pool.whenSettled()).rejects.toThrow(/supported, level ground/i);
    await waitFor(() => report.mock.calls.length > 0);
    expect(pool.getStats().instances).toBe(0);
    expect(report.mock.calls[0][0].message).toMatch(/supported, level ground/i);
  } finally {
    report.mockRestore();
    dispose();
  }
});

test('a tree preview rejects a hole in a connected building floor', async () => {
  const { engine, scene, gameManager, dispose } = fixture(0.6, () => 0);
  engine.configureGeometryBase(0.5);
  engine.geometry.carve({
    id: 'floor-opening',
    bounds: { min: { x: 10, y: -1, z: 10 }, max: { x: 15, y: 1, z: 15 } },
  });
  gameManager.campaignMapId = 'building-floor';
  gameManager.campaignWorld = { getMap: () => ({ building: {} }) };
  try {
    engine.setSelectedPlaceable('tree-birch-a');
    engine.moveBrushTo(2, 2);
    await waitFor(() =>
      scene.setTerrainBrushPreview.mock.calls.some(([cells]) =>
        cells.some((cell) => cell.color === 0xef4444)
      )
    );
  } finally {
    dispose();
  }
});

test('a late tree-model load cannot restore a cleared preview', async () => {
  const { engine, scene, gameManager, dispose } = fixture();
  let resolveModel;
  gameManager.modelAssetCache.getModel = jest.fn(
    () =>
      new Promise((resolve) => {
        resolveModel = resolve;
      })
  );
  try {
    engine.setSelectedPlaceable('tree-birch-a');
    engine.moveBrushTo(2, 2);
    await waitFor(() => resolveModel);
    engine.clearBrushPreview();
    resolveModel(new three.Mesh(new three.BoxGeometry(1, 2, 1), new three.MeshStandardMaterial()));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(scene.setTerrainBrushPreview).not.toHaveBeenCalled();
  } finally {
    dispose();
  }
});
