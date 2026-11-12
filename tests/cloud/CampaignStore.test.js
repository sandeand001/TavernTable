const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmulatorRuntime,
  readEmulatorEnvironment,
} = require('../../tools/cloud/emulator-runtime.js');
const sdk = require('firebase/auth');
const { createCanvas } = require('canvas');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { HostResources } = require('../../tools/host-resources.js');
const { sceneState } = require('../helpers/sceneState.js');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');
const { default: CloudAccount } = require('../../src/campaigns/CloudAccount.js');
const {
  default: CloudAccountConnection,
} = require('../../src/campaigns/CloudAccountConnection.js');
const {
  default: CloudCampaignClientStore,
} = require('../../src/campaigns/CloudCampaignClientStore.js');
const { CompendiumCatalog } = require('../../src/entities/characters/CompendiumCatalog.js');
const { default: CombatSession } = require('../../src/entities/characters/CombatSession.js');
const {
  createTwoFloorTravelScene,
} = require('../../src/campaigns/examples/ConnectedTravelExample.js');
const { default: CampaignWorld } = require('../../src/campaigns/CampaignWorld.js');
const { encodeScene, decodeScene } = require('../../src/campaigns/CampaignScene.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');

function afterStorageUpload(bucket, afterUpload) {
  return {
    name: bucket.name,
    file: (...args) => {
      const file = bucket.file(...args);
      return {
        getMetadata: (...options) => file.getMetadata(...options),
        download: (...options) => file.download(...options),
        save: async (...options) => {
          await file.save(...options);
          await afterUpload(args[0]);
        },
      };
    },
  };
}

async function campaignContext(runtime) {
  const identity = await signedInIdentity(runtime);
  const clients = [];
  try {
    await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
      version: 1,
      uid: identity.uid,
      enabled: true,
    });
    const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
    const principal = await access.verifyAuthorization(`Bearer ${identity.token}`);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(__dirname, '..', '..', 'assets', 'data', 'resources', 'manifest.json'),
        'utf8'
      )
    );
    const resources = new HostResources({ root: path.join(__dirname, '..', '..'), manifest });
    const createStore = (packs = manifest.packs, bucket = runtime.bucket) =>
      new CloudCampaignStore({
        firestore: runtime.firestore,
        access,
        packs,
        resources,
        objects: new ImmutableCloudObjects({ bucket }),
      });
    return {
      principal,
      manifest,
      authorization: `Bearer ${identity.token}`,
      store: createStore(),
      createStore,
      catalog: (campaign) => resources.catalog(campaign),
      metadataOnlyStore: () =>
        new CloudCampaignStore({ firestore: runtime.firestore, access, packs: [] }),
      openApi: () => cloudApi({ access, store: createStore() }),
      client: (api, fetch = globalThis.fetch) => {
        const environment = readEmulatorEnvironment();
        const connection = new CloudAccountConnection({
          account: new CloudAccount({ auth: identity.auth, sdk }),
          fetch,
          baseURL: api.origin + '/',
          runtime: {
            version: 1,
            mode: 'cloud',
            environment: 'emulator',
            apiOrigin: api.url,
            authEmulatorOrigin: `http://${environment.authHost}`,
            firebase: {
              apiKey: 'demo-api-key',
              projectId: environment.projectId,
              authDomain: `${environment.projectId}.firebaseapp.com`,
              appId: 'demo-canonical-client',
            },
          },
        });
        const client = new CloudCampaignClientStore({
          connection,
          uid: identity.uid,
          packs: manifest.packs,
        });
        clients.push(client);
        return client;
      },
      close: async () => {
        try {
          for (const client of clients) client.close();
        } finally {
          await identity.close();
        }
      },
    };
  } catch (error) {
    await identity.close();
    throw error;
  }
}

