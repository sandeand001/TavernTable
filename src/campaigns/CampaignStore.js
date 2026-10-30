import { edition } from '../rules/editions.js';
import { openDatabase, requestResult, transact } from '../storage/indexedDB.js';

export default class CampaignStore {
  constructor({ indexedDB = globalThis.indexedDB, packs, name = 'taverntable.campaigns.v1' }) {
    if (!Array.isArray(packs) || new Set(packs.map((pack) => pack.id)).size !== packs.length) {
      throw new Error('The resource pack manifest is invalid or contains duplicates');
    }
    this.factory = indexedDB;
    this.packs = new Map(packs.map((pack) => [pack.id, pack]));
    this.name = name;
    this.database = null;
    this.opening = null;
    this.closed = false;
  }

  // -- Campaign records --
  async create({ name, ruleset, packIds = [] }) {
    const profile = edition(ruleset);
    this._name(name);
    const record = {
      version: 1,
      id: globalThis.crypto.randomUUID(),
      name: name.trim(),
      ruleset: profile.id,
      coreVersion: profile.srd,
      sourcePacks: this._sources(profile.id, packIds),
      charactersRevision: 0,
      createdAt: new Date().toISOString(),
    };
    this._validate(record);
    const database = await this._database();
    await transact(database, ['campaigns'], 'readwrite', (transaction) =>
      requestResult(transaction.objectStore('campaigns').add(record))
    );
    return this._public(record);
  }

  async get(id) {
    const database = await this._database();
    const record = await transact(database, ['campaigns'], 'readonly', (transaction) =>
      requestResult(transaction.objectStore('campaigns').get(id))
    );
    if (!record) throw new Error('The campaign was not found');
    this._validate(record);
    return this._public(record);
  }

  async list() {
    const database = await this._database();
    const records = await transact(database, ['campaigns'], 'readonly', (transaction) =>
      requestResult(transaction.objectStore('campaigns').getAll())
    );
    records.forEach((record) => this._validate(record));
    return records
      .map((record) => this._public(record))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  async update(id, updates) {
    if (!updates || typeof updates !== 'object' || Array.isArray(updates))
      throw new Error('Invalid campaign changes');
    if (Object.hasOwn(updates, 'ruleset') || Object.hasOwn(updates, 'coreVersion')) {
      throw new Error('A campaign ruleset is fixed at creation');
    }
    if (Object.keys(updates).some((key) => !['name', 'packIds'].includes(key)))
      throw new Error('Unsupported campaign changes');
    const database = await this._database();
    return transact(database, ['campaigns'], 'readwrite', async (transaction) => {
      const store = transaction.objectStore('campaigns');
      const record = await requestResult(store.get(id));
      if (!record) throw new Error('The campaign was not found');
      this._validate(record);
      if (updates.name !== undefined) {
        this._name(updates.name);
        record.name = updates.name.trim();
      }
      if (updates.packIds !== undefined) {
        record.sourcePacks = this._sources(record.ruleset, updates.packIds, record.sourcePacks);
        record.charactersRevision++;
      }
      this._validate(record);
      await requestResult(store.put(record));
      return this._public(record);
    });
  }

  // -- Atomic, campaign-owned character state --
  async readCharacters(id) {
    const database = await this._database();
    return transact(database, ['campaigns', 'characters'], 'readonly', async (transaction) => {
      const campaign = await requestResult(transaction.objectStore('campaigns').get(id));
      if (!campaign) throw new Error('The campaign was not found');
      this._validate(campaign);
      const rows = await requestResult(
        transaction.objectStore('characters').index('campaignId').getAll(id)
      );
      return {
        campaign: this._public(campaign),
        revision: campaign.charactersRevision,
        records: rows.map(({ key, value }) => ({ key, value })),
        scene: campaign.scene ?? null,
        sceneRevision: campaign.sceneRevision ?? 0,
        sceneSavedAt: campaign.sceneSavedAt ?? null,
      };
    });
  }

  async readScene(id) {
    const database = await this._database();
    return transact(database, ['campaigns'], 'readonly', async (transaction) => {
      const campaign = await requestResult(transaction.objectStore('campaigns').get(id));
      if (!campaign) throw new Error('The campaign was not found');
      this._validate(campaign);
      return {
        campaign: this._public(campaign),
        revision: campaign.sceneRevision ?? 0,
        charactersRevision: campaign.charactersRevision,
        scene: campaign.scene ?? null,
        savedAt: campaign.sceneSavedAt ?? null,
      };
    });
  }

  async commitScene(id, { ruleset, revision, charactersRevision, scene }) {
    edition(ruleset);
    this._sceneInput(revision, scene);
    if (!Number.isSafeInteger(charactersRevision) || charactersRevision < 0) {
      throw new Error('The scene change has an invalid character revision');
    }
    const database = await this._database();
    return transact(database, ['campaigns'], 'readwrite', async (transaction) => {
      const campaigns = transaction.objectStore('campaigns');
      const campaign = await requestResult(campaigns.get(id));
      if (!campaign) throw new Error('The campaign was not found');
      this._validate(campaign);
      if (campaign.ruleset !== ruleset)
        throw new Error('Scene data belongs to a different campaign ruleset');
      if (campaign.charactersRevision !== charactersRevision) {
        throw new Error(
          'Campaign character data changed in another window. Reopen the campaign before saving its board.'
        );
      }
      this._writeScene(campaign, revision, scene);
      await requestResult(campaigns.put(campaign));
      return { revision: campaign.sceneRevision, savedAt: campaign.sceneSavedAt };
    });
  }

  async commitCharacters(id, { ruleset, revision, records, scene }) {
    edition(ruleset);
    this._records(records);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('The character database change has invalid records or revision');
    }
    if (scene !== undefined) {
      if (!scene || typeof scene !== 'object') throw new Error('Invalid scene change');
      this._sceneInput(scene.revision, scene.value);
    }
    const database = await this._database();
    return transact(database, ['campaigns', 'characters'], 'readwrite', async (transaction) => {
      const campaigns = transaction.objectStore('campaigns');
      const campaign = await requestResult(campaigns.get(id));
      if (!campaign) throw new Error('The campaign was not found');
      this._validate(campaign);
      if (campaign.ruleset !== ruleset)
        throw new Error('Character data belongs to a different campaign ruleset');
      if (campaign.charactersRevision !== revision) {
        throw new Error(
          'Campaign data changed in another window. Reopen the campaign before saving.'
        );
      }
      if (scene !== undefined) this._writeScene(campaign, scene.revision, scene.value);
      const characters = transaction.objectStore('characters');
      const previous = await requestResult(characters.index('campaignId').getAll(id));
      for (const row of previous) characters.delete([id, row.key]);
      for (const row of records) characters.put({ campaignId: id, key: row.key, value: row.value });
      campaign.charactersRevision++;
      campaigns.put(campaign);
      return {
        revision: campaign.charactersRevision,
        sceneRevision: campaign.sceneRevision ?? 0,
        sceneSavedAt: campaign.sceneSavedAt ?? null,
      };
    });
  }

