/** @jest-environment node */
import { createHash, webcrypto } from 'node:crypto';
import CloudParticipantAssets from '../../../src/campaigns/CloudParticipantAssets.js';
import CloudParticipantCache, {
  CloudParticipantCacheError,
} from '../../../src/campaigns/CloudParticipantCache.js';
import { emptyPlayerScene } from '../../../src/campaigns/PlayerPublicProtocol.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

function browserStorage() {
  const entries = new Map();
  const held = new Set();
  let pending = Promise.resolve();
  return {
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
    cacheStorage: {
      open: async () => ({
        put: async (request, response) =>
          entries.set(request.url, {
            bytes: new Uint8Array(await response.arrayBuffer()),
            headers: new Headers(response.headers),
          }),
        match: async (request) => {
          const entry = entries.get(request.url);
          return entry && new Response(entry.bytes.slice(), { headers: entry.headers });
        },
        delete: async (request) => entries.delete(request.url),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
      }),
    },
    locks: {
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
        pending = pending.then(run, run);
        return pending;
      },
      query: async () => ({ held: [...held], pending: [] }),
    },
  };
}

function fixture() {
  const bytes = Buffer.from('authorized participant image');
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const reference = {
    version: 1,
    campaignId,
    mimeType: 'image/png',
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    generation: '1',
    width: 1,
    height: 1,
  };
  const snapshot = {
    version: 1,
    access: {
      version: 1,
      uid: 'uid-a',
      campaignId,
      role: 'member',
      seatId: '22222222-2222-4222-8222-222222222222',
      accessGeneration: 1,
    },
    sessionId: '33333333-3333-4333-8333-333333333333',
    generation: 4,
    viewKey: 'a'.repeat(64),
    state: {
      campaign: {
        version: 1,
        id: campaignId,
        name: 'Authorized view',
        ruleset: '2014',
        coreVersion: '5.1',
        sourcePacks: [{ id: 'srd-2014', ruleset: '2014', version: '5.1-seed.1', enabled: true }],
        createdAt: '2026-11-14T00:00:00.000Z',
        charactersRevision: 1,
        sceneRevision: 0,
        sceneSavedAt: null,
      },
      revision: 1,
      sceneRevision: 0,
      sceneSavedAt: null,
      scene: null,
      records: [
        {
          key: 'taverntable.character.v1.hero',
          value: '{"id":"hero","portraitImage":null,"artworkImage":null}',
        },
      ],
      characterIds: ['hero'],
      observerTokenId: null,
      observers: [],
      maps: [],
      location: null,
      doors: [],
      publicScene: emptyPlayerScene(),
      gameplay: { version: 1, commands: [], ownedTokens: [], turn: null },
    },
    manifest: {
      version: 1,
      images: [
        { source: 'character', id: 'hero', field: 'portraitImage', reference },
        { source: 'character', id: 'hero', field: 'artworkImage', reference },
      ],
    },
  };
  const current = { uid: 'uid-a' };
  const store = {
    uid: current.uid,
    connection: { account: { identity: () => current } },
    readParticipantAsset: jest.fn(async () => new Uint8Array(bytes)),
  };
  const cache = {
    getUsage: jest.fn(async () => ({ crossTabCoordinated: true })),
    protectView: jest.fn(async () => async () => {}),
    writeCheckpoint: jest.fn(async () => ({ stored: true })),
    readAsset: jest.fn(async () => null),
    writeAsset: jest.fn(async () => ({ stored: true })),
    deleteAsset: jest.fn(async () => {}),
  };
  const statuses = [];
  const artwork = new CloudParticipantAssets({
    store,
    cache,
    onStatus: (status) => statuses.push(status),
  });
  return { artwork, store, cache, statuses, current, bytes, reference, snapshot };
}

