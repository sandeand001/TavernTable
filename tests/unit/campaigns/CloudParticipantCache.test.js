/** @jest-environment node */
import { webcrypto, createHash } from 'node:crypto';
import sharp from 'sharp';
import CloudParticipantCache, {
  CloudParticipantCacheError,
} from '../../../src/campaigns/CloudParticipantCache.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import ResourceStore from '../../../src/resources/ResourceStore.js';
import { openDatabase, requestResult, transact } from '../../../src/storage/indexedDB.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

function checkpoint() {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const campaign = {
    version: 1,
    id: campaignId,
    name: 'Scoped cache',
    ruleset: '2014',
    coreVersion: '5.1',
    createdAt: '2026-11-14T00:00:00.000Z',
    sourcePacks: [{ id: 'srd-2014', version: '5.1', ruleset: '2014', enabled: true }],
    charactersRevision: 0,
    sceneRevision: 0,
    sceneSavedAt: null,
  };
  return {
    version: 1,
    access: {
      version: 1,
      uid: 'cache-a',
      campaignId,
      role: 'member',
      seatId: '22222222-2222-4222-8222-222222222222',
      accessGeneration: 1,
    },
    sessionId: '33333333-3333-4333-8333-333333333333',
    generation: 1,
    viewKey: 'a'.repeat(64),
    state: {
      campaign,
      revision: 0,
      records: [],
      scene: null,
      sceneRevision: 0,
      sceneSavedAt: null,
      characterIds: [],
      observerTokenId: null,
      observers: [],
      maps: [],
      location: null,
      doors: [],
      gameplay: { version: 1, commands: [], ownedTokens: [], turn: null },
      publicScene: {
        version: 1,
        assetKey: null,
        assets: null,
        presentation: { mapId: null, focusTokenId: null },
        actors: [],
        updates: [],
      },
    },
    manifest: { version: 1, images: [] },
  };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function testCacheStorage({ beforePut = async () => {} } = {}) {
  const stores = new Map();
  return {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        put: async (request, response) => {
          await beforePut(request);
          entries.set(request.url, response.clone());
        },
        match: async (request) => entries.get(request.url)?.clone(),
        delete: async (request) => entries.delete(request.url),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
      };
    },
    keys: async () => [...stores.keys()],
  };
}

function testLocks() {
  const pending = new Map();
  const held = new Set();
  return {
    request: (name, { mode }, operation) => {
      const run = async () => {
        const lock = { name, mode };
        held.add(lock);
        try {
          return await operation(lock);
        } finally {
          held.delete(lock);
        }
      };
      if (mode === 'shared') return run();
      const result = (pending.get(name) ?? Promise.resolve()).then(run, run);
      pending.set(name, result);
      return result;
    },
    query: async () => ({ held: [...held], pending: [] }),
  };
}

async function imageCheckpoint() {
  const source = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  try {
    const campaign = await source.create({ name: 'Scoped cached artwork', ruleset: '2014' });
    const library = await CampaignCharacters.open({
      store: source,
      campaignId: campaign.id,
      catalog: { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] },
    });
    const id = await library.create('Assigned cached portrait');
    const owner = await source.readCharacters(campaign.id);
    const snapshot = checkpoint();
    snapshot.access.campaignId = campaign.id;
    Object.assign(snapshot.state, owner, { characterIds: [id] });
    const bytes = await sharp({
      create: { width: 1, height: 1, channels: 4, background: '#123456' },
    })
      .png()
      .toBuffer();
    const reference = {
      version: 1,
      campaignId: campaign.id,
      mimeType: 'image/png',
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      generation: '1',
      width: 1,
      height: 1,
    };
    snapshot.manifest.images = [{ source: 'character', id, field: 'portraitImage', reference }];
    return { snapshot, reference, bytes };
  } finally {
    source.close();
  }
}

