const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCanvas } = require('canvas');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { PrivateCampaignAssets } = require('../../tools/cloud/campaign-assets.js');
const { HostResources } = require('../../tools/host-resources.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');
const { sceneState } = require('../helpers/sceneState.js');

async function usageContext(t) {
  const runtime = await createEmulatorRuntime();
  t.after(() => runtime.close());
  const identity = await signedInIdentity(runtime);
  t.after(() => identity.close());
  await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).create({
    version: 1,
    uid: identity.uid,
    enabled: true,
  });
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
  return { runtime, identity, access, principal, manifest, createStore, store: createStore() };
}

test(
  'four stream leases are shared across instances, expire after crashes and renew without a session-duration cap',
  { timeout: 60000 },
  async (t) => {
    const { principal, createStore, runtime, identity } = await usageContext(t);
    let time = Date.now();
    const limits = [createStore(() => time).usage, createStore(() => time).usage];
    const leases = [];
    for (let index = 0; index < 3; index++)
      leases.push(await limits[index % 2].acquireStream(principal));
    const race = await Promise.allSettled(limits.map((usage) => usage.acquireStream(principal)));
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      race.find((result) => result.status === 'rejected').reason.code,
      'stream-limit-reached'
    );
    let kept = race.find((result) => result.status === 'fulfilled').value;
    await assert.rejects(limits[1].acquireStream(principal), {
      status: 429,
      code: 'stream-limit-reached',
    });
    for (let minute = 0; minute < 361; minute++) {
      time += 60000;
      kept = await limits[minute % 2].renewStream(principal, kept);
    }
    assert.ok(kept.expiresAt > time);
    await assert.rejects(limits[0].renewStream(principal, leases[0]), {
      code: 'stream-lease-expired',
    });
    for (let index = 0; index < 3; index++)
      leases.push(await limits[index % 2].acquireStream(principal));
    await assert.rejects(limits[0].acquireStream(principal), { code: 'stream-limit-reached' });
    assert.deepEqual(await limits[0].releaseStream(principal, kept), { released: true });
    assert.deepEqual(await limits[1].releaseStream(principal, kept), { released: false });
    const replacement = await limits[1].acquireStream(principal);
    assert.notEqual(replacement.id, kept.id);
    await assert.rejects(
      limits[0].releaseStream({ uid: 'another-verified-uid', emailVerified: true }, replacement),
      { code: 'invalid-stream-lease' }
    );
    await runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(identity.uid))
      .update({ enabled: false });
    await assert.rejects(limits[0].renewStream(principal, replacement), {
      code: 'pilot-access-required',
    });
    assert.deepEqual(await limits[0].releaseStream(principal, replacement), { released: true });
  }
);

