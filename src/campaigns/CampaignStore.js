import { edition } from '../rules/editions.js';
import { CHARACTER_BACKUP_LIMIT } from '../config/characters/CharacterImages.js';
import IndexedDBCampaignStorage from './IndexedDBCampaignStorage.js';

const revisionConflict = (campaign, message) =>
  Object.assign(new Error(message), {
    status: 409,
    code: 'stale-revision',
    current: {
      sceneRevision: campaign.sceneRevision ?? 0,
      charactersRevision: campaign.charactersRevision,
    },
  });

export default class CampaignStore {
  constructor({
    indexedDB = globalThis.indexedDB,
    packs,
    name = 'taverntable.campaigns.v1',
    storage = null,
  }) {
    if (!Array.isArray(packs) || new Set(packs.map((pack) => pack.id)).size !== packs.length) {
      throw new Error('The resource pack manifest is invalid or contains duplicates');
    }
    this.packs = new Map(packs.map((pack) => [pack.id, pack]));
    this.storage = storage || new IndexedDBCampaignStorage(indexedDB, name);
    this.storageInfo = { kind: 'browser' };
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
    await this._transaction('readwrite', (transaction) => transaction.writeCampaign(record, true));
    return this._public(record);
  }

  async get(id) {
    const record = await this._transaction('readonly', (transaction) =>
      transaction.getCampaign(id)
    );
    if (!record) throw new Error('The campaign was not found');
    this._validate(record);
    return this._public(record);
  }

  async list() {
    const records = await this._transaction('readonly', (transaction) =>
      transaction.listCampaigns()
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
    return this._transaction('readwrite', async (transaction) => {
      const record = await transaction.getCampaign(id);
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
      await transaction.writeCampaign(record);
      return this._public(record);
    });
  }

  // -- Atomic, campaign-owned character state --
  async readCharacters(id) {
    return this._transaction('readonly', async (transaction) => {
      const campaign = await transaction.getCampaign(id);
      if (!campaign) throw new Error('The campaign was not found');
      this._validate(campaign);
      const rows = await transaction.readCharacters(id);
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
    return this._transaction('readonly', async (transaction) => {
      const campaign = await transaction.getCampaign(id);
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
    return this._transaction('readwrite', async (transaction) => {
      const campaign = await transaction.getCampaign(id);
      if (!campaign) throw new Error('The campaign was not found');
      this._validate(campaign);
      if (campaign.ruleset !== ruleset)
        throw new Error('Scene data belongs to a different campaign ruleset');
      if (campaign.charactersRevision !== charactersRevision) {
        throw revisionConflict(
          campaign,
          'Campaign character data changed in another window. Reopen the campaign before saving its board.'
        );
      }
      this._writeScene(campaign, revision, scene);
      await transaction.writeCampaign(campaign);
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
    return this._transaction('readwrite', async (transaction) => {
      const campaign = await transaction.getCampaign(id);
      if (!campaign) throw new Error('The campaign was not found');
      this._validate(campaign);
      if (campaign.ruleset !== ruleset)
        throw new Error('Character data belongs to a different campaign ruleset');
      if (campaign.charactersRevision !== revision) {
        throw revisionConflict(
          campaign,
          'Campaign data changed in another window. Reopen the campaign before saving.'
        );
      }
      if (scene !== undefined) this._writeScene(campaign, scene.revision, scene.value);
      await transaction.replaceCharacters(id, records);
      campaign.charactersRevision++;
      await transaction.writeCampaign(campaign);
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
    await this._transaction('readwrite', async (transaction) => {
      await transaction.writeCampaign(campaign, true);
      await transaction.replaceCharacters(campaign.id, data.records);
    });
    return this._public(campaign);
  }

  // -- Database lifecycle --
  async _transaction(mode, operation) {
    if (this.closed) throw new Error('The campaign database is closed');
    return this.storage.transaction(mode, operation);
  }

  close() {
    this.closed = true;
    return this.storage.close();
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
      throw revisionConflict(
        campaign,
        'The campaign board changed in another window. Reopen it before saving.'
      );
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
          row.value.length >
            (row.key.startsWith('taverntable.character.v1.') ? CHARACTER_BACKUP_LIMIT : 1000000)
      )
    ) {
      throw new Error('The character database change has invalid records or revision');
    }
  }
}
