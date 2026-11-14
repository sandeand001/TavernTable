import { isCloudAccessScope, isCloudAssetReference, isCloudDigest } from './CloudProtocol.js';
import { validateCloudParticipantSnapshot } from './CloudParticipantProtocol.js';
import { openDatabase, requestResult, transact } from '../storage/indexedDB.js';
import { sha256 } from '../storage/sha256.js';

const NAME = 'taverntable.cloud.participants.v1';
const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024;
const failure = (code, message) => Object.assign(new Error(message), { code });

export default class CloudParticipantCache {
  constructor({
    uid,
    indexedDB = globalThis.indexedDB,
    cacheStorage = globalThis.caches,
    crypto = globalThis.crypto,
  }) {
    if (typeof uid !== 'string' || !uid || uid.length > 128)
      throw failure(
        'invalid-cache-account',
        'Private participant caching requires a current account UID.'
      );
    this.uid = uid;
    this.factory = indexedDB;
    this.crypto = crypto;
    this.cacheStorage = cacheStorage;
    this.closed = false;
    this.database = null;
    this.opening = null;
  }

  _active() {
    if (this.closed) throw failure('cache-closed', 'This private participant cache is closed.');
  }

  async _key(access, viewKey) {
    access = structuredClone(access);
    this._active();
    if (
      !isCloudAccessScope(access) ||
      access.role !== 'member' ||
      access.uid !== this.uid ||
      !isCloudDigest(viewKey)
    )
      throw failure(
        'invalid-cache-scope',
        "Choose this account's exact current member access and authorized view."
      );
    this.uidKey ??= sha256(new TextEncoder().encode(this.uid), this.crypto);
    const uidKey = await this.uidKey;
    this._active();
    return {
      id: JSON.stringify([
        1,
        uidKey,
        access.campaignId,
        access.seatId,
        access.accessGeneration,
        viewKey,
      ]),
      uidKey,
    };
  }

  async writeCheckpoint(snapshot, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    validateCloudParticipantSnapshot(snapshot, { cachedAssets });
    if (snapshot.state.publicScene.assetKey !== null && snapshot.state.publicScene.assets === null)
      snapshot.state.publicScene.assets = structuredClone(cachedAssets);
    validateCloudParticipantSnapshot(snapshot);
    const context = await this._key(snapshot.access, snapshot.viewKey);
    const payload = JSON.stringify(snapshot);
    const bytes = new TextEncoder().encode(payload);
    if (bytes.byteLength > MAX_CHECKPOINT_BYTES)
      throw failure(
        'cache-entry-too-large',
        'The authorized checkpoint exceeds the bounded private cache entry size.'
      );
    const digest = await sha256(bytes, this.crypto);
    const database = await this._database();
    this._active();
    return transact(database, ['checkpoints'], 'readwrite', async (transaction) => {
      const store = transaction.objectStore('checkpoints');
      const previous = await requestResult(store.get(context.id));
      if (previous?.version === 1 && previous.generation > snapshot.generation)
        return { stored: false, reason: 'stale-checkpoint' };
      await requestResult(
        store.put({
          ...context,
          version: 1,
          campaignId: snapshot.access.campaignId,
          seatId: snapshot.access.seatId,
          accessGeneration: snapshot.access.accessGeneration,
          viewKey: snapshot.viewKey,
          generation: snapshot.generation,
          bytes: bytes.byteLength,
          sha256: digest,
          payload,
        })
      );
      return { stored: true, generation: snapshot.generation };
    });
  }

  async deleteCheckpoint(access, viewKey) {
    const context = await this._key(access, viewKey);
    const database = await this._database();
    this._active();
    await transact(database, ['checkpoints'], 'readwrite', (transaction) =>
      requestResult(transaction.objectStore('checkpoints').delete(context.id))
    );
    this._active();
  }

  async readCheckpoint(access, viewKey) {
    access = structuredClone(access);
    const context = await this._key(access, viewKey);
    const database = await this._database();
    const row = await transact(database, ['checkpoints'], 'readonly', (transaction) =>
      requestResult(transaction.objectStore('checkpoints').get(context.id))
    );
    this._active();
    if (row === undefined) return null;
    if (
      row.version !== 1 ||
      row.id !== context.id ||
      row.uidKey !== context.uidKey ||
      row.campaignId !== access.campaignId ||
      row.seatId !== access.seatId ||
      row.accessGeneration !== access.accessGeneration ||
      row.viewKey !== viewKey ||
      typeof row.payload !== 'string' ||
      !Number.isSafeInteger(row.bytes) ||
      row.bytes <= 0 ||
      row.bytes > MAX_CHECKPOINT_BYTES ||
      !isCloudDigest(row.sha256)
    )
      throw failure('cache-corrupt', 'The private checkpoint cache could not be verified.');
    const bytes = new TextEncoder().encode(row.payload);
    if (bytes.byteLength !== row.bytes || (await sha256(bytes, this.crypto)) !== row.sha256)
      throw failure('cache-corrupt', 'The private checkpoint cache failed integrity verification.');
    this._active();
    let snapshot;
    try {
      snapshot = JSON.parse(row.payload);
      validateCloudParticipantSnapshot(snapshot);
    } catch (error) {
      if (error instanceof SyntaxError || error?.constructor === Error)
        throw failure(
          'cache-corrupt',
          'The private checkpoint cache contains invalid participant data.'
        );
      throw error;
    }
    const saved = await this._key(snapshot.access, snapshot.viewKey);
    if (saved.id !== context.id || snapshot.generation !== row.generation)
      throw failure('cache-corrupt', 'The private checkpoint cache belongs to a different view.');
    return snapshot;
  }

