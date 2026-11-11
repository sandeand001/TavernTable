import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { collectMigrationInventory } from '../../../tools/migration-inventory.js';

let root;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-inventory-'));
  execFileSync('git', ['init', '--quiet', root], { windowsHide: true });
  await fs.mkdir(path.join(root, 'assets', 'data'), { recursive: true });
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

test('the inventory measures tracked UTF-8 and binary assets exactly without including untracked files', async () => {
  const json = Buffer.from(JSON.stringify({ name: 'caf\u00e9' }));
  const binary = Buffer.from([0, 255, 17, 0]);
  await fs.writeFile(path.join(root, 'assets', 'data', 'example.json'), json);
  await fs.writeFile(path.join(root, 'assets', 'model.glb'), binary);
  execFileSync('git', ['-C', root, 'add', '--', 'assets'], { windowsHide: true });
  await fs.writeFile(path.join(root, 'assets', 'untracked-private.txt'), 'DO NOT INVENTORY');
  const inventory = await collectMigrationInventory({ root });
  expect(inventory.assets.bytes).toBe(json.byteLength + binary.byteLength);
  expect(inventory.assets.files).toEqual([
    {
      path: 'assets/data/example.json',
      bytes: json.byteLength,
      sha256: createHash('sha256').update(json).digest('hex'),
    },
    {
      path: 'assets/model.glb',
      bytes: binary.byteLength,
      sha256: createHash('sha256').update(binary).digest('hex'),
    },
  ]);
  expect(JSON.stringify(inventory)).not.toContain('untracked-private');
  expect(await fs.readFile(path.join(root, 'assets', 'data', 'example.json'))).toEqual(json);
});

test('pinned resource metadata reports declared licenses and rejects a same-size catalog integrity mismatch', async () => {
  const folder = path.join(root, 'assets', 'data', 'resources');
  await fs.mkdir(folder);
  const pack = JSON.stringify({ id: 'fixture', ruleset: '2014', version: '1', entries: [] });
  const metadata = {
    id: 'fixture',
    ruleset: '2014',
    version: '1',
    file: 'assets/data/resources/fixture.json',
    bytes: Buffer.byteLength(pack),
    hash: createHash('sha256').update(pack).digest('hex'),
    licenses: ['cc-by-40'],
  };
  await fs.writeFile(path.join(folder, 'fixture.json'), pack);
  await fs.writeFile(
    path.join(folder, 'manifest.json'),
    JSON.stringify({ version: 1, packs: [metadata] })
  );
  execFileSync('git', ['-C', root, 'add', '--', 'assets'], { windowsHide: true });
  const inventory = await collectMigrationInventory({ root });
  expect(inventory.catalogs.packs).toEqual([
    {
      id: metadata.id,
      ruleset: metadata.ruleset,
      version: metadata.version,
      file: metadata.file,
      bytes: metadata.bytes,
      sha256: metadata.hash,
      declaredLicenses: metadata.licenses,
    },
  ]);
  await fs.writeFile(
    path.join(folder, 'fixture.json'),
    pack.replace('"version":"1"', '"version":"2"')
  );
  await expect(collectMigrationInventory({ root })).rejects.toThrow(/integrity/i);
});

test('local source measurements preserve database/key bytes and expose only labeled aggregate sizes', async () => {
  const directory = path.join(root, 'local-data');
  await fs.mkdir(directory);
  const filename = path.join(directory, 'campaigns.sqlite');
  const scene = JSON.stringify({ version: 3, privateNote: 'SCENE SECRET caf\u00e9' });
  const metadata = { id: 'private-id', name: 'PRIVATE CAMPAIGN NAME', ruleset: '2014' };
  const record = JSON.stringify({ ...metadata, scene });
  const character = JSON.stringify({ name: 'PRIVATE CHARACTER NAME' });
  const database = new DatabaseSync(filename);
  database.exec(
    'CREATE TABLE campaigns (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE characters (campaign_id TEXT, key TEXT, value TEXT NOT NULL);'
  );
  database.prepare('INSERT INTO campaigns VALUES (?, ?)').run(metadata.id, record);
  database
    .prepare('INSERT INTO characters VALUES (?, ?, ?)')
    .run(metadata.id, 'private-record-key', character);
  database.close();
  await fs.writeFile(path.join(directory, 'host-access-key'), 'PRIVATE KEY SENTINEL');
  const before = await fs.readFile(filename);
  const inventory = await collectMigrationInventory({
    root,
    sources: [{ label: 'source-a', directory }],
  });
  expect(inventory.sources).toHaveLength(1);
  expect(inventory.sources[0]).toMatchObject({
    label: 'source-a',
    campaigns: { count: 1, bytes: Buffer.byteLength(record) },
    metadata: { count: 1, bytes: Buffer.byteLength(JSON.stringify(metadata)) },
    scenes: { count: 1, bytes: Buffer.byteLength(scene) },
    characters: { count: 1, bytes: Buffer.byteLength(character) },
  });
  const text = JSON.stringify(inventory);
  for (const secret of ['PRIVATE', 'SCENE SECRET', 'private-id', 'private-record-key', directory])
    expect(text).not.toContain(JSON.stringify(secret).slice(1, -1));
  expect(await fs.readFile(filename)).toEqual(before);
  expect(await fs.readFile(path.join(directory, 'host-access-key'), 'utf8')).toBe(
    'PRIVATE KEY SENTINEL'
  );
});

