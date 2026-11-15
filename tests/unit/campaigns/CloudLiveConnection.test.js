/** @jest-environment node */
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';
import CloudCampaignClientStore from '../../../src/campaigns/CloudCampaignClientStore.js';
import { emptyPlayerScene } from '../../../src/campaigns/PlayerPublicProtocol.js';
import { PLAYER_COMMAND_KINDS } from '../../../src/campaigns/PlayerCommandProtocol.js';
import { logger } from '../../../src/utils/logger/Logger.js';

const campaignId = '11111111-1111-4111-8111-111111111111';
const sessionId = '22222222-2222-4222-8222-222222222222';
const scope = {
  version: 1,
  uid: 'uid-a',
  campaignId,
  role: 'owner',
  seatId: null,
  accessGeneration: 0,
};
const view = { sessionId, observerTokenId: null, mapId: null, assetKey: null };
const packs = [{ id: 'srd-2014', ruleset: '2014', version: '5.1-seed.1' }];
const head = (generation) => ({
  kind: 'owner-head',
  version: 1,
  access: { ...scope },
  sessionId,
  head: { generation, charactersRevision: 0, sceneRevision: 0, sceneSavedAt: null },
});

function memberCheckpoint() {
  const campaign = {
    version: 1,
    id: campaignId,
    name: 'Live member checkpoint',
    ruleset: '2014',
    coreVersion: '5.1',
    sourcePacks: [{ ...packs[0], enabled: true }],
    createdAt: '2026-11-14T00:00:00.000Z',
    charactersRevision: 0,
    sceneRevision: 0,
    sceneSavedAt: null,
  };
  const state = {
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
    gameplay: { version: 1, commands: [...PLAYER_COMMAND_KINDS], ownedTokens: [], turn: null },
    publicScene: emptyPlayerScene(),
  };
  return {
    version: 1,
    access: {
      ...scope,
      role: 'member',
      seatId: '33333333-3333-4333-8333-333333333333',
      accessGeneration: 1,
    },
    sessionId,
    generation: 1,
    viewKey: 'a'.repeat(64),
    state,
    manifest: { version: 1, images: [] },
  };
}

function memberDelta(previous, next) {
  const base = {
    version: 1,
    access: next.access,
    sessionId,
    baseGeneration: previous.generation,
    generation: next.generation,
    viewKey: next.viewKey,
  };
  return previous.viewKey !== next.viewKey
    ? { ...base, kind: 'replace', checkpoint: next }
    : {
        ...base,
        kind: 'update',
        changes: {
          campaign: next.state.campaign,
          revision: next.state.revision,
          sceneRevision: next.state.sceneRevision,
          sceneSavedAt: next.state.sceneSavedAt,
          actors: { upserts: [], removes: [] },
          records: { upserts: [], removes: [] },
          observers: null,
          doors: null,
          gameplay: null,
        },
      };
}

