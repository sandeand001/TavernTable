const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  createEmulatorRuntime,
  readEmulatorEnvironment,
} = require('../../tools/cloud/emulator-runtime.js');
const sdk = require('firebase/auth');
const { default: CloudAccount } = require('../../src/campaigns/CloudAccount.js');
const {
  default: CloudAccountConnection,
} = require('../../src/campaigns/CloudAccountConnection.js');
const {
  default: CloudCampaignClientStore,
} = require('../../src/campaigns/CloudCampaignClientStore.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { PrivateCampaignAssets } = require('../../tools/cloud/campaign-assets.js');
const { HostResources } = require('../../tools/host-resources.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');
const { sceneState } = require('../helpers/sceneState.js');
const { createCanvas } = require('canvas');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');
const { default: CampaignStore } = require('../../src/campaigns/CampaignStore.js');
const { default: CampaignWorld } = require('../../src/campaigns/CampaignWorld.js');
const { encodeScene } = require('../../src/campaigns/CampaignScene.js');
const sharp = require('sharp');

async function fixture(t) {
  const runtime = await createEmulatorRuntime();
  t.after(() => runtime.close());
  const identity = await signedInIdentity(runtime);
  t.after(() => identity.close());
  await runtime.firestore
    .collection('pilotAccounts')
    .doc(pilotAccountKey(identity.uid))
    .create({ version: 1, uid: identity.uid, enabled: true });
  const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
  const principal = await access.verifyAuthorization('Bearer ' + identity.token);
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(__dirname, '..', '..', 'assets', 'data', 'resources', 'manifest.json'),
      'utf8'
    )
  );
  const resources = new HostResources({ root: path.join(__dirname, '..', '..'), manifest });
  const createStore = (now = Date.now) =>
    new CloudCampaignStore({
      firestore: runtime.firestore,
      access,
      packs: manifest.packs,
      resources,
      objects: new ImmutableCloudObjects({ bucket: runtime.bucket }),
      assets: new PrivateCampaignAssets({ bucket: runtime.bucket }),
      now,
    });
  const store = createStore();
  const api = await cloudApi({ access, store });
  t.after(() => api.close());
  const clients = [];
  t.after(() => {
    for (const client of clients) client.close();
  });
  const client = (fetch = globalThis.fetch) => {
    const config = readEmulatorEnvironment();
    const result = new CloudCampaignClientStore({
      uid: identity.uid,
      packs: manifest.packs,
      connection: new CloudAccountConnection({
        account: new CloudAccount({ auth: identity.auth, sdk }),
        fetch,
        baseURL: api.url + '/',
        runtime: {
          version: 1,
          mode: 'cloud',
          environment: 'emulator',
          apiOrigin: api.url,
          authEmulatorOrigin: `http://${config.authHost}`,
          firebase: {
            apiKey: 'demo-api-key',
            projectId: config.projectId,
            authDomain: `${config.projectId}.firebaseapp.com`,
            appId: 'demo-portability-client',
          },
        },
      }),
    });
    clients.push(result);
    return result;
  };
  return {
    runtime,
    identity,
    access,
    principal,
    manifest,
    resources,
    store,
    createStore,
    api,
    client,
  };
}