test('image and document-limit measurements use actual bytes without exposing private image bodies or hashes', async () => {
  const directory = path.join(root, 'image-data');
  await fs.mkdir(directory);
  const image = Buffer.from([137, 80, 78, 71]);
  const uri = `data:image/png;base64,${image.toString('base64')}`;
  const character = JSON.stringify({
    portraitImage: uri,
    artworkImage: uri,
    notes: '\u00e9'.repeat(530000),
  });
  expect(character.length).toBeLessThan(1024 * 1024);
  const database = new DatabaseSync(path.join(directory, 'campaigns.sqlite'));
  database.exec(
    'CREATE TABLE campaigns (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE characters (campaign_id TEXT, key TEXT, value TEXT NOT NULL);'
  );
  database
    .prepare('INSERT INTO campaigns VALUES (?, ?)')
    .run('private-id', JSON.stringify({ scene: null }));
  database
    .prepare('INSERT INTO characters VALUES (?, ?, ?)')
    .run('private-id', 'private-key', character);
  database.close();
  const inventory = await collectMigrationInventory({
    root,
    sources: [{ label: 'source-a', directory }],
  });
  expect(inventory.sources[0].characters.atOrAboveFirestoreDocumentLimit).toBe(1);
  expect(inventory.sources[0].images).toMatchObject({
    count: 2,
    bytes: Buffer.byteLength(uri) * 2,
    decodedBytes: image.byteLength * 2,
    uniqueDecodedBytes: image.byteLength,
  });
  expect(JSON.stringify(inventory)).not.toContain(uri);
  expect(JSON.stringify(inventory)).not.toContain(createHash('sha256').update(image).digest('hex'));
});

test('backup inventory counts committed JSON files by bytes without reading staging files or exposing names', async () => {
  const directory = path.join(root, 'backup-data');
  await fs.mkdir(directory);
  const database = new DatabaseSync(path.join(directory, 'campaigns.sqlite'));
  database.exec(
    'CREATE TABLE campaigns (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE characters (campaign_id TEXT, key TEXT, value TEXT NOT NULL);'
  );
  database.close();
  const folder = path.join(directory, 'backups', 'private-campaign');
  await fs.mkdir(folder, { recursive: true });
  const backup = JSON.stringify({ name: 'PRIVATE BACKUP caf\u00e9' });
  const name = 'backup-2026-11-10T00-00-00Z-0123abcd.json';
  await fs.writeFile(path.join(folder, name), backup);
  await fs.writeFile(path.join(folder, '.pending.tmp'), 'not a committed backup');
  const inventory = await collectMigrationInventory({
    root,
    sources: [{ label: 'source-a', directory }],
  });
  expect(inventory.sources[0].backups).toMatchObject({
    count: 1,
    bytes: Buffer.byteLength(backup),
    maxBytes: Buffer.byteLength(backup),
  });
  for (const secret of ['PRIVATE BACKUP', 'private-campaign', name])
    expect(JSON.stringify(inventory)).not.toContain(secret);
});

test('the inventory command accepts explicit labeled sources and emits a versioned privacy-safe JSON report', async () => {
  const asset = Buffer.from('caf\u00e9');
  await fs.writeFile(path.join(root, 'assets', 'data', 'example.txt'), asset);
  execFileSync('git', ['-C', root, 'add', '--', 'assets'], { windowsHide: true });
  const directory = path.join(root, 'command-data');
  await fs.mkdir(directory);
  const database = new DatabaseSync(path.join(directory, 'campaigns.sqlite'));
  database.exec(
    'CREATE TABLE campaigns (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE characters (campaign_id TEXT, key TEXT, value TEXT NOT NULL);'
  );
  database.close();
  await fs.writeFile(path.join(directory, 'host-access-key'), 'PRIVATE COMMAND KEY');
  const command = path.resolve(__dirname, '..', '..', '..', 'tools', 'migration-inventory.js');
  const report = JSON.parse(
    execFileSync(process.execPath, [command, '--root', root, '--source', `source-a=${directory}`], {
      encoding: 'utf8',
      windowsHide: true,
    })
  );
  expect(report.version).toBe(1);
  expect(report.assets.bytes).toBe(asset.byteLength);
  expect(report.sources.map(({ label }) => label)).toEqual(['source-a']);
  expect(JSON.stringify(report)).not.toContain('PRIVATE COMMAND KEY');
  expect(JSON.stringify(report)).not.toContain(JSON.stringify(directory).slice(1, -1));
});

test('non-string source labels are rejected before attempting to open a local database', async () => {
  for (const label of [undefined, null, 123]) {
    await expect(
      collectMigrationInventory({
        root,
        sources: [{ label, directory: root }],
      })
    ).rejects.toThrow('Inventory sources need unique non-secret labels and explicit directories');
  }
});
