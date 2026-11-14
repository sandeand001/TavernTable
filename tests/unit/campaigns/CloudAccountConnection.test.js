/** @jest-environment node */
import { createHash } from 'node:crypto';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';

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
    appId: 'demo-client',
  },
};
const response = (data, status = 200) => ({
  status,
  ok: status >= 200 && status < 300,
  json: async () => data,
});

function accountFixture() {
  const refreshes = [];
  const user = {
    uid: 'uid-a',
    email: 'account@example.invalid',
    emailVerified: true,
    getIdToken: async (refresh) => {
      refreshes.push(refresh);
      return refresh ? 'renewed-token' : 'initial-token';
    },
  };
  const auth = { currentUser: user };
  const observers = new Set();
  const sdk = {
    onAuthStateChanged: (_auth, listener) => {
      observers.add(listener);
      listener(auth.currentUser);
      return () => observers.delete(listener);
    },
    signInWithEmailAndPassword: async () => {
      throw new Error('Already signed in');
    },
    signOut: async () => {
      auth.currentUser = null;
    },
  };
  return {
    auth,
    user,
    refreshes,
    account: new CloudAccount({ auth, sdk }),
    notifyIdentity: () => {
      for (const listener of observers) listener(auth.currentUser);
    },
    observers,
  };
}

