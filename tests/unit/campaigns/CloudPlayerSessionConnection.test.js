/** @jest-environment node */
import { createHash, webcrypto } from 'node:crypto';
import CloudPlayerSessionConnection from '../../../src/campaigns/CloudPlayerSessionConnection.js';
import CloudParticipantCache from '../../../src/campaigns/CloudParticipantCache.js';
import { applyCloudParticipantDelta } from '../../../src/campaigns/CloudParticipantProtocol.js';
import { sceneState } from '../../helpers/sceneState.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { participantStorage } from '../../helpers/participantStorage.js';

const campaignId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const access = {
  version: 1,
  uid: 'player-a',
  campaignId,
  role: 'member',
  seatId: '33333333-3333-4333-8333-333333333333',
  accessGeneration: 1,
};
const bytes = Buffer.from('authorized portrait');
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

function snapshot() {
  const campaign = {
    version: 1,
    id: campaignId,
    name: 'Player artwork',
    ruleset: '2014',
    coreVersion: '5.1',
    sourcePacks: [{ id: 'srd-2014', ruleset: '2014', version: '5.1-seed.1', enabled: true }],
    createdAt: '2026-11-14T00:00:00.000Z',
    charactersRevision: 1,
    sceneRevision: 1,
    sceneSavedAt: '2026-11-14T00:00:00.000Z',
  };
  const location = { id: 'site', name: 'Courtyard' };
  return {
    version: 1,
    access: { ...access },
    sessionId,
    generation: 1,
    viewKey: 'a'.repeat(64),
    state: {
      campaign,
      revision: 1,
      sceneRevision: 1,
      sceneSavedAt: campaign.sceneSavedAt,
      records: ['hero', 'reserve'].map((id) => ({
        key: `taverntable.character.v1.${id}`,
        value: JSON.stringify({ id, name: id, portraitImage: null, artworkImage: null }),
      })),
      characterIds: ['hero', 'reserve'],
      scene: null,
      observerTokenId: 'hero-token',
      observers: [{ id: 'hero-token', name: 'Hero', characterId: 'hero' }],
      maps: [{ id: 'main', name: 'Courtyard' }],
      location,
      doors: [],
      gameplay: {
        version: 1,
        commands: ['move'],
        ownedTokens: [
          {
            tokenId: 'hero-token',
            mapId: 'main',
            availability: { move: { allowed: true, code: 'allowed' } },
            movement: { spentFeet: 0, remainingFeet: 30, allowanceFeet: 30 },
            economy: {
              actions: 1,
              bonusActions: 1,
              reactions: 1,
              restrictedActions: [],
              attacksRemaining: 0,
              attacksAvailable: 1,
              bonusAttacksRemaining: 0,
            },
            availableActions: [],
            canUndo: false,
          },
        ],
        turn: null,
      },
      publicScene: {
        version: 1,
        assetKey: 'view-assets',
        assets: {
          location,
          maps: [
            {
              id: 'main',
              name: 'Courtyard',
              locationId: location.id,
              originFeet: { x: 0, y: 0, z: 0 },
              quarterTurns: 0,
              base: 'ground',
              grid: { cols: 5, rows: 5, tileWorldSize: 1 },
              terrain: sceneState().terrain,
            },
          ],
          connections: [],
        },
        presentation: { mapId: 'main', focusTokenId: 'hero-token' },
        actors: [
          {
            id: 'hero-token',
            name: 'Hero',
            type: 'mannequin',
            mapId: 'main',
            gridX: 1,
            gridY: 1,
            owned: true,
            characterId: 'hero',
            portraitImage: null,
            facingAngle: 0,
            pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
            movement: { mode: 'walk', type: 'default' },
            flags: { prone: false, flightActive: false },
          },
        ],
        updates: [],
      },
    },
    manifest: {
      version: 1,
      images: [
        { source: 'actor', id: 'hero-token', field: 'portraitImage', reference },
        {
          source: 'character',
          id: 'reserve',
          field: 'artworkImage',
          reference: { ...reference, generation: '2' },
        },
      ],
    },
  };
}

