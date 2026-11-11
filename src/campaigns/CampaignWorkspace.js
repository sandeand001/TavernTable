import CampaignStore from './CampaignStore.js';
import HostCampaignStore from './HostCampaignStore.js';
import CampaignCharacters, { validateCampaignCharacters } from './CampaignCharacters.js';
import { loadBundledResources } from '../resources/ResourceSeeds.js';
import { CompendiumCatalog } from '../entities/characters/CompendiumCatalog.js';
import { decodeScene } from './CampaignScene.js';

export default class CampaignWorkspace {
  static async load({
    fetch = globalThis.fetch,
    indexedDB = globalThis.indexedDB,
    crypto = globalThis.crypto,
    baseURL = globalThis.location.href,
    storage = 'host',
  } = {}) {
    if (!['host', 'browser'].includes(storage))
      throw new Error('Choose host or browser campaign storage');
    let host = null;
    if (storage === 'host') {
      const connection = await fetch(new URL('api/host', baseURL).href, { cache: 'no-store' });
      if (!connection.ok)
        throw new Error(
          'Durable campaign storage is unavailable. Start TavernTable with npm start, not a static file server.'
        );
      host = await connection.json();
      if (host.version !== 1 || host.storage !== 'host')
        throw new Error('The local host returned an unsupported storage configuration');
    }
    const { manifest, resources } = await loadBundledResources({
      fetch,
      indexedDB,
      crypto,
      baseURL,
    });
    const store = host
      ? new HostCampaignStore({ fetch, baseURL, host, packs: manifest.packs })
      : new CampaignStore({ indexedDB, packs: manifest.packs });
    const browserStore =
      host && indexedDB ? new CampaignStore({ indexedDB, packs: manifest.packs }) : null;
    return new CampaignWorkspace({ manifest, resources, store, browserStore });
  }

  constructor({ manifest, resources, store, browserStore = null }) {
    this.manifest = manifest;
    this.resources = resources;
    this.store = store;
    this.browserStore = browserStore;
    this.active = null;
  }

  list() {
    return this.store.list();
  }
  create(options) {
    return this.store.create(options);
  }
  update(id, changes) {
    return this.store.update(id, changes);
  }

  async open(id) {
    if (this.active) {
      await this.active.autosave?.flush();
      await this.active.library.flush();
    }
    const state = await this.store.readCharacters(id);
    const data = await this.resources.catalog(state.campaign);
    const latest = await this.store.get(id);
    if (
      latest.charactersRevision !== state.revision ||
      latest.sceneRevision !== state.sceneRevision
    ) {
      throw new Error('Campaign data changed while opening. Open it again before playing.');
    }
    const library = new CampaignCharacters({ ...state, store: this.store, catalog: data });
    const catalog = new CompendiumCatalog(data);
    const scene =
      state.scene === null ? null : decodeScene(state.scene, { ruleset: library.ruleset, library });
    this.active = { campaign: state.campaign, catalog, library, scene, workspace: this };
    return this.active;
  }

  async exportBackup(id) {
    if (this.active?.campaign.id === id) {
      await this.active.autosave?.flush();
      await this.active.library.flush();
    }
    return this.store.exportBackup(id);
  }

  async importBackup(text) {
    const data = this.store.parseBackup(text);
    const catalog = await this.resources.catalog(data.campaign);
    validateCampaignCharacters(data.campaign, catalog, data.records);
    if (data.scene !== null) {
      const library = new CampaignCharacters({
        store: this.store,
        catalog,
        campaign: data.campaign,
        records: data.records,
        revision: 0,
      });
      decodeScene(data.scene, { ruleset: library.ruleset, library });
    }
    return this.store.importBackup(text);
  }

  async backupNow(id) {
    if (this.active?.campaign.id === id) {
      await this.active.autosave?.flush();
      await this.active.library.flush();
    }
    return this.store.backupNow(id);
  }

  async restoreBackup(id, name) {
    return this.importBackup(await this.store.readBackup(id, name));
  }

  browserCampaigns() {
    return this.browserStore ? this.browserStore.list() : Promise.resolve([]);
  }

  async copyBrowserCampaign(id) {
    if (!this.browserStore) throw new Error('No browser campaign storage is connected');
    return this.importBackup(await this.browserStore.exportBackup(id));
  }

  close() {
    if (this.active?.library.isSaving)
      throw new Error('Finish saving character changes before closing the campaign');
    if (this.active?.autosave?.dirty || this.active?.autosave?.error)
      throw new Error('Finish saving the board before closing the campaign');
    this.active?.autosave?.dispose();
    this.resources.close();
    this.store.close();
    this.browserStore?.close();
  }
}