function fixture({ access = scope } = {}) {
  let token = 'initial-token';
  const getIdToken = jest.fn(async (refresh) => {
    if (refresh) token = 'renewed-token';
    return token;
  });
  const auth = { currentUser: { uid: scope.uid, emailVerified: true, getIdToken } };
  const observers = new Set();
  const account = new CloudAccount({
    auth,
    sdk: {
      signInWithEmailAndPassword: async () => {},
      signOut: async () => {
        auth.currentUser = null;
      },
      onAuthStateChanged: (_auth, listener) => {
        observers.add(listener);
        listener(auth.currentUser);
        return () => observers.delete(listener);
      },
    },
  });
  const sources = [];
  const heartbeats = [];
  const openings = new Map();
  const fetch = jest.fn(async () => {
    let heartbeat;
    const connectionId = `44444444-4444-4444-8444-${String(sources.length).padStart(12, '0')}`;
    return new Response(
      new ReadableStream({
        start(controller) {
          const index = sources.length;
          sources.push(controller);
          heartbeat = setInterval(
            () => controller.enqueue(new TextEncoder().encode(':\n\n')),
            25000
          );
          heartbeats[index] = heartbeat;
          openings.get(index)?.();
          openings.delete(index);
        },
        cancel() {
          clearInterval(heartbeat);
        },
      }),
      {
        headers: {
          'Content-Type': 'text/event-stream',
          'X-TavernTable-Live-Connection': connectionId,
        },
      }
    );
  });
  // Keep reconnection assertions scoped to event opens, with control traffic tracked separately.
  const controlFetch = jest.fn(async (url, options) => {
    const { connectionId } = JSON.parse(options.body);
    const result = url.endsWith('/ack')
      ? { version: 1, connectionId, expiresAt: Date.now() + 90000 }
      : { version: 1, connectionId, closed: true, transportClosed: true };
    return new Response(JSON.stringify({ version: 1, result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  });
  const connection = new CloudAccountConnection({
    account,
    fetch: (url, options) =>
      url.includes('/live/presence/') ? controlFetch(url, options) : fetch(url, options),
    baseURL: 'http://127.0.0.1:19410/',
    runtime: {
      version: 1,
      mode: 'cloud',
      environment: 'emulator',
      apiOrigin: 'http://127.0.0.1:19410',
      authEmulatorOrigin: 'http://127.0.0.1:19099',
      firebase: {
        apiKey: 'demo-api-key',
        projectId: 'demo-taverntable',
        authDomain: 'demo-taverntable.firebaseapp.com',
        appId: 'demo-live-reconciliation',
      },
    },
  });
  const store = new CloudCampaignClientStore({
    connection,
    uid: scope.uid,
    packs,
    crypto: { randomUUID: () => sessionId },
  });
  const states = [];
  const statuses = [];
  return {
    auth,
    observers,
    fetch,
    controlFetch,
    store,
    states,
    statuses,
    getIdToken,
    observe: () =>
      store.observeEvents(campaignId, view, access, {
        onState: (state, context) => states.push({ state, context }),
        onStatus: (status) => statuses.push(status),
      }),
    opened: (index) =>
      sources.length > index
        ? Promise.resolve()
        : new Promise((resolve) => openings.set(index, resolve)),
    send: (index, event) => {
      const generation =
        event.head?.generation ?? event.checkpoint?.generation ?? event.delta?.generation;
      sources[index].enqueue(
        new TextEncoder().encode(
          `${generation === undefined ? '' : `id: ${generation}\n`}event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`
        )
      );
    },
    truncate: (index) => {
      clearInterval(heartbeats[index]);
      sources[index].enqueue(
        new TextEncoder().encode('id: 2\nevent: owner-head\ndata: {"kind":"owner-head","head":')
      );
      sources[index].close();
    },
    changeIdentity: (user) => {
      auth.currentUser = user;
      for (const listener of observers) listener(user);
    },
  };
}

test('a browser connectivity change cancels the existing stream and renews identity before a fresh reconciled checkpoint can become ready', async () => {
  const first = memberCheckpoint();
  const setup = fixture({ access: first.access });
  const observation = setup.observe();
  try {
    await setup.opened(0);
    setup.send(0, { kind: 'checkpoint', checkpoint: first });
    await observation.ready;
    observation.reconnect();
    expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(setup.statuses.at(-1).phase).toBe('reconnecting');
    await setup.opened(1);
    expect(setup.getIdToken).toHaveBeenCalledWith(true);
    expect(setup.states).toHaveLength(1);
    expect(setup.statuses.at(-1).phase).not.toBe('ready');
    const current = { ...first, generation: first.generation + 1 };
    setup.send(1, { kind: 'checkpoint', checkpoint: current });
    for (let turn = 0; turn < 20 && setup.states.length < 2; turn++) await Promise.resolve();
    expect(setup.states).toHaveLength(2);
    expect(setup.states[1]).toMatchObject({
      state: { generation: current.generation },
      context: { reconcile: true },
    });
  } finally {
    await observation.close();
    setup.store.close();
  }
});

test('network retries back off to a bounded thirty-second ceiling and never mark unverified state ready', async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0.999999);
  const log = jest.spyOn(logger, 'log').mockImplementation(() => {});
  const setup = fixture();
  setup.fetch.mockRejectedValue(new TypeError('Synthetic network loss'));
  const observation = setup.observe();
  const readiness = expect(observation.ready).rejects.toMatchObject({ code: 'stream-closed' });
  try {
    await jest.advanceTimersByTimeAsync(0);
    let attempts = 1;
    for (const delay of [1999, 3999, 7999, 15999, 29999, 29999]) {
      expect(setup.fetch).toHaveBeenCalledTimes(attempts);
      await jest.advanceTimersByTimeAsync(delay - 1);
      expect(setup.fetch).toHaveBeenCalledTimes(attempts);
      await jest.advanceTimersByTimeAsync(1);
      expect(setup.fetch).toHaveBeenCalledTimes(++attempts);
    }
    expect(setup.states).toHaveLength(0);
    expect(setup.statuses.some((status) => status.phase === 'ready')).toBe(false);
    await observation.close();
    await readiness;
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    await readiness;
    random.mockRestore();
    log.mockRestore();
    jest.useRealTimers();
  }
});

test('a reconnect cannot replace a verified current checkpoint with an older generation', async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const setup = fixture();
  const observation = setup.observe();
  try {
    await setup.opened(0);
    setup.send(0, head(3));
    await observation.ready;
    setup.send(0, { kind: 'closed', code: 'stream-unavailable' });
    await jest.advanceTimersByTimeAsync(1000);
    setup.send(1, head(2));
    await jest.advanceTimersByTimeAsync(0);
    await observation.done;
    expect(setup.states.map(({ state }) => state.head.generation)).toEqual([3]);
    expect(setup.statuses.at(-1)).toEqual({ phase: 'error', reason: 'invalid-change-history' });
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    random.mockRestore();
    jest.useRealTimers();
  }
});

