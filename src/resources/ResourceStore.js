import { edition } from '../rules/editions.js';
import { openDatabase, requestResult, transact } from '../storage/indexedDB.js';
import { validateResourceClasses, validateResourceEntry } from './ResourceSchema.js';

export default class ResourceStore {
  constructor({ indexedDB = globalThis.indexedDB, ruleset, prefix = 'taverntable.resources' }) {
    const profile = edition(ruleset);
    Object.defineProperty(this, 'ruleset', { value: profile.id, enumerable: true });
    this.factory = indexedDB;
    this.name = `${prefix}.${profile.id}.v1`;
    this.database = null;
    this.opening = null;
    this.closed = false;
  }

  // -- Edition-local resource installation and lookup --
  async install(pack) {
    const ref = this._ref(pack);
    if (
      !/^[a-f0-9]{64}$/.test(pack.hash) ||
      !Array.isArray(pack.entries) ||
      new Set(pack.entries.map((entry) => entry?.id)).size !== pack.entries.length
    ) {
      throw new Error('The resource pack contains invalid or duplicate data');
    }
    validateResourceClasses(pack.classes);
    pack.entries.forEach((entry) => validateResourceEntry(entry, this.ruleset));
    const database = await this._database();
    return transact(database, ['packs', 'entries'], 'readwrite', async (transaction) => {
      const store = transaction.objectStore('packs');
      const existing = await requestResult(store.get(ref));
      if (existing) {
        if (existing.hash !== pack.hash)
          throw new Error('This resource version is already installed with different data');
        return existing;
      }
      const { entries, ...metadata } = pack;
      const stored = { ...metadata, ref, count: entries.length };
      store.add(stored);
      for (const entry of entries) {
        transaction.objectStore('entries').add({ packRef: ref, id: entry.id, entry });
      }
      return stored;
    });
  }

  async installed(source) {
    const ref = this._ref(source);
    const database = await this._database();
    return transact(database, ['packs'], 'readonly', (transaction) =>
      requestResult(transaction.objectStore('packs').get(ref))
    );
  }

  async pack(source) {
    const metadata = await this.installed(source);
    if (!metadata || metadata.ruleset !== this.ruleset)
      throw new Error('The required edition resource pack is not installed');
    return metadata;
  }

  async entries(source) {
    const ref = this._ref(source);
    await this.pack(source);
    const database = await this._database();
    const records = await transact(database, ['entries'], 'readonly', (transaction) =>
      requestResult(transaction.objectStore('entries').index('packRef').getAll(ref))
    );
    return records.map((record) => record.entry);
  }

  async entry(source, id) {
    const ref = this._ref(source);
    await this.pack(source);
    const database = await this._database();
    const record = await transact(database, ['entries'], 'readonly', (transaction) =>
      requestResult(transaction.objectStore('entries').get([ref, id]))
    );
    if (!record) throw new Error('The resource was not found in this edition and source');
    return record.entry;
  }

  async catalog(campaign) {
    if (
      !campaign ||
      campaign.ruleset !== this.ruleset ||
      !Array.isArray(campaign.sourcePacks) ||
      campaign.sourcePacks.some((source) => typeof source.enabled !== 'boolean') ||
      !campaign.sourcePacks.some(
        (source) => source.id === edition(this.ruleset).corePack && source.enabled
      )
    ) {
      throw new Error('The campaign does not belong to this resource database ruleset');
    }
    const loaded = await Promise.all(
      campaign.sourcePacks.map(async (source) => ({
        source,
        metadata: await this.pack(source),
        entries: await this.entries(source),
      }))
    );
    const entries = loaded.flatMap(({ source, entries: records }) =>
      records.map((entry) => ({ ...entry, sourcePack: source.id, sourceVersion: source.version }))
    );
    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      throw new Error('Resource packs contain overlapping identifiers; the catalog was not loaded');
    }
    const core = loaded.find(({ source }) => source.id === edition(this.ruleset).corePack);
    return {
      version: 1,
      ruleset: this.ruleset,
      entries,
      classes: core.metadata.classes,
      enabledEntryIds: loaded
        .filter(({ source }) => source.enabled)
        .flatMap(({ entries: records }) => records.map((entry) => entry.id)),
      packs: loaded.map(({ source, metadata }) => ({ ...metadata, enabled: source.enabled })),
      provenance: {
        attribution: loaded
          .map(({ metadata }) => metadata.provenance?.attribution)
          .filter(Boolean)
          .join('\n'),
        sources: loaded.map(({ metadata }) => metadata.provenance),
      },
    };
  }

  // -- Database lifecycle --
  async _database() {
    if (this.closed) throw new Error('The resource database is closed');
    if (this.database) return this.database;
    if (!this.opening) {
      this.opening = openDatabase(this.factory, this.name, (database) => {
        database.createObjectStore('packs', { keyPath: 'ref' });
        const entries = database.createObjectStore('entries', { keyPath: ['packRef', 'id'] });
        entries.createIndex('packRef', 'packRef');
      })
        .then((database) => {
          if (this.closed) {
            database.close();
            throw new Error('The resource database is closed');
          }
          this.database = database;
          database.onversionchange = () => this.close();
          return database;
        })
        .finally(() => {
          this.opening = null;
        });
    }
    return this.opening;
  }

  close() {
    this.closed = true;
    this.database?.close();
    this.database = null;
  }

  _ref(source) {
    if (
      !source ||
      source.ruleset !== this.ruleset ||
      typeof source.id !== 'string' ||
      !source.id ||
      typeof source.version !== 'string' ||
      !source.version
    ) {
      throw new Error('The resource does not belong to this database ruleset');
    }
    return `${source.id}@${source.version}`;
  }
}
