/** @jest-environment node */
import { EventEmitter } from 'node:events';
import { openCloudEventStream } from '../../../tools/cloud/event-stream.js';
import { CloudError } from '../../../tools/cloud/cloud-error.js';

function transportFixture() {
  const principal = { uid: 'uid-a', emailVerified: true };
  const sessionId = '11111111-1111-4111-8111-111111111111';
  const seatId = '22222222-2222-4222-8222-222222222222';
  const lease = {
    version: 1,
    uid: principal.uid,
    id: '33333333-3333-4333-8333-333333333333',
    expiresAt: Date.now() + 90000,
  };
  const observation = { ready: Promise.resolve(), close: jest.fn() };
  const store = {
    now: () => Date.now(),
    getLiveAccess: jest.fn(async () => ({
      participant: { access: { role: 'member', seatId, accessGeneration: 1 } },
    })),
    getParticipantAccess: jest.fn(async () => ({})),
    usage: {
      acquireStream: jest.fn(async () => lease),
      renewStream: jest.fn(async (_principal, current) => ({
        ...current,
        expiresAt: Date.now() + 90000,
      })),
      releaseStream: jest.fn(async () => ({ released: true })),
    },
    observeParticipant: jest.fn(() => observation),
    connectLivePresence: jest.fn(async () => ({
      id: '44444444-4444-4444-8444-444444444444',
      expiresAt: Date.now() + 90000,
    })),
    renewLivePresence: jest.fn(async () => ({
      id: '44444444-4444-4444-8444-444444444444',
      expiresAt: Date.now() + 90000,
    })),
    disconnectLivePresence: jest.fn(async () => ({ closed: true })),
  };
  const request = new EventEmitter();
  request.headers = { authorization: 'Bearer fixture-only' };
  const response = new EventEmitter();
  Object.assign(response, {
    destroyed: false,
    writableEnded: false,
    headersSent: false,
    writeHead: jest.fn(() => {
      response.headersSent = true;
    }),
    flushHeaders: jest.fn(),
    write: jest.fn(() => true),
    end: jest.fn(() => {
      response.writableEnded = true;
    }),
  });
  return {
    observation,
    lease,
    request,
    response,
    principal,
    id: '55555555-5555-4555-8555-555555555555',
    command: { sessionId, observerTokenId: 'token-1', mapId: 'map-main', assetKey: null },
    scope: { seatId, accessGeneration: 1 },
    headers: {},
    access: { verifyAuthorization: jest.fn(async () => principal) },
    store,
  };
}

test.each(['event-count', 'utf8-bytes'])(
  'a backpressured stream accepts its exact %s queue boundary and drops queued private data on overflow',
  async (bound) => {
    jest.useFakeTimers();
    let stream;
    try {
      const setup = transportFixture();
      stream = await openCloudEventStream(setup);
      setup.response.write.mockReturnValue(false);
      const emit = setup.store.observeParticipant.mock.calls[0][4].onEvent;
      emit({ kind: 'checkpoint', checkpoint: { generation: 1 } });
      if (bound === 'event-count') {
        for (let generation = 2; generation <= 17; generation++)
          emit({ kind: 'delta', delta: { generation, value: 'PRIVATE QUEUED DATA' } });
      } else {
        const event = { kind: 'resync', checkpoint: { generation: 2, value: '' } };
        const overhead = Buffer.byteLength(
          `id: 2\nevent: resync\ndata: ${JSON.stringify(event)}\n\n`
        );
        event.checkpoint.value = 'x'.repeat(32 * 1024 * 1024 - overhead);
        emit(event);
      }
      expect(setup.response.end).not.toHaveBeenCalled();
      expect(setup.response.write).toHaveBeenCalledTimes(1);
      emit({ kind: 'delta', delta: { generation: 18, value: 'PRIVATE OVERFLOW DATA' } });
      await stream.done;
      setup.response.emit('drain');
      expect(setup.response.write).toHaveBeenCalledTimes(2);
      const wire = setup.response.write.mock.calls.map(([text]) => text).join('');
      expect(wire).toContain('"code":"stream-client-too-slow"');
      expect(wire).not.toContain('PRIVATE');
      expect(setup.store.usage.releaseStream).toHaveBeenCalledTimes(1);
      expect(setup.store.disconnectLivePresence).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await stream?.close();
      jest.useRealTimers();
    }
  }
);

