const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createCanvas } = require('canvas');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const {
  ImmutableCloudObjects,
  snapshotCandidate,
} = require('../../tools/cloud/immutable-objects.js');
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
  'bounded cleanup quarantines only unreferenced objects and preserves complete backups and current checkpoints',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Fenced cleanup source', ruleset: '2014' },
    });
    const first = JSON.stringify(sceneState({ ruleset: '2014' }));
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene: first },
    });
    const backup = await store.backupNow(f.principal, campaign.id, { commandId: randomUUID() });
    const nextScene = JSON.parse(first);
    nextScene.camera.zoom = 1.25;
    const second = JSON.stringify(nextScene);
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 1, charactersRevision: 0, scene: second },
    });
    const unused = JSON.parse(first);
    unused.camera.zoom = 1.5;
    await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      JSON.stringify(unused),
      (candidate) =>
        store.usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    const before = (await usage.get()).data().storageBytes;
    const result = await store.maintainObjects(f.principal, campaign.id);
    assert.equal(result.scanned, 4);
    assert.equal(result.quarantined, 2);
    assert.equal(result.deleted, 0);
    assert.equal(
      (await f.runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` }))[0].length,
      4
    );
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, second);
    assert.equal(
      JSON.parse(await store.readBackup(f.principal, campaign.id, backup.name)).scene,
      first
    );
    assert.equal((await usage.get()).data().storageBytes, before);
    now += 24 * 60 * 60 * 1000 - 1;
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).deleted, 0);
    now++;
    const retired = await store.maintainObjects(f.principal, campaign.id);
    assert.equal(retired.deleted, 2);
    assert.equal(
      (await f.runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` }))[0].length,
      2
    );
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, second);
    assert.equal(
      JSON.parse(await store.readBackup(f.principal, campaign.id, backup.name)).scene,
      first
    );
    assert.equal((await usage.get()).data().storageBytes, before);
    const heldRows = await usage
      .collection('objects')
      .where('cleanup.state', '==', 'retired')
      .get();
    const heldBytes = heldRows.docs.reduce((bytes, snapshot) => bytes + snapshot.data().bytes, 0);
    assert.equal(heldRows.size, 2);
    now += 7 * 24 * 60 * 60 * 1000 - 1;
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).releasedBytes, 0);
    assert.equal((await usage.get()).data().storageBytes, before);
    now++;
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).releasedBytes, heldBytes);
    assert.equal((await usage.get()).data().storageBytes, before - heldBytes);
  }
);

test(
  'a deleting object cannot be reused by a new checkpoint and retry publishes a newly charged generation',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Delete/reuse fence', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState({ ruleset: '2014' }));
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    });
    const first = (await f.runtime.firestore.collection('campaigns').doc(campaign.id).get()).data()
      .sceneRef;
    const changed = JSON.parse(scene);
    changed.camera.zoom = 1.5;
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 1,
        charactersRevision: 0,
        scene: JSON.stringify(changed),
      },
    });
    await store.maintainObjects(f.principal, campaign.id);
    now += 24 * 60 * 60 * 1000;
    const fileFor = f.runtime.bucket.file.bind(f.runtime.bucket);
    let unblock = () => {};
    const gate = new Promise((resolve) => {
      unblock = resolve;
    });
    let noticed = () => {};
    const held = new Promise((resolve) => {
      noticed = resolve;
    });
    f.runtime.bucket.file = (...args) => {
      const file = fileFor(...args);
      if (args[0] !== first.path) return file;
      const remove = file.delete.bind(file);
      file.delete = async (...options) => {
        noticed();
        await gate;
        return remove(...options);
      };
      return file;
    };
    t.after(() => {
      unblock();
      f.runtime.bucket.file = fileFor;
    });
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    const before = (await usage.get()).data().storageBytes;
    const cleaning = store.maintainObjects(f.principal, campaign.id);
    await held;
    const command = {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 2, charactersRevision: 0, scene },
    };
    await assert.rejects(store.commitScene(f.principal, campaign.id, command), {
      code: 'object-maintenance-busy',
    });
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, JSON.stringify(changed));
    unblock();
    assert.equal((await cleaning).deleted, 1);
    assert.equal((await usage.get()).data().storageBytes, before);
    await store.commitScene(f.principal, campaign.id, command);
    const restored = (
      await f.runtime.firestore.collection('campaigns').doc(campaign.id).get()
    ).data().sceneRef;
    assert.notEqual(restored.generation, first.generation);
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, scene);
    assert.equal((await usage.get()).data().storageBytes, before + restored.bytes);
  }
);

