jest.mock('../../../src/ui/sessions/SessionLogin.js', () => ({ ensureSession: jest.fn() }));
jest.mock('../../../src/campaigns/SessionConnection.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../src/resources/ResourceSeeds.js', () => ({ loadBundledResources: jest.fn() }));
jest.mock('../../../src/ui/sessions/PlayerCharacterSheets.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../src/ui/sessions/PublishedMapViewer.js', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('../../../src/utils/error/ErrorHandler.js', () => ({
  GameErrors: { input: jest.fn() },
}));

const observers = [
  { id: 'real-token-a', name: 'Archer', mapId: 'published-a', characterId: 'saved-a' },
  { id: 'real-token-b', name: 'Wizard', mapId: 'published-b', characterId: 'saved-b' },
];
let connection;
let sheets;
let viewer;
let resources;
let liveUpdate;
let failure;

function state({
  observerTokenId = 'real-token-a',
  allowedObservers = observers,
  mapId = 'published-a',
  tokens = [],
} = {}) {
  return {
    campaign: { id: 'campaign', name: 'Table' },
    profile: { name: 'Player' },
    revision: 1,
    records: [],
    observerTokenId,
    observers: allowedObservers,
    maps: [
      { id: 'published-a', name: 'Courtyard' },
      { id: 'published-b', name: 'Tower' },
    ],
    view: { id: mapId, terrainKey: 'same-terrain', tokens },
  };
}

async function settle() {
  for (let step = 0; step < 40; step++) await Promise.resolve();
}

function choose(label, id) {
  const select = document.querySelector(`[aria-label="${label}"]`);
  expect(select).not.toBeNull();
  select.value = id;
  select.dispatchEvent(new Event('change', { bubbles: true }));
}

beforeEach(() => {
  jest.resetModules();
  document.body.innerHTML = `
    <output aria-label="Player session status"></output>
    <button data-player-reconnect>Reconnect</button>
    <button data-player-signout>Sign out</button>
    <div data-assigned-characters></div>
    <select aria-label="Active character"></select>
    <p data-player-observer-notice></p>
    <output aria-label="Current location"></output>
    <select aria-label="Location area"></select>
    <p data-player-map-notice></p>
    <section id="player-map-view"></section>`;
  const { ensureSession } = require('../../../src/ui/sessions/SessionLogin.js');
  const SessionConnection = require('../../../src/campaigns/SessionConnection.js').default;
  const { loadBundledResources } = require('../../../src/resources/ResourceSeeds.js');
  const PlayerCharacterSheets =
    require('../../../src/ui/sessions/PlayerCharacterSheets.js').default;
  const PublishedMapViewer = require('../../../src/ui/sessions/PublishedMapViewer.js').default;
  failure = require('../../../src/utils/error/ErrorHandler.js').GameErrors.input;
  ensureSession.mockResolvedValue({ role: 'player', csrf: 'synthetic' });
  connection = {
    call: jest.fn(async (_operation, [options]) =>
      state({
        observerTokenId: options.observerTokenId || 'real-token-a',
        mapId: options.mapId || 'published-a',
      })
    ),
    subscribe: jest.fn((listener) => {
      liveUpdate = listener;
      return jest.fn();
    }),
    close: jest.fn(),
  };
  SessionConnection.mockImplementation(() => connection);
  resources = { catalog: jest.fn(async () => ({})), close: jest.fn() };
  loadBundledResources.mockResolvedValue({ resources });
  sheets = {
    library: {
      list: () => [
        { id: 'saved-a', name: 'Archer' },
        { id: 'saved-b', name: 'Wizard' },
      ],
      flush: jest.fn(async () => {}),
    },
    manager: {},
    open: jest.fn(async () => {}),
    refresh: jest.fn(),
    destroy: jest.fn(),
  };
  PlayerCharacterSheets.mockImplementation(({ onChanged }) => {
    sheets.refresh.mockImplementation(() => onChanged());
    return sheets;
  });
  viewer = {
    terrainKey: 'same-terrain',
    update: jest.fn(async () => {}),
    clearTokens: jest.fn(),
    destroy: jest.fn(),
  };
  PublishedMapViewer.mockImplementation(() => viewer);
});

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  delete window.gameManager;
  document.body.replaceChildren();
});

async function start() {
  require('../../../src/ui/sessions/PlayerApplication.js');
  await settle();
}

test('active character is the server-selected real token, independent from sheets and browsed maps', async () => {
  await start();
  const select = document.querySelector('[aria-label="Active character"]');
  expect([...select.options].map((option) => option.value)).toEqual([
    'real-token-a',
    'real-token-b',
  ]);
  expect(select.value).toBe('real-token-a');
  expect(select.options[0].textContent).toContain('Courtyard');
  choose('Active character', 'real-token-b');
  expect(viewer.clearTokens).toHaveBeenCalled();
  await settle();
  expect(connection.call).toHaveBeenLastCalledWith('playerState', [
    {
      observerTokenId: 'real-token-b',
      mapId: null,
      terrainKey: 'same-terrain',
    },
  ]);
  document.querySelector('[data-assigned-character="saved-a"]').click();
  expect(sheets.open).toHaveBeenCalledWith('saved-a');
  expect(select.value).toBe('real-token-b');
  choose('Location area', 'published-b');
  await settle();
  expect(connection.call).toHaveBeenLastCalledWith('playerState', [
    {
      observerTokenId: 'real-token-b',
      mapId: 'published-b',
      terrainKey: 'same-terrain',
    },
  ]);
});