test('a stream truncated during an event recovers a fresh checkpoint without accepting or replaying the partial state', async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const setup = fixture();
  const observation = setup.observe();
  try {
    await setup.opened(0);
    setup.send(0, head(1));
    await observation.ready;
    setup.truncate(0);
    await jest.advanceTimersByTimeAsync(0);
    expect(setup.statuses.at(-1)).toEqual({
      phase: 'reconnecting',
      reason: 'invalid-cloud-stream',
    });
    await jest.advanceTimersByTimeAsync(1000);
    expect(setup.fetch).toHaveBeenCalledTimes(2);
    setup.send(1, head(3));
    await jest.advanceTimersByTimeAsync(0);
    expect(setup.states.map(({ state }) => state.head.generation)).toEqual([1, 3]);
    expect(setup.states.at(-1).context.reconcile).toBe(true);
    expect(setup.statuses.at(-1).phase).toBe('ready');
    await observation.close();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    random.mockRestore();
    jest.useRealTimers();
  }
});

test('a failed live state listener stops with a redacted typed error instead of exposing private callback data', async () => {
  jest.useFakeTimers();
  const log = jest.spyOn(logger, 'log').mockImplementation(() => {});
  const setup = fixture();
  const observation = setup.store.observeEvents(campaignId, view, scope, {
    onState: () => {
      throw new Error('PRIVATE LIVE CALLBACK DATA');
    },
    onStatus: (status) => setup.statuses.push(status),
  });
  const readiness = expect(observation.ready).rejects.toMatchObject({
    code: 'live-listener-failed',
    status: 503,
  });
  try {
    await setup.opened(0);
    setup.send(0, head(1));
    await readiness;
    await observation.done;
    expect(setup.statuses.at(-1)).toEqual({ phase: 'error', reason: 'live-listener-failed' });
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE LIVE CALLBACK DATA');
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    log.mockRestore();
    jest.useRealTimers();
  }
});