  async _asset(snapshot, reference, cachedAssets) {
    validateCloudParticipantSnapshot(snapshot, { cachedAssets });
    if (
      !isCloudAssetReference(reference, snapshot.access.campaignId) ||
      !snapshot.manifest.images.some((slot) =>
        Object.keys(reference).every((key) => slot.reference[key] === reference[key])
      )
    )
      throw failure(
        'invalid-cache-asset',
        'Choose an image reference in the current authorized view manifest.'
      );
    const context = await this._key(snapshot.access, snapshot.viewKey);
    if (!this.cacheStorage?.open)
      throw failure(
        'cache-unavailable',
        'Private binary Cache Storage is unavailable in this browser.'
      );
    const cache = await this.cacheStorage.open(NAME + '.assets');
    this._active();
    const path = [
      1,
      context.uidKey,
      snapshot.access.campaignId,
      snapshot.access.seatId,
      snapshot.access.accessGeneration,
      snapshot.viewKey,
      reference.sha256,
    ].join('/');
    return {
      cache,
      request: new Request('https://taverntable-cache.invalid/' + path, { credentials: 'omit' }),
    };
  }

  async writeAsset(snapshot, reference, input, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    reference = structuredClone(reference);
    let bytes;
    if (input instanceof ArrayBuffer) bytes = new Uint8Array(input.slice(0));
    else if (ArrayBuffer.isView(input))
      bytes = new Uint8Array(
        input.buffer.slice(input.byteOffset, input.byteOffset + input.byteLength)
      );
    else
      throw failure('invalid-cache-asset', 'Private cached asset bytes must be a binary buffer.');
    const { cache, request } = await this._asset(snapshot, reference, cachedAssets);
    if (
      bytes.byteLength !== reference.bytes ||
      (await sha256(bytes, this.crypto)) !== reference.sha256
    )
      throw failure(
        'cache-asset-integrity',
        'The private image bytes do not match their verified reference.'
      );
    this._active();
    await cache.put(
      request,
      new Response(bytes, {
        headers: {
          'Content-Type': reference.mimeType,
          'Content-Length': String(bytes.byteLength),
          'X-TavernTable-Cache-SHA256': reference.sha256,
        },
      })
    );
    this._active();
  }

  async readAsset(snapshot, reference, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    reference = structuredClone(reference);
    const { cache, request } = await this._asset(snapshot, reference, cachedAssets);
    const response = await cache.match(request);
    this._active();
    if (response === undefined) return null;
    if (
      response.headers.get('Content-Type') !== reference.mimeType ||
      response.headers.get('Content-Length') !== String(reference.bytes) ||
      response.headers.get('X-TavernTable-Cache-SHA256') !== reference.sha256
    )
      throw failure(
        'cache-asset-integrity',
        'The private cached image metadata could not be verified.'
      );
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (
      bytes.byteLength !== reference.bytes ||
      (await sha256(bytes, this.crypto)) !== reference.sha256
    )
      throw failure(
        'cache-asset-integrity',
        'The private cached image bytes failed integrity verification.'
      );
    this._active();
    return bytes;
  }

  async deleteAsset(snapshot, reference, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    reference = structuredClone(reference);
    const { cache, request } = await this._asset(snapshot, reference, cachedAssets);
    const removed = await cache.delete(request);
    this._active();
    return removed;
  }

  async _database() {
    this._active();
    if (this.database) return this.database;
    this.opening ??= openDatabase(this.factory, NAME, (database) => {
      const checkpoints = database.createObjectStore('checkpoints', { keyPath: 'id' });
      checkpoints.createIndex('uidKey', 'uidKey');
    })
      .then((database) => {
        if (this.closed) {
          database.close();
          this._active();
        }
        this.database = database;
        database.onversionchange = () => this.close();
        return database;
      })
      .finally(() => {
        this.opening = null;
      });
    return this.opening;
  }

  close() {
    this.closed = true;
    this.database?.close();
    this.database = null;
  }
}
