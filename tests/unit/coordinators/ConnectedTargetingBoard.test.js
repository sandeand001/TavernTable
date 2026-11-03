import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { targetingBoard, targetingPositions } from '../../../src/coordinators/TargetingBoard.js';
import { Token3DAdapter } from '../../../src/scene/Token3DAdapter.js';
import { boardDistance } from '../../../src/rules/targeting/geometry.js';
import { sceneState } from '../../helpers/sceneState.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';

function connectedBoard() {
  localStorage.clear();
  const library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: classic.entries,
    classes: classic.classes,
  });
  const validation = { ruleset: '2014', library };
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  let world = CampaignWorld.fromScene(scene, validation);
  world.addMap({
    id: 'upper',
    name: 'Upper floor',
    originFeet: { x: 0, y: 10, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: { ...scene.grid, tileWorldSize: 2 },
    terrain: { ...scene.terrain },
  });
  const saved = world.save();
  saved.creatures.push({
    ...saved.creatures[0],
    id: 'token-2',
    instanceNumber: 2,
    name: 'Upstairs',
    mapId: 'upper',
    pose: { kind: 'ground', world: { x: 3, y: 0, z: 3 } },
  });
  saved.tokenCounters.nextId = 2;
  saved.tokenCounters.types[0][1] = 2;
  world = CampaignWorld.fromScene(saved, validation);
  return {
    campaignWorld: world,
    campaignMapId: 'map-main',
    characterServices: { library },
    placedTokens: saved.creatures.map((creature) => ({
      ...creature,
      world: { ...creature.pose.world },
      characterSheetId: creature.characterId,
    })),
    cols: scene.grid.cols,
    rows: scene.grid.rows,
    getTerrainHeight: (x, y) => scene.terrain.heights[y][x],
    spatial: {
      tileWorldSize: 1,
      elevationUnit: scene.terrain.worldElevationUnit,
      gridToWorld: (x, z, height = 0) => ({
        x,
        y: height * scene.terrain.worldElevationUnit,
        z,
      }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
}

test('targeting distinguishes floors in physical feet without making an upper floor solid earth', () => {
  const gm = connectedBoard();
  const board = targetingBoard(gm);
  const [outside, upstairs] = board.tokens;
  expect(board.tileSize).toBe(5);
  expect(boardDistance(outside.world, upstairs.world, board.tileSize)).toBe(10);
  expect(board.clearPath(outside, upstairs)).toBe(false);
  expect(board.clearPoint(outside, { x: 17.5, y: 0, z: 7.5 })).toBe(true);
  expect(board.tokens.map((token) => token.id)).toEqual(['token-1', 'token-2']);
  expect(gm.placedTokens).toHaveLength(2);
});

test('read-only flight indicators find saved physical support without a live terrain editor', () => {
  const gm = connectedBoard();
  gm.placedTokens[0].world = { x: 3, y: 4, z: 1.5 };
  gm.token3DAdapter = new Token3DAdapter(gm);
  const positions = targetingPositions(gm, [gm.placedTokens[0].id]);
  expect(positions.tokens[0].groundWorld).toEqual({ x: 15, y: 10, z: 7.5 });
});

test('flight-ring anchors use each recipient map and preserve campaign scale, rotation and altitude', () => {
  const gm = connectedBoard();
  const saved = gm.campaignWorld.save();
  const upper = saved.maps.find((map) => map.id === 'upper');
  upper.originFeet = { x: 30, y: 10, z: 5 };
  upper.quarterTurns = 1;
  gm.campaignWorld = CampaignWorld.fromScene(saved, {
    ruleset: '2014',
    library: gm.characterServices.library,
  });
  gm.terrainEngine = new TerrainEngine(gm.cols, gm.rows);
  gm.terrainEngine.configureGeometryScale(gm.spatial.elevationUnit * 5);
  for (let row = 0; row < gm.rows; row++)
    for (let col = 0; col < gm.cols; col++) gm.terrainEngine.setHeightAt(col, row, 1);
  gm.getTerrainHeight = () => 1;
  gm.placedTokens[0].world.x = 0.5;
  gm.placedTokens[0].world.y = 4;
  gm.placedTokens[1].world.y = 3;
  gm.token3DAdapter = new Token3DAdapter(gm);
  const positions = targetingPositions(
    gm,
    gm.placedTokens.map((token) => token.id)
  );
  expect(positions.tokens[0].groundWorld.y).toBeCloseTo(gm.spatial.elevationUnit * 5);
  expect(positions.tokens[1]).toMatchObject({
    world: { x: 22.5, y: 17.5, z: 12.5 },
    groundWorld: { x: 22.5, y: 10, z: 12.5 },
  });
  expect(gm.placedTokens[1].world.y).toBe(3);
  gm.placedTokens[0].world.x = 3;
  const overFloor = targetingPositions(gm, [gm.placedTokens[0].id]);
  expect(overFloor.tokens[0].groundWorld.y).toBe(10);
});

test('cross-grid projections require a clear opening and visibility works in both directions', () => {
  const gm = connectedBoard();
  const validation = { ruleset: '2014', library: gm.characterServices.library };
  const saved = gm.campaignWorld.save();
  const inside = saved.maps.find((map) => map.id === 'upper');
  inside.originFeet = { x: 10, y: 0, z: 0 };
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'wall',
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 10, z: 25 } },
  });
  inside.terrain.geometry = geometry.save();
  gm.campaignWorld = CampaignWorld.fromScene(saved, validation);
  expect(gm.campaignWorld.visibleProjections('token-1', 'map-main')).toEqual([]);
  geometry.carve({
    id: 'window',
    bounds: { min: { x: 0, y: 2, z: 5 }, max: { x: 1, y: 6, z: 10 } },
  });
  inside.terrain.geometry = geometry.save();
  gm.campaignWorld = CampaignWorld.fromScene(saved, validation);
  const board = targetingBoard(gm);
  expect(board.clearPath(board.tokens[0], board.tokens[1])).toBe(true);
  expect(board.clearPath(board.tokens[1], board.tokens[0])).toBe(true);
  expect(gm.campaignWorld.visibleProjections('token-1', 'map-main')).toMatchObject([
    { id: 'token-2', projection: true, world: { x: 3.5, y: 0, z: 1.5 } },
  ]);
  expect(gm.campaignWorld.visibleProjections('token-2', 'upper')).toMatchObject([
    { id: 'token-1', projection: true, world: { x: -1, y: 0, z: 3 } },
  ]);
});

