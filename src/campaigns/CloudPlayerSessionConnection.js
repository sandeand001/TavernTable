import { isCloudAccessScope, isCloudUUID } from './CloudProtocol.js';
import { validatePlayerCommandResult, scopePlayerReceipt } from './PlayerPublicProtocol.js';
import CloudParticipantAssets from './CloudParticipantAssets.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import {
  coalesceMovementPresentations,
  samePlacement,
} from '../scene/token-adapter/SavedPlacements.js';

const copy = (value) => structuredClone(value);
const failure = (status, code, message) => Object.assign(new Error(message), { status, code });
const ended = () =>
  failure(409, 'live-session-changed', 'Reopen the current live game before continuing.');
const terminal = new Set(['paused', 'ended', 'denied', 'error', 'closed']);

export default class CloudPlayerSessionConnection {
  constructor({ store, campaignId, access, sessionId, cache = null }) {
    if (
      !store ||
      store.uid !== access?.uid ||
      !isCloudAccessScope(access) ||
      access.role !== 'member' ||
      access.campaignId !== campaignId ||
      !isCloudUUID(sessionId) ||
      ['observeEvents', 'readParticipantSnapshot', 'commitWorldCommand'].some(
        (method) => typeof store[method] !== 'function'
      )
    )
      throw new Error('Cloud player gameplay requires current assigned live campaign access');
    this.store = store;
    this.campaignId = campaignId;
    this.access = copy(access);
    this.sessionId = sessionId;
    this.kind = 'cloud-player';
    this.listeners = new Set();
    this.waiters = new Set();
    this.reconciledCommands = new Set();
    this.selection = 0;
    this.closed = false;
    this.state = null;
    this.snapshot = null;
    this.assets = null;
    this.assetKey = null;
    this.phase = 'connecting';
    this.presentations = [];
    this.cache = cache;
    this.artworkVersion = 0;
    this.assetsStatus = { phase: 'idle' };
    this.participantAssets = new CloudParticipantAssets({
      store,
      cache,
      onStatus: (progress) => {
        if (this.closed) return;
        if (progress.cache) {
          this.cacheStatus = copy(progress.cache);
          this.assetsStatus = { ...this.assetsStatus, cache: this.cacheStatus };
        }
        this._emit({ type: 'assets-status', status: this.assetsStatus, progress });
      },
      onChanged: () => {
        if (this.closed || !this.state) return;
        try {
          this._identity();
        } catch (error) {
          return;
        }
        this._emit({
          type: 'artwork',
          state: this.participantAssets.decorate(this.state),
          generation: this.snapshot.generation,
          viewKey: this.snapshot.viewKey,
        });
      },
    });
    const account = this.store.connection.account;
    if (typeof account.subscribe === 'function') {
      try {
        this.unsubscribeAccount = account.subscribe(
          (identity) => {
            if (!this.closed && identity?.uid !== this.access.uid)
              this._endAccess(
                failure(
                  409,
                  'account-changed',
                  'This live game belongs to another signed-in account.'
                )
              );
          },
          () =>
            this._endAccess(
              failure(
                503,
                'identity-unavailable',
                'The current account could not be verified. Reopen its campaigns before playing.'
              )
            )
        );
        if (this.accessError) {
          this.unsubscribeAccount?.();
          this.unsubscribeAccount = null;
        }
      } catch (error) {
        this._endAccess(
          failure(
            503,
            'identity-unavailable',
            'The current account could not be verified. Reopen its campaigns before playing.'
          )
        );
      }
    }
  }

  get commandReady() {
    return (
      !this.closed &&
      this.state !== null &&
      this.phase === 'ready' &&
      this.assetsStatus.phase === 'ready'
    );
  }

  _assetStatus(phase, error = null) {
    this.assetsStatus = {
      phase,
      ...(this.cacheStatus ? { cache: this.cacheStatus } : {}),
      ...(error ? { error: { code: error.code, message: error.message } } : {}),
    };
    this._emit({ type: 'assets-status', status: this.assetsStatus });
  }

