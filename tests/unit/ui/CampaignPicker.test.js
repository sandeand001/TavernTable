import { webcrypto } from 'node:crypto';
import { TextDecoder, TextEncoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import CampaignLauncher from '../../../src/ui/campaigns/CampaignLauncher.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';
import CloudPlayerSessionConnection from '../../../src/campaigns/CloudPlayerSessionConnection.js';
import CloudParticipantCache from '../../../src/campaigns/CloudParticipantCache.js';

globalThis.TextDecoder ??= TextDecoder;
globalThis.TextEncoder ??= TextEncoder;
globalThis.structuredClone ??= (value) => JSON.parse(JSON.stringify(value));

test('a Joined live-game choice uses only current member access and never opens the private owner workspace', async () => {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const access = {
    version: 1,
    uid: 'picker-player',
    campaignId,
    role: 'member',
    seatId: '22222222-2222-4222-8222-222222222222',
    accessGeneration: 1,
  };
  const campaign = {
    id: campaignId,
    name: 'Joined live game',
    ruleset: '2014',
    coreVersion: '5.1',
  };
  const state = { campaign, profile: { role: 'player', campaignId, characterIds: [] } };
  let live = false;
  const workspace = {
    manifest: { packs: [] },
    resources: { catalog: jest.fn(async () => ({ ruleset: '2014' })) },
    open: jest.fn(async () => {
      throw new Error('Member must never open owner campaign data');
    }),
    store: {
      uid: access.uid,
      storageInfo: { kind: 'cloud', label: 'Cloud-authoritative storage' },
      capabilities: {
        sharedSessions: true,
        settings: false,
        backups: false,
        invitations: false,
        portability: false,
        browserImport: false,
      },
      connection: {
        account: { identity: () => ({ uid: access.uid, email: 'player@example.invalid' }) },
      },
      listAccess: jest.fn(async () => ({
        owned: [],
        joined: [{ version: 1, campaign, role: 'member', seatId: access.seatId }],
      })),
      getParticipantAccess: jest.fn(async () => ({ access })),
      getLiveSession: jest.fn(async () => ({
        state: live ? 'live' : 'paused',
        sessionId: '33333333-3333-4333-8333-333333333333',
      })),
      observeEvents: jest.fn(),
      readParticipantSnapshot: jest.fn(),
      readParticipantAsset: jest.fn(),
      commitWorldCommand: jest.fn(),
    },
  };
  const open = jest.spyOn(CloudPlayerSessionConnection.prototype, 'open').mockResolvedValue(state);
  const cache = new CloudParticipantCache({ uid: access.uid });
  Object.defineProperty(cache, 'available', { configurable: true, value: true });
  jest.spyOn(cache, 'getUsage').mockResolvedValue({
    bytes: 0,
    limitBytes: 256 * 1024 * 1024,
    assetStorageAvailable: true,
    crossTabCoordinated: true,
  });
  const unavailable = { available: false, close: jest.fn(async () => {}) };
  const cacheFactory = jest.fn().mockReturnValueOnce(unavailable).mockReturnValue(cache);
  const launcher = new CampaignLauncher({ workspace, cacheFactory });
  let choice;
  try {
    const picked = launcher.choose();
    await launcher.ready;
    const join = launcher.list.querySelector('[data-open-cloud-game]');
    expect(join).not.toBeNull();
    join.click();
    for (let step = 0; step < 20 && launcher.busy; step++) await Promise.resolve();
    expect(launcher.status.textContent).toContain('paused');
    expect(open).not.toHaveBeenCalled();
    expect(cacheFactory).not.toHaveBeenCalled();
    live = true;
    join.click();
    for (let step = 0; step < 20 && launcher.busy; step++) await Promise.resolve();
    expect(launcher.status.textContent).toMatch(/private.*cache/i);
    expect(open).not.toHaveBeenCalled();
    expect(unavailable.close).toHaveBeenCalledTimes(1);
    join.click();
    for (let step = 0; step < 20 && launcher.busy; step++) await Promise.resolve();
    if (launcher.status.classList.contains('sheet-error'))
      throw new Error(launcher.status.textContent);
    choice = await picked;
    expect(choice.role).toBe('player');
    expect(choice.identity.role).toBe('player');
    expect(choice.initialState).toBe(state);
    expect(choice.connection.cache).toBe(cache);
    expect(cacheFactory).toHaveBeenLastCalledWith({ uid: access.uid });
    expect(cache.getUsage).toHaveBeenCalledTimes(1);
    expect(workspace.open).not.toHaveBeenCalled();
    expect(workspace.store.getParticipantAccess).toHaveBeenCalledWith(campaignId);
  } finally {
    await choice?.connection.close();
    launcher.destroy();
    open.mockRestore();
  }
});

test('account private-cache settings remain accessible while live gameplay is gated and never open a campaign workspace', async () => {
  const uid = 'cache-account';
  const account = { identity: () => ({ uid, email: 'cache@example.invalid' }) };
  const workspace = {
    manifest: { packs: [] },
    open: jest.fn(),
    store: {
      uid,
      storageInfo: { kind: 'cloud', label: 'Cloud-authoritative storage' },
      connection: { account },
      capabilities: {
        sharedSessions: false,
        settings: false,
        backups: false,
        invitations: false,
        portability: false,
        browserImport: false,
      },
      listAccess: async () => ({ owned: [], joined: [] }),
      getLiveSession: jest.fn(),
    },
  };
  const cache = {
    available: true,
    protectView: async () => async () => {},
    getUsage: async () => ({
      bytes: 0,
      limitBytes: 256 * 1024 * 1024,
      assetStorageAvailable: true,
      crossTabCoordinated: true,
    }),
    close: jest.fn(async () => {}),
  };
  const cacheFactory = jest.fn(() => cache);
  const launcher = new CampaignLauncher({ workspace, cacheFactory });
  try {
    launcher.choose();
    await launcher.ready;
    expect(cacheFactory).not.toHaveBeenCalled();
    expect(launcher.root.querySelector('[data-open-cloud-game]')).toBeNull();
    launcher.root.querySelector('[data-cloud-cache]').click();
    for (let step = 0; step < 20 && launcher.busy; step++) await Promise.resolve();
    expect(launcher.cacheControls).toBeDefined();
    await launcher.cacheControls.ready;
    expect(cacheFactory).toHaveBeenCalledWith({ uid });
    expect(launcher.cacheControls.root.querySelector('input').value).toBe('256');
    expect(workspace.open).not.toHaveBeenCalled();
    expect(workspace.store.getLiveSession).not.toHaveBeenCalled();
    expect(workspace.store.capabilities.sharedSessions).toBe(false);
    launcher.destroy();
    await launcher.cacheControls.destroy();
    expect(cache.close).toHaveBeenCalledTimes(1);
  } finally {
    launcher.destroy();
  }
});

test('a large cloud export omits only the text preview and still downloads the exact complete file', async () => {
  const text = '{"fixture":"' + 'x'.repeat(1024 * 1024) + '"}';
  const campaign = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Large backup',
    ruleset: '2014',
    coreVersion: '5.1',
  };
  const workspace = {
    manifest: { packs: [] },
    store: {
      storageInfo: { kind: 'cloud', label: 'Cloud-authoritative storage' },
      capabilities: {
        portability: true,
        backups: false,
        settings: false,
        invitations: false,
        browserImport: false,
      },
      connection: { account: { identity: () => ({ email: 'preview@example.invalid' }) } },
      listAccess: async () => ({ owned: [{ campaign, role: 'owner', seatId: null }], joined: [] }),
      get: async () => campaign,
    },
    exportBackup: async () => text,
  };
  const originalCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
  const originalRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
  let downloaded;
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: jest.fn((blob) => {
      downloaded = blob;
      return 'blob:backup-test';
    }),
  });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: jest.fn() });
  const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const launcher = new CampaignLauncher({ workspace });
  try {
    launcher.choose();
    await launcher.ready;
    launcher.list.querySelector('[data-export-campaign]').click();
    for (let step = 0; step < 20 && launcher.busy; step++) await Promise.resolve();
    expect(launcher.busy).toBe(false);
    expect(launcher.backupText.hidden).toBe(true);
    expect(launcher.backupText.value).toBe('');
    expect(launcher.status.textContent).toContain('complete');
    launcher.root.querySelector('[data-campaign-download]').click();
    const saved = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(downloaded);
    });
    expect(saved).toBe(text);
    expect(downloaded.size).toBe(new TextEncoder().encode(text).byteLength);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    launcher.destroy();
    click.mockRestore();
    if (originalCreate) Object.defineProperty(URL, 'createObjectURL', originalCreate);
    else delete URL.createObjectURL;
    if (originalRevoke) Object.defineProperty(URL, 'revokeObjectURL', originalRevoke);
    else delete URL.revokeObjectURL;
  }
});

