import { CharacterLibrary } from '../entities/characters/CharacterLibrary.js';
import { edition } from '../rules/editions.js';

class SnapshotStorage {
  constructor(records) {
    this.records = new Map(records.map(({ key, value }) => [key, value]));
  }

  get length() {
    return this.records.size;
  }
  key(index) {
    return [...this.records.keys()][index] ?? null;
  }
  getItem(key) {
    return this.records.get(key) ?? null;
  }
  setItem(key, value) {
    this.records.set(key, String(value));
  }
  removeItem(key) {
    this.records.delete(key);
  }
  snapshot() {
    return [...this.records].map(([key, value]) => ({ key, value }));
  }
}

function characterSnapshot(campaign, catalog, records) {
  if (!catalog || catalog.ruleset !== campaign.ruleset) {
    throw new Error('The character catalog belongs to a different campaign ruleset');
  }
  const engine = new CharacterLibrary({
    catalog: catalog.entries,
    classes: catalog.classes,
    ruleset: campaign.ruleset,
    enabledEntryIds: catalog.enabledEntryIds,
    storage: new SnapshotStorage(records),
  });
  const ids = new Set(engine.list().map((character) => character.id));
  for (const { key } of records) {
    const match = /^taverntable\.character(?:-rest|-actions|-layout)?\.v1\.(.+)$/.exec(key);
    if (!match || !ids.has(match[1])) {
      throw new Error('Campaign character data contains unknown or orphaned records');
    }
  }
  for (const id of ids) {
    engine.rest.snapshot(id);
    engine.actions.snapshot(id);
    engine.layouts.snapshot(id);
  }
  return engine;
}

export function validateCampaignCharacters(campaign, catalog, records) {
  characterSnapshot(campaign, catalog, records);
}

export default class CampaignCharacters {
  static async open({ store, campaignId, catalog }) {
    const state = await store.readCharacters(campaignId);
    return new CampaignCharacters({ store, catalog, ...state });
  }

  constructor({
    store,
    catalog,
    campaign,
    revision,
    records,
    scene = null,
    sceneRevision = 0,
    sceneSavedAt = null,
  }) {
    this.store = store;
    this.campaign = campaign;
    this.sourceCatalog = catalog;
    this.engine = characterSnapshot(campaign, catalog, records);
    this.revision = revision;
    this.queue = Promise.resolve();
    this.pendingWrites = 0;
    this.failure = null;
    this.savedScene = scene;
    this.sceneRevision = sceneRevision;
    this.sceneSavedAt = sceneSavedAt;
    this.pendingScenes = 0;
    this.sceneProvider = null;
    Object.defineProperty(this, 'ruleset', { value: campaign.ruleset, enumerable: true });
    this.rest = this._companion(
      'rest',
      ['status', 'snapshot'],
      [
        'shortRest',
        'longRest',
        'spendHitDie',
        'setResourceRemaining',
        'recoverSpellSlots',
        'resetDaily',
      ]
    );
    this.actions = this._companion(
      'actions',
      ['list', 'snapshot', 'resourceRows', 'key'],
      ['upsert', 'remove', 'setRemaining', 'setAttackCount', 'consume', 'undo']
    );
    this.layouts = this._companion(
      'layouts',
      ['page', 'snapshot', 'key'],
      ['savePage', 'resetPage']
    );
  }

  get catalog() {
    return this.engine.catalog;
  }
  get classes() {
    return this.engine.classes;
  }
  get rules() {
    return this.engine.rules;
  }
  get isSaving() {
    return this.pendingWrites > 0;
  }
  list() {
    return this.engine.list();
  }
  get(id) {
    return this.engine.get(id);
  }
  stats(id) {
    return this.engine.stats(id);
  }
  spell(...args) {
    return this.engine.spell(...args);
  }

  create(name, { linkTokenId, fallTraits, conditions } = {}) {
    return this._mutate((engine) => engine.create(name, { fallTraits, conditions }), {
      type: 'create',
      linkTokenId,
    });
  }
  replace(id, name) {
    return this._mutate((engine) => engine.replace(id, name), { type: 'replace', oldId: id });
  }
  edit(...args) {
    return this._mutate((engine) => engine.edit(...args));
  }
  delete(id) {
    return this._mutate((engine) => engine.delete(id), { type: 'delete', oldId: id });
  }
  adjustHitPoints(...args) {
    return this._mutate((engine) => engine.adjustHitPoints(...args));
  }
  applyFall(...args) {
    return this._mutate((engine) => engine.applyFall(...args));
  }
  add(...args) {
    return this._mutate((engine) => engine.add(...args));
  }
  prepare(...args) {
    return this._mutate((engine) => engine.prepare(...args));
  }
  setSlotUsed(...args) {
    return this._mutate((engine) => engine.setSlotUsed(...args));
  }
  cast(...args) {
    return this._mutate((engine) => engine.cast(...args));
  }
  longRest(...args) {
    return this.rest.longRest(...args);
  }
  endConcentration(...args) {
    return this._mutate((engine) => engine.endConcentration(...args));
  }
  equip(...args) {
    return this._mutate((engine) => engine.equip(...args));
  }
  attune(...args) {
    return this._mutate((engine) => engine.attune(...args));
  }
  setItem(...args) {
    return this._mutate((engine) => engine.setItem(...args));
  }
  remove(...args) {
    return this._mutate((engine) => engine.remove(...args));
  }