test('private usage counts verified bodies and checkpoint replacements once, with a validated budget persisted only for that UID', async () => {
  const indexedDB = testIndexedDB();
  const cacheStorage = testCacheStorage();
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const otherSnapshot = structuredClone(snapshot);
  otherSnapshot.access.uid = 'cache-b';
  const options = { indexedDB, cacheStorage, crypto: webcrypto };
  const cache = new CloudParticipantCache({ ...options, uid: snapshot.access.uid });
  const other = new CloudParticipantCache({ ...options, uid: otherSnapshot.access.uid });
  let reopened;
  try {
    await cache.writeCheckpoint(snapshot);
    await cache.writeAsset(snapshot, reference, bytes);
    await cache.writeAsset(snapshot, reference, bytes);
    const replacement = structuredClone(snapshot);
    replacement.generation++;
    replacement.state.campaign.name = 'Updated café 🎲';
    await cache.writeCheckpoint(replacement);
    const checkpointBytes = Buffer.byteLength(JSON.stringify(replacement));
    expect(await cache.getUsage()).toMatchObject({
      budgetBytes: 256 * 1024 * 1024,
      usedBytes: checkpointBytes + bytes.length,
      checkpointBytes,
      assetBytes: bytes.length,
      checkpointCount: 1,
      assetCount: 1,
      overBudget: false,
    });
    await other.writeCheckpoint(otherSnapshot);
    await other.writeAsset(otherSnapshot, reference, bytes);
    await cache.setBudgetBytes(1024 * 1024);
    for (const invalid of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1024', null])
      await expect(cache.setBudgetBytes(invalid)).rejects.toMatchObject({
        code: 'invalid-cache-budget',
      });
    cache.close();
    reopened = new CloudParticipantCache({ ...options, uid: snapshot.access.uid });
    expect(await reopened.getUsage()).toMatchObject({
      budgetBytes: 1024 * 1024,
      usedBytes: checkpointBytes + bytes.length,
    });
    expect(await other.getUsage()).toMatchObject({
      budgetBytes: 256 * 1024 * 1024,
      usedBytes: Buffer.byteLength(JSON.stringify(otherSnapshot)) + bytes.length,
    });
    await reopened.deleteAsset(replacement, reference);
    await reopened.deleteCheckpoint(replacement.access, replacement.viewKey);
    expect(await reopened.getUsage()).toMatchObject({
      usedBytes: 0,
      checkpointCount: 0,
      assetCount: 0,
    });
  } finally {
    cache.close();
    reopened?.close();
    other.close();
  }
});

test('budget pressure evicts the least recently used private entries without evicting a protected view or an image being loaded', async () => {
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const second = { ...snapshot, viewKey: 'b'.repeat(64) };
  const third = { ...snapshot, viewKey: 'c'.repeat(64) };
  const next = { ...snapshot, viewKey: 'd'.repeat(64) };
  const cache = new CloudParticipantCache({
    uid: snapshot.access.uid,
    indexedDB: testIndexedDB(),
    cacheStorage: testCacheStorage(),
    crypto: webcrypto,
  });
  try {
    await cache.writeCheckpoint(snapshot);
    await cache.writeCheckpoint(second);
    await cache.writeAsset(second, reference, bytes);
    await cache.writeCheckpoint(third);
    const releaseView = await cache.protect(snapshot);
    const releaseImage = await cache.protectAsset(third, reference);
    await cache.writeAsset(third, reference, bytes);
    await cache.readCheckpoint(second.access, second.viewKey);
    const checkpointBytes = Buffer.byteLength(JSON.stringify(snapshot));
    expect(await cache.setBudget(2 * checkpointBytes + bytes.length)).toMatchObject({
      usedBytes: 2 * checkpointBytes + bytes.length,
      evictedEntries: 2,
      evictedBytes: checkpointBytes + bytes.length,
      overBudget: false,
    });
    expect(await cache.readCheckpoint(snapshot.access, snapshot.viewKey)).toEqual(snapshot);
    expect(await cache.readCheckpoint(second.access, second.viewKey)).toEqual(second);
    expect(await cache.readCheckpoint(third.access, third.viewKey)).toBeNull();
    expect(await cache.readAsset(second, reference)).toBeNull();
    expect(Buffer.from(await cache.readAsset(third, reference))).toEqual(bytes);
    await cache.writeAsset(snapshot, reference, bytes);
    expect(await cache.setBudgetBytes(0)).toMatchObject({
      usedBytes: checkpointBytes + 2 * bytes.length,
      protectedBytes: checkpointBytes + 2 * bytes.length,
      overBudget: true,
    });
    await expect(cache.writeCheckpoint(next)).resolves.toEqual({
      stored: false,
      reason: 'cache-budget-exceeded',
    });
    await expect(cache.writeAsset(next, reference, bytes)).rejects.toMatchObject({
      code: 'cache-budget-exceeded',
    });
    expect(await cache.readCheckpoint(snapshot.access, snapshot.viewKey)).toEqual(snapshot);
    expect(Buffer.from(await cache.readAsset(snapshot, reference))).toEqual(bytes);
    releaseImage();
    releaseView();
    expect(await cache.getUsage()).toMatchObject({
      bytes: 0,
      protectedBytes: 0,
      overBudget: false,
    });
    expect(await cache.setBudgetBytes(0)).toMatchObject({
      usedBytes: 0,
      checkpointCount: 0,
      assetCount: 0,
      overBudget: false,
    });
  } finally {
    cache.close();
  }
});

test('separate browser cache contexts share active protections and wait for older native puts before clearing the UID', async () => {
  const indexedDB = testIndexedDB();
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const next = { ...snapshot, viewKey: 'b'.repeat(64) };
  const last = { ...snapshot, viewKey: 'c'.repeat(64) };
  let gate = null;
  const cacheStorage = testCacheStorage({
    beforePut: async () => {
      if (gate) {
        const pending = gate;
        pending.started.resolve();
        await pending.resume.promise;
      }
    },
  });
  const options = { uid: snapshot.access.uid, cacheStorage, crypto: webcrypto, locks: testLocks() };
  const first = new CloudParticipantCache({
    ...options,
    indexedDB: { open: indexedDB.open.bind(indexedDB) },
  });
  const second = new CloudParticipantCache({
    ...options,
    indexedDB: { open: indexedDB.open.bind(indexedDB) },
  });
  let pendingWrite;
  let release;
  try {
    await first.setBudget(bytes.length);
    await first.writeAsset(snapshot, reference, bytes);
    release = await first.protect(snapshot);
    await expect(second.writeAsset(next, reference, bytes)).rejects.toMatchObject({
      code: 'cache-budget-exceeded',
    });
    expect(Buffer.from(await first.readAsset(snapshot, reference))).toEqual(bytes);
    await release();
    await second.writeAsset(next, reference, bytes);
    expect(await first.readAsset(snapshot, reference)).toBeNull();
    expect(await second.getUsage()).toMatchObject({
      bytes: bytes.length,
      limitBytes: bytes.length,
    });
    gate = { started: deferred(), resume: deferred() };
    pendingWrite = second.writeAsset(last, reference, bytes);
    await gate.started.promise;
    const clearing = first.clear();
    gate.resume.resolve();
    await pendingWrite;
    expect(await clearing).toMatchObject({ bytes: 0 });
    expect(await second.getUsage()).toMatchObject({ bytes: 0 });
    expect(await second.readAsset(last, reference)).toBeNull();
  } finally {
    gate?.resume.resolve();
    await pendingWrite;
    await release?.();
    first.close();
    second.close();
  }
});

test('clearing one UID fences older image puts and checkpoint hashes without touching another UID or either public catalog', async () => {
  const indexedDB = testIndexedDB();
  let gate = null;
  const cacheStorage = testCacheStorage({
    beforePut: async () => {
      if (gate) {
        const pending = gate;
        pending.started.resolve();
        await pending.resume.promise;
      }
    },
  });
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const options = { indexedDB, cacheStorage, crypto: webcrypto };
  const cache = new CloudParticipantCache({ ...options, uid: snapshot.access.uid });
  const peer = new CloudParticipantCache({ ...options, uid: snapshot.access.uid });
  const otherSnapshot = structuredClone(snapshot);
  otherSnapshot.access.uid = 'cache-b';
  const other = new CloudParticipantCache({ ...options, uid: otherSnapshot.access.uid });
  const catalogs = ['2014', '2024'].map((ruleset) => ({
    store: new ResourceStore({ indexedDB, ruleset }),
    pack: {
      id: 'srd-' + ruleset,
      version: ruleset === '2014' ? '5.1' : '5.2.1',
      ruleset,
      hash: 'a'.repeat(64),
      classes: [],
      entries: [],
    },
  }));
  const hashGate = { started: deferred(), resume: deferred() };
  const delayed = new CloudParticipantCache({
    ...options,
    uid: snapshot.access.uid,
    crypto: {
      subtle: {
        digest: async (algorithm, input) => {
          if (input.byteLength > 128) {
            hashGate.started.resolve();
            await hashGate.resume.promise;
          }
          return webcrypto.subtle.digest(algorithm, input);
        },
      },
    },
  });
  let lateAsset;
  let lateCheckpoint;
  try {
    for (const { store, pack } of catalogs) await store.install(pack);
    await cache.writeCheckpoint(snapshot);
    await cache.writeAsset(snapshot, reference, bytes);
    await cache.setBudget(1024 * 1024);
    await cache.protect(snapshot);
    await other.writeCheckpoint(otherSnapshot);
    await other.writeAsset(otherSnapshot, reference, bytes);
    gate = { started: deferred(), resume: deferred() };
    lateAsset = cache.writeAsset(snapshot, reference, bytes).then(
      () => ({ stored: true }),
      (error) => ({ error })
    );
    await gate.started.promise;
    const clearing = peer.clear();
    gate.resume.resolve();
    expect(await lateAsset).toMatchObject({ error: { code: 'cache-invalidated' } });
    expect(await clearing).toMatchObject({
      bytes: 0,
      limitBytes: 1024 * 1024,
      checkpointCount: 0,
      assetCount: 0,
    });
    gate = null;
    lateCheckpoint = delayed.writeCheckpoint({ ...snapshot, generation: 2 }).then(
      () => ({ stored: true }),
      (error) => ({ error })
    );
    await hashGate.started.promise;
    const clearingCheckpoint = peer.clear();
    hashGate.resume.resolve();
    await clearingCheckpoint;
    expect(await lateCheckpoint).toMatchObject({ error: { code: 'cache-invalidated' } });
    expect(await cache.getUsage()).toMatchObject({ bytes: 0, limitBytes: 1024 * 1024 });
    expect(await cache.readCheckpoint(snapshot.access, snapshot.viewKey)).toBeNull();
    expect(await cache.readAsset(snapshot, reference)).toBeNull();
    expect(await other.readCheckpoint(otherSnapshot.access, otherSnapshot.viewKey)).toEqual(
      otherSnapshot
    );
    expect(Buffer.from(await other.readAsset(otherSnapshot, reference))).toEqual(bytes);
    for (const { store, pack } of catalogs)
      expect(await store.installed(pack)).toMatchObject({ ruleset: pack.ruleset, count: 0 });
    await expect(cache.writeCheckpoint(snapshot)).resolves.toMatchObject({ stored: true });
    expect(await cache.readCheckpoint(snapshot.access, snapshot.viewKey)).toEqual(snapshot);
  } finally {
    gate?.resume.resolve();
    hashGate.resume.resolve();
    await lateAsset;
    await lateCheckpoint;
    cache.close();
    peer.close();
    delayed.close();
    other.close();
    for (const { store } of catalogs) store.close();
  }
});

test('best-effort persistence reports granted, denied, unavailable and typed failures even when private storage is unavailable', async () => {
  const denied = new DOMException('Browser storage permission denied.', 'SecurityError');
  const alreadyPersistent = jest.fn(async () => true);
  const cases = [
    { storage: null, status: 'unavailable', persistent: false },
    {
      storage: { persisted: async () => true, persist: alreadyPersistent },
      status: 'accepted',
      persistent: true,
    },
    {
      storage: { persisted: async () => false, persist: async () => true },
      status: 'accepted',
      persistent: true,
    },
    {
      storage: { persisted: async () => false, persist: async () => false },
      status: 'denied',
      persistent: false,
    },
    {
      storage: {
        persist: async () => {
          throw denied;
        },
      },
      status: 'failed',
      persistent: false,
      cause: denied,
    },
    {
      storage: { persist: async () => 'not a permission result' },
      status: 'failed',
      persistent: false,
    },
  ];
  for (const { storage, status, persistent, cause } of cases) {
    const logger = { warn: jest.fn() };
    const cache = new CloudParticipantCache({
      uid: 'cache-a',
      indexedDB: null,
      cacheStorage: null,
      crypto: webcrypto,
      storage,
      logger,
    });
    try {
      const result = await cache.requestPersistence();
      expect(result).toMatchObject({ status, persistent });
      if (status === 'failed') {
        expect(result.error).toBeInstanceOf(CloudParticipantCacheError);
        expect(result.error).toMatchObject({ code: 'cache-persistence-failed', recoverable: true });
        if (cause) expect(result.error.cause).toBe(cause);
        expect(logger.warn).toHaveBeenCalledWith(expect.any(String), result.error);
      } else expect(logger.warn).not.toHaveBeenCalled();
      await expect(cache.getUsage()).rejects.toMatchObject({
        name: 'CloudParticipantCacheError',
        code: 'cache-unavailable',
        recoverable: true,
      });
    } finally {
      cache.close();
    }
  }
  expect(alreadyPersistent).not.toHaveBeenCalled();
});

test('quota and storage permission failures retain typed logged causes, do not claim stored bytes, and do not poison a later cache write', async () => {
  const { snapshot, reference, bytes } = await imageCheckpoint();
  for (const [name, code] of [
    ['QuotaExceededError', 'cache-quota-exceeded'],
    ['SecurityError', 'cache-storage-denied'],
  ]) {
    let denied = true;
    const cause = new DOMException('Private browser storage refused the write.', name);
    const logger = { warn: jest.fn() };
    const cache = new CloudParticipantCache({
      uid: snapshot.access.uid,
      indexedDB: testIndexedDB(),
      cacheStorage: testCacheStorage({
        beforePut: async () => {
          if (denied) throw cause;
        },
      }),
      crypto: webcrypto,
      logger,
    });
    try {
      await cache.writeCheckpoint(snapshot);
      const error = await cache.writeAsset(snapshot, reference, bytes).then(
        () => null,
        (failure) => failure
      );
      expect(error).toBeInstanceOf(CloudParticipantCacheError);
      expect(error).toMatchObject({ code, recoverable: true });
      expect(error.cause).toBe(cause);
      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), error);
      expect(await cache.getUsage()).toMatchObject({
        bytes: Buffer.byteLength(JSON.stringify(snapshot)),
        assetCount: 0,
      });
      denied = false;
      await cache.writeAsset(snapshot, reference, bytes);
      expect(Buffer.from(await cache.readAsset(snapshot, reference))).toEqual(bytes);
    } finally {
      cache.close();
    }
  }
});