test(
  'failed final publication rolls back campaign ownership, head and receipt while the original import remains recoverable',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Atomic import publication', ruleset: '2014' },
    });
    const text = await f.store.exportBackup(f.principal, source.id);
    let marker = null;
    let targetId;
    const client = f.client(async (url, options) => {
      const response = await fetch(url, options);
      if (url.endsWith('/imports') && marker === null) {
        const ticket = (await response.clone().json()).result;
        targetId = ticket.campaignId;
        marker = f.runtime.firestore
          .collection('campaigns')
          .doc(targetId)
          .collection('changes')
          .doc('1');
        await marker.create({ fixture: 'Force the final real transaction to roll back' });
      }
      return response;
    });
    let stop = () => {};
    const uncertain = new Promise((resolve) => {
      stop = client.subscribeSave((state) => {
        if (state.phase === 'uncertain') resolve();
      });
    });
    const pending = client.importBackup(text);
    await uncertain;
    stop();
    const importId = client.saveState.commandId;
    assert.equal(
      (await f.runtime.firestore.collection('campaigns').doc(targetId).get()).exists,
      false
    );
    assert.equal(
      (
        await f.runtime.firestore
          .collection('accountCommands')
          .doc(pilotAccountKey(f.identity.uid))
          .collection('receipts')
          .doc(importId)
          .get()
      ).exists,
      false
    );
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    assert.equal((await usage.get()).data().ownedCampaigns, 1);
    const journal = f.runtime.firestore
      .collection('accountImports')
      .doc(pilotAccountKey(f.identity.uid))
      .collection('transfers')
      .doc(importId);
    assert.equal((await journal.get()).data().state, 'uploading');
    await marker.delete();
    const result = await client.retryPending();
    assert.deepEqual(await pending, result);
    assert.equal(result.id, targetId);
    assert.equal((await usage.get()).data().ownedCampaigns, 2);
    assert.equal((await journal.get()).data().state, 'complete');
  }
);

test(
  'missing intent claims and expired staging cannot acquire new bytes or publish a campaign',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    let time = Date.now();
    const store = f.createStore(() => time);
    const source = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Fenced import source', ruleset: '2014' },
    });
    const bytes = Buffer.from(await store.exportBackup(f.principal, source.id));
    const command = {
      commandId: randomUUID(),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const ticket = await store.startImport(f.principal, command);
    const claimReference = f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(f.identity.uid))
      .collection('claims')
      .doc(command.commandId);
    const claim = (await claimReference.get()).data();
    await claimReference.delete();
    await assert.rejects(store.startImport(f.principal, command), { code: 'invalid-import-state' });
    await assert.rejects(
      store.uploadImportChunk(f.principal, ticket.importId, {
        index: 0,
        data: bytes.toString('base64'),
      }),
      { code: 'invalid-import-state' }
    );
    assert.equal(
      (await f.runtime.bucket.getFiles({ prefix: `campaigns/${ticket.campaignId}/` }))[0].length,
      0
    );
    await claimReference.create(claim);
    await store.uploadImportChunk(f.principal, ticket.importId, {
      index: 0,
      data: bytes.toString('base64'),
    });
    time += 24 * 60 * 60 * 1000 + 1;
    await assert.rejects(
      store.finishImport(f.principal, ticket.importId, { commandId: ticket.importId }),
      {
        code: 'import-expired',
      }
    );
    assert.equal(
      (await f.runtime.firestore.collection('campaigns').doc(ticket.campaignId).get()).exists,
      false
    );
  }
);

test(
  'an exactly 128,000,000-byte complete file imports while one additional byte is rejected before upload',
  { timeout: 180000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Maximum complete file', ruleset: '2014' },
    });
    const prefix = await f.store.exportBackup(f.principal, source.id);
    const text = prefix + ' '.repeat(128000000 - Buffer.byteLength(prefix));
    assert.equal(Buffer.byteLength(text), 128000000);
    let largestRequest = 0;
    const client = f.client(async (url, options) => {
      if (options.body !== undefined)
        largestRequest = Math.max(largestRequest, Buffer.byteLength(options.body));
      return fetch(url, options);
    });
    const imported = await client.importBackup(text);
    assert.equal(imported.charactersRevision, 1);
    assert.deepEqual((await f.store.readCharacters(f.principal, imported.id)).records, []);
    await assert.rejects(client.importBackup(text + ' '), {
      status: 413,
      code: 'backup-too-large',
    });
    assert.equal((await f.store.list(f.principal)).length, 2);
    assert.ok(largestRequest <= 24 * 1024 * 1024);
    console.log(
      JSON.stringify({ maximumFileBytes: 128000000, rejectedFileBytes: 128000001, largestRequest })
    );
  }
);

