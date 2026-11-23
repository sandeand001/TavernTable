import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { isProtectedAssetId } from '../core/ProtectedAsset.js';

export async function sessionJSON(fetch, url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('The local host returned an invalid session response', { cause: error });
  }
  if (!response.ok) {
    const denial = Object.assign(
      new Error(data.error || `Session request failed (${response.status})`),
      {
        status: response.status,
      }
    );
    const invalid = () =>
      Object.assign(
        new Error('The local host returned an invalid command denial', { cause: denial }),
        { status: response.status, code: 'invalid-session-response' }
      );
    for (const field of ['code', 'commandId']) {
      if (!Object.hasOwn(data, field)) continue;
      if (typeof data[field] !== 'string') throw invalid();
      denial[field] = data[field];
    }
    if (Object.hasOwn(data, 'current')) {
      if (
        !data.current ||
        !['sceneRevision', 'charactersRevision'].every(
          (field) => Number.isSafeInteger(data.current[field]) && data.current[field] >= 0
        )
      )
        throw invalid();
      denial.current = {
        sceneRevision: data.current.sceneRevision,
        charactersRevision: data.current.charactersRevision,
      };
    }
    throw denial;
  }
  return data;
}

export async function getLocalProtectedAssetKey(
  identity,
  campaignId,
  keyId,
  { fetch = globalThis.fetch, baseURL = globalThis.location.href } = {}
) {
  if (
    identity?.localProtectedAssets !== true ||
    typeof identity.csrf !== 'string' ||
    typeof campaignId !== 'string' ||
    !campaignId ||
    !isProtectedAssetId(keyId)
  )
    throw new Error('Local protected-asset access is unavailable');
  const result = await sessionJSON(fetch, new URL('api/protected-asset-key', baseURL).href, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-TavernTable-Host': identity.csrf,
    },
    body: JSON.stringify({ campaignId, keyId }),
  });
  if (
    !result ||
    typeof result !== 'object' ||
    Array.isArray(result) ||
    Object.keys(result).sort().join(',') !== 'key,keyId,version' ||
    result.version !== 1 ||
    result.keyId !== keyId ||
    typeof result.key !== 'string' ||
    !/^[A-Za-z0-9+/]{43}=$/.test(result.key) ||
    globalThis.btoa(globalThis.atob(result.key)) !== result.key
  )
    throw new Error('The local protected-asset key response is invalid');
  return result.key;
}

export function createLocalProtectedAssetKeyProvider(identity, campaignId, options) {
  const pending = new Map();
  return async (keyId) => {
    let request = pending.get(keyId);
    if (!request) {
      request = getLocalProtectedAssetKey(identity, campaignId, keyId, options);
      pending.set(keyId, request);
    }
    try {
      return await request;
    } finally {
      if (pending.get(keyId) === request) pending.delete(keyId);
    }
  };
}

export default class SessionConnection {
  constructor({
    identity,
    fetch = globalThis.fetch,
    baseURL = globalThis.location.href,
    EventSource = globalThis.EventSource,
  }) {
    this.identity = identity;
    this.fetch = (...args) => fetch(...args);
    this.baseURL = baseURL;
    this.EventSource = EventSource;
    this.listeners = new Set();
    this.source = null;
  }

  async call(operation, args = []) {
    const data = await sessionJSON(this.fetch, new URL('api/campaigns', this.baseURL).href, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-TavernTable-Host': this.identity.csrf,
      },
      body: JSON.stringify({ operation, args }),
    });
    if (!Object.hasOwn(data, 'result')) throw new Error('The host returned no session receipt');
    return data.result;
  }

  async logout() {
    await sessionJSON(this.fetch, new URL('api/session/logout', this.baseURL).href, {
      method: 'POST',
      headers: { 'X-TavernTable-Host': this.identity.csrf },
    });
    this.close();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    if (!this.source) {
      if (!this.EventSource) throw new Error('This browser does not support live session updates');
      this.source = new this.EventSource(new URL('api/events', this.baseURL).href);
      this.source.addEventListener('open', () => this._emit({ type: 'connected' }));
      this.source.addEventListener('error', () => this._emit({ type: 'disconnected' }));
      this.source.addEventListener('campaign', (event) => {
        this._readEvent('campaign', event, 'readUpdate');
      });
      this.source.addEventListener('live-presentations', (event) =>
        this._readEvent('live-presentations', event, 'readLivePresentations')
      );
      this.source.addEventListener('command-accepted', (event) =>
        this._readEvent('command-accepted', event, 'readCommandAccepted')
      );
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.source?.close();
        this.source = null;
      }
    };
  }

  _readEvent(type, event, operation) {
    try {
      this._emit({ type, ...JSON.parse(event.data) });
    } catch (error) {
      logger.log(
        LOG_LEVEL.ERROR,
        'The live session returned an invalid update',
        LOG_CATEGORY.SYSTEM,
        {
          component: 'SessionConnection',
          operation,
          error: error.message,
        }
      );
      this._emit({ type: 'invalid-update' });
    }
  }

  _emit(event) {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        logger.log(LOG_LEVEL.ERROR, 'A live session listener failed', LOG_CATEGORY.SYSTEM, {
          component: 'SessionConnection',
          operation: 'notify',
          error: error.message,
        });
      }
    }
  }

  close() {
    this.source?.close();
    this.source = null;
    this.listeners.clear();
  }
}
