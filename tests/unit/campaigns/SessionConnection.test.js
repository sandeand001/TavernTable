import SessionConnection, {
  createLocalProtectedAssetKeyProvider,
  getLocalProtectedAssetKey,
} from '../../../src/campaigns/SessionConnection.js';

class EventSourceFixture {
  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    this.close = jest.fn();
    EventSourceFixture.latest = this;
  }
  addEventListener(type, callback) {
    this.listeners.set(type, callback);
  }
  send(type, data) {
    this.listeners.get(type)?.({ data });
  }
}

test('session commands preserve native fetch compatibility and require a server receipt', async () => {
  const fetch = jest.fn(async function () {
    if (this !== undefined) throw new Error('Invalid fetch receiver');
    return { ok: true, json: async () => ({ result: { revision: 4 } }) };
  });
  const connection = new SessionConnection({
    identity: { csrf: 'synthetic-csrf' },
    fetch,
    baseURL: 'http://localhost:3000/',
  });
  expect(await connection.call('playerCommit', ['campaign', { revision: 3 }])).toEqual({
    revision: 4,
  });
  expect(fetch.mock.calls[0][1].headers['X-TavernTable-Host']).toBe('synthetic-csrf');
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
  await expect(connection.call('playerState', [{}])).rejects.toThrow('receipt');
  connection.close();
});

test('local protected asset requests use the current session and reject malformed key responses', async () => {
  const identity = { localProtectedAssets: true, csrf: 'synthetic-csrf' };
  const key = btoa('x'.repeat(32));
  const fetch = jest.fn(async () => ({
    ok: true,
    json: async () => ({ version: 1, keyId: 'fixture-pack-v1', key }),
  }));
  const options = { fetch, baseURL: 'http://127.0.0.1:3000/' };
  await expect(
    getLocalProtectedAssetKey(identity, 'campaign', 'fixture-pack-v1', options)
  ).resolves.toBe(key);
  expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:3000/api/protected-asset-key');
  expect(fetch.mock.calls[0][1].headers['X-TavernTable-Host']).toBe(identity.csrf);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({
    campaignId: 'campaign',
    keyId: 'fixture-pack-v1',
  });
  fetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ version: 1, keyId: 'another-pack', key }),
  });
  await expect(
    getLocalProtectedAssetKey(identity, 'campaign', 'fixture-pack-v1', options)
  ).rejects.toThrow(/invalid/i);
  await expect(
    getLocalProtectedAssetKey({ csrf: 'synthetic' }, 'campaign', 'fixture-pack-v1', options)
  ).rejects.toThrow(/unavailable/i);
});

test('concurrent local model loads share a key request without caching later authorization', async () => {
  const identity = { localProtectedAssets: true, csrf: 'synthetic-csrf' };
  const key = btoa('x'.repeat(32));
  let release;
  const fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        release = () =>
          resolve({ ok: true, json: async () => ({ version: 1, keyId: 'fixture-pack-v1', key }) });
      })
  );
  const provider = createLocalProtectedAssetKeyProvider(identity, 'campaign', {
    fetch,
    baseURL: 'http://127.0.0.1:3000/',
  });
  const first = provider('fixture-pack-v1');
  const second = provider('fixture-pack-v1');
  expect(fetch).toHaveBeenCalledTimes(1);
  release();
  await expect(Promise.all([first, second])).resolves.toEqual([key, key]);
  const third = provider('fixture-pack-v1');
  expect(fetch).toHaveBeenCalledTimes(2);
  release();
  await expect(third).resolves.toBe(key);
});

test('live notifications reconnect explicitly and release their authenticated stream when unused', () => {
  const connection = new SessionConnection({
    identity: { csrf: 'synthetic' },
    baseURL: 'http://localhost:3000/',
    EventSource: EventSourceFixture,
  });
  const first = jest.fn();
  const second = jest.fn();
  const removeFirst = connection.subscribe(first);
  const removeSecond = connection.subscribe(second);
  const source = EventSourceFixture.latest;
  expect(source.url).toBe('http://localhost:3000/api/events');
  source.send('open');
  source.send(
    'campaign',
    JSON.stringify({ campaignId: 'campaign', actorId: 'player', kind: 'playerCommit' })
  );
  source.send('error');
  expect(first.mock.calls.map(([event]) => event.type)).toEqual([
    'connected',
    'campaign',
    'disconnected',
  ]);
  removeFirst();
  expect(source.close).not.toHaveBeenCalled();
  removeSecond();
  expect(source.close).toHaveBeenCalledTimes(1);
});

test('player command denials retain their typed code, command ID and current revisions without exposing arbitrary response data', async () => {
  const connection = new SessionConnection({
    identity: { csrf: 'synthetic' },
    baseURL: 'http://localhost:3000/',
    fetch: async () => ({
      ok: false,
      status: 409,
      json: async () => ({
        error: 'The scene changed',
        code: 'stale-revision',
        commandId: 'command-id',
        current: { sceneRevision: 12, charactersRevision: 7 },
        privateDetails: 'must not be attached',
      }),
    }),
  });
  let denial;
  try {
    await connection.call('playerCommand', []);
  } catch (error) {
    denial = error;
  }
  expect(denial).toMatchObject({
    status: 409,
    code: 'stale-revision',
    commandId: 'command-id',
    current: { sceneRevision: 12, charactersRevision: 7 },
  });
  expect(denial).not.toHaveProperty('privateDetails');
  connection.close();
});
