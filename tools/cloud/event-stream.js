const { CloudError } = require('./cloud-error.js');
const {
  isCloudParticipantRequest,
  isCloudOwnerWorldRequest,
  CLOUD_STREAM_LEASE_MS,
  CLOUD_LIVE_CONNECTION_HEADER,
  isCloudUUID,
} = require('../../src/campaigns/CloudProtocol.js');

const HEARTBEAT_MS = 25000;
const RENEW_MS = 60000;
const RENEW_HEADROOM_MS = CLOUD_STREAM_LEASE_MS - RENEW_MS;
const STREAM_DEADLINE_MS = 55 * 60 * 1000;
const MAX_QUEUED_BYTES = 32 * 1024 * 1024;
const MAX_QUEUED_EVENTS = 16;
const activeStreams = new WeakMap();

async function closeCloudEventStream({ store, principal, id, command, scope = null }) {
  if (!isCloudUUID(command?.connectionId) || !isCloudUUID(command?.sessionId))
    throw new CloudError(
      400,
      'invalid-live-command',
      'Choose the current live presence connection'
    );
  const active = activeStreams.get(store)?.get(command.connectionId);
  if (!active) return false;
  if (active.uid !== principal.uid || active.id !== id || active.sessionId !== command.sessionId)
    throw new CloudError(404, 'campaign-not-found', 'This private campaign is not available');
  if (
    scope !== null &&
    (scope.seatId !== active.scope.seatId ||
      scope.accessGeneration !== active.scope.accessGeneration)
  )
    throw new CloudError(409, 'campaign-access-changed', 'Refresh current live player access');
  await active.finish();
  return true;
}