test('the shipped v1 checkpoints and synthetic image keys upgrade in place and stay partitioned by UID', async () => {
  const indexedDB = testIndexedDB();
  const cacheStorage = testCacheStorage();
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const otherSnapshot = structuredClone(snapshot);
  otherSnapshot.access.uid = 'cache-b';
  const name = 'taverntable.cloud.participants.v1';
  const legacy = await openDatabase(indexedDB, name, (database) => {
    const store = database.createObjectStore('checkpoints', { keyPath: 'id' });
    store.createIndex('uidKey', 'uidKey');
  });
  legacy.onversionchange = () => legacy.close();
  const storage = await cacheStorage.open(name + '.assets');
  for (const saved of [snapshot, otherSnapshot]) {
    const uidKey = createHash('sha256').update(saved.access.uid).digest('hex');
    const payload = JSON.stringify(saved);
    await transact(legacy, ['checkpoints'], 'readwrite', (transaction) =>
      requestResult(
        transaction.objectStore('checkpoints').put({
          id: JSON.stringify([
            1,
            uidKey,
            saved.access.campaignId,
            saved.access.seatId,
            saved.access.accessGeneration,
            saved.viewKey,
          ]),
          uidKey,
          version: 1,
          campaignId: saved.access.campaignId,
          seatId: saved.access.seatId,
          accessGeneration: saved.access.accessGeneration,
          viewKey: saved.viewKey,
          generation: saved.generation,
          bytes: Buffer.byteLength(payload),
          sha256: createHash('sha256').update(payload).digest('hex'),
          payload,
        })
      )
    );
    const path = [
      1,
      uidKey,
      saved.access.campaignId,
      saved.access.seatId,
      saved.access.accessGeneration,
      saved.viewKey,
      reference.sha256,
    ].join('/');
    await storage.put(
      new Request('https://taverntable-cache.invalid/' + path),
      new Response(bytes, {
        headers: {
          'Content-Type': reference.mimeType,
          'Content-Length': String(bytes.length),
          'X-TavernTable-Cache-SHA256': reference.sha256,
        },
      })
    );
  }
  const options = { indexedDB, cacheStorage, crypto: webcrypto };
  const cache = new CloudParticipantCache({ ...options, uid: snapshot.access.uid });
  const other = new CloudParticipantCache({ ...options, uid: otherSnapshot.access.uid });
  try {
    expect(await cache.getUsage()).toMatchObject({
      bytes: Buffer.byteLength(JSON.stringify(snapshot)) + bytes.length,
      checkpointCount: 1,
      assetCount: 1,
    });
    expect(await cache.readCheckpoint(snapshot.access, snapshot.viewKey)).toEqual(snapshot);
    expect(Buffer.from(await cache.readAsset(snapshot, reference))).toEqual(bytes);
    await cache.clear();
    expect(await cache.getUsage()).toMatchObject({ bytes: 0 });
    expect(await other.readCheckpoint(otherSnapshot.access, otherSnapshot.viewKey)).toEqual(
      otherSnapshot
    );
    expect(Buffer.from(await other.readAsset(otherSnapshot, reference))).toEqual(bytes);
    expect(await other.getUsage()).toMatchObject({
      bytes: Buffer.byteLength(JSON.stringify(otherSnapshot)) + bytes.length,
      checkpointCount: 1,
      assetCount: 1,
    });
  } finally {
    legacy.close();
    cache.close();
    other.close();
  }
});

