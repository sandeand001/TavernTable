import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import CampaignLauncher from '../../../src/ui/campaigns/CampaignLauncher.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

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