async function openCloudEventStream({
  request,
  response,
  principal,
  id,
  command,
  scope,
  access,
  store,
  headers,
  ownerWorld = false,
}) {
  if (
    (ownerWorld ? !isCloudOwnerWorldRequest(command) : !isCloudParticipantRequest(command)) ||
    !scope ||
    (ownerWorld && scope.seatId !== null) ||
    (!ownerWorld &&
      scope.seatId === null &&
      [command.observerTokenId, command.mapId, command.assetKey].some((value) => value !== null))
  )
    throw new CloudError(400, 'invalid-participant-request', 'Choose current live campaign access');
  const view = ownerWorld
    ? { sessionId: command.sessionId, observerTokenId: null, mapId: null, assetKey: null }
    : structuredClone(command);
  const expected = structuredClone(scope);
  const admit = async (identity) => {
    const granted = await store.getLiveAccess(identity, id, { sessionId: view.sessionId });
    if (
      granted.participant.access.role !== (expected.seatId === null ? 'owner' : 'member') ||
      granted.participant.access.seatId !== expected.seatId ||
      granted.participant.access.accessGeneration !== expected.accessGeneration
    )
      throw new CloudError(409, 'campaign-access-changed', 'Refresh current live player access');
  };
  await admit(principal);
  let lease;
  let presence;
  let observation;
  let booting = true;
  let stopped = false;
  let opened = false;
  let blocked = false;
  let startupError;
  let cleanupPromise;
  let finishPromise;
  let renewing = null;
  let heartbeat;
  let renewal;
  let deadline;
  let queuedBytes = 0;
  const queue = [];
  let done;
  const completed = new Promise((resolve) => {
    done = resolve;
  });
  const cleanup = () => {
    cleanupPromise ??= (async () => {
      clearInterval(heartbeat);
      clearTimeout(renewal);
      clearTimeout(deadline);
      const failures = [];
      try {
        observation?.close();
      } catch (error) {
        failures.push(error);
      }
      if (presence) {
        try {
          await store.disconnectLivePresence(principal, id, {
            sessionId: view.sessionId,
            connectionId: presence.id,
          });
        } catch (error) {
          failures.push(error);
        }
      }
      if (lease) {
        try {
          await store.usage.releaseStream(principal, lease);
        } catch (error) {
          failures.push(error);
        }
      }
      if (presence && activeStreams.get(store)?.get(presence.id)?.finish === finish)
        activeStreams.get(store).delete(presence.id);
      response.off('drain', flush);
      response.off('close', disconnected);
      request.off('aborted', disconnected);
      if (failures.length)
        throw new AggregateError(failures, 'Live stream resources could not be released');
    })();
    return cleanupPromise;
  };
  const closedFrame = (error) => {
    const code =
      error === null
        ? 'stream-closed'
        : error instanceof CloudError
          ? error.code
          : 'stream-unavailable';
    return `event: closed\ndata: ${JSON.stringify({ kind: 'closed', code })}\n\n`;
  };
  const finish = (error = null, notify = true) => {
    if (finishPromise) return finishPromise;
    stopped = true;
    queue.length = 0;
    queuedBytes = 0;
    finishPromise = (async () => {
      if (renewing) {
        try {
          await renewing;
        } catch (failure) {
          error ??= failure;
        }
      }
      try {
        await cleanup();
      } catch (failure) {
        console.error('[cloud-stream-cleanup]', {
          code: 'stream-cleanup-failed',
          kind: failure instanceof Error ? 'error' : 'non-error',
        });
        error ??= new CloudError(503, 'stream-cleanup-failed', 'Live stream cleanup failed');
      }
      if (error !== null && !(error instanceof CloudError))
        console.error('[cloud-event-stream]', {
          code: 'stream-failed',
          kind: error instanceof Error ? 'error' : 'non-error',
        });
      if (!response.destroyed && !response.writableEnded) {
        if (notify && response.headersSent) response.write(closedFrame(error));
        response.end();
      }
      done();
    })();
    return finishPromise;
  };
  const fail = (error) => {
    if (booting) {
      startupError = error;
      stopped = true;
    } else {
      void finish(error);
    }
  };
  function disconnected() {
    if (booting) stopped = true;
    else void finish(null, false);
  }
  function flush() {
    if (!opened || stopped || response.destroyed) return;
    blocked = false;
    while (queue.length && !blocked) {
      const frame = queue.shift();
      queuedBytes -= frame.bytes;
      blocked = !response.write(frame.text);
    }
  }
  const enqueue = (event) => {
    if (stopped) return;
    const generation =
      event.checkpoint?.generation ?? event.delta?.generation ?? event.head?.generation;
    const text = `${generation === undefined ? '' : `id: ${generation}\n`}event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`;
    const bytes = Buffer.byteLength(text, 'utf8');
    if (queue.length >= MAX_QUEUED_EVENTS || queuedBytes + bytes > MAX_QUEUED_BYTES) {
      fail(new CloudError(429, 'stream-client-too-slow', 'Reconnect to the latest checkpoint'));
      return;
    }
    queue.push({ text, bytes });
    queuedBytes += bytes;
    if (!blocked) flush();
  };
  const scheduleRenewal = () => {
    clearTimeout(renewal);
    if (stopped) return;
    const now = store.now();
    if (
      !Number.isSafeInteger(now) ||
      !Number.isSafeInteger(lease.expiresAt) ||
      !Number.isSafeInteger(presence.expiresAt) ||
      (presence.clientExpiresAt !== undefined && !Number.isSafeInteger(presence.clientExpiresAt))
    )
      throw new CloudError(
        503,
        'invalid-live-presence',
        'The live stream lease deadline could not be verified'
      );
    if (lease.expiresAt <= now)
      throw new CloudError(409, 'stream-lease-expired', 'Reconnect using a new live stream');
    if (presence.clientExpiresAt !== undefined && presence.clientExpiresAt <= now)
      throw new CloudError(
        409,
        'client-presence-expired',
        'This client stopped acknowledging its live connection'
      );
    if (presence.clientExpiresAt === undefined && presence.expiresAt <= now)
      throw new CloudError(
        409,
        'live-presence-expired',
        'This live presence lease expired; reconnect'
      );
    const presenceDelay =
      presence.clientExpiresAt === undefined
        ? presence.expiresAt - now - RENEW_HEADROOM_MS
        : presence.clientExpiresAt - now;
    renewal = setTimeout(
      () => {
        if (!stopped && !renewing) void startRenewal();
      },
      Math.max(1, Math.min(RENEW_MS, lease.expiresAt - now - RENEW_HEADROOM_MS, presenceDelay))
    );
  };
  const renew = async () => {
    if (stopped) return;
    const current = await access.verifyAuthorization(request.headers.authorization);
    if (current.uid !== principal.uid)
      throw new CloudError(409, 'account-changed', 'Reconnect using the original account');
    await admit(current);
    if (stopped) return;
    lease = await store.usage.renewStream(current, lease);
    if (stopped) return;
    presence = await store.renewLivePresence(current, id, {
      sessionId: view.sessionId,
      connectionId: presence.id,
    });
    await admit(current);
    scheduleRenewal();
  };
  const startRenewal = () => {
    if (stopped)
      return Promise.reject(new CloudError(409, 'stream-closed', 'The live stream is closed'));
    if (renewing) return renewing;
    const pending = renew();
    renewing = pending;
    void pending.then(
      () => {
        if (renewing === pending) renewing = null;
      },
      (error) => {
        if (renewing === pending) renewing = null;
        void finish(error);
      }
    );
    return pending;
  };
  response.on('close', disconnected);
  request.on('aborted', disconnected);
  response.on('drain', flush);
  try {
    lease = await store.usage.acquireStream(principal);
    if (stopped || response.destroyed)
      throw new CloudError(409, 'stream-closed', 'The live stream was closed');
    const callbacks = {
      onEvent: enqueue,
      onError: fail,
    };
    observation = ownerWorld
      ? store.observeOwnerWorld(principal, id, command, expected, callbacks)
      : store.observeParticipant(principal, id, view, expected, callbacks);
    await observation.ready;
    if (stopped || response.destroyed)
      throw startupError || new CloudError(409, 'stream-closed', 'The live stream was closed');
    presence = await store.connectLivePresence(
      principal,
      id,
      { sessionId: view.sessionId },
      { clientAcknowledgements: true }
    );
    await admit(principal);
    if (stopped || response.destroyed)
      throw startupError || new CloudError(409, 'stream-closed', 'The live stream was closed');
    let active = activeStreams.get(store);
    if (!active) {
      active = new Map();
      activeStreams.set(store, active);
    }
    active.set(presence.id, {
      uid: principal.uid,
      id,
      sessionId: view.sessionId,
      scope: expected,
      finish,
    });
    response.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'private, no-store, no-transform',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Expose-Headers': CLOUD_LIVE_CONNECTION_HEADER,
      [CLOUD_LIVE_CONNECTION_HEADER]: presence.id,
      Vary: 'Origin',
      ...headers,
    });
    response.flushHeaders();
    booting = false;
    opened = true;
    flush();
    heartbeat = setInterval(() => {
      if (!stopped && !blocked && !response.destroyed && !queue.length)
        blocked = !response.write(':\n\n');
    }, HEARTBEAT_MS);
    scheduleRenewal();
    deadline = setTimeout(() => {
      void finish(new CloudError(409, 'stream-deadline', 'Reconnect to the current live game'));
    }, STREAM_DEADLINE_MS);
    return { done: completed, close: () => finish(null, false), renew: startRenewal };
  } catch (error) {
    booting = false;
    stopped = true;
    if (!response.headersSent) {
      try {
        await cleanup();
      } catch (failure) {
        console.error('[cloud-stream-cleanup]', {
          code: 'stream-cleanup-failed',
          kind: failure instanceof Error ? 'error' : 'non-error',
        });
        done();
        throw new AggregateError([error, failure], 'Live stream admission and cleanup failed');
      }
      done();
      throw error;
    }
    await finish(error);
    return { done: completed, close: () => finish(null, false), renew: startRenewal };
  }
}

module.exports = { openCloudEventStream, closeCloudEventStream };
