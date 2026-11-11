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

test('the real cloud picker identifies authority and account while gating unfinished backup/source capabilities', async () => {
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
  const fetch = async (input) => {
    if (!new URL(input, location.href).pathname.startsWith('/api/'))
      return fetchBundledResource(input);
    return { ok: true, status: 200, json: async () => ({ version: 1, result: [campaign] }) };
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
  launcher.destroy();
  workspace.close();
}, 30000);
