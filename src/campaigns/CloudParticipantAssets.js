import { validateCloudParticipantSnapshot } from './CloudParticipantProtocol.js';
import { CloudParticipantCacheError } from './CloudParticipantCache.js';
import { sha256 } from '../storage/sha256.js';
import { encodeBase64 } from '../storage/base64.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';

const copy = (value) => structuredClone(value);
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const referenceKey = (reference) =>
  JSON.stringify([
    reference.sha256,
    reference.generation,
    reference.mimeType,
    reference.bytes,
    reference.width,
    reference.height,
  ]);

export default class CloudParticipantAssets {
  constructor({ store, cache = null, onStatus = () => {}, onChanged = () => {} }) {
    if (
      typeof store?.readParticipantAsset !== 'function' ||
      typeof store.connection?.account?.identity !== 'function' ||
      typeof store.uid !== 'string' ||
      (cache !== null &&
        [
          'getUsage',
          'protectView',
          'writeCheckpoint',
          'readAsset',
          'writeAsset',
          'deleteAsset',
        ].some((method) => typeof cache[method] !== 'function'))
    )
      throw new Error('Participant artwork requires authorized image delivery and scoped storage');
    this.store = store;
    this.cache = cache;
    this.onStatus = onStatus;
    this.onChanged = onChanged;
    this.images = new Map();
    this.requestedCharacters = new Set();
    this.sequence = 0;
    this.phase = 'idle';
    this.snapshot = null;
    this.closed = false;
    this.tasks = new Set();
    this.releaseTasks = new Set();
  }

  _current(version) {
    return (
      !this.closed &&
      version === this.sequence &&
      this.store.connection.account.identity()?.uid === this.store.uid
    );
  }

  _status(status) {
    this.phase = status.phase;
    this.onStatus(
      copy({
        ...status,
        ...(this.cacheIssue ? { cache: this.cacheIssue } : {}),
      })
    );
  }

  async _cacheCall(version, method, ...args) {
    const reading = ['readAsset', 'readAuthorizedAsset', 'readCheckpointCandidate'].includes(
      method
    );
    if (this.cache === null || !this._current(version))
      return reading ? null : { stored: false, reason: 'cache-unavailable' };
    try {
      return await this.cache[method](...args);
    } catch (error) {
      if (!(error instanceof CloudParticipantCacheError) || error.recoverable !== true) throw error;
      if (!this._current(version))
        return reading ? null : { stored: false, reason: 'superseded-assets' };
      this.cacheIssue = {
        phase: 'unavailable',
        code: error.code,
        message:
          'Private caching is unavailable. This view still requires current online authority.',
      };
      logger.log(
        LOG_LEVEL.WARN,
        'Private participant caching requires recovery',
        LOG_CATEGORY.SYSTEM,
        {
          component: 'CloudParticipantAssets',
          code: error.code,
        }
      );
      if (method === 'readAsset' && ['cache-corrupt', 'cache-asset-integrity'].includes(error.code))
        await this._cacheCall(version, 'deleteAsset', ...args);
      return reading ? null : { stored: false, reason: error.code };
    }
  }

  async _prepareCache(version) {
    if (this.cache === null || this.cacheAllowed === false) return false;
    if (this.cacheAllowed === true) return true;
    const usage = await this._cacheCall(version, 'getUsage');
    if (!this._current(version)) return false;
    if (usage?.stored === false) {
      this.cacheAllowed = false;
      return false;
    }
    if (usage?.crossTabCoordinated !== true) {
      this.cacheAllowed = false;
      this.cacheIssue = {
        phase: 'unavailable',
        code: 'cache-unavailable',
        reason: 'cross-tab-coordination-unavailable',
        message:
          'Private caching is disabled because this browser cannot enforce the shared account cache limit.',
      };
      logger.log(
        LOG_LEVEL.WARN,
        'Private caching requires browser-wide coordination',
        LOG_CATEGORY.SYSTEM,
        {
          component: 'CloudParticipantAssets',
          code: 'cache-unavailable',
        }
      );
      return false;
    }
    this.cacheAllowed = true;
    this.cacheIssue = null;
    return true;
  }

  _releaseView(release = this.releaseView) {
    if (release === this.releaseView) {
      this.releaseView = null;
      this.protectedView = null;
    }
    if (!release) return Promise.resolve();
    const task = release();
    this.releaseTasks.add(task);
    void task.then(
      () => this.releaseTasks.delete(task),
      (error) => {
        this.releaseTasks.delete(task);
        this.releaseFailure = error;
        logger.log(
          LOG_LEVEL.ERROR,
          'Private cache protection could not be released',
          LOG_CATEGORY.SYSTEM,
          {
            component: 'CloudParticipantAssets',
            code: 'cache-protection-release-failed',
          }
        );
      }
    );
    return task;
  }

