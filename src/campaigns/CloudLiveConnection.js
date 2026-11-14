import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';

const copy = (value) => structuredClone(value);
const failure = (code, message, status = 503) =>
  Object.assign(new Error(message), { code, status });
const closed = () => failure('stream-closed', 'The live observation was closed.', 409);
const denied = new Set([
  'authentication-required',
  'invalid-identity',
  'email-verification-required',
  'pilot-access-required',
  'invalid-account-eligibility',
  'campaign-not-found',
  'campaign-access-changed',
  'account-changed',
]);
const terminalPhase = (error) => {
  if (error.code === 'live-session-paused') return 'paused';
  if (error.code === 'live-session-changed') return 'ended';
  return denied.has(error.code) || [401, 403, 404].includes(error.status) ? 'denied' : 'error';
};
const retryable = new Set([
  'cloud-stream-unavailable',
  'cloud-stream-timeout',
  'invalid-cloud-stream',
  'cloud-request-timeout',
  'cloud-unavailable',
  'stream-unavailable',
  'stream-client-too-slow',
  'stream-deadline',
  'participant-delta-gap',
  'participant-state-changed',
  'participant-observation-unavailable',
  'eligibility-unavailable',
  'identity-unavailable',
  'auth-unavailable',
  'cloud-requests-busy',
  'snapshot-storage-unavailable',
  'snapshot-unavailable',
  'resource-catalog-unavailable',
]);

export default class CloudLiveConnection {
  constructor({ store, account, id, view, scope, cachedAssets = null, onState, onStatus }) {
    if (typeof onState !== 'function' || typeof onStatus !== 'function')
      throw new Error('Live observation requires state and status listeners');
    this.store = store;
    this.account = account;
    this.id = id;
    this.view = copy(view);
    this.scope = copy(scope);
    this.assets = copy(cachedAssets);
    this.onState = onState;
    this.onStatus = onStatus;
    this.current = null;
    this.source = null;
    this.stopped = false;
    this.settled = false;
    this.status = null;
    this.failures = 0;
    this.refreshIdentity = false;
    this.ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    this.running = Promise.resolve().then(() => this._run());
    void this.running.catch((error) => {
      logger.log(LOG_LEVEL.ERROR, 'A cloud live observation failed', LOG_CATEGORY.SYSTEM, {
        component: 'CloudLiveConnection',
        code: 'live-observation-failed',
        kind: error instanceof Error ? 'error' : 'non-error',
      });
    });
  }

  _notify(listener, ...args) {
    let result;
    try {
      result = listener(...args);
    } catch (error) {
      logger.log(LOG_LEVEL.ERROR, 'A cloud live listener failed', LOG_CATEGORY.SYSTEM, {
        component: 'CloudLiveConnection',
        code: 'live-listener-failed',
        kind: error instanceof Error ? 'error' : 'non-error',
      });
      throw failure('live-listener-failed', 'The live state or status could not be published.');
    }
    if (typeof result?.then !== 'function') return;
    void Promise.resolve(result).catch((error) => {
      logger.log(LOG_LEVEL.ERROR, 'A cloud live listener rejected', LOG_CATEGORY.SYSTEM, {
        component: 'CloudLiveConnection',
        code: 'live-listener-rejection',
        kind: error instanceof Error ? 'error' : 'non-error',
      });
    });
    throw failure('live-listener-failed', 'Live listeners must publish state synchronously.');
  }

  _status(phase, reason = null) {
    if (this.status?.phase === phase && this.status.reason === reason) return;
    this.status = Object.freeze({ phase, reason });
    this._notify(this.onStatus, this.status);
  }

  async _apply(event) {
    let next;
    if (event.kind === 'owner-head') next = copy(event);
    else if (['checkpoint', 'resync'].includes(event.kind)) next = copy(event.checkpoint);
    else if (event.kind === 'delta') {
      if (this.current === null)
        throw failure('participant-delta-gap', 'Read a current authorized checkpoint first.', 409);
      const { applyCloudParticipantDelta } = await import('./CloudParticipantProtocol.js');
      next = applyCloudParticipantDelta(this.current, event.delta, { cachedAssets: this.assets });
    } else throw failure('invalid-cloud-stream', 'The live observation returned an invalid state.');
    if (this.stopped) return;
    const previousGeneration = this.current?.head?.generation ?? this.current?.generation;
    const nextGeneration = next.head?.generation ?? next.generation;
    if (previousGeneration !== undefined && nextGeneration < previousGeneration)
      throw failure('invalid-change-history', 'The live campaign revision moved backwards.');
    const reconcile = event.kind !== 'delta' || event.delta.kind === 'replace';
    if (reconcile) this._status('synchronizing');
    this._notify(this.onState, copy(next), { reconcile });
    if (this.stopped) return;
    this.current = next;
    this.failures = 0;
    if (event.kind !== 'owner-head')
      this.assets =
        next.state.publicScene.assetKey === null
          ? null
          : next.state.publicScene.assets || this.assets;
    this._status('ready');
    if (!this.settled) {
      this.settled = true;
      this.resolveReady(copy(next));
    }
  }

