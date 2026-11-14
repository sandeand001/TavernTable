import {
  isCloudAccessScope,
  isCloudAssetReference,
  isCloudDigest,
  isCloudUUID,
} from './CloudProtocol.js';
import { validateCloudParticipantSnapshot } from './CloudParticipantProtocol.js';
import { openDatabase, requestResult, transact } from '../storage/indexedDB.js';
import { sha256 } from '../storage/sha256.js';

const NAME = 'taverntable.cloud.participants.v1';
const PIN_LOCK_PREFIX = NAME + '.pin.';
const DATABASE_VERSION = 2;
const DEFAULT_BUDGET_BYTES = 256 * 1024 * 1024;
const MAX_CHECKPOINT_BYTES = 32 * 1024 * 1024;
export const CLOUD_PARTICIPANT_CACHE_RECOVERABLE_CODES = Object.freeze([
  'cache-unavailable',
  'cache-storage-failed',
  'cache-storage-denied',
  'cache-quota-exceeded',
  'cache-corrupt',
  'cache-asset-integrity',
  'cache-entry-too-large',
  'cache-budget-exceeded',
  'cache-closed',
  'cache-invalidated',
  'cache-persistence-failed',
]);

export class CloudParticipantCacheError extends Error {
  constructor(code, message, { cause } = {}) {
    super(message, { cause });
    this.name = 'CloudParticipantCacheError';
    this.code = code;
    this.recoverable = CLOUD_PARTICIPANT_CACHE_RECOVERABLE_CODES.includes(code);
  }
}

const failure = (code, message) => new CloudParticipantCacheError(code, message);
const isBudget = (value) => Number.isSafeInteger(value) && value >= 0;
const coordinators = new WeakMap();

function coordinator(factory, uid) {
  const create = () => ({
    pending: Promise.resolve(),
    pins: new Map(),
    clock: 0,
    reconciled: false,
    epoch: 0,
    campaignEpochs: new Map(),
    tickets: new Set(),
  });
  if (!factory || typeof factory.open !== 'function') return create();
  if (!coordinators.has(factory)) coordinators.set(factory, new Map());
  const accounts = coordinators.get(factory);
  if (!accounts.has(uid)) accounts.set(uid, create());
  return accounts.get(uid);
}