test(
  'cloud settings use a captured generation and durable receipt while preserving empty canonical state and source pins',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let context;
    try {
      context = await campaignContext(runtime);
      const campaign = await context.store.create(context.principal, {
        commandId: randomUUID(),
        options: { name: 'Settings fixture', ruleset: '2014' },
      });
      const api = await context.openApi();
      try {
        const url = api.url + '/api/cloud/campaigns/' + campaign.id + '/settings';
        const headers = { Authorization: context.authorization, Origin: api.origin };
        const response = await fetch(url, { headers });
        assert.equal(response.status, 200);
        const current = (await response.json()).result;
        assert.deepEqual(current, { version: 1, generation: 1, campaign });
        const source = context.manifest.packs.find((pack) => pack.ruleset === '2014' && !pack.core);
        assert.ok(source);
        const command = {
          commandId: randomUUID(),
          generation: current.generation,
          changes: { name: ' Renamed cloud fixture ', packIds: [source.id] },
        };
        const updatedResponse = await fetch(url, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(command),
        });
        assert.equal(updatedResponse.status, 200);
        const updated = (await updatedResponse.json()).result;
        assert.equal(updated.version, 1);
        assert.equal(updated.generation, 2);
        assert.equal(updated.campaign.id, campaign.id);
        assert.equal(updated.campaign.name, 'Renamed cloud fixture');
        assert.equal(updated.campaign.ruleset, '2014');
        assert.equal(updated.campaign.charactersRevision, 1);
        assert.equal(updated.campaign.sceneRevision, 0);
        assert.deepEqual(updated.campaign.sourcePacks[0], campaign.sourcePacks[0]);
        assert.deepEqual(
          updated.campaign.sourcePacks.find((pack) => pack.id === source.id),
          {
            id: source.id,
            ruleset: '2014',
            version: source.version,
            enabled: true,
          }
        );
        assert.deepEqual(
          await context.createStore().updateSettings(context.principal, campaign.id, command),
          updated
        );
        const state = await context.store.readCharacters(context.principal, campaign.id);
        assert.equal(state.revision, 1);
        assert.equal(state.scene, null);
        assert.deepEqual(state.records, []);
        await assert.rejects(
          context.store.updateSettings(context.principal, campaign.id, {
            ...command,
            commandId: randomUUID(),
            changes: { name: 'Stale rename' },
          }),
          { code: 'stale-revision' }
        );
        assert.deepEqual(await context.store.getSettings(context.principal, campaign.id), updated);
      } finally {
        await api.close();
      }
    } finally {
      try {
        if (context) await context.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'cloud source changes preserve owned spells, Favorites, embedded images and exact scene bytes while rejecting stale sheet writes',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let context;
    try {
      context = await campaignContext(runtime);
      const api = await context.openApi();
      try {
        const client = context.client(api);
        const campaign = await client.create({
          name: 'Complete source persistence fixture',
          ruleset: '2014',
          packIds: ['deepm'],
        });
        const catalog = await context.catalog(campaign);
        const library = await CampaignCharacters.open({
          store: client,
          campaignId: campaign.id,
          catalog,
        });
        library.bindScene({
          capture(engine) {
            const character = engine.list()[0];
            const scene = sceneState({ characterId: character.id, name: character.name });
            return { value: JSON.stringify(scene), scene };
          },
        });
        const characterId = await library.create('Persistent source reader');
        const portraitImage = createCanvas(2, 2).toDataURL('image/png');
        await library.edit(characterId, { portraitImage, notes: 'Cloud-owned notes' });
        const spell = new CompendiumCatalog(catalog)
          .search('', { kind: 'spell' })
          .find((entry) => entry.sourcePack === 'deepm');
        assert.ok(spell);
        const ownedId = await library.add(characterId, spell.id);
        await library.layouts.savePage(characterId, 'combat', {
          sectionOrder: ['favorites'],
          cardOrder: {},
          favorites: [`spell:${ownedId}`],
        });
        const before = await client.readCharacters(campaign.id);
        const headReference = runtime.firestore.collection('campaigns').doc(campaign.id);
        const head = (await headReference.get()).data();
        const settings = await client.getSettings(campaign.id);
        const updated = await client.update(campaign.id, { packIds: [] }, settings);
        const after = await client.readCharacters(campaign.id);
        assert.equal(after.revision, before.revision + 1);
        assert.equal(after.sceneRevision, before.sceneRevision);
        assert.equal(after.scene, before.scene);
        assert.deepEqual(after.records, before.records);
        const nextHead = (await headReference.get()).data();
        assert.deepEqual(nextHead.sceneRef, head.sceneRef);
        assert.deepEqual(nextHead.charactersRef, head.charactersRef);
        assert.equal(nextHead.generation, head.generation + 1);
        const nextCatalog = await context.catalog(updated);
        const reopened = await CampaignCharacters.open({
          store: client,
          campaignId: campaign.id,
          catalog: nextCatalog,
        });
        assert.equal(reopened.get(characterId).spells[0].id, ownedId);
        assert.equal(reopened.get(characterId).portraitImage, portraitImage);
        assert.equal(reopened.get(characterId).notes, 'Cloud-owned notes');
        assert.deepEqual(reopened.layouts.page(characterId, 'combat').favorites, [
          `spell:${ownedId}`,
        ]);
        assert.equal(
          new CompendiumCatalog(nextCatalog).get(spell.id).sourceVersion,
          spell.sourceVersion
        );
        await assert.rejects(reopened.add(characterId, spell.id), /Enable/);
        await assert.rejects(library.adjustHitPoints(characterId, 'damage', 1), {
          code: 'stale-revision',
        });
        assert.deepEqual((await client.readCharacters(campaign.id)).records, before.records);
      } finally {
        await api.close();
      }
    } finally {
      try {
        if (context) await context.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'overlapping settings edits have one winner and identical commands replay once across independent store instances',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Concurrent settings fixture', ruleset: '2014' },
    });
    const settings = await context.store.getSettings(context.principal, campaign.id);
    const competing = await Promise.allSettled(
      ['First name', 'Second name'].map((name) =>
        context.createStore().updateSettings(context.principal, campaign.id, {
          commandId: randomUUID(),
          generation: settings.generation,
          changes: { name },
        })
      )
    );
    const accepted = competing.filter((result) => result.status === 'fulfilled');
    const denied = competing.filter((result) => result.status === 'rejected');
    assert.equal(accepted.length, 1);
    assert.equal(denied.length, 1);
    assert.equal(denied[0].reason.code, 'stale-revision');
    assert.deepEqual(
      await context.store.getSettings(context.principal, campaign.id),
      accepted[0].value
    );
    const command = {
      commandId: randomUUID(),
      generation: accepted[0].value.generation,
      changes: { name: 'Stable replay name' },
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        context.createStore().updateSettings(context.principal, campaign.id, command)
      )
    );
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal(results[0].generation, 3);
    assert.equal(results[0].campaign.charactersRevision, 0);
    assert.equal(
      (await runtime.firestore.collection('campaigns').doc(campaign.id).collection('changes').get())
        .size,
      2
    );
  }
);

test(
  'an in-flight source edit cannot relax its captured generation or overwrite a later canonical settings change',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'In-flight sources fixture', ruleset: '2014' },
    });
    const command = {
      commandId: randomUUID(),
      generation: 1,
      changes: { name: 'Prepared source name', packIds: [] },
    };
    const bucket = afterStorageUpload(runtime.bucket, async () => {
      await context.store.updateSettings(context.principal, campaign.id, {
        commandId: randomUUID(),
        generation: 1,
        changes: { name: 'Later canonical name' },
      });
      command.generation = 2;
      command.changes.name = 'Different caller intent';
      command.changes.packIds.push('srd-2024');
    });
    await assert.rejects(
      context
        .createStore(undefined, bucket)
        .updateSettings(context.principal, campaign.id, command),
      { code: 'stale-revision' }
    );
    const current = await context.store.getSettings(context.principal, campaign.id);
    assert.equal(current.generation, 2);
    assert.equal(current.campaign.name, 'Later canonical name');
    assert.equal(current.campaign.charactersRevision, 0);
    assert.deepEqual(current.campaign.sourcePacks, campaign.sourcePacks);
    assert.equal(
      (
        await runtime.firestore
          .collection('accountCommands')
          .doc(pilotAccountKey(context.principal.uid))
          .collection('receipts')
          .doc(command.commandId)
          .get()
      ).exists,
      false
    );
  }
);

