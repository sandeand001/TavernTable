/** @jest-environment node */

test('the session transport loads and works with a non-DOM window shim', async () => {
  const previous = globalThis.window;
  globalThis.window = {};
  try {
    let SessionConnection;
    jest.isolateModules(() => {
      SessionConnection = require('../../../src/campaigns/SessionConnection.js').default;
    });
    const fetch = jest.fn(async function () {
      if (this !== undefined) throw new Error('Invalid fetch receiver');
      return { ok: true, json: async () => ({ result: { observerTokenId: null, observers: [] } }) };
    });
    const transport = new SessionConnection({
      identity: { csrf: 'synthetic' },
      fetch,
      baseURL: 'http://localhost:3000/',
    });
    expect(await transport.call('playerState', [{}])).toEqual({
      observerTokenId: null,
      observers: [],
    });
    transport.close();
    expect(globalThis.window.addEventListener).toBeUndefined();
  } finally {
    globalThis.window = previous;
  }
});
