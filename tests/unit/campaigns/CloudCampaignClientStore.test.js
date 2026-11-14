/** @jest-environment node */
import { webcrypto, createHash } from 'node:crypto';
import CloudCampaignClientStore from '../../../src/campaigns/CloudCampaignClientStore.js';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';

const campaignId = '11111111-1111-4111-8111-111111111111';
const commandId = '22222222-2222-4222-8222-222222222222';
const packs = [{ id: 'srd-2014', ruleset: '2014', version: '5.1-seed.1' }];
const campaign = {
  version: 1,
  id: campaignId,
  name: 'Cloud fixture',
  ruleset: '2014',
  coreVersion: '5.1',
  sourcePacks: [{ ...packs[0], enabled: true }],
  createdAt: '2026-11-11T00:00:00.000Z',
  charactersRevision: 0,
  sceneRevision: 0,
  sceneSavedAt: null,
};
const runtime = {
  version: 1,
  mode: 'cloud',
  environment: 'emulator',
  apiOrigin: 'http://127.0.0.1:19410',
  authEmulatorOrigin: 'http://127.0.0.1:19099',
  firebase: {
    apiKey: 'demo-api-key',
    projectId: 'demo-taverntable',
    authDomain: 'demo-taverntable.firebaseapp.com',
    appId: 'demo-store',
  },
};

const accessSummary = (role, id = campaignId) => ({
  version: 1,
  campaign: {
    id,
    name: campaign.name,
    ruleset: campaign.ruleset,
    coreVersion: campaign.coreVersion,
  },
  role,
  seatId: role === 'owner' ? null : '44444444-4444-4444-8444-444444444444',
});

function fixture({ crypto } = {}) {
  const auth = {
    currentUser: { uid: 'uid-a', emailVerified: true, getIdToken: async () => 'fixture-token' },
  };
  const sdk = {
    onAuthStateChanged: (_auth, notify) => {
      notify();
      return () => {};
    },
    signInWithEmailAndPassword: async () => {},
    signOut: async () => {
      auth.currentUser = null;
    },
  };
  const account = new CloudAccount({ auth, sdk });
  const fetch = jest.fn(async (url, options) => {
    let result;
    if (url.endsWith('/characters'))
      result = {
        campaign,
        revision: 0,
        sceneRevision: 0,
        sceneSavedAt: null,
        records: [],
        scene: null,
      };
    else if (url.endsWith('/scene'))
      result = { campaign, revision: 0, charactersRevision: 0, savedAt: null, scene: null };
    else if (url.endsWith('/campaigns') && options.method === 'GET') result = [campaign];
    else result = campaign;
    return { ok: true, status: 200, json: async () => ({ version: 1, result }) };
  });
  const connection = new CloudAccountConnection({
    account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  let commandSequence = 0;
  const store = new CloudCampaignClientStore({
    connection,
    packs,
    uid: 'uid-a',
    crypto: crypto ?? {
      randomUUID: () =>
        ++commandSequence === 1 ? commandId : '33333333-3333-4333-8333-333333333333',
    },
  });
  return { auth, connection, store, fetch };
}

test('a live owner scene captures its epoch and native route separately from canonical scene data and identifies only its own command', async () => {
  const setup = fixture();
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'owner',
    seatId: null,
    accessGeneration: 0,
  };
  const sessionId = '55555555-5555-4555-8555-555555555555';
  const release = setup.store.bindOwnerWorld(campaignId, sessionId, access);
  const presentations = [
    {
      commandId: '66666666-6666-4666-8666-666666666666',
      tokenId: 'token-1',
      kind: 'move',
      motion: {
        kind: 'walk',
        completed: true,
        from: {
          mapId: 'map-main',
          gridX: 1,
          gridY: 1,
          facingAngle: 0,
          pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
        },
        route: [
          {
            mapId: 'map-main',
            gridX: 2,
            gridY: 1,
            facingAngle: 0,
            pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
          },
        ],
      },
    },
  ];
  const captured = {
    ruleset: '2014',
    revision: 0,
    charactersRevision: 0,
    scene: 'canonical-owner-scene',
    presentations,
  };
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      version: 1,
      result: { revision: 1, savedAt: '2026-11-14T00:00:00.000Z' },
    }),
  }));
  try {
    expect(setup.store.wantsSharedPresentations(campaignId)).toBe(true);
    await setup.store.commitScene(campaignId, captured);
    const body = JSON.parse(setup.fetch.mock.calls[0][1].body);
    expect(body.sessionId).toBe(sessionId);
    expect(body.presentations).toEqual(presentations);
    expect(body.change).toEqual({
      ruleset: '2014',
      revision: 0,
      charactersRevision: 0,
      scene: 'canonical-owner-scene',
    });
    expect(setup.store.isLocalChange({ origin: { uid: 'uid-a', commandId } })).toBe(true);
    expect(setup.store.isLocalChange({ origin: { uid: 'another-account', commandId } })).toBe(
      false
    );
    expect(setup.store.isLocalChange({ origin: { uid: 'uid-a', commandId: sessionId } })).toBe(
      false
    );
  } finally {
    release();
  }
  expect(setup.store.wantsSharedPresentations(campaignId)).toBe(false);
});

test('live observation stays unready until its current authorized checkpoint is published and closes its idle transport', async () => {
  const setup = fixture();
  const stopped = jest.fn();
  setup.connection.account.sdk.onAuthStateChanged = (_auth, notify) => {
    notify();
    return stopped;
  };
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'owner',
    seatId: null,
    accessGeneration: 0,
  };
  const view = { sessionId: commandId, observerTokenId: null, mapId: null, assetKey: null };
  const checkpoint = {
    kind: 'owner-head',
    version: 1,
    access,
    sessionId: view.sessionId,
    head: { generation: 1, charactersRevision: 0, sceneRevision: 0, sceneSavedAt: null },
  };
  const opened = Promise.withResolvers();
  let incoming;
  setup.fetch.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            incoming = controller;
            opened.resolve();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  );
  const states = [];
  const statuses = [];
  const observation = setup.store.observeEvents(campaignId, view, access, {
    onState: (state, context) => {
      expect(statuses.at(-1).phase).not.toBe('ready');
      states.push({ state, context });
    },
    onStatus: (status) => statuses.push(status),
  });
  try {
    await opened.promise;
    expect(statuses.at(-1).phase).not.toBe('ready');
    incoming.enqueue(
      new TextEncoder().encode(`id: 1\nevent: owner-head\ndata: ${JSON.stringify(checkpoint)}\n\n`)
    );
    await expect(observation.ready).resolves.toEqual(checkpoint);
    expect(states).toEqual([{ state: checkpoint, context: { reconcile: true } }]);
    expect(statuses.at(-1).phase).toBe('ready');
    await observation.close();
    expect(statuses.at(-1).phase).toBe('closed');
    expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(setup.store.saveState.phase).toBe('idle');
  } finally {
    await observation.close();
  }
});