test(
  'failed settings publication rolls back atomically and lost successful replies recover the same original command',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let context;
    try {
      context = await campaignContext(runtime);
      const campaign = await context.store.create(context.principal, {
        commandId: randomUUID(),
        options: { name: 'Settings recovery fixture', ruleset: '2014' },
      });
      const headReference = runtime.firestore.collection('campaigns').doc(campaign.id);
      const before = (await headReference.get()).data();
      const marker = headReference.collection('changes').doc('2');
      await marker.create({ syntheticPublicationConflict: true });
      let markerOwned = true;
      const api = await context.openApi();
      try {
        const requests = [];
        let loseSuccessfulReply = true;
        const client = context.client(api, async (url, options) => {
          if (url.endsWith('/settings') && options.method === 'POST') requests.push(options.body);
          const response = await fetch(url, options);
          if (
            url.endsWith('/settings') &&
            options.method === 'POST' &&
            response.status === 200 &&
            loseSuccessfulReply
          ) {
            loseSuccessfulReply = false;
            await response.clone().json();
            throw new TypeError('Synthetic lost committed settings reply');
          }
          return response;
        });
        const settings = await client.getSettings(campaign.id);
        let stop = () => {};
        const uncertain = new Promise((resolve) => {
          stop = client.subscribeSave((state) => {
            if (state.phase === 'uncertain') resolve(state);
          });
        });
        const pending = client.update(
          campaign.id,
          { name: 'Recovered settings name', packIds: [] },
          settings
        );
        try {
          const state = await uncertain;
          const command = JSON.parse(requests[0]);
          assert.equal(command.commandId, state.commandId);
          assert.deepEqual((await headReference.get()).data(), before);
          const receipt = runtime.firestore
            .collection('accountCommands')
            .doc(pilotAccountKey(context.principal.uid))
            .collection('receipts')
            .doc(command.commandId);
          assert.equal((await receipt.get()).exists, false);
          await marker.delete();
          markerOwned = false;
          await assert.rejects(client.retryPending(), { code: 'cloud-unavailable' });
          assert.equal(client.saveState.phase, 'uncertain');
          assert.equal(client.saveState.commandId, command.commandId);
          const original = await context
            .metadataOnlyStore()
            .updateSettings(context.principal, campaign.id, command);
          await client.retryPending();
          assert.deepEqual(await pending, original.campaign);
          assert.equal(requests.length, 3);
          assert.ok(requests.every((body) => body === requests[0]));
          assert.equal((await headReference.get()).data().generation, 2);
          assert.equal((await headReference.collection('changes').get()).size, 1);
          assert.equal((await marker.get()).data().kind, 'campaign.settings');
        } finally {
          stop();
        }
      } finally {
        if (markerOwned) await marker.delete();
        await api.close();
      }
    } finally {
      try {
        if (context) await context.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'cloud settings reject other UIDs, ownership edits and wrong-edition sources without partially changing either ruleset',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await campaignContext(runtime);
    t.after(() => owner.close());
    const other = await campaignContext(runtime);
    t.after(() => other.close());
    for (const ruleset of ['2014', '2024']) {
      const campaign = await owner.store.create(owner.principal, {
        commandId: randomUUID(),
        options: { name: 'Fixed edition settings', ruleset },
      });
      const initial = await owner.store.getSettings(owner.principal, campaign.id);
      await assert.rejects(owner.store.getSettings(other.principal, campaign.id), {
        code: 'campaign-not-found',
      });
      await assert.rejects(
        owner.store.updateSettings(other.principal, campaign.id, {
          commandId: randomUUID(),
          generation: initial.generation,
          changes: { name: 'Not owned' },
        }),
        { code: 'campaign-not-found' }
      );
      for (const changes of [
        { ruleset: ruleset === '2014' ? '2024' : '2014' },
        { ownerUid: other.principal.uid },
        { packIds: [ruleset === '2014' ? 'srd-2024' : 'srd-2014'] },
        { packIds: ['unknown-pack'] },
        { name: '   ' },
      ])
        await assert.rejects(
          owner.store.updateSettings(owner.principal, campaign.id, {
            commandId: randomUUID(),
            generation: initial.generation,
            changes,
          }),
          { code: 'invalid-campaign-settings' }
        );
      assert.deepEqual(await owner.store.getSettings(owner.principal, campaign.id), initial);
      const updated = await owner.store.updateSettings(owner.principal, campaign.id, {
        commandId: randomUUID(),
        generation: initial.generation,
        changes: { name: 'Same edition', packIds: [] },
      });
      assert.equal(updated.campaign.ruleset, ruleset);
      assert.equal(updated.campaign.coreVersion, campaign.coreVersion);
      assert.deepEqual(updated.campaign.sourcePacks, campaign.sourcePacks);
    }
  }
);

test(
  'one verified UID explicitly creates, lists and reopens its private canonical campaign from durable metadata',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let context;
    try {
      context = await campaignContext(runtime);
      const options = { name: 'Private cloud fixture', ruleset: '2014' };
      const campaign = await context.store.create(context.principal, {
        commandId: randomUUID(),
        options,
      });
      assert.equal(campaign.name, options.name);
      assert.equal(campaign.ruleset, '2014');
      assert.equal(campaign.coreVersion, '5.1');
      assert.deepEqual(campaign.sourcePacks, [
        {
          id: 'srd-2014',
          ruleset: '2014',
          version: '5.1-seed.1',
          enabled: true,
        },
      ]);
      assert.deepEqual(
        (await context.store.list(context.principal)).map(({ id }) => id),
        [campaign.id]
      );
      assert.deepEqual(await context.store.get(context.principal, campaign.id), campaign);
      const state = await context.store.readCharacters(context.principal, campaign.id);
      assert.equal(state.campaign.id, campaign.id);
      assert.equal(state.revision, 0);
      assert.equal(state.sceneRevision, 0);
      assert.equal(state.scene, null);
      assert.deepEqual(state.records, []);
    } finally {
      try {
        if (context) await context.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'a lost create reply retried through another backend instance reuses its UID-scoped durable result without creating a second campaign',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let context;
    try {
      context = await campaignContext(runtime);
      const command = {
        commandId: randomUUID(),
        options: { name: 'Retry fixture', ruleset: '2014' },
      };
      const original = await context.store.create(context.principal, command);
      const replay = await context
        .createStore()
        .create(context.principal, structuredClone(command));
      assert.deepEqual(replay, original);
      assert.deepEqual(
        (await context.store.list(context.principal)).map(({ id }) => id),
        [original.id]
      );
    } finally {
      try {
        if (context) await context.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'another eligible UID cannot list or open a private campaign and cannot select its owner in campaign options',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await campaignContext(runtime);
    t.after(() => owner.close());
    const unrelated = await campaignContext(runtime);
    t.after(() => unrelated.close());
    const campaign = await owner.store.create(owner.principal, {
      commandId: randomUUID(),
      options: { name: 'Owner only', ruleset: '2014' },
    });
    assert.deepEqual(await unrelated.store.list(unrelated.principal), []);
    const unavailable = { status: 404, code: 'campaign-not-found' };
    await assert.rejects(unrelated.store.get(unrelated.principal, campaign.id), unavailable);
    await assert.rejects(
      unrelated.store.readCharacters(unrelated.principal, campaign.id),
      unavailable
    );
    await assert.rejects(unrelated.store.get(unrelated.principal, randomUUID()), unavailable);
    await assert.rejects(
      owner.store.create(owner.principal, {
        commandId: randomUUID(),
        options: { name: 'Forged owner', ruleset: '2014', ownerUid: unrelated.principal.uid },
      }),
      { status: 400, code: 'invalid-campaign-request' }
    );
    assert.deepEqual(await unrelated.store.list(unrelated.principal), []);
    assert.equal((await owner.store.list(owner.principal)).length, 1);
  }
);

test(
  'a command ID cannot change intent but is independent across verified UIDs',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const first = await campaignContext(runtime);
    t.after(() => first.close());
    const second = await campaignContext(runtime);
    t.after(() => second.close());
    const commandId = randomUUID();
    const original = await first.store.create(first.principal, {
      commandId,
      options: { name: 'Original intent', ruleset: '2014' },
    });
    await assert.rejects(
      first.createStore().create(first.principal, {
        commandId,
        options: { name: 'Different intent', ruleset: '2014' },
      }),
      { status: 409, code: 'command-id-conflict' }
    );
    const independent = await second.store.create(second.principal, {
      commandId,
      options: { name: 'Independent UID', ruleset: '2024' },
    });
    assert.notEqual(independent.id, original.id);
    assert.equal(independent.ruleset, '2024');
    assert.deepEqual(
      (await first.store.list(first.principal)).map(({ id }) => id),
      [original.id]
    );
    assert.deepEqual(
      (await second.store.list(second.principal)).map(({ id }) => id),
      [independent.id]
    );
  }
);

test(
  'concurrent backend instances publish one create result and command receipt rather than duplicate campaigns',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const command = {
      commandId: randomUUID(),
      options: { name: 'Concurrent create', ruleset: '2014' },
    };
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        context.createStore().create(context.principal, structuredClone(command))
      )
    );
    for (const reply of replies) assert.deepEqual(reply, replies[0]);
    assert.deepEqual(
      (await context.store.list(context.principal)).map(({ id }) => id),
      [replies[0].id]
    );
  }
);

