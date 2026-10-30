import { edition } from '../rules/editions.js';
import ResourceStore from './ResourceStore.js';

const reference = (source) => `${source.id}@${source.version}`;

export default class ResourceSeeds {
  constructor({
    manifest,
    indexedDB = globalThis.indexedDB,
    fetch = globalThis.fetch,
    crypto = globalThis.crypto,
    baseURL = globalThis.location.href,
    prefix = 'taverntable.resources',
  }) {
    if (
      manifest?.version !== 1 ||
      !Array.isArray(manifest.packs) ||
      new Set(manifest.packs.map(reference)).size !== manifest.packs.length
    ) {
      throw new Error('The bundled resource manifest is invalid');
    }
    this.manifest = manifest;
    this.sources = new Map(
      manifest.packs.map((source) => {
        edition(source.ruleset);
        if (
          !source.id ||
          !source.version ||
          !/^[a-f0-9]{64}$/.test(source.hash) ||
          !Number.isSafeInteger(source.bytes) ||
          source.bytes < 1 ||
          typeof source.file !== 'string'
        ) {
          throw new Error('The resource manifest has invalid version or integrity metadata');
        }
        const url = new URL(source.file, baseURL);
        if (url.origin !== new URL(baseURL).origin || !['http:', 'https:'].includes(url.protocol)) {
          throw new Error('Bundled resources must use same-origin files, not provider APIs');
        }
        return [reference(source), { ...source, url: url.href }];
      })
    );
    this.indexedDB = indexedDB;
    this.fetch = fetch;
    this.crypto = crypto;
    this.prefix = prefix;
    this.databases = new Map();
    this.loading = new Map();
    this.closed = false;
  }

  async catalog(campaign) {
    const profile = edition(campaign?.ruleset);
    if (
      !Array.isArray(campaign.sourcePacks) ||
      campaign.sourcePacks.some((source) => source?.ruleset !== profile.id)
    ) {
      throw new Error('The campaign sources belong to a different ruleset');
    }
    const store = this._store(profile.id);
    await Promise.all(campaign.sourcePacks.map((source) => this._ensure(store, source)));
    return store.catalog(campaign);
  }

  async _ensure(store, source) {
    const ref = reference(source);
    const seed = this.sources.get(ref);
    const existing = await store.installed(source);
    if (existing) {
      if (seed && existing.hash !== seed.hash) {
        throw new Error('The installed resource version has conflicting integrity metadata');
      }
      return existing;
    }
    if (!seed || seed.ruleset !== store.ruleset) {
      throw new Error(`The pinned resource version is unavailable: ${ref}`);
    }
    if (!this.loading.has(ref)) {
      const loading = this._install(store, seed).finally(() => this.loading.delete(ref));
      this.loading.set(ref, loading);
    }
    return this.loading.get(ref);
  }

  async _install(store, seed) {
    if (!this.crypto?.subtle) {
      throw new Error('Resource integrity verification requires localhost or HTTPS');
    }
    const fetch = this.fetch;
    const response = await fetch(seed.url, { cache: 'no-cache' });
    if (!response.ok)
      throw new Error(`Bundled resource download failed (${response.status}): ${seed.id}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== seed.bytes)
      throw new Error(`Resource integrity check failed: ${seed.id}`);
    const digest = await this.crypto.subtle.digest('SHA-256', bytes);
    const hash = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
    if (hash !== seed.hash) throw new Error(`Resource integrity check failed: ${seed.id}`);
    const pack = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (
      pack.id !== seed.id ||
      pack.ruleset !== seed.ruleset ||
      pack.version !== seed.version ||
      (seed.count !== undefined && pack.entries?.length !== seed.count)
    ) {
      throw new Error('The bundled resource identity or count does not match its manifest');
    }
    return store.install({ ...pack, hash });
  }

  _store(ruleset) {
    if (this.closed) throw new Error('The resource seed loader is closed');
    if (!this.databases.has(ruleset)) {
      this.databases.set(
        ruleset,
        new ResourceStore({
          indexedDB: this.indexedDB,
          ruleset,
          prefix: this.prefix,
        })
      );
    }
    return this.databases.get(ruleset);
  }

  close() {
    this.closed = true;
    for (const store of this.databases.values()) store.close();
  }
}