function fixture({ cache = null } = {}) {
  let identity = { uid: access.uid };
  const identityListeners = new Set();
  const requests = [];
  const observations = [];
  let markRequested;
  const requested = new Promise((resolve) => {
    markRequested = resolve;
  });
  let opened;
  const observed = new Promise((resolve) => {
    opened = resolve;
  });
  const account = {
    identity: () => identity,
    subscribe: (listener) => {
      identityListeners.add(listener);
      listener(identity);
      return () => identityListeners.delete(listener);
    },
    signOut: async () => {},
  };
  const store = {
    uid: access.uid,
    connection: { account },
    readParticipantSnapshot: jest.fn(async () => snapshot()),
    readParticipantAsset: jest.fn((_id, raw, image, { signal }) => {
      return new Promise((resolve, reject) => {
        const abort = () => reject(Object.assign(new Error('Cancelled'), { name: 'AbortError' }));
        signal.addEventListener('abort', abort, { once: true });
        requests.push({
          raw,
          image,
          signal,
          resolve: () => {
            signal.removeEventListener('abort', abort);
            resolve(new Uint8Array(bytes));
          },
        });
        markRequested();
      });
    }),
    commitWorldCommand: jest.fn(),
    commitAssignedCharacters: jest.fn(),
    observeEvents: jest.fn((_id, _view, _access, callbacks) => {
      let ready;
      const observation = {
        ...callbacks,
        ready: new Promise((resolve) => {
          ready = resolve;
        }),
        done: Promise.resolve(),
        close: jest.fn(async () => ready()),
        publish: (raw, context = { reconcile: true }) => {
          const result = callbacks.onState(raw, context);
          callbacks.onStatus({ phase: 'ready' });
          ready();
          return result;
        },
      };
      observations.push(observation);
      opened();
      return observation;
    }),
  };
  const connection = new CloudPlayerSessionConnection({
    store,
    campaignId,
    access,
    sessionId,
    cache,
  });
  const events = [];
  connection.subscribe((event) => events.push(event));
  return {
    connection,
    store,
    requests,
    observations,
    requested,
    observed,
    events,
    changeIdentity: (next) => {
      identity = next;
      for (const listener of identityListeners) listener(next);
    },
  };
}

test.each(['logout', 'account replacement'])(
  '%s aborts old artwork before purging all private UID namespaces and never purges another UID',
  async (transition) => {
    const storage = participantStorage();
    const cached = snapshot();
    cached.state.publicScene.assetKey = createHash('sha256')
      .update(JSON.stringify(cached.state.publicScene.assets))
      .digest('hex');
    const historical = structuredClone(cached);
    historical.viewKey = 'c'.repeat(64);
    const foreign = structuredClone(cached);
    foreign.access.uid = 'other-uid';
    const cache = new CloudParticipantCache({ ...storage, uid: access.uid });
    const other = new CloudParticipantCache({ ...storage, uid: foreign.access.uid });
    const checking = new CloudParticipantCache({ ...storage, uid: access.uid });
    const setup = fixture({ cache });
    let opening;
    try {
      for (const raw of [cached, historical]) {
        await cache.writeCheckpoint(raw);
        await cache.writeAsset(raw, reference, bytes);
      }
      await other.writeCheckpoint(foreign);
      await other.writeAsset(foreign, reference, bytes);
      opening = setup.connection.open({ observerTokenId: 'hero-token' });
      void opening.catch(() => {});
      await setup.observed;
      const raw = structuredClone(cached);
      raw.manifest.images[0].reference.generation = '3';
      setup.observations[0].publish(raw);
      await setup.requested;
      expect(setup.requests).toHaveLength(1);
      let loggingOut;
      if (transition === 'logout') loggingOut = setup.connection.logout();
      else {
        setup.changeIdentity({ uid: foreign.access.uid });
        loggingOut = setup.connection.close();
      }
      expect(setup.requests[0].signal.aborted).toBe(true);
      expect(setup.connection.commandReady).toBe(false);
      await loggingOut;
      setup.requests[0].resolve();
      expect(await checking.getUsage()).toMatchObject({
        bytes: 0,
        assetCount: 0,
        checkpointCount: 0,
      });
      expect(await checking.readCheckpointCandidate(cached.access)).toBeNull();
      expect(await checking.readAuthorizedAsset(cached, reference)).toBeNull();
      expect(await checking.readAuthorizedAsset(historical, reference)).toBeNull();
      expect(await other.readCheckpoint(foreign.access, foreign.viewKey)).toEqual(foreign);
      expect(Buffer.from(await other.readAsset(foreign, reference))).toEqual(bytes);
      expect(() => setup.connection.readLiveState()).toThrow();
      expect(setup.events.filter(({ type }) => type === 'artwork')).toHaveLength(0);
    } finally {
      for (const request of setup.requests) request.resolve();
      await setup.connection.close();
      await opening?.catch(() => {});
      checking.close();
      other.close();
    }
  }
);