test(
  'retired bytes stay charged while their exact soft-deleted generation remains billable after the minimum hold',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Retained generation billing', ruleset: '2014' },
    });
    const object = await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      JSON.stringify(sceneState()),
      (candidate) =>
        store.usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    await store.maintainObjects(f.principal, campaign.id);
    now += 24 * 60 * 60 * 1000;
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).deleted, 1);
    now += 7 * 24 * 60 * 60 * 1000;
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    const list = f.runtime.bucket.getFiles.bind(f.runtime.bucket);
    f.runtime.bucket.getFiles = async (options) => {
      if (options.softDeleted && options.prefix === object.path)
        return [
          [
            {
              metadata: {
                name: object.path,
                bucket: f.runtime.bucket.name,
                generation: object.generation,
                size: String(object.bytes),
                softDeleteTime: new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString(),
                hardDeleteTime: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
              },
            },
          ],
          null,
        ];
      return list(options);
    };
    t.after(() => {
      f.runtime.bucket.getFiles = list;
    });
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).releasedBytes, 0);
    assert.equal((await usage.get()).data().storageBytes, object.bytes);
    f.runtime.bucket.getFiles = async (options) => {
      if (options.prefix === object.path && (options.versions || options.softDeleted))
        return [[], { ...options, pageToken: String(Number(options.pageToken ?? 0) + 1) }];
      return list(options);
    };
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).releasedBytes, 0);
    assert.equal((await usage.get()).data().storageBytes, object.bytes);
    f.runtime.bucket.getFiles = list;
    assert.equal(
      (await store.maintainObjects(f.principal, campaign.id)).releasedBytes,
      object.bytes
    );
    assert.equal((await usage.get()).data().storageBytes, 0);
  }
);

test(
  'pending complete-backup source references stay protected without blocking unrelated orphan cleanup',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Pending backup cleanup roots', ruleset: '2014' },
    });
    const first = JSON.stringify(sceneState());
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene: first },
    });
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    const before = (await usage.get()).data().storageBytes;
    await usage.update({ storageBytes: 20 * 1024 * 1024 * 1024 });
    const backupCommand = { commandId: randomUUID() };
    await assert.rejects(store.backupNow(f.principal, campaign.id, backupCommand), {
      code: 'storage-limit-reached',
    });
    await usage.update({ storageBytes: before });
    const second = JSON.parse(first);
    second.camera.zoom = 1.5;
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 1,
        charactersRevision: 0,
        scene: JSON.stringify(second),
      },
    });
    const orphan = JSON.parse(first);
    orphan.camera.zoom = 2;
    const unused = await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      JSON.stringify(orphan),
      (candidate) =>
        store.usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).quarantined, 1);
    now += 24 * 60 * 60 * 1000;
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).deleted, 1);
    assert.equal((await f.runtime.bucket.file(unused.path).exists())[0], false);
    const recovered = await store.backupNow(f.principal, campaign.id, backupCommand);
    assert.equal(
      JSON.parse(await store.readBackup(f.principal, campaign.id, recovered.name)).scene,
      first
    );
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, JSON.stringify(second));
  }
);