  async _protectView(version, snapshot) {
    const key = JSON.stringify([snapshot.access, snapshot.viewKey]);
    if (key === this.protectedView && this.releaseView) return true;
    await this._releaseView();
    if (!this._current(version)) return false;
    const release = await this._cacheCall(
      version,
      'protectView',
      snapshot.access,
      snapshot.viewKey
    );
    if (!this._current(version)) {
      if (typeof release === 'function') await this._releaseView(release);
      return false;
    }
    if (typeof release !== 'function') {
      if (release?.stored === false) return false;
      throw new Error('Private cache protection returned an invalid release handle');
    }
    this.releaseView = release;
    this.protectedView = key;
    return true;
  }

  async readCheckpointCandidate(access) {
    const version = this.sequence;
    if (
      !this._current(version) ||
      typeof this.cache?.readCheckpointCandidate !== 'function' ||
      !(await this._prepareCache(version))
    )
      return null;
    const candidate = await this._cacheCall(version, 'readCheckpointCandidate', access);
    return this._current(version) ? candidate : null;
  }

  update(snapshot, { cachedAssets = null } = {}) {
    if (this.closed)
      throw failure(409, 'stream-closed', 'The participant artwork loader is closed.');
    if (
      snapshot?.access?.uid !== this.store.uid ||
      this.store.connection.account.identity()?.uid !== this.store.uid
    )
      throw failure(409, 'account-changed', 'This view belongs to another signed-in account.');
    validateCloudParticipantSnapshot(snapshot, { cachedAssets });
    const captured = copy(snapshot);
    if (captured.state.publicScene.assetKey !== null && captured.state.publicScene.assets === null)
      captured.state.publicScene.assets = copy(cachedAssets);
    const scopeKey = JSON.stringify([captured.access, captured.sessionId, captured.viewKey]);
    for (const id of this.requestedCharacters)
      if (!captured.state.characterIds.includes(id)) this.requestedCharacters.delete(id);
    const manifestKey = JSON.stringify([
      captured.manifest.images,
      [...this.requestedCharacters].sort(),
    ]);
    if (scopeKey !== this.scopeKey || manifestKey !== this.manifestKey) {
      this.controller?.abort();
      this.sequence++;
      if (scopeKey !== this.scopeKey) void this._releaseView();
      const allowed = new Set(
        captured.manifest.images.map(({ reference }) => referenceKey(reference))
      );
      if (scopeKey !== this.scopeKey) this.images.clear();
      else for (const key of this.images.keys()) if (!allowed.has(key)) this.images.delete(key);
      this.scopeKey = scopeKey;
      this.manifestKey = manifestKey;
      this.task = null;
    }
    this.snapshot = captured;
    if (this.task && this.phase === 'loading') return this.task;
    this.controller = new AbortController();
    const version = this.sequence;
    const task = this._load(version, this.controller);
    this.task = task;
    this.tasks.add(task);
    void task.then(
      () => this.tasks.delete(task),
      () => this.tasks.delete(task)
    );
    return task;
  }

  async loadCharacterImages(characterId) {
    if (!this._current(this.sequence))
      throw failure(409, 'account-changed', 'Reopen the current authorized player view.');
    if (!this.snapshot?.state.characterIds.includes(characterId))
      throw failure(403, 'asset-not-found', 'This character is not in the authorized manifest.');
    this.requestedCharacters.add(characterId);
    return this.update(this.snapshot);
  }

  _references(snapshot) {
    const active = snapshot.state.publicScene.actors.find(
      (actor) => actor.id === snapshot.state.observerTokenId
    )?.characterId;
    const slots = snapshot.manifest.images
      .filter(
        (slot) =>
          slot.source === 'actor' || slot.id === active || this.requestedCharacters.has(slot.id)
      )
      .sort((left, right) => Number(left.source !== 'actor') - Number(right.source !== 'actor'));
    return [
      ...new Map(slots.map(({ reference }) => [referenceKey(reference), reference])).values(),
    ];
  }

  async _verified(bytes, reference) {
    return (
      ArrayBuffer.isView(bytes) &&
      bytes.BYTES_PER_ELEMENT === 1 &&
      bytes.byteLength === reference.bytes &&
      (await sha256(bytes)) === reference.sha256
    );
  }

