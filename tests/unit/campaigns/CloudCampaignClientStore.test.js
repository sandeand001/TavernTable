/** @jest-environment node */
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

function fixture() {
  const auth = {
    currentUser: { uid: 'uid-a', emailVerified: true, getIdToken: async () => 'fixture-token' },
  };
  const sdk = {
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
    crypto: {
      randomUUID: () =>
        ++commandSequence === 1 ? commandId : '33333333-3333-4333-8333-333333333333',
    },
  });
  return { auth, connection, store, fetch };
}

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