function eventFixture(createResponse) {
  const setup = accountFixture();
  const campaignId = '00000000-0000-4000-8000-000000000002';
  const fetch = jest.fn(createResponse);
  const connection = new CloudAccountConnection({
    account: setup.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  return {
    ...setup,
    fetch,
    open: () =>
      connection.request(`campaigns/${campaignId}/events`, {
        method: 'POST',
        responseType: 'events',
        accessScope: {
          version: 1,
          uid: 'uid-a',
          campaignId,
          role: 'owner',
          seatId: null,
          accessGeneration: 0,
        },
        body: {
          sessionId: '00000000-0000-4000-8000-000000000004',
          observerTokenId: null,
          mapId: null,
          assetKey: null,
        },
      }),
  };
}

test.each([
  [
    'mismatched cursor',
    () => 'id: 8\nevent: checkpoint\ndata: {"kind":"checkpoint","checkpoint":{"generation":9}}\n\n',
  ],
  ['malformed JSON', () => 'event: checkpoint\ndata: PRIVATE INVALID JSON\n\n'],
  ['mismatched event kind', () => 'event: closed\ndata: {"kind":"delta"}\n\n'],
  ['truncated frame', () => 'event: closed\ndata: {"kind":"closed","code":"stream-closed"}\n'],
  ['invalid UTF-8', () => new Uint8Array([0xc3, 0x28])],
  ['oversized UTF-8 frame', () => new Uint8Array(32 * 1024 * 1024 + 1).fill(0x61)],
])(
  'a %s live frame is rejected and releases its managed transport without exposing payloads',
  async (_name, content) => {
    const setup = eventFixture(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const value = content();
              controller.enqueue(
                typeof value === 'string' ? new TextEncoder().encode(value) : value
              );
              controller.close();
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
    );
    const stream = await setup.open();
    try {
      await expect(stream.next()).rejects.toMatchObject({ code: 'invalid-cloud-stream' });
      expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
      expect(setup.observers.size).toBe(0);
    } finally {
      await stream.close();
    }
  }
);

test('an idle account change immediately aborts the live transport and cannot deliver data from the old UID', async () => {
  jest.useFakeTimers();
  const cancelled = jest.fn();
  const setup = eventFixture(
    async () =>
      new Response(
        new ReadableStream({
          cancel: cancelled,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  );
  let stream;
  try {
    stream = await setup.open();
    const read = expect(stream.next()).rejects.toMatchObject({ code: 'account-changed' });
    setup.auth.currentUser = { uid: 'uid-b', emailVerified: true };
    setup.notifyIdentity();
    await read;
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await stream?.close();
    jest.useRealTimers();
  }
});

test('comment heartbeats reset the live body deadline but sixty seconds without bytes closes the transport', async () => {
  jest.useFakeTimers();
  let incoming;
  const setup = eventFixture(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            incoming = controller;
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  );
  let stream;
  try {
    stream = await setup.open();
    const read = expect(stream.next()).rejects.toMatchObject({
      code: 'cloud-stream-timeout',
      status: 504,
    });
    await jest.advanceTimersByTimeAsync(55000);
    incoming.enqueue(new TextEncoder().encode(': heartbeat\r\n\r\n'));
    await jest.advanceTimersByTimeAsync(59999);
    expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await read;
    expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    await stream?.close();
    jest.useRealTimers();
  }
});

test('one initial live HTTP 401 renews identity and retries the exact captured body and owner scope', async () => {
  const setup = eventFixture(async () => {
    if (setup.fetch.mock.calls.length === 1)
      return response(
        { version: 1, code: 'invalid-identity', error: 'PRIVATE PROVIDER DETAIL' },
        401
      );
    return new Response('event: closed\ndata: {"kind":"closed","code":"live-session-paused"}\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
  });
  const stream = await setup.open();
  try {
    expect((await stream.next()).value).toEqual({ kind: 'closed', code: 'live-session-paused' });
    expect(setup.fetch).toHaveBeenCalledTimes(2);
    const first = setup.fetch.mock.calls[0][1];
    const second = setup.fetch.mock.calls[1][1];
    expect(second.body).toBe(first.body);
    expect(first.headers.Authorization).toBe('Bearer initial-token');
    expect(second.headers.Authorization).toBe('Bearer renewed-token');
    expect(second.headers['X-TavernTable-Seat']).toBe('owner');
    expect(second.headers['X-TavernTable-Access-Generation']).toBe('0');
    expect(second.credentials).toBe('omit');
    expect(second.redirect).toBe('error');
    expect(setup.refreshes).toEqual([false, true]);
    expect(setup.observers.size).toBe(0);
  } finally {
    await stream.close();
  }
});

test('a failed identity subscription during stream opening cancels its body and leaves no deadline behind', async () => {
  jest.useFakeTimers();
  const cancelled = jest.fn();
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const setup = eventFixture(
    async () =>
      new Response(
        new ReadableStream({
          cancel: cancelled,
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  );
  setup.account.sdk.onAuthStateChanged = () => {
    throw new Error('PRIVATE AUTH OBSERVATION DETAIL');
  };
  try {
    await expect(setup.open()).rejects.toMatchObject({ code: 'identity-unavailable', status: 503 });
    expect(cancelled).toHaveBeenCalledTimes(1);
    expect(setup.observers.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE AUTH OBSERVATION DETAIL');
  } finally {
    jest.clearAllTimers();
    jest.useRealTimers();
    log.mockRestore();
  }
});

test('a failed live response body releases its reader and account observer with a redacted typed error', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  const setup = eventFixture(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error('PRIVATE NETWORK DETAIL'));
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } }
      )
  );
  let stream;
  try {
    stream = await setup.open();
    await expect(stream.next()).rejects.toMatchObject({
      code: 'cloud-stream-unavailable',
      status: 503,
    });
    expect(setup.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(setup.observers.size).toBe(0);
    expect(log).toHaveBeenCalledWith('[cloud-event-stream]', {
      code: 'stream-read-failed',
      kind: 'error',
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE NETWORK DETAIL');
  } finally {
    try {
      await stream?.close();
    } finally {
      log.mockRestore();
    }
  }
});

test('authenticated Fetch events decode fragmented UTF-8 and CRLF frames without cookies, URL credentials or EventSource', async () => {
  const fixture = accountFixture();
  const campaignId = '00000000-0000-4000-8000-000000000002';
  const access = {
    version: 1,
    uid: 'uid-a',
    campaignId,
    role: 'member',
    seatId: '00000000-0000-4000-8000-000000000003',
    accessGeneration: 7,
  };
  const checkpoint = {
    kind: 'checkpoint',
    checkpoint: { generation: 9, name: 'caf\u00e9 \u{1f409}' },
  };
  const closed = { kind: 'closed', code: 'live-session-paused' };
  const text =
    ': ping\r\n\r\nid: 9\r\nevent: checkpoint\r\ndata: ' +
    JSON.stringify(checkpoint) +
    '\r\n\r\nevent: closed\r\ndata: ' +
    JSON.stringify(closed) +
    '\r\n\r\n';
  const bytes = new TextEncoder().encode(text);
  const split = bytes.indexOf(0xc3) + 1;
  const fetch = jest.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, split));
            controller.enqueue(bytes.subarray(split, split + 2));
            for (let index = split + 2; index < bytes.length; index++)
              controller.enqueue(bytes.subarray(index, index + 1));
            controller.close();
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream; charset=utf-8' } }
      )
  );
  const connection = new CloudAccountConnection({
    account: fixture.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  const body = {
    sessionId: '00000000-0000-4000-8000-000000000004',
    observerTokenId: 'token-1',
    mapId: 'map-main',
    assetKey: null,
  };
  const stream = await connection.request(`campaigns/${campaignId}/events`, {
    method: 'POST',
    responseType: 'events',
    body,
    accessScope: access,
  });
  const events = [];
  for await (const event of stream) events.push(event);
  expect(events).toEqual([checkpoint, closed]);
  expect(fetch.mock.calls[0][0]).toBe(
    `${runtime.apiOrigin}/api/cloud/campaigns/${campaignId}/events`
  );
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer initial-token');
  expect(fetch.mock.calls[0][1].headers['X-TavernTable-Access-Generation']).toBe('7');
  expect(fetch.mock.calls[0][1].credentials).toBe('omit');
  expect(fetch.mock.calls[0][1].redirect).toBe('error');
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(body);
});

test('complete backup downloads preserve UTF-8 across chunks and verify their declared byte count and hash', async () => {
  const fixture = accountFixture();
  const text = '{"name":"caf\u00e9 \u{1f409}"}';
  const bytes = new TextEncoder().encode(text);
  const split = bytes.indexOf(0xc3) + 1;
  const fetch = jest.fn(
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(bytes.subarray(0, split));
            controller.enqueue(bytes.subarray(split));
            controller.close();
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-TavernTable-Backup-Bytes': String(bytes.length),
            'X-TavernTable-Backup-SHA256': createHash('sha256').update(bytes).digest('hex'),
          },
        }
      )
  );
  const connection = new CloudAccountConnection({
    account: fixture.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  await expect(
    connection.request('campaigns/00000000-0000-4000-8000-000000000002/backup', {
      responseType: 'backup',
    })
  ).resolves.toBe(text);
  expect(fetch.mock.calls[0][1].credentials).toBe('omit');
  expect(fetch.mock.calls[0][1].redirect).toBe('error');
  expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer initial-token');
});

test.each([
  ['unexpected success status', { status: 201 }, 503, 'invalid-cloud-response'],
  ['oversized byte declaration', { length: 128000001 }, 413, 'backup-too-large'],
  ['truncated file', { lengthDelta: 1 }, 503, 'backup-integrity-failed'],
  ['extra file bytes', { lengthDelta: -1 }, 503, 'backup-integrity-failed'],
  ['wrong file hash', { sha256: '0'.repeat(64) }, 503, 'backup-integrity-failed'],
])('a backup with %s is never accepted as a complete file', async (_name, fault, status, code) => {
  const fixture = accountFixture();
  const text = '{"fixture":true}';
  const bytes = new TextEncoder().encode(text);
  const fetch = jest.fn(
    async () =>
      new Response(bytes, {
        status: fault.status || 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'X-TavernTable-Backup-Bytes': String(
            fault.length ?? bytes.length + (fault.lengthDelta || 0)
          ),
          'X-TavernTable-Backup-SHA256':
            fault.sha256 || createHash('sha256').update(bytes).digest('hex'),
        },
      })
  );
  const connection = new CloudAccountConnection({
    account: fixture.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  await expect(
    connection.request('campaigns/00000000-0000-4000-8000-000000000002/backup', {
      responseType: 'backup',
    })
  ).rejects.toMatchObject({ status, code });
});

test('a progressing backup download can outlive a minute without disabling the stalled-request deadline', async () => {
  jest.useFakeTimers();
  try {
    const fixture = accountFixture();
    const text = '{"fixture":"slow complete transfer"}';
    const bytes = new TextEncoder().encode(text);
    let controller;
    let began;
    const started = new Promise((resolve) => {
      began = resolve;
    });
    const fetch = jest.fn(async () => {
      const response = new Response(
        new ReadableStream({
          start(value) {
            controller = value;
          },
        }),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'X-TavernTable-Backup-Bytes': String(bytes.length),
            'X-TavernTable-Backup-SHA256': createHash('sha256').update(bytes).digest('hex'),
          },
        }
      );
      began();
      return response;
    });
    const connection = new CloudAccountConnection({
      account: fixture.account,
      runtime,
      fetch,
      baseURL: 'http://127.0.0.1:19410/',
    });
    const pending = connection.request('campaigns/00000000-0000-4000-8000-000000000002/backup', {
      responseType: 'backup',
    });
    await started;
    await jest.advanceTimersByTimeAsync(50000);
    controller.enqueue(bytes.subarray(0, 10));
    await jest.advanceTimersByTimeAsync(50000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    controller.enqueue(bytes.subarray(10));
    controller.close();
    await expect(pending).resolves.toBe(text);
  } finally {
    jest.useRealTimers();
  }
});

test('one identity renewal retries the exact same command with bearer-only headers and no cookie, redirect or URL credential fallback', async () => {
  const fixture = accountFixture();
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1)
      return response(
        { version: 1, code: 'invalid-identity', error: 'PRIVATE PROVIDER DETAIL' },
        401
      );
    return response({ version: 1, result: { revision: 1, savedAt: '2026-11-11T00:00:00.000Z' } });
  };
  const connection = new CloudAccountConnection({
    account: fixture.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  const body = { commandId: '00000000-0000-4000-8000-000000000001', change: { revision: 0 } };
  await expect(
    connection.request('campaigns/00000000-0000-4000-8000-000000000002/scene', {
      method: 'POST',
      body,
    })
  ).resolves.toEqual({ revision: 1, savedAt: '2026-11-11T00:00:00.000Z' });
  expect(fixture.refreshes).toEqual([false, true]);
  expect(calls).toHaveLength(2);
  expect(calls[0].options.body).toBe(calls[1].options.body);
  expect(calls[0].options.headers.Authorization).toBe('Bearer initial-token');
  expect(calls[1].options.headers.Authorization).toBe('Bearer renewed-token');
  for (const { url, options } of calls) {
    expect(new URL(url).origin).toBe(runtime.apiOrigin);
    expect(new URL(url).search).toBe('');
    expect(options.credentials).toBe('omit');
    expect(options.redirect).toBe('error');
    expect(options.headers.Cookie).toBeUndefined();
    expect(JSON.stringify(options)).not.toContain('PRIVATE PROVIDER DETAIL');
  }
});

test('participant scope headers remain bound to the original generation across managed identity renewal', async () => {
  const fixture = accountFixture();
  const calls = [];
  const scope = {
    version: 1,
    uid: 'uid-a',
    campaignId: '00000000-0000-4000-8000-000000000002',
    role: 'member',
    seatId: '00000000-0000-4000-8000-000000000003',
    accessGeneration: 4,
  };
  const fetch = async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) {
      scope.accessGeneration = 99;
      return response({ version: 1, code: 'invalid-identity', error: 'Renew identity' }, 401);
    }
    return response({ version: 1, result: { checked: true } });
  };
  const connection = new CloudAccountConnection({
    account: fixture.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  await expect(
    connection.request('campaigns/' + scope.campaignId + '/participant-access', {
      accessScope: scope,
    })
  ).resolves.toEqual({ checked: true });
  expect(calls).toHaveLength(2);
  for (const { options } of calls) {
    expect(options.headers['X-TavernTable-Seat']).toBe(scope.seatId);
    expect(options.headers['X-TavernTable-Access-Generation']).toBe('4');
    expect(options.credentials).toBe('omit');
  }
});

test('a late profile for another account is discarded when the managed identity changes during HTTP', async () => {
  const fixture = accountFixture();
  let release;
  let began;
  const started = new Promise((resolve) => {
    began = resolve;
  });
  const fetch = async () => {
    began();
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const connection = new CloudAccountConnection({
    account: fixture.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  const pending = connection.profile();
  await started;
  fixture.auth.currentUser = { ...fixture.user, uid: 'uid-b' };
  release(response({ version: 1, result: { uid: 'uid-a', emailVerified: true, eligible: true } }));
  await expect(pending).rejects.toMatchObject({ status: 409, code: 'account-changed' });
});

test('wrong-UID profiles and network failures are explicit, and invalid paths cannot send a token elsewhere', async () => {
  const fixture = accountFixture();
  let fail = false;
  const fetch = jest.fn(async () => {
    if (fail) throw new Error('PRIVATE NETWORK DETAIL');
    return response({ version: 1, result: { uid: 'uid-b', emailVerified: true, eligible: true } });
  });
  const connection = new CloudAccountConnection({
    account: fixture.account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  await expect(connection.profile()).rejects.toMatchObject({
    status: 503,
    code: 'invalid-cloud-response',
  });
  fail = true;
  let failure;
  try {
    await connection.profile();
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 503, code: 'cloud-unavailable' });
  expect(failure.message).not.toContain('PRIVATE NETWORK DETAIL');
  expect(failure.cause).toBeUndefined();
  const calls = fetch.mock.calls.length;
  for (const path of [
    'https://elsewhere.example.invalid/steal',
    '../session',
    'account?token=private',
    'campaigns/%2Felsewhere',
  ])
    await expect(connection.request(path)).rejects.toMatchObject({
      status: 400,
      code: 'invalid-cloud-request',
    });
  expect(fetch.mock.calls).toHaveLength(calls);
});

test('a stalled cloud request is aborted after one minute and cannot acknowledge a save', async () => {
  jest.useFakeTimers();
  try {
    const fixture = accountFixture();
    let begin;
    const started = new Promise((resolve) => {
      begin = resolve;
    });
    const fetch = jest.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          begin();
          signal?.addEventListener(
            'abort',
            () => reject(Object.assign(new Error('PRIVATE ABORT DETAIL'), { name: 'AbortError' })),
            { once: true }
          );
        })
    );
    const connection = new CloudAccountConnection({
      account: fixture.account,
      runtime,
      fetch,
      baseURL: 'http://127.0.0.1:19410/',
    });
    const request = connection.request('campaigns', {
      method: 'POST',
      body: { commandId: '00000000-0000-4000-8000-000000000001', options: {} },
    });
    await started;
    const signal = fetch.mock.calls[0][1].signal;
    expect(signal).toBeDefined();
    expect(signal.aborted).toBe(false);
    const rejected = expect(request).rejects.toMatchObject({
      status: 504,
      code: 'cloud-request-timeout',
      message: expect.stringContaining('unconfirmed'),
    });
    await jest.advanceTimersByTimeAsync(59999);
    expect(signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1);
    await rejected;
    expect(signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  } finally {
    jest.useRealTimers();
  }
});