test('membership loss during a warm HTTP rejoin purges historical campaign views but preserves another campaign for the same UID', async () => {
  const storage = participantStorage();
  const cached = snapshot();
  cached.state.publicScene.assetKey = createHash('sha256')
    .update(JSON.stringify(cached.state.publicScene.assets))
    .digest('hex');
  const historical = structuredClone(cached);
  historical.access.accessGeneration++;
  historical.viewKey = 'c'.repeat(64);
  const unrelated = structuredClone(cached);
  unrelated.access.campaignId = '55555555-5555-4555-8555-555555555555';
  unrelated.state.campaign.id = unrelated.access.campaignId;
  for (const slot of unrelated.manifest.images)
    slot.reference.campaignId = unrelated.access.campaignId;
  const cache = new CloudParticipantCache({ ...storage, uid: access.uid });
  const checking = new CloudParticipantCache({ ...storage, uid: access.uid });
  const setup = fixture({ cache });
  const denial = Object.assign(new Error('Current membership changed'), {
    status: 409,
    code: 'campaign-access-changed',
  });
  setup.store.readParticipantSnapshot.mockRejectedValueOnce(denial);
  try {
    for (const raw of [cached, historical, unrelated]) {
      await cache.writeCheckpoint(raw);
      await cache.writeAsset(raw, raw.manifest.images[0].reference, bytes);
    }
    await expect(setup.connection.open()).rejects.toBe(denial);
    expect(setup.connection.commandReady).toBe(false);
    await setup.connection.close();
    expect(await checking.readCheckpointCandidate(cached.access)).toBeNull();
    expect(await checking.readAuthorizedAsset(cached, reference)).toBeNull();
    expect(await checking.readAuthorizedAsset(historical, reference)).toBeNull();
    expect(await checking.readCheckpoint(unrelated.access, unrelated.viewKey)).toEqual(unrelated);
    expect(
      Buffer.from(await checking.readAsset(unrelated, unrelated.manifest.images[0].reference))
    ).toEqual(bytes);
    expect(await checking.getUsage()).toMatchObject({ checkpointCount: 1, assetCount: 1 });
    expect(setup.store.observeEvents).not.toHaveBeenCalled();
  } finally {
    await setup.connection.close();
    checking.close();
  }
});

test('reopening a superseded observer view purges old checkpoints and historical byte reuse before admitting the replacement', async () => {
  const storage = participantStorage();
  const cached = snapshot();
  cached.state.publicScene.assetKey = createHash('sha256')
    .update(JSON.stringify(cached.state.publicScene.assets))
    .digest('hex');
  const historical = structuredClone(cached);
  historical.viewKey = 'c'.repeat(64);
  const cache = new CloudParticipantCache({ ...storage, uid: access.uid });
  const setup = fixture({ cache });
  setup.store.readParticipantAsset.mockResolvedValue(new Uint8Array(bytes));
  let opening;
  let replacing;
  try {
    for (const raw of [cached, historical]) {
      await cache.writeCheckpoint(raw);
      await cache.writeAsset(raw, reference, bytes);
    }
    opening = setup.connection.open({ observerTokenId: 'hero-token' });
    await setup.observed;
    setup.observations[0].publish(cached);
    await opening;
    expect(setup.connection.commandReady).toBe(true);
    replacing = setup.connection.open({ observerTokenId: 'hero-token', mapId: 'side' });
    for (let step = 0; step < 100 && setup.observations.length < 2; step++)
      await new Promise((resolve) => setImmediate(resolve));
    expect(setup.observations).toHaveLength(2);
    expect(await cache.readCheckpoint(cached.access, cached.viewKey)).toBeNull();
    expect(await cache.readCheckpoint(historical.access, historical.viewKey)).toBeNull();
    const next = structuredClone(cached);
    next.viewKey = 'b'.repeat(64);
    next.generation++;
    next.manifest.images[0].reference.generation = '3';
    next.state.maps[0].id = 'side';
    next.state.publicScene.assets.maps[0].id = 'side';
    next.state.publicScene.presentation.mapId = 'side';
    next.state.publicScene.actors[0].mapId = 'side';
    next.state.gameplay.ownedTokens[0].mapId = 'side';
    next.state.publicScene.assetKey = createHash('sha256')
      .update(JSON.stringify(next.state.publicScene.assets))
      .digest('hex');
    expect(setup.observations[1].publish(next)).toBeUndefined();
    expect(setup.connection.commandReady).toBe(false);
    await replacing;
    expect(await cache.readCheckpoint(cached.access, cached.viewKey)).toBeNull();
    expect(await cache.readCheckpoint(historical.access, historical.viewKey)).toBeNull();
    expect(await cache.readAuthorizedAsset(cached, reference)).toBeNull();
    expect(await cache.getUsage()).toMatchObject({ checkpointCount: 1, assetCount: 1 });
    expect(setup.store.readParticipantAsset).toHaveBeenCalledTimes(1);
    expect(setup.connection.commandReady).toBe(true);
  } finally {
    await setup.connection.close();
    await Promise.all([opening?.catch(() => {}), replacing?.catch(() => {})]);
  }
});

