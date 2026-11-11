/** @jest-environment node */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import { SqliteCampaignStorage } from '../../../tools/campaign-storage.js';
import { CampaignBackups } from '../../../tools/campaign-backups.js';

const packs = [{ id: 'srd-2024', ruleset: '2024', version: '5.2.1', core: true }];
let folder;
let store;
let backups;

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-json-backup-'));
  store = new CampaignStore({
    packs,
    storage: new SqliteCampaignStorage(path.join(folder, 'campaigns.sqlite')),
  });
  backups = new CampaignBackups({
    directory: path.join(folder, 'backups'),
    store,
    intervalMs: 300000,
    retain: 2,
  });
});

afterEach(async () => {
  await backups.close();
  await store.close();
  await fs.rm(folder, { recursive: true, force: true });
});

test('the automatic scheduler writes changed data without a manual backup request', async () => {
  const campaign = await store.create({ name: 'Scheduled backup', ruleset: '2024' });
  await backups.close();
  backups = new CampaignBackups({
    directory: path.join(folder, 'backups'),
    store,
    intervalMs: 20,
    retain: 2,
  });
  backups.changedCampaign(campaign.id);
  const deadline = Date.now() + 3000;
  while (!(await backups.list(campaign.id)).length && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 20));
  expect(await backups.list(campaign.id)).toHaveLength(1);
  await new Promise((resolve) => setTimeout(resolve, 80));
  expect(await backups.list(campaign.id)).toHaveLength(1);
});

test('automatic snapshots contain the committed character and board state and skip unchanged data', async () => {
  const campaign = await store.create({ name: 'Backed up', ruleset: '2024' });
  await store.commitCharacters(campaign.id, {
    ruleset: '2024',
    revision: 0,
    records: [{ key: 'character', value: '{"hp":7,"favorites":["spell:fly"]}' }],
    scene: { revision: 0, value: '{"turn":17,"effects":["fly"]}' },
  });
  backups.changedCampaign(campaign.id);
  await backups.flush();
  const first = (await backups.list(campaign.id))[0];
  const snapshot = JSON.parse(await backups.read(campaign.id, first.name));
  expect(snapshot).toMatchObject({
    format: 'taverntable-campaign',
    version: 2,
    records: [{ key: 'character', value: '{"hp":7,"favorites":["spell:fly"]}' }],
    scene: '{"turn":17,"effects":["fly"]}',
  });
  backups.changedCampaign(campaign.id);
  await backups.flush();
  expect(await backups.list(campaign.id)).toHaveLength(1);
  expect((await backups.status(campaign.id)).state).toBe('saved');
});

test('manual snapshots rotate within retention and restore as a separate campaign', async () => {
  const campaign = await store.create({ name: 'History', ruleset: '2024' });
  for (let index = 0; index < 4; index++) {
    await store.update(campaign.id, { name: `History ${index}` });
    await backups.backupNow(campaign.id);
  }
  const snapshots = await backups.list(campaign.id);
  expect(snapshots).toHaveLength(2);
  const restored = await store.importBackup(await backups.read(campaign.id, snapshots[0].name));
  expect(restored.id).not.toBe(campaign.id);
  expect((await store.get(campaign.id)).name).toBe('History 3');
  expect(restored.name).toBe('History 3');
  await expect(backups.read(campaign.id, '..\\campaigns.sqlite')).rejects.toThrow('filename');
  await expect(backups.list('..\\outside')).rejects.toThrow('identity');
});

test('backup failures are visible without corrupting or rolling back an acknowledged primary save', async () => {
  const campaign = await store.create({ name: 'Primary remains', ruleset: '2024' });
  await backups.close();
  const io = {
    ...fs,
    open: async () => {
      throw new Error('Backup disk unavailable');
    },
  };
  backups = new CampaignBackups({ directory: path.join(folder, 'backups'), store, io });
  await expect(backups.backupNow(campaign.id)).rejects.toThrow('Backup disk unavailable');
  expect((await backups.status(campaign.id)).state).toBe('error');
  expect((await store.get(campaign.id)).name).toBe('Primary remains');
  backups.changed.clear();
});