test('targeting reads unsaved edits from the active terrain owner, not its last checkpoint', () => {
  const gm = connectedBoard();
  gm.terrainEngine = new TerrainEngine(5, 5);
  gm.terrainEngine.configureGeometryScale(1.5);
  gm.getTerrainHeight = (x, y) => gm.terrainEngine.getHeightAt(x, y);
  let board = targetingBoard(gm);
  expect(board.clearPoint(board.tokens[0], { x: 17.5, y: 0, z: 7.5 })).toBe(true);
  gm.terrainEngine.setHeightAt(2, 1, 4);
  board = targetingBoard(gm);
  expect(board.clearPoint(board.tokens[0], { x: 17.5, y: 0, z: 7.5 })).toBe(false);
  expect(gm.campaignWorld.getMap('map-main').terrain.heights[1][2]).toBe(0);
});

test('unrendered maps retain saved structure cover in physical targeting queries', () => {
  const gm = connectedBoard();
  const validation = { ruleset: '2014', library: gm.characterServices.library };
  const saved = gm.campaignWorld.save();
  const inside = saved.maps.find((map) => map.id === 'upper');
  inside.originFeet = { x: 10, y: 0, z: 0 };
  inside.terrain.coverBounds = [{ min: { x: 0, y: 0, z: 0 }, max: { x: 0.4, y: 4, z: 10 } }];
  gm.campaignWorld = CampaignWorld.fromScene(saved, validation);
  const board = targetingBoard(gm);
  expect(board.clearPath(board.tokens[0], board.tokens[1])).toBe(false);
  expect(gm.placeableMeshPool).toBeUndefined();
});