test('a rejected warm observer hint is purged before the fresh unhinted authority lookup and cannot remain a historical byte source', async () => {
  const storage = participantStorage();
  const cached = snapshot();
  cached.state.publicScene.assetKey = createHash('sha256')
    .update(JSON.stringify(cached.state.publicScene.assets))
    .digest('hex');
  const next = structuredClone(cached);
  next.viewKey = 'b'.repeat(64);
  next.generation++;
  next.state.maps[0].id = 'side';
  next.state.publicScene.assets.maps[0].id = 'side';
  next.state.publicScene.presentation.mapId = 'side';
  next.state.publicScene.actors[0].mapId = 'side';
  next.state.gameplay.ownedTokens[0].mapId = 'side';
  next.manifest.images[0].reference.generation = '3';
  next.state.publicScene.assetKey = createHash('sha256')
    .update(JSON.stringify(next.state.publicScene.assets))
    .digest('hex');
  const cache = new CloudParticipantCache({ ...storage, uid: access.uid });
  const checking = new CloudParticipantCache({ ...storage, uid: access.uid });
  const setup = fixture({ cache });
  let bytesAtRetry;
  setup.store.readParticipantSnapshot
    .mockRejectedValueOnce(
      Object.assign(new Error('Old observer map is no longer authorized'), {
        status: 403,
        code: 'participant-view-forbidden',
      })
    )
    .mockImplementationOnce(async () => {
      bytesAtRetry = (await checking.getUsage()).bytes;
      return next;
    });
  setup.store.readParticipantAsset.mockResolvedValue(new Uint8Array(bytes));
  let opening;
  try {
    await cache.writeCheckpoint(cached);
    await cache.writeAsset(cached, reference, bytes);
    opening = setup.connection.open();
    void opening.catch(() => {});
    await setup.observed;
    expect(bytesAtRetry).toBe(0);
    setup.observations[0].publish(next);
    await opening;
    expect(setup.store.readParticipantSnapshot.mock.calls[1][1]).toEqual({
      sessionId,
      observerTokenId: null,
      mapId: null,
      assetKey: null,
    });
    expect(await checking.readCheckpoint(cached.access, cached.viewKey)).toBeNull();
    expect(await checking.readAuthorizedAsset(cached, reference)).toBeNull();
    expect(setup.connection.commandReady).toBe(true);
  } finally {
    await setup.connection.close();
    await opening?.catch(() => {});
    checking.close();
  }
});

test('connection loss blocks both gameplay and sheet mutations until a fresh reconciled online checkpoint, not a ready status alone', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const browser = new EventTarget();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: browser });
  const setup = fixture();
  const opening = setup.connection.open({ observerTokenId: 'hero-token' });
  await setup.observed;
  try {
    setup.observations[0].publish(snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    setup.requests[0].resolve();
    await opening;
    expect(setup.connection.commandReady).toBe(true);
    browser.dispatchEvent(new Event('offline'));
    expect(setup.connection.commandReady).toBe(false);
    setup.observations[0].onStatus({ phase: 'reconnecting', reason: 'cloud-stream-unavailable' });
    expect(setup.connection.commandReady).toBe(false);
    for (const [operation, change] of [
      ['playerCommand', { kind: 'move' }],
      ['playerCommit', { revision: 1, records: [] }],
    ])
      await expect(setup.connection.call(operation, [campaignId, change])).rejects.toMatchObject({
        code: 'world-state-unavailable',
      });
    expect(setup.store.commitWorldCommand).not.toHaveBeenCalled();
    expect(setup.store.commitAssignedCharacters).not.toHaveBeenCalled();
    browser.dispatchEvent(new Event('online'));
    setup.observations[0].onStatus({ phase: 'ready' });
    expect(setup.connection.commandReady).toBe(false);
    const artworkReady = new Promise((resolve) => {
      const stop = setup.connection.subscribe((event) => {
        if (event.type !== 'assets-status' || event.status.phase !== 'ready') return;
        stop();
        resolve();
      });
    });
    setup.observations[0].publish(snapshot(), { reconcile: true });
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.connection.commandReady).toBe(false);
    setup.requests[1].resolve();
    await artworkReady;
    expect(setup.connection.commandReady).toBe(true);
  } finally {
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await opening.catch(() => {});
    if (previous) Object.defineProperty(globalThis, 'window', previous);
    else delete globalThis.window;
  }
});

