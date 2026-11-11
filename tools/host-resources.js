const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');

class HostResources {
  constructor({ root, manifest }) {
    this.root = root;
    this.manifest = manifest;
    this.packs = new Map();
    this.catalogs = new Map();
  }

  async _pack(source) {
    const key = `${source.id}@${source.version}`;
    if (this.packs.has(key)) return this.packs.get(key);
    const seed = this.manifest.packs.find(
      (entry) =>
        entry.id === source.id &&
        entry.version === source.version &&
        entry.ruleset === source.ruleset
    );
    if (!seed) throw new Error('The campaign requires an unavailable pinned resource pack');
    const filename = path.resolve(this.root, seed.file);
    const relative = path.relative(this.root, filename);
    if (relative.startsWith('..' + path.sep) || path.isAbsolute(relative))
      throw new Error('Bundled resources must remain inside the application');
    const bytes = await fs.readFile(filename);
    if (
      bytes.length !== seed.bytes ||
      createHash('sha256').update(bytes).digest('hex') !== seed.hash
    )
      throw new Error('A bundled resource pack failed its integrity check');
    const pack = JSON.parse(bytes.toString('utf8'));
    if (pack.id !== source.id || pack.ruleset !== source.ruleset || pack.version !== source.version)
      throw new Error('A bundled resource pack has the wrong identity');
    const schema = await import(
      pathToFileURL(path.join(this.root, 'src', 'resources', 'ResourceSchema.js')).href
    );
    schema.validateResourceClasses(pack.classes);
    if (
      !Array.isArray(pack.entries) ||
      new Set(pack.entries.map((entry) => entry?.id)).size !== pack.entries.length
    )
      throw new Error('A bundled resource pack has invalid or duplicate entries');
    for (const entry of pack.entries) schema.validateResourceEntry(entry, source.ruleset);
    const { entries, ...metadata } = pack;
    const value = {
      metadata: { ...metadata, hash: seed.hash, ref: key, count: entries.length },
      entries,
    };
    this.packs.set(key, value);
    return value;
  }

  async catalog(campaign) {
    const key = JSON.stringify([campaign.ruleset, campaign.sourcePacks]);
    if (this.catalogs.has(key)) return this.catalogs.get(key);
    const loaded = await Promise.all(
      campaign.sourcePacks.map(async (source) => ({
        source,
        ...(await this._pack(source)),
      }))
    );
    const { createResourceCatalog } = await import(
      pathToFileURL(path.join(this.root, 'src', 'resources', 'ResourceStore.js')).href
    );
    const catalog = createResourceCatalog(campaign.ruleset, loaded);
    if (this.catalogs.size >= 16) this.catalogs.delete(this.catalogs.keys().next().value);
    this.catalogs.set(key, catalog);
    return catalog;
  }
}

module.exports = { HostResources };