test(
  'current server eligibility is required even after a principal was verified and a durable create result exists',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const command = {
      commandId: randomUUID(),
      options: { name: 'Revocation fixture', ruleset: '2014' },
    };
    const campaign = await context.store.create(context.principal, command);
    await runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(context.principal.uid))
      .update({ enabled: false });
    const denied = { status: 403, code: 'pilot-access-required' };
    await assert.rejects(context.store.list(context.principal), denied);
    await assert.rejects(context.store.get(context.principal, campaign.id), denied);
    await assert.rejects(context.store.readCharacters(context.principal, campaign.id), denied);
    await assert.rejects(context.createStore().create(context.principal, command), denied);
  }
);

test(
  'invalid or implicit campaign configuration fails explicitly without creating a default campaign',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const options = { name: 'Explicit settings', ruleset: '2014' };
    const invalid = [
      { commandId: randomUUID(), options: { name: 'Missing edition' } },
      null,
      [],
      {},
      { commandId: 'not-a-command-id', options },
      { commandId: randomUUID(), options: null },
      { commandId: randomUUID(), options: { ...options, ruleset: 'unavailable' } },
      { commandId: randomUUID(), options: { ...options, name: ' ' } },
      { commandId: randomUUID(), options: { ...options, packIds: null } },
      { commandId: randomUUID(), options: { ...options, packIds: 123 } },
      { commandId: randomUUID(), options: { ...options, packIds: ['unavailable-pack'] } },
      { commandId: randomUUID(), options: { ...options, packIds: ['srd-2024'] } },
      { commandId: randomUUID(), options, uid: context.principal.uid },
    ];
    for (const command of invalid)
      await assert.rejects(context.store.create(context.principal, command), {
        status: 400,
        code: 'invalid-campaign-request',
      });
    assert.deepEqual(await context.store.list(context.principal), []);
  }
);

test(
  'real bearer-authenticated HTTP creates, lists and opens only the requesting UID campaign',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await campaignContext(runtime);
    t.after(() => owner.close());
    const unrelated = await campaignContext(runtime);
    t.after(() => unrelated.close());
    const api = await owner.openApi();
    t.after(() => api.close());
    const headers = {
      Authorization: owner.authorization,
      Origin: api.origin,
      'Content-Type': 'application/json',
    };
    const created = await fetch(`${api.url}/api/cloud/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandId: randomUUID(),
        options: { name: 'HTTP private fixture', ruleset: '2014' },
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.equal(created.headers.get('access-control-allow-origin'), api.origin);
    const body = await created.json();
    assert.equal(body.version, 1);
    const campaign = body.result;
    assert.equal(campaign.name, 'HTTP private fixture');
    const listed = await fetch(`${api.url}/api/cloud/campaigns`, { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).result, [campaign]);
    const opened = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}`, { headers });
    assert.equal(opened.status, 200);
    assert.deepEqual((await opened.json()).result, campaign);
    const state = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}/characters`, {
      headers,
    });
    assert.equal(state.status, 200);
    assert.deepEqual((await state.json()).result.records, []);
    const forbidden = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}`, {
      headers: { ...headers, Authorization: unrelated.authorization },
    });
    assert.equal(forbidden.status, 404);
    assert.equal((await forbidden.json()).code, 'campaign-not-found');
    const anonymous = await fetch(`${api.url}/api/cloud/campaigns`, {
      headers: { Origin: api.origin },
    });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).code, 'authentication-required');
  }
);

test(
  'cloud HTTP accepts exactly 24 MiB of UTF-8 JSON, rejects one more byte, and never substitutes malformed input',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const api = await context.openApi();
    t.after(() => api.close());
    const headers = {
      Authorization: context.authorization,
      Origin: api.origin,
      'Content-Type': 'application/json',
    };
    const post = (body, extra = {}) =>
      fetch(`${api.url}/api/cloud/campaigns`, {
        method: 'POST',
        headers: { ...headers, ...extra },
        body,
      });
    const maximum = 24 * 1024 * 1024;
    const command = JSON.stringify({
      commandId: randomUUID(),
      options: { name: 'Caf\u00e9 boundary', ruleset: '2014' },
    });
    const body = command + ' '.repeat(maximum - Buffer.byteLength(command));
    assert.equal(Buffer.byteLength(body), maximum);
    const accepted = await post(body);
    assert.equal(accepted.status, 201);
    const original = (await accepted.json()).result;
    const exceeded = await post(body + ' ');
    assert.equal(exceeded.status, 413);
    assert.equal((await exceeded.json()).code, 'request-too-large');
    const malformed = await post('{"credential":"REDACTION-CANARY"');
    assert.equal(malformed.status, 400);
    assert.ok(!(await malformed.text()).includes('REDACTION-CANARY'));
    const invalidUtf8 = Buffer.concat([
      Buffer.from(`{"commandId":"${randomUUID()}","options":{"name":"`),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('","ruleset":"2014"}}'),
    ]);
    const invalidEncoding = await post(invalidUtf8);
    assert.equal(invalidEncoding.status, 400);
    assert.equal((await invalidEncoding.json()).code, 'invalid-campaign-request');
    for (const extra of [{ 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }]) {
      const unsupported = await post(command, extra);
      assert.equal(unsupported.status, 415);
      assert.equal((await unsupported.json()).code, 'unsupported-request-format');
    }
    assert.deepEqual(
      (await context.store.list(context.principal)).map(({ id }) => id),
      [original.id]
    );
  }
);