test('a lost live connection disables readiness and reconnects after jitter to a fresh latest checkpoint without replay', async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const setup = fixture();
  setup.connection.account.sdk.onAuthStateChanged = (_auth, notify) => {
    notify();
    return () => {};
  };
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'owner',
    seatId: null,
    accessGeneration: 0,
  };
  const view = { sessionId: commandId, observerTokenId: null, mapId: null, assetKey: null };
  const checkpoint = (generation) => ({
    kind: 'owner-head',
    version: 1,
    access,
    sessionId: view.sessionId,
    head: { generation, charactersRevision: 0, sceneRevision: 0, sceneSavedAt: null },
  });
  const sources = [];
  const opened = Promise.withResolvers();
  setup.fetch.mockImplementation(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            sources.push(controller);
            opened.resolve();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  );
  const states = [];
  const statuses = [];
  const observation = setup.store.observeEvents(campaignId, view, access, {
    onState: (state, context) => states.push({ generation: state.head.generation, context }),
    onStatus: (status) => statuses.push(status),
  });
  try {
    await opened.promise;
    sources[0].enqueue(
      new TextEncoder().encode(
        `id: 1\nevent: owner-head\ndata: ${JSON.stringify(checkpoint(1))}\n\n`
      )
    );
    await observation.ready;
    sources[0].error(new Error('Synthetic interrupted transport'));
    await jest.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toEqual({ phase: 'reconnecting', reason: 'cloud-stream-unavailable' });
    await jest.advanceTimersByTimeAsync(999);
    expect(setup.fetch).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(setup.fetch).toHaveBeenCalledTimes(2);
    sources[1].enqueue(
      new TextEncoder().encode(
        `id: 3\nevent: owner-head\ndata: ${JSON.stringify(checkpoint(3))}\n\n`
      )
    );
    await jest.advanceTimersByTimeAsync(0);
    expect(states).toEqual([
      { generation: 1, context: { reconcile: true } },
      { generation: 3, context: { reconcile: true } },
    ]);
    expect(statuses.at(-1).phase).toBe('ready');
    await observation.close();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    random.mockRestore();
    log.mockRestore();
    jest.useRealTimers();
  }
});

test('closing a live observation during its opening request immediately aborts HTTP and cannot publish a late checkpoint', async () => {
  const setup = fixture();
  const request = Promise.withResolvers();
  const pending = Promise.withResolvers();
  setup.fetch.mockImplementation((_url, options) => {
    options.signal.addEventListener(
      'abort',
      () => pending.reject(new DOMException('Aborted', 'AbortError')),
      { once: true }
    );
    request.resolve(options);
    return pending.promise;
  });
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'owner',
    seatId: null,
    accessGeneration: 0,
  };
  const states = jest.fn();
  const statuses = [];
  const observation = setup.store.observeEvents(
    campaignId,
    {
      sessionId: commandId,
      observerTokenId: null,
      mapId: null,
      assetKey: null,
    },
    access,
    { onState: states, onStatus: (status) => statuses.push(status) }
  );
  const readiness = expect(observation.ready).rejects.toMatchObject({ code: 'stream-closed' });
  try {
    const options = await request.promise;
    const closing = observation.close();
    await Promise.resolve();
    expect(options.signal.aborted).toBe(true);
    await closing;
    await readiness;
    expect(states).not.toHaveBeenCalled();
    expect(statuses.at(-1).phase).toBe('closed');
  } finally {
    pending.reject(new DOMException('Aborted', 'AbortError'));
    await observation.close();
    await readiness;
  }
});

test.each(['private head', 'foreign UID', 'foreign campaign', 'foreign epoch'])(
  'an owner event rejects a %s and releases its stream without affecting save state',
  async (kind) => {
    const setup = fixture();
    setup.connection.account.sdk.onAuthStateChanged = (_auth, notify) => {
      notify();
      return () => {};
    };
    const access = {
      version: 1,
      uid: 'uid-a',
      campaignId,
      role: 'owner',
      seatId: null,
      accessGeneration: 0,
    };
    const view = { sessionId: commandId, observerTokenId: null, mapId: null, assetKey: null };
    const event = {
      kind: 'owner-head',
      version: 1,
      access: { ...access },
      sessionId: view.sessionId,
      head: { generation: 1, charactersRevision: 0, sceneRevision: 0, sceneSavedAt: null },
    };
    if (kind === 'private head') event.head.charactersRef = 'PRIVATE OBJECT PATH';
    if (kind === 'foreign UID') event.access.uid = 'other-uid';
    if (kind === 'foreign campaign') event.access.campaignId = commandId;
    if (kind === 'foreign epoch') event.sessionId = campaignId;
    setup.fetch.mockImplementation(
      async () =>
        new Response(`id: 1\nevent: owner-head\ndata: ${JSON.stringify(event)}\n\n`, {
          headers: { 'Content-Type': 'text/event-stream' },
        })
    );
    const events = await setup.store.openEvents(campaignId, view, access);
    try {
      await expect(events.next()).rejects.toMatchObject({ code: 'invalid-cloud-response' });
      expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(setup.store.streams.size).toBe(0);
      expect(setup.store.saveState.phase).toBe('idle');
    } finally {
      await events.close();
    }
  }
);

test('closing a campaign cancels its idle owner stream without leaving an open account observer or save', async () => {
  const setup = fixture();
  const stopped = jest.fn();
  setup.connection.account.sdk.onAuthStateChanged = (_auth, notify) => {
    notify();
    return stopped;
  };
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'owner',
    seatId: null,
    accessGeneration: 0,
  };
  const view = { sessionId: commandId, observerTokenId: null, mapId: null, assetKey: null };
  setup.fetch.mockImplementation(
    async () =>
      new Response(new ReadableStream(), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
  );
  const events = await setup.store.openEvents(campaignId, view, access);
  const reading = expect(events.next()).rejects.toThrow('cloud campaign store is closed');
  setup.store.close();
  await reading;
  await events.close();
  expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
  expect(stopped).toHaveBeenCalledTimes(1);
  expect(setup.store.streams.size).toBe(0);
  expect(setup.store.saveState.phase).toBe('idle');
});

test('assigned reads reject private world fields, foreign scopes and unassigned character rows', async () => {
  const setup = fixture();
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'member',
    seatId: '44444444-4444-4444-8444-444444444444',
    accessGeneration: 3,
  };
  const state = {
    version: 1,
    access,
    campaign,
    characterIds: [],
    revision: 0,
    records: [],
    scene: null,
    sceneRevision: 0,
    sceneSavedAt: null,
  };
  let result = state;
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  await expect(setup.store.readAssignedCharacters(campaignId, access)).resolves.toMatchObject(
    state
  );
  for (const invalid of [
    { ...state, scene: 'PRIVATE WORLD' },
    { ...state, ownerUid: 'private-owner' },
    { ...state, campaign: { ...campaign, ownerUid: 'private-owner' } },
    { ...state, access: { ...access, uid: 'another-user' } },
    { ...state, access: { ...access, campaignId: commandId } },
    { ...state, access: { ...access, accessGeneration: 4 } },
    { ...state, records: [{ key: 'taverntable.character.v1.hidden-npc', value: '{}' }] },
    { ...state, revision: 1 },
  ]) {
    result = invalid;
    await expect(setup.store.readAssignedCharacters(campaignId, access)).rejects.toMatchObject({
      code: 'invalid-cloud-response',
    });
  }
  const options = setup.fetch.mock.calls[0][1];
  expect(options.headers['X-TavernTable-Seat']).toBe(access.seatId);
  expect(options.headers['X-TavernTable-Access-Generation']).toBe('3');
  expect(setup.store.pending).toBeNull();
  setup.store.close();
});

