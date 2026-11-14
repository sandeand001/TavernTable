/** @jest-environment node */
import { webcrypto, createHash } from 'node:crypto';
import sharp from 'sharp';
import CloudParticipantCache from '../../../src/campaigns/CloudParticipantCache.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
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

function testCacheStorage() {
  const stores = new Map();
  return {
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        put: async (request, response) => {
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
  const database = await openDatabase(indexedDB, name, () => {});
  try {
    await transact(database, ['checkpoints'], 'readwrite', async (transaction) => {
      const store = transaction.objectStore('checkpoints');
      const [row] = await requestResult(store.getAll());
      const payload = JSON.parse(row.payload);
      payload.signedUrl = 'https://unrelated.example.invalid/?token=not-a-credential';
      row.payload = JSON.stringify(payload);
      row.bytes = new TextEncoder().encode(row.payload).byteLength;
      row.sha256 = createHash('sha256').update(row.payload).digest('hex');
      await requestResult(store.put(row));
    });
    await expect(cache.readCheckpoint(snapshot.access, snapshot.viewKey)).rejects.toMatchObject({
      code: 'cache-corrupt',
    });
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