test(
  'a committed create is recovered before preparing another campaign even when a replacement backend has no creation catalog',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const command = {
      commandId: randomUUID(),
      options: { name: 'Committed before catalog loss', ruleset: '2014' },
    };
    const original = await context.store.create(context.principal, command);
    const replacement = context.createStore([]);
    assert.deepEqual(
      await replacement.create(context.principal, structuredClone(command)),
      original
    );
    assert.deepEqual(
      (await context.store.list(context.principal)).map(({ id }) => id),
      [original.id]
    );
  }
);

test(
  'one canonical scene save publishes its immutable reference, matching receipt and compact change before acknowledgement',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Atomic scene fixture', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState({ ruleset: '2014' }));
    const commandId = randomUUID();
    const receipt = await context.store.commitScene(context.principal, campaign.id, {
      commandId,
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    });
    assert.equal(receipt.revision, 1);
    assert.ok(Number.isFinite(Date.parse(receipt.savedAt)));
    const reopened = await context.createStore().readScene(context.principal, campaign.id);
    assert.equal(reopened.scene, scene);
    assert.equal(reopened.revision, 1);
    assert.equal(reopened.charactersRevision, 0);
    assert.equal(reopened.savedAt, receipt.savedAt);
    const state = await context.store.readCharacters(context.principal, campaign.id);
    assert.equal(state.scene, scene);
    assert.equal(state.sceneRevision, 1);
    assert.equal(state.revision, 0);
    assert.deepEqual(state.records, []);
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    const head = (await document.get()).data();
    assert.equal(head.generation, 2);
    assert.equal(head.campaign.sceneRevision, 1);
    assert.equal(head.sceneRef.kind, 'scene');
    assert.equal(head.charactersRef, null);
    assert.equal(Object.hasOwn(head, 'scene'), false);
    assert.equal(Object.hasOwn(head.campaign, 'scene'), false);
    const change = (await document.collection('changes').doc('2').get()).data();
    assert.deepEqual(
      {
        version: change.version,
        generation: change.generation,
        kind: change.kind,
        sceneRevision: change.sceneRevision,
        charactersRevision: change.charactersRevision,
      },
      { version: 1, generation: 2, kind: 'scene.commit', sceneRevision: 1, charactersRevision: 0 }
    );
    const savedReceipt = (
      await runtime.firestore
        .collection('accountCommands')
        .doc(pilotAccountKey(context.principal.uid))
        .collection('receipts')
        .doc(commandId)
        .get()
    ).data();
    assert.deepEqual(savedReceipt.result, receipt);
  }
);

test(
  'the existing character caller atomically saves a real canonical character and its linked scene through the cloud backend',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Joint character fixture', ruleset: '2014' },
    });
    const initial = await context.store.readCharacters(context.principal, campaign.id);
    const commandId = randomUUID();
    const library = new CampaignCharacters({
      ...initial,
      catalog: await context.catalog(campaign),
      store: {
        commitCharacters: (id, change) =>
          context.store.commitCharacters(context.principal, id, { commandId, change }),
      },
    });
    let captured;
    library.bindScene({
      capture(engine) {
        const character = engine.list()[0];
        const scene = sceneState({
          ruleset: '2014',
          characterId: character.id,
          name: character.name,
        });
        captured = JSON.stringify(scene);
        return { value: captured, scene };
      },
    });
    const characterId = await library.create('Aster');
    assert.equal(library.revision, 1);
    assert.equal(library.sceneRevision, 1);
    const reopened = await context.createStore().readCharacters(context.principal, campaign.id);
    assert.equal(reopened.revision, 1);
    assert.equal(reopened.sceneRevision, 1);
    assert.equal(reopened.scene, captured);
    const character = JSON.parse(
      reopened.records.find((row) => row.key === `taverntable.character.v1.${characterId}`).value
    );
    assert.equal(character.id, characterId);
    assert.equal(character.name, 'Aster');
    assert.equal(JSON.parse(reopened.scene).creatures[0].characterId, characterId);
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    const head = (await document.get()).data();
    assert.equal(head.generation, 2);
    assert.equal(head.charactersRef.kind, 'characters');
    assert.equal(head.sceneRef.kind, 'scene');
    const change = (await document.collection('changes').doc('2').get()).data();
    assert.equal(change.kind, 'characters.commit');
    assert.equal(change.charactersRevision, 1);
    assert.equal(change.sceneRevision, 1);
  }
);

test(
  'a scene command recovers its original receipt before any preparation and cannot change operation or intent',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Recover a durable scene', ruleset: '2014' },
    });
    const command = {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: JSON.stringify(sceneState()),
      },
    };
    const original = await context.store.commitScene(context.principal, campaign.id, command);
    const replacement = context.metadataOnlyStore();
    assert.deepEqual(
      await replacement.commitScene(context.principal, campaign.id, structuredClone(command)),
      original
    );
    const changed = structuredClone(command);
    const scene = JSON.parse(changed.change.scene);
    scene.creatures[0].name = 'A different intent';
    changed.change.scene = JSON.stringify(scene);
    await assert.rejects(replacement.commitScene(context.principal, campaign.id, changed), {
      status: 409,
      code: 'command-id-conflict',
    });
    await assert.rejects(
      replacement.commitCharacters(context.principal, campaign.id, {
        commandId: command.commandId,
        change: { ruleset: '2014', revision: 0, records: [] },
      }),
      { status: 409, code: 'command-id-conflict' }
    );
    const head = await runtime.firestore.collection('campaigns').doc(campaign.id).get();
    assert.equal(head.data().generation, 2);
    assert.equal(
      (await head.ref.collection('changes').where('kind', '==', 'scene.commit').get()).size,
      1
    );
  }
);

