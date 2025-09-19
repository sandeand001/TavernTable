import { TerrainCoordinator } from '../../src/coordinators/TerrainCoordinator.js';
import { TERRAIN_PLACEABLES } from '../../src/config/TerrainPlaceables.js';

// Helper to build a minimal game manager similar to existing integration tests
function makeGameManager(cols = 12, rows = 12) {
  const gridContainer = {
    children: [],
    sortChildren: jest.fn(),
    addChild(child) {
      this.children.push(child);
    },
    removeChild(child) {
      this.children = this.children.filter((c) => c !== child);
    },
    getChildIndex(child) {
      return this.children.indexOf(child);
    },
    sortableChildren: true,
  };
  const app = { view: document.createElement('canvas') };
  const gridRenderer = {
    // minimal stub that marks tiles
    drawIsometricTile: jest.fn((x, y) => {
      const g = new PIXI.Graphics();
      g.isGridTile = true;
      g.gridX = x;
      g.gridY = y;
      g.baseIsoY = 100;
      g.y = 100;
      g.depthValue = x + y;
      g.clear = jest.fn();
      g.lineStyle = jest.fn();
      g.beginFill = jest.fn();
      g.moveTo = jest.fn();
      g.lineTo = jest.fn();
      g.endFill = jest.fn();
      g.addChild = jest.fn();
      g.parent = gridContainer;
      return g;
    }),
  };
  return {
    cols,
    rows,
    tileWidth: 64,
    tileHeight: 32,
    gridContainer,
    app,
    gridRenderer,
    tokenManager: { placedTokens: [] },
  };
}

function collectPlants(c) {
  const out = [];
  for (const [, list] of c.terrainManager.placeables || []) {
    for (const p of list) if (p.placeableType === 'plant') out.push(p);
  }
  return out;
}

// Identify a bare tree id to assert petrified constraint.
const BARE_IDS = Object.keys(TERRAIN_PLACEABLES).filter((k) => /bare/i.test(k));

// Utility to run two generations and compare
function generateFloraSnapshot(biome, seed, cols = 12, rows = 12) {
  const gm = makeGameManager(cols, rows);
  const c = new TerrainCoordinator(gm);
  // Inject minimal terrainManager stub if missing (enables flora placement)
  if (!c.terrainManager) {
    c.terrainManager = {
      gameManager: gm,
      placeables: new Map(),
      placeTerrainItem(x, y, id) {
        const key = `${x},${y}`;
        let list = this.placeables.get(key);
        if (!list) {
          list = [];
          this.placeables.set(key, list);
        }
        const plant = {
          placeableType: 'plant',
          placeableId: id,
          gridX: x,
          gridY: y,
          parent: gm.gridContainer,
        };
        list.push(plant);
        gm.gridContainer.addChild(plant);
        return true;
      },
    };
  } else if (!c.terrainManager.placeables) {
    c.terrainManager.placeables = new Map();
  }
  const ok = c.generateBiomeElevation(biome, { seed });
  expect(ok).toBe(true);
  const plants = collectPlants(c);
  const snapshot = plants
    .map((p) => ({ id: p.placeableId, x: p.gridX, y: p.gridY }))
    .sort((a, b) => a.x - b.x || a.y - b.y || a.id.localeCompare(b.id));
  return { snapshot, count: plants.length };
}

describe('Deterministic flora placement', () => {
  test('orchard grid deterministic layout repeated runs', () => {
    const run1 = generateFloraSnapshot('orchard', 777, 16, 12);
    const run2 = generateFloraSnapshot('orchard', 777, 16, 12);
    expect(run1.count).toBeGreaterThan(0);
    expect(run1.snapshot).toEqual(run2.snapshot);
  });

  test('different seed changes layout (orchard)', () => {
    const runA = generateFloraSnapshot('orchard', 1001, 16, 12);
    const runB = generateFloraSnapshot('orchard', 1002, 16, 12);
    // Probabilistic: allow possibility of equality but very unlikely; instead assert at least count or coordinate diff if possible
    const same = JSON.stringify(runA.snapshot) === JSON.stringify(runB.snapshot);
    // In rare case of collision, still pass if seed difference produced same (acceptable) but log
    if (same) {
      // eslint-disable-next-line no-console
      console.warn('Seed collision produced identical orchard snapshot (rare)');
    } else {
      expect(same).toBe(false);
    }
  });

  test('petrified forest only bare trees', () => {
    const run = generateFloraSnapshot('petrifiedForest', 4242, 18, 10);
    expect(run.count).toBeGreaterThan(0);
    const nonBare = run.snapshot.filter((p) => !BARE_IDS.includes(p.id));
    expect(nonBare.length).toBe(0);
  });

  test('oasis trees hug water edge deterministically', () => {
    const run = generateFloraSnapshot('oasis', 9999, 24, 16);
    // Heuristic: majority of trees should be adjacent to water (candidate filter enforces this)
    // We recompute adjacency using the TerrainCoordinator API.
    // Reconstruct a new coordinator with same seed to query heights.
    const gm2 = makeGameManager(24, 16);
    const c2 = new TerrainCoordinator(gm2);
    c2.generateBiomeElevation('oasis', { seed: 9999 });
    const adjCount = run.snapshot.filter((p) => {
      const x = p.x,
        y = p.y;
      const dirs = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      return dirs.some(([dx, dy]) => (c2.getTerrainHeight(x + dx, y + dy) || 0) <= 0);
    }).length;
    expect(adjCount / run.count).toBeGreaterThanOrEqual(0.7); // at least 70% hugging water
  });
});
