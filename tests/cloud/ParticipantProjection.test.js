const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { setImmediate: yieldToIO } = require('node:timers/promises');
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
const {
  participantState,
  reuseParticipantGeometry,
  participantProjectionSource,
} = require('../../tools/cloud/participant-state.js');
const { visibleMovementPresentations } = require('../../tools/movement-presentations.js');
const { ParticipantChanges } = require('../../tools/cloud/participant-changes.js');
const { CloudError } = require('../../tools/cloud/cloud-error.js');
const { sceneActorPlacement } = require('../../src/scene/token-adapter/SavedPlacements.js');
const { sceneState } = require('../helpers/sceneState.js');
const {
  sealPlayerAssets,
  validatePlayerAssets,
} = require('../../src/campaigns/PlayerPublicProtocol.js');

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

for (const stage of ['presentation', 'snapshot'])
  test(
    `a pending scoped ${stage} does not hold another current native observer behind it`,
    { timeout: 10000 },
    async (t) => {
      const f = await fixture(t);
      const sessionId = randomUUID();
      const access = {
        version: 1,
        uid: 'native-observation-owner',
        campaignId: f.campaign.id,
        role: 'owner',
        seatId: null,
        accessGeneration: 0,
      };
      const delayed = { uid: access.uid };
      const current = { uid: access.uid };
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      t.after(() => release.resolve());
      let head = { generation: 1 };
      let notifyHead;
      const idleWatch = () => () => {};
      const reference = {
        onSnapshot(listener) {
          notifyHead = listener;
          return () => {
            notifyHead = null;
          };
        },
        collection: () => ({ onSnapshot: idleWatch, doc: () => ({ onSnapshot: idleWatch }) }),
      };
      const changes = new ParticipantChanges({
        firestore: { collection: () => ({ doc: () => reference }) },
        _accessExpectation: (scope) => scope,
        getLiveAccess: async () => ({ participant: { access } }),
        _loadSnapshot: async () => f.state,
        async _ownerWorldSnapshot(principal, id, command, scope, load) {
          const captured = head;
          await yieldToIO();
          if (stage === 'snapshot' && captured.generation > 1 && principal === delayed) {
            entered.resolve();
            await release.promise;
          }
          return {
            version: 1,
            access,
            sessionId,
            generation: captured.generation,
            origin: null,
            state: await load(captured),
          };
        },
        _participantCommittedChanges: async (principal, id, command, scope, afterGeneration) => ({
          headGeneration: head.generation,
          resync: afterGeneration < head.generation - 1,
        }),
        async _ownerWorldPresentations(principal, id, command, scope, previous, next) {
          if (stage === 'presentation' && principal === delayed) {
            entered.resolve();
            await release.promise;
          }
          if (head.generation !== next.generation)
            throw new CloudError(409, 'participant-state-changed', 'The live world advanced');
          return [];
        },
      });
      const observe = (principal) => {
        const events = [];
        const errors = [];
        const failed = Promise.withResolvers();
        const advanced = new Map([2, 3].map((generation) => [generation, Promise.withResolvers()]));
        const subscription = changes.subscribe(
          principal,
          f.campaign.id,
          { sessionId, observerTokenId: null, mapId: null, assetKey: null },
          access,
          {
            onEvent(event) {
              events.push(event);
              const generation = event.delta?.generation ?? event.checkpoint?.generation;
              advanced.get(generation)?.resolve(event);
            },
            onError(error) {
              errors.push(error.code);
              failed.resolve(error.code);
            },
          },
          true
        );
        t.after(() => subscription.close());
        return { events, errors, failed, advanced, subscription };
      };
      const slow = observe(delayed);
      await slow.subscription.ready;
      const ready = observe(current);
      await ready.subscription.ready;
      head = { generation: 2, presentationRef: {} };
      notifyHead({ data: () => head });
      await entered.promise;
      try {
        const delivered = await Promise.race([
          ready.advanced.get(2).promise.then(() => true),
          yieldToIO().then(() => false),
        ]);
        assert.deepEqual(ready.errors, []);
        assert.equal(delivered, true, 'An independently authorized observer must advance now');
        assert.equal(slow.events.length, 1, 'The unconfirmed observer must still wait');
        head = { generation: 3, presentationRef: {} };
        notifyHead({ data: () => head });
        const continued = await Promise.race([
          ready.advanced.get(3).promise.then((event) => event.kind),
          yieldToIO().then(() => null),
        ]);
        assert.equal(
          continued,
          'owner-delta',
          'Later commands must keep flowing without inheriting the slow observer cursor'
        );
        assert.equal(slow.events.length, 1, 'The unconfirmed observer must still wait');
      } finally {
        release.resolve();
      }
      assert.equal((await slow.advanced.get(3).promise).kind, 'owner-resync');
      assert.equal((await ready.advanced.get(2).promise).delta.generation, 2);
      assert.equal((await ready.advanced.get(3).promise).delta.generation, 3);
      assert.deepEqual(slow.errors, []);
      head = { generation: 2 };
      notifyHead({ data: () => head });
      assert.deepEqual(
        await Promise.race([
          Promise.all([slow.failed.promise, ready.failed.promise]),
          yieldToIO().then(() => null),
        ]),
        ['invalid-change-history', 'invalid-change-history'],
        'An actually backwards head must fail, not retry forever as a superseded capture'
      );
    }
  );

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