test('an uncertain assigned receipt preserves the original body and access headers until the original caller is confirmed', async () => {
  const setup = fixture();
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'member',
    seatId: '44444444-4444-4444-8444-444444444444',
    accessGeneration: 3,
  };
  const valid = {
    version: 1,
    campaignId,
    access: { ...access },
    revision: 1,
    sceneRevision: 0,
    sceneSavedAt: null,
  };
  let result = { ...valid, access: { ...access, accessGeneration: 4 } };
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  let observed;
  const uncertain = new Promise((resolve) => {
    observed = resolve;
  });
  const stop = setup.store.subscribeSave((state) => {
    if (state.phase === 'uncertain') observed();
  });
  const change = { ruleset: '2014', revision: 0, records: [] };
  const original = setup.store.commitAssignedCharacters(campaignId, change, access);
  await uncertain;
  expect(setup.store.pending).not.toBeNull();
  expect(setup.store.saveState.error.code).toBe('invalid-cloud-response');
  change.revision = 100;
  access.accessGeneration = 99;
  result = valid;
  await setup.store.retryPending();
  await expect(original).resolves.toMatchObject({ revision: 1 });
  expect(setup.fetch.mock.calls).toHaveLength(2);
  expect(setup.fetch.mock.calls[1][1].body).toBe(setup.fetch.mock.calls[0][1].body);
  expect(setup.fetch.mock.calls[1][1].headers['X-TavernTable-Access-Generation']).toBe('3');
  expect(setup.store.pending).toBeNull();
  stop();
  setup.store.close();
});

test('live status validates authoritative warning deadlines without changing primary save or live-control state', async () => {
  const setup = fixture();
  const status = {
    version: 1,
    session: {
      version: 1,
      campaignId,
      generation: 1,
      sessionId: '33333333-3333-4333-8333-333333333333',
      state: 'live',
      startedAt: '2026-11-13T00:00:00.000Z',
      lastMeaningfulAt: '2026-11-13T00:00:00.000Z',
      pausedAt: null,
      pauseReason: null,
    },
    activity: {
      observedAt: '2026-11-13T00:55:00.000Z',
      warningAt: '2026-11-13T00:55:00.000Z',
      pauseAt: '2026-11-13T01:00:00.000Z',
      phase: 'warning',
      disconnectedAt: null,
      graceUntil: null,
    },
  };
  let result = status;
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  await expect(setup.store.getLiveStatus(campaignId)).resolves.toEqual(status);
  const reconnecting = {
    ...status,
    activity: {
      ...status.activity,
      disconnectedAt: '2026-11-13T00:50:00.000Z',
      graceUntil: '2026-11-13T01:05:00.000Z',
    },
  };
  result = reconnecting;
  await expect(setup.store.getLiveStatus(campaignId)).resolves.toEqual(reconnecting);
  for (const invalid of [
    { ...status, activity: { ...status.activity, phase: 'active' } },
    { ...status, activity: { ...status.activity, pauseAt: '2026-11-13T01:01:00.000Z' } },
    { ...status, activity: { ...status.activity, observedAt: '2026-11-13T01:00:00.000Z' } },
    { ...status, session: { ...status.session, campaignId: commandId } },
    { ...status, ownerUid: 'unexpected-private-field' },
    {
      ...reconnecting,
      activity: { ...reconnecting.activity, graceUntil: '2026-11-13T01:06:00.000Z' },
    },
    {
      ...reconnecting,
      activity: { ...reconnecting.activity, pauseAt: reconnecting.activity.graceUntil },
    },
  ]) {
    result = invalid;
    await expect(setup.store.getLiveStatus(campaignId)).rejects.toMatchObject({
      code: 'invalid-cloud-response',
    });
  }
  expect(setup.store.saveState.phase).toBe('idle');
  expect(setup.store.pendingLive).toBeNull();
  setup.store.close();
});

test('live control confirms only its captured transition and keeps malformed replies separate from primary save state', async () => {
  const setup = fixture();
  const paused = {
    version: 1,
    campaignId,
    generation: 0,
    sessionId: null,
    state: 'paused',
    startedAt: null,
    lastMeaningfulAt: null,
    pausedAt: null,
    pauseReason: 'not-started',
  };
  const active = {
    ...paused,
    generation: 1,
    sessionId: '33333333-3333-4333-8333-333333333333',
    state: 'live',
    startedAt: '2026-11-13T00:00:00.000Z',
    lastMeaningfulAt: '2026-11-13T00:00:00.000Z',
    pauseReason: null,
  };
  let valid = false;
  setup.fetch.mockImplementation(async (_url, options) => ({
    ok: true,
    status: 200,
    json: async () => ({
      version: 1,
      result: options.method === 'GET' ? paused : valid ? active : { ...active, generation: 2 },
    }),
  }));
  const snapshot = await setup.store.getLiveSession(campaignId);
  const pending = setup.store.controlLiveSession(campaignId, 'start', snapshot);
  snapshot.generation = 99;
  snapshot.campaignId = commandId;
  await expect(pending).rejects.toMatchObject({ code: 'invalid-cloud-response' });
  expect(setup.store.saveState.phase).toBe('idle');
  expect(setup.store.pending).toBeNull();
  valid = true;
  await expect(setup.store.retryLiveSession()).resolves.toEqual(active);
  const requests = setup.fetch.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(requests[0][1].body).toBe(requests[1][1].body);
  expect(JSON.parse(requests[0][1].body)).toEqual({
    commandId,
    action: 'start',
    generation: 0,
    sessionId: null,
  });
  expect(setup.store.saveState.phase).toBe('idle');
  setup.store.close();
});