test('aborting after headers but before presence publication releases the eventual presence without sending a checkpoint', async () => {
  jest.useFakeTimers();
  let stream;
  let publishPresence;
  try {
    const setup = transportFixture();
    const flushed = Promise.withResolvers();
    const presence = Promise.withResolvers();
    publishPresence = () => presence.resolve({ id: '44444444-4444-4444-8444-444444444444' });
    setup.response.flushHeaders.mockImplementation(() => flushed.resolve());
    setup.store.connectLivePresence.mockReturnValue(presence.promise);
    const opening = openCloudEventStream(setup);
    await flushed.promise;
    setup.request.emit('aborted');
    publishPresence();
    stream = await opening;
    await stream.done;
    expect(setup.store.disconnectLivePresence).toHaveBeenCalledTimes(1);
    expect(setup.store.usage.releaseStream).toHaveBeenCalledTimes(1);
    expect(setup.observation.close).toHaveBeenCalledTimes(1);
    expect(setup.response.write.mock.calls.map(([text]) => text).join('')).not.toContain(
      'checkpoint'
    );
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    publishPresence?.();
    await stream?.close();
    jest.useRealTimers();
  }
});

test('a live pause committed during presence publication fences the initial queued checkpoint before delivery', async () => {
  jest.useFakeTimers();
  let stream;
  try {
    const setup = transportFixture();
    setup.store.observeParticipant.mockImplementation(
      (_principal, _id, _view, _scope, callbacks) => {
        callbacks.onEvent({
          kind: 'checkpoint',
          checkpoint: { generation: 1, value: 'PRIVATE QUEUED CHECKPOINT' },
        });
        return setup.observation;
      }
    );
    setup.store.connectLivePresence.mockImplementation(async () => {
      setup.store.getLiveAccess.mockRejectedValue(
        new CloudError(409, 'live-session-paused', 'Paused')
      );
      return { id: '44444444-4444-4444-8444-444444444444' };
    });
    stream = await openCloudEventStream(setup);
    expect(setup.response.end).toHaveBeenCalledTimes(1);
    await stream.done;
    const wire = setup.response.write.mock.calls.map(([text]) => text).join('');
    expect(wire).toContain('"code":"live-session-paused"');
    expect(wire).not.toContain('PRIVATE');
    expect(setup.store.usage.releaseStream).toHaveBeenCalledTimes(1);
    expect(setup.store.disconnectLivePresence).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await stream?.close();
    jest.useRealTimers();
  }
});

test('the 55-minute transport deadline closes only the stream after bounded heartbeats and verified renewals', async () => {
  jest.useFakeTimers();
  let stream;
  try {
    const setup = transportFixture();
    stream = await openCloudEventStream(setup);
    await jest.advanceTimersByTimeAsync(55 * 60 * 1000 - 1);
    expect(setup.response.end).not.toHaveBeenCalled();
    const heartbeats = setup.response.write.mock.calls.filter(([text]) => text === ':\n\n');
    expect(heartbeats.length).toBe(131);
    expect(setup.access.verifyAuthorization).toHaveBeenCalledTimes(54);
    await jest.advanceTimersByTimeAsync(1);
    await stream.done;
    expect(setup.response.write).toHaveBeenLastCalledWith(
      'event: closed\ndata: {"kind":"closed","code":"stream-deadline"}\n\n'
    );
    expect(setup.store.usage.releaseStream).toHaveBeenCalledTimes(1);
    expect(setup.store.disconnectLivePresence).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await stream?.close();
    jest.useRealTimers();
  }
});

test('a shared coalesced presence lease stays live when another connection shifts its renewal phase', async () => {
  jest.useFakeTimers();
  jest.setSystemTime(0);
  let stream;
  try {
    const setup = transportFixture();
    let renewedAt = Date.now();
    let expiresAt = renewedAt + 90000;
    const presence = () => ({
      id: '44444444-4444-4444-8444-444444444444',
      expiresAt,
    });
    setup.store.connectLivePresence.mockImplementation(async () => presence());
    setup.store.usage.renewStream.mockImplementation(async (_principal, lease) => ({
      ...lease,
      expiresAt: Date.now() + 90000,
    }));
    setup.store.renewLivePresence.mockImplementation(async () => {
      if (Date.now() >= expiresAt)
        throw new CloudError(409, 'live-presence-expired', 'Reconnect after an expired lease');
      if (Date.now() - renewedAt >= 60000) {
        renewedAt = Date.now();
        expiresAt = renewedAt + 90000;
      }
      return presence();
    });
    stream = await openCloudEventStream(setup);
    await jest.advanceTimersByTimeAsync(1);
    renewedAt = Date.now();
    expiresAt = renewedAt + 90000;
    await jest.advanceTimersByTimeAsync(180000);
    expect(setup.response.end).not.toHaveBeenCalled();
    expect(expiresAt).toBeGreaterThan(Date.now());
    await stream.close();
    expect(setup.store.disconnectLivePresence).toHaveBeenCalledTimes(1);
    expect(setup.store.usage.releaseStream).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await stream?.close();
    jest.useRealTimers();
  }
});