  // -- Portable campaign snapshots (resource databases remain bundled) --
  async exportBackup(id) {
    const { campaign, records, scene } = await this.readCharacters(id);
    return JSON.stringify(
      {
        format: 'taverntable-campaign',
        version: 2,
        campaign,
        records,
        scene,
      },
      null,
      2
    );
  }

  parseBackup(text) {
    if (typeof text !== 'string' || text.length > 32000000) {
      throw new Error('Choose a campaign JSON backup smaller than 32 MB');
    }
    const data = JSON.parse(text);
    if (data?.format !== 'taverntable-campaign' || ![1, 2].includes(data.version)) {
      throw new Error('Unsupported campaign backup format');
    }
    this._validate(data.campaign);
    this._records(data.records);
    const scene = data.version === 1 ? null : data.scene;
    if (scene !== null) this._sceneInput(0, scene);
    for (const source of data.campaign.sourcePacks) {
      if (this.packs.get(source.id)?.ruleset !== data.campaign.ruleset) {
        throw new Error('The backup requires an unavailable or incompatible source pack');
      }
    }
    return { ...data, scene };
  }

  async importBackup(text) {
    const data = this.parseBackup(text);
    const campaign = {
      ...data.campaign,
      id: globalThis.crypto.randomUUID(),
      charactersRevision: 0,
      createdAt: new Date().toISOString(),
    };
    delete campaign.sceneRevision;
    delete campaign.sceneSavedAt;
    if (data.scene !== null) this._writeScene(campaign, 0, data.scene);
    const database = await this._database();
    await transact(database, ['campaigns', 'characters'], 'readwrite', (transaction) => {
      transaction.objectStore('campaigns').add(campaign);
      for (const row of data.records) {
        transaction.objectStore('characters').add({ campaignId: campaign.id, ...row });
      }
    });
    return this._public(campaign);
  }