export default class CloudParticipantCache {
  constructor({
    uid,
    indexedDB = globalThis.indexedDB,
    cacheStorage = globalThis.caches,
    crypto = globalThis.crypto,
    storage = globalThis.navigator?.storage,
    locks = globalThis.navigator?.locks,
    logger = globalThis.console,
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
    this.storage = storage;
    this.locks = locks;
    this.nativeLocks = typeof locks?.request === 'function' && typeof locks?.query === 'function';
    this.logger = logger;
    this.coordinator = coordinator(indexedDB, uid);
    this.protections = new Set();
    this.accountEpoch = null;
    this.campaignEpochs = new Map();
    this.closed = false;
    this.database = null;
    this.opening = null;
  }

  get available() {
    return (
      !this.closed &&
      typeof this.factory?.open === 'function' &&
      typeof this.crypto?.subtle?.digest === 'function'
    );
  }

  _active() {
    if (this.closed) throw failure('cache-closed', 'This private participant cache is closed.');
  }

  async _uidKey() {
    this._active();
    if (typeof this.crypto?.subtle?.digest !== 'function')
      throw failure('cache-unavailable', 'Private cache verification requires localhost or HTTPS.');
    this.uidKey ??= this._hash(new TextEncoder().encode(this.uid));
    const uidKey = await this.uidKey;
    this._active();
    return uidKey;
  }

  _scope(access, viewKey) {
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
    return JSON.stringify([access.campaignId, access.seatId, access.accessGeneration, viewKey]);
  }

  async _key(access, viewKey) {
    access = structuredClone(access);
    this._scope(access, viewKey);
    const uidKey = await this._uidKey();
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

  _account(row, uidKey) {
    if (row === undefined)
      return { version: 1, uidKey, budgetBytes: DEFAULT_BUDGET_BYTES, epoch: 0 };
    if (
      row.version !== 1 ||
      row.uidKey !== uidKey ||
      !isBudget(row.budgetBytes) ||
      !isBudget(row.epoch) ||
      (row.campaignEpochs !== undefined &&
        (!row.campaignEpochs ||
          typeof row.campaignEpochs !== 'object' ||
          Array.isArray(row.campaignEpochs) ||
          Object.entries(row.campaignEpochs).some(
            ([id, epoch]) => !isCloudUUID(id) || !isBudget(epoch)
          )))
    )
      throw failure('cache-corrupt', 'The private cache budget preference is invalid.');
    return row;
  }

  _ticket(kind, access, viewKey, digest = null) {
    const scope = this._scope(access, viewKey);
    const ticket = {
      key: kind + ':' + scope + (kind === 'asset' ? '/' + digest : ''),
      campaignId: access.campaignId,
      epoch: this.coordinator.epoch,
      campaignEpoch: this.coordinator.campaignEpochs.get(access.campaignId) ?? 0,
      invalidated: false,
    };
    this.coordinator.tickets.add(ticket);
    return ticket;
  }

  _assert(
    ticket,
    databaseEpoch = ticket.databaseEpoch,
    databaseCampaignEpoch = ticket.databaseCampaignEpoch
  ) {
    this._active();
    if (
      ticket.invalidated ||
      ticket.epoch !== this.coordinator.epoch ||
      ticket.campaignEpoch !== (this.coordinator.campaignEpochs.get(ticket.campaignId) ?? 0) ||
      ticket.databaseEpoch !== databaseEpoch ||
      ticket.databaseCampaignEpoch !== databaseCampaignEpoch
    )
      throw failure('cache-invalidated', 'This private cache operation predates an invalidation.');
  }

  _invalidate(key) {
    for (const ticket of this.coordinator.tickets)
      if (ticket.key === key) ticket.invalidated = true;
  }

  async _capture(ticket, { uidKey }) {
    const database = await this._database();
    const row = await this._storage(() =>
      transact(database, ['accounts'], 'readonly', (transaction) =>
        requestResult(transaction.objectStore('accounts').get(uidKey))
      )
    );
    this._assert(ticket);
    const account = this._account(row, uidKey);
    const campaignEpoch = account.campaignEpochs?.[ticket.campaignId] ?? 0;
    if (
      (this.accountEpoch !== null && this.accountEpoch !== account.epoch) ||
      (this.campaignEpochs.has(ticket.campaignId) &&
        this.campaignEpochs.get(ticket.campaignId) !== campaignEpoch)
    )
      throw failure(
        'cache-invalidated',
        'Reopen the current online view after this private cache scope was invalidated.'
      );
    this.accountEpoch = account.epoch;
    this.campaignEpochs.set(ticket.campaignId, campaignEpoch);
    ticket.databaseEpoch = account.epoch;
    ticket.databaseCampaignEpoch = campaignEpoch;
    return database;
  }

  async _verifyEpoch(transaction, ticket, uidKey) {
    const row = await requestResult(transaction.objectStore('accounts').get(uidKey));
    const account = this._account(row, uidKey);
    this._assert(ticket, account.epoch, account.campaignEpochs?.[ticket.campaignId] ?? 0);
  }

  _serialize(operation) {
    const run = () => {
      this._active();
      return operation();
    };
    if (this.nativeLocks)
      return this._storage(() =>
        this.locks.request(
          NAME + '.account.' + JSON.stringify(this.uid),
          { mode: 'exclusive' },
          run
        )
      );
    const pending = this.coordinator.pending.then(run, run);
    this.coordinator.pending = pending;
    return pending;
  }

  async _storage(operation) {
    try {
      return await operation();
    } catch (cause) {
      if (cause instanceof CloudParticipantCacheError) throw cause;
      const error = new CloudParticipantCacheError(
        cause?.name === 'QuotaExceededError'
          ? 'cache-quota-exceeded'
          : ['SecurityError', 'NotAllowedError'].includes(cause?.name)
            ? 'cache-storage-denied'
            : 'cache-storage-failed',
        'Private browser cache storage could not complete the operation.',
        { cause }
      );
      this.logger?.warn?.(error.message, error);
      throw error;
    }
  }

  _hash(bytes) {
    return this._storage(() => sha256(bytes, this.crypto));
  }

  _stamp() {
    this.coordinator.clock = Math.max(Date.now(), this.coordinator.clock + 1);
    return this.coordinator.clock;
  }

  _prefix(uidKey) {
    return 'https://taverntable-cache.invalid/1/' + uidKey + '/';
  }

  _assetContext(request, uidKey) {
    const url = new URL(request.url);
    const [version, key, campaignId, seatId, generation, viewKey, digest] = url.pathname
      .slice(1)
      .split('/');
    const access = {
      version: 1,
      uid: this.uid,
      campaignId,
      role: 'member',
      seatId,
      accessGeneration: Number(generation),
    };
    if (
      url.origin !== 'https://taverntable-cache.invalid' ||
      url.search ||
      url.hash ||
      version !== '1' ||
      key !== uidKey ||
      String(access.accessGeneration) !== generation ||
      !isCloudAccessScope(access) ||
      !isCloudDigest(viewKey) ||
      !isCloudDigest(digest) ||
      request.url !==
        this._prefix(uidKey) + [campaignId, seatId, generation, viewKey, digest].join('/')
    )
      throw failure('cache-corrupt', 'A private cached image has an invalid partition key.');
    return {
      id: request.url,
      uidKey,
      viewId: JSON.stringify([1, uidKey, campaignId, seatId, access.accessGeneration, viewKey]),
      scope: this._scope(access, viewKey),
      digest,
    };
  }

  _assetEntry(row, uidKey, epoch) {
    if (
      row.version !== 1 ||
      row.uidKey !== uidKey ||
      typeof row.id !== 'string' ||
      !row.id.startsWith(this._prefix(uidKey)) ||
      !isBudget(row.bytes) ||
      !isBudget(row.lastUsed) ||
      row.epoch !== epoch
    )
      throw failure('cache-corrupt', 'The private image cache size or recency is invalid.');
    const context = this._assetContext(new Request(row.id), uidKey);
    if (context.viewId !== row.viewId)
      throw failure('cache-corrupt', 'The private image metadata belongs to a different view.');
    return { ...row, kind: 'asset', key: 'asset:' + context.scope + '/' + context.digest };
  }

  _assetEpoch(response) {
    const epoch = response.headers.get('X-TavernTable-Cache-Epoch');
    if (epoch === null) return 0;
    if (!isBudget(Number(epoch)) || String(Number(epoch)) !== epoch)
      throw failure('cache-corrupt', 'The private image invalidation epoch is invalid.');
    return Number(epoch);
  }

  async _remotePins() {
    if (!this.nativeLocks) return new Set();
    const state = await this._storage(() => this.locks.query());
    if (!Array.isArray(state?.held))
      throw failure('cache-unavailable', 'Browser private cache lock inspection is unavailable.');
    return new Set(
      state.held
        .filter(
          (lock) =>
            lock?.mode === 'shared' &&
            typeof lock.name === 'string' &&
            lock.name.startsWith(PIN_LOCK_PREFIX)
        )
        .map((lock) => lock.name.slice(PIN_LOCK_PREFIX.length))
    );
  }

  async _inventory(reconcile = false) {
    const uidKey = await this._uidKey();
    const database = await this._database();
    const [saved, checkpoints, savedAssets] = await this._storage(() =>
      transact(database, ['accounts', 'checkpoints', 'assets'], 'readonly', (transaction) =>
        Promise.all([
          requestResult(transaction.objectStore('accounts').get(uidKey)),
          requestResult(transaction.objectStore('checkpoints').index('uidKey').getAll(uidKey)),
          requestResult(transaction.objectStore('assets').index('uidKey').getAll(uidKey)),
        ])
      )
    );
    const account = this._account(saved, uidKey);
    const entries = [];
    for (const row of checkpoints) {
      if (
        row.version !== 1 ||
        row.uidKey !== uidKey ||
        typeof row.payload !== 'string' ||
        !Number.isSafeInteger(row.bytes) ||
        row.bytes <= 0 ||
        row.bytes > MAX_CHECKPOINT_BYTES ||
        (row.lastUsed !== undefined && !isBudget(row.lastUsed)) ||
        row.id !==
          JSON.stringify([
            1,
            uidKey,
            row.campaignId,
            row.seatId,
            row.accessGeneration,
            row.viewKey,
          ]) ||
        ((reconcile || !this.coordinator.reconciled) &&
          new TextEncoder().encode(row.payload).byteLength !== row.bytes)
      )
        throw failure('cache-corrupt', 'The private checkpoint cache size is invalid.');
      entries.push({
        kind: 'checkpoint',
        id: row.id,
        uidKey,
        viewId: row.id,
        bytes: row.bytes,
        lastUsed: row.lastUsed ?? 0,
        row,
        key:
          'checkpoint:' +
          JSON.stringify([row.campaignId, row.seatId, row.accessGeneration, row.viewKey]),
      });
    }
    const assetStorageAvailable = typeof this.cacheStorage?.open === 'function';
    if (!assetStorageAvailable && savedAssets.length)
      throw failure('cache-unavailable', 'Private binary cache accounting is unavailable.');
    let cache = null;
    let assets = savedAssets;
    for (const row of savedAssets) this._assetEntry(row, uidKey, account.epoch);
    if (assetStorageAvailable) {
      cache = await this._storage(() => this.cacheStorage.open(NAME + '.assets'));
      if (reconcile || !this.coordinator.reconciled) {
        if (typeof cache.keys !== 'function' || typeof cache.match !== 'function')
          throw failure('cache-unavailable', 'Private binary cache enumeration is unavailable.');
        const previous = new Map(savedAssets.map((row) => [row.id, row]));
        assets = [];
        for (const request of await this._storage(() => cache.keys())) {
          if (!request.url.startsWith(this._prefix(uidKey))) continue;
          const context = this._assetContext(request, uidKey);
          const response = await this._storage(() => cache.match(request));
          if (response === undefined) continue;
          if (this._assetEpoch(response) !== account.epoch) {
            await this._storage(() => cache.delete(request));
            continue;
          }
          assets.push({
            ...context,
            version: 1,
            bytes: (await this._storage(() => response.blob())).size,
            lastUsed: previous.get(context.id)?.lastUsed ?? 0,
            epoch: account.epoch,
          });
        }
        await this._storage(() =>
          transact(database, ['accounts', 'assets'], 'readwrite', async (transaction) => {
            const current = this._account(
              await requestResult(transaction.objectStore('accounts').get(uidKey)),
              uidKey
            );
            if (current.epoch !== account.epoch)
              throw failure('cache-invalidated', 'Private cache accounting predates a clear.');
            const store = transaction.objectStore('assets');
            for (const row of savedAssets) await requestResult(store.delete(row.id));
            for (const row of assets) await requestResult(store.put(row));
          })
        );
      }
    }
    for (const row of assets) entries.push(this._assetEntry(row, uidKey, account.epoch));
    this._active();
    for (const entry of entries)
      this.coordinator.clock = Math.max(this.coordinator.clock, entry.lastUsed);
    this.coordinator.reconciled = true;
    return {
      account,
      entries,
      database,
      cache,
      assetStorageAvailable,
      protectedKeys: await this._remotePins(),
    };
  }

  _protected(entry, protectedKeys = null) {
    const { pins } = this.coordinator;
    return Boolean(
      pins.has('view:' + entry.viewId) ||
        pins.has(entry.kind + ':' + entry.id) ||
        protectedKeys?.has('view:' + entry.viewId) ||
        protectedKeys?.has(entry.kind + ':' + entry.id)
    );
  }

  _usage({ account, entries, assetStorageAvailable, protectedKeys }) {
    let checkpointBytes = 0;
    let assetBytes = 0;
    let checkpointCount = 0;
    let assetCount = 0;
    let protectedBytes = 0;
    for (const entry of entries) {
      if (entry.kind === 'checkpoint') {
        checkpointBytes += entry.bytes;
        checkpointCount++;
      } else {
        assetBytes += entry.bytes;
        assetCount++;
      }
      if (this._protected(entry, protectedKeys)) protectedBytes += entry.bytes;
    }
    const usedBytes = checkpointBytes + assetBytes;
    if (!isBudget(usedBytes))
      throw failure('cache-corrupt', 'The private cache usage exceeds safe byte accounting.');
    return {
      bytes: usedBytes,
      limitBytes: account.budgetBytes,
      budgetBytes: account.budgetBytes,
      usedBytes,
      checkpointBytes,
      assetBytes,
      checkpointCount,
      assetCount,
      protectedBytes,
      assetStorageAvailable,
      crossTabCoordinated: this.nativeLocks,
      overBudget: usedBytes > account.budgetBytes,
    };
  }

  async _evict(inventory, incoming = null) {
    const previous = incoming
      ? inventory.entries.find((entry) => entry.kind === incoming.kind && entry.id === incoming.id)
      : null;
    let needed =
      this._usage(inventory).usedBytes +
      (incoming?.bytes ?? 0) -
      (previous?.bytes ?? 0) -
      inventory.account.budgetBytes;
    const candidates = inventory.entries
      .filter(
        (entry) =>
          !this._protected(entry, inventory.protectedKeys) &&
          !(incoming && entry.kind === incoming.kind && entry.id === incoming.id)
      )
      .sort((a, b) => a.lastUsed - b.lastUsed || a.id.localeCompare(b.id));
    if (incoming && candidates.reduce((sum, entry) => sum + entry.bytes, 0) < needed) return null;
    const removed = [];
    for (const entry of candidates) {
      if (needed <= 0) break;
      removed.push(entry);
      needed -= entry.bytes;
    }
    const epoch = this.coordinator.epoch;
    if (removed.length) this.coordinator.reconciled = false;
    for (const entry of removed) {
      this._active();
      this._invalidate(entry.key);
      if (entry.kind === 'asset')
        await this._storage(() => inventory.cache.delete(new Request(entry.id)));
    }
    if (removed.length)
      await this._storage(() =>
        transact(
          inventory.database,
          ['accounts', 'checkpoints', 'assets'],
          'readwrite',
          async (transaction) => {
            const current = this._account(
              await requestResult(
                transaction.objectStore('accounts').get(inventory.account.uidKey)
              ),
              inventory.account.uidKey
            );
            if (current.epoch !== inventory.account.epoch)
              throw failure('cache-invalidated', 'Private cache eviction predates a clear.');
            for (const entry of removed)
              await requestResult(
                transaction
                  .objectStore(entry.kind === 'checkpoint' ? 'checkpoints' : 'assets')
                  .delete(entry.id)
              );
          }
        )
      );
    inventory.entries = inventory.entries.filter((entry) => !removed.includes(entry));
    if (epoch === this.coordinator.epoch) this.coordinator.reconciled = true;
    return {
      evictedEntries: removed.length,
      evictedBytes: removed.reduce((sum, entry) => sum + entry.bytes, 0),
    };
  }

  async getUsage() {
    return this._serialize(async () => {
      const inventory = await this._inventory(true);
      await this._evict(inventory);
      return this._usage(inventory);
    });
  }

  async setBudget(budgetBytes) {
    this._active();
    if (!isBudget(budgetBytes))
      throw failure(
        'invalid-cache-budget',
        'Choose a nonnegative safe integer private cache budget in bytes.'
      );
    return this._serialize(async () => {
      const inventory = await this._inventory(true);
      inventory.account = { ...inventory.account, budgetBytes };
      await this._storage(() =>
        transact(inventory.database, ['accounts'], 'readwrite', async (transaction) => {
          const accounts = transaction.objectStore('accounts');
          const current = this._account(
            await requestResult(accounts.get(inventory.account.uidKey)),
            inventory.account.uidKey
          );
          if (current.epoch !== inventory.account.epoch)
            throw failure(
              'cache-invalidated',
              'This private cache budget change predates a clear.'
            );
          await requestResult(accounts.put({ ...current, budgetBytes }));
        })
      );
      const evicted = await this._evict(inventory);
      return { ...this._usage(inventory), ...evicted };
    });
  }

  setBudgetBytes(bytes) {
    return this.setBudget(bytes);
  }

  async requestPersistence() {
    this._active();
    const { storage } = this;
    try {
      if (typeof storage?.persisted === 'function') {
        const persistent = await storage.persisted();
        if (typeof persistent !== 'boolean')
          throw failure(
            'cache-persistence-failed',
            'Browser persistence returned an invalid result.'
          );
        if (persistent) return { status: 'accepted', persistent: true };
      }
      if (typeof storage?.persist !== 'function')
        return { status: 'unavailable', persistent: false };
      const persistent = await storage.persist();
      if (typeof persistent !== 'boolean')
        throw failure(
          'cache-persistence-failed',
          'Browser persistence returned an invalid result.'
        );
      return { status: persistent ? 'accepted' : 'denied', persistent };
    } catch (cause) {
      const error =
        cause instanceof CloudParticipantCacheError
          ? cause
          : new CloudParticipantCacheError(
              'cache-persistence-failed',
              'Browser persistence permission could not be requested.',
              { cause }
            );
      this.logger?.warn?.(error.message, error);
      return { status: 'failed', persistent: false, error };
    }
  }

  clear() {
    return this._clear();
  }

  clearCampaign(campaignId) {
    if (!isCloudUUID(campaignId))
      throw failure('invalid-cache-scope', 'Choose an explicit private campaign cache to purge.');
    return this._clear(campaignId);
  }

  async _clear(campaignId = null) {
    this._active();
    if (campaignId === null) this.coordinator.epoch++;
    else
      this.coordinator.campaignEpochs.set(
        campaignId,
        (this.coordinator.campaignEpochs.get(campaignId) ?? 0) + 1
      );
    this.coordinator.reconciled = false;
    return this._serialize(async () => {
      const uidKey = await this._uidKey();
      const database = await this._database();
      const { account, checkpointCount, assetCount } = await this._storage(() =>
        transact(
          database,
          ['accounts', 'checkpoints', 'assets'],
          'readwrite',
          async (transaction) => {
            const accounts = transaction.objectStore('accounts');
            const previous = this._account(await requestResult(accounts.get(uidKey)), uidKey);
            const epoch =
              (campaignId === null
                ? previous.epoch
                : (previous.campaignEpochs?.[campaignId] ?? 0)) + 1;
            if (!isBudget(epoch))
              throw failure('cache-corrupt', 'The private cache invalidation epoch is exhausted.');
            const account =
              campaignId === null
                ? { ...previous, epoch }
                : {
                    ...previous,
                    campaignEpochs: { ...previous.campaignEpochs, [campaignId]: epoch },
                  };
            const checkpoints = transaction.objectStore('checkpoints');
            const assets = transaction.objectStore('assets');
            const checkpointKeys = (await requestResult(checkpoints.index('uidKey').getAll(uidKey)))
              .filter((row) => campaignId === null || row.campaignId === campaignId)
              .map((row) => row.id);
            const prefix = this._prefix(uidKey) + (campaignId === null ? '' : campaignId + '/');
            const assetKeys = (await requestResult(assets.index('uidKey').getAll(uidKey)))
              .filter((row) => campaignId === null || row.id.startsWith(prefix))
              .map((row) => row.id);
            for (const key of checkpointKeys) await requestResult(checkpoints.delete(key));
            for (const key of assetKeys) await requestResult(assets.delete(key));
            await requestResult(accounts.put(account));
            return {
              account,
              checkpointCount: checkpointKeys.length,
              assetCount: assetKeys.length,
            };
          }
        )
      );
      const assetStorageAvailable = typeof this.cacheStorage?.open === 'function';
      if (!assetStorageAvailable && assetCount)
        throw failure('cache-unavailable', 'Private binary Cache Storage could not be cleared.');
      let removedAssets = 0;
      if (assetStorageAvailable) {
        const cache = await this._storage(() => this.cacheStorage.open(NAME + '.assets'));
        for (const request of await this._storage(() => cache.keys()))
          if (
            request.url.startsWith(
              this._prefix(uidKey) + (campaignId === null ? '' : campaignId + '/')
            )
          ) {
            await this._storage(() => cache.delete(request));
            removedAssets++;
          }
      }
      this._active();
      if (this.accountEpoch !== account.epoch) this.campaignEpochs.clear();
      this.accountEpoch = account.epoch;
      if (campaignId !== null)
        this.campaignEpochs.set(campaignId, account.campaignEpochs[campaignId]);
      return {
        ...this._usage(
          campaignId === null
            ? { account, entries: [], assetStorageAvailable }
            : await this._inventory()
        ),
        removedCheckpoints: checkpointCount,
        removedAssets,
      };
    });
  }

  async _protect(key) {
    this._active();
    const { pins } = this.coordinator;
    pins.set(key, (pins.get(key) ?? 0) + 1);
    let released = false;
    let unlock = () => {};
    let lease = Promise.resolve();
    const release = () => {
      if (released) return lease;
      released = true;
      const count = pins.get(key);
      if (count === 1) pins.delete(key);
      else pins.set(key, count - 1);
      this.protections.delete(release);
      unlock();
      return lease;
    };
    this.protections.add(release);
    if (this.nativeLocks) {
      let grant;
      let deny;
      const ready = new Promise((resolve, reject) => {
        grant = resolve;
        deny = reject;
      });
      const untilReleased = new Promise((resolve) => {
        unlock = resolve;
      });
      lease = this._storage(() =>
        this.locks.request(PIN_LOCK_PREFIX + key, { mode: 'shared' }, async () => {
          grant();
          await untilReleased;
        })
      );
      lease.then(() => {}, deny);
      try {
        await ready;
        this._active();
      } catch (error) {
        release();
        throw error;
      }
    }
    return release;
  }

  async protectView(access, viewKey) {
    access = structuredClone(access);
    this._scope(access, viewKey);
    const ticket = this._ticket('view', access, viewKey);
    try {
      return await this._serialize(async () => {
        const context = await this._key(access, viewKey);
        await this._capture(ticket, context);
        const release = await this._protect('view:' + context.id);
        try {
          this._assert(ticket);
          return release;
        } catch (error) {
          await release();
          throw error;
        }
      });
    } finally {
      this.coordinator.tickets.delete(ticket);
    }
  }

  async protect(snapshot, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    validateCloudParticipantSnapshot(snapshot, { cachedAssets });
    return this.protectView(snapshot.access, snapshot.viewKey);
  }

  async protectAsset(snapshot, reference, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    reference = structuredClone(reference);
    this._assetScope(snapshot, reference, cachedAssets);
    return this._serialize(async () => {
      const { request } = await this._asset(snapshot, reference, cachedAssets);
      return this._protect('asset:' + request.url);
    });
  }

  async writeCheckpoint(snapshot, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    validateCloudParticipantSnapshot(snapshot, { cachedAssets });
    if (snapshot.state.publicScene.assetKey !== null && snapshot.state.publicScene.assets === null)
      snapshot.state.publicScene.assets = structuredClone(cachedAssets);
    validateCloudParticipantSnapshot(snapshot);
    const ticket = this._ticket('checkpoint', snapshot.access, snapshot.viewKey);
    try {
      return await this._serialize(async () => {
        const context = await this._key(snapshot.access, snapshot.viewKey);
        await this._capture(ticket, context);
        const payload = JSON.stringify(snapshot);
        const bytes = new TextEncoder().encode(payload);
        if (bytes.byteLength > MAX_CHECKPOINT_BYTES)
          throw failure(
            'cache-entry-too-large',
            'The authorized checkpoint exceeds the bounded private cache entry size.'
          );
        const digest = await this._hash(bytes);
        this._assert(ticket);
        const inventory = await this._inventory();
        this._assert(ticket, inventory.account.epoch);
        const previous = inventory.entries.find(
          (entry) => entry.kind === 'checkpoint' && entry.id === context.id
        );
        if (previous?.row.generation > snapshot.generation)
          return { stored: false, reason: 'stale-checkpoint' };
        if (
          (await this._evict(inventory, {
            kind: 'checkpoint',
            id: context.id,
            bytes: bytes.byteLength,
          })) === null
        )
          return { stored: false, reason: 'cache-budget-exceeded' };
        this._assert(ticket);
        const result = await this._storage(() =>
          transact(
            inventory.database,
            ['accounts', 'checkpoints'],
            'readwrite',
            async (transaction) => {
              await this._verifyEpoch(transaction, ticket, context.uidKey);
              const store = transaction.objectStore('checkpoints');
              const current = await requestResult(store.get(context.id));
              if (current?.version === 1 && current.generation > snapshot.generation)
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
                  lastUsed: this._stamp(),
                  epoch: ticket.databaseEpoch,
                  sha256: digest,
                  payload,
                })
              );
              return { stored: true, generation: snapshot.generation };
            }
          )
        );
        this._assert(ticket);
        return result;
      });
    } finally {
      this.coordinator.tickets.delete(ticket);
    }
  }

  async deleteCheckpoint(access, viewKey) {
    access = structuredClone(access);
    this._invalidate('checkpoint:' + this._scope(access, viewKey));
    return this._serialize(async () => {
      const context = await this._key(access, viewKey);
      const database = await this._database();
      await this._storage(() =>
        transact(database, ['checkpoints'], 'readwrite', (transaction) =>
          requestResult(transaction.objectStore('checkpoints').delete(context.id))
        )
      );
      this._active();
    });
  }

  async readCheckpoint(access, viewKey) {
    return this._readCheckpoint(access, viewKey);
  }

  async _readCheckpoint(access, viewKey, verifyGraphics = false) {
    access = structuredClone(access);
    const ticket = this._ticket('checkpoint', access, viewKey);
    try {
      return await this._serialize(async () => {
        const context = await this._key(access, viewKey);
        const database = await this._capture(ticket, context);
        const row = await this._storage(() =>
          transact(database, ['checkpoints'], 'readonly', (transaction) =>
            requestResult(transaction.objectStore('checkpoints').get(context.id))
          )
        );
        this._assert(ticket);
        if (row === undefined) return null;
        if ((row.epoch ?? 0) !== ticket.databaseEpoch) return null;
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
        if (bytes.byteLength !== row.bytes || (await this._hash(bytes)) !== row.sha256)
          throw failure(
            'cache-corrupt',
            'The private checkpoint cache failed integrity verification.'
          );
        this._assert(ticket);
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
        if (snapshot.access.uid !== access.uid)
          throw failure('cache-corrupt', 'The private checkpoint belongs to a different account.');
        const saved = await this._key(snapshot.access, snapshot.viewKey);
        if (saved.id !== context.id || snapshot.generation !== row.generation)
          throw failure(
            'cache-corrupt',
            'The private checkpoint cache belongs to a different view.'
          );
        if (
          verifyGraphics &&
          snapshot.state.publicScene.assetKey !== null &&
          (await this._hash(
            new TextEncoder().encode(JSON.stringify(snapshot.state.publicScene.assets))
          )) !== snapshot.state.publicScene.assetKey
        )
          throw failure('cache-corrupt', 'The cached graphic JSON failed integrity verification.');
        this._assert(ticket);
        await this._storage(() =>
          transact(database, ['accounts', 'checkpoints'], 'readwrite', async (transaction) => {
            await this._verifyEpoch(transaction, ticket, context.uidKey);
            const store = transaction.objectStore('checkpoints');
            const current = await requestResult(store.get(context.id));
            if (current?.sha256 === row.sha256 && current.generation === row.generation)
              await requestResult(store.put({ ...current, lastUsed: this._stamp() }));
          })
        );
        this._assert(ticket);
        return snapshot;
      });
    } finally {
      this.coordinator.tickets.delete(ticket);
    }
  }

  async _checkpointCandidates(access) {
    access = structuredClone(access);
    this._scope(access, '0'.repeat(64));
    const ticket = this._ticket('candidate', access, '0'.repeat(64));
    try {
      return await this._serialize(async () => {
        const uidKey = await this._uidKey();
        const database = await this._capture(ticket, { uidKey });
        const rows = await this._storage(() =>
          transact(database, ['checkpoints'], 'readonly', (transaction) =>
            requestResult(transaction.objectStore('checkpoints').index('uidKey').getAll(uidKey))
          )
        );
        this._assert(ticket);
        return rows
          .filter((row) => row.campaignId === access.campaignId)
          .sort((left, right) => (right.lastUsed ?? 0) - (left.lastUsed ?? 0))
          .map((row) => {
            const scope = {
              version: 1,
              uid: this.uid,
              campaignId: row.campaignId,
              role: 'member',
              seatId: row.seatId,
              accessGeneration: row.accessGeneration,
            };
            if (!isCloudAccessScope(scope) || !isCloudDigest(row.viewKey))
              throw failure('cache-corrupt', 'The private checkpoint candidate scope is invalid.');
            return { access: scope, viewKey: row.viewKey };
          });
      });
    } finally {
      this.coordinator.tickets.delete(ticket);
    }
  }

  async readCheckpointCandidate(access) {
    for (const candidate of await this._checkpointCandidates(access)) {
      if (
        candidate.access.seatId !== access.seatId ||
        candidate.access.accessGeneration !== access.accessGeneration
      )
        continue;
      const snapshot = await this._readCheckpointCandidate(candidate);
      if (snapshot !== null) return snapshot;
    }
    return null;
  }

  async purgeSupersededAccess(access) {
    access = structuredClone(access);
    const candidates = await this._checkpointCandidates(access);
    if (
      candidates.some(
        (candidate) =>
          candidate.access.seatId !== access.seatId ||
          candidate.access.accessGeneration !== access.accessGeneration
      )
    )
      return this.clearCampaign(access.campaignId);
    return { purged: false };
  }

  async _readCheckpointCandidate(candidate) {
    try {
      return await this._readCheckpoint(candidate.access, candidate.viewKey, true);
    } catch (error) {
      if (error instanceof CloudParticipantCacheError && error.code === 'cache-corrupt')
        await this.deleteCheckpoint(candidate.access, candidate.viewKey);
      throw error;
    }
  }

  async readAuthorizedAsset(snapshot, reference, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    reference = structuredClone(reference);
    this._assetScope(snapshot, reference, cachedAssets);
    // Only the fresh manifest authorizes reuse; historical scope is just a byte location.
    for (const candidate of await this._checkpointCandidates(snapshot.access)) {
      const saved = await this._readCheckpointCandidate(candidate);
      if (
        saved === null ||
        !saved.manifest.images.some((slot) =>
          Object.keys(reference).every((key) => slot.reference[key] === reference[key])
        )
      )
        continue;
      try {
        const bytes = await this.readAsset(saved, reference);
        if (bytes !== null) return bytes;
      } catch (error) {
        if (
          error instanceof CloudParticipantCacheError &&
          ['cache-corrupt', 'cache-asset-integrity'].includes(error.code)
        )
          await this.deleteAsset(saved, reference);
        throw error;
      }
    }
    return null;
  }

  _assetScope(snapshot, reference, cachedAssets) {
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
    return this._scope(snapshot.access, snapshot.viewKey);
  }

  async _asset(snapshot, reference, cachedAssets) {
    this._assetScope(snapshot, reference, cachedAssets);
    const context = await this._key(snapshot.access, snapshot.viewKey);
    if (typeof this.cacheStorage?.open !== 'function')
      throw failure(
        'cache-unavailable',
        'Private binary Cache Storage is unavailable in this browser.'
      );
    const cache = await this._storage(() => this.cacheStorage.open(NAME + '.assets'));
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
      context,
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
    this._assetScope(snapshot, reference, cachedAssets);
    const ticket = this._ticket('asset', snapshot.access, snapshot.viewKey, reference.sha256);
    try {
      return await this._serialize(async () => {
        const { cache, request, context } = await this._asset(snapshot, reference, cachedAssets);
        await this._capture(ticket, context);
        if (bytes.byteLength !== reference.bytes || (await this._hash(bytes)) !== reference.sha256)
          throw failure(
            'cache-asset-integrity',
            'The private image bytes do not match their verified reference.'
          );
        this._assert(ticket);
        const inventory = await this._inventory();
        this._assert(ticket, inventory.account.epoch);
        if (
          (await this._evict(inventory, {
            kind: 'asset',
            id: request.url,
            bytes: bytes.byteLength,
          })) === null
        )
          throw failure('cache-budget-exceeded', 'The private image cannot fit the cache budget.');
        let written = false;
        let committed = false;
        try {
          this._assert(ticket);
          await this._storage(() =>
            cache.put(
              request,
              new Response(bytes, {
                headers: {
                  'Content-Type': reference.mimeType,
                  'Content-Length': String(bytes.byteLength),
                  'X-TavernTable-Cache-SHA256': reference.sha256,
                  'X-TavernTable-Cache-Epoch': String(ticket.databaseEpoch),
                },
              })
            )
          );
          written = true;
          this._assert(ticket);
          await this._storage(() =>
            transact(
              inventory.database,
              ['accounts', 'assets'],
              'readwrite',
              async (transaction) => {
                await this._verifyEpoch(transaction, ticket, context.uidKey);
                await requestResult(
                  transaction.objectStore('assets').put({
                    version: 1,
                    id: request.url,
                    uidKey: context.uidKey,
                    viewId: context.id,
                    bytes: bytes.byteLength,
                    lastUsed: this._stamp(),
                    epoch: ticket.databaseEpoch,
                  })
                );
              }
            )
          );
          committed = true;
        } finally {
          if (written && !committed) {
            this.coordinator.reconciled = false;
            await this._storage(() => cache.delete(request));
          }
        }
        this._assert(ticket);
      });
    } finally {
      this.coordinator.tickets.delete(ticket);
    }
  }

  async readAsset(snapshot, reference, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    reference = structuredClone(reference);
    this._assetScope(snapshot, reference, cachedAssets);
    const ticket = this._ticket('asset', snapshot.access, snapshot.viewKey, reference.sha256);
    try {
      return await this._serialize(async () => {
        const { cache, request, context } = await this._asset(snapshot, reference, cachedAssets);
        const database = await this._capture(ticket, context);
        const response = await this._storage(() => cache.match(request));
        this._assert(ticket);
        if (response === undefined) {
          this.coordinator.reconciled = false;
          return null;
        }
        if (this._assetEpoch(response) !== ticket.databaseEpoch) return null;
        if (
          response.headers.get('Content-Type') !== reference.mimeType ||
          response.headers.get('Content-Length') !== String(reference.bytes) ||
          response.headers.get('X-TavernTable-Cache-SHA256') !== reference.sha256
        )
          throw failure(
            'cache-asset-integrity',
            'The private cached image metadata could not be verified.'
          );
        const bytes = new Uint8Array(await this._storage(() => response.arrayBuffer()));
        if (bytes.byteLength !== reference.bytes || (await this._hash(bytes)) !== reference.sha256)
          throw failure(
            'cache-asset-integrity',
            'The private cached image bytes failed integrity verification.'
          );
        this._assert(ticket);
        await this._storage(() =>
          transact(database, ['accounts', 'assets'], 'readwrite', async (transaction) => {
            await this._verifyEpoch(transaction, ticket, context.uidKey);
            await requestResult(
              transaction.objectStore('assets').put({
                version: 1,
                id: request.url,
                uidKey: context.uidKey,
                viewId: context.id,
                bytes: bytes.byteLength,
                lastUsed: this._stamp(),
                epoch: ticket.databaseEpoch,
              })
            );
          })
        );
        this._assert(ticket);
        return bytes;
      });
    } finally {
      this.coordinator.tickets.delete(ticket);
    }
  }

  async deleteAsset(snapshot, reference, { cachedAssets = null } = {}) {
    snapshot = structuredClone(snapshot);
    reference = structuredClone(reference);
    const scope = this._assetScope(snapshot, reference, cachedAssets);
    this._invalidate('asset:' + scope + '/' + reference.sha256);
    return this._serialize(async () => {
      const { cache, request } = await this._asset(snapshot, reference, cachedAssets);
      const removed = await this._storage(() => cache.delete(request));
      const database = await this._database();
      await this._storage(() =>
        transact(database, ['assets'], 'readwrite', (transaction) =>
          requestResult(transaction.objectStore('assets').delete(request.url))
        )
      );
      this._active();
      return removed;
    });
  }

  async _database() {
    this._active();
    if (typeof this.factory?.open !== 'function')
      throw failure(
        'cache-unavailable',
        'IndexedDB is unavailable for private participant caching.'
      );
    if (this.database) return this.database;
    this.opening ??= this._storage(() =>
      openDatabase(
        this.factory,
        NAME,
        (database) => {
          if (!database.objectStoreNames.contains('checkpoints')) {
            const checkpoints = database.createObjectStore('checkpoints', { keyPath: 'id' });
            checkpoints.createIndex('uidKey', 'uidKey');
          }
          if (!database.objectStoreNames.contains('accounts'))
            database.createObjectStore('accounts', { keyPath: 'uidKey' });
          if (!database.objectStoreNames.contains('assets')) {
            const assets = database.createObjectStore('assets', { keyPath: 'id' });
            assets.createIndex('uidKey', 'uidKey');
          }
        },
        DATABASE_VERSION
      )
    )
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
    for (const release of this.protections) release();
    this.database?.close();
    this.database = null;
  }
}