test('live admission rejects foreign UID, campaign and live-epoch projections without caching them', async () => {
  const setup = fixture();
  const sessionId = '33333333-3333-4333-8333-333333333333';
  const live = {
    version: 1,
    campaignId,
    generation: 1,
    sessionId,
    state: 'live',
    startedAt: '2026-11-13T00:00:00.000Z',
    lastMeaningfulAt: '2026-11-13T00:00:00.000Z',
    pausedAt: null,
    pauseReason: null,
  };
  const participant = {
    version: 1,
    campaign: accessSummary('member').campaign,
    characterIds: [],
    access: {
      version: 1,
      uid: 'uid-a',
      campaignId,
      role: 'member',
      seatId: accessSummary('member').seatId,
      accessGeneration: 1,
    },
  };
  let result = { version: 1, session: live, participant };
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  await expect(setup.store.getLiveAccess(campaignId, sessionId)).resolves.toEqual(result);
  for (const invalid of [
    { ...result, ownerUid: 'PRIVATE OWNER' },
    {
      ...result,
      participant: { ...participant, access: { ...participant.access, uid: 'another-user' } },
    },
    { ...result, session: { ...live, campaignId: commandId } },
    { ...result, session: { ...live, sessionId: commandId } },
  ]) {
    result = invalid;
    await expect(setup.store.getLiveAccess(campaignId, sessionId)).rejects.toMatchObject({
      code: 'invalid-cloud-response',
    });
  }
  setup.store.close();
});

test('a mismatched backup receipt stays on its separate original caller without acknowledging a primary save', async () => {
  const setup = fixture();
  const bodies = [];
  setup.fetch.mockImplementation(async (_url, options) => {
    const body = JSON.parse(options.body);
    bodies.push(body);
    return {
      ok: true,
      status: 201,
      json: async () => ({
        version: 1,
        result: {
          name: bodies.length === 1 ? '44444444-4444-4444-8444-444444444444' : body.commandId,
          createdAt: '2026-11-11T00:00:00.000Z',
          bytes: 100,
          generation: 3,
        },
      }),
    };
  });
  await expect(setup.store.backupNow(campaignId)).rejects.toMatchObject({
    code: 'invalid-cloud-response',
  });
  expect(setup.store.saveState.phase).toBe('idle');
  expect(setup.store.pending).toBeNull();
  const recovered = await setup.store.backupNow(campaignId);
  expect(recovered.name).toBe(commandId);
  expect(bodies).toEqual([{ commandId }, { commandId }]);
  expect(setup.store.saveState.phase).toBe('idle');
  setup.store.close();
});

test('the browser high-level cloud store uses UID-bound HTTP creation and consistent reads without opening browser campaign authority', async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    get: () => {
      throw new Error('No browser campaign database may open');
    },
  });

  try {
    const setup = fixture();
    expect(
      await setup.store.create({ name: 'Cloud fixture', ruleset: '2014', packIds: [] })
    ).toEqual(campaign);
    expect(await setup.store.list()).toEqual([campaign]);
    expect(await setup.store.get(campaignId)).toEqual(campaign);
    expect(await setup.store.readCharacters(campaignId)).toEqual({
      campaign,
      revision: 0,
      sceneRevision: 0,
      sceneSavedAt: null,
      records: [],
      scene: null,
    });
    expect(await setup.store.readScene(campaignId)).toEqual({
      campaign,
      revision: 0,
      charactersRevision: 0,
      savedAt: null,
      scene: null,
    });
    expect(setup.store.storageInfo.kind).toBe('cloud');
    expect(setup.store.capabilities.sharedSessions).toBe(false);
    expect(setup.store.capabilities.roomVisits).toBe(false);
    const request = JSON.parse(setup.fetch.mock.calls[0][1].body);
    expect(request.commandId).toBe(commandId);
    expect(request.options).toEqual({ name: 'Cloud fixture', ruleset: '2014', packIds: [] });
    expect(request.uid).toBeUndefined();
    expect(
      setup.fetch.mock.calls.every(([url]) =>
        url.startsWith(runtime.apiOrigin + '/api/cloud/campaigns')
      )
    ).toBe(true);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'indexedDB', previous);
    else delete globalThis.indexedDB;
  }
});

test('complete cloud exports use the verified file transport and cannot acknowledge another campaign or a primary save', async () => {
  const setup = fixture();
  let wrongCampaign = false;
  const backup = () => ({
    format: 'taverntable-campaign',
    version: 2,
    campaign: { ...campaign, id: wrongCampaign ? commandId : campaignId },
    records: [],
    scene: null,
  });
  setup.fetch.mockImplementation(async () => {
    const text = JSON.stringify(backup());
    const bytes = new TextEncoder().encode(text);
    return new Response(bytes, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'X-TavernTable-Backup-Bytes': String(bytes.length),
        'X-TavernTable-Backup-SHA256': createHash('sha256').update(bytes).digest('hex'),
      },
    });
  });
  const text = await setup.store.exportBackup(campaignId);
  expect(JSON.parse(text)).toEqual(backup());
  expect(setup.store.saveState.phase).toBe('idle');
  wrongCampaign = true;
  await expect(setup.store.exportBackup(campaignId)).rejects.toMatchObject({
    status: 503,
    code: 'invalid-cloud-response',
  });
  expect(setup.fetch.mock.calls[0][0]).toBe(
    `${runtime.apiOrigin}/api/cloud/campaigns/${campaignId}/backup`
  );
  setup.store.close();
});

test('settings retries retain the captured generation, source choice and expected canonical metadata', async () => {
  const setup = fixture();
  const current = { version: 1, generation: 1, campaign };
  const updated = {
    version: 1,
    generation: 2,
    campaign: { ...campaign, name: 'Renamed fixture', charactersRevision: 1 },
  };
  let posts = 0;
  setup.fetch.mockImplementation(async (_url, options) => {
    if (options.method === 'POST' && ++posts === 1)
      throw new TypeError('Synthetic lost settings reply');
    return {
      ok: true,
      status: 200,
      json: async () => ({ version: 1, result: options.method === 'GET' ? current : updated }),
    };
  });
  const snapshot = await setup.store.getSettings(campaignId);
  const changes = { name: ' Renamed fixture ', packIds: [] };
  const pending = setup.store.update(campaignId, changes, snapshot);
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.store.saveState.phase).toBe('uncertain');
  snapshot.generation = 99;
  snapshot.campaign.ruleset = '2024';
  changes.name = 'Different intent';
  changes.packIds.push('srd-2024');
  await setup.store.retryPending();
  await expect(pending).resolves.toEqual(updated.campaign);
  const requests = setup.fetch.mock.calls.filter(([, options]) => options.method === 'POST');
  expect(requests).toHaveLength(2);
  expect(requests[0][1].body).toBe(requests[1][1].body);
  expect(requests[0][0]).toBe(
    runtime.apiOrigin + '/api/cloud/campaigns/' + campaignId + '/settings'
  );
  expect(JSON.parse(requests[0][1].body)).toEqual({
    commandId,
    generation: 1,
    changes: { name: ' Renamed fixture ', packIds: [] },
  });
  expect(setup.store.saveState.phase).toBe('saved');
});