test('corrupt Cache Storage bodies cannot pass a matching metadata header and can be invalidated exactly', async () => {
  const indexedDB = testIndexedDB();
  const cacheStorage = testCacheStorage();
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const cache = new CloudParticipantCache({
    uid: snapshot.access.uid,
    indexedDB,
    cacheStorage,
    crypto: webcrypto,
  });
  try {
    await cache.writeCheckpoint(snapshot);
    await cache.writeAsset(snapshot, reference, bytes);
    const [name] = await cacheStorage.keys();
    const storage = await cacheStorage.open(name);
    const [request] = await storage.keys();
    const original = await storage.match(request);
    const corrupted = Uint8Array.from(bytes);
    corrupted[0] ^= 1;
    await storage.put(request, new Response(corrupted, { headers: original.headers }));
    await expect(cache.readAsset(snapshot, reference)).rejects.toMatchObject({
      code: 'cache-asset-integrity',
    });
    await expect(
      cache.readAuthorizedAsset({ ...snapshot, viewKey: 'b'.repeat(64) }, reference)
    ).rejects.toMatchObject({ code: 'cache-asset-integrity' });
    expect(await cache.readAsset(snapshot, reference)).toBeNull();
    await cache.deleteAsset(snapshot, reference);
    expect(await cache.readAsset(snapshot, reference)).toBeNull();
  } finally {
    cache.close();
  }
});

