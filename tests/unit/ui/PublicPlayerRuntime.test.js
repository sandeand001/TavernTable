import PublicPlayerRuntime from '../../../src/ui/sessions/PublicPlayerRuntime.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { sceneState } from '../../helpers/sceneState.js';
import * as three from 'three';
import { TerrainRebuilder } from '../../../src/scene/terrain/TerrainRebuilder.js';
import { TerrainMeshBuilder } from '../../../src/scene/terrain/TerrainMeshBuilder.js';
import { PlaceableMeshPool } from '../../../src/scene/terrain/PlaceableMeshPool.js';
import { getBiomeColorWithHydrology } from '../../../src/config/biome/BiomePalettes.js';
import PlayerInputController from '../../../src/ui/sessions/PlayerInputController.js';
import PlayerCommandAdapter from '../../../src/ui/sessions/PlayerCommandAdapter.js';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import { PickingService } from '../../../src/scene/picking/PickingService.js';
import {
  cavernRockColor,
  getCavernSurfaceColor,
} from '../../../src/terrain/generation/CavernInteriors.js';

test('a player runtime rejects the old marker-only snapshot instead of pretending it is a playable scene', async () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const gameManager = createCampaignBoard(library);
  const runtime = new PublicPlayerRuntime({ gameManager });
  await expect(
    runtime.update({ view: { id: 'map-main', terrain: null, tokens: [] } })
  ).rejects.toThrow('interactive player snapshot');
  expect(gameManager.placedTokens).toEqual([]);
});

