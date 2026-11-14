/** @jest-environment node */
import { createHash } from 'node:crypto';
import CloudParticipantAssets from '../../../src/campaigns/CloudParticipantAssets.js';
import CloudParticipantCache, {
  CloudParticipantCacheError,
} from '../../../src/campaigns/CloudParticipantCache.js';
import { emptyPlayerScene } from '../../../src/campaigns/PlayerPublicProtocol.js';

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
  try {
    await setup.artwork.update(setup.snapshot);
    await setup.artwork.loadCharacterImages('hero');
    expect(setup.cache.writeCheckpoint).not.toHaveBeenCalled();
    expect(setup.cache.writeAsset).not.toHaveBeenCalled();
    expect(setup.cache.readAsset).not.toHaveBeenCalled();
    expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(1);
    expect(setup.statuses.at(-1)).toMatchObject({
      phase: 'ready',
      cache: { phase: 'unavailable', reason: 'cross-tab-coordination-unavailable' },
    });
  } finally {
    await setup.artwork.close();
  }
});

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