test(
  'an image-heavy multi-map campaign larger than 32 MiB round-trips with bounded requests and a streamed response',
  { timeout: 180000 },
  async (t) => {
    const f = await fixture(t);
    let campaignRecord;
    let records = [];
    const local = new CampaignStore({
      packs: f.manifest.packs,
      storage: {
        transaction: async (_mode, operation) =>
          operation({
            getCampaign: () => ({ ...campaignRecord }),
            writeCampaign: (value) => {
              campaignRecord = { ...value };
            },
            readCharacters: () => records,
            replaceCharacters: (_id, value) => {
              records = value.map((row) => ({ ...row }));
            },
          }),
        close() {},
      },
    });
    t.after(() => local.close());
    const campaign = await local.create({ name: 'Large portable world', ruleset: '2014' });
    const catalog = await f.resources.catalog(campaign);
    const library = await CampaignCharacters.open({
      store: local,
      campaignId: campaign.id,
      catalog,
    });
    const image = await sharp(randomBytes(499 * 499 * 3), {
      raw: { width: 499, height: 499, channels: 3 },
    })
      .png({ compressionLevel: 0 })
      .toBuffer();
    const uri = 'data:image/png;base64,' + image.toString('base64');
    assert.ok(uri.length <= 1000000);
    const ids = [];
    for (let index = 0; index < 16; index++) {
      const id = await library.create('Large campaign scout ' + index);
      ids.push(id);
      await library.edit(id, { portraitImage: uri, artworkImage: uri });
    }
    const validation = { library, ruleset: '2014' };
    const legacy = sceneState({
      ruleset: '2014',
      characterId: ids[0],
      name: 'Large campaign scout 0',
    });
    const world = CampaignWorld.fromScene(legacy, validation);
    const saved = world.save();
    for (let index = 0; index < 24; index++)
      saved.maps.push({
        id: 'large-map-' + index,
        name: 'Large saved terrain ' + index,
        originFeet: { x: 1000 * (index + 1), y: 0, z: 0 },
        quarterTurns: 0,
        base: 'ground',
        grid: { cols: 100, rows: 100, tileWorldSize: 1 },
        terrain: {
          ...legacy.terrain,
          heights: Array.from({ length: 100 }, (_, row) =>
            Array.from({ length: 100 }, (_, column) => Math.sin(row * 100 + column + index) * 5)
          ),
        },
      });
    const scene = encodeScene(saved, validation);
    await local.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: library.revision,
      scene,
    });
    const source = await local.readCharacters(campaign.id);
    const text = await local.exportBackup(campaign.id);
    const fileBytes = Buffer.byteLength(text, 'utf8');
    assert.ok(
      fileBytes > 32 * 1024 * 1024,
      'The actual complete campaign must cross the Cloud Run non-streamed response limit'
    );
    assert.ok(
      Buffer.byteLength(
        JSON.stringify({ version: 1, kind: 'characters', value: source.records })
      ) <=
        32 * 1024 * 1024
    );
    let largestRequest = 0;
    let responseStreamed = false;
    const client = f.client(async (url, options) => {
      if (options.body !== undefined)
        largestRequest = Math.max(largestRequest, Buffer.byteLength(options.body));
      const response = await fetch(url, options);
      if (url.endsWith('/backup')) {
        assert.equal(response.headers.get('content-length'), null);
        responseStreamed = response.headers.get('transfer-encoding') === 'chunked';
      }
      return response;
    });
    const imported = await client.importBackup(text);
    const state = await f.store.readCharacters(f.principal, imported.id);
    assert.deepEqual(state.records, source.records);
    assert.equal(state.scene, scene);
    assert.equal(JSON.parse(state.scene).maps.length, 25);
    const exported = JSON.parse(await client.exportBackup(imported.id));
    assert.deepEqual(exported.records, source.records);
    assert.equal(exported.scene, scene);
    assert.ok(largestRequest <= 24 * 1024 * 1024);
    assert.equal(responseStreamed, true);
    const images = await f.store.getAssetManifest(f.principal, imported.id);
    assert.equal(images.images.length, 32);
    assert.equal(new Set(images.images.map((entry) => entry.reference.sha256)).size, 1);
    console.log(
      JSON.stringify({
        fileBytes,
        largestRequest,
        maps: 25,
        characters: ids.length,
        responseStreamed,
      })
    );
  }
);

