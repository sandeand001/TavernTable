import { createHash, webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import ResourceSeeds from '../../../src/resources/ResourceSeeds.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

globalThis.TextDecoder ??= TextDecoder;

test('bundled seeds are verified before atomic installation and never fetched again when installed', async () => {
  const pack = {
    id: 'srd-2024',
    ruleset: '2024',
    version: '5.2.1',
    classes: [],
    entries: [
      {
        id: 'item:shield',
        kind: 'item',
        name: 'Shield',
        description: [],
        equipmentType: 'gear',
        effects: {},
        requiresAttunement: false,
        bonus: 0,
      },
    ],
    provenance: { attribution: 'Licensed test content' },
  };
  const bytes = Buffer.from(JSON.stringify(pack));
  const manifest = {
    version: 1,
    packs: [
      {
        id: pack.id,
        ruleset: pack.ruleset,
        version: pack.version,
        file: 'assets/data/resources/test-2024.json',
        bytes: bytes.length,
        hash: createHash('sha256').update(bytes).digest('hex'),
      },
    ],
  };
  let corrupted = true;
  const fetch = jest.fn(async function () {
    if (this !== undefined) throw new Error('Invalid fetch receiver');
    return {
      ok: true,
      arrayBuffer: async () => {
        const body = corrupted ? Buffer.from('{}') : bytes;
        return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength);
      },
    };
  });
  const seeds = new ResourceSeeds({
    manifest,
    fetch,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = {
    ruleset: '2024',
    sourcePacks: [{ id: pack.id, ruleset: '2024', version: pack.version, enabled: true }],
  };
  await expect(seeds.catalog(campaign)).rejects.toThrow('integrity');
  corrupted = false;
  expect((await seeds.catalog(campaign)).entries).toHaveLength(1);
  expect((await seeds.catalog(campaign)).entries).toHaveLength(1);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(new URL(fetch.mock.calls[0][0]).origin).toBe(window.location.origin);
  await expect(seeds.catalog({ ...campaign, ruleset: '2014' })).rejects.toThrow('ruleset');
  seeds.close();
});