  _stop(error = null, phase = 'closed') {
    if (this.stopping) return this.stopping;
    this.stopped = true;
    this.controller?.abort();
    clearTimeout(this.retryTimer);
    clearTimeout(this.rotationTimer);
    this.resumeRetry?.();
    this.resumeRetry = null;
    this.current = null;
    this.assets = null;
    this.stopping = this.source?.close() || Promise.resolve();
    if (!this.settled) {
      this.settled = true;
      this.rejectReady(error || closed());
    }
    this._status(phase, error?.code || null);
    return this.stopping;
  }

  _backoff() {
    const base = Math.min(15000, 1000 * 2 ** Math.min(this.failures++, 4));
    return new Promise((resolve) => {
      this.resumeRetry = resolve;
      this.retryTimer = setTimeout(
        () => {
          this.retryTimer = null;
          this.resumeRetry = null;
          resolve();
        },
        base + Math.floor(base * Math.random())
      );
    });
  }

  _rotateBeforeDeadline() {
    this.rotationTimer = setTimeout(
      () => {
        if (this.stopped) return;
        this.rotating = true;
        this.refreshIdentity = true;
        this.controller.abort();
      },
      50 * 60 * 1000 + Math.floor(Math.random() * 2 * 60 * 1000)
    );
  }

  async _run() {
    try {
      if (this.stopped) return;
      const identityFailed = (error) => {
        void this._stop(error, terminalPhase(error)).catch((closing) => {
          logger.log(
            LOG_LEVEL.ERROR,
            'A live identity observation could not close',
            LOG_CATEGORY.SYSTEM,
            {
              component: 'CloudLiveConnection',
              code: 'live-identity-close-failed',
              kind: closing instanceof Error ? 'error' : 'non-error',
            }
          );
        });
      };
      this.stopIdentity = this.account.subscribe((identity) => {
        if (identity?.uid !== this.scope.uid)
          identityFailed(failure('account-changed', 'The signed-in live account changed.', 409));
        else if (identity.emailVerified !== true)
          identityFailed(
            failure('email-verification-required', 'Verify the live account email.', 403)
          );
      }, identityFailed);
      while (!this.stopped) {
        let retry = false;
        try {
          this.rotating = false;
          this._status(this.current === null ? 'connecting' : 'reconnecting');
          if (this.refreshIdentity) {
            await this.account.tokenContext(true);
            this.refreshIdentity = false;
            if (this.stopped) break;
          }
          const assetKey = this.current?.state?.publicScene.assetKey ?? this.view.assetKey;
          this.controller = new AbortController();
          this.source = await this.store.openEvents(
            this.id,
            { ...this.view, assetKey },
            this.scope,
            {
              cachedAssets: this.assets,
              signal: this.controller.signal,
            }
          );
          if (this.stopped) break;
          this._rotateBeforeDeadline();
          for await (const event of this.source) {
            if (this.stopped) break;
            if (event.kind === 'closed') {
              if (['invalid-identity', 'stream-deadline'].includes(event.code))
                this.refreshIdentity = true;
              throw failure(event.code, 'The live stream closed before another state.', 409);
            }
            await this._apply(event);
          }
          if (!this.stopped)
            throw failure(
              'cloud-stream-unavailable',
              'The live stream disconnected. Retry online.'
            );
        } catch (error) {
          if (this.stopped) break;
          if (this.rotating) {
            this._status('reconnecting', 'identity-renewal');
          } else if (
            !retryable.has(error.code) &&
            !(error.code === 'invalid-identity' && this.refreshIdentity)
          ) {
            await this._stop(error, terminalPhase(error));
          } else {
            this._status('reconnecting', error.code);
            retry = true;
          }
        } finally {
          clearTimeout(this.rotationTimer);
          const source = this.source;
          this.source = null;
          await source?.close();
          this.controller = null;
        }
        if (retry && !this.stopped) await this._backoff();
      }
    } catch (error) {
      if (!this.stopped) await this._stop(error, terminalPhase(error));
      else throw error;
    } finally {
      try {
        this.stopIdentity?.();
      } finally {
        this.resolveDone();
      }
    }
  }

  async close() {
    await this._stop();
    await this.done;
  }
}