test('a replacement selection cancels its in-flight HTTP authority lookup and ignores an uncooperative late old response', async () => {
  const setup = fixture();
  let signal;
  let resume;
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  setup.store.readParticipantSnapshot.mockImplementationOnce((_id, _view, _scope, options) => {
    signal = options.signal;
    requested();
    return new Promise((resolve) => {
      resume = () => resolve(snapshot());
    });
  });
  const first = setup.connection.open();
  const outcome = first.catch((error) => error);
  let replacing;
  try {
    await started;
    replacing = setup.connection.open({ observerTokenId: 'hero-token' });
    expect(signal?.aborted).toBe(true);
    await setup.observed;
    setup.observations[0].publish(snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    resume();
    expect(await outcome).toMatchObject({ code: 'live-session-changed' });
    setup.requests[0].resolve();
    await replacing;
    expect(setup.connection.commandReady).toBe(true);
    expect(setup.events.filter(({ type }) => type === 'state')).toHaveLength(1);
  } finally {
    resume?.();
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await Promise.all([outcome, replacing?.catch(() => {})]);
  }
});

test('fresh authority publishes synchronously while first-view artwork gates gameplay without preloading other sheets', async () => {
  const setup = fixture();
  const opening = setup.connection.open({ observerTokenId: 'hero-token' });
  await setup.observed;
  const raw = snapshot();
  try {
    expect(setup.observations[0].publish(raw)).toBeUndefined();
    expect(setup.events.filter(({ type }) => type === 'state')).toHaveLength(1);
    expect(setup.connection.readLiveState().sceneRevision).toBe(1);
    expect(setup.connection.commandReady).toBe(false);
    await expect(
      setup.connection.call('playerCommand', [campaignId, { kind: 'move' }])
    ).rejects.toMatchObject({ code: 'participant-assets-loading' });
    expect(setup.store.commitWorldCommand).not.toHaveBeenCalled();
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.requests).toHaveLength(1);
    expect(setup.requests[0].image).toEqual(reference);
    expect(setup.events).toContainEqual(
      expect.objectContaining({
        type: 'assets-status',
        status: expect.objectContaining({ phase: 'loading' }),
      })
    );
    setup.requests[0].resolve();
    const state = await opening;
    expect(state.publicScene.actors[0].portraitImage).toMatch(/^data:image\/png;base64,/);
    expect(setup.connection.commandReady).toBe(true);
    expect(setup.events.filter(({ type }) => type === 'state')).toHaveLength(1);
    expect(setup.events).toContainEqual(expect.objectContaining({ type: 'artwork' }));
    expect(raw.state.publicScene.actors[0].portraitImage).toBeNull();
    expect(JSON.parse(raw.state.records[0].value).portraitImage).toBeNull();
  } finally {
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await opening.catch(() => {});
  }
});

test('warm rejoin sends only checkpoint view hints and admits commands only after fresh HTTP, synchronous SSE authority and verified artwork', async () => {
  const cached = snapshot();
  cached.state.publicScene.assetKey = createHash('sha256')
    .update(JSON.stringify(cached.state.publicScene.assets))
    .digest('hex');
  const current = structuredClone(cached);
  current.generation++;
  current.state.sceneRevision++;
  current.state.campaign.sceneRevision++;
  current.state.publicScene.assets = null;
  const cache = {
    getUsage: jest.fn(async () => ({ crossTabCoordinated: true })),
    readCheckpointCandidate: jest.fn(async () => cached),
    protectView: jest.fn(async () => async () => {}),
    readAsset: jest.fn(async () => null),
    readAuthorizedAsset: jest.fn(async () => new Uint8Array(bytes)),
    writeAsset: jest.fn(async () => ({ stored: true })),
    deleteAsset: jest.fn(async () => {}),
    writeCheckpoint: jest.fn(async () => ({ stored: true })),
  };
  const setup = fixture({ cache });
  let authorize;
  setup.store.readParticipantSnapshot.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        authorize = resolve;
      })
  );
  setup.store.readParticipantAsset.mockResolvedValue(new Uint8Array(bytes));
  const opening = setup.connection.open();
  try {
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.store.readParticipantSnapshot).toHaveBeenCalledWith(
      campaignId,
      {
        sessionId,
        observerTokenId: 'hero-token',
        mapId: 'main',
        assetKey: cached.state.publicScene.assetKey,
      },
      access,
      expect.objectContaining({ cachedAssets: cached.state.publicScene.assets })
    );
    expect(cache.readCheckpointCandidate).toHaveBeenCalledWith(access);
    expect(setup.events.filter(({ type }) => type === 'state')).toHaveLength(0);
    expect(setup.connection.commandReady).toBe(false);
    await expect(
      setup.connection.call('playerCommand', [campaignId, { kind: 'move' }])
    ).rejects.toMatchObject({ code: 'world-state-unavailable' });
    authorize(current);
    await setup.observed;
    expect(setup.store.observeEvents.mock.calls[0][1]).toEqual({
      sessionId,
      observerTokenId: 'hero-token',
      mapId: 'main',
      assetKey: cached.state.publicScene.assetKey,
    });
    expect(setup.observations[0].publish(current)).toBeUndefined();
    expect(setup.connection.readLiveState().sceneRevision).toBe(2);
    expect(setup.connection.commandReady).toBe(false);
    const state = await opening;
    expect(state.sceneRevision).toBe(2);
    expect(state.publicScene.updates).toEqual([]);
    expect(setup.connection.commandReady).toBe(true);
    expect(setup.store.readParticipantAsset).not.toHaveBeenCalled();
    expect(setup.store.commitWorldCommand).not.toHaveBeenCalled();
    expect(setup.events.filter(({ type }) => type === 'state')).toHaveLength(1);
    expect(cache.readAuthorizedAsset.mock.calls[0][0].generation).toBe(current.generation);
  } finally {
    authorize?.(current);
    await setup.connection.close();
    await opening.catch(() => {});
  }
});