test('a delayed older checkpoint cannot replace a newer cached committed generation', async () => {
  const indexedDB = testIndexedDB();
  const older = checkpoint();
  const newer = structuredClone(older);
  newer.generation++;
  newer.state.campaign.name = 'Newer authorized metadata';
  const cache = new CloudParticipantCache({ uid: older.access.uid, indexedDB, crypto: webcrypto });
  try {
    await cache.writeCheckpoint(newer);
    await cache.writeCheckpoint(older);
    expect(await cache.readCheckpoint(older.access, older.viewKey)).toEqual(newer);
  } finally {
    cache.close();
  }
});

test('cache payloads with invalid schemas are refused even when disk metadata contains a matching hash', async () => {
  const indexedDB = testIndexedDB();
  const snapshot = checkpoint();
  const cache = new CloudParticipantCache({
    uid: snapshot.access.uid,
    indexedDB,
    crypto: webcrypto,
  });
  await cache.writeCheckpoint(snapshot);
  const { name } = (await indexedDB.databases()).find((database) =>
    database.name.startsWith('taverntable.cloud.participants.')
  );
  const database = await openDatabase(indexedDB, name, () => {}, 2);
  try {
    for (const mutate of [
      (payload) => {
        payload.signedUrl = 'https://unrelated.example.invalid/?token=not-a-credential';
      },
      (payload) => {
        payload.access.uid = 'cache-b';
      },
    ]) {
      await cache.writeCheckpoint(snapshot);
      await transact(database, ['checkpoints'], 'readwrite', async (transaction) => {
        const store = transaction.objectStore('checkpoints');
        const [row] = await requestResult(store.getAll());
        const payload = JSON.parse(row.payload);
        mutate(payload);
        row.payload = JSON.stringify(payload);
        row.bytes = new TextEncoder().encode(row.payload).byteLength;
        row.sha256 = createHash('sha256').update(row.payload).digest('hex');
        await requestResult(store.put(row));
      });
      await expect(cache.readCheckpoint(snapshot.access, snapshot.viewKey)).rejects.toMatchObject({
        code: 'cache-corrupt',
      });
      await expect(cache.readCheckpointCandidate(snapshot.access)).rejects.toMatchObject({
        code: 'cache-corrupt',
      });
      expect(await cache.readCheckpoint(snapshot.access, snapshot.viewKey)).toBeNull();
    }
  } finally {
    database.close();
    cache.close();
  }
});