  // -- Database lifecycle --
  async _database() {
    if (this.closed) throw new Error('The campaign database is closed');
    if (this.database) return this.database;
    if (!this.opening) {
      this.opening = openDatabase(this.factory, this.name, (database) => {
        database.createObjectStore('campaigns', { keyPath: 'id' });
        const characters = database.createObjectStore('characters', {
          keyPath: ['campaignId', 'key'],
        });
        characters.createIndex('campaignId', 'campaignId');
      })
        .then((database) => {
          if (this.closed) {
            database.close();
            throw new Error('The campaign database is closed');
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

  // -- Immutable ruleset and source selection --
  _name(name) {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
      throw new Error('A campaign needs a name of 1 to 100 characters');
    }
  }

  _sources(ruleset, packIds, previous = []) {
    if (!Array.isArray(packIds) || new Set(packIds).size !== packIds.length)
      throw new Error('Choose unique resource packs');
    const core = edition(ruleset).corePack;
    const enabled = new Set([core, ...packIds]);
    for (const id of enabled) {
      const pack = this.packs.get(id);
      if (!pack || pack.ruleset !== ruleset || !pack.version)
        throw new Error('A resource pack does not belong to this campaign ruleset');
    }
    const sources = previous.map((pack) => ({ ...pack, enabled: enabled.has(pack.id) }));
    for (const id of enabled) {
      if (!sources.some((pack) => pack.id === id)) {
        const pack = this.packs.get(id);
        sources.push({ id, ruleset, version: pack.version, enabled: true });
      }
    }
    return sources;
  }

  _validate(record) {
    if (!record || record.version !== 1 || typeof record.id !== 'string' || !record.id)
      throw new Error('The saved campaign has an invalid format');
    this._name(record.name);
    const profile = edition(record.ruleset);
    if (
      record.coreVersion !== profile.srd ||
      !Array.isArray(record.sourcePacks) ||
      new Set(record.sourcePacks.map((pack) => pack?.id)).size !== record.sourcePacks.length ||
      record.sourcePacks.some(
        (pack) =>
          !pack ||
          typeof pack.id !== 'string' ||
          typeof pack.version !== 'string' ||
          !pack.version ||
          pack.ruleset !== profile.id ||
          typeof pack.enabled !== 'boolean'
      ) ||
      !record.sourcePacks.some((pack) => pack.id === profile.corePack && pack.enabled) ||
      !Number.isSafeInteger(record.charactersRevision) ||
      record.charactersRevision < 0
    ) {
      throw new Error('The saved campaign contains incompatible rules or sources');
    }
    if (Object.hasOwn(record, 'scene')) {
      if (
        !Number.isSafeInteger(record.sceneRevision) ||
        record.sceneRevision < 1 ||
        typeof record.sceneSavedAt !== 'string' ||
        !Number.isFinite(Date.parse(record.sceneSavedAt))
      ) {
        throw new Error('The saved campaign has invalid scene metadata');
      }
      this._sceneInput(record.sceneRevision, record.scene);
    }
  }

  _public(record) {
    const metadata = { ...record };
    delete metadata.scene;
    return {
      ...metadata,
      sceneRevision: record.sceneRevision ?? 0,
      sceneSavedAt: record.sceneSavedAt ?? null,
    };
  }

  _sceneInput(revision, scene) {
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      revision >= Number.MAX_SAFE_INTEGER ||
      typeof scene !== 'string' ||
      !scene.length ||
      scene.length > 16000000
    ) {
      throw new Error('The scene snapshot or revision is invalid or exceeds 16 MB');
    }
  }

  _writeScene(campaign, revision, scene) {
    if ((campaign.sceneRevision ?? 0) !== revision) {
      throw new Error('The campaign board changed in another window. Reopen it before saving.');
    }
    campaign.scene = scene;
    campaign.sceneRevision = revision + 1;
    campaign.sceneSavedAt = new Date().toISOString();
  }

  _records(records) {
    if (
      !Array.isArray(records) ||
      records.length > 10000 ||
      new Set(records.map((row) => row?.key)).size !== records.length ||
      records.some(
        (row) =>
          !row ||
          typeof row.key !== 'string' ||
          !row.key ||
          row.key.length > 300 ||
          typeof row.value !== 'string' ||
          row.value.length > 1000000
      )
    ) {
      throw new Error('The character database change has invalid records or revision');
    }
  }
}
