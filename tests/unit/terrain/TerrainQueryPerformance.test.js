import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { buildSurfaceRange } from '../../../src/terrain/SurfaceNavigation.js';
import * as volumes from '../../../src/terrain/TerrainVolumeShape.js';
import * as convex from '../../../src/terrain/ConvexGeometry.js';
import { Token3DAdapter } from '../../../src/scene/Token3DAdapter.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';
import { FootprintIndex } from '../../../src/terrain/FootprintIndex.js';

function castle() {
  const engine = new TerrainEngine(50, 50);
  engine.generateBiomeElevation('castle', { seed: 42 });
  return engine;
}

afterEach(() => jest.restoreAllMocks());

test('point support queries examine nearby ordered volumes, not every volume in a grand castle', () => {
  const engine = castle();
  const query = jest.spyOn(volumes, 'volumeIntervalAt');
  expect(engine.geometry.findSupport(12.5, 12.5, { belowFeet: 0, clearanceFeet: 5 })).toMatchObject(
    { heightFeet: 0 }
  );
  expect(query.mock.calls.length).toBeLessThan(32);
});

test('short movement clearance examines nearby solid fragments instead of the entire castle', () => {
  const engine = castle();
  engine.geometry.getSolidCells();
  const query = jest.spyOn(convex, 'boundsOverlap');
  expect(
    engine.geometry.isSpaceClear({
      min: { x: 12, y: 0.01, z: 12 },
      max: { x: 18, y: 5, z: 18 },
    })
  ).toBe(true);
  expect(query.mock.calls.length).toBeLessThan(40);
});

test('a movement-range search resolves each grid support query only once at a given elevation', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 150,
    depthFeet: 150,
    getTerrainHeightFeet: () => 0,
  });
  const query = jest.spyOn(geometry, 'findSupport');
  const clearance = jest.spyOn(geometry, 'isSpaceClear');
  const range = buildSurfaceRange({
    geometry,
    start: { gridX: 15, gridY: 15, heightFeet: 0 },
    speedFeet: 30,
  });
  expect(range.tiles.size).toBe(169);
  const counts = new Map();
  for (const [x, z, options] of query.mock.calls) {
    const key = `${x}:${z}:${options.belowFeet}:${options.clearanceFeet}`;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  expect(Math.max(...counts.values())).toBe(1);
  expect(clearance.mock.calls.length).toBe(range.tiles.size - 1);
});

test('nearby geometry indexes update after placement, movement, undo, terrain edits and reopening', () => {
  const engine = new TerrainEngine(10, 10);
  engine.placeStructure({
    id: 'distant-dome',
    kind: 'dome',
    xFeet: 37.5,
    zFeet: 37.5,
    diameterFeet: 15,
  });
  const bounds = { min: { x: 12, y: 0.1, z: 12 }, max: { x: 18, y: 5, z: 18 } };
  expect(engine.geometry.isSpaceClear(bounds)).toBe(true);
  engine.placeStructure({
    id: 'wall',
    kind: 'wall',
    xFeet: 15,
    zFeet: 15,
    lengthFeet: 10,
    widthFeet: 2,
  });

  expect(engine.geometry.isSpaceClear(bounds)).toBe(false);
  engine.resizeStructure('wall', { xFeet: 35 });
  expect(engine.geometry.isSpaceClear(bounds)).toBe(true);
  engine.undo();
  expect(engine.geometry.isSpaceClear(bounds)).toBe(false);
  engine.removeStructure('wall');
  expect(engine.geometry.isSpaceClear(bounds)).toBe(true);
  engine.setHeightAt(2, 2, 3);
  expect(engine.geometry.isSpaceClear(bounds)).toBe(false);
  const restored = new TerrainEngine(1, 1);
  restored.load(engine.save());
  expect(restored.geometry.isSpaceClear(bounds)).toBe(false);
});

test('footprint queries retain every exact intersection across fractional edges and negative campaign coordinates', () => {
  const entries = Array.from({ length: 80 }, (_, id) => ({
    id,
    bounds: {
      min: { x: (id % 10) * 3.125 - 15.5, y: 0, z: Math.floor(id / 10) * 4.375 - 20.25 },
      max: { x: (id % 10) * 3.125 - 9.75, y: 10, z: Math.floor(id / 10) * 4.375 - 13.125 },
    },
  }));
  const index = new FootprintIndex(entries);
  for (let i = 0; i < 60; i++) {
    const bounds = {
      min: { x: -25 + i * 0.625, y: 0.01, z: -23 + (i % 17) * 2.5 },
      max: { x: -20 + i * 0.625, y: 5, z: -18 + (i % 17) * 2.5 },
    };
    const ids = (values) =>
      values
        .filter((value) => convex.boundsOverlap(bounds, value.bounds))
        .map((value) => value.id)
        .sort((a, b) => a - b);
    expect(ids(index.inBounds(bounds))).toEqual(ids(entries));
  }
  expect(new FootprintIndex([]).inBounds({ min: { x: -1, z: -1 }, max: { x: 1, z: 1 } })).toEqual(
    []
  );
});

test('distant stair anchors do not trigger support queries outside the reachable movement horizon', () => {
  const geometry = new TerrainGeometry({
    widthFeet: 250,
    depthFeet: 250,
    getTerrainHeightFeet: () => 0,
  });
  geometry.getNavigationPoints = () => [
    { x: 200, y: 0, z: 200 },
    { x: 205, y: 1, z: 200 },
  ];
  const query = jest.spyOn(geometry, 'findSupport');
  const range = buildSurfaceRange({
    geometry,
    start: { gridX: 5, gridY: 5, heightFeet: 0 },
    speedFeet: 30,
  });
  expect(range.tiles.size).toBeGreaterThan(100);
  expect(query.mock.calls.some(([x, z]) => x >= 200 && z >= 200)).toBe(false);
});

test('a selected sprite on a fifty-square connected castle needs fewer than 400 cross-map support queries', () => {
  localStorage.clear();
  const engine = castle();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 50, rows: 50, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures = [];
  const world = CampaignWorld.fromScene(
    reconcileBuildingScene(scene, { ruleset: '2014', library }),
    { ruleset: '2014', library }
  );
  const token = {
    id: 'token-1',
    type: 'mannequin',
    mapId: 'map-main',
    gridX: 25,
    gridY: 30,
    world: { x: 25, y: 0, z: 30 },
  };
  const gm = {
    terrainEngine: engine,
    campaignWorld: world,
    campaignMapId: 'map-main',
    placedTokens: [token],
    cols: 50,
    rows: 50,
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.5,
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
  const adapter = new Token3DAdapter(gm);
  const query = jest.spyOn(world, 'findSupportBelow');
  const clearance = jest.spyOn(convex, 'boundsIntersectSolid');
  const range = adapter.getTokenMovementRange(token);
  expect(range.tiles.size).toBeGreaterThan(100);
  expect(query.mock.calls.length).toBeLessThan(400);
  expect(clearance.mock.calls.length).toBeLessThan(30000);
});