function fixture() {
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const ownedId = library.create('Scout');
  const gameManager = createCampaignBoard(library);
  const runtime = new PublicPlayerRuntime({ gameManager });
  const terrain = sceneState().terrain;
  terrain.biome = 'grassland';
  terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
  terrain.heights[2][2] = 1;
  const map = {
    id: 'main',
    name: 'Wilderness',
    locationId: 'site',
    originFeet: { x: 0, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'ground',
    grid: { cols: 5, rows: 5, tileWorldSize: 1 },
    terrain,
  };
  const actors = [
    {
      id: 'canonical-scout',
      name: 'Scout',
      type: 'female-archer',
      mapId: 'main',
      gridX: 1,
      gridY: 1,
      owned: true,
      characterId: ownedId,
      portraitImage: null,
      pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
      facingAngle: 0,
      movement: { mode: 'walk', type: 'default' },
      flags: { prone: false, flightActive: false },
    },
    {
      id: 'visible-foreign',
      name: 'Guard',
      type: 'knight',
      mapId: 'main',
      gridX: 3,
      gridY: 1,
      owned: false,
      characterId: null,
      portraitImage: null,
      pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
      facingAngle: 0.4,
      movement: { mode: 'walk', type: 'default' },
      flags: { prone: false, flightActive: false },
    },
  ];
  const state = {
    campaign: { id: 'campaign', ruleset: '2014' },
    scene: null,
    observerTokenId: 'canonical-scout',
    publicScene: {
      version: 1,
      assetKey: 'public-assets-1',
      assets: { location: { id: 'site', name: 'Wilderness' }, maps: [map], connections: [] },
      presentation: { mapId: 'main', focusTokenId: 'canonical-scout' },
      actors,
      updates: [],
    },
    gameplay: {
      version: 1,
      commands: ['move'],
      ownedTokens: [
        {
          tokenId: 'canonical-scout',
          mapId: 'main',
          availability: { move: { allowed: true, code: 'allowed' } },
          movement: { spentFeet: 0, remainingFeet: 30, allowanceFeet: 30 },
          economy: {},
          availableActions: [],
          canUndo: false,
        },
      ],
      turn: null,
    },
    sceneRevision: 2,
    revision: 1,
  };
  return { library, ownedId, gameManager, runtime, state };
}

test('public hydration uses the real terrain engine and canonical visible models without creating foreign character records', async () => {
  const { library, ownedId, gameManager, runtime, state } = fixture();
  await runtime.update(state);
  expect(gameManager.terrainEngine.biomeKey).toBe('grassland');
  expect(gameManager.getTerrainHeight(2, 2)).toBe(1);
  expect(gameManager.placedTokens.map(({ id }) => id)).toEqual([
    'canonical-scout',
    'visible-foreign',
  ]);
  expect(gameManager.placedTokens.map(({ type }) => type)).toEqual(['female-archer', 'knight']);
  expect(gameManager.placedTokens.every((actor) => actor.__threeMesh)).toBe(true);
  expect(gameManager.placedTokens[0].characterSheetId).toBe(ownedId);
  expect(gameManager.placedTokens[1].characterSheetId).toBeUndefined();
  expect(gameManager.placedTokens[1].movementSettings).not.toHaveProperty('speed');
  expect(library.list().map(({ id }) => id)).toEqual([ownedId]);
  expect(gameManager.token3DAdapter.getSelectedToken()?.id).toBe('canonical-scout');
  expect(gameManager.sceneAutosave).toBeUndefined();
  await runtime.destroy();
});

test('native player projections retain the authorized map and sight fences and clear them with the viewpoint', async () => {
  const { gameManager, runtime, state } = fixture();
  const door = { min: { x: 10, y: 0, z: 10 }, max: { x: 11, y: 7, z: 15 } };
  state.publicScene.assets.doorPanels = [{ id: 'door', mapIds: ['main'], cells: [door] }];
  await runtime.update(state);
  expect(gameManager.playerVisibleMapIds).toEqual(new Set(['main']));
  expect(gameManager.playerSightObstacles).toContainEqual(door);
  expect(gameManager.threeSceneManager.scene.getObjectByName('MapDoors:door')).toBeTruthy();
  await runtime.clear();
  expect(gameManager.playerVisibleMapIds.size).toBe(0);
  expect(gameManager.playerSightObstacles).toEqual([]);
  await runtime.destroy();
  expect(gameManager).not.toHaveProperty('playerVisibleMapIds');
  expect(gameManager).not.toHaveProperty('playerSightObstacles');
});

test('native cavern terrain uses the shared rock palette without receiving the private generation recipe', async () => {
  const { gameManager, runtime, state } = fixture();
  const terrain = state.publicScene.assets.maps[0].terrain;
  terrain.biome = 'cavern';
  terrain.renderStyle = 'cavern';
  const rebuilder = new TerrainRebuilder({
    gameManager,
    builder: new TerrainMeshBuilder({ tileWorldSize: 1, elevationUnit: 0.3 }),
  });
  gameManager.notifyTerrainHeightsChanged = () => rebuilder.rebuild({ three });
  await runtime.update(state);
  const mesh = gameManager.threeSceneManager.scene.getObjectByName('TerrainMesh');
  const expected = getCavernSurfaceColor(0, 0, 0, { materialColor: cavernRockColor('cavern') });
  expect(new three.Color().fromBufferAttribute(mesh.geometry.attributes.color, 0).getHex()).toBe(
    new three.Color(expected).getHex()
  );
  expect(terrain.cavern).toBeUndefined();
  await runtime.destroy();
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('routine public updates retain loaded actors, the player camera and selected target while removing revoked sightings', async () => {
  const { gameManager, runtime, state } = fixture();
  await runtime.update(state);
  const scout = gameManager.placedTokens[0];
  const guard = gameManager.placedTokens[1];
  const mesh = guard.__threeMesh;
  await gameManager.token3DAdapter.setSelectedToken(guard);
  const camera = { ...gameManager.threeSceneManager.snapshotView(), zoom: 1.8 };
  gameManager.threeSceneManager.restoreView(camera);
  state.publicScene.assets = null;
  state.sceneRevision++;
  state.publicScene.actors[0].pose.world.x = 2.5;
  state.publicScene.actors[0].gridX = 2;
  await runtime.update(state);
  expect(gameManager.placedTokens[0]).toBe(scout);
  expect(gameManager.placedTokens[1]).toBe(guard);
  expect(guard.__threeMesh).toBe(mesh);
  expect(gameManager.token3DAdapter.getSelectedToken()?.id).toBe(guard.id);
  expect(gameManager.threeSceneManager.snapshotView()).toEqual(camera);
  state.sceneRevision++;
  state.publicScene.actors = state.publicScene.actors.slice(0, 1);
  await runtime.update(state);
  expect(gameManager.placedTokens).toEqual([scout]);
  expect(gameManager.token3DAdapter.getTokenVisual(guard)).toBeNull();
  await runtime.destroy();
});

test('a host appearance change replaces the old visual without changing actor identity or player selection', async () => {
  const { gameManager, runtime, state } = fixture();
  await runtime.update(state);
  const token = gameManager.placedTokens[0];
  const oldVisual = token.__threeMesh;
  state.publicScene.assets = null;
  state.publicScene.actors[0].type = 'knight';
  state.sceneRevision++;
  await runtime.update(state);
  expect(gameManager.placedTokens[0]).toBe(token);
  expect(token.creature.type).toBe('knight');
  expect(token.__threeMesh).not.toBe(oldVisual);
  expect(oldVisual.parent).toBeNull();
  expect(gameManager.token3DAdapter.getSelectedToken()).toBe(token);
  await runtime.destroy();
});

test('a versioned no-observer snapshot clears the old map and actors without creating a world token for assigned sheets', async () => {
  const { gameManager, runtime, library, state } = fixture();
  const records = library.list();
  await runtime.update(state);
  state.sceneRevision++;
  state.observerTokenId = null;
  state.publicScene = {
    version: 1,
    assetKey: null,
    assets: null,
    presentation: { mapId: null, focusTokenId: null },
    actors: [],
    updates: [],
  };
  state.gameplay = { version: 1, commands: [], ownedTokens: [], turn: null };
  expect(await runtime.update(state)).toEqual({ applied: true });
  expect(gameManager.placedTokens).toEqual([]);
  expect(gameManager.threeSceneManager.scene.visible).toBe(false);
  expect(gameManager.campaignWorld).toBeNull();
  expect(library.list()).toEqual(records);
  await runtime.destroy();
});

test('a newer snapshot supersedes unfinished hydration without restoring its revoked actors or old pose', async () => {
  const { gameManager, runtime, state } = fixture();
  const newer = JSON.parse(JSON.stringify(state));
  newer.sceneRevision++;
  newer.publicScene.actors = [newer.publicScene.actors[0]];
  newer.publicScene.actors[0].gridX = 2;
  newer.publicScene.actors[0].pose.world.x = 2.5;
  const first = runtime.update(state);
  const latest = runtime.update(newer);
  expect(await first).toEqual({ applied: false, reason: 'superseded-snapshot' });
  expect(await latest).toEqual({ applied: true });
  expect(gameManager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
  expect(gameManager.placedTokens[0].world.x).toBe(2.5);
  expect(
    gameManager.threeSceneManager.scene.getObjectByName('Token3D:visible-foreign')
  ).toBeUndefined();
  await runtime.destroy();
});

test('player terrain colors and saved flora use the same production pipelines as the DM, without regenerating assets on actor updates', async () => {
  const { gameManager, runtime, state } = fixture();
  const model = new three.Mesh(
    new three.BoxGeometry(0.5, 5, 0.5),
    new three.MeshStandardMaterial({ color: 0x755130 })
  );
  model.geometry.translate(0, 2.5, 0);
  gameManager.modelAssetCache = { getModel: async () => model };
  const pool = new PlaceableMeshPool({ gameManager });
  gameManager.placeableMeshPool = pool;
  gameManager.ensureInstancing = () => pool;
  const rebuilder = new TerrainRebuilder({
    gameManager,
    builder: new TerrainMeshBuilder({ tileWorldSize: 1, elevationUnit: 0.3 }),
  });
  gameManager.notifyTerrainHeightsChanged = () => rebuilder.rebuild({ three });
  state.publicScene.assets.maps[0].terrain.placeables = [
    {
      type: 'plant',
      placeableId: 'tree-oak',
      modelKey: 'common-broadleaf-1',
      gridX: 4,
      gridY: 4,
      heightOffset: 0,
      renderProfile: 'model',
      persistedScale: { x: 1, y: 1, z: 1 },
    },
  ];
  await runtime.update(state);
  const terrainMesh = gameManager.threeSceneManager.scene.getObjectByName('TerrainMesh');
  expect(terrainMesh).toBeTruthy();
  const colors = terrainMesh.geometry.attributes.color;
  const expected = new three.Color(getBiomeColorWithHydrology('grassland', 0));
  expect(new three.Color().fromBufferAttribute(colors, 0).getHex()).toBe(expected.getHex());
  const flora = gameManager.threeSceneManager.scene.children.find(
    (object) => object.isInstancedMesh && object.name.startsWith('Placeables:')
  );
  expect(flora?.count).toBe(1);
  const matrix = new three.Matrix4();
  flora.getMatrixAt(0, matrix);
  expect(new three.Vector3().setFromMatrixPosition(matrix).toArray()).toEqual([4.5, 0, 4.5]);
  state.publicScene.assets = null;
  state.sceneRevision++;
  await runtime.update(state);
  expect(gameManager.threeSceneManager.scene.getObjectByName('TerrainMesh')).toBe(terrainMesh);
  expect(gameManager.threeSceneManager.scene.getObjectByName(flora.name)).toBe(flora);
  await runtime.destroy();
  pool.dispose();
  model.geometry.dispose();
  model.material.dispose();
  terrainMesh.geometry.dispose();
  terrainMesh.material.dispose();
});

test('a real map click sends a host movement intent without moving the sprite until the host accepts it', async () => {
  const { gameManager, runtime, state } = fixture();
  await runtime.update(state);
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 600;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  gameManager.getEventCanvas = () => canvas;
  gameManager.threeSceneManager.canvas = canvas;
  const camera = new three.OrthographicCamera(-2.5, 2.5, 2.5, -2.5, 0.1, 100);
  camera.up.set(0, 0, -1);
  camera.position.set(2.5, 10, 2.5);
  camera.lookAt(2.5, 0, 2.5);
  camera.updateMatrixWorld(true);
  gameManager.threeSceneManager.camera = camera;
  gameManager.pickingService = new PickingService({ gameManager });
  const manager = new InteractionManager(gameManager);
  gameManager.interactionManager = manager;
  const sent = [];
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const accepted = JSON.parse(JSON.stringify(state));
  accepted.sceneRevision++;
  accepted.publicScene.assets = null;
  accepted.publicScene.actors[0].gridX = 2;
  accepted.publicScene.actors[0].pose.world.x = 2.5;
  const commandId = '00000000-0000-4000-8000-000000000011';
  const commands = new PlayerCommandAdapter({
    connection: {
      call: async (...args) => {
        sent.push(args);
        return gate;
      },
    },
    getState: () => state,
    createCommandId: () => commandId,
    onReceipt: ({ state: acknowledged }) => runtime.update(acknowledged),
  });
  const input = new PlayerInputController({ gameManager, commands });
  const before = { ...gameManager.placedTokens[0].world };
  const point = new three.Vector3(2.5, 0, 1.5).project(camera);
  manager.handleLeftClick({
    button: 0,
    clientX: (point.x + 1) * 400,
    clientY: (1 - point.y) * 300,
  });
  for (let tick = 0; tick < 20; tick++) await Promise.resolve();
  expect(sent).toHaveLength(1);
  expect(sent[0][1][1].payload).toEqual({
    target: { mapId: 'main', gridX: 2, gridY: 1 },
  });
  expect(gameManager.placedTokens[0].world).toEqual(before);
  release({
    version: 1,
    commandId,
    outcome: 'applied',
    applied: { sceneRevision: accepted.sceneRevision, charactersRevision: accepted.revision },
    receipt: {
      kind: 'move',
      tokenId: 'canonical-scout',
      costFeet: 5,
      budget: {
        movementSpentFeet: 5,
        movementRemainingFeet: 25,
        movementAllowanceFeet: 30,
      },
      route: [
        {
          mapId: 'main',
          gridX: 2,
          gridY: 1,
          facingAngle: 0,
          pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
        },
      ],
    },
    state: accepted,
  });
  for (let tick = 0; tick < 40; tick++) await Promise.resolve();
  expect(gameManager.placedTokens[0].world).toEqual({ x: 2.5, y: 0, z: 1.5 });
  input.destroy();
  await runtime.destroy();
});

test('visible foreign-floor models use their physical map transform and the host visibility set, not camera-derived disclosure', async () => {
  const { gameManager, runtime, state } = fixture();
  gameManager.characterServices.sessionRole = 'player';
  const main = state.publicScene.assets.maps[0];
  state.publicScene.assets.maps.push({
    ...main,
    id: 'upper',
    name: 'Upper floor',
    originFeet: { x: 25, y: 10, z: 0 },
    base: 'floor',
    terrain: {
      ...main.terrain,
      heights: Array.from({ length: 5 }, () => Array(5).fill(0)),
      geometry: { version: 1, volumes: [] },
    },
  });
  const guard = state.publicScene.actors[1];
  guard.mapId = 'upper';
  guard.gridX = 0;
  guard.pose.world.x = 0.5;
  await runtime.update(state);
  const token = gameManager.placedTokens.find(({ id }) => id === guard.id);
  expect(gameManager.token3DAdapter.getTokenVisual(token)?.visible).toBe(true);
  expect(gameManager.token3DAdapter.getTokenViewPosition(token)).toEqual({
    x: 5.5,
    y: 2,
    z: 1.5,
  });
  expect(gameManager.campaignWorld.findLocalSupport('upper', token.world).heightWorld).toBe(0);
  state.publicScene.assets = null;
  state.sceneRevision++;
  state.publicScene.actors = state.publicScene.actors.slice(0, 1);
  await runtime.update(state);
  expect(gameManager.token3DAdapter.getTokenVisual(token)).toBeNull();
  await runtime.destroy();
});

test('an older public response cannot rewind an acknowledged pose or reveal its revoked actor list', async () => {
  const { gameManager, runtime, state } = fixture();
  const old = JSON.parse(JSON.stringify(state));
  await runtime.update(state);
  state.publicScene.assets = null;
  state.sceneRevision += 2;
  state.publicScene.actors = state.publicScene.actors.slice(0, 1);
  state.publicScene.actors[0].pose.world.x = 2.5;
  state.publicScene.actors[0].gridX = 2;
  await runtime.update(state);
  const result = await runtime.update(old);
  expect(result).toEqual({ applied: false, reason: 'stale-snapshot' });
  expect(gameManager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
  expect(gameManager.placedTokens[0].world.x).toBe(2.5);
  await runtime.destroy();
});