  async _load(version, controller) {
    const snapshot = this.snapshot;
    const references = this._references(snapshot);
    let loaded = references.filter((reference) => this.images.has(referenceKey(reference))).length;
    this._status({ phase: 'loading', loaded, total: references.length });
    try {
      const caching =
        (await this._prepareCache(version)) && (await this._protectView(version, snapshot));
      for (const reference of references) {
        if (!this._current(version) || controller.signal.aborted)
          return { applied: false, reason: 'superseded-assets' };
        const key = referenceKey(reference);
        if (this.images.has(key)) continue;
        const readMethod =
          typeof this.cache?.readAuthorizedAsset === 'function'
            ? 'readAuthorizedAsset'
            : 'readAsset';
        let bytes = caching
          ? await this._cacheCall(version, readMethod, snapshot, reference)
          : null;
        if (!this._current(version) || controller.signal.aborted)
          return { applied: false, reason: 'superseded-assets' };
        if (bytes !== null && !(await this._verified(bytes, reference))) {
          this._status({
            phase: 'loading',
            loaded,
            total: references.length,
            recovery: 'cache-corrupt',
          });
          await this._cacheCall(version, 'deleteAsset', snapshot, reference);
          bytes = null;
        }
        const downloading = bytes === null;
        if (downloading) {
          bytes = await this.store.readParticipantAsset(
            snapshot.access.campaignId,
            snapshot,
            reference,
            { signal: controller.signal }
          );
          if (!this._current(version) || controller.signal.aborted)
            return { applied: false, reason: 'superseded-assets' };
          if (!(await this._verified(bytes, reference)))
            throw failure(
              503,
              'asset-integrity-failed',
              'The private image failed integrity verification.'
            );
          if (!this._current(version) || controller.signal.aborted)
            return { applied: false, reason: 'superseded-assets' };
        }
        if (!this._current(version) || controller.signal.aborted)
          return { applied: false, reason: 'superseded-assets' };
        if (caching && (downloading || readMethod === 'readAuthorizedAsset'))
          await this._cacheCall(version, 'writeAsset', snapshot, reference, bytes);
        if (!this._current(version) || controller.signal.aborted)
          return { applied: false, reason: 'superseded-assets' };
        this.images.set(key, `data:${reference.mimeType};base64,${encodeBase64(bytes)}`);
        loaded++;
        this._status({ phase: 'loading', loaded, total: references.length });
        this.onChanged();
      }
      if (caching) await this._cacheCall(version, 'writeCheckpoint', this.snapshot);
      if (!this._current(version) || controller.signal.aborted)
        return { applied: false, reason: 'superseded-assets' };
      this._status({ phase: 'ready', loaded, total: references.length });
      return { applied: true };
    } catch (error) {
      if (!this._current(version) || controller.signal.aborted)
        return { applied: false, reason: 'superseded-assets' };
      logger.log(LOG_LEVEL.ERROR, 'Participant artwork could not be loaded', LOG_CATEGORY.SYSTEM, {
        component: 'CloudParticipantAssets',
        code: 'participant-artwork-failed',
        kind: error instanceof Error ? 'error' : 'non-error',
      });
      this._status({
        phase: 'error',
        loaded,
        total: references.length,
        error: {
          status: Number.isInteger(error?.status) ? error.status : 503,
          code: error?.code || 'participant-artwork-unavailable',
          message: 'Private artwork is unavailable. Reconnect online to retry.',
        },
      });
      throw error;
    }
  }

  characterImages(characterId) {
    if (this.closed || !this.snapshot?.state.characterIds.includes(characterId)) return null;
    if (this.store.connection.account.identity()?.uid !== this.store.uid) return null;
    const images = {};
    for (const slot of this.snapshot.manifest.images) {
      if (slot.source !== 'character' || slot.id !== characterId) continue;
      const image = this.images.get(referenceKey(slot.reference));
      if (image) images[slot.field] = image;
    }
    return Object.keys(images).length ? images : null;
  }

  decorate(state) {
    const displayed = copy(state);
    if (
      this.closed ||
      !this.snapshot ||
      this.store.connection.account.identity()?.uid !== this.store.uid
    )
      return displayed;
    const actors = new Map(displayed.publicScene.actors.map((actor) => [actor.id, actor]));
    for (const slot of this.snapshot.manifest.images) {
      if (slot.source !== 'actor' || !actors.has(slot.id)) continue;
      actors.get(slot.id).portraitImage = this.images.get(referenceKey(slot.reference)) || null;
    }
    return displayed;
  }

  invalidate() {
    this.controller?.abort();
    this.sequence++;
    this.images.clear();
    this.requestedCharacters.clear();
    this.snapshot = null;
    this.scopeKey = null;
    this.manifestKey = null;
    this.task = null;
    this.cacheAllowed = null;
    void this._releaseView();
    if (!this.closed) this._status({ phase: 'idle', loaded: 0, total: 0 });
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.sequence++;
    this.controller?.abort();
    this.images.clear();
    this.requestedCharacters.clear();
    this.snapshot = null;
    this.cache?.close?.();
    const released = this._releaseView();
    this.closing = Promise.all([...this.tasks, ...this.releaseTasks, released]).then(() => {
      if (this.releaseFailure) throw this.releaseFailure;
    });
    return this.closing;
  }
}