test('clearing a UID during warm graphic verification invalidates the candidate instead of returning a stale rejoin hint', async () => {
  const cached = snapshot();
  const graphicBytes = Buffer.from(JSON.stringify(cached.state.publicScene.assets));
  cached.state.publicScene.assetKey = createHash('sha256').update(graphicBytes).digest('hex');
  const indexedDB = testIndexedDB();
  let hashing;
  let resume;
  const started = new Promise((resolve) => {
    hashing = resolve;
  });
  const resumed = new Promise((resolve) => {
    resume = resolve;
  });
  const writer = new CloudParticipantCache({ uid: access.uid, indexedDB, crypto: webcrypto });
  const reader = new CloudParticipantCache({
    uid: access.uid,
    indexedDB,
    crypto: {
      subtle: {
        digest: async (algorithm, input) => {
          if (input.byteLength === graphicBytes.length) {
            hashing();
            await resumed;
          }
          return webcrypto.subtle.digest(algorithm, input);
        },
      },
    },
  });
  let candidate;
  try {
    await writer.writeCheckpoint(cached);
    candidate = reader.readCheckpointCandidate(access).then(
      (value) => ({ value }),
      (error) => ({ error })
    );
    await started;
    const cleared = writer.clear();
    resume();
    expect((await candidate).error?.code).toBe('cache-invalidated');
    await cleared;
    expect(await writer.readCheckpointCandidate(access)).toBeNull();
  } finally {
    resume();
    await candidate;
    writer.close();
    reader.close();
  }
});

test('an account replacement immediately aborts required artwork and ends the old player authority', async () => {
  const setup = fixture();
  const opening = setup.connection.open({ observerTokenId: 'hero-token' });
  const outcome = opening.then(
    () => null,
    (error) => error
  );
  await setup.observed;
  try {
    setup.observations[0].publish(snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.requests).toHaveLength(1);
    setup.changeIdentity({ uid: 'player-b' });
    expect(setup.requests[0].signal.aborted).toBe(true);
    expect(setup.connection.commandReady).toBe(false);
    expect(setup.events).toContainEqual(
      expect.objectContaining({
        type: 'access-ended',
        error: expect.objectContaining({ code: 'account-changed' }),
      })
    );
    setup.requests[0].resolve();
    expect(await outcome).toMatchObject({ code: 'account-changed' });
    expect(setup.events.filter(({ type }) => type === 'artwork')).toHaveLength(0);
  } finally {
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await opening.catch(() => {});
  }
});

test.each([
  ['access', 'campaign-access-changed'],
  ['session', 'live-session-changed'],
  ['terminal', 'campaign-access-changed'],
])(
  '%s replacement cancels old artwork rather than reusing the old player binding',
  async (replacement, code) => {
    const setup = fixture();
    const opening = setup.connection.open({ observerTokenId: 'hero-token' });
    const outcome = opening.then(
      () => null,
      (error) => error
    );
    await setup.observed;
    try {
      setup.observations[0].publish(snapshot());
      await new Promise((resolve) => setImmediate(resolve));
      const next = snapshot();
      if (replacement === 'access') next.access.accessGeneration++;
      else if (replacement === 'session') next.sessionId = '44444444-4444-4444-8444-444444444444';
      if (replacement === 'terminal')
        setup.observations[0].onStatus({ phase: 'denied', reason: code });
      else setup.observations[0].publish(next);
      expect(setup.requests[0].signal.aborted).toBe(true);
      expect(setup.events).toContainEqual(
        expect.objectContaining({
          type: 'access-ended',
          error: expect.objectContaining({ code }),
        })
      );
      setup.requests[0].resolve();
      expect(await outcome).toMatchObject({ code });
      expect(setup.connection.commandReady).toBe(false);
    } finally {
      for (const request of setup.requests) request.resolve();
      await setup.connection.close();
      await opening.catch(() => {});
    }
  }
);