test('a mismatched settings receipt cannot acknowledge another name, revision, generation or source version', async () => {
  const current = { version: 1, generation: 1, campaign };
  const correct = {
    version: 1,
    generation: 2,
    campaign: { ...campaign, name: 'Expected name', charactersRevision: 1 },
  };
  for (const wrong of [
    { ...correct, generation: 3 },
    { ...correct, campaign: { ...correct.campaign, name: 'Another intent' } },
    { ...correct, campaign: { ...correct.campaign, charactersRevision: 2 } },
    {
      ...correct,
      campaign: {
        ...correct.campaign,
        sourcePacks: [
          {
            ...correct.campaign.sourcePacks[0],
            version: 'unconfirmed-version',
          },
        ],
      },
    },
  ]) {
    const setup = fixture();
    let result = wrong;
    setup.fetch.mockImplementation(async (_url, options) => ({
      ok: true,
      status: 200,
      json: async () => ({
        version: 1,
        result: options.method === 'GET' ? current : result,
      }),
    }));
    const pending = setup.store.update(campaignId, { name: 'Expected name', packIds: [] }, current);
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.store.saveState.phase).toBe('uncertain');
    expect(setup.store.saveState.error.code).toBe('invalid-cloud-response');
    result = correct;
    await setup.store.retryPending();
    await expect(pending).resolves.toEqual(correct.campaign);
  }
});

test('private image manifests validate the current UID and campaign without accepting embedded owner data', async () => {
  const setup = fixture();
  const manifest = {
    version: 1,
    access: {
      version: 1,
      uid: 'uid-a',
      campaignId,
      role: 'member',
      seatId: accessSummary('member').seatId,
      accessGeneration: 2,
    },
    charactersRevision: 4,
    images: [
      {
        characterId: 'assigned-character',
        field: 'portraitImage',
        reference: {
          version: 1,
          campaignId,
          mimeType: 'image/png',
          bytes: 68,
          sha256: 'a'.repeat(64),
          generation: '1',
          width: 2,
          height: 2,
        },
      },
    ],
  };
  let result = manifest;
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  await expect(setup.store.getAssetManifest(campaignId)).resolves.toEqual(manifest);
  for (const invalid of [
    { ...manifest, rawImages: 'PRIVATE EMBEDDED IMAGE' },
    { ...manifest, access: { ...manifest.access, uid: 'another-user' } },
    { ...manifest, images: [...manifest.images, manifest.images[0]] },
    {
      ...manifest,
      images: [
        {
          ...manifest.images[0],
          reference: {
            ...manifest.images[0].reference,
            campaignId: '66666666-6666-4666-8666-666666666666',
          },
        },
      ],
    },
  ]) {
    result = invalid;
    await expect(setup.store.getAssetManifest(campaignId)).rejects.toMatchObject({
      code: 'invalid-cloud-response',
    });
  }
});

test('participant access validates the UID, campaign and captured generation without accepting private owner data', async () => {
  const setup = fixture();
  const manifest = {
    version: 1,
    campaign: accessSummary('member').campaign,
    access: {
      version: 1,
      uid: 'uid-a',
      campaignId,
      role: 'member',
      seatId: accessSummary('member').seatId,
      accessGeneration: 7,
    },
    characterIds: ['saved-character'],
  };
  let result = manifest;
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  await expect(setup.store.getParticipantAccess(campaignId)).resolves.toEqual(manifest);
  expect(setup.fetch.mock.calls[0][1].headers['X-TavernTable-Seat']).toBeUndefined();
  await expect(setup.store.getParticipantAccess(campaignId, manifest.access)).resolves.toEqual(
    manifest
  );
  expect(setup.fetch.mock.calls[1][1].headers['X-TavernTable-Seat']).toBe(manifest.access.seatId);
  expect(setup.fetch.mock.calls[1][1].headers['X-TavernTable-Access-Generation']).toBe('7');
  for (const invalid of [
    { ...manifest, scene: 'PRIVATE OWNER SCENE' },
    { ...manifest, access: { ...manifest.access, uid: 'uid-b' } },
    { ...manifest, access: { ...manifest.access, accessGeneration: 8 } },
  ]) {
    result = invalid;
    await expect(
      setup.store.getParticipantAccess(campaignId, manifest.access)
    ).rejects.toMatchObject({ code: 'invalid-cloud-response' });
  }
  const previous = setup.fetch.mock.calls.length;
  await expect(
    setup.store.getParticipantAccess(campaignId, {
      ...manifest.access,
      uid: 'uid-b',
    })
  ).rejects.toMatchObject({ code: 'invalid-access-scope' });
  expect(setup.fetch.mock.calls).toHaveLength(previous);
});

test('uncertain assignment retries retain the original command, character and captured access generation', async () => {
  const setup = fixture();
  const input = {
    seatId: accessSummary('member').seatId,
    characterId: 'saved-character',
    assigned: true,
    accessGeneration: 0,
  };
  const receipt = {
    version: 1,
    seatId: input.seatId,
    characterIds: [input.characterId],
    accessGeneration: 1,
    changed: true,
  };
  setup.fetch.mockImplementation(async () => {
    if (setup.fetch.mock.calls.length === 1) throw new TypeError('Synthetic lost assignment reply');
    return { ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) };
  });
  const pending = setup.store.assignCharacter(campaignId, input);
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.store.saveState.phase).toBe('uncertain');
  input.accessGeneration = 99;
  input.characterId = 'different-character';
  input.assigned = false;
  await setup.store.retryPending();
  await expect(pending).resolves.toEqual(receipt);
  const calls = setup.fetch.mock.calls;
  expect(calls[0][0]).toBe(
    runtime.apiOrigin + '/api/cloud/campaigns/' + campaignId + '/assignments'
  );
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(JSON.parse(calls[1][1].body)).toEqual({
    commandId,
    seatId: receipt.seatId,
    characterId: 'saved-character',
    assigned: true,
    accessGeneration: 0,
  });
  expect(setup.store.saveState.phase).toBe('saved');
});

test('member removal validates its intended seat and generation before acknowledging the retained command', async () => {
  const setup = fixture();
  const input = { seatId: accessSummary('member').seatId, accessGeneration: 3 };
  const receipt = {
    version: 1,
    seatId: input.seatId,
    accessGeneration: 4,
    removedAt: '2026-11-11T00:00:00.000Z',
  };
  let correct = false;
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      version: 1,
      result: correct ? receipt : { ...receipt, seatId: '66666666-6666-4666-8666-666666666666' },
    }),
  }));
  const pending = setup.store.removeMember(campaignId, input);
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.store.saveState.phase).toBe('uncertain');
  expect(setup.store.saveState.error.code).toBe('invalid-cloud-response');
  input.accessGeneration = 99;
  correct = true;
  await setup.store.retryPending();
  await expect(pending).resolves.toEqual(receipt);
  const calls = setup.fetch.mock.calls;
  expect(calls[0][0]).toBe(
    runtime.apiOrigin + '/api/cloud/campaigns/' + campaignId + '/members/remove'
  );
  expect(calls[0][1].body).toBe(calls[1][1].body);
  expect(JSON.parse(calls[1][1].body)).toEqual({
    commandId,
    seatId: receipt.seatId,
    accessGeneration: 3,
  });
});

