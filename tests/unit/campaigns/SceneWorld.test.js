import {
  captureCampaignScene,
  restoreCampaignScene,
  applySceneCharacterLinks,
} from '../../../src/campaigns/SceneWorld.js';
import { encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { linkTokenCharacter } from '../../../src/entities/creatures/TokenMovement.js';
import { Token3DAdapter } from '../../../src/scene/Token3DAdapter.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { sceneState } from '../../helpers/sceneState.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { TokenManager } from '../../../src/managers/TokenManager.js';
import {
  targetingAvailability,
  validateTargetSelection,
} from '../../../src/rules/targeting/assessment.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';

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
  const terrain = new TerrainEngine(5, 5);
  terrain.setHeightAt(2, 2, 7);
  terrain.setBiomeSeed(42);
  const gm = {
    cols: 5,
    rows: 5,
    placedTokens: [token],
    terrainEngine: terrain,
    spatial: { tileWorldSize: 1, elevationUnit: 0.3 },
    tokenManager: { _nextTokenId: 1, _tokenTypeCounts: new Map([[token.type, 1]]) },
    getTerrainHeight: (x, y) => terrain.getHeightAt(x, y),
    threeSceneManager: { snapshotView: () => sceneState().camera },
  };
  const adapter = new Token3DAdapter(gm);
  gm.token3DAdapter = adapter;
  adapter.setSelectedToken(token);
  const combat = new CombatSession({ library });
  gm.characterServices = { library, combat };
  return { gm, adapter, combat, token, terrain };
}

function flyWorld() {
  localStorage.clear();
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: classic.entries,
    classes: classic.classes,
    storage: localStorage,
  });
  const id = library.create('Caster');
  library.edit(id, { classId: 'wizard', level: 5 });
  const world = createWorld(library, id);
  const recipient = {
    id: 'token-2',
    instanceNumber: 2,
    type: world.token.type,
    name: 'Recipient',
    nameMode: 'custom',
    gridX: 2,
    gridY: 1,
    facingAngle: 0,
    world: { x: 2.5, y: 0, z: 1.5 },
    movementSettings: { speed: 30, mode: 'walk', type: 'default' },
    fallTraits: { flySpeed: 20 },
  };
  world.gm.placedTokens.push(recipient);
  world.gm.tokenManager._nextTokenId = 2;
  world.gm.tokenManager._tokenTypeCounts.set(world.token.type, 2);
  const board = () => ({
    tokens: world.gm.placedTokens.map((token) => ({
      id: token.id,
      name: token.name,
      world: token.world,
      allegiance: 'friendly',
      creatureType: 'humanoid',
      conditions: [],
      abilities: {},
    })),
    tileSize: 1,
    clearPath: () => true,
  });
  world.combat.targeting = {
    beginQuery: () => {},
    hasTokenId: (id, characterId = null) =>
      world.gm.placedTokens.some(
        (token) => token.id === id && (!characterId || token.characterSheetId === characterId)
      ),
    availability: (token, action) => {
      const current = board();
      return targetingAvailability(
        current,
        current.tokens.find((row) => row.id === token.id),
        action.targeting
      );
    },
    validate: (token, action, selection) => {
      const current = board();
      return validateTargetSelection(
        current,
        current.tokens.find((row) => row.id === token.id),
        action.targeting,
        selection
      );
    },
  };
  const owned = library.add(id, 'spell:fly');
  library.prepare(id, owned, true);
  world.combat.commitAction(world.combat.prepareAction(world.token, `spell:${owned}`), '', null, {
    targets: [{ tokenId: recipient.id, count: 1 }],
    willingConfirmed: true,
  });
  return { ...world, library, recipient };
}

test('Fly scene saves contain temporary grants separately from unlinked creature base flight', async () => {
  const { gm, library, recipient, adapter, combat } = flyWorld();
  try {
    expect(
      combat.movementCharacter(recipient, { fallTraits: recipient.fallTraits }).fallTraits.flySpeed
    ).toBe(60);
    const scene = await captureCampaignScene(gm, library);
    expect(scene.creatures[1].fallTraits.flySpeed).toBe(20);
    expect(scene.combat.effects[0]).toMatchObject({
      kind: 'flight',
      targetTokenIds: [recipient.id],
    });
    expect(() => encodeScene(scene, { ruleset: '2014', library })).not.toThrow();
  } finally {
    adapter.disposeMovementRange();
  }
});

test('linking a previously unlinked Fly recipient preserves its scene grant without saving it into the character', async () => {
  const { gm, library, recipient, adapter, combat } = flyWorld();
  try {
    const characterId = library.create('Recipient', { fallTraits: recipient.fallTraits });
    const scene = await captureCampaignScene(gm, library, {
      change: { linkTokenId: recipient.id },
      result: characterId,
    });
    applySceneCharacterLinks(gm, scene, library);
    expect(recipient.characterSheetId).toBe(characterId);
    expect(combat.effects).toHaveLength(1);
    expect(combat.movementCharacter(recipient, library.get(characterId)).fallTraits.flySpeed).toBe(
      60
    );
    expect(library.get(characterId).fallTraits.flySpeed).toBe(20);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('loading a different character into the caster token invalidates its old Fly source', async () => {
  const { gm, library, token, adapter, combat } = flyWorld();
  try {
    linkTokenCharacter(token, library, library.create('Different caster'));
    const scene = await captureCampaignScene(gm, library);
    expect(scene.combat.effects).toEqual([]);
    combat.syncEffects();
    expect(combat.effects).toEqual([]);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('captures committed terrain, canonical linked names, selected token and completed combat data', async () => {
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
    expect(gm.terrainEngine.save().heights).toEqual(scene.terrain.heights);
    expect(gm.threeSceneManager.restoreView).toHaveBeenCalledWith(scene.camera);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('campaign checkpoints retain constructed volumes and the creature support floor', async () => {
  localStorage.clear();
  const library = new CharacterLibrary({ catalog: [], ruleset: '2014', storage: localStorage });
  const { gm, adapter, token, terrain } = createWorld(library, library.create('Upper Scout'));
  terrain.addVolume({
    id: 'upper-floor',
    layerId: 'upper',
    bounds: { min: { x: 5, y: 9, z: 5 }, max: { x: 10, y: 10, z: 10 } },
  });
  token.world.y = 2;
  try {
    const scene = await captureCampaignScene(gm, library);
    expect(scene.version).toBe(2);
    expect(scene.terrain.geometry.volumes[0].id).toBe('upper-floor');
    expect(scene.creatures[0].pose.surfaceId).toBe('upper-floor');
    const reopened = decodeScene(encodeScene(scene, { ruleset: '2014', library }), {
      ruleset: '2014',
      library,
    });
    const restored = new TerrainEngine(1, 1);
    restored.load({ heights: reopened.terrain.heights, geometry: reopened.terrain.geometry });
    expect(restored.geometry.findSupport(7.5, 7.5, { belowFeet: 20 }).heightFeet).toBe(10);
    expect(reopened.creatures[0].pose.world.y).toBe(2);
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
  const { gm, adapter, combat, token, terrain } = createWorld(library, id);
  const autosave = new CampaignAutosave({
    gameManager: gm,
    library,
    combat,
    getRollLog: () => [{ message: 'Check: 17', type: 'roll', timestamp: '12:01', id: 1 }],
  });
  try {
    await autosave.start();
    expect(autosave.status.state).toBe('saved');
    terrain.setHeightAt(2, 2, 9);
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
    terrain.setHeightAt(2, 2, 10);
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