test('opening a replacement view aborts immediately and late old images cannot republish state or admit the old selection', async () => {
  const setup = fixture();
  const first = setup.connection.open({ observerTokenId: 'hero-token' });
  const oldOutcome = first.then(
    () => null,
    (error) => error
  );
  let replacing;
  await setup.observed;
  try {
    setup.observations[0].publish(snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    replacing = setup.connection.open({ observerTokenId: 'hero-token', mapId: 'main' });
    expect(setup.requests[0].signal.aborted).toBe(true);
    for (let step = 0; step < 20 && setup.observations.length < 2; step++) await Promise.resolve();
    expect(setup.observations).toHaveLength(2);
    const next = snapshot();
    next.viewKey = 'b'.repeat(64);
    next.generation++;
    next.state.sceneRevision++;
    next.state.campaign.sceneRevision++;
    next.state.publicScene.assetKey = 'replacement-assets';
    setup.observations[1].publish(next);
    setup.observations[0].publish(snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.requests).toHaveLength(2);
    setup.requests[0].resolve();
    expect(await oldOutcome).toMatchObject({ code: 'live-session-changed' });
    expect(setup.connection.commandReady).toBe(false);
    setup.requests[1].resolve();
    const state = await replacing;
    expect(state.sceneRevision).toBe(2);
    expect(setup.connection.commandReady).toBe(true);
    expect(setup.events.filter(({ type }) => type === 'state')).toHaveLength(2);
    expect(
      setup.events
        .filter(({ type }) => type === 'artwork')
        .every(({ state: artwork }) => artwork.sceneRevision === 2)
    ).toBe(true);
  } finally {
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await Promise.all([first.catch(() => {}), replacing?.catch(() => {})]);
  }
});

test('an initial join follows a newer observed view instead of admitting or waiting on its superseded required artwork', async () => {
  const setup = fixture();
  const opening = setup.connection.open({ observerTokenId: 'hero-token' });
  const outcome = opening.then(
    (state) => ({ state }),
    (error) => ({ error })
  );
  await setup.observed;
  try {
    setup.observations[0].publish(snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    const next = snapshot();
    next.viewKey = 'b'.repeat(64);
    next.generation++;
    next.state.sceneRevision++;
    next.state.campaign.sceneRevision++;
    next.state.publicScene.assetKey = 'new-observed-assets';
    expect(setup.observations[0].publish(next)).toBeUndefined();
    expect(setup.requests[0].signal.aborted).toBe(true);
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.requests).toHaveLength(2);
    expect(setup.connection.commandReady).toBe(false);
    setup.requests[1].resolve();
    const result = await outcome;
    expect(result.error).toBeUndefined();
    expect(result.state.sceneRevision).toBe(2);
    expect(setup.connection.commandReady).toBe(true);
    expect(setup.events.filter(({ type }) => type === 'state')).toHaveLength(2);
    expect(
      setup.events
        .filter(({ type }) => type === 'artwork')
        .every(({ viewKey }) => viewKey === next.viewKey)
    ).toBe(true);
  } finally {
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await opening.catch(() => {});
  }
});

test('a same-observer terrain refresh can carry an approved ground route but not a mismatched origin', () => {
  const first = snapshot();
  const second = snapshot();
  const { mapId, gridX, gridY, facingAngle, pose } = first.state.publicScene.actors[0];
  const from = { mapId, gridX, gridY, facingAngle, pose };
  const destination = {
    ...from,
    gridX: 2,
    pose: { ...pose, world: { ...pose.world, x: 2.5 } },
  };
  second.generation++;
  second.viewKey = 'b'.repeat(64);
  second.state.sceneRevision++;
  second.state.campaign.sceneRevision++;
  second.state.publicScene.assetKey = 'refreshed-assets';
  Object.assign(second.state.publicScene.actors[0], destination);
  const delta = {
    version: 1,
    access,
    sessionId,
    kind: 'replace',
    baseGeneration: first.generation,
    generation: second.generation,
    viewKey: second.viewKey,
    checkpoint: second,
    presentations: [
      {
        kind: 'move',
        tokenId: 'hero-token',
        commandId: '55555555-5555-4555-8555-555555555555',
        sceneRevision: 2,
        charactersRevision: 1,
        motion: { kind: 'walk', completed: true, from, route: [destination] },
      },
    ],
  };
  expect(applyCloudParticipantDelta(first, delta)).toEqual(second);
  const differentOrigin = structuredClone(delta);
  differentOrigin.presentations[0].motion.from = destination;
  expect(() => applyCloudParticipantDelta(first, differentOrigin)).toThrow(
    'The authorized participant checkpoint could not be verified'
  );
});

test('a committed Free Roam reply starts the owned route before the observation catches up', async () => {
  const setup = fixture();
  const opening = setup.connection.open({ observerTokenId: 'hero-token' });
  let sending;
  await setup.observed;
  try {
    const before = snapshot();
    setup.observations[0].publish(before);
    await new Promise((resolve) => setImmediate(resolve));
    setup.requests[0].resolve();
    await opening;
    const { mapId, gridX, gridY, facingAngle, pose } = before.state.publicScene.actors[0];
    const from = { mapId, gridX, gridY, facingAngle, pose };
    const destination = {
      ...from,
      gridX: 2,
      pose: { ...pose, world: { ...pose.world, x: 2.5 } },
    };
    const motion = { kind: 'walk', completed: true, from, route: [destination] };
    const command = {
      version: 1,
      commandId: '55555555-5555-4555-8555-555555555555',
      kind: 'move',
      tokenId: 'hero-token',
      observerTokenId: 'hero-token',
      sceneRevision: 1,
      charactersRevision: 1,
      payload: { target: { mapId: 'main', gridX: 2, gridY: 1 } },
      view: { mapId: 'main', assetKey: before.state.publicScene.assetKey },
    };
    setup.store.commitWorldCommand.mockResolvedValue({
      outcome: 'applied',
      freeRoam: true,
      applied: { generation: 2, sceneRevision: 2, charactersRevision: 1 },
      presentation: {
        kind: 'move',
        tokenId: command.tokenId,
        motion,
        route: [destination],
        placement: destination,
        costFeet: 5,
        budget: { movementSpentFeet: 0, movementRemainingFeet: 30, movementAllowanceFeet: 30 },
      },
    });
    const listener = jest.fn();
    setup.connection.subscribe(listener);
    sending = setup.connection.call('playerCommand', [campaignId, command]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(listener).toHaveBeenCalledWith({
      type: 'live-presentations',
      campaignId,
      confirmed: true,
      sceneRevision: 2,
      presentations: [
        { kind: 'move', tokenId: command.tokenId, commandId: command.commandId, motion },
      ],
    });
    expect(setup.connection.readLiveState().sceneRevision).toBe(1);
    const next = snapshot();
    next.generation++;
    next.state.sceneRevision++;
    next.state.campaign.sceneRevision++;
    next.state.publicScene.assets = null;
    Object.assign(next.state.publicScene.actors[0], destination);
    setup.observations[0].publish(next, { reconcile: false });
    expect((await sending).applied.sceneRevision).toBe(2);
  } finally {
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await Promise.all([opening.catch(() => {}), sending?.catch(() => {})]);
  }
});

test('a confirmed command wakes from synchronous fresh authority without waiting for replacement image bytes', async () => {
  const setup = fixture();
  const opening = setup.connection.open({ observerTokenId: 'hero-token' });
  let sending;
  await setup.observed;
  try {
    setup.observations[0].publish(snapshot());
    await new Promise((resolve) => setImmediate(resolve));
    setup.requests[0].resolve();
    await opening;
    const command = {
      version: 1,
      commandId: '55555555-5555-4555-8555-555555555555',
      kind: 'move',
      tokenId: 'hero-token',
      observerTokenId: 'hero-token',
      sceneRevision: 1,
      charactersRevision: 1,
      payload: { target: { mapId: 'main', gridX: 2, gridY: 1 } },
      view: { mapId: 'main', assetKey: 'view-assets' },
    };
    setup.store.commitWorldCommand.mockResolvedValue({
      outcome: 'applied',
      applied: { generation: 2, sceneRevision: 2, charactersRevision: 1 },
      presentation: null,
    });
    sending = setup.connection.call('playerCommand', [campaignId, command]);
    await Promise.resolve();
    const next = snapshot();
    next.generation++;
    next.state.sceneRevision++;
    next.state.campaign.sceneRevision++;
    next.state.publicScene.assets = null;
    next.state.publicScene.actors[0].gridX = 2;
    next.state.publicScene.actors[0].pose.world.x = 2.5;
    next.manifest.images[0].reference = { ...reference, generation: '3' };
    expect(setup.observations[0].publish(next, { reconcile: false })).toBeUndefined();
    const receipt = await sending;
    expect(receipt.applied.sceneRevision).toBe(2);
    expect(receipt.state.sceneRevision).toBe(2);
    expect(setup.connection.commandReady).toBe(false);
    expect(setup.store.commitWorldCommand).toHaveBeenCalledTimes(1);
    setup.connection.acknowledgeState(2);
    expect(setup.connection.readLiveState(2).publicScene.updates).toEqual([]);
  } finally {
    for (const request of setup.requests) request.resolve();
    await setup.connection.close();
    await Promise.all([opening.catch(() => {}), sending?.catch(() => {})]);
  }
});
