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
const accessDenials = new Set([
  'campaign-access-changed',
  'campaign-not-found',
  'participant-view-forbidden',
  'live-session-changed',
  'live-session-paused',
  'cache-invalidated',
]);

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
    this.authorityCurrent = false;
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
    const browser = globalThis.window;
    const connectivity = () => {
      if (this.closed || this.accessError) return;
      this.authorityCurrent = false;
      this.phase = 'reconnecting';
      this.openController?.abort();
      this._invalidateArtwork();
      this._emit({
        type: 'live-status',
        status: { phase: 'reconnecting', reason: 'network-changed' },
      });
      this.observation?.reconnect?.();
    };
    browser?.addEventListener?.('offline', connectivity);
    browser?.addEventListener?.('online', connectivity);
    this.stopConnectivity = () => {
      browser?.removeEventListener?.('offline', connectivity);
      browser?.removeEventListener?.('online', connectivity);
    };
    const account = this.store.connection.account;
    this.unsubscribePrivate = this.store.connection.subscribePrivateInvalidation?.((uid) => {
      if (uid === this.access.uid)
        this._endAccess(
          failure(409, 'account-changed', 'This live game belongs to another signed-in account.')
        );
    });
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
          this.unsubscribePrivate?.();
          this.unsubscribePrivate = null;
          this.stopConnectivity();
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
      this.authorityCurrent &&
      globalThis.navigator?.onLine !== false &&
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
    let updating;
    let requiredReady = false;
    try {
      updating = this.participantAssets.update(snapshot, { cachedAssets: this.assets });
      requiredReady = this.participantAssets.requiredReady;
    } catch (error) {
      updating = Promise.reject(error);
    }
    this._assetStatus(requiredReady ? 'ready' : 'loading');
    const task = Promise.resolve(updating).then(
      (result) => {
        if (this.closed || version !== this.artworkVersion) return;
        this._identity();
        if (result?.reason === 'cache-invalidated') {
          this._endAccess(
            failure(
              503,
              'cache-invalidated',
              'This private scope was cleared. Reopen its current online authority.'
            )
          );
          return;
        }
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

  _invalidateArtwork({ purge = false, all = false } = {}) {
    this.artworkVersion++;
    this.assetTask = null;
    this.assetsStatus = {
      phase: 'idle',
      ...(this.cacheStatus ? { cache: this.cacheStatus } : {}),
    };
    if (purge) this.participantAssets.purge({ all, campaignId: this.campaignId });
    else this.participantAssets.invalidate();
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
    this.openController?.abort();
    this.phase = status.phase;
    this.authorityCurrent = false;
    this._invalidateArtwork({
      purge: error.code !== 'cache-invalidated',
      all: error.code === 'account-changed',
    });
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
    this.unsubscribePrivate?.();
    this.unsubscribePrivate = null;
    this.stopConnectivity();
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
    const opening = this._open(options);
    const version = this.selection;
    try {
      return await opening;
    } catch (error) {
      if (
        version === this.selection &&
        (accessDenials.has(error.code) || [401, 403, 404].includes(error.status))
      )
        this._endAccess(error);
      throw error;
    }
  }

  async _open(options) {
    this._identity();
    const version = ++this.selection;
    this.openController?.abort();
    const controller = new AbortController();
    this.openController = controller;
    const replacing =
      this.snapshot &&
      ((options.observerTokenId !== undefined &&
        options.observerTokenId !== this.snapshot.state.observerTokenId) ||
        (options.mapId !== undefined &&
          options.mapId !== this.snapshot.state.publicScene.presentation.mapId));
    const previousViewKey = replacing ? null : this.snapshot?.viewKey;
    this._invalidateArtwork({ purge: !!replacing });
    this.presentations = [];
    this.state = null;
    this.snapshot = null;
    this.phase = 'connecting';
    this.authorityCurrent = false;
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
    let candidate = await this.participantAssets.readCheckpointCandidate(this.access);
    this._identity();
    if (version !== this.selection) throw ended();
    if (
      candidate &&
      ((options.observerTokenId !== undefined &&
        options.observerTokenId !== candidate.state.observerTokenId) ||
        (options.mapId !== undefined &&
          options.mapId !== candidate.state.publicScene.presentation.mapId))
    ) {
      await this.participantAssets.purge({ campaignId: this.campaignId });
      this._identity();
      if (version !== this.selection) throw ended();
      candidate = null;
    }
    const retained = options.assetKey === this.assetKey && this.assets !== null;
    let cachedAssets = retained ? this.assets : (candidate?.state.publicScene.assets ?? null);
    let assetKey =
      cachedAssets === null
        ? null
        : retained
          ? this.assetKey
          : candidate.state.publicScene.assetKey;
    let observerTokenId = options.observerTokenId;
    let mapId = options.mapId ?? null;
    if (observerTokenId === undefined) {
      let initial;
      try {
        initial = await this.store.readParticipantSnapshot(
          this.campaignId,
          {
            sessionId: this.sessionId,
            observerTokenId: candidate?.state.observerTokenId ?? null,
            mapId: options.mapId ?? candidate?.state.publicScene.presentation.mapId ?? null,
            assetKey,
          },
          this.access,
          { cachedAssets, signal: controller.signal }
        );
      } catch (error) {
        this._identity();
        if (version !== this.selection) throw ended();
        if (!candidate || error.code !== 'participant-view-forbidden') throw error;
        await this.participantAssets.purge({ campaignId: this.campaignId });
        this._identity();
        if (version !== this.selection) throw ended();
        cachedAssets = null;
        assetKey = null;
        initial = await this.store.readParticipantSnapshot(
          this.campaignId,
          {
            sessionId: this.sessionId,
            observerTokenId: null,
            mapId: null,
            assetKey: null,
          },
          this.access,
          { signal: controller.signal }
        );
      }
      this._identity();
      if (version !== this.selection) throw ended();
      observerTokenId = initial.state.observerTokenId ?? initial.state.observers[0]?.id ?? null;
      mapId = options.mapId ?? initial.state.publicScene.presentation.mapId;
      assetKey = initial.state.publicScene.assetKey;
      cachedAssets = assetKey === null ? null : initial.state.publicScene.assets || cachedAssets;
    }
    this.assets = cachedAssets;
    this.assetKey = assetKey;
    this.observation = this.store.observeEvents(
      this.campaignId,
      {
        sessionId: this.sessionId,
        observerTokenId,
        mapId,
        assetKey,
      },
      this.access,
      {
        cachedAssets,
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
          if (!this.authorityCurrent && context.reconcile !== true) return;
          const superseded = this.snapshot?.viewKey ?? previousViewKey;
          if (superseded && superseded !== snapshot.viewKey)
            this._invalidateArtwork({ purge: true });
          this.snapshot = copy(snapshot);
          this.authorityCurrent = true;
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
          if (['connecting', 'reconnecting', 'synchronizing'].includes(status.phase))
            this.authorityCurrent = false;
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
    if (
      ['playerCommand', 'playerCommit', 'doorState'].includes(operation) &&
      (this.phase !== 'ready' || !this.authorityCurrent || globalThis.navigator?.onLine === false)
    )
      throw failure(
        503,
        'world-state-unavailable',
        'Wait for online live world reconciliation before another change.'
      );
    if (operation === 'doorState') {
      const change = args[1];
      if (
        !change ||
        typeof change !== 'object' ||
        Array.isArray(change) ||
        Object.keys(change).some(
          (key) => !['doorId', 'observerTokenId', 'sceneRevision', 'open'].includes(key)
        )
      )
        throw failure(400, 'invalid-command', 'Choose an explicit nearby player door change.');
      const acknowledged = await this.store.commitWorldCommand(
        this.campaignId,
        {
          sessionId: this.sessionId,
          command: {
            version: 1,
            commandId: this.store.crypto.randomUUID(),
            sceneRevision: change.sceneRevision,
            charactersRevision: this.state.revision,
            tokenId: change.observerTokenId,
            observerTokenId: change.observerTokenId,
            kind: 'door.state',
            payload: { doorId: change.doorId, open: change.open },
            view: {
              mapId: this.state.publicScene.presentation.mapId,
              assetKey: this.state.publicScene.assetKey,
            },
          },
        },
        this.access
      );
      await this._until((snapshot) => snapshot.generation >= acknowledged.applied.generation);
      this._identity();
      return { revision: acknowledged.applied.sceneRevision, door: acknowledged.door };
    }
    if (operation === 'playerCommand') {
      const command = copy(args[1]);
      if (command.kind === 'door.state')
        throw failure(400, 'invalid-command', 'Use the explicit player door operation.');
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
    this.openController?.abort();
    const purging = this.participantAssets.purge({ all: true });
    await this.close();
    await purging;
    await this.store.connection.account.signOut();
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.authorityCurrent = false;
    this.openController?.abort();
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