test(
  'lost physical-deletion replies resume from durable fences without freeing retained bytes or needing a live object listing',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Interrupted object retirement', ruleset: '2014' },
    });
    const object = await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      JSON.stringify(sceneState()),
      (candidate) =>
        store.usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    await store.maintainObjects(f.principal, campaign.id);
    now += 24 * 60 * 60 * 1000;
    const fileFor = f.runtime.bucket.file.bind(f.runtime.bucket);
    let lose = true;
    f.runtime.bucket.file = (...args) => {
      const file = fileFor(...args);
      if (args[0] !== object.path) return file;
      const remove = file.delete.bind(file);
      file.delete = async (...options) => {
        await remove(...options);
        if (lose) {
          lose = false;
          throw Object.assign(new Error('Fixture lost the committed deletion reply'), {
            code: 503,
          });
        }
      };
      return file;
    };
    t.after(() => {
      f.runtime.bucket.file = fileFor;
    });
    await assert.rejects(store.maintainObjects(f.principal, campaign.id), {
      code: 'maintenance-unavailable',
    });
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    assert.equal((await usage.get()).data().storageBytes, object.bytes);
    assert.equal(
      (await f.runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` }))[0].length,
      0
    );
    const resumed = await f.createStore(() => now).maintainObjects(f.principal, campaign.id);
    assert.equal(resumed.deleted, 1);
    assert.equal((await usage.get()).data().storageBytes, object.bytes);
    assert.equal(
      (await usage.collection('objects').where('cleanup.state', '==', 'retired').get()).size,
      1
    );
  }
);

test(
  'an uncertain retirement acknowledgement cannot later delete or charge the replacement generation twice',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Retirement acknowledgement race', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState());
    const original = await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      scene,
      (candidate) =>
        store.usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    await store.maintainObjects(f.principal, campaign.id);
    now += 24 * 60 * 60 * 1000;
    const transact = f.runtime.firestore.runTransaction.bind(f.runtime.firestore);
    let lose = true;
    f.runtime.firestore.runTransaction = async (operation, options) => {
      let retiring = false;
      const result = await transact(async (transaction) => {
        const create = transaction.create.bind(transaction);
        transaction.create = (reference, data) => {
          if (reference.parent.id === 'objects' && data.cleanup?.state === 'retired')
            retiring = true;
          return create(reference, data);
        };
        return operation(transaction);
      }, options);
      if (retiring && lose) {
        lose = false;
        throw Object.assign(new Error('Fixture lost the committed retirement reply'), { code: 14 });
      }
      return result;
    };
    t.after(() => {
      f.runtime.firestore.runTransaction = transact;
    });
    await assert.rejects(store.maintainObjects(f.principal, campaign.id), { status: 503 });
    f.runtime.firestore.runTransaction = transact;
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    });
    const current = (
      await f.runtime.firestore.collection('campaigns').doc(campaign.id).get()
    ).data().sceneRef;
    assert.notEqual(current.generation, original.generation);
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    assert.equal((await usage.get()).data().storageBytes, original.bytes + current.bytes);
    now += 7 * 24 * 60 * 60 * 1000;
    const resumed = await f.createStore(() => now).maintainObjects(f.principal, campaign.id);
    assert.equal(resumed.releasedBytes, original.bytes);
    assert.equal(resumed.deleted, 0);
    assert.equal((await usage.get()).data().storageBytes, current.bytes);
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, scene);
    assert.equal(
      (await f.runtime.bucket.file(current.path).getMetadata())[0].generation,
      current.generation
    );
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).releasedBytes, 0);
  }
);

test(
  'a stale missing-object reply renews quota before writing a replacement and still cannot publish its expired command',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Stalled missing-object lookup', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState());
    const path = snapshotCandidate(campaign.id, 'scene', scene).path;
    const fileFor = f.runtime.bucket.file.bind(f.runtime.bucket);
    let unblock = () => {};
    const gate = new Promise((resolve) => {
      unblock = resolve;
    });
    let notice = () => {};
    const held = new Promise((resolve) => {
      notice = resolve;
    });
    let hold = true;
    f.runtime.bucket.file = (...args) => {
      const file = fileFor(...args);
      if (args[0] !== path) return file;
      const metadata = file.getMetadata.bind(file);
      file.getMetadata = async (...options) => {
        try {
          return await metadata(...options);
        } catch (error) {
          if (error.code === 404 && hold) {
            hold = false;
            notice();
            await gate;
          }
          throw error;
        }
      };
      return file;
    };
    t.after(() => {
      unblock();
      f.runtime.bucket.file = fileFor;
    });
    const command = {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    };
    const delayed = store.commitScene(f.principal, campaign.id, command);
    await held;
    const original = await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      scene,
      (candidate) =>
        store.usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).quarantined, 1);
    now += 24 * 60 * 60 * 1000;
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).deleted, 1);
    unblock();
    await assert.rejects(delayed, { code: 'object-publication-expired' });
    const [replacement] = await fileFor(path).getMetadata();
    assert.notEqual(replacement.generation, original.generation);
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    assert.equal(
      (await usage.get()).data().storageBytes,
      original.bytes + Number(replacement.size)
    );
    assert.equal((await store.get(f.principal, campaign.id)).sceneRevision, 0);
    await store.commitScene(f.principal, campaign.id, command);
    assert.equal((await store.get(f.principal, campaign.id)).sceneRevision, 1);
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, scene);
    assert.equal(
      (await usage.get()).data().storageBytes,
      original.bytes + Number(replacement.size)
    );
  }
);

test(
  'a delayed cleanup worker cannot delete a new referenced generation after another worker completes the old retirement',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const stores = [f.createStore(() => now), f.createStore(() => now)];
    const campaign = await stores[0].create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Concurrent generation retirement', ruleset: '2014' },
    });
    const scene = JSON.stringify(sceneState());
    const object = await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      scene,
      (candidate) =>
        stores[0].usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    await stores[0].maintainObjects(f.principal, campaign.id);
    now += 24 * 60 * 60 * 1000;
    const fileFor = f.runtime.bucket.file.bind(f.runtime.bucket);
    let unblock = () => {};
    const gate = new Promise((resolve) => {
      unblock = resolve;
    });
    let notice = () => {};
    const held = new Promise((resolve) => {
      notice = resolve;
    });
    let hold = true;
    f.runtime.bucket.file = (...args) => {
      const file = fileFor(...args);
      if (args[0] !== object.path) return file;
      const remove = file.delete.bind(file);
      file.delete = async (...options) => {
        const generation = args[1]?.preconditionOpts?.ifGenerationMatch;
        assert.equal(generation, object.generation);
        if (hold) {
          hold = false;
          notice();
          await gate;
        }
        // The official emulator omits the live-canary-verified GCS generation precondition.
        const [current] = await fileFor(object.path).getMetadata();
        if (current.generation !== generation)
          throw Object.assign(
            new Error('Fixture enforces the real Storage generation precondition'),
            { code: 412 }
          );
        return remove(...options);
      };
      return file;
    };
    t.after(() => {
      unblock();
      f.runtime.bucket.file = fileFor;
    });
    const delayed = stores[0].maintainObjects(f.principal, campaign.id);
    await held;
    assert.equal((await stores[1].maintainObjects(f.principal, campaign.id)).deleted, 1);
    await stores[1].commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene },
    });
    const replacement = (
      await f.runtime.firestore.collection('campaigns').doc(campaign.id).get()
    ).data().sceneRef;
    assert.notEqual(replacement.generation, object.generation);
    unblock();
    await assert.rejects(delayed, { code: 'maintenance-state-changed' });
    assert.equal((await stores[1].readScene(f.principal, campaign.id)).scene, scene);
    assert.equal((await fileFor(object.path).getMetadata())[0].generation, replacement.generation);
    const usage = await f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid))
      .get();
    assert.equal(usage.data().storageBytes, object.bytes + replacement.bytes);
    assert.equal(
      (await usage.ref.collection('objects').where('cleanup.state', '==', 'retired').get()).size,
      1
    );
  }
);

test(
  'maintenance leases survive cold-worker replacement, expire after crashes and rotate bounded owned targets',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const stores = [f.createStore(() => now), f.createStore(() => now)];
    const campaigns = [];
    for (let index = 0; index < 2; index++) {
      const campaign = await stores[0].create(f.principal, {
        commandId: randomUUID(),
        options: { name: `Bounded owner target ${index}`, ruleset: '2014' },
      });
      campaigns.push(campaign);
      await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
        campaign.id,
        'scene',
        JSON.stringify(sceneState()),
        (candidate) =>
          stores[0].usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
      );
    }
    campaigns.sort((a, b) => a.id.localeCompare(b.id));
    const list = f.runtime.bucket.getFiles.bind(f.runtime.bucket);
    let unblock = () => {};
    const gate = new Promise((resolve) => {
      unblock = resolve;
    });
    let notice = () => {};
    const held = new Promise((resolve) => {
      notice = resolve;
    });
    let hold = true;
    let scans = 0;
    f.runtime.bucket.getFiles = async (options) => {
      if (campaigns.some((campaign) => options.prefix === `campaigns/${campaign.id}/`)) {
        scans++;
        if (hold) {
          hold = false;
          notice();
          await gate;
        }
      }
      return list(options);
    };
    t.after(() => {
      unblock();
      f.runtime.bucket.getFiles = list;
    });
    const original = stores[0].runObjectMaintenance(f.principal);
    await held;
    assert.equal((await stores[1].runObjectMaintenance(f.principal)).state, 'deferred');
    assert.equal(scans, 1);
    now += 5 * 60 * 1000;
    assert.equal((await stores[1].runObjectMaintenance(f.principal)).result.quarantined, 1);
    unblock();
    await assert.rejects(original, { code: 'maintenance-state-changed' });
    const lease = f.runtime.firestore
      .collection('accountObjectMaintenance')
      .doc(pilotAccountKey(f.identity.uid));
    const completed = (await lease.get()).data();
    assert.equal(completed.campaignCursor, campaigns[0].id);
    assert.equal(completed.lastError, null);
    now += 5 * 60 * 1000 - 1;
    assert.equal((await stores[0].runObjectMaintenance(f.principal)).state, 'deferred');
    now++;
    assert.equal((await stores[0].runObjectMaintenance(f.principal)).result.quarantined, 1);
    assert.equal((await lease.get()).data().campaignCursor, campaigns[1].id);
    assert.equal(scans, 3);
  }
);

test(
  'cleanup errors are durable and visible without changing the receipt of a successfully saved HTTP command',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Independent maintenance failure', ruleset: '2014' },
    });
    const first = sceneState();
    await store.commitScene(f.principal, campaign.id, {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene: JSON.stringify(first) },
    });
    const api = await cloudApi({ access: f.access, store });
    t.after(() => api.close());
    const list = f.runtime.bucket.getFiles.bind(f.runtime.bucket);
    let scans = 0;
    f.runtime.bucket.getFiles = async (options) => {
      if (options.prefix === `campaigns/${campaign.id}/`) {
        scans++;
        throw Object.assign(new Error('Fixture storage listing unavailable'), { code: 503 });
      }
      return list(options);
    };
    t.after(() => {
      f.runtime.bucket.getFiles = list;
    });
    const scene = JSON.stringify({ ...first, camera: { ...first.camera, zoom: 1.5 } });
    const command = {
      commandId: randomUUID(),
      change: { ruleset: '2014', revision: 1, charactersRevision: 0, scene },
    };
    const response = await fetch(api.url + `/api/cloud/campaigns/${campaign.id}/scene`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + f.identity.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    assert.equal(response.status, 200);
    const receipt = (await response.json()).result;
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, scene);
    assert.deepEqual(await store.commitScene(f.principal, campaign.id, command), receipt);
    const lease = f.runtime.firestore
      .collection('accountObjectMaintenance')
      .doc(pilotAccountKey(f.identity.uid));
    assert.equal((await lease.get()).data().lastError.code, 'maintenance-unavailable');
    assert.equal(scans, 1);
    assert.equal((await store.runObjectMaintenance(f.principal)).state, 'deferred');
    f.runtime.bucket.getFiles = list;
    now += 5000;
    assert.equal((await store.runObjectMaintenance(f.principal)).state, 'complete');
    assert.equal((await lease.get()).data().lastError, null);
    assert.equal((await store.readScene(f.principal, campaign.id)).scene, scene);
  }
);

test(
  'malformed quarantine, ledger and backup roots fail closed and unrelated accounts cannot maintain another prefix',
  { timeout: 30000 },
  async (t) => {
    const f = await usageContext(t);
    const other = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Fail-closed cleanup evidence', ruleset: '2014' },
    });
    const object = await new ImmutableCloudObjects({ bucket: f.runtime.bucket }).stage(
      campaign.id,
      'scene',
      JSON.stringify(sceneState()),
      (candidate) =>
        store.usage.reserveStorage(f.principal, campaign.id, candidate, f.runtime.bucket)
    );
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).quarantined, 1);
    await assert.rejects(store.maintainObjects(other.principal, campaign.id), {
      code: 'campaign-not-found',
    });
    now += 24 * 60 * 60 * 1000;
    const campaignReference = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const marker = (await campaignReference.collection('objectCleanup').get()).docs[0];
    await marker.ref.update({ bytes: object.bytes + 1 });
    await assert.rejects(store.maintainObjects(f.principal, campaign.id), {
      code: 'invalid-maintenance-state',
    });
    await marker.ref.update({ bytes: object.bytes });
    const usage = f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(f.identity.uid));
    const reservation = (await usage.collection('objects').get()).docs[0];
    await reservation.ref.update({ bytes: object.bytes + 1 });
    await assert.rejects(store.maintainObjects(f.principal, campaign.id), {
      code: 'invalid-account-usage',
    });
    await reservation.ref.update({ bytes: object.bytes });
    const backup = await store.backupNow(f.principal, campaign.id, { commandId: randomUUID() });
    const manifest = campaignReference.collection('backups').doc(backup.name);
    await manifest.update({ 'reference.bytes': backup.bytes - 1 });
    await assert.rejects(store.maintainObjects(f.principal, campaign.id), {
      code: 'invalid-maintenance-state',
    });
    await manifest.update({ 'reference.bytes': backup.bytes });
    await marker.ref.update({ state: 'deleting', token: 'invalid-token' });
    await assert.rejects(store.maintainObjects(f.principal, campaign.id), {
      code: 'invalid-maintenance-state',
    });
    assert.equal((await f.runtime.bucket.file(object.path).exists())[0], true);
    assert.equal((await usage.get()).data().storageBytes, object.bytes + backup.bytes);
    assert.equal(
      (await usage.collection('objects').where('cleanup.state', '==', 'retired').get()).size,
      0
    );
  }
);

test(
  'cleanup advances through more than 200 real objects in 20-object pages and retires at most four generations per invocation',
  { timeout: 60000 },
  async (t) => {
    const f = await usageContext(t);
    let now = Date.now();
    const store = f.createStore(() => now);
    const campaign = await store.create(f.principal, {
      commandId: randomUUID(),
      options: { name: 'Bounded inventory pages', ruleset: '2014' },
    });
    const values = Array.from({ length: 205 }, (_, index) => JSON.stringify({ staged: index }));
    await store.usage.reserveStorage(
      f.principal,
      campaign.id,
      values.map((value) => snapshotCandidate(campaign.id, 'scene', value)),
      f.runtime.bucket
    );
    const objects = new ImmutableCloudObjects({ bucket: f.runtime.bucket });
    for (let offset = 0; offset < values.length; offset += 8)
      await Promise.all(
        values.slice(offset, offset + 8).map((value) => objects.stage(campaign.id, 'scene', value))
      );
    for (let page = 0; page < 10; page++) {
      const current = (await f.createStore(() => now).runObjectMaintenance(f.principal)).result;
      assert.equal(current.scanned, 20);
      assert.equal(current.quarantined, 20);
      assert.equal(current.more, true);
      now += 4999;
      assert.equal((await store.runObjectMaintenance(f.principal)).state, 'deferred');
      now++;
    }
    const second = (await f.createStore(() => now).runObjectMaintenance(f.principal)).result;
    assert.equal(second.scanned, 5);
    assert.equal(second.quarantined, 5);
    now += 24 * 60 * 60 * 1000;
    assert.equal((await store.maintainObjects(f.principal, campaign.id)).deleted, 4);
    const next = await store.maintainObjects(f.principal, campaign.id);
    assert.equal(next.scanned, 20);
    assert.equal(next.deleted, 4);
    assert.equal(
      (await f.runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` }))[0].length,
      197
    );
  }
);

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