  export(id) {
    const data = JSON.parse(this.engine.export(id));
    const sources = new Set([edition(this.ruleset).corePack]);
    for (const owned of [...data.character.equipment, ...data.character.spells]) {
      const source = this.catalog.get(owned.entryId).sourcePack;
      if (!source) throw new Error('Owned content is missing its pinned source');
      sources.add(source);
    }
    return JSON.stringify(
      {
        ...data,
        version: 5,
        ruleset: this.ruleset,
        coreVersion: this.campaign.coreVersion,
        sourcePacks: this.campaign.sourcePacks
          .filter((source) => sources.has(source.id))
          .map(({ id: sourceId, ruleset, version }) => ({ id: sourceId, ruleset, version })),
      },
      null,
      2
    );
  }

  async import(text, { linkTokenId } = {}) {
    if (typeof text !== 'string' || text.length > 1000000) {
      throw new Error('Choose a character JSON backup smaller than 1 MB');
    }
    const data = JSON.parse(text);
    if (data?.format !== 'taverntable-character' || data.version !== 5) {
      throw new Error('A character import needs an explicit campaign ruleset (backup version 5)');
    }
    if (data.ruleset !== this.ruleset || data.coreVersion !== this.campaign.coreVersion) {
      throw new Error('This character belongs to a different campaign ruleset or SRD version');
    }
    if (
      !data.character ||
      !data.rest ||
      !data.actions ||
      !data.layout ||
      !Array.isArray(data.sourcePacks) ||
      !data.sourcePacks.some((source) => source?.id === edition(this.ruleset).corePack)
    ) {
      throw new Error('The character backup is missing its data or pinned sources');
    }
    for (const source of data.sourcePacks) {
      if (
        !source ||
        source.ruleset !== this.ruleset ||
        !this.campaign.sourcePacks.some(
          (pin) => pin.id === source.id && pin.version === source.version
        )
      ) {
        throw new Error(
          "Enable this character's compatible source packs and versions before importing"
        );
      }
    }
    return this._mutate(
      (engine) => {
        const character = { ...data.character, id: globalThis.crypto.randomUUID() };
        engine.rest.restore(character, data.rest, data.character.id, data.actions, data.layout);
        return character.id;
      },
      { type: 'import', linkTokenId }
    );
  }

  async flush() {
    const pending = this.isSaving || this.pendingScenes > 0;
    let queue;
    do {
      queue = this.queue;
      await queue;
    } while (queue !== this.queue);
    if (pending && this.failure) throw this.failure;
  }

  bindScene(provider) {
    if (this.sceneProvider && this.sceneProvider !== provider)
      throw new Error('This campaign already has a scene save coordinator');
    this.sceneProvider = provider;
  }

  withCombatSnapshot(factory, operation) {
    if (!this.sceneProvider) return operation();
    const previous = this.combatSnapshotFactory;
    this.combatSnapshotFactory = factory;
    try {
      return operation();
    } finally {
      this.combatSnapshotFactory = previous;
    }
  }

  saveScene(capture) {
    this.pendingScenes++;
    const committed = this.queue.then(async () => {
      const captured = await capture(this.engine);
      if (captured.value === this.savedScene) {
        const current = await this.store.readScene(this.campaign.id);
        if (
          current.revision !== this.sceneRevision ||
          current.charactersRevision !== this.revision
        ) {
          throw new Error(
            'Campaign data changed in another window. Reopen the campaign before saving.'
          );
        }
        return { captured, receipt: { revision: this.sceneRevision, savedAt: this.sceneSavedAt } };
      }
      const receipt = await this.store.commitScene(this.campaign.id, {
        ruleset: this.ruleset,
        revision: this.sceneRevision,
        charactersRevision: this.revision,
        scene: captured.value,
      });
      this._sceneReceipt(captured, receipt.revision, receipt.savedAt);
      return { captured, receipt };
    });
    this.queue = committed.then(
      () => {
        this.pendingScenes--;
        this.failure = null;
      },
      (error) => {
        this.pendingScenes--;
        this.failure = error;
      }
    );
    return committed;
  }

  _sceneReceipt(captured, revision, savedAt) {
    this.savedScene = captured.value;
    this.sceneRevision = revision;
    this.sceneSavedAt = savedAt;
    this.campaign = { ...this.campaign, sceneRevision: revision, sceneSavedAt: savedAt };
  }

  _companion(name, reads, writes) {
    return Object.fromEntries([
      ...reads.map((method) => [method, (...args) => this.engine[name][method](...args)]),
      ...writes.map((method) => [
        method,
        (...args) => this._mutate((engine) => engine[name][method](...args)),
      ]),
    ]);
  }

  _mutate(operation, change = null) {
    const combatFactory = this.combatSnapshotFactory;
    this.pendingWrites++;
    this.sceneProvider?.saving?.();
    const committed = this.queue.then(async () => {
      const next = characterSnapshot(
        this.campaign,
        this.sourceCatalog,
        this.engine.storage.snapshot()
      );
      const result = operation(next);
      const captured = await this.sceneProvider?.capture(next, {
        change,
        result,
        combat: combatFactory?.(next),
      });
      const receipt = await this.store.commitCharacters(this.campaign.id, {
        ruleset: this.ruleset,
        revision: this.revision,
        records: next.storage.snapshot(),
        ...(captured ? { scene: { revision: this.sceneRevision, value: captured.value } } : {}),
      });
      this.engine = next;
      this.revision = receipt.revision;
      this.campaign = { ...this.campaign, charactersRevision: receipt.revision };
      if (captured) {
        this._sceneReceipt(captured, receipt.sceneRevision, receipt.sceneSavedAt);
        this.sceneProvider.committed?.(captured, { change, result });
        this.sceneProvider.saved?.(captured);
      }
      this.failure = null;
      return result;
    });
    this.queue = committed.then(
      () => {
        this.pendingWrites--;
        this.sceneProvider?.settled?.();
      },
      (error) => {
        this.pendingWrites--;
        this.failure = error;
        this.sceneProvider?.settled?.();
      }
    );
    return committed;
  }
}