test(
  '300 authenticated requests share a rolling minute across routes and instances with explicit retry and receipt recovery',
  { timeout: 60000 },
  async (t) => {
    const { identity, access, createStore, store, principal } = await usageContext(t);
    let time = Date.now();
    const apis = [];
    for (let index = 0; index < 2; index++) {
      const api = await cloudApi({ access, store: createStore(() => time) });
      apis.push(api);
      t.after(() => api.close());
    }
    const request = (index, resource, command = null) => {
      const api = apis[index % 2];
      return fetch(api.url + '/api/cloud/' + resource, {
        method: command === null ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + identity.token,
          Origin: api.origin,
          ...(command === null ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(command === null ? {} : { body: JSON.stringify(command) }),
      });
    };
    for (let index = 0; index < 299; index++) {
      const response = await request(index, index % 2 === 0 ? 'account' : 'account/campaigns');
      assert.equal(response.status, 200);
      await response.json();
    }
    const commands = [0, 1].map((index) => ({
      commandId: randomUUID(),
      options: { name: 'Request boundary ' + index, ruleset: '2014' },
    }));
    const responses = await Promise.all(
      commands.map((command, index) => request(index, 'campaigns', command))
    );
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
    const winner = responses.findIndex((response) => response.status === 201);
    const receipt = (await responses[winner].json()).result;
    const rejection = responses[1 - winner];
    assert.equal(rejection.headers.get('retry-after'), '60');
    assert.equal((await rejection.json()).code, 'request-limit-reached');
    assert.equal((await store.list(principal)).length, 1);
    for (const resource of ['campaigns', `campaigns/${receipt.id}/assets/manifest`, 'account']) {
      const response = await request(0, resource);
      assert.equal(response.status, 429);
      await response.json();
    }
    time += 59999;
    const early = await request(1, 'account');
    assert.equal(early.status, 429);
    assert.equal(early.headers.get('retry-after'), '1');
    await early.json();
    time += 1;
    const recovered = await request(winner, 'campaigns', commands[winner]);
    assert.equal(recovered.status, 201);
    assert.deepEqual((await recovered.json()).result, receipt);
    assert.equal((await store.list(principal)).length, 1);
  }
);

test(
  'quota admission rejects unrelated or disabled accounts and malformed usage without overwriting existing state',
  { timeout: 30000 },
  async (t) => {
    const owner = await usageContext(t);
    const other = await usageContext(t);
    const campaign = await owner.store.create(owner.principal, {
      commandId: randomUUID(),
      options: { name: 'Private quota checks', ruleset: '2014' },
    });
    const command = {
      commandId: randomUUID(),
      mimeType: 'image/png',
      data: createCanvas(2, 2).toBuffer('image/png').toString('base64'),
    };
    await assert.rejects(other.store.uploadAsset(other.principal, campaign.id, command), {
      code: 'campaign-not-found',
    });
    const otherUsage = other.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(other.identity.uid));
    assert.equal((await otherUsage.get()).exists, false);
    const usage = owner.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(owner.identity.uid));
    await usage.update({ storageBytes: -1 });
    await assert.rejects(owner.store.uploadAsset(owner.principal, campaign.id, command), {
      code: 'invalid-account-usage',
    });
    assert.equal((await usage.get()).data().storageBytes, -1);
    const [files] = await owner.runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` });
    assert.equal(files.length, 0);
    assert.equal((await owner.store.getSettings(owner.principal, campaign.id)).generation, 1);
    await usage.update({ storageBytes: 0 });
    const saved = await owner.store.uploadAsset(owner.principal, campaign.id, command);
    const consistent = (await usage.get()).data();
    await usage.delete();
    await assert.rejects(
      owner.store.uploadAsset(owner.principal, campaign.id, {
        ...command,
        commandId: randomUUID(),
      }),
      { code: 'invalid-account-usage' }
    );
    assert.equal((await usage.get()).exists, false);
    assert.deepEqual(
      await owner.store.assets.read(campaign.id, saved),
      Buffer.from(command.data, 'base64')
    );
    await usage.set(consistent);
    await owner.runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(owner.identity.uid))
      .update({ enabled: false });
    await assert.rejects(owner.store.uploadAsset(owner.principal, campaign.id, command), {
      code: 'pilot-access-required',
    });
    assert.equal((await usage.get()).data().storageBytes, consistent.storageBytes);
  }
);

test(
  'heavy HTTP work is bounded across handlers without blocking account reads or discarding retryable commands',
  { timeout: 30000 },
  async (t) => {
    const { identity, access, createStore, store, principal } = await usageContext(t);
    const campaigns = [];
    for (let index = 0; index < 5; index++)
      campaigns.push(
        await store.create(principal, {
          commandId: randomUUID(),
          options: { name: 'Bounded work ' + index, ruleset: '2014' },
        })
      );
    let release;
    let began;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      began = resolve;
    });
    let admitted = 0;
    const apis = [];
    for (let index = 0; index < 2; index++) {
      const backend = createStore();
      const commit = backend.commitScene.bind(backend);
      backend.commitScene = async (...args) => {
        admitted++;
        if (admitted === 4) began();
        if (admitted <= 4) await gate;
        return commit(...args);
      };
      const api = await cloudApi({ access, store: backend });
      apis.push(api);
      t.after(() => api.close());
    }
    const commands = campaigns.map(() => ({
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: JSON.stringify(sceneState({ ruleset: '2014' })),
      },
    }));
    const request = (index) => {
      const api = apis[index % 2];
      return fetch(api.url + '/api/cloud/campaigns/' + campaigns[index].id + '/scene', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + identity.token,
          Origin: api.origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(commands[index]),
      });
    };
    const pending = [0, 1, 2, 3].map(request);
    try {
      await started;
      const busy = await request(4);
      assert.equal(busy.status, 503);
      assert.equal((await busy.json()).code, 'cloud-requests-busy');
      assert.equal((await store.readScene(principal, campaigns[4].id)).revision, 0);
      const account = await fetch(apis[0].url + '/api/cloud/account', {
        headers: { Authorization: 'Bearer ' + identity.token, Origin: apis[0].origin },
      });
      assert.equal(account.status, 200);
      await account.json();
      release();
      for (const response of await Promise.all(pending)) {
        assert.equal(response.status, 200);
        await response.json();
      }
      const retried = await request(4);
      assert.equal(retried.status, 200);
      assert.equal((await retried.json()).result.revision, 1);
    } finally {
      release();
      await Promise.allSettled(pending);
    }
  }
);

test(
  'storage inventory charges noncurrent and soft-deleted generations separately from current bytes',
  { timeout: 30000 },
  async (t) => {
    const { runtime, identity, principal, store } = await usageContext(t);
    const campaign = await store.create(principal, {
      commandId: randomUUID(),
      options: { name: 'Retained storage accounting', ruleset: '2014' },
    });
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    const original = await store.assets.stage(campaign.id, 'image/png', bytes);
    const path = `campaigns/${campaign.id}/assets/${original.sha256}.bin`;
    const [metadata] = await runtime.bucket.file(path).getMetadata();
    const usage = runtime.firestore.collection('accountUsage').doc(pilotAccountKey(identity.uid));
    await usage.delete();
    const listFiles = runtime.bucket.getFiles.bind(runtime.bucket);
    runtime.bucket.getFiles = async (options) => {
      const [files, next, response] = await listFiles(options);
      if (!options.pageToken)
        files.push({
          metadata: {
            ...metadata,
            generation: String(BigInt(metadata.generation) + (options.softDeleted ? 2n : 1n)),
            ...(options.softDeleted
              ? { softDeleteTime: new Date().toISOString() }
              : { timeDeleted: new Date().toISOString() }),
          },
        });
      return [files, next, response];
    };
    t.after(() => {
      runtime.bucket.getFiles = listFiles;
    });
    const canvas = createCanvas(2, 2);
    canvas.getContext('2d').fillRect(0, 0, 2, 2);
    const image = canvas.toBuffer('image/png');
    await store.uploadAsset(principal, campaign.id, {
      commandId: randomUUID(),
      mimeType: 'image/png',
      data: image.toString('base64'),
    });
    assert.equal((await usage.get()).data().storageBytes, 3 * bytes.length + image.length);
    assert.deepEqual(await store.assets.read(campaign.id, original), bytes);
  }
);

test(
  'pre-quota storage is inventoried with pagination and resumes after an interrupted scan without losing or double-charging bytes',
  { timeout: 30000 },
  async (t) => {
    const { runtime, identity, principal, createStore } = await usageContext(t);
    let time = Date.now();
    const store = createStore(() => time);
    const campaign = await store.create(principal, {
      commandId: randomUUID(),
      options: { name: 'Existing storage inventory', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState({ ruleset: '2014' }));
    const sceneRef = await store.objects.stage(campaign.id, 'scene', scene);
    await runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .update({
        generation: 2,
        sceneRef,
        'campaign.sceneRevision': 1,
        'campaign.sceneSavedAt': new Date(time).toISOString(),
      });
    const oldImage = createCanvas(2, 2).toBuffer('image/png');
    await store.assets.stage(campaign.id, 'image/png', oldImage);
    const canvas = createCanvas(2, 2);
    canvas.getContext('2d').fillRect(0, 0, 2, 2);
    const newImage = canvas.toBuffer('image/png');
    const usage = runtime.firestore.collection('accountUsage').doc(pilotAccountKey(identity.uid));
    await usage.delete();
    const listFiles = runtime.bucket.getFiles.bind(runtime.bucket);
    let pages = 0;
    runtime.bucket.getFiles = async (options) => {
      if (++pages === 2)
        throw Object.assign(new Error('Synthetic interrupted inventory'), { code: 'ECONNRESET' });
      return listFiles({ ...options, maxResults: 1 });
    };
    t.after(() => {
      runtime.bucket.getFiles = listFiles;
    });
    const command = {
      commandId: randomUUID(),
      mimeType: 'image/png',
      data: newImage.toString('base64'),
    };
    await assert.rejects(store.uploadAsset(principal, campaign.id, command), {
      code: 'usage-unavailable',
    });
    const interrupted = (await usage.get()).data();
    assert.equal(interrupted.storageInitialized, false);
    assert.ok(interrupted.storageBytes > 0);
    assert.equal((await store.readScene(principal, campaign.id)).scene, scene);
    await assert.rejects(createStore(() => time).uploadAsset(principal, campaign.id, command), {
      code: 'usage-initializing',
    });
    time += 5 * 60 * 1000 + 1;
    runtime.bucket.getFiles = (options) => listFiles({ ...options, maxResults: 1 });
    const saved = await createStore(() => time).uploadAsset(principal, campaign.id, command);
    const ready = (await usage.get()).data();
    assert.equal(ready.storageInitialized, true);
    assert.equal(ready.ownedCampaigns, 1);
    assert.equal(ready.storageBytes, sceneRef.bytes + oldImage.length + newImage.length);
    assert.deepEqual(
      await createStore(() => time).uploadAsset(principal, campaign.id, command),
      saved
    );
    assert.equal((await usage.get()).data().storageBytes, ready.storageBytes);
    assert.equal((await store.readScene(principal, campaign.id)).scene, scene);
  }
);

test(
  'a coordinated checkpoint reserves all new objects atomically before any Storage write',
  { timeout: 30000 },
  async (t) => {
    const { runtime, identity, principal, store } = await usageContext(t);
    const campaign = await store.create(principal, {
      commandId: randomUUID(),
      options: { name: 'Whole-checkpoint capacity', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState({ ruleset: '2014' }));
    const characterBytes = Buffer.byteLength(
      JSON.stringify({ version: 1, kind: 'characters', value: [] })
    );
    const sceneBytes = Buffer.byteLength(
      JSON.stringify({ version: 1, kind: 'scene', value: scene })
    );
    const usage = runtime.firestore.collection('accountUsage').doc(pilotAccountKey(identity.uid));
    const limit = 20 * 1024 ** 3;
    await usage.update({ storageBytes: limit - characterBytes });
    const stages = [];
    const stage = store.objects.stage.bind(store.objects);
    store.objects.stage = (...args) => {
      const pending = stage(...args);
      stages.push(pending);
      return pending;
    };
    const command = {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        records: [],
        scene: { revision: 0, value: scene },
      },
    };
    await assert.rejects(store.commitCharacters(principal, campaign.id, command), {
      code: 'storage-limit-reached',
    });
    await Promise.allSettled(stages);
    assert.equal((await usage.get()).data().storageBytes, limit - characterBytes);
    const [files] = await runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` });
    assert.equal(files.length, 0);
    assert.equal((await store.getSettings(principal, campaign.id)).generation, 1);
    await usage.update({ storageBytes: limit - characterBytes - sceneBytes });
    const committed = await store.commitCharacters(principal, campaign.id, command);
    assert.equal(committed.revision, 1);
    assert.equal(committed.sceneRevision, 1);
    assert.equal((await usage.get()).data().storageBytes, limit);
    assert.equal((await store.readScene(principal, campaign.id)).scene, scene);
    assert.deepEqual(await store.commitCharacters(principal, campaign.id, command), committed);
  }
);

