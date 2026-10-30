import fs from 'node:fs/promises';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { sceneState } from '../../helpers/sceneState.js';
import { encodeScene } from '../../../src/campaigns/CampaignScene.js';

globalThis.TextDecoder ??= TextDecoder;
const root = path.resolve(__dirname, '..', '..', '..');

test('campaign workspaces reopen their edition and roundtrip validated boards with complete character state', async () => {
  const fetch = async (input) => {
    const url = new URL(input, window.location.href);
    expect(url.origin).toBe(window.location.origin);
    const bytes = await fs.readFile(path.join(root, ...url.pathname.split('/').filter(Boolean)));
    return {
      ok: true,
      json: async () => JSON.parse(bytes.toString('utf8')),
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  const workspace = await CampaignWorkspace.load({
    fetch,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const classic = await workspace.create({ name: 'Classic', ruleset: '2014' });
  const revised = await workspace.create({ name: 'Revised', ruleset: '2024' });
  const first = await workspace.open(classic.id);
  const id = await first.library.create('Owned');
  await first.library.layouts.savePage(id, 'combat', {
    sectionOrder: ['favorites'],
    cardOrder: {},
    favorites: ['attack:unarmed'],
  });
  const scene = sceneState({ characterId: id, name: 'Owned' });
  await first.library.saveScene(() => ({
    value: encodeScene(scene, { ruleset: '2014', library: first.library }),
  }));
  const other = await workspace.open(revised.id);
  expect(other.library.list()).toEqual([]);
  expect(other.catalog.ruleset).toBe('2024');
  await expect(other.library.import(first.library.export(id))).rejects.toThrow('ruleset');
  const backup = await workspace.exportBackup(classic.id);
  const data = JSON.parse(backup);
  expect(data.version).toBe(2);
  expect(JSON.parse(data.scene)).toEqual(scene);
  expect(data).not.toHaveProperty('catalog');
  const copy = await workspace.importBackup(backup);
  const restored = await workspace.open(copy.id);
  expect(restored.library.get(id).name).toBe('Owned');
  expect(restored.library.layouts.page(id, 'combat').favorites).toEqual(['attack:unarmed']);
  expect(restored.scene).toEqual(scene);
  const malformed = JSON.parse(backup);
  malformed.scene = JSON.stringify({ ...scene, camera: { ...scene.camera, zoom: 'broken' } });
  const before = (await workspace.list()).length;
  await expect(workspace.importBackup(JSON.stringify(malformed))).rejects.toThrow('camera');
  expect((await workspace.list()).length).toBe(before);
  workspace.close();
}, 30000);

test('disabling a source preserves owned spell instances and Favorites but blocks new domain additions', async () => {
  const workspace = await CampaignWorkspace.load({
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await workspace.create({
    name: 'Source pins',
    ruleset: '2014',
    packIds: ['deepm'],
  });
  const first = await workspace.open(campaign.id);
  const id = await first.library.create('Reader');
  const spell = first.catalog
    .search('', { kind: 'spell' })
    .find((entry) => entry.sourcePack === 'deepm');
  const owned = await first.library.add(id, spell.id);
  await first.library.layouts.savePage(id, 'combat', {
    sectionOrder: ['favorites'],
    cardOrder: {},
    favorites: [`spell:${owned}`],
  });
  await workspace.update(campaign.id, { packIds: [] });
  const reopened = await workspace.open(campaign.id);
  expect(reopened.library.get(id).spells[0].id).toBe(owned);
  expect(reopened.library.layouts.page(id, 'combat').favorites).toEqual([`spell:${owned}`]);
  expect(
    reopened.catalog.search(spell.name, { kind: 'spell' }).some((entry) => entry.id === spell.id)
  ).toBe(false);
  expect(reopened.catalog.get(spell.id).sourceVersion).toBe(spell.sourceVersion);
  await expect(reopened.library.add(id, spell.id)).rejects.toThrow('Enable');
  workspace.close();
}, 30000);
