import { webcrypto } from 'node:crypto';
import CloudSaveFeedback from '../../../src/ui/campaigns/CloudSaveFeedback.js';
import CloudCampaignClientStore from '../../../src/campaigns/CloudCampaignClientStore.js';
import CloudAccount, { CloudAccountError } from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';
import { mountCampaignControls } from '../../../src/ui/campaigns/CampaignLauncher.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { sceneState } from '../../helpers/sceneState.js';
import { logger } from '../../../src/utils/logger/Logger.js';
import {
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';

const campaignId = '11111111-1111-4111-8111-111111111111';
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
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function fixture(fetch) {
  const auth = {
    currentUser: { uid: 'uid-a', emailVerified: true, getIdToken: async () => 'fixture-token' },
  };
  const sdk = {
    onAuthStateChanged: (_auth, notify) => {
      notify();
      return () => {};
    },
    signInWithEmailAndPassword: async () => {},
    signOut: async () => {
      auth.currentUser = null;
    },
  };
  const account = new CloudAccount({ auth, sdk });
  const connection = new CloudAccountConnection({
    account,
    fetch,
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
        appId: 'demo-feedback',
      },
    },
  });
  const store = new CloudCampaignClientStore({
    connection,
    uid: 'uid-a',
    packs,
    crypto: webcrypto,
  });
  const feedback = new CloudSaveFeedback({ store }).attach();
  return { store, feedback, auth, sdk };
}