  _updateArtwork(snapshot) {
    const version = ++this.artworkVersion;
    this._assetStatus('loading');
    let updating;
    try {
      updating = this.participantAssets.update(snapshot, { cachedAssets: this.assets });
    } catch (error) {
      updating = Promise.reject(error);
    }
    const task = Promise.resolve(updating).then(
      () => {
        if (this.closed || version !== this.artworkVersion) return;
        this._identity();
        this._assetStatus('ready');
      },
      (error) => {
        if (!this.closed && version === this.artworkVersion) this._assetStatus('error', error);
        throw error;
      }
    );
    this.assetTask = task;
    void task.catch(() => {});
  }

  characterImages(characterId) {
    this._identity();
    return this.participantAssets.characterImages(characterId);
  }

  loadCharacterImages(characterId) {
    this._identity();
    return this.participantAssets.loadCharacterImages(characterId);
  }

  _invalidateArtwork() {
    this.artworkVersion++;
    this.assetTask = null;
    this.assetsStatus = {
      phase: 'idle',
      ...(this.cacheStatus ? { cache: this.cacheStatus } : {}),
    };
    this.participantAssets.invalidate();
    this._emit({ type: 'assets-status', status: this.assetsStatus });
  }

  invalidateAssets() {
    this._identity();
    this._invalidateArtwork();
  }

  _endAccess(error, status = { phase: 'denied', reason: error.code }) {
    if (this.closed || this.accessError) return;
    this.accessError = error;
    this.selection++;
    this.phase = status.phase;
    this._invalidateArtwork();
    this.state = null;
    this.snapshot = null;
    this.assets = null;
    this.assetKey = null;
    this.presentations = [];
    this._rejectWaiters(error);
    this._emit({ type: 'live-status', status });
    this._emit({
      type: 'access-ended',
      error: { status: error.status, code: error.code, message: error.message },
    });
    this.unsubscribeAccount?.();
    this.unsubscribeAccount = null;
    this.observationClosing = Promise.resolve(this.observation?.close());
    void this.observationClosing.catch(() => {
      logger.log(
        LOG_LEVEL.ERROR,
        'A cloud player observation failed to close',
        LOG_CATEGORY.SYSTEM,
        {
          component: 'CloudPlayerSessionConnection',
          code: 'player-observation-close-failed',
        }
      );
    });
  }

  _identity() {
    if (this.closed) throw ended();
    if (this.accessError) throw this.accessError;
    let identity;
    try {
      identity = this.store.connection.account.identity();
    } catch (error) {
      const unavailable = failure(
        503,
        'identity-unavailable',
        'The current account could not be verified. Reopen its campaigns before playing.'
      );
      this._endAccess(unavailable);
      throw unavailable;
    }
    if (identity?.uid !== this.access.uid) {
      const error = failure(
        409,
        'account-changed',
        'This live game belongs to another signed-in account.'
      );
      this._endAccess(error);
      throw error;
    }
  }

  _public(snapshot) {
    const state = copy(snapshot.state);
    state.profile = {
      id: this.access.uid,
      role: 'player',
      playerId: this.access.seatId,
      campaignId: this.campaignId,
      name: 'Player',
      characterIds: [...state.characterIds],
    };
    const actors = new Map(state.publicScene.actors.map((actor) => [actor.id, actor]));
    state.observers = state.observers.map((observer) => ({
      ...observer,
      ...(actors.has(observer.id) ? { mapId: actors.get(observer.id).mapId } : {}),
    }));
    state.publicScene.updates = [];
    return state;
  }

  _emit(event) {
    for (const listener of this.listeners) {
      try {
        const result = listener(copy(event));
        if (typeof result?.then === 'function')
          void Promise.resolve(result).catch((error) => this._listenerFailure(error));
      } catch (error) {
        this._listenerFailure(error);
      }
    }
  }

  _listenerFailure(error) {
    logger.log(LOG_LEVEL.ERROR, 'A cloud player listener failed', LOG_CATEGORY.SYSTEM, {
      component: 'CloudPlayerSessionConnection',
      code: 'player-listener-failed',
      kind: error instanceof Error ? 'error' : 'non-error',
    });
  }

  _rejectWaiters(error) {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  _wakeWaiters() {
    for (const waiter of [...this.waiters]) {
      if (waiter.version !== this.selection) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.reject(ended());
      } else if (this.state && waiter.matches(this.snapshot)) {
        clearTimeout(waiter.timer);
        this.waiters.delete(waiter);
        waiter.resolve({
          state: this.participantAssets.decorate(this.state),
          snapshot: copy(this.snapshot),
          reconcile: this.reconciled,
        });
      }
    }
  }