test('successive actor checkpoints reuse immutable artwork without hiding current poses or location metadata', async (t) => {
  const f = await fixture(t);
  const scene = JSON.parse(f.state.scene);
  scene.locations = [{ id: 'location-main', name: 'Initial region' }];
  for (const map of scene.maps) map.locationId = 'location-main';
  const initialState = {
    ...f.state,
    scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
  };
  const project = (state, assetKey = null) =>
    participantState({
      state,
      catalog: f.catalog,
      campaign: state.campaign,
      characterIds: [f.first],
      options: { observerTokenId: 'token-1', mapId: 'map-main', assetKey },
      images: [],
    });
  const initial = await project(initialState);
  scene.creatures[0].pose.world.x += 0.1;
  const movedState = {
    ...initialState,
    sceneRevision: initialState.sceneRevision + 1,
    scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
  };
  reuseParticipantGeometry(movedState, initialState);
  const moved = await project(movedState, initial.state.publicScene.assetKey);
  assert.equal(moved.assets, initial.assets);
  assert.equal(moved.state.publicScene.assets, null);
  assert.notDeepEqual(moved.state.publicScene.actors, initial.state.publicScene.actors);
  assert.ok(!JSON.stringify(moved).includes('SECOND PRIVATE SHEET'));
  scene.locations[0].name = 'Updated region';
  const renamedState = {
    ...movedState,
    sceneRevision: movedState.sceneRevision + 1,
    scene: encodeScene(scene, { ruleset: '2014', library: f.library }),
  };
  reuseParticipantGeometry(renamedState, movedState);
  const renamed = await project(renamedState, moved.state.publicScene.assetKey);
  assert.equal(renamed.assets.location.name, 'Updated region');
  assert.notEqual(renamed.state.publicScene.assetKey, moved.state.publicScene.assetKey);
  assert.notEqual(renamed.state.publicScene.assets, null);
});

test('shared motion geometry preserves per-observer visibility without changing the legacy projection', async (t) => {
  const f = await fixture(t);
  const first = await f.project([f.first], 'token-1');
  const second = await f.project([f.second], 'token-2');
  const { scene, library, world } = participantProjectionSource(
    f.state,
    f.catalog,
    f.state.campaign
  );
  const placement = sceneActorPlacement(scene, scene.creatures[0]);
  const from = structuredClone(placement);
  from.pose.world.x -= 0.1;
  const update = {
    commandId: 'scoped_motion_reuse',
    tokenId: 'token-1',
    kind: 'move',
    sceneRevision: f.state.sceneRevision,
    charactersRevision: f.state.revision,
    motion: { kind: 'walk', completed: true, from, route: [placement] },
  };
  const input = {
    root: path.resolve(__dirname, '..', '..'),
    scene,
    library,
    state: f.state,
    updates: [update],
    sinceSceneRevision: 0,
  };
  const legacy = await visibleMovementPresentations({ ...input, view: first.state });
  const shared = await visibleMovementPresentations({ ...input, world, view: first.state });
  assert.deepEqual(shared, legacy);
  assert.deepEqual(
    shared.map(({ commandId }) => commandId),
    [update.commandId]
  );
  assert.deepEqual(await visibleMovementPresentations({ ...input, world, view: second.state }), []);
});

test('certified public terrain is deeply immutable without trusting merely frozen or previously valid inputs', async (t) => {
  const f = await fixture(t);
  const projected = await f.project([f.first], 'token-1');
  const source = structuredClone(projected.assets);
  const sealed = sealPlayerAssets(Object.freeze(source));
  assert.throws(
    () => Object.defineProperty(sealed.maps[0].terrain.heights[0], '0', { value: 999 }),
    TypeError
  );
  assert.equal(validatePlayerAssets(sealed), sealed);
  const mutable = structuredClone(projected.assets);
  validatePlayerAssets(mutable);
  mutable.maps[0].terrain.geometry.privateBlueprints = [];
  assert.throws(
    () => validatePlayerAssets(mutable),
    (error) => error.code === 'invalid-player-state'
  );
  assert.throws(
    () => sealPlayerAssets(mutable),
    (error) => error.code === 'invalid-player-state'
  );
  delete mutable.maps[0].terrain.geometry.privateBlueprints;
  assert.equal(validatePlayerAssets(sealPlayerAssets(mutable)), mutable);
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