test(
  'import file and raw-chunk boundaries are exact and another UID cannot use a pending transfer',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Bounded file source', ruleset: '2014' },
    });
    const prefix = await f.store.exportBackup(f.principal, source.id);
    const text = prefix + ' '.repeat(1024 * 1024 + 2 - Buffer.byteLength(prefix));
    const bytes = Buffer.from(text);
    const command = {
      commandId: randomUUID(),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const ticket = await f.store.startImport(f.principal, command);
    const other = await signedInIdentity(f.runtime);
    t.after(() => other.close());
    await f.runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(other.uid))
      .create({ version: 1, uid: other.uid, enabled: true });
    const principal = await f.access.verifyAuthorization('Bearer ' + other.token);
    await assert.rejects(
      f.store.uploadImportChunk(principal, ticket.importId, {
        index: 0,
        data: bytes.subarray(0, 1024 * 1024).toString('base64'),
      }),
      { code: 'import-not-found' }
    );
    await assert.rejects(
      f.store.finishImport(principal, ticket.importId, {
        commandId: ticket.importId,
      }),
      { code: 'import-not-found' }
    );
    assert.equal(
      (await f.runtime.firestore.collection('accountUsage').doc(pilotAccountKey(other.uid)).get())
        .exists,
      false
    );
    await assert.rejects(
      f.store.uploadImportChunk(f.principal, ticket.importId, {
        index: 0,
        data: bytes.subarray(0, 1024 * 1024 + 1).toString('base64'),
      }),
      { status: 413, code: 'import-chunk-too-large' }
    );
    for (let index = 0; index < 2; index++)
      await f.store.uploadImportChunk(f.principal, ticket.importId, {
        index,
        data: bytes.subarray(index * 1024 * 1024, (index + 1) * 1024 * 1024).toString('base64'),
      });
    await f.store.finishImport(f.principal, ticket.importId, { commandId: ticket.importId });
    const maximum = { commandId: randomUUID(), bytes: 128000000, sha256: '1'.repeat(64) };
    assert.equal((await f.store.startImport(f.principal, maximum)).bytes, 128000000);
    await assert.rejects(
      f.store.startImport(f.principal, {
        ...maximum,
        commandId: randomUUID(),
        bytes: 128000001,
      }),
      { status: 413, code: 'backup-too-large' }
    );
  }
);

test(
  'concurrent imports cannot exceed campaign slots and storage rejection never publishes a partial target',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Quota import source', ruleset: '2014' },
    });
    const before = await f.store.readCharacters(f.principal, source.id);
    const bytes = Buffer.from(await f.store.exportBackup(f.principal, source.id));
    const commands = Array.from({ length: 3 }, () => ({
      commandId: randomUUID(),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    }));
    const tickets = [];
    for (const command of commands) {
      const ticket = await f.store.startImport(f.principal, command);
      tickets.push(ticket);
      await f.store.uploadImportChunk(f.principal, ticket.importId, {
        index: 0,
        data: bytes.toString('base64'),
      });
    }
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    const previousUsage = (await usage.get()).data();
    await usage.update({ storageBytes: 20 * 1024 ** 3 });
    await assert.rejects(
      f.store.finishImport(f.principal, tickets[2].importId, {
        commandId: tickets[2].importId,
      }),
      { code: 'import-storage-limit-reached' }
    );
    assert.equal(
      (await f.runtime.firestore.collection('campaigns').doc(tickets[2].campaignId).get()).exists,
      false
    );
    await usage.update({ storageBytes: previousUsage.storageBytes });
    for (let index = 0; index < 8; index++)
      await f.store.create(f.principal, {
        commandId: randomUUID(),
        options: { name: 'Other owned campaign ' + index, ruleset: '2014' },
      });
    const results = await Promise.allSettled(
      tickets
        .slice(0, 2)
        .map((ticket) =>
          f.createStore().finishImport(f.principal, ticket.importId, { commandId: ticket.importId })
        )
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((result) => result.status === 'rejected').reason.code,
      'import-campaign-limit-reached'
    );
    assert.equal((await f.store.list(f.principal)).length, 10);
    assert.equal((await usage.get()).data().ownedCampaigns, 10);
    assert.deepEqual(await f.store.readCharacters(f.principal, source.id), before);
  }
);