test(
  'private storage reserves exact bytes across campaigns before uploads and cannot be bypassed by source updates',
  { timeout: 30000 },
  async (t) => {
    const { runtime, identity, principal, store, createStore, manifest } = await usageContext(t);
    const campaigns = [];
    for (let index = 0; index < 2; index++)
      campaigns.push(
        await store.create(principal, {
          commandId: randomUUID(),
          options: { name: 'Storage boundary ' + index, ruleset: '2014' },
        })
      );
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    const usage = runtime.firestore.collection('accountUsage').doc(pilotAccountKey(identity.uid));
    const limit = 20 * 1024 ** 3;
    await usage.update({ storageBytes: limit - bytes.length });
    const commands = campaigns.map(() => ({
      commandId: randomUUID(),
      mimeType: 'image/png',
      data: bytes.toString('base64'),
    }));
    const results = await Promise.allSettled(
      campaigns.map((campaign, index) =>
        createStore().uploadAsset(principal, campaign.id, commands[index])
      )
    );
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      results.find((result) => result.status === 'rejected').reason.code,
      'storage-limit-reached'
    );
    assert.equal((await usage.get()).data().storageBytes, limit);
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    const reference = results[winner].value;
    assert.deepEqual(
      await createStore().uploadAsset(principal, campaigns[winner].id, commands[winner]),
      reference
    );
    assert.deepEqual(
      await createStore().uploadAsset(principal, campaigns[winner].id, {
        ...commands[winner],
        commandId: randomUUID(),
      }),
      reference
    );
    assert.equal((await usage.get()).data().storageBytes, limit);
    const losingPath = `campaigns/${campaigns[1 - winner].id}/assets/${reference.sha256}.bin`;
    assert.equal((await runtime.bucket.file(losingPath).exists())[0], false);
    const source = manifest.packs.find((pack) => pack.ruleset === '2014' && !pack.core);
    const settings = {
      commandId: randomUUID(),
      generation: 1,
      changes: { packIds: [source.id] },
    };
    await assert.rejects(store.updateSettings(principal, campaigns[winner].id, settings), {
      status: 409,
      code: 'storage-limit-reached',
    });
    assert.equal((await store.getSettings(principal, campaigns[winner].id)).generation, 1);
    assert.equal((await store.readCharacters(principal, campaigns[winner].id)).revision, 0);
    const emptySnapshotBytes = Buffer.byteLength(
      JSON.stringify({ version: 1, kind: 'characters', value: [] })
    );
    await usage.update({ storageBytes: limit - emptySnapshotBytes });
    const updated = await createStore().updateSettings(principal, campaigns[winner].id, settings);
    assert.equal(updated.generation, 2);
    assert.equal((await usage.get()).data().storageBytes, limit);
    assert.deepEqual(
      await store.updateSettings(principal, campaigns[winner].id, settings),
      updated
    );
    assert.deepEqual((await store.readCharacters(principal, campaigns[winner].id)).records, []);
  }
);