test.each(['missing delta', 'duplicate delta'])(
  'a %s disables live readiness and recovers only the latest member checkpoint',
  async (kind) => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(0);
    const first = memberCheckpoint();
    const second = structuredClone(first);
    second.generation = 2;
    second.state.campaign.name = 'Second generation';
    const third = structuredClone(second);
    third.generation = 3;
    third.state.campaign.name = 'Latest generation';
    const setup = fixture({ access: first.access });
    const observation = setup.observe();
    try {
      await setup.opened(0);
      setup.send(0, { kind: 'checkpoint', checkpoint: first });
      await observation.ready;
      if (kind === 'duplicate delta') {
        setup.send(0, { kind: 'delta', delta: memberDelta(first, second) });
        await jest.advanceTimersByTimeAsync(0);
        setup.send(0, { kind: 'delta', delta: memberDelta(first, second) });
      } else setup.send(0, { kind: 'delta', delta: memberDelta(second, third) });
      await jest.advanceTimersByTimeAsync(0);
      expect(setup.statuses.at(-1)).toEqual({
        phase: 'reconnecting',
        reason: 'participant-delta-gap',
      });
      await jest.advanceTimersByTimeAsync(1000);
      expect(setup.fetch).toHaveBeenCalledTimes(2);
      setup.send(1, { kind: 'checkpoint', checkpoint: third });
      await jest.advanceTimersByTimeAsync(0);
      expect(setup.states.map(({ state }) => state.generation)).toEqual(
        kind === 'duplicate delta' ? [1, 2, 3] : [1, 3]
      );
      expect(setup.states.at(-1)).toEqual({ state: third, context: { reconcile: true } });
      expect(setup.statuses.at(-1).phase).toBe('ready');
      await observation.close();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await observation.close();
      random.mockRestore();
      jest.useRealTimers();
    }
  }
);

test.each([
  ['live-session-paused', 'paused'],
  ['live-session-changed', 'ended'],
  ['campaign-access-changed', 'denied'],
  ['campaign-not-found', 'denied'],
  ['pilot-access-required', 'denied'],
])(
  'a %s control stops all reconnection without reviving an old checkpoint',
  async (code, phase) => {
    jest.useFakeTimers();
    const setup = fixture();
    const observation = setup.observe();
    try {
      await setup.opened(0);
      setup.send(0, head(1));
      await observation.ready;
      setup.send(0, { kind: 'closed', code });
      await jest.advanceTimersByTimeAsync(30000);
      await observation.done;
      expect(setup.statuses.at(-1)).toEqual({ phase, reason: code });
      expect(setup.fetch).toHaveBeenCalledTimes(1);
      expect(setup.states).toHaveLength(1);
      expect(setup.observers.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await observation.close();
      jest.useRealTimers();
    }
  }
);

test('contiguous member deltas publish live state but a changed view is reconciled as an atomic replacement', async () => {
  jest.useFakeTimers();
  const first = await memberCheckpoint();
  const setup = fixture({ access: first.access });
  const second = structuredClone(first);
  second.generation = 2;
  second.state.campaign.name = 'Renamed current campaign';
  const third = structuredClone(second);
  third.generation = 3;
  third.viewKey = 'b'.repeat(64);
  const observation = setup.observe();
  try {
    await setup.opened(0);
    setup.send(0, { kind: 'checkpoint', checkpoint: first });
    await observation.ready;
    setup.send(0, { kind: 'delta', delta: memberDelta(first, second) });
    await jest.advanceTimersByTimeAsync(0);
    setup.send(0, { kind: 'delta', delta: memberDelta(second, third) });
    await jest.advanceTimersByTimeAsync(0);
    expect(setup.states.map(({ state }) => state.generation)).toEqual([1, 2, 3]);
    expect(setup.states.map(({ context }) => context)).toEqual([
      { reconcile: true },
      { reconcile: false },
      { reconcile: true },
    ]);
    expect(setup.statuses.at(-1).phase).toBe('ready');
    await observation.close();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    jest.useRealTimers();
  }
});

test('an expired streaming bearer refreshes the same managed identity once before accepting a new authorized checkpoint', async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const setup = fixture();
  const observation = setup.observe();
  try {
    await setup.opened(0);
    setup.send(0, head(1));
    await observation.ready;
    setup.send(0, { kind: 'closed', code: 'invalid-identity' });
    await jest.advanceTimersByTimeAsync(0);
    expect(setup.statuses.at(-1)).toEqual({ phase: 'reconnecting', reason: 'invalid-identity' });
    await jest.advanceTimersByTimeAsync(1000);
    expect(setup.fetch).toHaveBeenCalledTimes(2);
    const renewals = setup.getIdToken.mock.calls.map(([force]) => force);
    expect(renewals[0]).toBe(false);
    expect(renewals.filter((force) => force)).toHaveLength(1);
    expect(renewals.slice(-2)).toEqual([true, false]);
    setup.send(1, head(2));
    await jest.advanceTimersByTimeAsync(0);
    expect(setup.states.map(({ state }) => state.head.generation)).toEqual([1, 2]);
    expect(setup.statuses.at(-1).phase).toBe('ready');
    await observation.close();
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    random.mockRestore();
    jest.useRealTimers();
  }
});

