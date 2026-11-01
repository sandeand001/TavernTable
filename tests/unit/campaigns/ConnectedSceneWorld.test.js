import * as three from 'three';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { captureCampaignScene, restoreCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { TokenManager } from '../../../src/managers/TokenManager.js';
import { Token3DAdapter } from '../../../src/scene/Token3DAdapter.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';

function liveBoard(library) {
  let camera = sceneState().camera;
  const gm = {
    cols: 5,
    rows: 5,
    __threeTestDouble: three,
    terrainEngine: new TerrainEngine(5, 5),
    is3DModeActive: () => true,
    threeSceneManager: {
      scene: new three.Scene(),
      three,
      snapshotView: () => camera,
      restoreView: (view) => {
        camera = JSON.parse(JSON.stringify(view));
      },
    },
    stateCoordinator: { setViewMode: () => {} },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.3,
      gridToWorld(x, z, level = 0) {
        return {
          x: x * this.tileWorldSize,
          y: level * this.elevationUnit,
          z: z * this.tileWorldSize,
        };
      },
      worldToGrid(x, z) {
        return {
          gridX: Math.floor(x / this.tileWorldSize),
          gridY: Math.floor(z / this.tileWorldSize),
        };
      },
    },
    ensureInstancing: () => null,
  };
  gm.getTerrainHeight = (x, y) => gm.terrainEngine.getHeightAt(x, y);
  gm.resizeGrid = (cols, rows) => {
    gm.cols = cols;
    gm.rows = rows;
    gm.terrainEngine.resize(cols, rows);
  };
  gm.tokenManager = new TokenManager(gm);
  Object.defineProperty(gm, 'placedTokens', { get: () => gm.tokenManager.placedTokens });
  gm.token3DAdapter = new Token3DAdapter(gm);
  gm.notifyTerrainHeightsChanged = () => gm.token3DAdapter.resyncHeights();
  gm.characterServices = { library, combat: new CombatSession({ library }) };
  return gm;
}

test('live campaign restore and capture retain inactive grids, exact local poses and turn costs', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: classic.entries,
    classes: classic.classes,
  });
  const characterId = library.create('Alice');
  const combat = new CombatSession({ library });
  const actor = { id: 'token-1', characterSheetId: characterId };
  combat.startTurn(actor);
  combat.adjustMovement(actor, 20);
  const legacy = sceneState({ characterId, name: 'Alice' });
  legacy.terrain.heights = legacy.terrain.heights.map((row) => row.map(() => 0));
  legacy.combat = combat.snapshot();
  const world = CampaignWorld.fromScene(legacy, { ruleset: '2014', library });
  world.addMap({
    id: 'inside',
    name: 'Building interior',
    originFeet: { x: 0, y: 10, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: { cols: 9, rows: 6, tileWorldSize: 2 },
    terrain: {
      ...legacy.terrain,
      heights: Array.from({ length: 6 }, () => Array(9).fill(0)),
    },
  });
  const saved = world.save();
  saved.view.focusTokenId = actor.id;
  saved.creatures.push({
    ...saved.creatures[0],
    id: 'token-2',
    instanceNumber: 2,
    name: 'Inside',
    nameMode: 'custom',
    characterId: null,
    mapId: 'inside',
    gridX: 7,
    gridY: 1,
    movement: { speed: 30, mode: 'walk', type: 'default' },
    pose: { kind: 'ground', world: { x: 15, y: 0, z: 3 } },
  });
  saved.tokenCounters.nextId = 2;
  saved.tokenCounters.types[0][1] = 2;
  const gm = liveBoard(library);
  try {
    await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
    expect(gm.campaignMapId).toBe('map-main');
    expect(gm.placedTokens.map((token) => token.id)).toEqual(['token-1', 'token-2']);
    expect(gm.token3DAdapter.getStablePlacement(gm.placedTokens[1])).toEqual({
      gridX: 7,
      gridY: 1,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 15, y: 0, z: 3 } },
    });
    expect(gm.characterServices.combat.status(gm.placedTokens[0]).movement.remaining).toBe(20);
    const captured = await captureCampaignScene(gm, library);
    expect(captured.version).toBe(3);
    expect(captured.maps).toEqual(saved.maps);
    expect(captured.creatures.map((creature) => creature.mapId)).toEqual(['map-main', 'inside']);
    expect(captured.creatures[1].pose).toEqual(saved.creatures[1].pose);
    expect(captured.combat).toEqual(saved.combat);
    expect(captured.view).toEqual(saved.view);
    expect(gm.token3DAdapter.getTokenMovementRange(gm.placedTokens[1])).toBeNull();
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('acknowledged autosaves refresh connected-map checkpoints after terrain and character changes', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  let gm, autosave;
  try {
    const campaign = await store.create({ name: 'Connected autosave', ruleset: '2014' });
    const library = await CampaignCharacters.open({
      store,
      campaignId: campaign.id,
      catalog: { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] },
    });
    const characterId = await library.create('Alice');
    const legacy = sceneState({ characterId, name: 'Alice' });
    legacy.terrain.heights = legacy.terrain.heights.map((row) => row.map(() => 0));
    const saved = CampaignWorld.fromScene(legacy, { ruleset: '2014', library }).save();
    gm = liveBoard(library);
    autosave = new CampaignAutosave({
      gameManager: gm,
      library,
      combat: gm.characterServices.combat,
    });
    await autosave.start(saved);
    gm.terrainEngine.setHeightAt(2, 2, 3);
    await autosave.flush();
    expect(gm.campaignWorld.getMap('map-main').terrain.heights[2][2]).toBe(3);
    await library.edit(characterId, { name: 'Alice Renamed' });
    expect(gm.campaignWorld.getCreature('token-1').name).toBe('Alice Renamed');
    await autosave.flush();
    expect(autosave.status.state).toBe('saved');
  } finally {
    autosave?.dispose();
    if (gm) {
      for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
      gm.token3DAdapter.disposeMovementRange();
    }
    store.close();
  }
});

test('an active interior keeps finite floor support after restore, resize and terrain reload', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const legacy = sceneState();
  legacy.creatures = [];
  legacy.terrain.heights = legacy.terrain.heights.map((row) => row.map(() => 0));
  const world = CampaignWorld.fromScene(legacy, { ruleset: '2014', library });
  world.addMap({
    id: 'inside',
    name: 'Interior',
    originFeet: { x: 0, y: 10, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: { ...legacy.grid },
    terrain: { ...legacy.terrain },
  });
  const saved = world.save();
  saved.view.mapId = 'inside';
  const gm = liveBoard(library);
  try {
    await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
    expect(gm.terrainEngine.geometry.getSolidSpansAt(7.5, 7.5)).toMatchObject([
      { bottom: -0.5, top: 0 },
    ]);
    gm.resizeGrid(7, 7);
    gm.terrainEngine.load(gm.terrainEngine.save());
    expect(gm.terrainEngine.geometry.findSupport(7.5, 7.5, { belowFeet: -1 })).toBeNull();
    expect(gm.terrainEngine.geometry.getSolidSpansAt(7.5, 7.5)).toMatchObject([
      { bottom: -0.5, top: 0 },
    ]);
  } finally {
    gm.token3DAdapter.disposeMovementRange();
  }
});