test('denied browser cache storage reports an explicit warning and recovers only from authorized online image bytes', async () => {
  const setup = fixture();
  await setup.artwork.close();
  const cache = new CloudParticipantCache({ uid: setup.store.uid, indexedDB: null });
  const statuses = [];
  const artwork = new CloudParticipantAssets({
    store: setup.store,
    cache,
    onStatus: (status) => statuses.push(status),
  });
  try {
    await artwork.update(setup.snapshot);
    await artwork.loadCharacterImages('hero');
    expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(1);
    expect(artwork.characterImages('hero').portraitImage).toBe(
      `data:image/png;base64,${setup.bytes.toString('base64')}`
    );
    expect(statuses.at(-1)).toMatchObject({
      phase: 'ready',
      cache: { phase: 'unavailable', code: 'cache-unavailable' },
    });
    expect(JSON.parse(setup.snapshot.state.records[0].value).portraitImage).toBeNull();
  } finally {
    await artwork.close();
  }
});

test('a browser without cross-tab coordination cannot write past the shared account cache budget', async () => {
  const setup = fixture();
  setup.cache.getUsage.mockResolvedValue({ crossTabCoordinated: false });
  setup.cache.readCheckpointCandidate = jest.fn(async () => setup.snapshot);
  setup.cache.readAuthorizedAsset = jest.fn(async () => new Uint8Array(setup.bytes));
  try {
    expect(await setup.artwork.readCheckpointCandidate(setup.snapshot.access)).toBeNull();
    await setup.artwork.update(setup.snapshot);
    await setup.artwork.loadCharacterImages('hero');
    expect(setup.cache.writeCheckpoint).not.toHaveBeenCalled();
    expect(setup.cache.writeAsset).not.toHaveBeenCalled();
    expect(setup.cache.readAsset).not.toHaveBeenCalled();
    expect(setup.cache.readCheckpointCandidate).not.toHaveBeenCalled();
    expect(setup.cache.readAuthorizedAsset).not.toHaveBeenCalled();
    expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(1);
    expect(setup.statuses.at(-1)).toMatchObject({
      phase: 'ready',
      cache: { phase: 'unavailable', reason: 'cross-tab-coordination-unavailable' },
    });
  } finally {
    await setup.artwork.close();
  }
});

test.each(['readCheckpointCandidate', 'readAuthorizedAsset'])(
  'an untyped %s failure is not swallowed as a recoverable warm cache miss or grant',
  async (method) => {
    const setup = fixture();
    const error = new TypeError('PRIVATE CACHE IMPLEMENTATION FAILURE');
    setup.cache[method] = jest.fn(async () => {
      throw error;
    });
    try {
      if (method === 'readCheckpointCandidate')
        await expect(setup.artwork.readCheckpointCandidate(setup.snapshot.access)).rejects.toBe(
          error
        );
      else {
        await setup.artwork.update(setup.snapshot);
        await expect(setup.artwork.loadCharacterImages('hero')).rejects.toBe(error);
      }
      expect(setup.store.readParticipantAsset).not.toHaveBeenCalled();
      expect(setup.statuses.some((status) => status.cache)).toBe(false);
      expect(JSON.stringify(setup.statuses)).not.toContain(error.message);
    } finally {
      await setup.artwork.close();
    }
  }
);

test.each(['cache-corrupt', 'cache-quota-exceeded'])(
  'a %s cache failure cannot substitute unverified images or prevent explicit online recovery',
  async (code) => {
    const setup = fixture();
    const error = new CloudParticipantCacheError(code, 'PRIVATE STORAGE DIAGNOSTIC');
    if (code === 'cache-corrupt') setup.cache.readAsset.mockRejectedValueOnce(error);
    else setup.cache.writeAsset.mockRejectedValueOnce(error);
    try {
      await setup.artwork.update(setup.snapshot);
      await setup.artwork.loadCharacterImages('hero');
      expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(1);
      expect(setup.artwork.characterImages('hero').portraitImage).toBe(
        `data:image/png;base64,${setup.bytes.toString('base64')}`
      );
      if (code === 'cache-corrupt')
        expect(setup.cache.deleteAsset).toHaveBeenCalledWith(setup.snapshot, setup.reference);
      expect(setup.statuses.at(-1)).toMatchObject({ phase: 'ready', cache: { code } });
      expect(JSON.stringify(setup.statuses)).not.toContain('PRIVATE STORAGE DIAGNOSTIC');
    } finally {
      await setup.artwork.close();
    }
  }
);

