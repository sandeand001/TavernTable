import * as three from 'three';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import {
  captureCampaignScene,
  restoreCampaignScene,
  changeCampaignView,
} from '../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { PlaceableMeshPool } from '../../../src/scene/terrain/PlaceableMeshPool.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import { createCampaignBoard as liveBoard } from '../../helpers/campaignBoard.js';

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
    expect(captured.view).toEqual({
      ...saved.view,
      cameras: [{ mapId: saved.view.mapId, camera: saved.view.camera }],
    });
    const camera = new three.PerspectiveCamera();
    camera.position.set(2.5, 10, 2.5);
    camera.lookAt(2.5, 0, 2.5);
    camera.updateMatrixWorld(true);
    gm.threeSceneManager.camera = camera;
    gm.token3DAdapter.attach();
    gm.advanceFrame();
    expect(gm.token3DAdapter.getTokenVisual(gm.placedTokens[0])?.visible).toBe(true);
    expect(gm.token3DAdapter.getTokenVisual(gm.placedTokens[1])).toBeNull();
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

test('constructed placeable cover is captured before its map can become inactive', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const legacy = sceneState();
  legacy.creatures = [];
  legacy.terrain.heights = legacy.terrain.heights.map((row) => row.map(() => 0));
  const saved = CampaignWorld.fromScene(legacy, { ruleset: '2014', library }).save();
  const gm = liveBoard(library);
  const model = new three.Mesh(new three.BoxGeometry(1, 2, 1), new three.MeshStandardMaterial());
  gm.modelAssetCache = { getModel: async () => model };
  const pool = new PlaceableMeshPool({ gameManager: gm });
  gm.placeableMeshPool = pool;
  gm.ensureInstancing = () => pool;
  try {
    await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
    await pool.addPlaceable({
      type: 'structure',
      modelKey: 'fixture-wall',
      gridX: 2,
      gridY: 1,
    });
    const captured = await captureCampaignScene(gm, library);
    expect(captured.maps[0].terrain.coverBounds).toEqual(pool.targetingCoverBounds());
    expect(captured.maps[0].terrain.coverBounds).toHaveLength(1);
  } finally {
    pool.dispose();
    model.geometry.dispose();
    model.material.dispose();
    gm.token3DAdapter.disposeMovementRange();
  }
});

async function focusFixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const characterId = library.create('Alice');
  const legacy = sceneState({ characterId, name: 'Alice' });
  legacy.terrain.heights = legacy.terrain.heights.map((row) => row.map(() => 0));
  const turn = new CombatSession({ library });
  const actor = { id: 'token-1', characterSheetId: characterId };
  turn.startTurn(actor);
  turn.adjustMovement(actor, 20);
  legacy.combat = turn.snapshot();
  const world = CampaignWorld.fromScene(legacy, { ruleset: '2014', library });
  const heights = legacy.terrain.heights.map((row) => [...row]);
  heights[0][0] = 2;
  world.addMap({
    id: 'inside',
    name: 'Interior',
    originFeet: { x: 10, y: 0, z: 0 },
    quarterTurns: 0,
    base: 'floor',
    grid: { ...legacy.grid },
    terrain: { ...legacy.terrain, heights },
  });
  const saved = world.save();
  saved.view.focusTokenId = 'token-1';
  saved.creatures.push({
    ...saved.creatures[0],
    id: 'token-2',
    instanceNumber: 2,
    name: 'Inside Scout',
    nameMode: 'custom',
    characterId: null,
    mapId: 'inside',
    gridX: 3,
    gridY: 2,
    movement: { mode: 'walk', type: 'default', speed: 30 },
    pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 2.5 } },
  });
  saved.tokenCounters.nextId = 2;
  saved.tokenCounters.types[0][1] = 2;
  const gm = liveBoard(library);
  await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
  return { gm, library, characterId };
}

