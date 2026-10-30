import { testIndexedDB } from '../../helpers/indexedDB.js';
import ResourceStore from '../../../src/resources/ResourceStore.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';

const pack = (ruleset, name) => ({
  id: `srd-${ruleset}`,
  version: ruleset === '2014' ? '5.1' : '5.2.1',
  ruleset,
  hash: (ruleset === '2014' ? 'a' : 'b').repeat(64),
  classes: [],
  entries: [
    {
      id: 'spell:shield',
      kind: 'spell',
      name,
      description: [],
      level: 1,
      school: 'Abjuration',
      classes: ['wizard'],
      castingTime: 'Reaction',
      range: 'Self',
      duration: '1 round',
      components: 'V, S',
      material: '',
      concentration: false,
      ritual: false,
      attackType: '',
      saveAbility: '',
      damage: [],
      healing: null,
      automation: 'spellcasting',
    },
  ],
});

test('edition databases isolate matching resource IDs and reject cross-edition installation and lookup', async () => {
  const indexedDB = testIndexedDB();
  const classic = new ResourceStore({ indexedDB, ruleset: '2014' });
  const revised = new ResourceStore({ indexedDB, ruleset: '2024' });
  const oldPack = pack('2014', 'Classic Shield');
  const newPack = pack('2024', 'Revised Shield');
  await classic.install(oldPack);
  await revised.install(newPack);
  expect((await classic.entry(oldPack, 'spell:shield')).name).toBe('Classic Shield');
  expect((await revised.entry(newPack, 'spell:shield')).name).toBe('Revised Shield');
  await expect(classic.install(newPack)).rejects.toThrow('ruleset');
  await expect(classic.entry(newPack, 'spell:shield')).rejects.toThrow('ruleset');
  classic.close();
  revised.close();
  const reopened = new ResourceStore({ indexedDB, ruleset: '2024' });
  expect((await reopened.entry(newPack, 'spell:shield')).name).toBe('Revised Shield');
  reopened.close();
});

test('disabling a source prevents new additions while preserving pinned resources for already-owned content', async () => {
  const indexedDB = testIndexedDB();
  const core = pack('2014', 'Shield');
  const extra = {
    ...pack('2014', 'Lantern spell'),
    id: 'supplement-2014',
    version: '1',
    entries: [{ ...pack('2014', 'Lantern spell').entries[0], id: 'extra:lantern' }],
  };
  const resources = new ResourceStore({ indexedDB, ruleset: '2014' });
  await resources.install(core);
  await resources.install(extra);
  const campaigns = new CampaignStore({ indexedDB, packs: [core, extra] });
  const campaign = await campaigns.create({ name: 'Party', ruleset: '2014', packIds: [extra.id] });
  const enabled = await resources.catalog(campaign);
  expect(enabled.enabledEntryIds).toContain('extra:lantern');
  const disabled = await campaigns.update(campaign.id, { packIds: [] });
  const catalog = await resources.catalog(disabled);
  expect(catalog.entries.find((entry) => entry.id === 'extra:lantern').name).toBe('Lantern spell');
  expect(catalog.enabledEntryIds).not.toContain('extra:lantern');
  expect(disabled.sourcePacks.find((source) => source.id === extra.id)).toMatchObject({
    version: '1',
    enabled: false,
  });
  resources.close();
  campaigns.close();
});

test('malformed automated resource data is rejected before any source version is installed', async () => {
  const resources = new ResourceStore({ indexedDB: testIndexedDB(), ruleset: '2024' });
  const broken = pack('2024', 'Broken Shield');
  broken.entries[0].castingTime = '';
  await expect(resources.install(broken)).rejects.toThrow('spell');
  expect(await resources.installed(broken)).toBeUndefined();
  resources.close();
});