test(
  'corrupt imported images reject the original browser caller instead of leaving it permanently pending',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Corrupt image import', ruleset: '2014' },
    });
    const library = await CampaignCharacters.open({
      campaignId: source.id,
      catalog: await f.resources.catalog(source),
      store: {
        readCharacters: (id) => f.store.readCharacters(f.principal, id),
        commitCharacters: (id, change) =>
          f.store.commitCharacters(f.principal, id, { commandId: randomUUID(), change }),
      },
    });
    await library.create('Preserved image owner');
    const before = await f.store.readCharacters(f.principal, source.id);
    const backup = JSON.parse(await f.store.exportBackup(f.principal, source.id));
    const record = backup.records.find((row) => row.key.startsWith('taverntable.character.v1.'));
    const character = JSON.parse(record.value);
    character.portraitImage =
      'data:image/png;base64,' +
      createCanvas(2, 2).toBuffer('image/png').subarray(0, 40).toString('base64');
    record.value = JSON.stringify(character);
    const client = f.client();
    await assert.rejects(client.importBackup(JSON.stringify(backup)), {
      code: 'import-invalid-image',
    });
    assert.equal(client.saveState.phase, 'failed');
    assert.equal((await f.store.list(f.principal)).length, 1);
    assert.deepEqual(await f.store.readCharacters(f.principal, source.id), before);
  }
);

for (const fault of ['invalid-json', 'wrong-edition', 'wrong-checksum'])
  test(
    `a ${fault} import closes its intent without publishing a partial campaign`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const source = await f.store.create(f.principal, {
        commandId: randomUUID(),
        options: { name: 'Preserved before rejected import', ruleset: '2014' },
      });
      const before = await f.store.readCharacters(f.principal, source.id);
      let text = await f.store.exportBackup(f.principal, source.id);
      if (fault === 'invalid-json') text = text.slice(0, -1);
      if (fault === 'wrong-edition') {
        const data = JSON.parse(text);
        data.campaign.ruleset = '2024';
        text = JSON.stringify(data);
      }
      const bytes = Buffer.from(text, 'utf8');
      const command = {
        commandId: randomUUID(),
        bytes: bytes.length,
        sha256:
          fault === 'wrong-checksum'
            ? '0'.repeat(64)
            : createHash('sha256').update(bytes).digest('hex'),
      };
      const ticket = await f.store.startImport(f.principal, command);
      await f.store.uploadImportChunk(f.principal, ticket.importId, {
        index: 0,
        data: bytes.toString('base64'),
      });
      await assert.rejects(
        f.store.finishImport(f.principal, ticket.importId, { commandId: ticket.importId }),
        {
          code: 'import-rejected',
        }
      );
      const journal = (
        await f.runtime.firestore
          .collection('accountImports')
          .doc(pilotAccountKey(f.identity.uid))
          .collection('transfers')
          .doc(ticket.importId)
          .get()
      ).data();
      assert.equal(journal.state, 'failed');
      assert.equal(
        (await f.runtime.firestore.collection('campaigns').doc(ticket.campaignId).get()).exists,
        false
      );
      assert.equal((await f.store.list(f.principal)).length, 1);
      assert.deepEqual(await f.store.readCharacters(f.principal, source.id), before);
      await assert.rejects(f.createStore().startImport(f.principal, command), {
        code: 'import-rejected',
      });
    }
  );