test(
  'two instances that finish real candidate uploads from the same head publish exactly one scene and one conflict',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Overlapping scene saves', ruleset: '2014' },
    });
    let arrivals = 0;
    let release;
    let reject;
    let fuse;
    const bothUploaded = new Promise((resolve, rejectPromise) => {
      release = resolve;
      reject = rejectPromise;
    });
    t.after(() => {
      if (fuse) clearTimeout(fuse);
    });
    const bucket = afterStorageUpload(runtime.bucket, async () => {
      if (!fuse)
        fuse = setTimeout(
          () => reject(new Error('Both real candidate uploads must reach the barrier')),
          10000
        );
      if (++arrivals === 2) {
        clearTimeout(fuse);
        release();
      }
      await bothUploaded;
    });
    const commands = ['First candidate', 'Second candidate'].map((name) => ({
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: JSON.stringify(sceneState({ name })),
      },
    }));
    const results = await Promise.allSettled(
      commands.map((command) =>
        context.createStore(undefined, bucket).commitScene(context.principal, campaign.id, command)
      )
    );
    assert.equal(arrivals, 2);
    const wins = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.status === 'fulfilled');
    const losses = results.filter((result) => result.status === 'rejected');
    assert.equal(wins.length, 1);
    assert.equal(losses.length, 1);
    assert.equal(losses[0].reason.status, 409);
    assert.equal(losses[0].reason.code, 'stale-revision');
    assert.deepEqual(losses[0].reason.current, { sceneRevision: 1, charactersRevision: 0 });
    const saved = await context.store.readScene(context.principal, campaign.id);
    assert.equal(saved.scene, commands[wins[0].index].change.scene);
    assert.equal(saved.revision, 1);
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    assert.equal((await document.get()).data().generation, 2);
    assert.equal(
      (await document.collection('changes').where('kind', '==', 'scene.commit').get()).size,
      1
    );
    for (let index = 0; index < commands.length; index++) {
      const receipt = await runtime.firestore
        .collection('accountCommands')
        .doc(pilotAccountKey(context.principal.uid))
        .collection('receipts')
        .doc(commands[index].commandId)
        .get();
      assert.equal(receipt.exists, index === wins[0].index);
    }
  }
);

test(
  'revocation after a real candidate upload prevents publication and cannot expose even the old campaign state',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Revoked during upload', ruleset: '2014' },
    });
    const eligibility = runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(context.principal.uid));
    const bucket = afterStorageUpload(runtime.bucket, () => eligibility.update({ enabled: false }));
    const command = {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: JSON.stringify(sceneState()),
      },
    };
    await assert.rejects(
      context.createStore(undefined, bucket).commitScene(context.principal, campaign.id, command),
      {
        status: 403,
        code: 'pilot-access-required',
      }
    );
    await assert.rejects(context.store.readScene(context.principal, campaign.id), {
      status: 403,
      code: 'pilot-access-required',
    });
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    const head = (await document.get()).data();
    assert.equal(head.generation, 1);
    assert.equal(head.sceneRef, null);
    assert.equal((await document.collection('changes').get()).size, 0);
    const receipt = await runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(context.principal.uid))
      .collection('receipts')
      .doc(command.commandId)
      .get();
    assert.equal(receipt.exists, false);
    assert.equal(
      (await runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/objects/` }))[0].length,
      1
    );
    await eligibility.update({ enabled: true });
    const previous = await context.store.readScene(context.principal, campaign.id);
    assert.equal(previous.revision, 0);
    assert.equal(previous.scene, null);
  }
);

test(
  'an uncertain upload failure leaves no published head or receipt and the same command recovers exactly once',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Upload acknowledgement lost', ruleset: '2014' },
    });
    const command = {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: JSON.stringify(sceneState()),
      },
    };
    const bucket = afterStorageUpload(runtime.bucket, async () => {
      throw Object.assign(new Error('PRIVATE UPLOAD FAILURE DETAILS'), { code: 503 });
    });
    await assert.rejects(
      context.createStore(undefined, bucket).commitScene(context.principal, campaign.id, command),
      (error) =>
        error.status === 503 &&
        error.code === 'snapshot-storage-unavailable' &&
        !error.message.includes('PRIVATE UPLOAD FAILURE DETAILS')
    );
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    assert.equal((await document.get()).data().generation, 1);
    assert.equal((await document.get()).data().sceneRef, null);
    const receiptRef = runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(context.principal.uid))
      .collection('receipts')
      .doc(command.commandId);
    assert.equal((await receiptRef.get()).exists, false);
    assert.equal((await document.collection('changes').get()).size, 0);
    const recovered = await context.store.commitScene(
      context.principal,
      campaign.id,
      structuredClone(command)
    );
    assert.equal(recovered.revision, 1);
    assert.deepEqual((await receiptRef.get()).data().result, recovered);
    assert.deepEqual(
      await context
        .metadataOnlyStore()
        .commitScene(context.principal, campaign.id, structuredClone(command)),
      recovered
    );
    assert.equal((await document.get()).data().generation, 2);
    assert.equal((await document.collection('changes').get()).size, 1);
    assert.equal(
      (await runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/objects/` }))[0].length,
      1
    );
  }
);

test(
  'a real Firestore commit precondition failure rolls back head and receipt together with the compact change',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Atomic server rejection', ruleset: '2014' },
    });
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    const marker = document.collection('changes').doc('2');
    await marker.create({ fixture: 'force a real create precondition failure' });
    const command = {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: JSON.stringify(sceneState()),
      },
    };
    await assert.rejects(context.store.commitScene(context.principal, campaign.id, command), {
      code: 6,
    });
    const head = (await document.get()).data();
    assert.equal(head.generation, 1);
    assert.equal(head.sceneRef, null);
    assert.equal((await marker.get()).data().fixture, 'force a real create precondition failure');
    const receipt = runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(context.principal.uid))
      .collection('receipts')
      .doc(command.commandId);
    assert.equal((await receipt.get()).exists, false);
    assert.equal((await context.store.readScene(context.principal, campaign.id)).scene, null);
    await marker.delete();
    const committed = await context.store.commitScene(
      context.principal,
      campaign.id,
      structuredClone(command)
    );
    assert.equal(committed.revision, 1);
    assert.deepEqual((await receipt.get()).data().result, committed);
    assert.equal((await document.get()).data().generation, 2);
    assert.equal((await document.collection('changes').get()).size, 1);
  }
);

test(
  'concurrent identical save commands across backend instances return one durable result without another revision or marker',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Concurrent same command', ruleset: '2014' },
    });
    const command = {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: JSON.stringify(sceneState()),
      },
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        context.createStore().commitScene(context.principal, campaign.id, structuredClone(command))
      )
    );
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal(results[0].revision, 1);
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    assert.equal((await document.get()).data().generation, 2);
    assert.equal((await document.collection('changes').get()).size, 1);
    assert.equal(
      (await runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/objects/` }))[0].length,
      1
    );
  }
);

test(
  'an unrelated approved UID cannot read committed snapshots or stage scene/character writes for the owner',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await campaignContext(runtime);
    t.after(() => owner.close());
    const unrelated = await campaignContext(runtime);
    t.after(() => unrelated.close());
    const campaign = await owner.store.create(owner.principal, {
      commandId: randomUUID(),
      options: { name: 'Private committed state', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState({ name: 'Private owner fixture' }));
    await owner.store.commitScene(owner.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    });
    const denied = { status: 404, code: 'campaign-not-found' };
    await assert.rejects(unrelated.store.readCharacters(unrelated.principal, campaign.id), denied);
    await assert.rejects(unrelated.store.readScene(unrelated.principal, campaign.id), denied);
    await assert.rejects(
      unrelated.store.commitScene(unrelated.principal, campaign.id, {
        commandId: randomUUID(),
        change: { ruleset: '2014', revision: 1, charactersRevision: 0, scene },
      }),
      denied
    );
    await assert.rejects(
      unrelated.store.commitCharacters(unrelated.principal, campaign.id, {
        commandId: randomUUID(),
        change: { ruleset: '2014', revision: 0, records: [] },
      }),
      denied
    );
    assert.equal((await owner.store.readScene(owner.principal, campaign.id)).scene, scene);
    assert.equal(
      (await runtime.firestore.collection('campaigns').doc(campaign.id).get()).data().generation,
      2
    );
    assert.equal(
      (await runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/objects/` }))[0].length,
      1
    );
  }
);