test('the picker identifies durable host storage and offers an explicit non-destructive browser copy', async () => {
  let copied = false;
  const workspace = {
    store: { storageInfo: { kind: 'host', dataDirectory: 'C:\\Campaigns' } },
    list: jest.fn(async () =>
      copied ? [{ id: 'copied', name: 'Copied world', ruleset: '2024', sourcePacks: [] }] : []
    ),
    browserCampaigns: jest.fn(async () => [{ id: 'old', name: 'Browser world', ruleset: '2024' }]),
    copyBrowserCampaign: jest.fn(async () => {
      copied = true;
    }),
  };
  const launcher = new CampaignLauncher({ workspace });
  launcher.choose();
  await launcher.ready;
  expect(launcher.root.querySelector('[data-campaign-storage]').textContent).toContain(
    'C:\\Campaigns'
  );
  const button = launcher.root.querySelector('[data-copy-browser-campaign]');
  button.click();
  for (let step = 0; step < 10 && launcher.busy; step++) await Promise.resolve();
  expect(workspace.copyBrowserCampaign).toHaveBeenCalledWith('old');
  expect(launcher.list.textContent).toContain('Copied world');
  expect(launcher.root.querySelector('[data-browser-campaigns]').textContent).toContain(
    'Browser world'
  );
  launcher.destroy();
});

