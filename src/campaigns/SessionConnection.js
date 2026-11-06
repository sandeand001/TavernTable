import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';

export async function sessionJSON(fetch, url, options = {}) {
  const response = await fetch(url, { cache: 'no-store', ...options });
  let data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error('The local host returned an invalid session response', { cause: error });
  }
  if (!response.ok)
    throw Object.assign(new Error(data.error || `Session request failed (${response.status})`), {
      status: response.status,
    });
  return data;
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
        try {
          this._emit({ type: 'campaign', ...JSON.parse(event.data) });
        } catch (error) {
          logger.log(
            LOG_LEVEL.ERROR,
            'The live session returned an invalid update',
            LOG_CATEGORY.SYSTEM,
            {
              component: 'SessionConnection',
              operation: 'readUpdate',
              error: error.message,
            }
          );
          this._emit({ type: 'invalid-update' });
        }
      });
    }
    return () => {
      this.listeners.delete(listener);
      if (!this.listeners.size) {
        this.source?.close();
        this.source = null;
      }
    };
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
