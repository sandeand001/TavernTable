import HostCampaignStore from '../../../src/campaigns/HostCampaignStore.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const authorityRoot =
  process.env.TAVERNTABLE_AUTHORITY_TREE || path.resolve(__dirname, '..', '..', '..');
const wire = JSON.parse(
  readFileSync(path.join(authorityRoot, 'tests', 'fixtures', 'player-wire-v1.json'), 'utf8')
);

const packs = [{ id: 'srd-2024', ruleset: '2024', version: '5.2.1', core: true }];

test('host saves await the server receipt and never fall back to browser storage', async () => {
  let acknowledge;
  const fetch = jest.fn(
    () =>
      new Promise((resolve) => {
        acknowledge = resolve;
      })
  );
  const store = new HostCampaignStore({
    packs,
    fetch,
    baseURL: 'http://localhost:3000/',
    host: { token: 'host-token', dataDirectory: 'campaign-data' },
  });
  let finished = false;
  const saving = store
    .commitScene('campaign', {
      ruleset: '2024',
      revision: 3,
      charactersRevision: 2,
      scene: '{"version":3}',
    })
    .then(() => {
      finished = true;
    });
  await Promise.resolve();
  expect(finished).toBe(false);
  expect(fetch.mock.contexts[0]).toBeUndefined();
  expect(fetch).toHaveBeenCalledWith(
    'http://localhost:3000/api/campaigns',
    expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({ 'X-TavernTable-Host': 'host-token' }),
      body: JSON.stringify({
        operation: 'commitScene',
        args: [
          'campaign',
          {
            ruleset: '2024',
            revision: 3,
            charactersRevision: 2,
            scene: '{"version":3}',
          },
        ],
      }),
    })
  );
  acknowledge({ ok: true, json: async () => ({ result: { revision: 4 } }) });
  await saving;
  expect(finished).toBe(true);
  expect(store.storageInfo).toMatchObject({ kind: 'host', dataDirectory: 'campaign-data' });
  store.close();
});

test('host failures are explicit and a closed store cannot issue requests', async () => {
  const fetch = jest
    .fn()
    .mockRejectedValueOnce(new TypeError('Connection refused'))
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: 'The campaign board changed in another window.' }),
    });
  const store = new HostCampaignStore({
    packs,
    fetch,
    baseURL: 'http://localhost:3000/',
    host: { token: 'host-token', dataDirectory: 'campaign-data' },
  });
  await expect(store.list()).rejects.toThrow('Connection refused');
  await expect(store.list()).rejects.toThrow('changed in another window');
  store.close();
  await expect(store.list()).rejects.toThrow('closed');
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('DM scene-save transport preserves the canonical typed denial without adding private state or revision aliases', async () => {
  const denial = wire.denials.stale;
  const store = new HostCampaignStore({
    packs,
    baseURL: 'http://localhost:3000/',
    host: { token: 'synthetic-test-token', dataDirectory: 'synthetic-test-data' },
    fetch: async () => ({ ok: false, status: denial.status, json: async () => denial.body }),
  });
  try {
    await expect(
      store.commitScene('campaign-example', {
        ruleset: '2024',
        revision: 1,
        charactersRevision: 1,
        scene: '{}',
      })
    ).rejects.toMatchObject({
      status: 409,
      code: 'stale-revision',
      current: { sceneRevision: 2, charactersRevision: 1 },
    });
  } finally {
    store.close();
  }
});