for (const stage of ['start', 'parts', 'finish'])
  test(
    `a lost ${stage} reply retains one original import caller and resumes without duplicate publication or chunk uploads`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const source = await f.store.create(f.principal, {
        commandId: randomUUID(),
        options: { name: 'Recoverable import ' + stage, ruleset: '2014' },
      });
      const text = await f.store.exportBackup(f.principal, source.id);
      const requests = [];
      let discarded = false;
      const client = f.client(async (url, options) => {
        const requestStage = url.endsWith('/imports') ? 'start' : url.split('/').at(-1);
        if (options.method === 'POST') requests.push({ stage: requestStage, body: options.body });
        const response = await fetch(url, options);
        if (!discarded && options.method === 'POST' && requestStage === stage) {
          discarded = true;
          assert.equal(response.status, 201);
          await response.clone().json();
          throw new TypeError('Synthetic lost import reply after real persistence');
        }
        return response;
      });
      let stop = () => {};
      const uncertain = new Promise((resolve) => {
        stop = client.subscribeSave((state) => {
          if (state.phase === 'uncertain') resolve();
        });
      });
      const pending = client.importBackup(text);
      let settled = false;
      void pending.then(
        () => {
          settled = true;
        },
        () => {
          settled = true;
        }
      );
      await uncertain;
      stop();
      assert.equal(settled, false);
      assert.equal(client.saveState.operation, 'import');
      const commandId = client.saveState.commandId;
      const result = await client.retryPending();
      assert.deepEqual(await pending, result);
      assert.equal(client.saveState.phase, 'saved');
      assert.equal((await f.store.list(f.principal)).length, 2);
      const starts = requests.filter((request) => request.stage === 'start');
      assert.equal(starts.length, 2);
      assert.equal(starts[0].body, starts[1].body);
      assert.equal(JSON.parse(starts[0].body).commandId, commandId);
      assert.equal(requests.filter((request) => request.stage === 'parts').length, 1);
      assert.equal(requests.filter((request) => request.stage === 'finish').length, 1);
      const usage = (
        await f.runtime.firestore
          .collection('accountUsage')
          .doc(pilotAccountKey(f.identity.uid))
          .get()
      ).data();
      assert.equal(usage.ownedCampaigns, 2);
    }
  );

test(
  'the managed browser adapter completes one multipart import caller through authenticated HTTP',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'HTTP portable source', ruleset: '2024' },
    });
    const text = await f.store.exportBackup(f.principal, source.id);
    const requests = [];
    const client = f.client(async (url, options) => {
      if (options.method === 'POST') requests.push({ url, body: JSON.parse(options.body) });
      return fetch(url, options);
    });
    const imported = await client.importBackup(text);
    assert.notEqual(imported.id, source.id);
    assert.equal(imported.ruleset, '2024');
    assert.equal(imported.charactersRevision, 1);
    assert.equal(client.saveState.phase, 'saved');
    assert.equal(requests.length, 3);
    assert.equal(requests[0].body.commandId, requests[2].body.commandId);
    assert.equal(requests[1].body.index, 0);
    assert.deepEqual((await f.store.readCharacters(f.principal, imported.id)).records, []);
    assert.equal((await f.store.list(f.principal)).length, 2);
    const exported = await client.exportBackup(imported.id);
    assert.equal(JSON.parse(exported).campaign.id, imported.id);
  }
);

