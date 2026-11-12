import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import CampaignLauncher from '../../../src/ui/campaigns/CampaignLauncher.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';

globalThis.TextDecoder ??= TextDecoder;

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
  const fetch = async (input) => {
    const path = new URL(input, location.href).pathname;
    if (!path.startsWith('/api/')) return fetchBundledResource(input);
    apiRequests.push(path);
    const result = path.endsWith('/account/campaigns')
      ? { owned: [owned], joined: [joined] }
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
  expect(launcher.root.querySelector('[data-campaign-import]').hidden).toBe(true);
  expect(launcher.root.querySelector('[data-edit-campaign]')).toBeNull();
  expect(launcher.root.querySelector('[data-export-campaign]')).toBeNull();
  expect(launcher.root.querySelector('[data-cloud-account]').textContent).toContain(
    'picker@example.invalid'
  );
  expect(launcher.root.querySelector('[data-cloud-account-signout]').hidden).toBe(false);
  const ownedGroup = launcher.list.querySelector('[data-campaign-group="owned"]');
  const joinedGroup = launcher.list.querySelector('[data-campaign-group="joined"]');
  expect(ownedGroup?.textContent).toContain('Owned campaigns');
  expect(ownedGroup?.querySelector('[data-open-campaign]')).not.toBeNull();
  expect(ownedGroup?.querySelector('[data-cloud-invitations]')).not.toBeNull();
  expect(joinedGroup?.textContent).toContain('Joined campaign fixture');
  expect(joinedGroup?.querySelector('[data-open-campaign]')).toBeNull();
  expect(joinedGroup?.querySelector('[data-cloud-invitations]')).toBeNull();
  const access = joinedGroup.querySelector('[data-view-campaign-access]');
  access.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(launcher.status.textContent).toContain('Cloud player gameplay is not enabled yet');
  expect(apiRequests).toContain(`/api/cloud/campaigns/${joinedId}/access`);
  expect(apiRequests.some((path) => /\/(scene|characters)$/.test(path))).toBe(false);
  expect(workspace.active).toBeNull();
  launcher.destroy();
  workspace.close();
}, 30000);
