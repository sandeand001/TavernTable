const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { IDBFactory } = require('fake-indexeddb');
const { default: CampaignStore } = require('../../src/campaigns/CampaignStore.js');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');
const { default: CampaignWorld } = require('../../src/campaigns/CampaignWorld.js');
const { TerrainGeometry } = require('../../src/terrain/TerrainGeometry.js');
const { TerrainEngine } = require('../../src/terrain/TerrainEngine.js');
const { reconcileBuildingScene } = require('../../src/campaigns/BuildingAssembly.js');
const { encodeScene } = require('../../src/campaigns/CampaignScene.js');
const { HostResources } = require('../../tools/host-resources.js');
const { participantState } = require('../../tools/cloud/participant-state.js');
const { sceneState } = require('../helpers/sceneState.js');

async function fixture(t) {
  const root = path.resolve(__dirname, '..', '..');
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8')
  );
  const store = new CampaignStore({ indexedDB: new IDBFactory(), packs: manifest.packs });
  t.after(() => store.close());
  const campaign = await store.create({ name: 'Scoped projection fixture', ruleset: '2014' });
  const catalog = await new HostResources({ root, manifest }).catalog(campaign);
  let library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const first = await library.create('First observer');
  const second = await library.create('Second observer');
  await library.edit(first, { notes: 'FIRST PRIVATE SHEET' });
  await library.edit(second, { notes: 'SECOND PRIVATE SHEET' });
  const raw = sceneState({ characterId: first, name: 'First observer' });
  raw.version = 2;
  raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'opaque-wall',
    bounds: { min: { x: 12, y: 0, z: 0 }, max: { x: 13, y: 15, z: 25 } },
  });
  raw.terrain.geometry = geometry.save();
  raw.creatures.push({
    ...structuredClone(raw.creatures[0]),
    id: 'token-2',
    instanceNumber: 2,
    name: 'Second observer',
    characterId: second,
    gridX: 3,
    pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
  });
  raw.tokenCounters = { nextId: 2, types: [[raw.creatures[0].type, 2]] };
  const validation = { ruleset: '2014', library };
  await store.commitScene(campaign.id, {
    ruleset: '2014',
    revision: 0,
    charactersRevision: library.revision,
    scene: encodeScene(CampaignWorld.fromScene(raw, validation).save(), validation),
  });
  library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
  const state = await store.readCharacters(campaign.id);
  const project = (characterIds, observerTokenId, assetKey = null) =>
    participantState({
      state,
      catalog,
      campaign: state.campaign,
      characterIds,
      options: { observerTokenId, mapId: 'map-main', assetKey },
      images: [first, second].map((characterId, index) => ({
        characterId,
        field: 'portraitImage',
        sha256: String(index + 1).repeat(64),
        mimeType: 'image/png',
      })),
    });
  return { store, campaign, catalog, library, state, first, second, project };
}

test('shared snapshot geometry keeps sheets, image slots and hidden owned gameplay scoped per view', async (t) => {
  const f = await fixture(t);
  const original = structuredClone(f.state);
  const first = await f.project([f.first], 'token-1');
  const second = await f.project([f.second], 'token-2');
  const party = await f.project([f.first, f.second], 'token-1');
  await assert.rejects(
    f.project([f.first], 'token-2'),
    (error) => error.code === 'participant-view-forbidden'
  );
  const warm = await f.project([f.first], 'token-1', first.state.publicScene.assetKey);
  assert.deepEqual(
    first.state.publicScene.actors.map(({ id }) => id),
    ['token-1']
  );
  assert.deepEqual(
    second.state.publicScene.actors.map(({ id }) => id),
    ['token-2']
  );
  assert.deepEqual(
    party.state.gameplay.ownedTokens.map(({ tokenId }) => tokenId),
    ['token-1']
  );
  assert.equal(first.state.records.length, 1);
  assert.equal(second.state.records.length, 1);
  assert.equal(party.state.records.length, 2);
  assert.ok(JSON.stringify(first).includes('FIRST PRIVATE SHEET'));
  assert.ok(!JSON.stringify(first).includes('SECOND PRIVATE SHEET'));
  assert.ok(JSON.stringify(second).includes('SECOND PRIVATE SHEET'));
  assert.ok(!JSON.stringify(second).includes('FIRST PRIVATE SHEET'));
  assert.ok(first.imageSlots.every(({ id }) => id === f.first || id === 'token-1'));
  assert.ok(second.imageSlots.every(({ id }) => id === f.second || id === 'token-2'));
  assert.equal(warm.state.publicScene.assets, null);
  assert.deepEqual(warm.assets, first.assets);
  assert.deepEqual(warm.state.gameplay, first.state.gameplay);
  assert.deepEqual(f.state, original);
});

