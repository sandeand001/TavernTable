const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { isCampaignBackupName } = require('./campaign-backups.js');
const { parseArgs } = require('node:util');

function byteSummary(values) {
  return {
    count: values.length,
    bytes: values.reduce((total, value) => total + value, 0),
    maxBytes: values.reduce((maximum, value) => Math.max(maximum, value), 0),
    atOrAboveFirestoreDocumentLimit: values.filter((value) => value >= 1024 * 1024).length,
  };
}

function parseSavedJSON(value, label) {
  try {
    return JSON.parse(value);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`The inventory source ${label} contains invalid saved JSON`);
  }
}

async function measureBackups(directory) {
  const folder = path.join(directory, 'backups');
  let campaigns;
  try {
    campaigns = await fs.readdir(folder, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return { folderPresent: false, ...byteSummary([]) };
    throw error;
  }
  const sizes = [];
  for (const campaign of campaigns) {
    if (campaign.isSymbolicLink())
      throw new Error('Backup inventory cannot follow directory links');
    if (!campaign.isDirectory()) continue;
    const location = path.join(folder, campaign.name);
    for (const file of await fs.readdir(location, { withFileTypes: true })) {
      if (!isCampaignBackupName(file.name)) continue;
      if (!file.isFile()) throw new Error('An inventoried backup is not a regular file');
      sizes.push((await fs.stat(path.join(location, file.name))).size);
    }
  }
  return { folderPresent: true, ...byteSummary(sizes) };
}

async function measureLocalSource({ label, directory }) {
  const database = new DatabaseSync(path.join(directory, 'campaigns.sqlite'), { readOnly: true });
  try {
    database.exec('PRAGMA query_only = ON; BEGIN');
    const sizes = { campaigns: [], metadata: [], scenes: [], characters: [] };
    const imageSizes = [];
    const imageHashes = new Map();
    let decodedBytes = 0;
    const inspectImages = (root) => {
      const pending = [root];
      while (pending.length) {
        const value = pending.pop();
        if (typeof value === 'string' && value.startsWith('data:image/')) {
          const image = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
          if (!image || image[1].length % 4 !== 0)
            throw new Error(`The inventory source ${label} has invalid embedded image data`);
          const bytes = Buffer.from(image[1], 'base64');
          imageSizes.push(Buffer.byteLength(value));
          decodedBytes += bytes.byteLength;
          imageHashes.set(createHash('sha256').update(bytes).digest('hex'), bytes.byteLength);
        } else if (value && typeof value === 'object') {
          for (const child of Object.values(value)) pending.push(child);
        }
      }
    };
    for (const { value } of database.prepare('SELECT value FROM campaigns ORDER BY id').iterate()) {
      const campaign = parseSavedJSON(value, label);
      if (!campaign || typeof campaign !== 'object' || Array.isArray(campaign))
        throw new Error(`The inventory source ${label} has invalid campaign metadata`);
      const { scene, ...metadata } = campaign;
      if (scene !== undefined && scene !== null && typeof scene !== 'string')
        throw new Error(`The inventory source ${label} has invalid scene storage`);
      sizes.campaigns.push(Buffer.byteLength(value));
      sizes.metadata.push(Buffer.byteLength(JSON.stringify(metadata)));
      inspectImages(metadata);
      if (typeof scene === 'string') {
        sizes.scenes.push(Buffer.byteLength(scene));
        inspectImages(parseSavedJSON(scene, label));
      }
    }
    for (const { value } of database.prepare('SELECT value FROM characters').iterate()) {
      sizes.characters.push(Buffer.byteLength(value));
      inspectImages(parseSavedJSON(value, label));
    }
    database.exec('COMMIT');
    return {
      label,
      ...Object.fromEntries(
        Object.entries(sizes).map(([name, values]) => [name, byteSummary(values)])
      ),
      images: {
        ...byteSummary(imageSizes),
        decodedBytes,
        uniqueDecodedBytes: [...imageHashes.values()].reduce((total, bytes) => total + bytes, 0),
      },
      backups: await measureBackups(directory),
    };
  } finally {
    database.close();
  }
}

async function collectMigrationInventory({ root, sources = [] }) {
  if (
    !Array.isArray(sources) ||
    sources.some(
      (source) =>
        !source ||
        typeof source.label !== 'string' ||
        !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(source.label) ||
        typeof source.directory !== 'string' ||
        !source.directory
    ) ||
    new Set(sources.map((source) => source.label)).size !== sources.length
  )
    throw new Error('Inventory sources need unique non-secret labels and explicit directories');
  const directory = await fs.realpath(root);
  const tracked = execFileSync('git', ['-C', directory, 'ls-files', '-z', '--', 'assets'], {
    encoding: 'utf8',
    windowsHide: true,
  })
    .split('\0')
    .filter(Boolean)
    .sort();
  const files = [];
  for (const relative of tracked) {
    const filename = await fs.realpath(path.join(directory, ...relative.split('/')));
    const contained = path.relative(directory, filename);
    if (contained === '..' || contained.startsWith(`..${path.sep}`) || path.isAbsolute(contained))
      throw new Error('An inventoried asset resolves outside the repository');
    const before = await fs.stat(filename);
    if (!before.isFile()) throw new Error('An inventoried asset is not a regular file');
    const hash = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(filename)) {
      bytes += chunk.length;
      hash.update(chunk);
    }
    const after = await fs.stat(filename);
    if (bytes !== before.size || before.size !== after.size || before.mtimeMs !== after.mtimeMs)
      throw new Error('An asset changed during inventory; repeat with a stable source');
    files.push({ path: relative, bytes, sha256: hash.digest('hex') });
  }
  const byPath = new Map(files.map((file) => [file.path, file]));
  const manifestPath = 'assets/data/resources/manifest.json';
  let catalogs = null;
  if (byPath.has(manifestPath)) {
    const manifest = JSON.parse(
      await fs.readFile(path.join(directory, ...manifestPath.split('/')), 'utf8')
    );
    if (manifest.version !== 1 || !Array.isArray(manifest.packs))
      throw new Error('The resource inventory manifest is invalid');
    const references = new Set();
    catalogs = {
      manifest: manifestPath,
      packs: manifest.packs.map((pack) => {
        if (
          !pack ||
          typeof pack.id !== 'string' ||
          typeof pack.version !== 'string' ||
          !['2014', '2024'].includes(pack.ruleset) ||
          !Array.isArray(pack.licenses) ||
          pack.licenses.some((license) => typeof license !== 'string') ||
          references.has(`${pack.id}@${pack.version}`)
        )
          throw new Error('The resource inventory metadata is invalid or duplicated');
        references.add(`${pack.id}@${pack.version}`);
        const file = byPath.get(pack.file);
        if (!file || file.bytes !== pack.bytes || file.sha256 !== pack.hash)
          throw new Error(`Resource integrity mismatch in inventory: ${pack.id}`);
        return {
          id: pack.id,
          ruleset: pack.ruleset,
          version: pack.version,
          file: file.path,
          bytes: file.bytes,
          sha256: file.sha256,
          declaredLicenses: [...pack.licenses],
        };
      }),
    };
  }
  return {
    version: 1,
    assets: { files, bytes: files.reduce((total, file) => total + file.bytes, 0) },
    catalogs,
    sources: await Promise.all(sources.map(measureLocalSource)),
  };
}

module.exports = { collectMigrationInventory };

if (require.main === module) {
  const run = async () => {
    const { values } = parseArgs({
      options: {
        root: { type: 'string', default: path.resolve(__dirname, '..') },
        source: { type: 'string', multiple: true, default: [] },
      },
    });
    const sources = values.source.map((source) => {
      const separator = source.indexOf('=');
      const label = source.slice(0, separator);
      const directory = source.slice(separator + 1);
      if (separator < 1 || !path.isAbsolute(directory))
        throw new Error(
          'Use --source label=absolute-data-directory for each explicit local source'
        );
      return { label, directory };
    });
    const report = await collectMigrationInventory({ root: values.root, sources });
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  };
  run().catch((error) => {
    console.error('[migration-inventory]', error.message);
    process.exitCode = 1;
  });
}