  _until(matches) {
    this._identity();
    if (this.state && matches(this.snapshot))
      return Promise.resolve({
        state: this.participantAssets.decorate(this.state),
        snapshot: copy(this.snapshot),
        reconcile: this.reconciled,
      });
    if (terminal.has(this.phase)) return Promise.reject(ended());
    return new Promise((resolve, reject) => {
      const waiter = { version: this.selection, matches, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        this.waiters.delete(waiter);
        reject(
          failure(
            504,
            'world-state-unavailable',
            'The command is confirmed; reconnect for current world state.'
          )
        );
      }, 60000);
      this.waiters.add(waiter);
    });
  }

  async open(options = {}) {
    this._identity();
    const version = ++this.selection;
    this._invalidateArtwork();
    this.presentations = [];
    this._rejectWaiters(ended());
    await this.observation?.close();
    this._identity();
    if (version !== this.selection) throw ended();
    if (options.placementGrantId !== undefined)
      throw failure(
        403,
        'placement-grant-required',
        'Choose an explicitly supported live arrival grant.'
      );
    let observerTokenId = options.observerTokenId;
    if (observerTokenId === undefined) {
      const initial = await this.store.readParticipantSnapshot(
        this.campaignId,
        {
          sessionId: this.sessionId,
          observerTokenId: null,
          mapId: null,
          assetKey: null,
        },
        this.access
      );
      this._identity();
      if (version !== this.selection) throw ended();
      observerTokenId = initial.state.observers[0]?.id ?? null;
    }
    const assetKey =
      options.assetKey === this.assetKey && this.assets !== null ? this.assetKey : null;
    this.state = null;
    this.snapshot = null;
    this.phase = 'connecting';
    this.observation = this.store.observeEvents(
      this.campaignId,
      {
        sessionId: this.sessionId,
        observerTokenId,
        mapId: options.mapId ?? null,
        assetKey,
      },
      this.access,
      {
        cachedAssets: assetKey === null ? null : this.assets,
        onState: (snapshot, context) => {
          if (this.closed || version !== this.selection) return;
          this._identity();
          if (
            ['version', 'uid', 'campaignId', 'role', 'seatId', 'accessGeneration'].some(
              (field) => snapshot.access?.[field] !== this.access[field]
            )
          ) {
            this._endAccess(
              failure(
                409,
                'campaign-access-changed',
                'Reopen the current assigned campaign access.'
              )
            );
            return;
          }
          if (snapshot.sessionId !== this.sessionId) {
            this._endAccess(ended());
            return;
          }
          this.snapshot = copy(snapshot);
          const overflow =
            !context.reconcile &&
            this.presentations.length + (context.presentations?.length || 0) > 256;
          this.reconciled = context.reconcile || overflow;
          this.presentations = this.reconciled
            ? []
            : [...this.presentations, ...copy(context.presentations || [])];
          this.state = this._public(snapshot);
          if (snapshot.state.publicScene.assetKey === null) this.assets = null;
          else this.assets = snapshot.state.publicScene.assets || this.assets;
          this.assetKey = snapshot.state.publicScene.assetKey;
          // Artwork tasks must not delay synchronous authority publication or receipt wakeups.
          this._updateArtwork(snapshot);
          const state = copy(this.state);
          state.publicScene.updates = this.reconciled
            ? []
            : coalesceMovementPresentations(this.presentations);
          this._emit({
            type: 'state',
            state,
            generation: snapshot.generation,
            reconcile: this.reconciled,
            ...(overflow ? { reason: 'presentation-backlog-resync' } : {}),
          });
          this._wakeWaiters();
        },
        onStatus: (status) => {
          if (this.closed || version !== this.selection) return;
          this.phase = status.phase;
          if (terminal.has(status.phase)) {
            const error = failure(
              status.phase === 'denied' ? 403 : 409,
              status.reason || 'live-session-changed',
              'Live world access ended. Reopen its current campaign.'
            );
            this._endAccess(error, status);
          } else this._emit({ type: 'live-status', status });
        },
      }
    );
    await this.observation.ready;
    this._identity();
    if (version !== this.selection || this.state === null) throw ended();
    let assetTask;
    do {
      assetTask = this.assetTask;
      await assetTask;
      this._identity();
      if (version !== this.selection || this.state === null) throw ended();
    } while (assetTask !== this.assetTask);
    return this.participantAssets.decorate(this.state);
  }

  get done() {
    return this.observation?.done || Promise.resolve();
  }

  readLiveState(sinceSceneRevision = 0) {
    this._identity();
    if (this.state === null) throw ended();
    if (!Number.isSafeInteger(sinceSceneRevision) || sinceSceneRevision < 0)
      throw failure(400, 'invalid-command', 'Choose the last rendered scene revision.');
    const state = this.participantAssets.decorate(this.state);
    const actors = new Map(state.publicScene.actors.map((actor) => [actor.id, actor]));
    state.publicScene.updates = coalesceMovementPresentations(
      this.presentations.filter(
        (entry) =>
          entry.sceneRevision > sinceSceneRevision &&
          entry.sceneRevision <= state.sceneRevision &&
          entry.charactersRevision <= state.revision
      )
    ).filter((entry) => samePlacement(entry.motion.route.at(-1), actors.get(entry.tokenId)));
    return state;
  }

  acknowledgeState(sceneRevision) {
    if (!Number.isSafeInteger(sceneRevision) || sceneRevision < 0)
      throw failure(400, 'invalid-command', 'Acknowledge a rendered scene revision.');
    this.presentations = this.presentations.filter((entry) => entry.sceneRevision > sceneRevision);
  }

  canAnimateReceipt(receipt) {
    return !this.reconciledCommands.has(receipt.commandId);
  }

  async call(operation, args = []) {
    this._identity();
    if (operation === 'playerState') return this.open(args[0] || {});
    if (args[0] !== this.campaignId)
      throw failure(403, 'campaign-not-found', 'This live campaign is not assigned to the player.');
    if (operation === 'playerCommand') {
      const command = copy(args[1]);
      if (this.phase !== 'ready')
        throw failure(
          409,
          'world-state-unavailable',
          'Wait for live world reconciliation before another command.'
        );
      if (!this.commandReady)
        throw failure(
          409,
          'participant-assets-loading',
          this.assetsStatus.error?.message ||
            'Wait for authorized artwork for the current live view before playing.'
        );
      const acknowledged = await this.store.commitWorldCommand(
        this.campaignId,
        {
          sessionId: this.sessionId,
          command,
        },
        this.access
      );
      const current = await this._until(
        (snapshot) => snapshot.generation >= acknowledged.applied.generation
      );
      this._identity();
      if (current.reconcile || current.snapshot.generation !== acknowledged.applied.generation)
        this.reconciledCommands.add(command.commandId);
      while (this.reconciledCommands.size > 512)
        this.reconciledCommands.delete(this.reconciledCommands.values().next().value);
      const receipt =
        acknowledged.presentation === null
          ? { kind: command.kind, tokenId: command.tokenId }
          : scopePlayerReceipt(acknowledged.presentation, current.state);
      const result = {
        version: 1,
        commandId: command.commandId,
        outcome: acknowledged.outcome,
        applied: {
          sceneRevision: acknowledged.applied.sceneRevision,
          charactersRevision: acknowledged.applied.charactersRevision,
        },
        receipt,
        state: current.state,
      };
      validatePlayerCommandResult(result, { cachedAssets: this.assets });
      return result;
    }
    if (operation === 'playerCommit') {
      const receipt = await this.store.commitAssignedCharacters(
        this.campaignId,
        args[1],
        this.access
      );
      await this._until((snapshot) => snapshot.state.revision >= receipt.revision);
      return receipt;
    }
    throw failure(400, 'invalid-command', 'This cloud player operation is not enabled.');
  }

  subscribe(listener) {
    if (typeof listener !== 'function')
      throw new Error('Player observation requires an event listener');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async logout() {
    await this.close();
    await this.store.connection.account.signOut();
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.selection++;
    this.artworkVersion++;
    this.assetTask = null;
    this.participantAssets.invalidate();
    this.unsubscribeAccount?.();
    this.unsubscribeAccount = null;
    this._rejectWaiters(ended());
    this.listeners.clear();
    this.state = null;
    this.snapshot = null;
    this.assets = null;
    this.assetKey = null;
    this.presentations = [];
    this.closing = Promise.all([
      this.observationClosing || this.observation?.close(),
      this.participantAssets.close(),
    ]).then(() => {});
    return this.closing;
  }
}