test('a reused capture refreshes native geometry and sheets when its canonical contents change', async (t) => {
  const f = await fixture(t);
  const initial = await f.project([f.first, f.second], 'token-1');
  await f.library.edit(f.first, { name: 'Renamed observer', notes: 'UPDATED PRIVATE SHEET' });
  const scene = JSON.parse(f.state.scene);
  scene.maps[0].terrain.geometry.volumes = [];
  scene.creatures[0].name = 'Renamed observer';
  await f.store.commitScene(f.campaign.id, {
    ruleset: '2014',
    revision: f.state.sceneRevision,
    charactersRevision: f.library.revision,
    scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
  });
  Object.assign(f.state, await f.store.readCharacters(f.campaign.id));
  const changed = await f.project(
    [f.first, f.second],
    'token-1',
    initial.state.publicScene.assetKey
  );
  assert.deepEqual(
    changed.state.publicScene.actors.map(({ id }) => id),
    ['token-1', 'token-2']
  );
  assert.deepEqual(
    changed.state.gameplay.ownedTokens.map(({ tokenId }) => tokenId),
    ['token-1', 'token-2']
  );
  assert.notEqual(changed.state.publicScene.assetKey, initial.state.publicScene.assetKey);
  assert.notEqual(changed.state.publicScene.assets, null);
  assert.ok(JSON.stringify(changed.state.records).includes('UPDATED PRIVATE SHEET'));
  assert.ok(!JSON.stringify(changed.state.records).includes('FIRST PRIVATE SHEET'));
});

test('a generated multi-floor castle with eight actors stays within the native projection CPU gate', async (t) => {
  const f = await fixture(t);
  const characterIds = [f.first, f.second];
  while (characterIds.length < 8)
    characterIds.push(await f.library.create(`Castle actor ${characterIds.length + 1}`));
  for (const id of characterIds.slice(0, 4)) {
    await f.library.edit(id, { classId: 'wizard', level: 5 });
    for (const entry of ['spell:fly', 'spell:scorching-ray', 'spell:magic-missile']) {
      const spellId = await f.library.add(id, entry);
      await f.library.prepare(id, spellId, true);
    }
  }
  const engine = new TerrainEngine(60, 60);
  engine.generateBiomeElevation('cliffsideCastle', { seed: 42 });
  const raw = sceneState();
  raw.version = 2;
  raw.grid = { cols: 60, rows: 60, tileWorldSize: 1 };
  raw.terrain.heights = engine.save().heights;
  raw.terrain.geometry = engine.geometry.save();
  raw.terrain.biome = engine.biomeKey;
  raw.terrain.worldElevationUnit = 0.5;
  const template = raw.creatures[0];
  raw.creatures = characterIds.map((id, index) => {
    const gridX = index + 1;
    const gridY = 55;
    const support = engine.geometry.findSupport((gridX + 0.5) * 5, (gridY + 0.5) * 5, {
      belowFeet: 1000,
      clearanceFeet: 5,
    });
    assert.ok(support, 'Each generated actor needs actual supported terrain');
    return {
      ...structuredClone(template),
      id: `token-${index + 1}`,
      instanceNumber: index + 1,
      name: f.library.get(id).name,
      nameMode: 'character',
      characterId: id,
      gridX,
      gridY,
      movement: { mode: 'walk', type: 'default' },
      pose: {
        kind: 'ground',
        world: { x: gridX + 0.5, y: support.heightFeet / 5, z: gridY + 0.5 },
      },
    };
  });
  raw.tokenCounters = { nextId: 8, types: [[template.type, 8]] };
  const validation = { ruleset: '2014', library: f.library };
  const scene = reconcileBuildingScene(raw, validation);
  assert.ok(scene.maps.length >= 20, 'Exercise real multi-floor maps, not a single small board');
  assert.ok(scene.connections.length >= 40, 'Exercise real doors, windows and stairs');
  await f.store.commitScene(f.campaign.id, {
    ruleset: '2014',
    revision: f.state.sceneRevision,
    charactersRevision: f.library.revision,
    scene: encodeScene(scene, validation),
  });
  Object.assign(f.state, await f.store.readCharacters(f.campaign.id));
  const before = structuredClone(f.state);
  const times = [];
  let latest;
  for (let index = 0; index < 3; index++) {
    const started = performance.now();
    latest = await participantState({
      state: f.state,
      catalog: f.catalog,
      campaign: f.state.campaign,
      characterIds: characterIds.slice(0, 4),
      options: {
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: latest?.state.publicScene.assetKey ?? null,
      },
      images: [],
    });
    times.push(performance.now() - started);
  }
  assert.ok(Math.max(...times) < 2000, `Full-world projection exceeded 2 seconds: ${times}`);
  t.diagnostic(
    JSON.stringify({
      maps: scene.maps.length,
      connections: scene.connections.length,
      actors: scene.creatures.length,
      projectionMs: times,
    })
  );
  assert.equal(latest.state.records.length, 4);
  assert.equal(latest.state.publicScene.assets, null);
  assert.ok(latest.state.gameplay.ownedTokens[0].availableActions.length > 3);
  assert.deepEqual(f.state, before);
});