test('closing a stream waits for its in-flight renewal and releases the final lease exactly once', async () => {
  jest.useFakeTimers();
  let stream;
  let finishPending;
  try {
    const setup = transportFixture();
    const { principal, lease, store, response } = setup;
    const renewed = { ...lease, expiresAt: 150000 };
    let releaseRenewal;
    let began;
    const pending = new Promise((resolve) => {
      releaseRenewal = resolve;
    });
    finishPending = () => releaseRenewal(renewed);
    const started = new Promise((resolve) => {
      began = resolve;
    });
    store.usage.renewStream.mockImplementation(() => {
      began();
      return pending;
    });
    stream = await openCloudEventStream(setup);
    const renewal = stream.renew();
    await started;
    const closing = stream.close();
    await Promise.resolve();
    await Promise.resolve();
    expect(store.usage.releaseStream).not.toHaveBeenCalled();
    releaseRenewal(renewed);
    await Promise.all([renewal, closing]);
    expect(store.usage.releaseStream).toHaveBeenCalledTimes(1);
    expect(store.usage.releaseStream).toHaveBeenCalledWith(principal, renewed);
    expect(store.disconnectLivePresence).toHaveBeenCalledTimes(1);
    expect(response.end).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    finishPending?.();
    await stream?.close();
    jest.useRealTimers();
  }
});

test('an observation teardown failure still releases presence and the UID lease and reports only a redacted close failure', async () => {
  jest.useFakeTimers();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  let stream;
  try {
    const setup = transportFixture();
    setup.observation.close.mockImplementation(() => {
      throw new Error('PRIVATE WATCHER DETAIL');
    });

    stream = await openCloudEventStream(setup);
    await stream.close();
    expect(setup.store.disconnectLivePresence).toHaveBeenCalledTimes(1);
    expect(setup.store.usage.releaseStream).toHaveBeenCalledTimes(1);
    expect(setup.response.end).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[cloud-stream-cleanup]', {
      code: 'stream-cleanup-failed',
      kind: 'error',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE WATCHER DETAIL');
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await stream?.close();
    log.mockRestore();
    jest.useRealTimers();
  }
});

test.each(['invalid-identity', 'stream-lease-expired', 'unexpected'])(
  'a failed %s renewal closes the stream, releases its resources and never echoes provider diagnostics',
  async (kind) => {
    jest.useFakeTimers();
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    let stream;
    try {
      const setup = transportFixture();
      const error =
        kind === 'unexpected'
          ? Object.assign(new Error('PRIVATE PROVIDER DETAIL'), { code: 'PRIVATE_PROVIDER_CODE' })
          : new CloudError(
              kind === 'invalid-identity' ? 401 : 409,
              kind,
              'PRIVATE PROVIDER DETAIL'
            );
      if (kind === 'invalid-identity') setup.access.verifyAuthorization.mockRejectedValue(error);
      else setup.store.usage.renewStream.mockRejectedValue(error);
      stream = await openCloudEventStream(setup);
      await expect(stream.renew()).rejects.toBe(error);
      await stream.done;
      const wire = setup.response.write.mock.calls.map(([text]) => text).join('');
      expect(wire).toContain(
        JSON.stringify({
          kind: 'closed',
          code: kind === 'unexpected' ? 'stream-unavailable' : kind,
        })
      );
      expect(wire).not.toContain('PRIVATE');
      expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');
      expect(setup.store.usage.releaseStream).toHaveBeenCalledTimes(1);
      expect(setup.store.disconnectLivePresence).toHaveBeenCalledTimes(1);
      expect(setup.observation.close).toHaveBeenCalledTimes(1);
      expect(setup.response.end).toHaveBeenCalledTimes(1);
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      await stream?.close();
      log.mockRestore();
      jest.useRealTimers();
    }
  }
);