test('startup requires an explicit campaign ruleset before opening a scoped, ready-to-play workspace', async () => {
  const workspace = await CampaignWorkspace.load({
    storage: 'browser',
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const launcher = new CampaignLauncher({ workspace });
  const picked = launcher.choose();
  await launcher.ready;
  const form = launcher.root.querySelector('[aria-label="Create campaign"]');
  const name = form.querySelector('[aria-label="Campaign name"]');
  const ruleset = form.querySelector('[aria-label="Campaign ruleset"]');
  expect(document.activeElement).toBe(name);
  expect(ruleset.value).toBe('');
  name.value = 'Revised campaign';
  ruleset.value = '2024';
  ruleset.dispatchEvent(new Event('change', { bubbles: true }));
  expect(form.querySelector('[data-pack-id="tob"]')).toBeNull();
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const services = await picked;
  expect(services.campaign).toMatchObject({ name: 'Revised campaign', ruleset: '2024' });
  expect(services.catalog.ruleset).toBe('2024');
  expect(services.library.list()).toEqual([]);
  expect(document.body.contains(launcher.root)).toBe(false);
  workspace.close();
}, 30000);

test('the real cloud picker separates Owned and Joined access without opening a player seat as the campaign owner', async () => {
  const manifest = await (
    await fetchBundledResource(new URL('assets/data/resources/manifest.json', location.href).href)
  ).json();
  const seed = manifest.packs.find((entry) => entry.id === 'srd-2014');
  const campaign = {
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Private cloud picker',
    ruleset: '2014',
    coreVersion: '5.1',
    createdAt: '2026-11-11T00:00:00.000Z',
    sourcePacks: [{ id: seed.id, version: seed.version, ruleset: '2014', enabled: true }],
    charactersRevision: 0,
    sceneRevision: 0,
    sceneSavedAt: null,
  };
  const auth = {
    currentUser: {
      uid: 'picker-owner',
      email: 'picker@example.invalid',
      emailVerified: true,
      getIdToken: async () => 'fixture-token',
    },
  };
  const sdk = {
    signInWithEmailAndPassword: async () => {},
    signOut: async () => {
      auth.currentUser = null;
    },
  };
  const account = new CloudAccount({ auth, sdk });
  const joinedId = '22222222-2222-4222-8222-222222222222';
  const owned = {
    version: 1,
    campaign: {
      id: campaign.id,
      name: campaign.name,
      ruleset: campaign.ruleset,
      coreVersion: campaign.coreVersion,
    },
    role: 'owner',
    seatId: null,
  };
  const joined = {
    version: 1,
    campaign: { ...owned.campaign, id: joinedId, name: 'Joined campaign fixture' },
    role: 'member',
    seatId: '33333333-3333-4333-8333-333333333333',
  };
  const apiRequests = [];
  let removed = false;
  let settingsGeneration = 1;
  const settingsWrites = [];
  const fetch = async (input, options = {}) => {
    const path = new URL(input, location.href).pathname;
    if (!path.startsWith('/api/')) return fetchBundledResource(input);
    apiRequests.push(path);
    if (path.endsWith('/settings')) {
      if (options.method === 'POST') {
        const command = JSON.parse(options.body);
        settingsWrites.push(command);
        expect(command.generation).toBe(settingsGeneration);
        Object.assign(campaign, {
          name: command.changes.name.trim(),
          charactersRevision: campaign.charactersRevision + 1,
        });
        owned.campaign.name = campaign.name;
        settingsGeneration++;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          version: 1,
          result: { version: 1, generation: settingsGeneration, campaign },
        }),
      };
    }
    if (path.endsWith('/participant-access') && removed)
      return {
        ok: false,
        status: 404,
        json: async () => ({
          version: 1,
          code: 'campaign-not-found',
          error: 'PRIVATE POLICY DETAIL',
        }),
      };
    const result = path.endsWith('/account/campaigns')
      ? { owned: [owned], joined: removed ? [] : [joined] }
      : path.endsWith('/participant-access')
        ? {
            version: 1,
            campaign: joined.campaign,
            characterIds: [],
            access: {
              version: 1,
              uid: 'picker-owner',
              campaignId: joinedId,
              role: 'member',
              seatId: joined.seatId,
              accessGeneration: 0,
            },
          }
        : path.endsWith('/access')
          ? joined
          : [campaign];
    return { ok: true, status: 200, json: async () => ({ version: 1, result }) };
  };
  const runtime = {
    version: 1,
    mode: 'cloud',
    environment: 'emulator',
    apiOrigin: location.origin,
    authEmulatorOrigin: 'http://127.0.0.1:19099',
    firebase: {
      apiKey: 'demo-api-key',
      projectId: 'demo-taverntable',
      authDomain: 'demo-taverntable.firebaseapp.com',
      appId: 'demo-picker',
    },
  };
  const connection = new CloudAccountConnection({
    account,
    runtime,
    fetch,
    baseURL: location.href,
  });
  const workspace = await CampaignWorkspace.load({
    storage: 'cloud',
    connection,
    uid: 'picker-owner',
    fetch,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const launcher = new CampaignLauncher({ workspace });
  launcher.choose();
  await launcher.ready;
  expect(launcher.root.querySelector('[data-campaign-storage]').textContent).toContain(
    'Cloud-authoritative'
  );
  expect(launcher.root.textContent).not.toContain('Browser-only storage:');
  expect(launcher.root.querySelector('[data-campaign-import]').hidden).toBe(false);
  expect(launcher.root.querySelectorAll('[data-campaign-backups]')).toHaveLength(1);
  expect(launcher.root.querySelector('[data-cloud-account]').textContent).toContain(
    'picker@example.invalid'
  );
  expect(launcher.root.querySelector('[data-cloud-account-signout]').hidden).toBe(false);
  const ownedGroup = launcher.list.querySelector('[data-campaign-group="owned"]');
  const joinedGroup = launcher.list.querySelector('[data-campaign-group="joined"]');
  expect(ownedGroup?.textContent).toContain('Owned campaigns');
  expect(ownedGroup?.querySelector('[data-open-campaign]')).not.toBeNull();
  expect(ownedGroup?.querySelector('[data-cloud-invitations]')).not.toBeNull();
  expect(ownedGroup?.querySelector('[data-edit-campaign]')).not.toBeNull();
  expect(ownedGroup?.querySelector('[data-export-campaign]')).not.toBeNull();
  expect(ownedGroup?.querySelector('[data-campaign-backups]')).not.toBeNull();
  expect(joinedGroup?.textContent).toContain('Joined campaign fixture');
  expect(joinedGroup?.querySelector('[data-open-campaign]')).toBeNull();
  expect(joinedGroup?.querySelector('[data-cloud-invitations]')).toBeNull();
  expect(joinedGroup?.querySelector('[data-edit-campaign]')).toBeNull();
  expect(joinedGroup?.querySelector('[data-export-campaign]')).toBeNull();
  expect(joinedGroup?.querySelector('[data-campaign-backups]')).toBeNull();
  const settle = async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!launcher.busy) return;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    throw new Error('The campaign settings operation did not finish');
  };
  ownedGroup.querySelector('[data-edit-campaign]').click();
  await settle();
  expect(launcher.settings.hidden).toBe(false);
  for (const name of ['First saved name', 'Second saved name']) {
    launcher.settingsName.value = name;
    launcher.settings.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle();
    expect(launcher.status.textContent).toContain('Campaign settings saved');
  }
  expect(settingsWrites.map((command) => command.generation)).toEqual([1, 2]);
  expect(settingsWrites[0].changes.packIds).toEqual(['srd-2014']);
  expect(launcher.list.querySelector('[data-campaign-group="owned"]').textContent).toContain(
    'Second saved name'
  );
  launcher.settings.hidden = true;
  const access = launcher.list.querySelector('[data-view-campaign-access]');
  access.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(launcher.status.textContent).toContain('Cloud player gameplay is not enabled yet');
  expect(launcher.status.textContent).toContain('0 assigned saved characters');
  expect(apiRequests).toContain(`/api/cloud/campaigns/${joinedId}/participant-access`);
  expect(apiRequests.some((path) => /\/(scene|characters)$/.test(path))).toBe(false);
  expect(workspace.active).toBeNull();
  removed = true;
  launcher.list.querySelector('[data-view-campaign-access]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(launcher.list.querySelector('[data-campaign-group="joined"] article')).toBeNull();
  expect(launcher.status.textContent).toContain('not available');
  expect(launcher.status.textContent).not.toContain('PRIVATE POLICY DETAIL');
  expect(workspace.active).toBeNull();
  launcher.destroy();
  workspace.close();
}, 30000);
