import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import CampaignLauncher from '../../../src/ui/campaigns/CampaignLauncher.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

globalThis.TextDecoder ??= TextDecoder;

test('startup requires an explicit campaign ruleset before opening a scoped, ready-to-play workspace', async () => {
  const workspace = await CampaignWorkspace.load({
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
