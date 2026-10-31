import fs from 'node:fs/promises';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import ResourceSeeds from '../../../src/resources/ResourceSeeds.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

globalThis.TextDecoder ??= TextDecoder;
const root = path.resolve(__dirname, '..', '..', '..');

test('every shipped pack installs with verified hashes and keeps real 2014/2024 rules data separate', async () => {
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8')
  );
  const fetch = jest.fn(async (url) => {
    const location = new URL(url);
    expect(location.origin).toBe(window.location.origin);
    const bytes = await fs.readFile(
      path.join(root, ...location.pathname.split('/').filter(Boolean))
    );
    return {
      ok: true,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  });
  const seeds = new ResourceSeeds({
    manifest,
    indexedDB: testIndexedDB(),
    fetch,
    crypto: webcrypto,
  });
  const catalogs = {};
  for (const ruleset of ['2014', '2024']) {
    const sources = manifest.packs.filter((pack) => pack.ruleset === ruleset);
    catalogs[ruleset] = await seeds.catalog({
      ruleset,
      sourcePacks: sources.map(({ id, version }) => ({ id, version, ruleset, enabled: true })),
    });
    expect(catalogs[ruleset].entries).toHaveLength(
      sources.reduce((sum, pack) => sum + pack.count, 0)
    );
    expect(catalogs[ruleset].entries.every((entry) => entry.ruleset === ruleset)).toBe(true);
    expect(catalogs[ruleset].classes).toHaveLength(12);
  }
  const find = (ruleset, id) => catalogs[ruleset].entries.find((entry) => entry.id === id);
  expect(find('2014', 'spell:cure-wounds').healing[1]).toBe('1d8 + MOD');
  expect(find('2024', 'spell:cure-wounds').healing).toMatchObject({ 1: '2d8+MOD', 2: '4d8+MOD' });
  expect(find('2024', 'spell:fireball').damage[0].damage_at_slot_level[4]).toBe('9d6');
  expect(find('2024', 'spell:cure-wounds').castingTime).toBe('Action');
  expect(catalogs['2014'].classes.find((entry) => entry.id === 'paladin').slots[1][0]).toBe(0);
  expect(catalogs['2024'].classes.find((entry) => entry.id === 'paladin').slots[1][0]).toBe(2);
  expect(manifest.packs.some((pack) => ['bfrd', 'a5e-ag', 'open5e-2024'].includes(pack.id))).toBe(
    false
  );
  seeds.close();
}, 30000);