test('progressive join deduplicates only authorized image references and keeps cached checkpoints and edits image-free', async () => {
  const setup = fixture();
  try {
    expect(setup.artwork.characterImages('hero')).toBeNull();
    await setup.artwork.update(setup.snapshot);
    expect(setup.store.readParticipantAsset).not.toHaveBeenCalled();
    await setup.artwork.loadCharacterImages('hero');
    const expected = `data:image/png;base64,${setup.bytes.toString('base64')}`;
    expect(setup.artwork.characterImages('hero')).toEqual({
      portraitImage: expected,
      artworkImage: expected,
    });
    expect(setup.artwork.characterImages('unassigned')).toBeNull();
    expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(1);
    expect(setup.cache.writeAsset).toHaveBeenCalledTimes(1);
    expect(setup.cache.writeCheckpoint.mock.calls[0][0]).toEqual(setup.snapshot);
    expect(JSON.parse(setup.snapshot.state.records[0].value).portraitImage).toBeNull();
    expect(setup.statuses.at(-1)).toMatchObject({ phase: 'ready', loaded: 1, total: 1 });
  } finally {
    await setup.artwork.close();
  }
});

test('cold then warm artwork reuses exact current-manifest bytes across access and view changes but redownloads a changed reference', async () => {
  const setup = fixture();
  await setup.artwork.close();
  const options = { ...browserStorage(), uid: setup.store.uid };
  const first = new CloudParticipantAssets({
    store: setup.store,
    cache: new CloudParticipantCache(options),
  });
  await first.update(setup.snapshot);
  await first.loadCharacterImages('hero');
  await first.close();
  const cache = new CloudParticipantCache(options);
  const artwork = new CloudParticipantAssets({ store: setup.store, cache });
  const current = structuredClone(setup.snapshot);
  current.access.accessGeneration++;
  current.viewKey = 'b'.repeat(64);
  current.generation++;
  try {
    await artwork.update(current);
    await artwork.loadCharacterImages('hero');
    expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(1);
    expect(Buffer.from(await cache.readAsset(current, setup.reference))).toEqual(setup.bytes);
    expect(artwork.characterImages('hero').portraitImage).toBe(
      `data:image/png;base64,${setup.bytes.toString('base64')}`
    );
    const replacement = structuredClone(current);
    replacement.viewKey = 'c'.repeat(64);
    replacement.generation++;
    for (const slot of replacement.manifest.images) slot.reference.generation = '2';
    await artwork.update(replacement);
    expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(2);
    expect(setup.store.readParticipantAsset.mock.calls[1][1]).toEqual(replacement);
    expect(
      JSON.parse(
        (await cache.readCheckpoint(current.access, current.viewKey)).state.records[0].value
      ).portraitImage
    ).toBeNull();
  } finally {
    await artwork.close();
  }
});

test.each(['replaced', 'invalidated'])(
  'a %s authorized view cancels its idle download and cannot publish or cache late old bytes',
  async (change) => {
    const setup = fixture();
    let complete;
    let signal;
    setup.store.readParticipantAsset.mockImplementationOnce(
      (_id, _snapshot, _reference, options) => {
        signal = options.signal;
        return new Promise((resolve) => {
          complete = () => resolve(new Uint8Array(setup.bytes));
        });
      }
    );
    await setup.artwork.update(setup.snapshot);
    const first = setup.artwork.loadCharacterImages('hero');
    for (let step = 0; step < 20 && !signal; step++) await Promise.resolve();
    expect(signal).toBeDefined();
    const next = structuredClone(setup.snapshot);
    next.viewKey = 'b'.repeat(64);
    next.generation++;
    next.manifest.images = [];
    if (change === 'replaced') await setup.artwork.update(next);
    else setup.artwork.invalidate();
    expect(signal.aborted).toBe(true);
    complete();
    await first;
    expect(setup.cache.writeAsset).not.toHaveBeenCalled();
    expect(setup.artwork.characterImages('hero')).toBeNull();
    await setup.artwork.close();
  }
);
