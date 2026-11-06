import SessionConnection from '../../../src/campaigns/SessionConnection.js';

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