test('verified private binary bytes persist in Cache Storage and never cross another access or view namespace', async () => {
  const indexedDB = testIndexedDB();
  const cacheStorage = testCacheStorage();
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const first = new CloudParticipantCache({
    uid: snapshot.access.uid,
    indexedDB,
    cacheStorage,
    crypto: webcrypto,
  });
  await first.writeAsset(snapshot, reference, bytes);
  first.close();
  const reopened = new CloudParticipantCache({
    uid: snapshot.access.uid,
    indexedDB,
    cacheStorage,
    crypto: webcrypto,
  });
  try {
    const cached = await reopened.readAsset(snapshot, reference);
    expect(Buffer.from(cached)).toEqual(bytes);
    const corrupt = Uint8Array.from(bytes);
    corrupt[0] ^= 1;
    await expect(reopened.writeAsset(snapshot, reference, corrupt)).rejects.toMatchObject({
      code: 'cache-asset-integrity',
    });
    expect(Buffer.from(await reopened.readAsset(snapshot, reference))).toEqual(bytes);
    expect(
      await reopened.readAsset({ ...snapshot, viewKey: 'b'.repeat(64) }, reference)
    ).toBeNull();
    expect(
      await reopened.readAsset(
        { ...snapshot, access: { ...snapshot.access, accessGeneration: 2 } },
        reference
      )
    ).toBeNull();
    await expect(
      reopened.readAsset({ ...snapshot, manifest: { version: 1, images: [] } }, reference)
    ).rejects.toMatchObject({
      code: 'invalid-cache-asset',
    });
    await reopened.deleteAsset(snapshot, reference);
    expect(await reopened.readAsset(snapshot, reference)).toBeNull();
  } finally {
    reopened.close();
  }
});