test('a stale response cannot overwrite a newer observer selection or reveal its old token list', async () => {
  await start();
  viewer.update.mockClear();
  let release;
  connection.call.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  choose('Active character', 'real-token-b');
  await settle();
  choose('Active character', 'real-token-a');
  release(state({ observerTokenId: 'real-token-b', tokens: [{ id: 'old-view-only' }] }));
  await settle();
  expect(viewer.update).toHaveBeenCalledTimes(1);
  expect(viewer.update.mock.calls[0][0].tokens).toEqual([]);
  expect(document.querySelector('[aria-label="Active character"]').value).toBe('real-token-a');
  expect(connection.call).toHaveBeenLastCalledWith('playerState', [
    expect.objectContaining({ observerTokenId: 'real-token-a' }),
  ]);
});

test('a revoked observer is cleared and recovered only through a fresh server-authorized default', async () => {
  await start();
  connection.call
    .mockRejectedValueOnce(Object.assign(new Error('Observer is not assigned'), { status: 403 }))
    .mockRejectedValueOnce(Object.assign(new Error('Observer is not assigned'), { status: 403 }))
    .mockResolvedValueOnce(state({ allowedObservers: [observers[0]] }));
  choose('Active character', 'real-token-b');
  await settle();
  expect(connection.call).toHaveBeenLastCalledWith('playerState', [{}]);
  const select = document.querySelector('[aria-label="Active character"]');
  expect(select.value).toBe('real-token-a');
  expect([...select.options].map((option) => option.value)).toEqual(['real-token-a']);
  expect(failure).toHaveBeenCalled();
});

test('no authorized observer disables the selector without borrowing another character viewpoint', async () => {
  connection.call.mockResolvedValue(state({ observerTokenId: null, allowedObservers: [] }));
  await start();
  const select = document.querySelector('[aria-label="Active character"]');
  expect(select.disabled).toBe(true);
  expect(select.value).toBe('');
  expect(document.querySelector('[data-player-observer-notice]').textContent).toContain('assign');
  choose('Location area', 'published-b');
  await settle();
  expect(connection.call).toHaveBeenLastCalledWith('playerState', [
    expect.objectContaining({ observerTokenId: null }),
  ]);
});

test('live refresh uses authoritative observer options even without a character revision change', async () => {
  await start();
  connection.call.mockResolvedValueOnce(
    state({
      observerTokenId: 'real-token-b',
      allowedObservers: [observers[1]],
    })
  );
  liveUpdate({ type: 'campaign', campaignId: 'campaign' });
  await settle();
  const select = document.querySelector('[aria-label="Active character"]');
  expect(select.value).toBe('real-token-b');
  expect(select.options).toHaveLength(1);
  expect(viewer.clearTokens).toHaveBeenCalled();
});

test('an invalid observer response fails visibly without rendering an unauthorized viewpoint', async () => {
  connection.call.mockResolvedValue(
    state({
      observerTokenId: 'not-an-allowed-option',
      allowedObservers: [observers[0]],
    })
  );
  await start();
  expect(viewer.update).not.toHaveBeenCalled();
  expect(failure).toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Player session status"]').textContent).toContain(
    'observer'
  );
});

test('no viewpoint cannot render tokens even if an invalid host response includes them', async () => {
  connection.call.mockResolvedValue(
    state({
      observerTokenId: null,
      allowedObservers: [],
      tokens: [{ id: 'unauthorized' }],
    })
  );
  await start();
  expect(viewer.update).not.toHaveBeenCalled();
  expect(viewer.clearTokens).toHaveBeenCalled();
  expect(failure).toHaveBeenCalled();
});

test('a visibility conflict is reported and clears stale tokens instead of assuming unobstructed sight', async () => {
  await start();
  viewer.clearTokens.mockClear();
  connection.call.mockRejectedValueOnce(
    Object.assign(new Error('Reopen and save the map to capture sight bounds'), { status: 409 })
  );
  liveUpdate({ type: 'campaign', campaignId: 'campaign' });
  await settle();
  expect(viewer.clearTokens).toHaveBeenCalled();
  expect(document.querySelector('[aria-label="Player session status"]').textContent).toContain(
    'sight bounds'
  );
  expect(failure).toHaveBeenCalled();
});

test('changing location areas never discards a valid active character during recovery', async () => {
  await start();
  connection.call
    .mockRejectedValueOnce(
      Object.assign(new Error('The previous area is outside this location'), { status: 403 })
    )
    .mockResolvedValueOnce(state({ observerTokenId: 'real-token-b', mapId: 'published-b' }));
  choose('Active character', 'real-token-b');
  await settle();
  expect(connection.call).toHaveBeenLastCalledWith('playerState', [
    { observerTokenId: 'real-token-b' },
  ]);
  expect(document.querySelector('[aria-label="Active character"]').value).toBe('real-token-b');
  expect(document.querySelector('[aria-label="Location area"]').value).toBe('published-b');
});

test('a DM relocation of the active creature follows its new area without changing the selected character', async () => {
  await start();
  const moved = [{ ...observers[0], mapId: 'published-b' }, observers[1]];
  connection.call
    .mockResolvedValueOnce(state({ allowedObservers: moved }))
    .mockResolvedValueOnce(state({ allowedObservers: moved, mapId: 'published-b' }));
  liveUpdate({ type: 'campaign', campaignId: 'campaign' });
  await settle();
  expect(connection.call).toHaveBeenLastCalledWith('playerState', [
    { observerTokenId: 'real-token-a' },
  ]);
  expect(document.querySelector('[aria-label="Active character"]').value).toBe('real-token-a');
  expect(document.querySelector('[aria-label="Location area"]').value).toBe('published-b');
});