for (const ruleset of ['2014', '2024'])
  test(
    `${ruleset} imports publish one new private campaign with exact characters, images, scene and source pins`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const source = await f.store.create(f.principal, {
        commandId: randomUUID(),
        options: { name: 'Portable state ' + ruleset, ruleset },
      });
      const library = await CampaignCharacters.open({
        campaignId: source.id,
        catalog: await f.resources.catalog(source),
        store: {
          readCharacters: (id) => f.store.readCharacters(f.principal, id),
          commitCharacters: (id, change) =>
            f.store.commitCharacters(f.principal, id, { commandId: randomUUID(), change }),
        },
      });
      const characterId = await library.create('Portable scout');
      const image = createCanvas(2, 2).toBuffer('image/png');
      await library.edit(characterId, {
        portraitImage: 'data:image/png;base64,' + image.toString('base64'),
      });
      const scene = JSON.stringify(sceneState({ ruleset, characterId, name: 'Portable scout' }));
      await f.store.commitScene(f.principal, source.id, {
        commandId: randomUUID(),
        change: {
          ruleset,
          revision: 0,
          charactersRevision: library.revision,
          scene,
        },
      });
      const original = await f.store.readCharacters(f.principal, source.id);
      const backup = JSON.parse(await f.store.exportBackup(f.principal, source.id));
      backup.campaign.ownerUid = 'not-the-importing-account';
      backup.campaign.role = 'dm';
      backup.campaign.hostAccessKey = 'not-an-authority';
      const bytes = Buffer.from(JSON.stringify(backup), 'utf8');
      const command = {
        commandId: randomUUID(),
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
      const ticket = await f.store.startImport(f.principal, command);
      await f.store.uploadImportChunk(f.principal, ticket.importId, {
        index: 0,
        data: bytes.toString('base64'),
      });
      const result = await f.store.finishImport(f.principal, ticket.importId, {
        commandId: ticket.importId,
      });
      assert.equal(result.importId, ticket.importId);
      assert.equal(result.campaign.id, ticket.campaignId);
      assert.equal(result.campaign.ruleset, ruleset);
      assert.equal(result.campaign.charactersRevision, 1);
      assert.equal(result.campaign.sceneRevision, 1);
      assert.deepEqual(result.campaign.sourcePacks, original.campaign.sourcePacks);
      for (const key of ['ownerUid', 'role', 'hostAccessKey'])
        assert.equal(Object.hasOwn(result.campaign, key), false);
      const head = (
        await f.runtime.firestore.collection('campaigns').doc(ticket.campaignId).get()
      ).data();
      assert.equal(head.ownerUid, f.identity.uid);
      assert.equal(head.generation, 1);
      const imported = await f.store.readCharacters(f.principal, ticket.campaignId);
      assert.deepEqual(imported.records, original.records);
      assert.equal(imported.scene, original.scene);
      const manifest = await f.store.getAssetManifest(f.principal, ticket.campaignId);
      assert.equal(manifest.images.length, 1);
      assert.equal(manifest.images[0].characterId, characterId);
      assert.deepEqual(
        (
          await f.store.readAsset(
            f.principal,
            ticket.campaignId,
            manifest.images[0].reference.sha256
          )
        ).bytes,
        image
      );
      assert.deepEqual(
        await f.createStore().finishImport(f.principal, ticket.importId, {
          commandId: ticket.importId,
        }),
        result
      );
      assert.deepEqual((await f.createStore().startImport(f.principal, command)).completed, result);
      assert.equal((await f.store.list(f.principal)).length, 2);
      assert.deepEqual(await f.store.readCharacters(f.principal, source.id), original);
    }
  );