test('a definitive stale metadata scope releases its original caller without pretending the change was saved', async () => {
  const setup = fixture();
  setup.fetch.mockImplementation(async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      version: 1,
      code: 'campaign-access-changed',
      error: 'PRIVATE POLICY DETAIL',
    }),
  }));
  const outcome = setup.store
    .assignCharacter(campaignId, {
      seatId: accessSummary('member').seatId,
      characterId: 'saved-character',
      assigned: true,
      accessGeneration: 0,
    })
    .then(
      (value) => ({ value }),
      (error) => ({ code: error.code })
    );
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.store.saveState.phase).toBe('failed');
  await expect(outcome).resolves.toEqual({ code: 'campaign-access-changed' });
  expect(setup.store.pending).toBeNull();
  expect(setup.store.saveState.error.message).not.toContain('PRIVATE POLICY DETAIL');
});

test('a fresh owner access denial is definitive but cannot erase an earlier uncertain removal', async () => {
  const denied = async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      version: 1,
      code: 'pilot-access-required',
      error: 'PRIVATE POLICY DETAIL',
    }),
  });
  const input = { seatId: accessSummary('member').seatId, accessGeneration: 0 };
  const fresh = fixture();
  fresh.fetch.mockImplementation(denied);
  const freshOutcome = fresh.store.removeMember(campaignId, input).then(
    (value) => ({ value }),
    (error) => ({ code: error.code })
  );
  await new Promise((resolve) => setImmediate(resolve));
  expect(fresh.store.saveState.phase).toBe('failed');
  await expect(freshOutcome).resolves.toEqual({ code: 'pilot-access-required' });
  expect(fresh.store.pending).toBeNull();

  const previous = fixture();
  previous.fetch.mockImplementation(async () => {
    throw new TypeError('Synthetic lost removal reply');
  });
  const pending = previous.store.removeMember(campaignId, input);
  await new Promise((resolve) => setImmediate(resolve));
  previous.fetch.mockImplementation(denied);
  await expect(previous.store.retryPending()).rejects.toMatchObject({
    code: 'pilot-access-required',
  });
  expect(previous.store.saveState.phase).toBe('uncertain');
  expect(previous.store.saveState.commandId).toBe(commandId);
  const receipt = {
    version: 1,
    seatId: input.seatId,
    accessGeneration: 1,
    removedAt: '2026-11-11T00:00:00.000Z',
  };
  previous.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result: receipt }),
  }));
  await previous.store.retryPending();
  await expect(pending).resolves.toEqual(receipt);
});

test('Owned and Joined access accepts only explicit role projections without canonical records or duplicated authority', async () => {
  const setup = fixture();
  const owned = accessSummary('owner');
  const joined = accessSummary('member', '55555555-5555-4555-8555-555555555555');
  let result = { owned: [owned], joined: [joined] };
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  await expect(setup.store.listAccess()).resolves.toEqual(result);
  expect(setup.fetch.mock.calls[0][0]).toBe(`${runtime.apiOrigin}/api/cloud/account/campaigns`);
  result = joined;
  await expect(setup.store.getAccess(joined.campaign.id)).resolves.toEqual(joined);
  expect(setup.fetch.mock.calls[1][0]).toBe(
    `${runtime.apiOrigin}/api/cloud/campaigns/${joined.campaign.id}/access`
  );
  for (const invalid of [
    { owned: [owned], joined: [accessSummary('member')] },
    { owned: [joined], joined: [] },
    { owned: [owned], joined: [joined], scene: '{}' },
    { owned: [owned], joined: [{ ...joined, role: 'dm' }] },
    { owned: [owned], joined: [{ ...joined, ownerUid: 'private-owner' }] },
    {
      owned: [owned],
      joined: [{ ...joined, campaign: { ...joined.campaign, scene: 'private-scene' } }],
    },
  ]) {
    result = invalid;
    await expect(setup.store.listAccess()).rejects.toMatchObject({
      code: 'invalid-cloud-response',
    });
  }
  result = owned;
  await expect(setup.store.getAccess(joined.campaign.id)).rejects.toMatchObject({
    code: 'invalid-cloud-response',
  });
  const calls = setup.fetch.mock.calls.length;
  setup.auth.currentUser = { ...setup.auth.currentUser, uid: 'uid-b' };
  await expect(setup.store.listAccess()).rejects.toMatchObject({ code: 'account-changed' });
  await expect(setup.store.getAccess(joined.campaign.id)).rejects.toMatchObject({
    code: 'account-changed',
  });
  expect(setup.fetch).toHaveBeenCalledTimes(calls);
});

test('invitation creation keeps its random secret only in memory and recovers the original link after an uncertain reply', async () => {
  const setup = fixture({ crypto: webcrypto });
  const issued = {
    version: 1,
    id: '66666666-6666-4666-8666-666666666666',
    campaignId,
    seatId: '77777777-7777-4777-8777-777777777777',
    createdAt: '2026-11-11T00:00:00.000Z',
    expiresAt: '2026-11-18T00:00:00.000Z',
  };
  setup.fetch.mockImplementation(async () => {
    if (setup.fetch.mock.calls.length === 1) throw new TypeError('Synthetic lost invitation reply');
    return { ok: true, status: 201, json: async () => ({ version: 1, result: issued }) };
  });
  let stop = () => {};
  const uncertain = new Promise((resolve) => {
    stop = setup.store.subscribeSave((state) => {
      if (state.phase === 'uncertain') resolve();
    });
  });
  const pending = setup.store.createInvitation(campaignId, { name: 'Invited player' });
  await uncertain;
  expect(setup.store.saveState.phase).toBe('uncertain');
  const request = setup.fetch.mock.calls[0];
  expect(request[0]).toBe(`${runtime.apiOrigin}/api/cloud/campaigns/${campaignId}/invitations`);
  const body = JSON.parse(request[1].body);
  expect(Object.keys(body.options).sort()).toEqual(['name', 'seatId', 'tokenHash']);
  expect(body.options.seatId).toBeNull();
  await setup.store.retryPending();
  const invitation = await pending;
  expect(invitation).toEqual({ ...issued, secret: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(body.options.tokenHash).toBe(createHash('sha256').update(invitation.secret).digest('hex'));
  expect(request[1].body).not.toContain(invitation.secret);
  expect(setup.fetch.mock.calls[1][1].body).toBe(request[1].body);
  stop();
});

test('invitation acceptance binds its receipt to the intended link and retains one command until explicit recovery', async () => {
  const setup = fixture();
  const id = '66666666-6666-4666-8666-666666666666';
  const secret = 'a'.repeat(64);
  const receipt = { version: 1, invitationId: id, access: accessSummary('member') };
  let valid = false;
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      version: 1,
      result: {
        ...receipt,
        invitationId: valid ? id : '77777777-7777-4777-8777-777777777777',
      },
    }),
  }));
  const pending = setup.store.redeemInvitation({ id, secret });
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.store.saveState.phase).toBe('uncertain');
  expect(setup.store.saveState.error.code).toBe('invalid-cloud-response');
  expect(JSON.stringify(setup.store.saveState)).not.toContain(secret);
  expect(setup.fetch.mock.calls[0][0]).toBe(
    `${runtime.apiOrigin}/api/cloud/account/invitations/redeem`
  );
  expect(setup.fetch.mock.calls[0][0]).not.toContain(secret);
  valid = true;
  await setup.store.retryPending();
  await expect(pending).resolves.toEqual(receipt);
  expect(setup.fetch.mock.calls[0][1].body).toBe(setup.fetch.mock.calls[1][1].body);
});