test(
  'ruleset, scene-link, terrain and character-record validation happens before any upload or durable mutation',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Reject invalid canonical data', ruleset: '2014' },
    });
    const invalidTerrain = sceneState();
    invalidTerrain.terrain.heights[0].pop();
    const scenes = [
      { ruleset: '2024', scene: JSON.stringify(sceneState({ ruleset: '2024' })) },
      { ruleset: '2014', scene: '{"private":"REDACTION-CANARY"' },
      { ruleset: '2014', scene: JSON.stringify(sceneState({ characterId: randomUUID() })) },
      { ruleset: '2014', scene: JSON.stringify(invalidTerrain) },
    ];
    for (const change of scenes)
      await assert.rejects(
        context.store.commitScene(context.principal, campaign.id, {
          commandId: randomUUID(),
          change: { revision: 0, charactersRevision: 0, ...change },
        }),
        (error) =>
          error.status === 400 &&
          error.code === 'invalid-campaign-change' &&
          !error.message.includes('REDACTION-CANARY')
      );
    const key = `taverntable.character.v1.${randomUUID()}`;
    const invalidRecords = [
      null,
      [{ key, value: 'PRIVATE-REDACTION-CANARY{' }],
      [{ key: `taverntable.character-rest.v1.${randomUUID()}`, value: '{}' }],
      [
        { key, value: '{}' },
        { key, value: '{}' },
      ],
    ];
    for (const records of invalidRecords)
      await assert.rejects(
        context.store.commitCharacters(context.principal, campaign.id, {
          commandId: randomUUID(),
          change: { ruleset: '2014', revision: 0, records },
        }),
        (error) =>
          error.status === 400 &&
          error.code === 'invalid-campaign-change' &&
          !error.message.includes('REDACTION-CANARY')
      );
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    assert.equal((await document.get()).data().generation, 1);
    assert.equal((await document.collection('changes').get()).size, 0);
    assert.equal(
      (
        await runtime.firestore
          .collection('accountCommands')
          .doc(pilotAccountKey(context.principal.uid))
          .collection('receipts')
          .get()
      ).size,
      1
    );
    assert.equal(
      (await runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/objects/` }))[0].length,
      0
    );
  }
);

test(
  'a 2024 between-game character edit preserves and reuses the unchanged scene object and its revision',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: '2024 quiet editing', ruleset: '2024' },
    });
    const scene = JSON.stringify(sceneState({ ruleset: '2024' }));
    const sceneReceipt = await context.store.commitScene(context.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2024', revision: 0, charactersRevision: 0, scene },
    });
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    const previousReference = (await document.get()).data().sceneRef;
    const state = await context.store.readCharacters(context.principal, campaign.id);
    const library = new CampaignCharacters({
      ...state,
      catalog: await context.catalog(campaign),
      store: {
        commitCharacters: (id, change) =>
          context.store.commitCharacters(context.principal, id, {
            commandId: randomUUID(),
            change,
          }),
      },
    });
    const characterId = await library.create('2024 keeper');
    const current = await context.createStore().readCharacters(context.principal, campaign.id);
    assert.equal(current.campaign.ruleset, '2024');
    assert.deepEqual(current.campaign.sourcePacks, campaign.sourcePacks);
    assert.equal(current.revision, 1);
    assert.equal(current.sceneRevision, 1);
    assert.equal(current.sceneSavedAt, sceneReceipt.savedAt);
    assert.equal(current.scene, scene);
    assert.ok(current.records.some((row) => row.key === `taverntable.character.v1.${characterId}`));
    const head = (await document.get()).data();
    assert.equal(head.generation, 3);
    assert.deepEqual(head.sceneRef, previousReference);
    assert.equal(head.charactersRef.kind, 'characters');
    assert.equal(
      (await runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/objects/` }))[0].length,
      2
    );
  }
);

test(
  'real HTTP saves preserve large scene bytes, joint revisions, typed conflicts and bearer-only private access',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await campaignContext(runtime);
    t.after(() => owner.close());
    const unrelated = await campaignContext(runtime);
    t.after(() => unrelated.close());
    const campaign = await owner.store.create(owner.principal, {
      commandId: randomUUID(),
      options: { name: 'HTTP durable state', ruleset: '2014' },
    });
    const api = await owner.openApi();
    t.after(() => api.close());
    const headers = {
      Authorization: owner.authorization,
      Origin: api.origin,
      'Content-Type': 'application/json',
    };
    const url = `${api.url}/api/cloud/campaigns/${campaign.id}`;
    const scene = JSON.stringify(sceneState()) + ' '.repeat(1100000);
    assert.ok(Buffer.byteLength(scene) > 1024 * 1024);
    const command = {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    };
    const saved = await fetch(`${url}/scene`, {
      method: 'POST',
      headers,
      body: JSON.stringify(command),
    });
    assert.equal(saved.status, 200);
    const receipt = (await saved.json()).result;
    assert.equal(receipt.revision, 1);
    const loaded = await fetch(`${url}/scene`, { headers });
    assert.equal(loaded.status, 200);
    assert.ok(
      (await loaded.json()).result.scene === scene,
      'The complete large scene must be returned'
    );
    const document = runtime.firestore.collection('campaigns').doc(campaign.id);
    assert.ok(Buffer.byteLength(JSON.stringify((await document.get()).data())) < 16384);
    const changedScene = JSON.stringify(sceneState({ name: 'Updated over HTTP' }));
    const joint = await fetch(`${url}/characters`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandId: randomUUID(),
        change: {
          ruleset: '2014',
          revision: 0,
          records: [],
          scene: { revision: 1, value: changedScene },
        },
      }),
    });
    assert.equal(joint.status, 200);
    const jointReceipt = (await joint.json()).result;
    assert.equal(jointReceipt.revision, 1);
    assert.equal(jointReceipt.sceneRevision, 2);
    const stale = await fetch(`${url}/scene`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...command, commandId: randomUUID() }),
    });
    assert.equal(stale.status, 409);
    const conflict = await stale.json();
    assert.equal(conflict.code, 'stale-revision');
    assert.deepEqual(conflict.current, { sceneRevision: 2, charactersRevision: 1 });
    const denied = await fetch(`${url}/scene`, {
      method: 'POST',
      headers: { ...headers, Authorization: unrelated.authorization },
      body: JSON.stringify({
        commandId: randomUUID(),
        change: {
          ruleset: '2014',
          revision: 2,
          charactersRevision: 1,
          scene: changedScene,
        },
      }),
    });
    assert.equal(denied.status, 404);
    assert.equal((await denied.json()).code, 'campaign-not-found');
    const anonymous = await fetch(`${url}/scene`, {
      method: 'POST',
      headers: {
        Origin: api.origin,
        'Content-Type': 'application/json',
        Cookie: 'local-host-cookie=not-cloud-authority',
      },
      body: JSON.stringify(command),
    });
    assert.equal(anonymous.status, 401);
    const preflight = await fetch(`${url}/scene`, {
      method: 'OPTIONS',
      headers: { Origin: api.origin },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
  }
);

