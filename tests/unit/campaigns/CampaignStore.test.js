import { testIndexedDB } from '../../helpers/indexedDB.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';

const packs = [
  { id: 'srd-2014', ruleset: '2014', version: '5.1', core: true },
  { id: 'srd-2024', ruleset: '2024', version: '5.2.1', core: true },
  { id: 'supplement-2014', ruleset: '2014', version: '1', core: false },
];

test('scene snapshots persist independently inside their own campaign and edition', async () => {
  const indexedDB = testIndexedDB();
  const store = new CampaignStore({ indexedDB, packs });
  const first = await store.create({ name: 'Board', ruleset: '2014' });
  const second = await store.create({ name: 'Other board', ruleset: '2024' });
  const scene = JSON.stringify({ version: 1, terrain: [[0, 3]], creatures: ['marker'] });
  await store.commitScene(first.id, {
    ruleset: '2014',
    revision: 0,
    charactersRevision: 0,
    scene,
  });
  expect((await store.readScene(first.id)).scene).toBe(scene);
  expect((await store.readScene(second.id)).scene).toBeNull();
  await expect(
    store.commitScene(first.id, {
      ruleset: '2024',
      revision: 1,
      charactersRevision: 0,
      scene,
    })
  ).rejects.toThrow('ruleset');
  await expect(
    store.commitScene(first.id, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: 0,
      scene,
    })
  ).rejects.toThrow('changed');
  store.close();
  const reopened = new CampaignStore({ indexedDB, packs });
  expect((await reopened.readScene(first.id)).scene).toBe(scene);
  reopened.close();
});

test('character costs and their scene snapshot commit atomically and backups include the scene', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({ name: 'Atomic world', ruleset: '2024' });
  const before = '{"version":1,"actions":1}';
  const after = '{"version":1,"actions":0}';
  await store.commitScene(campaign.id, {
    ruleset: '2024',
    revision: 0,
    charactersRevision: 0,
    scene: before,
  });
  await expect(
    store.commitCharacters(campaign.id, {
      ruleset: '2024',
      revision: 0,
      records: [{ key: 'cost', value: 'spent' }],
      scene: { revision: 0, value: after },
    })
  ).rejects.toThrow('changed');
  expect((await store.readCharacters(campaign.id)).records).toEqual([]);
  await store.commitCharacters(campaign.id, {
    ruleset: '2024',
    revision: 0,
    records: [{ key: 'cost', value: 'spent' }],
    scene: { revision: 1, value: after },
  });
  expect((await store.readScene(campaign.id)).scene).toBe(after);
  const backup = await store.exportBackup(campaign.id);
  expect(JSON.parse(backup)).toMatchObject({ version: 2, scene: after });
  const restored = await store.importBackup(backup);
  expect((await store.readScene(restored.id)).scene).toBe(after);
  expect((await store.readCharacters(restored.id)).records).toEqual([
    { key: 'cost', value: 'spent' },
  ]);
  store.close();
});

test('campaign creation requires an immutable ruleset and persists only compatible source choices', async () => {
  const indexedDB = testIndexedDB();
  const store = new CampaignStore({ indexedDB, packs });
  await expect(store.create({ name: 'Missing edition' })).rejects.toThrow('ruleset');
  const classic = await store.create({
    name: 'Classic',
    ruleset: '2014',
    packIds: ['supplement-2014'],
  });
  const revised = await store.create({ name: 'Revised', ruleset: '2024' });
  await expect(store.update(classic.id, { ruleset: '2024' })).rejects.toThrow('fixed');
  await expect(
    store.create({ name: 'Wrong pack', ruleset: '2024', packIds: ['supplement-2014'] })
  ).rejects.toThrow('ruleset');
  store.close();
  const reopened = new CampaignStore({ indexedDB, packs });
  expect((await reopened.get(classic.id)).ruleset).toBe('2014');
  expect((await reopened.get(revised.id)).ruleset).toBe('2024');
  expect((await reopened.get(classic.id)).sourcePacks.map((pack) => pack.id)).toEqual([
    'srd-2014',
    'supplement-2014',
  ]);
  expect(await reopened.list()).toHaveLength(2);
  reopened.close();
});

test('campaign-owned character state commits atomically and rejects stale or cross-edition writes', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const classic = await store.create({ name: 'Classic', ruleset: '2014' });
  const revised = await store.create({ name: 'Revised', ruleset: '2024' });
  await store.commitCharacters(classic.id, {
    ruleset: '2014',
    revision: 0,
    records: [{ key: 'character', value: 'Classic character' }],
  });
  await store.commitCharacters(revised.id, {
    ruleset: '2024',
    revision: 0,
    records: [{ key: 'character', value: 'Revised character' }],
  });
  expect((await store.readCharacters(classic.id)).records).toEqual([
    { key: 'character', value: 'Classic character' },
  ]);
  expect((await store.readCharacters(revised.id)).records).toEqual([
    { key: 'character', value: 'Revised character' },
  ]);
  await expect(
    store.commitCharacters(classic.id, {
      ruleset: '2014',
      revision: 0,
      records: [],
    })
  ).rejects.toThrow('changed');
  await expect(
    store.commitCharacters(classic.id, {
      ruleset: '2024',
      revision: 1,
      records: [],
    })
  ).rejects.toThrow('ruleset');
  expect((await store.readCharacters(classic.id)).records).toHaveLength(1);
  store.close();
});

test('portable campaign backups preserve source pins and owned records in a distinct campaign', async () => {
  const store = new CampaignStore({ indexedDB: testIndexedDB(), packs });
  const campaign = await store.create({
    name: 'Portable',
    ruleset: '2014',
    packIds: ['supplement-2014'],
  });
  await store.update(campaign.id, { packIds: [] });
  await store.commitCharacters(campaign.id, {
    ruleset: '2014',
    revision: 1,
    records: [{ key: 'character-layout', value: '{"favorites":["weapon:owned-instance"]}' }],
  });
  const backup = await store.exportBackup(campaign.id);
  const copied = await store.importBackup(backup);
  expect(copied.id).not.toBe(campaign.id);
  expect(copied.ruleset).toBe('2014');
  expect(copied.sourcePacks).toEqual(
    campaign.sourcePacks.map((source) => ({
      ...source,
      enabled: source.id === 'srd-2014',
    }))
  );
  expect((await store.readCharacters(copied.id)).records).toEqual(
    (await store.readCharacters(campaign.id)).records
  );
  const invalid = JSON.parse(backup);
  invalid.campaign.ruleset = '2024';
  await expect(store.importBackup(JSON.stringify(invalid))).rejects.toThrow();
  expect(await store.list()).toHaveLength(2);
  store.close();
});