test('a warm candidate is only a hint and exact current manifests authorize unchanged bytes across views without weakening ordinary isolation', async () => {
  const { snapshot, reference, bytes } = await imageCheckpoint();
  const options = {
    indexedDB: testIndexedDB(),
    cacheStorage: testCacheStorage(),
    crypto: webcrypto,
  };
  const first = new CloudParticipantCache({ ...options, uid: snapshot.access.uid });
  await first.writeCheckpoint(snapshot);
  await first.writeAsset(snapshot, reference, bytes);
  first.close();
  const cache = new CloudParticipantCache({ ...options, uid: snapshot.access.uid });
  const other = new CloudParticipantCache({ ...options, uid: 'cache-b' });
  const current = structuredClone(snapshot);
  current.access.accessGeneration++;
  current.viewKey = 'b'.repeat(64);
  current.generation++;
  try {
    expect(await cache.readCheckpointCandidate(current.access)).toEqual(snapshot);
    expect(await cache.readCheckpoint(current.access, current.viewKey)).toBeNull();
    expect(await cache.readAsset(current, reference)).toBeNull();
    expect(Buffer.from(await cache.readAuthorizedAsset(current, reference))).toEqual(bytes);
    expect(await cache.readAsset(current, reference)).toBeNull();
    const changed = { ...reference, generation: '2' };
    const replacement = {
      ...current,
      manifest: {
        version: 1,
        images: [
          {
            source: 'character',
            id: current.state.characterIds[0],
            field: 'portraitImage',
            reference: changed,
          },
        ],
      },
    };
    expect(await cache.readAuthorizedAsset(replacement, changed)).toBeNull();
    await expect(
      cache.readAuthorizedAsset({ ...current, manifest: { version: 1, images: [] } }, reference)
    ).rejects.toMatchObject({ code: 'invalid-cache-asset' });
    const differentAccount = {
      ...current,
      access: { ...current.access, uid: 'cache-b' },
    };
    expect(await other.readCheckpointCandidate(differentAccount.access)).toBeNull();
    expect(await other.readAuthorizedAsset(differentAccount, reference)).toBeNull();
    const differentCampaign = structuredClone(current);
    differentCampaign.access.campaignId = '44444444-4444-4444-8444-444444444444';
    differentCampaign.state.campaign.id = differentCampaign.access.campaignId;
    for (const slot of differentCampaign.manifest.images)
      slot.reference.campaignId = differentCampaign.access.campaignId;
    expect(await cache.readCheckpointCandidate(differentCampaign.access)).toBeNull();
    expect(
      await cache.readAuthorizedAsset(
        differentCampaign,
        differentCampaign.manifest.images[0].reference
      )
    ).toBeNull();
  } finally {
    cache.close();
    other.close();
  }
});

