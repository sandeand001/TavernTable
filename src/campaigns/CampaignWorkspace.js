import CampaignStore from './CampaignStore.js';
import CampaignCharacters, { validateCampaignCharacters } from './CampaignCharacters.js';
import ResourceSeeds from '../resources/ResourceSeeds.js';
import { CompendiumCatalog } from '../entities/characters/CompendiumCatalog.js';
import { decodeScene } from './CampaignScene.js';

export default class CampaignWorkspace {
  static async load({
    fetch = globalThis.fetch,
    indexedDB = globalThis.indexedDB,
    crypto = globalThis.crypto,
    baseURL = globalThis.location.href,
  } = {}) {
    const response = await fetch(new URL('assets/data/resources/manifest.json', baseURL).href, {
      cache: 'no-cache',
    });
    if (!response.ok)
      throw new Error(`The bundled resource manifest could not load (${response.status})`);
    const manifest = await response.json();
    const resources = new ResourceSeeds({ manifest, fetch, indexedDB, crypto, baseURL });
    const store = new CampaignStore({ indexedDB, packs: manifest.packs });
    return new CampaignWorkspace({ manifest, resources, store });
  }

  constructor({ manifest, resources, store }) {
    this.manifest = manifest;
    this.resources = resources;
    this.store = store;
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

  close() {
    if (this.active?.library.isSaving)
      throw new Error('Finish saving character changes before closing the campaign');
    if (this.active?.autosave?.dirty || this.active?.autosave?.error)
      throw new Error('Finish saving the board before closing the campaign');
    this.active?.autosave?.dispose();
    this.resources.close();
    this.store.close();
  }
}