test(
  'ten owned campaigns is an atomic per-owner limit across instances without blocking committed-command recovery',
  { timeout: 30000 },
  async (t) => {
    const context = await usageContext(t);
    const { store, principal, createStore, runtime, identity } = context;
    for (let index = 0; index < 9; index++)
      await store.create(principal, {
        commandId: randomUUID(),
        options: { name: 'Pilot campaign ' + index, ruleset: '2014' },
      });
    const commands = [0, 1].map((index) => ({
      commandId: randomUUID(),
      options: { name: 'Competing final campaign ' + index, ruleset: '2024' },
    }));
    const results = await Promise.allSettled(
      commands.map((command) => createStore().create(principal, command))
    );

    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
    const denied = results.find((result) => result.status === 'rejected');
    assert.equal(denied.reason.code, 'campaign-limit-reached');
    assert.equal((await store.list(principal)).length, 10);
    const winner = results.findIndex((result) => result.status === 'fulfilled');
    assert.deepEqual(
      await createStore().create(principal, commands[winner]),
      results[winner].value
    );
    const failedReceipt = await runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(identity.uid))
      .collection('receipts')
      .doc(commands[1 - winner].commandId)
      .get();
    assert.equal(failedReceipt.exists, false);
    await assert.rejects(
      store.create(principal, {
        commandId: randomUUID(),
        options: { name: 'Eleventh campaign', ruleset: '2014' },
      }),
      { status: 409, code: 'campaign-limit-reached' }
    );
    const other = await signedInIdentity(runtime);
    t.after(() => other.close());
    await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(other.uid)).create({
      version: 1,
      uid: other.uid,
      enabled: true,
    });
    const otherPrincipal = await context.access.verifyAuthorization('Bearer ' + other.token);
    assert.equal(
      (
        await createStore().create(otherPrincipal, {
          commandId: randomUUID(),
          options: { name: 'Independent owner', ruleset: '2014' },
        })
      ).name,
      'Independent owner'
    );
  }
);