test('a cached authorized checkpoint survives reopening only within its UID, campaign, access and view namespace', async () => {
  const indexedDB = testIndexedDB();
  const snapshot = checkpoint();
  const first = new CloudParticipantCache({
    uid: snapshot.access.uid,
    indexedDB,
    crypto: webcrypto,
  });

  await first.writeCheckpoint(snapshot);
  first.close();
  const reopened = new CloudParticipantCache({
    uid: snapshot.access.uid,
    indexedDB,
    crypto: webcrypto,
  });
  const other = new CloudParticipantCache({ uid: 'cache-b', indexedDB, crypto: webcrypto });
  try {
    expect(await reopened.readCheckpoint(snapshot.access, snapshot.viewKey)).toEqual(snapshot);
    expect(
      await reopened.readCheckpoint({ ...snapshot.access, accessGeneration: 2 }, snapshot.viewKey)
    ).toBeNull();
    expect(await reopened.readCheckpoint(snapshot.access, 'b'.repeat(64))).toBeNull();
    expect(
      await other.readCheckpoint({ ...snapshot.access, uid: 'cache-b' }, snapshot.viewKey)
    ).toBeNull();
    const changedView = { ...snapshot, viewKey: 'b'.repeat(64) };
    await reopened.writeCheckpoint(changedView);
    await reopened.deleteCheckpoint(snapshot.access, snapshot.viewKey);
    expect(await reopened.readCheckpoint(snapshot.access, snapshot.viewKey)).toBeNull();
    expect(await reopened.readCheckpoint(snapshot.access, changedView.viewKey)).toEqual(
      changedView
    );
  } finally {
    reopened.close();
    other.close();
  }
});
