import CampaignWorld from '../../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { sceneState } from '../../../helpers/sceneState.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  installHumanoidAssetFiles,
} from '../../../helpers/humanoid-fixture.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

test('a real creature can finish moves into both cells used only by another map local coordinates', async () => {
  const fixture = await createHumanoidFixture({
    height: 0,
    warmupFrames: 0,
    animationKeys: ['idle', 'walk'],
  });
  const { gm, adapter, token } = fixture;
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const validation = { ruleset: '2014', library };
  const scene = sceneState();
  scene.grid = { cols: 12, rows: 8, tileWorldSize: 1 };
  scene.terrain.heights = Array.from({ length: 8 }, () => Array(12).fill(0));
  Object.assign(scene.creatures[0], {
    id: token.id,
    gridX: token.gridX,
    gridY: token.gridY,
    pose: { kind: 'ground', world: { ...token.world } },
  });
  let world = CampaignWorld.fromScene(scene, validation);
  world.addMap({
    id: 'inside',
    name: 'Interior',
    originFeet: { x: 55, y: 0, z: 20 },
    quarterTurns: 0,
    base: 'floor',
    grid: { cols: 8, rows: 10, tileWorldSize: 1 },
    terrain: { ...scene.terrain, heights: Array.from({ length: 10 }, () => Array(8).fill(0)) },
  });
  const saved = world.save();
  for (const [number, gridY] of [
    [2, 2],
    [3, 7],
  ]) {
    saved.creatures.push({
      ...saved.creatures[0],
      id: `token-${number}`,
      instanceNumber: number,
      mapId: 'inside',
      gridX: 1,
      gridY,
      pose: { kind: 'ground', world: { x: 1.5, y: 0, z: gridY + 0.5 } },
    });
  }
  saved.tokenCounters.nextId = 3;
  saved.tokenCounters.types[0][1] = 3;
  world = CampaignWorld.fromScene(saved, validation);
  token.mapId = 'map-main';
  token.movementSettings.speed = 30;
  gm.placedTokens = [
    token,
    ...saved.creatures.slice(1).map((creature) => ({
      ...creature,
      world: { ...creature.pose.world },
    })),
  ];
  gm.campaignWorld = world;
  gm.campaignMapId = 'map-main';
  gm.characterServices = { library };
  gm.terrainEngine = new TerrainEngine(12, 8);
  gm.terrainEngine.addVolume({
    id: 'distant-step',
    bounds: { min: { x: 50, y: 0, z: 30 }, max: { x: 55, y: 1.5, z: 35 } },
  });
  try {
    expect(adapter.requestMoveToGrid(token, 1, 2)?.cost).toBe(20);
    finishHumanoid(fixture);
    expect(token.world).toEqual({ x: 1.5, y: 0, z: 2.5 });
    expect(adapter.requestMoveToGrid(token, 1, 7)?.cost).toBe(25);
    finishHumanoid(fixture);
    expect(token.world).toEqual({ x: 1.5, y: 0, z: 7.5 });
    expect(adapter.getStablePlacement(token)).toMatchObject({ gridX: 1, gridY: 7 });
    expect(gm.placedTokens).toHaveLength(3);
    expect(gm.placedTokens[2].mapId).toBe('inside');
  } finally {
    adapter.onTokenRemoved(token);
    adapter.disposeMovementRange();
  }
}, 30000);