test('switching accounts during reconnect backoff immediately clears the old observation and stops every retry', async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const setup = fixture();
  const observation = setup.observe();
  try {
    await setup.opened(0);
    setup.send(0, head(1));
    await observation.ready;
    setup.send(0, { kind: 'closed', code: 'stream-unavailable' });
    await jest.advanceTimersByTimeAsync(0);
    expect(setup.statuses.at(-1).phase).toBe('reconnecting');
    setup.changeIdentity({ uid: 'uid-b', emailVerified: true });
    await jest.advanceTimersByTimeAsync(0);
    expect(setup.statuses.at(-1)).toEqual({ phase: 'denied', reason: 'account-changed' });
    await jest.advanceTimersByTimeAsync(30000);
    expect(setup.fetch).toHaveBeenCalledTimes(1);
    expect(setup.states).toHaveLength(1);
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await observation.close();
    random.mockRestore();
    jest.useRealTimers();
  }
});

test('a revoked managed identity during intentional renewal stops rather than spinning another refresh or opening a stream', async () => {
  jest.useFakeTimers();
  const random = jest.spyOn(Math, 'random').mockReturnValue(0);
  const setup = fixture();
  const blocked = Promise.withResolvers();
  let renewals = 0;
  setup.getIdToken.mockImplementation(async (force) => {
    if (!force) return 'initial-token';
    renewals++;
    if (renewals > 1) return blocked.promise;
    throw Object.assign(new Error('Synthetic revoked refresh token'), {
      code: 'auth/user-token-expired',
    });
  });
  const observation = setup.observe();
  try {
    await setup.opened(0);
    setup.send(0, head(1));
    await observation.ready;
    await jest.advanceTimersByTimeAsync(50 * 60 * 1000);
    expect(renewals).toBe(1);
    expect(setup.statuses.at(-1)).toEqual({ phase: 'denied', reason: 'authentication-required' });
    expect(setup.fetch).toHaveBeenCalledTimes(1);
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    const closing = observation.close();
    blocked.resolve('discarded-after-close');
    await closing;
    random.mockRestore();
    jest.useRealTimers();
  }
});

test.each([0, 0.999999])(
  'intentional jitter %s refreshes identity and replaces the stream before its deadline without replaying state',
  async (jitter) => {
    jest.useFakeTimers();
    const random = jest.spyOn(Math, 'random').mockReturnValue(jitter);
    const setup = fixture();
    const observation = setup.observe();
    try {
      await setup.opened(0);
      setup.send(0, head(1));
      await observation.ready;
      await jest.advanceTimersByTimeAsync(50 * 60 * 1000 + Math.floor(jitter * 2 * 60 * 1000) - 1);
      expect(setup.fetch).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1);
      expect(setup.fetch).toHaveBeenCalledTimes(2);
      const renewals = setup.getIdToken.mock.calls.map(([force]) => force);
      expect(renewals[0]).toBe(false);
      expect(renewals.filter((force) => force)).toHaveLength(1);
      expect(renewals.slice(-2)).toEqual([true, false]);
      expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(setup.fetch.mock.calls[1][1].headers.Authorization).toBe('Bearer renewed-token');
      expect(setup.statuses.at(-1).phase).not.toBe('ready');
      setup.send(1, head(1));
      await jest.advanceTimersByTimeAsync(0);
      expect(setup.states.map(({ context }) => context)).toEqual([
        { reconcile: true },
        { reconcile: true },
      ]);
      expect(setup.statuses.at(-1).phase).toBe('ready');
      await observation.close();
      expect(setup.observers.size).toBe(0);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await observation.close();
      random.mockRestore();
      jest.useRealTimers();
    }
  }
);
