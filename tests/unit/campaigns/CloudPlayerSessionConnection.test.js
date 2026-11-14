/** @jest-environment node */
import { createHash } from 'node:crypto';
import CloudPlayerSessionConnection from '../../../src/campaigns/CloudPlayerSessionConnection.js';
import { sceneState } from '../../helpers/sceneState.js';

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

function fixture() {
  let identity = { uid: access.uid };
  const identityListeners = new Set();
  const requests = [];
  const observations = [];
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
      });
    }),
    commitWorldCommand: jest.fn(),
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
  const connection = new CloudPlayerSessionConnection({ store, campaignId, access, sessionId });
  const events = [];
  connection.subscribe((event) => events.push(event));
  return {
    connection,
    store,
    requests,
    observations,
    observed,
    events,
    changeIdentity: (next) => {
      identity = next;
      for (const listener of identityListeners) listener(next);
    },
  };
}

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