afterEach(() => {
  window.dispatchEvent(new Event('pagehide'));
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

test('identity verification failures stay distinct from a UID change and unexpected render errors are redacted and rethrown', () => {
  document.body.innerHTML = '<section id="editor">PRIVATE PRIOR VIEW</section>';
  const { store, feedback } = fixture(jest.fn());
  feedback.invalidateIdentity();
  const identity = jest.spyOn(store.connection.account, 'identity');
  const log = jest.spyOn(logger, 'log').mockImplementation(() => {});
  try {
    identity.mockImplementation(() => {
      throw new CloudAccountError(503, 'invalid-auth-state', 'PRIVATE PROVIDER DETAIL');
    });
    expect(() => feedback.render()).not.toThrow();
    expect(feedback.status.textContent).toMatch(/account could not be verified/i);
    expect(feedback.status.textContent).not.toMatch(/account changed/i);
    expect(feedback.status.textContent).not.toContain('PRIVATE PROVIDER DETAIL');
    expect(feedback.blocked).toBe(true);
    expect(feedback.retry.disabled).toBe(true);
    expect(feedback.reopen.disabled).toBe(true);
    expect(document.getElementById('editor').hidden).toBe(true);
    log.mockClear();
    const unexpected = new TypeError('PRIVATE UNEXPECTED IDENTITY DETAIL');
    identity.mockImplementation(() => {
      throw unexpected;
    });
    expect(() => feedback.render()).toThrow(unexpected);
    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE');
    expect(document.getElementById('editor').hidden).toBe(true);
  } finally {
    identity.mockRestore();
    feedback.dispose();
    store.close();
  }
});

test('routine cloud saving and acknowledgement stay hidden without stealing focus or blocking game input', async () => {
  document.body.innerHTML = '<section id="editor"><button>Continue playing</button></section>';
  const editor = document.getElementById('editor');
  const play = editor.querySelector('button');
  const played = jest.fn();
  play.addEventListener('click', played);
  let release;
  const response = new Promise((resolve) => {
    release = resolve;
  });
  const { store, feedback } = fixture(() => response);
  expect(feedback.root.hidden).toBe(true);
  play.focus();
  const saving = store.create({ name: campaign.name, ruleset: '2014', packIds: [] });
  try {
    expect(feedback.blocked).toBe(false);
    expect(feedback.root.hidden).toBe(true);
    expect(editor.inert).not.toBe(true);
    expect(document.activeElement).toBe(play);
    expect(feedback.root.hasAttribute('aria-modal')).toBe(false);
    play.click();
    expect(played).toHaveBeenCalledTimes(1);
    const pointer = new Event('pointerdown', { bubbles: true, cancelable: true });
    expect(play.dispatchEvent(pointer)).toBe(true);
    const leaving = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(leaving);
    expect(leaving.defaultPrevented).toBe(true);
    release({ ok: true, status: 200, json: async () => ({ version: 1, result: campaign }) });
    await saving;
    expect(feedback.state.phase).toBe('saved');
    expect(feedback.root.hidden).toBe(true);
    expect(feedback.blocked).toBe(false);
    expect(document.activeElement).toBe(play);
  } finally {
    release({ ok: true, status: 200, json: async () => ({ version: 1, result: campaign }) });
    await saving;
    feedback.dispose();
    store.close();
  }
});

test('uncertain campaign creation blocks new input until the same command is explicitly retried and durably acknowledged', async () => {
  document.body.innerHTML = '<section id="editor"><button>Edit campaign</button></section>';
  const editor = document.getElementById('editor');
  const edit = editor.querySelector('button');
  const edited = jest.fn();
  edit.addEventListener('click', edited);
  const fetch = jest.fn(async () => {
    if (fetch.mock.calls.length === 1) throw new Error('PRIVATE LOST RESPONSE DETAIL');
    return { ok: true, status: 200, json: async () => ({ version: 1, result: campaign }) };
  });
  const { store, feedback } = fixture(fetch);
  const root = document.querySelector('[aria-label="Cloud save feedback"]');
  root.inert = true;
  const status = root.querySelector('[role="status"]');
  let acknowledged = false;
  const created = store.create({ name: 'Cloud fixture', ruleset: '2014', packIds: [] });
  void created.then(() => {
    acknowledged = true;
  });
  expect(status.textContent).toContain('Saving to cloud');
  expect(root.hidden).toBe(true);
  expect(root.inert).toBe(true);
  expect(editor.inert).not.toBe(true);
  edit.click();
  expect(edited).toHaveBeenCalledTimes(1);
  await settle();
  expect(acknowledged).toBe(false);
  expect(status.textContent).toContain('Unconfirmed');
  expect(status.textContent).not.toContain('PRIVATE LOST RESPONSE DETAIL');
  expect(root.hidden).toBe(false);
  expect(root.inert).toBe(false);
  expect(editor.inert).toBe(true);
  edit.click();
  expect(edited).toHaveBeenCalledTimes(1);
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  const retry = [...root.querySelectorAll('button')].find(
    (element) => element.textContent === 'Retry same save'
  );
  expect(retry.hidden).toBe(false);
  retry.click();
  await expect(created).resolves.toEqual(campaign);
  await settle();
  expect(acknowledged).toBe(true);
  expect(status.textContent).toBe('Saved to cloud');
  expect(root.hidden).toBe(true);
  expect(editor.inert).toBe(false);
  expect(root.inert).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  edit.click();
  expect(edited).toHaveBeenCalledTimes(2);
  feedback.dispose();
});

test('scene checkpoint feedback remains truthful through continued editing and the final sign-out flush', async () => {
  document.body.innerHTML =
    '<section id="editor"><button>Edit campaign</button><div id="settings-panel"></div></section>';
  const backend = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: packs.map((pack) => ({ ...pack, core: true })),
  });
  const fetch = async (url, options) => {
    const [, , , id, operation] = new URL(url).pathname.split('/').filter(Boolean);
    const body = options.body && JSON.parse(options.body);
    let result;
    if (operation === 'backups') {
      result =
        options.method === 'POST'
          ? null
          : {
              state: 'pending',
              error: null,
              latest: null,
              intervalMs: 300000,
              retain: 20,
            };
    } else if (options.method === 'POST') {
      result = !id
        ? await backend.create(body.options)
        : operation === 'scene'
          ? await backend.commitScene(id, body.change)
          : await backend.commitCharacters(id, body.change);
    } else {
      result =
        operation === 'characters'
          ? await backend.readCharacters(id)
          : operation === 'scene'
            ? await backend.readScene(id)
            : await backend.get(id);
    }
    return { ok: true, status: 200, json: async () => ({ version: 1, result }) };
  };
  const { store, feedback, auth, sdk } = fixture(fetch);
  let gm;
  let autosave;
  let releaseSignOut;
  try {
    const created = await store.create({ name: 'Cloud fixture', ruleset: '2014' });
    const library = await CampaignCharacters.open({
      store,
      campaignId: created.id,
      catalog: { ruleset: '2014', entries: [], classes: [], enabledEntryIds: [] },
    });
    const characterId = await library.create('Scout');
    const scene = sceneState({ characterId, name: 'Scout' });
    const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
    gm = await createConnectedTravelBoard({ library, scene: world.save() });
    autosave = new CampaignAutosave({
      gameManager: gm,
      library,
      combat: gm.characterServices.combat,
    });
    feedback.bindAutosave(autosave);
    const status = document.querySelector('[aria-label="Cloud save status"]');
    expect(status.textContent).toContain('Restoring');
    await autosave.start();
    expect(status.textContent).toBe('Saved to cloud');
    expect(feedback.root.hidden).toBe(true);
    autosave.changed('camera');
    expect(status.textContent).toContain('Saving to cloud');
    expect(feedback.root.hidden).toBe(true);
    expect(document.getElementById('editor').inert).not.toBe(true);
    await autosave.flush();
    expect(status.textContent).toBe('Saved to cloud');
    expect(feedback.root.hidden).toBe(true);
    expect(autosave.status.text).toBe('Saved to cloud');
    const workspace = new CampaignWorkspace({ manifest: { packs }, resources: {}, store });
    const services = {
      campaign: library.campaign,
      workspace,
      library,
      autosave,
      saveFeedback: feedback,
    };
    workspace.active = services;
    gm.campaignContext = services;
    const controls = mountCampaignControls(gm, services);
    const signout = [...controls.querySelectorAll('button')].find(
      (element) => element.textContent === 'Sign out'
    );
    expect(signout).toBeDefined();
    expect(controls.textContent).not.toContain('Players & sharing');
    expect(controls.textContent).toContain('JSON backups');
    let signedOut;
    const signingOut = new Promise((resolve) => {
      signedOut = resolve;
    });
    const allowed = new Promise((resolve) => {
      releaseSignOut = resolve;
    });
    sdk.signOut = async () => {
      signedOut(await backend.readScene(created.id));
      await allowed;
      auth.currentUser = null;
    };
    const before = (await backend.readScene(created.id)).revision;
    gm.threeSceneManager.restoreView({
      ...gm.threeSceneManager.snapshotView(),
      zoom: 1.75,
    });
    autosave.changed('final camera change');
    signout.click();
    const flushed = await signingOut;
    expect(flushed.revision).toBe(before + 1);
    expect(JSON.parse(flushed.scene)).toMatchObject({
      version: 3,
      view: { camera: { zoom: 1.75 } },
    });
    expect(document.getElementById('editor').inert).toBe(true);
    expect(feedback.root.hidden).toBe(false);
    expect(store.connection.account.identity()?.uid).toBe('uid-a');
    releaseSignOut();
    await settle();
    expect(store.connection.account.identity()).toBeNull();
  } finally {
    releaseSignOut?.();
    await settle();
    feedback.dispose();
    autosave?.dispose();
    if (gm) disposeConnectedTravelBoard(gm);
    backend.close();
  }
}, 30000);

