/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import { SqliteCampaignStorage } from '../../../tools/campaign-storage.js';

const packs = [{ id: 'srd-2024', ruleset: '2024', version: '5.2.1', core: true }];
let folder;
let store;

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-durable-'));
});

afterEach(async () => {
  if (store) await store.close();
  await fs.rm(folder, { recursive: true, force: true });
});

function open() {
  return new CampaignStore({
    packs,
    storage: new SqliteCampaignStorage(path.join(folder, 'campaigns.sqlite')),
  });
}

test('characters, boards and source pins survive closing and reopening disk storage', async () => {
  store = open();
  const campaign = await store.create({ name: 'Durable campaign', ruleset: '2024' });
  await store.commitCharacters(campaign.id, {
    ruleset: '2024',
    revision: 0,
    records: [{ key: 'character', value: '{"hp":7,"slotsUsed":[1]}' }],
    scene: { revision: 0, value: '{"version":3,"turn":12,"maps":[{"id":"floor"}]}' },
  });
  const before = await store.readCharacters(campaign.id);
  await store.close();
  store = open();
  expect(await store.readCharacters(campaign.id)).toEqual(before);
  expect(await store.list()).toHaveLength(1);
});

test('stale combined saves roll back both character resources and scene state', async () => {
  store = open();
  const campaign = await store.create({ name: 'Atomic host', ruleset: '2024' });
  await store.commitScene(campaign.id, {
    ruleset: '2024',
    revision: 0,
    charactersRevision: 0,
    scene: '{"actions":1}',
  });
  await expect(
    store.commitCharacters(campaign.id, {
      ruleset: '2024',
      revision: 0,
      records: [{ key: 'spent', value: 'yes' }],
      scene: { revision: 0, value: '{"actions":0}' },
    })
  ).rejects.toThrow('changed');
  const unchanged = await store.readCharacters(campaign.id);
  expect(unchanged.records).toEqual([]);
  expect(unchanged.scene).toBe('{"actions":1}');
  expect(unchanged.revision).toBe(0);
});

test('a disk write failure rolls back replaced records instead of acknowledging a partial save', async () => {
  store = open();
  const campaign = await store.create({ name: 'Write failure', ruleset: '2024' });
  store.storage.database.exec(`
    CREATE TRIGGER reject_write BEFORE UPDATE ON campaigns
    BEGIN SELECT RAISE(ABORT, 'disk write rejected'); END;
  `);
  await expect(
    store.commitCharacters(campaign.id, {
      ruleset: '2024',
      revision: 0,
      records: [{ key: 'resource', value: 'spent' }],
      scene: { revision: 0, value: '{"actions":0}' },
    })
  ).rejects.toThrow('disk write rejected');
  const unchanged = await store.readCharacters(campaign.id);
  expect(unchanged.records).toEqual([]);
  expect(unchanged.scene).toBeNull();
  expect(unchanged.revision).toBe(0);
});