test('a fresh blocked invitation is denied definitively rather than trapping the account in a pending acceptance', async () => {
  const setup = fixture();
  setup.fetch.mockImplementation(async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      version: 1,
      code: 'pilot-access-required',
      error: 'PRIVATE POLICY DETAIL',
    }),
  }));
  const pending = setup.store.redeemInvitation({
    id: '66666666-6666-4666-8666-666666666666',
    secret: 'a'.repeat(64),
  });
  const outcome = pending.then(
    (value) => ({ value }),
    (error) => ({ code: error.code })
  );
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.store.saveState.phase).toBe('failed');
  await expect(outcome).resolves.toEqual({ code: 'pilot-access-required' });
  expect(setup.store.pending).toBeNull();
  expect(setup.store.saveState.error.message).not.toContain('PRIVATE POLICY DETAIL');
});

test('a later account block cannot turn an already-uncertain acceptance into a false definitive rejection', async () => {
  const setup = fixture();
  const id = '66666666-6666-4666-8666-666666666666';
  const receipt = { version: 1, invitationId: id, access: accessSummary('member') };
  let blocked = true;
  setup.fetch.mockImplementation(async () => {
    if (setup.fetch.mock.calls.length === 1) throw new TypeError('Synthetic lost reply');
    return blocked
      ? {
          ok: false,
          status: 403,
          json: async () => ({ version: 1, code: 'pilot-access-required', error: 'Blocked' }),
        }
      : { ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) };
  });
  const pending = setup.store.redeemInvitation({ id, secret: 'a'.repeat(64) });
  await new Promise((resolve) => setImmediate(resolve));
  await expect(setup.store.retryPending()).rejects.toMatchObject({ code: 'pilot-access-required' });
  expect(setup.store.saveState.phase).toBe('uncertain');
  expect(setup.store.saveState.commandId).toBe(commandId);
  blocked = false;
  await setup.store.retryPending();
  await expect(pending).resolves.toEqual(receipt);
  expect(
    setup.fetch.mock.calls.every(
      ([, options]) => options.body === setup.fetch.mock.calls[0][1].body
    )
  ).toBe(true);
});

test('owner invitation management validates the current seat projection and binds a revocation to its intended link', async () => {
  const setup = fixture();
  const invitation = {
    version: 1,
    id: '66666666-6666-4666-8666-666666666666',
    campaignId,
    seatId: '77777777-7777-4777-8777-777777777777',
    createdAt: '2026-11-11T00:00:00.000Z',
    expiresAt: '2026-11-18T00:00:00.000Z',
    status: 'pending',
  };
  const seat = {
    version: 1,
    id: invitation.seatId,
    name: 'Reserved seat',
    characterIds: [],
    joined: false,
    invitation,
  };
  let result = [seat];
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ version: 1, result }),
  }));
  await expect(setup.store.listSeats(campaignId)).resolves.toEqual([seat]);
  expect(setup.fetch.mock.calls[0][0]).toBe(
    `${runtime.apiOrigin}/api/cloud/campaigns/${campaignId}/seats`
  );
  for (const invalid of [
    [seat, seat],
    [{ ...seat, memberUid: 'private-member' }],
    [{ ...seat, joined: true }],
    [{ ...seat, invitation: { ...invitation, campaignId: commandId } }],
    [{ ...seat, invitation: { ...invitation, tokenHash: 'a'.repeat(64) } }],
  ]) {
    result = invalid;
    await expect(setup.store.listSeats(campaignId)).rejects.toMatchObject({
      code: 'invalid-cloud-response',
    });
  }
  result = {
    version: 1,
    invitationId: invitation.id,
    revokedAt: '2026-11-11T01:00:00.000Z',
  };
  await expect(setup.store.revokeInvitation(campaignId, invitation.id)).resolves.toEqual(result);
  const [url, options] = setup.fetch.mock.calls.at(-1);
  expect(url).toBe(`${runtime.apiOrigin}/api/cloud/campaigns/${campaignId}/invitations/revoke`);
  expect(JSON.parse(options.body)).toEqual({ commandId, invitationId: invitation.id });
});

test('an already-dirty scene checkpoint waits for invitation metadata instead of failing its canonical save', async () => {
  const setup = fixture({ crypto: webcrypto });
  let release;
  let begin;
  const started = new Promise((resolve) => {
    begin = resolve;
  });
  const issued = {
    version: 1,
    id: '66666666-6666-4666-8666-666666666666',
    campaignId,
    seatId: '77777777-7777-4777-8777-777777777777',
    createdAt: '2026-11-11T00:00:00.000Z',
    expiresAt: '2026-11-18T00:00:00.000Z',
  };
  const receipt = { revision: 1, savedAt: '2026-11-11T01:00:00.000Z' };
  setup.fetch.mockImplementation(async (url) => {
    if (url.endsWith('/invitations')) {
      begin();
      return new Promise((resolve) => {
        release = () =>
          resolve({ ok: true, status: 201, json: async () => ({ version: 1, result: issued }) });
      });
    }
    return { ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) };
  });
  const invitation = setup.store.createInvitation(campaignId, { name: 'Pending metadata' });
  await started;
  const scene = setup.store.commitScene(campaignId, {
    ruleset: '2014',
    revision: 0,
    charactersRevision: 0,
    scene: '{"fixture":"already-dirty"}',
  });
  const outcome = scene.then(
    (value) => ({ value }),
    (error) => ({ error })
  );
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.fetch).toHaveBeenCalledTimes(1);
  release();
  await invitation;
  await expect(outcome).resolves.toEqual({ value: receipt });
  expect(setup.fetch).toHaveBeenCalledTimes(2);
  expect(setup.store.saveState.phase).toBe('saved');
});

test('a scene command reports saving until a validated durable receipt arrives, then returns the existing caller shape', async () => {
  const setup = fixture();
  let release;
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  setup.fetch.mockImplementation(async () => {
    began();
    return new Promise((resolve) => {
      release = resolve;
    });
  });
  const states = [];
  const stop = setup.store.subscribeSave((state) => states.push(state.phase));
  const change = {
    ruleset: '2014',
    revision: 0,
    charactersRevision: 0,
    scene: '{"fixture":"scene"}',
  };
  const pending = setup.store.commitScene(campaignId, change);
  await started;
  expect(setup.store.saveState.phase).toBe('saving');
  expect(states).not.toContain('saved');
  const receipt = { revision: 1, savedAt: '2026-11-11T00:00:00.000Z' };
  release({ ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) });
  await expect(pending).resolves.toEqual(receipt);
  expect(setup.store.saveState.phase).toBe('saved');
  const request = JSON.parse(setup.fetch.mock.calls[0][1].body);
  expect(request).toEqual({ commandId, change });
  expect(setup.fetch.mock.calls[0][0]).toBe(
    `${runtime.apiOrigin}/api/cloud/campaigns/${campaignId}/scene`
  );
  stop();
});