test('account replacement hides the prior private view and retains only original-UID save recovery without reopening the ghost editor', async () => {
  document.body.innerHTML =
    '<section id="editor"><h1>PRIVATE PRIOR CAMPAIGN</h1><button>Edit campaign</button></section>';
  const fetch = jest.fn(async () => {
    if (fetch.mock.calls.length === 1) throw new Error('Synthetic unacknowledged reply');
    return { ok: true, status: 200, json: async () => ({ version: 1, result: campaign }) };
  });
  const { store, feedback, auth } = fixture(fetch);
  const originalUser = auth.currentUser;
  const pending = store.create({ name: campaign.name, ruleset: '2014' });
  await settle();
  try {
    auth.currentUser = { ...originalUser, uid: 'uid-b' };
    store.connection.account.identity();
    feedback.invalidateIdentity();
    const root = document.querySelector('[aria-label="Cloud save feedback"]');
    expect(document.getElementById('editor').hidden).toBe(true);
    expect(root.hidden).toBe(false);
    expect(root.textContent).not.toContain('PRIVATE PRIOR CAMPAIGN');
    expect(feedback.status.textContent).toMatch(/original account/i);
    expect(feedback.retry.disabled).toBe(true);
    await expect(store.retryPending()).rejects.toMatchObject({ code: 'account-changed' });
    expect(fetch).toHaveBeenCalledTimes(1);
    auth.currentUser = { ...originalUser };
    store.connection.account.identity();
    feedback.render();
    expect(feedback.retry.disabled).toBe(false);
    await store.retryPending();
    await pending;
    expect(feedback.status.textContent).toMatch(/confirmed.*reopen|reopen.*cloud/i);
    expect(feedback.reopen.hidden).toBe(false);
    expect(feedback.blocked).toBe(true);
    expect(document.getElementById('editor').hidden).toBe(true);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  } finally {
    auth.currentUser = originalUser;
    if (store.pending) await store.retryPending();
    await pending;
    feedback.dispose();
    store.close();
  }
});