test(
  'an import stages immutable UID-bound chunks without exposing a partial campaign or allocating a second intent',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Portable source', ruleset: '2014' },
    });
    const text = await f.store.exportBackup(f.principal, source.id);
    const bytes = Buffer.from(text, 'utf8');
    const command = {
      commandId: randomUUID(),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const first = await f.store.startImport(f.principal, command);
    assert.equal(first.importId, command.commandId);
    assert.notEqual(first.campaignId, source.id);
    assert.equal(first.completed, null);
    assert.deepEqual(first.parts, []);
    assert.deepEqual(await f.createStore().startImport(f.principal, command), first);
    const part = { index: 0, data: bytes.toString('base64') };
    const receipt = await f.store.uploadImportChunk(f.principal, first.importId, part);
    assert.equal(receipt.importId, first.importId);
    assert.equal(receipt.index, 0);
    assert.equal(receipt.bytes, bytes.length);
    assert.equal(receipt.sha256, command.sha256);
    assert.deepEqual(
      await f.createStore().uploadImportChunk(f.principal, first.importId, part),
      receipt
    );
    const resumed = await f.createStore().startImport(f.principal, command);
    assert.deepEqual(resumed.parts, [{ index: 0, bytes: bytes.length, sha256: command.sha256 }]);
    assert.deepEqual(
      (await f.store.list(f.principal)).map((row) => row.id),
      [source.id]
    );
    assert.equal(
      (await f.runtime.firestore.collection('campaigns').doc(first.campaignId).get()).exists,
      false
    );
    const usage = (
      await f.runtime.firestore
        .collection('accountUsage')
        .doc(pilotAccountKey(f.identity.uid))
        .get()
    ).data();
    assert.equal(usage.ownedCampaigns, 1);
    assert.ok(usage.storageBytes >= bytes.length);
    await assert.rejects(
      f.store.create(f.principal, {
        commandId: command.commandId,
        options: { name: 'Reused import command', ruleset: '2014' },
      }),
      { code: 'command-id-conflict' }
    );
    await assert.rejects(f.store.startImport(f.principal, { ...command, sha256: '0'.repeat(64) }), {
      code: 'command-id-conflict',
    });
  }
);

test(
  'an owner exports one complete captured campaign as a private chunked UTF-8 file with exact size and hash',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const campaign = await f.store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Portable campaign', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState({ ruleset: '2014' }));
    await f.store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    });
    const url = f.api.url + '/api/cloud/campaigns/' + campaign.id + '/backup';
    const response = await fetch(url, {
      headers: { Authorization: 'Bearer ' + f.identity.token, Origin: f.api.origin },
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(response.headers.get('transfer-encoding'), 'chunked');
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(Number(response.headers.get('x-taverntable-backup-bytes')), bytes.length);
    assert.equal(
      response.headers.get('x-taverntable-backup-sha256'),
      createHash('sha256').update(bytes).digest('hex')
    );
    const backup = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    assert.equal(backup.format, 'taverntable-campaign');
    assert.equal(backup.version, 2);
    assert.deepEqual(backup.campaign, await f.store.get(f.principal, campaign.id));
    assert.deepEqual(backup.records, []);
    assert.equal(backup.scene, scene);
    assert.equal(JSON.stringify(backup).includes(f.identity.uid), false);
    const other = await signedInIdentity(f.runtime);
    t.after(() => other.close());
    await f.runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(other.uid))
      .create({ version: 1, uid: other.uid, enabled: true });
    const denied = await fetch(url, {
      headers: { Authorization: 'Bearer ' + other.token, Origin: f.api.origin },
    });
    assert.equal(denied.status, 404);
    assert.equal((await denied.json()).code, 'campaign-not-found');
    const secret = randomBytes(32).toString('hex');
    const invitation = await f.store.createInvitation(f.principal, campaign.id, {
      commandId: randomUUID(),
      options: {
        name: 'Joined backup requester',
        seatId: null,
        tokenHash: createHash('sha256').update(secret).digest('hex'),
      },
    });
    const member = await f.access.verifyAuthorization('Bearer ' + other.token);
    await f.store.redeemInvitation(member, {
      commandId: randomUUID(),
      invitationId: invitation.id,
      secret,
    });
    const joined = await fetch(url, {
      headers: { Authorization: 'Bearer ' + other.token, Origin: f.api.origin },
    });
    assert.equal(joined.status, 404);
    assert.equal((await joined.json()).code, 'campaign-not-found');
  }
);