test.each(['campaign-limit-reached', 'storage-limit-reached'])(
  'a fresh %s is a truthful denial rather than a permanently pending save',
  async (code) => {
    const setup = fixture();
    setup.fetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ version: 1, code, error: 'PRIVATE BACKEND DETAIL' }),
    });
    const pending =
      code === 'campaign-limit-reached'
        ? setup.store.create({ name: 'Capacity fixture', ruleset: '2014' })
        : setup.store.commitScene(campaignId, {
            ruleset: '2014',
            revision: 0,
            charactersRevision: 0,
            scene: '{"fixture":"capacity"}',
          });
    let failure;
    const settled = pending.catch((error) => {
      failure = error;
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(setup.store.saveState.phase).toBe('failed');
    await settled;
    expect(failure).toMatchObject({ status: 409, code });
    expect(failure.message).not.toContain('PRIVATE BACKEND DETAIL');
    expect(() => setup.store.close()).not.toThrow();
  }
);

test.each([
  ['campaign-limit-reached', 409],
  ['storage-limit-reached', 409],
  ['request-limit-reached', 429],
  ['cloud-requests-busy', 503],
  ['asset-processing-busy', 503],
  ['usage-initializing', 503],
])(
  '%s after a lost reply preserves the original caller and command until its receipt is recovered',
  async (code, status) => {
    const setup = fixture();
    let attempts = 0;
    const receipt = { revision: 1, savedAt: '2026-11-11T00:00:00.000Z' };
    setup.fetch.mockImplementation(async () => {
      attempts++;
      if (attempts === 1) throw new Error('Synthetic lost reply');
      if (attempts === 2)
        return {
          ok: false,
          status,
          json: async () => ({ version: 1, code, error: 'PRIVATE BACKEND DETAIL' }),
        };
      return { ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) };
    });
    const pending = setup.store.commitScene(campaignId, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: 0,
      scene: '{"fixture":"capacity retry"}',
    });
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      }
    );
    await new Promise((resolve) => setImmediate(resolve));
    await expect(setup.store.retryPending()).rejects.toMatchObject({ status, code });
    expect(setup.store.saveState.phase).toBe('uncertain');
    expect(setup.store.saveState.error.message).not.toContain('PRIVATE BACKEND DETAIL');
    expect(settled).toBe(false);
    await expect(setup.store.retryPending()).resolves.toEqual(receipt);
    await expect(pending).resolves.toEqual(receipt);
    expect(setup.store.saveState.phase).toBe('saved');
    expect(new Set(setup.fetch.mock.calls.map((call) => call[1].body)).size).toBe(1);
  }
);

test('an uncertain command retains one ID and the original caller until explicit online retry resolves its receipt', async () => {
  const setup = fixture();
  let attempts = 0;
  const receipt = { revision: 1, savedAt: '2026-11-11T00:00:00.000Z' };
  setup.fetch.mockImplementation(async () => {
    if (++attempts === 1) throw new Error('HTTP response was lost');
    return { ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) };
  });
  const change = {
    ruleset: '2014',
    revision: 0,
    charactersRevision: 0,
    scene: '{"fixture":"pending"}',
  };
  const pending = setup.store.commitScene(campaignId, change);
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  await new Promise((resolve) => setImmediate(resolve));
  expect(setup.store.saveState.phase).toBe('uncertain');
  expect(setup.store.saveState.commandId).toBe(commandId);
  expect(settled).toBe(false);
  expect(() => setup.store.close()).toThrow('Resolve the pending cloud save');
  await expect(
    setup.store.commitCharacters(campaignId, { ruleset: '2014', revision: 0, records: [] })
  ).rejects.toMatchObject({ status: 409, code: 'pending-cloud-command' });
  await expect(setup.store.retryPending()).resolves.toEqual(receipt);
  await expect(pending).resolves.toEqual(receipt);
  expect(setup.store.saveState.phase).toBe('saved');
  expect(setup.fetch).toHaveBeenCalledTimes(2);
  expect(setup.fetch.mock.calls[0][1].body).toBe(setup.fetch.mock.calls[1][1].body);
});

test('a malformed success response remains unconfirmed and cannot be reported as saved', async () => {
  const setup = fixture();
  let valid = false;
  setup.fetch.mockImplementation(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      version: 1,
      result: { revision: valid ? 1 : 9, savedAt: '2026-11-11T00:00:00.000Z' },
    }),
  }));
  const pending = setup.store.commitScene(campaignId, {
    ruleset: '2014',
    revision: 0,
    charactersRevision: 0,
    scene: '{"fixture":"ack"}',
  });
  let saved = false;
  void pending.then(() => {
    saved = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  expect(saved).toBe(false);
  expect(setup.store.saveState.phase).toBe('uncertain');
  expect(setup.store.saveState.error.code).toBe('invalid-cloud-response');
  valid = true;
  await setup.store.retryPending();
  await pending;
  expect(saved).toBe(true);
});

test('definitive conflicts reject with current revisions, while account changes and offline state cannot create another command', async () => {
  const setup = fixture();
  const currentUser = setup.auth.currentUser;
  setup.fetch.mockImplementation(async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      version: 1,
      code: 'stale-revision',
      error: 'PRIVATE BACKEND DETAIL',
      current: { sceneRevision: 3, charactersRevision: 2 },
    }),
  }));
  await expect(
    setup.store.commitScene(campaignId, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: 0,
      scene: '{"fixture":"conflict"}',
    })
  ).rejects.toMatchObject({
    status: 409,
    code: 'stale-revision',
    current: { sceneRevision: 3, charactersRevision: 2 },
  });
  expect(setup.store.saveState.phase).toBe('failed');
  expect(setup.store.saveState.error.message).not.toContain('PRIVATE BACKEND DETAIL');
  await expect(setup.store.retryPending()).rejects.toMatchObject({
    code: 'no-pending-cloud-command',
  });
  const calls = setup.fetch.mock.calls.length;
  setup.auth.currentUser = { ...currentUser, uid: 'uid-b' };
  await expect(setup.store.list()).rejects.toMatchObject({ code: 'account-changed' });
  setup.auth.currentUser = currentUser;
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  try {
    await expect(
      setup.store.commitScene(campaignId, {
        ruleset: '2014',
        revision: 0,
        charactersRevision: 0,
        scene: '{"fixture":"offline"}',
      })
    ).rejects.toMatchObject({ status: 503, code: 'cloud-offline' });
    expect(setup.fetch.mock.calls).toHaveLength(calls);
    expect(setup.store.saveState.commandId).toBeNull();
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete globalThis.navigator;
  }
});
