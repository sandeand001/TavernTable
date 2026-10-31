import { captureCampaignScene, restoreCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { linkTokenCharacter } from '../../../src/entities/creatures/TokenMovement.js';
import { Token3DAdapter } from '../../../src/scene/Token3DAdapter.js';
import { TerrainDataStore } from '../../../src/terrain/TerrainDataStore.js';
import { sceneState } from '../../helpers/sceneState.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { TokenManager } from '../../../src/managers/TokenManager.js';

function createWorld(library, characterId) {
  const token = {
    id: 'token-1',
    instanceNumber: 1,
    type: sceneState().creatures[0].type,
    name: 'Before',
    gridX: 1,
    gridY: 1,
    facingAngle: 0.6,
    world: { x: 1.5, y: 0, z: 1.5 },
    movementSettings: { mode: 'run', type: 'default' },
  };
  linkTokenCharacter(token, library, characterId);
  const dataStore = new TerrainDataStore(5, 5);
  dataStore.set(2, 2, 7);
  const gm = {
    cols: 5,
    rows: 5,
    placedTokens: [token],
    terrainCoordinator: {
      dataStore,
      _biomeSeed: 42,
      getElevationScale: () => 8,
      getTreeDensityMultiplier: () => 1,
    },
    spatial: { tileWorldSize: 1, elevationUnit: 0.3 },
    tokenManager: { _nextTokenId: 1, _tokenTypeCounts: new Map([[token.type, 1]]) },
    getTerrainHeight: (x, y) => dataStore.get(x, y),
    threeSceneManager: { snapshotView: () => sceneState().camera },
  };
  const adapter = new Token3DAdapter(gm);
  gm.token3DAdapter = adapter;
  adapter.setSelectedToken(token);
  const combat = new CombatSession({ library });
  gm.characterServices = { library, combat };
  return { gm, adapter, combat, token, dataStore };
}

test('captures working terrain, canonical linked names, selected token and completed combat data', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({ catalog: [], ruleset: '2014', storage: localStorage });
  const characterId = library.create('Before');
  const { gm, adapter, combat, token } = createWorld(library, characterId);
  library.edit(characterId, { name: 'Saved name' });
  combat.startTurn(token);
  combat.useAction(token, 'attack:unarmed');
  try {
    const scene = await captureCampaignScene(gm, library, { combat });
    expect(scene.terrain.heights[2][2]).toBe(7);
    expect(scene.creatures[0]).toMatchObject({
      name: 'Saved name',
      nameMode: 'character',
      characterId,
      facingAngle: 0.6,
      movement: { mode: 'run', type: 'default' },
    });
    expect(scene.selection).toBe(token.id);
    expect(scene.combat.states[0].budget.actions).toBe(0);
    expect(scene.combat.histories[0].entries).toHaveLength(1);
    expect(() => encodeScene(scene, { ruleset: '2014', library })).not.toThrow();
  } finally {
    adapter.disposeMovementRange();
  }
});

test('restoration uses the actual token lifecycle API and restores an empty saved board without stale creatures', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({ catalog: [], ruleset: '2014', storage: localStorage });
  const { gm, adapter, token, combat } = createWorld(library, library.create('Old'));
  gm.tokenManager = new TokenManager(gm);
  gm.tokenManager.placedTokens.push(token);
  Object.defineProperty(gm, 'placedTokens', { get: () => gm.tokenManager.placedTokens });
  gm.resizeGrid = jest.fn();
  gm.terrainCoordinator.setTreeDensityMultiplier = jest.fn();
  gm.terrainCoordinator.setBiomeSeed = jest.fn();
  gm.terrainCoordinator.setElevationScale = jest.fn();
  gm.terrainCoordinator.applyBiomePaletteToBaseGrid = jest.fn();
  gm.notifyTerrainHeightsChanged = jest.fn();
  gm.placeableMeshPool = { restorePlacements: jest.fn(async () => {}) };
  gm.ensureInstancing = () => gm.placeableMeshPool;
  gm.threeSceneManager.restoreView = jest.fn();
  gm.stateCoordinator = { setViewMode: jest.fn() };
  const scene = sceneState();
  scene.creatures = [];
  try {
    await restoreCampaignScene(gm, scene, library, combat);
    expect(gm.placedTokens).toEqual([]);
    expect(gm.terrainCoordinator.dataStore.working).toEqual(scene.terrain.heights);
    expect(gm.threeSceneManager.restoreView).toHaveBeenCalledWith(scene.camera);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('autosave acknowledges a complete board and rejects conflicting scene/character updates without overwriting it', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });

  const campaign = await store.create({ name: 'World save', ruleset: '2014' });
  const catalog = { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] };
  const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const id = await library.create('Before');
  const { gm, adapter, combat, token, dataStore } = createWorld(library, id);
  const autosave = new CampaignAutosave({
    gameManager: gm,
    library,
    combat,
    getRollLog: () => [{ message: 'Check: 17', type: 'roll', timestamp: '12:01', id: 1 }],
  });
  try {
    await autosave.start();
    expect(autosave.status.state).toBe('saved');
    dataStore.set(2, 2, 9);
    await library.edit(id, { name: 'Saved name' });
    expect(token.name).toBe('Saved name');
    combat.startTurn(token);
    await combat.useAction(token, 'attack:unarmed');
    await autosave.flush();
    const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    const saved = decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened });
    expect(saved.terrain.heights[2][2]).toBe(9);
    expect(saved.creatures[0].name).toBe('Saved name');
    expect(saved.combat.histories[0].entries).toHaveLength(1);
    expect(saved.combat.states[0].budget.actions).toBe(0);
    expect(saved.rollLog[0].message).toBe('Check: 17');
    expect(autosave.status.state).toBe('saved');
    await store.commitScene(campaign.id, {
      ruleset: '2014',
      revision: reopened.sceneRevision,
      charactersRevision: reopened.revision,
      scene: reopened.savedScene,
    });
    dataStore.set(2, 2, 10);
    await expect(autosave.flush()).rejects.toThrow(/another window|changed/);
    expect(autosave.status.state).toBe('error');
    await expect(library.edit(id, { name: 'Rejected' })).rejects.toThrow(/another window|changed/);
    expect(library.get(id).name).toBe('Saved name');
    expect((await store.readScene(campaign.id)).scene).toBe(reopened.savedScene);
  } finally {
    autosave.dispose();
    adapter.disposeMovementRange();
    store.close();
  }
});