test('offline editing is paused without queuing a command or claiming a cloud save', async () => {
  document.body.innerHTML = '<section id="editor"><button>Edit campaign</button></section>';
  const online = jest.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const fetch = jest.fn();
  const { store, feedback } = fixture(fetch);
  const status = document.querySelector('[aria-label="Cloud save status"]');
  expect(status.textContent).toContain('Offline');
  expect(status.textContent).not.toContain('Saved to cloud');
  expect(document.getElementById('editor').inert).toBe(true);
  await expect(
    store.create({ name: 'Cloud fixture', ruleset: '2014', packIds: [] })
  ).rejects.toMatchObject({ code: 'cloud-offline' });
  expect(fetch).not.toHaveBeenCalled();
  online.mockReturnValue(true);
  window.dispatchEvent(new Event('online'));
  expect(document.getElementById('editor').inert).toBe(true);
  expect(status.textContent).toMatch(/reopen.*cloud/i);
  expect(status.textContent).not.toContain('Saved to cloud');
  await expect(
    store.create({ name: 'Cloud fixture', ruleset: '2014', packIds: [] })
  ).rejects.toMatchObject({ code: 'cloud-reconciliation-required' });
  expect(store.pending).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  feedback.dispose();
});

test('keyboard events inside save recovery cannot bubble into global game shortcuts', async () => {
  const shortcut = jest.fn();
  document.addEventListener('keydown', shortcut);
  const fetch = jest.fn(async () => {
    if (fetch.mock.calls.length === 1) throw new Error('Uncertain request');
    return { ok: true, status: 200, json: async () => ({ version: 1, result: campaign }) };
  });
  const { store, feedback } = fixture(fetch);
  try {
    const created = store.create({ name: 'Cloud fixture', ruleset: '2014' });
    await settle();
    const root = document.querySelector('[aria-label="Cloud save feedback"]');
    root.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    expect(shortcut).not.toHaveBeenCalled();
    const retry = [...root.querySelectorAll('button')].find(
      (element) => element.textContent === 'Retry same save'
    );
    retry.click();
    await created;
  } finally {
    document.removeEventListener('keydown', shortcut);
    feedback.dispose();
  }
});

test('safe exit pauses new editing across the final flush and releases the pause if sign-out fails', async () => {
  document.body.innerHTML = '<section id="editor"><button>Edit campaign</button></section>';
  const { feedback } = fixture(jest.fn());
  let release;
  const waiting = new Promise((resolve) => {
    release = resolve;
  });
  const leaving = feedback.pauseForExit(async () => {
    await waiting;
    throw new Error('Sign-out could not complete');
  });
  expect(document.getElementById('editor').inert).toBe(true);
  expect(feedback.root.hidden).toBe(false);
  expect(document.querySelector('[aria-label="Cloud save status"]').textContent).toContain(
    'Finishing cloud saves'
  );
  release();
  await expect(leaving).rejects.toThrow('Sign-out could not complete');
  expect(document.getElementById('editor').inert).toBe(false);
  expect(feedback.root.hidden).toBe(true);
  expect(document.querySelector('[aria-label="Cloud save status"]').textContent).toContain(
    'No save pending'
  );
  feedback.dispose();
});

test('a definitive revision conflict requires reopening instead of blindly resubmitting local state', async () => {
  document.body.innerHTML = '<section id="editor"><button>Edit campaign</button></section>';
  const fetch = jest.fn(async () => ({
    ok: false,
    status: 409,
    json: async () => ({
      version: 1,
      code: 'stale-revision',
      error: 'PRIVATE BACKEND DETAIL',
      current: { sceneRevision: 1, charactersRevision: 0 },
    }),
  }));
  const { store, feedback } = fixture(fetch);
  await expect(
    store.commitScene(campaignId, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: 0,
      scene: '{"fixture":"stale"}',
    })
  ).rejects.toMatchObject({ code: 'stale-revision' });
  const root = document.querySelector('[aria-label="Cloud save feedback"]');
  expect(root.querySelector('[role="status"]').textContent).toContain('Not saved');
  expect(root.hidden).toBe(false);
  expect(root.textContent).not.toContain('PRIVATE BACKEND DETAIL');
  expect(document.getElementById('editor').inert).toBe(true);
  expect(
    [...root.querySelectorAll('button')].find(
      (element) => element.textContent === 'Retry same save'
    ).hidden
  ).toBe(true);
  const reopen = [...root.querySelectorAll('button')].find(
    (element) => element.textContent === 'Reopen cloud version'
  );
  expect(reopen?.hidden).toBe(false);
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  feedback.dispose();
});