test(
  'a malformed durable create result fails closed without acknowledging invalid metadata or creating another campaign',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const command = {
      commandId: randomUUID(),
      options: { name: 'Validate durable results', ruleset: '2014' },
    };
    const campaign = await context.store.create(context.principal, command);
    const receipt = runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(context.principal.uid))
      .collection('receipts')
      .doc(command.commandId);
    for (const result of [
      { ...campaign, name: 42 },
      { ...campaign, sourcePacks: [] },
      { ...campaign, createdAt: 'invalid' },
    ]) {
      await receipt.update({ result });
      await assert.rejects(
        context.metadataOnlyStore().create(context.principal, structuredClone(command)),
        {
          status: 503,
          code: 'invalid-command-receipt',
        }
      );
    }
    assert.deepEqual(
      (await context.store.list(context.principal)).map(({ id }) => id),
      [campaign.id]
    );
    assert.equal(
      (await runtime.firestore.collection('campaigns').doc(campaign.id).get()).data().generation,
      1
    );
  }
);

for (const ruleset of ['2014', '2024'])
  test(
    `canonical ${ruleset} cloud checkpoints preserve doors, physical positions and committed turns through settings changes`,
    { timeout: 30000 },
    async (t) => {
      const runtime = await createEmulatorRuntime();
      t.after(() => runtime.close());
      const context = await campaignContext(runtime);
      t.after(() => context.close());
      const api = await context.openApi();
      t.after(() => api.close());
      const client = context.client(api);
      const campaign = await client.create({ name: 'Complete canonical world fixture', ruleset });
      const library = await CampaignCharacters.open({
        store: client,
        campaignId: campaign.id,
        catalog: await context.catalog(campaign),
      });
      for (const name of ['Pathfinder', 'Lower lookout', 'Upper lookout'])
        await library.create(name);
      const validation = { library, ruleset };
      const world = CampaignWorld.fromScene(
        createTwoFloorTravelScene({
          ruleset,
          characters: library.list(),
        }),
        validation
      );
      const checkpoint = world.save();
      checkpoint.creatures[0].gridX = 9;
      checkpoint.creatures[0].pose.world.x = 9.5;
      checkpoint.creatures[0].movement.mode = 'run';
      checkpoint.creatures[0].facingAngle = Math.PI / 2;
      const combat = new CombatSession({ library: library.engine });
      const actor = {
        ...checkpoint.creatures[0],
        characterSheetId: checkpoint.creatures[0].characterId,
      };
      combat.startTurn(actor);
      combat.adjustMovement(actor, 20);
      checkpoint.combat = combat.snapshot();
      world.acceptCheckpoint(checkpoint);
      world.setDoorState('building-door', { open: false, locked: true });
      const scene = encodeScene(world.save(), validation);
      const command = {
        commandId: randomUUID(),
        change: { ruleset, revision: 0, charactersRevision: library.revision, scene },
      };
      const original = await context.store.commitScene(context.principal, campaign.id, command);
      const before = await client.readCharacters(campaign.id);
      const settings = await client.getSettings(campaign.id);
      await client.update(campaign.id, { name: 'Still the same world', packIds: [] }, settings);
      const reopened = await context.createStore().readCharacters(context.principal, campaign.id);
      assert.equal(reopened.campaign.ruleset, ruleset);
      assert.equal(reopened.campaign.coreVersion, campaign.coreVersion);
      assert.equal(reopened.scene, scene);
      assert.deepEqual(reopened.records, before.records);
      const saved = decodeScene(reopened.scene, validation);
      assert.deepEqual(saved.creatures, world.save().creatures);
      assert.deepEqual(saved.maps, world.save().maps);
      assert.deepEqual(saved.combat, checkpoint.combat);
      assert.deepEqual(saved.view, world.save().view);
      assert.deepEqual(saved.connections, world.save().connections);
      assert.equal(
        saved.connections.find((connection) => connection.id === 'building-door').locked,
        true
      );
      assert.equal(saved.creatures[0].movement.mode, 'run');
      assert.deepEqual(
        await context.metadataOnlyStore().commitScene(context.principal, campaign.id, command),
        original
      );
    }
  );

test(
  'current version-three connected-map checkpoints preserve canonical map transforms, actor IDs and view state',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const campaign = await context.store.create(context.principal, {
      commandId: randomUUID(),
      options: { name: 'Current connected maps', ruleset: '2014' },
    });
    const state = await context.store.readCharacters(context.principal, campaign.id);
    const library = new CampaignCharacters({ ...state, catalog: await context.catalog(campaign) });
    const validation = { library, ruleset: campaign.ruleset };
    const legacy = sceneState();
    const world = CampaignWorld.fromScene(legacy, validation);
    world.addMap({
      id: 'map-upper',
      name: 'Upper map',
      originFeet: { x: 50, y: 10, z: -10 },
      quarterTurns: 1,
      base: 'floor',
      grid: legacy.grid,
      terrain: {
        ...legacy.terrain,
        heights: legacy.terrain.heights.map((row) => row.map(() => 0)),
      },
    });
    const canonical = world.save();
    assert.equal(canonical.version, 3);
    const scene = encodeScene(canonical, validation);
    await context.store.commitScene(context.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    });
    const reopened = await context.createStore().readScene(context.principal, campaign.id);
    assert.equal(reopened.scene, scene);
    const decoded = decodeScene(reopened.scene, validation);
    assert.equal(decoded.maps.length, 2);
    assert.deepEqual(decoded.maps.find((map) => map.id === 'map-upper').originFeet, {
      x: 50,
      y: 10,
      z: -10,
    });
    assert.equal(decoded.maps.find((map) => map.id === 'map-upper').quarterTurns, 1);
    assert.equal(decoded.creatures[0].id, canonical.creatures[0].id);
    assert.equal(decoded.creatures[0].mapId, 'map-main');
    assert.deepEqual(decoded.view, canonical.view);
  }
);