test('browsing another map preserves live creature identities, positions and combat budgets', async () => {
  const { gm, library, characterId } = await focusFixture();
  const tokens = [...gm.placedTokens];
  const placements = tokens.map((token) => ({ ...token.world }));
  const combat = gm.characterServices.combat;
  const budgets = combat.snapshot();
  const character = library.export(characterId);
  const otherView = gm.campaignWorld.createView({ focusTokenId: tokens[0].id });
  gm.terrainEngine.setHeightAt(4, 4, 3);
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    expect(gm.campaignMapId).toBe('inside');
    expect(gm.terrainEngine.getHeightAt(0, 0)).toBe(2);
    expect(gm.campaignView.focusTokenId).toBeNull();
    expect(gm.campaignWorld.getMap('map-main').terrain.heights[4][4]).toBe(3);
    expect(gm.placedTokens).toEqual(tokens);
    expect(gm.placedTokens[0]).toBe(tokens[0]);
    expect(gm.placedTokens[1]).toBe(tokens[1]);
    expect(gm.placedTokens.map((token) => token.world)).toEqual(placements);
    expect(combat.activeToken).toBe(tokens[0]);
    expect(combat.snapshot()).toEqual(budgets);
    expect(library.export(characterId)).toEqual(character);
    expect(otherView.mapId).toBe('map-main');
    expect(otherView.focusTokenId).toBe(tokens[0].id);
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('focusing an interior creature changes only the viewed map and centers its local position', async () => {
  const { gm } = await focusFixture();
  const inside = gm.placedTokens[1];
  const position = { ...inside.world };
  try {
    await changeCampaignView(gm, { focusTokenId: inside.id });
    expect(gm.campaignMapId).toBe('inside');
    expect(gm.campaignView.focusTokenId).toBe(inside.id);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(inside);
    expect(gm.threeSceneManager.snapshotView().target).toEqual(position);
    expect(inside.world).toEqual(position);
    expect(inside.mapId).toBe('inside');
    expect(gm.characterServices.combat.activeToken.id).toBe('token-1');
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('refocusing on the current map preserves unsaved terrain and its undo history', async () => {
  const { gm } = await focusFixture();
  try {
    gm.terrainEngine.setHeightAt(4, 4, 3);
    expect(gm.terrainEngine.canUndo).toBe(true);
    await changeCampaignView(gm, { focusTokenId: 'token-1' });
    expect(gm.terrainEngine.getHeightAt(4, 4)).toBe(3);
    expect(gm.terrainEngine.canUndo).toBe(true);
    expect(gm.campaignWorld.getMap('map-main').terrain.heights[4][4]).toBe(3);
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('a map change is refused while movement is reserved without changing the map or its budget', async () => {
  const { gm } = await focusFixture();
  const combat = gm.characterServices.combat;
  const actor = gm.placedTokens[0];
  const ticket = combat.beginMovement(actor, 5);
  const budget = combat.snapshot();
  try {
    await expect(changeCampaignView(gm, { mapId: 'inside' })).rejects.toThrow(/finish.*movement/i);
    expect(gm.campaignMapId).toBe('map-main');
    expect(combat.snapshot()).toEqual(budget);
  } finally {
    combat.finishMovement(ticket, 0);
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('a failed interior load restores the previous map, focus and live creature state', async () => {
  const { gm } = await focusFixture();
  const tokens = [...gm.placedTokens];
  const budget = gm.characterServices.combat.snapshot();
  const camera = gm.threeSceneManager.snapshotView();
  gm.ensureInstancing = () => ({
    restorePlacements: async () => {
      if (gm.campaignMapId === 'inside') throw new Error('Interior assets unavailable');
    },
  });
  try {
    await expect(changeCampaignView(gm, { mapId: 'inside' })).rejects.toThrow(
      'Interior assets unavailable'
    );
    expect(gm.campaignMapId).toBe('map-main');
    expect(gm.campaignView.focusTokenId).toBe('token-1');
    expect(gm.terrainEngine.getHeightAt(0, 0)).toBe(0);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(tokens[0]);
    expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
    expect(gm.characterServices.combat.snapshot()).toEqual(budget);
    expect(gm.placedTokens[0]).toBe(tokens[0]);
    expect(gm.placedTokens[1]).toBe(tokens[1]);
    expect(gm.campaignViewBusy).toBe(false);
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('map browsing initializes a local camera and remembers each map view independently', async () => {
  const { gm } = await focusFixture();
  const exterior = {
    ...gm.threeSceneManager.snapshotView(),
    yaw: 1.2,
    zoom: 1.3,
    target: { x: 2, y: 0, z: 2 },
  };
  gm.threeSceneManager.restoreView(exterior);
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    expect(gm.threeSceneManager.snapshotView().target).toEqual({ x: 2.5, y: 0, z: 2.5 });
    const interior = {
      ...gm.threeSceneManager.snapshotView(),
      yaw: 2.2,
      zoom: 1.5,
      target: { x: 3, y: 0, z: 1 },
    };
    gm.threeSceneManager.restoreView(interior);
    await changeCampaignView(gm, { mapId: 'map-main' });
    expect(gm.threeSceneManager.snapshotView()).toEqual(exterior);
    await changeCampaignView(gm, { mapId: 'inside' });
    expect(gm.threeSceneManager.snapshotView()).toEqual(interior);
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('saved connected views retain each map camera after reopening', async () => {
  const { gm, library } = await focusFixture();
  const exterior = { ...gm.threeSceneManager.snapshotView(), yaw: 1.2, zoom: 1.3 };
  gm.threeSceneManager.restoreView(exterior);
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    const interior = { ...gm.threeSceneManager.snapshotView(), yaw: 2.2, zoom: 1.5 };
    gm.threeSceneManager.restoreView(interior);
    const saved = await captureCampaignScene(gm, library);
    const reopened = CampaignWorld.fromScene(saved, { ruleset: '2014', library }).createView();
    reopened.showMap('map-main');
    expect(reopened.camera).toEqual(exterior);
    reopened.showMap('inside');
    expect(reopened.camera).toEqual(interior);
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('changing views retains completed shared dice history', async () => {
  const { gm } = await focusFixture();
  const saved = gm.campaignWorld.save();
  saved.rollLog = [{ message: 'D20: 17', type: 'roll', timestamp: '16:00', id: 1 }];
  gm.campaignWorld.acceptCheckpoint(saved);
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    expect(gm.campaignWorld.save().rollLog).toEqual(saved.rollLog);
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('focused-creature subscribers observe a complete map checkpoint, not an in-progress transition', async () => {
  const { gm, library } = await focusFixture();
  const snapshots = [];
  const errors = [];
  const selected = (event) => {
    if (event.detail.token?.id !== 'token-2') return;
    snapshots.push(
      captureCampaignScene(gm, library).catch((error) => {
        errors.push(error);
      })
    );
  };
  window.addEventListener('taverntable:tokenSelected', selected);
  try {
    await changeCampaignView(gm, { focusTokenId: 'token-2' });
    const captured = await Promise.all(snapshots);
    expect(snapshots).toHaveLength(1);
    expect(errors).toEqual([]);
    expect(captured[0].view.mapId).toBe('inside');
    expect(captured[0].view.focusTokenId).toBe('token-2');
  } finally {
    window.removeEventListener('taverntable:tokenSelected', selected);
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});

test('a renderer failure that also prevents rollback blocks movement and saving until reload', async () => {
  const { gm, library } = await focusFixture();
  gm.ensureInstancing = () => ({
    restorePlacements: async () => {
      throw new Error('Renderer unavailable');
    },
  });
  try {
    await expect(changeCampaignView(gm, { mapId: 'inside' })).rejects.toThrow(
      /map view could not be restored/i
    );
    expect(gm.campaignMapFailure).toBeInstanceOf(AggregateError);
    await expect(captureCampaignScene(gm, library)).rejects.toBe(gm.campaignMapFailure);
    expect(gm.token3DAdapter.getTokenMovementRange(gm.placedTokens[0])).toBeNull();
  } finally {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    gm.token3DAdapter.disposeMovementRange();
  }
});
