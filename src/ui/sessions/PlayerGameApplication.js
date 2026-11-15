import PlayerCharacterSheets from './PlayerCharacterSheets.js';
import PublicPlayerRuntime from './PublicPlayerRuntime.js';
import PlayerCommandAdapter from './PlayerCommandAdapter.js';
import PlayerInputController from './PlayerInputController.js';
import PlayerControls from './PlayerControls.js';
import CloudCacheControls from './CloudCacheControls.js';
import { connectCharacterServices } from '../characters/characterServices.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { validatePlayerState } from '../../campaigns/PlayerPublicProtocol.js';
import { isCloudWorldCommandReceipt } from '../../campaigns/CloudProtocol.js';
import AuthoritativeDiceReplay from '../../systems/dice/AuthoritativeDiceReplay.js';

function assertObserverSelection(state, cachedAssets) {
  validatePlayerState(state, { cachedAssets });
  if (state.publicScene?.version !== 1 || state.scene !== null)
    throw new Error('The host did not return an authorized interactive player snapshot');
  if (
    !Array.isArray(state.observers) ||
    state.observers.some(
      (observer) =>
        !observer ||
        ['id', 'name', 'characterId'].some(
          (field) => typeof observer[field] !== 'string' || !observer[field]
        ) ||
        (observer.mapId !== undefined && (typeof observer.mapId !== 'string' || !observer.mapId))
    ) ||
    new Set(state.observers.map(({ id }) => id)).size !== state.observers.length
  )
    throw new Error('The host returned invalid player observer options');
  if (state.observerTokenId === null) {
    return;
  }
  const observer = state.observers.find(({ id }) => id === state.observerTokenId);
  const actor = state.publicScene.actors.find(({ id }) => id === state.observerTokenId);
  if (
    !observer ||
    state.publicScene.presentation.focusTokenId !== observer.id ||
    !actor?.owned ||
    actor.characterId !== observer.characterId ||
    actor.mapId !== (observer.mapId ?? actor.mapId)
  )
    throw new Error('The host returned an invalid or unassigned player observer');
}

export default class PlayerGameApplication {
  constructor({ gameManager, connection, identity, catalog, initialState, openSheet = null }) {
    if (identity.role !== 'player' || initialState.profile.role !== 'player')
      throw new Error('Interactive player gameplay requires an authenticated player session');
    this.gameManager = gameManager;
    this.connection = connection;
    this.state = initialState;
    this.selectionVersion = 0;
    this.observerId = initialState.observerTokenId;
    this.mapId = initialState.publicScene?.presentation.mapId;
    this.openSheet = openSheet;
    this.sheets = new PlayerCharacterSheets({
      connection,
      catalog,
      state: initialState,
      displayImages:
        connection.kind === 'cloud-player' && typeof connection.characterImages === 'function'
          ? (id) => connection.characterImages(id)
          : null,
      onChanged: (id) => {
        this.controls?.update(this.state, { placementGrantId: this.placementGrantId });
        if (id) void this.refresh().catch((error) => this.fail(error));
      },
    });
    this.runtime = new PublicPlayerRuntime({ gameManager });
    this.dice = new AuthoritativeDiceReplay({ gameManager });
    this.commands = new PlayerCommandAdapter({
      connection,
      getCachedAssets: () => this.runtime.assets,
      getState: () => {
        if (this.destroyed || this.accessEnded)
          throw new Error('Player access ended. Reconnect before playing.');
        return this.state;
      },
      onReceipt: (receipt, context) => this.receiveReceipt(receipt, context),
      onFailure: (error, context) => this.commandFailed(error, context),
      onChanged: (commands) => {
        if (this.destroyed || this.accessEnded) return;
        this.controls?.updateCommandState(commands);
        window.dispatchEvent(
          new CustomEvent('taverntable:combatChanged', {
            detail: { gameManager },
          })
        );
      },
    });
    this.input = new PlayerInputController({ gameManager, commands: this.commands });
    connectCharacterServices(gameManager, {
      ...this.sheets.services,
      sheetContext: 'world',
    });
    this.controls = new PlayerControls({
      identity,
      library: this.sheets.library,
      onSheet: (id) => void this.showSheet(id).catch((error) => this.fail(error)),
      onObserver: (id) => void this.chooseObserver(id).catch((error) => this.fail(error)),
      onArea: (id) => void this.chooseArea(id).catch((error) => this.fail(error)),
      onReconnect: () => void this.reconnect().catch((error) => this.fail(error)),
      onSignOut: () => void this.signOut().catch((error) => this.fail(error)),
      onRetry: () => void this.recoverPendingCommand().catch((error) => this.fail(error)),
      onDice: (sides, count) => this.input.rollDice(sides, count),
      onArrival: (id) => this.chooseArrivalGrant(id),
      onPlace: (id, appearance, grantId) => this.commands.place(id, { appearance, grantId }),
      onRetrieve: (id) => this.commands.send('remove', id, {}),
      onDoor: (id, open) => this.changeDoor(id, open),
    });
    if (connection.kind === 'cloud-player' && connection.cache) {
      this.cacheControls = new CloudCacheControls({
        cache: connection.cache,
        uid: connection.access.uid,
        account: connection.store.connection.account,
        beforeClear: () => {
          if (this.destroyed || this.accessEnded)
            throw new Error('Reopen the current account before clearing its private cache.');
          if (
            this.commands.pending ||
            this.commands.canRetry ||
            this.presentationRevision !== undefined ||
            gameManager.placedTokens.some((token) =>
              gameManager.token3DAdapter.isMovementInProgress(token)
            )
          )
            throw new Error(
              'Finish the current player command or movement before clearing its private cache.'
            );
          this.pendingArtwork = null;
          connection.invalidateAssets();
        },
        onCleared: () => this._reopenCacheAuthority(),
      });
      this.controls.root.insertAdjacentElement('afterend', this.cacheControls.root);
      this.cacheControls.updateStatus(connection.assetsStatus);
    }
  }

  async start(state = this.state) {
    await this.showState(state);
    this.unsubscribe = this.connection.subscribe((event) => {
      if (event.type === 'assets-status' && this.connection.kind === 'cloud-player') {
        if (this.destroyed || this.accessEnded) return;
        this.cacheControls?.updateStatus(event.status);
        void this.cacheControls?.refreshUsage().catch(() => {});
        if (event.status.error) {
          const error = Object.assign(new Error(event.status.error.message), event.status.error);
          GameErrors.input(error, {
            component: 'PlayerGameApplication',
            operation: 'requiredArtwork',
          });
        }
        if (this.connection.commandReady === false) this._updateCommandReadiness();
        else if (!this.cloudUpdatePending && !this.cloudUpdateTask) {
          this._updateCommandReadiness();
          this.controls.update(this.state, { placementGrantId: this.placementGrantId });
        }
        return;
      }
      if (event.type === 'artwork' && this.connection.kind === 'cloud-player') {
        this._applyArtwork(event.state);
        void this.cacheControls?.refreshUsage().catch(() => {});
        return;
      }
      if (event.type === 'state' && this.connection.kind === 'cloud-player') {
        this.notifiedSceneRevision = Math.max(
          this.notifiedSceneRevision ?? -1,
          event.state.sceneRevision
        );
        this.notifiedCharactersRevision = Math.max(
          this.notifiedCharactersRevision ?? -1,
          event.state.revision
        );
        if (
          event.reconcile ||
          (this.presentationRevision !== undefined &&
            event.state.sceneRevision > this.presentationRevision &&
            !event.state.publicScene.updates.length)
        ) {
          for (const token of this.gameManager.placedTokens)
            this.gameManager.token3DAdapter.cancelApprovedMovement(token);
          this.dice.cancel();
        }
        this.cloudUpdatePending = true;
        this.commands.setStateError(new Error('Synchronizing the current live world...'));
        void this._drainCloudUpdates().catch((error) => this.fail(error));
        return;
      }
      if (event.type === 'live-status') {
        if (['connecting', 'synchronizing', 'reconnecting'].includes(event.status.phase)) {
          const unconfirmed =
            this.commands.pending ||
            this.commands.canRetry ||
            this.sheets.library.isSaving ||
            this.connection.store?.pending;
          const message = unconfirmed
            ? 'The original change is unconfirmed. Keep this tab open and recover the same command online.'
            : 'Synchronizing the live game. Editing is paused until current online state is verified.';
          this.commands.setStateError(new Error(message));
          this.controls.status.textContent = message;
        } else if (
          event.status.phase === 'ready' &&
          !this.cloudUpdatePending &&
          !this.cloudUpdateTask
        )
          this._updateCommandReadiness();
        return;
      }
      if (event.type === 'access-ended') {
        const error = Object.assign(new Error(event.error.message), event.error);
        void this.fail(error, { endAccess: true });
        return;
      }
      if (
        event.campaignId === this.state.campaign.id &&
        event.version === 1 &&
        Number.isSafeInteger(event.sceneRevision) &&
        Number.isSafeInteger(event.charactersRevision)
      ) {
        this.notifiedSceneRevision = Math.max(
          this.notifiedSceneRevision ?? -1,
          event.sceneRevision
        );
        this.notifiedCharactersRevision = Math.max(
          this.notifiedCharactersRevision ?? -1,
          event.charactersRevision
        );
        if (
          this.presentationRevision !== undefined &&
          event.sceneRevision > this.presentationRevision &&
          event.hasPresentations !== true
        ) {
          for (const token of this.gameManager.placedTokens)
            this.gameManager.token3DAdapter.cancelApprovedMovement(token);
          this.dice.cancel();
        }
      }
      if (event.type === 'disconnected') {
        this.controls.status.textContent = 'Disconnected. Reconnecting to the host...';
      } else if (event.type === 'invalid-update') {
        this.fail(new Error('Invalid session update. Reconnect before making further changes.'));
        return;
      }
      if (
        event.type === 'connected' ||
        event.type === 'disconnected' ||
        event.campaignId === this.state.campaign.id
      )
        void this.refresh().catch((error) => this.fail(error));
    });
    this.pageHide = () =>
      void this.destroy().catch((error) =>
        GameErrors.input(error, { component: 'PlayerGameApplication', operation: 'close' })
      );
    this.beforeUnload = (event) => {
      if (
        !this.sheets.library.isSaving &&
        !this.sheets.library.failure &&
        !this.commands.pending &&
        (!this.commands.canRetry || this.pendingRecovered)
      )
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('pagehide', this.pageHide, { once: true });
    window.addEventListener('beforeunload', this.beforeUnload);
    return this;
  }

  _updateCommandReadiness() {
    if (this.connection.kind === 'cloud-player' && this.connection.commandReady === false) {
      const status = this.connection.assetsStatus;
      const message =
        status?.error?.message ||
        (['idle', 'loading'].includes(status?.phase)
          ? 'Loading authorized artwork for the current live view. Wait before playing.'
          : 'Wait for live world reconciliation before playing.');
      if (this.readinessError?.message !== message)
        this.readinessError = Object.assign(new Error(message), {
          code: status?.error?.code || 'participant-assets-loading',
        });
      this.commands.setStateError(this.readinessError);
    } else {
      this.commands.setStateError(null);
      if (this.connection.kind === 'cloud-player') this.gameManager.cloudSaveFeedback?.reconciled();
    }
  }

  _applyArtwork(state, { defer = true } = {}) {
    if (this.destroyed || this.accessEnded) return;
    try {
      if (this.runtime.updateArtwork(state).applied) {
        this.pendingArtwork = null;
        this.sheets.refresh(this.state);
      } else if (
        defer &&
        state.sceneRevision >= this.runtime.revision &&
        (!this.pendingArtwork ||
          (state.sceneRevision >= this.pendingArtwork.sceneRevision &&
            state.revision >= this.pendingArtwork.revision))
      ) {
        this.pendingArtwork = state;
      }
    } catch (error) {
      this.controls.status.textContent = error.message;
      GameErrors.input(error, {
        component: 'PlayerGameApplication',
        operation: 'artwork',
      });
    }
  }

  async showState(state, version = this.selectionVersion, presentation = {}) {
    if (this.destroyed || this.accessEnded) return { applied: false, reason: 'application-closed' };
    if (version !== this.selectionVersion)
      return { applied: false, reason: 'superseded-selection' };
    if (
      state.sceneRevision < Math.max(this.runtime.revision, this.notifiedSceneRevision ?? -1) ||
      state.revision < Math.max(this.sheets.library.revision, this.notifiedCharactersRevision ?? -1)
    )
      return { applied: false, reason: 'stale-snapshot' };
    try {
      assertObserverSelection(state, this.runtime.assets);
      state = JSON.parse(JSON.stringify(state));
    } catch (error) {
      await this.fail(error);
      throw error;
    }
    await this.sheets.library.flush();
    if (this.destroyed || this.accessEnded) return { applied: false, reason: 'application-closed' };
    if (version !== this.selectionVersion)
      return { applied: false, reason: 'superseded-selection' };
    if (
      state.sceneRevision < this.runtime.revision ||
      state.revision < this.sheets.library.revision
    )
      return { applied: false, reason: 'stale-snapshot' };
    const previous = this.state;
    this.state = state;
    this.sheets.refresh(state);
    const result = await this.runtime.update(state, {
      ...presentation,
      placementGrantId: this.placementGrantId,
    });
    if (!result.applied) {
      if (this.state === state) this.state = previous;
      return result;
    }
    this.state = state;
    this.observerId = state.observerTokenId;
    this.mapId = this.runtime.mapId;
    const artwork = this.pendingArtwork;
    this.pendingArtwork = null;
    if (artwork) this._applyArtwork(artwork, { defer: false });
    this._updateCommandReadiness();
    this.controls.update(state, { placementGrantId: this.placementGrantId });
    if (result.sharedMovements?.length || result.sharedVisuals?.length) {
      this.presentationRevision = state.sceneRevision;
      try {
        await Promise.all(
          (result.sharedMovements || []).map((motion) =>
            this.gameManager.token3DAdapter.playApprovedMovement(
              this.gameManager.placedTokens.find(({ id }) => id === motion.tokenId),
              motion
            )
          )
        );
        for (const entry of result.sharedVisuals || []) {
          if (this.destroyed || this.accessEnded || version !== this.selectionVersion) break;
          await this.gameManager.token3DAdapter.playApprovedVisual(
            this.gameManager.placedTokens.find((token) => token.id === entry.tokenId),
            entry
          );
        }
      } finally {
        if (this.presentationRevision === state.sceneRevision)
          this.presentationRevision = undefined;
      }
    }
    return result;
  }

  async _drainCloudUpdates() {
    if (this.cloudUpdateTask) return this.cloudUpdateTask;
    this.cloudUpdateTask = (async () => {
      while (this.cloudUpdatePending && !this.destroyed && !this.accessEnded) {
        this.cloudUpdatePending = false;
        const version = this.selectionVersion;
        const state = this.connection.readLiveState(this.runtime.revision);
        const result = await this.showState(state, version);
        if (result.applied && version === this.selectionVersion)
          this.connection.acknowledgeState(state.sceneRevision);
      }
    })();
    try {
      return await this.cloudUpdateTask;
    } finally {
      this.cloudUpdateTask = null;
      if (this.cloudUpdatePending && !this.destroyed && !this.accessEnded)
        void this._drainCloudUpdates().catch((error) => this.fail(error));
    }
  }

  async receiveReceipt(receipt, { animate, command }) {
    if (this.connection.kind === 'cloud-player') await this._drainCloudUpdates();
    if (this.observerId !== command.observerTokenId || this.destroyed)
      return { applied: false, reason: 'superseded-selection' };
    if (command.kind === 'place') this.placementGrantId = null;
    const canAnimate =
      animate &&
      receipt.receipt.motion &&
      this.runtime.assetKey === receipt.state.publicScene.assetKey &&
      this.state.sceneRevision === command.sceneRevision &&
      receipt.state.sceneRevision === receipt.applied.sceneRevision;
    const movement = canAnimate
      ? {
          tokenId: command.tokenId,
          commandId: command.commandId,
          ...receipt.receipt.motion,
        }
      : null;
    const alreadyRenderedVisual =
      this.connection.kind === 'cloud-player' &&
      receipt.receipt.kind === 'emote' &&
      this.runtime.revision === receipt.state.sceneRevision &&
      this.state.sceneRevision === receipt.state.sceneRevision &&
      this.state.revision === receipt.state.revision;
    const result = alreadyRenderedVisual
      ? { applied: true, reason: 'already-rendered' }
      : await this.showState(receipt.state, this.selectionVersion, { movement });
    if (!result.applied) return result;
    if (movement) {
      const token = this.gameManager.placedTokens.find(({ id }) => id === command.tokenId);
      this.presentationRevision = receipt.applied.sceneRevision;
      try {
        return await this.gameManager.token3DAdapter.playApprovedMovement(token, movement);
      } finally {
        if (this.presentationRevision === receipt.applied.sceneRevision)
          this.presentationRevision = undefined;
      }
    }
    if (
      animate &&
      receipt.receipt.kind === 'emote' &&
      receipt.state.sceneRevision === receipt.applied.sceneRevision
    ) {
      const actor = receipt.state.publicScene.actors.find((actor) => actor.id === command.tokenId);
      return this.gameManager.token3DAdapter.playApprovedVisual(
        this.gameManager.placedTokens.find((token) => token.id === command.tokenId),
        {
          commandId: command.commandId,
          tokenId: command.tokenId,
          kind: 'emote',
          actionId: receipt.receipt.actionId,
          animationKey: receipt.receipt.animationKey,
          ...(receipt.receipt.from ? { from: receipt.receipt.from } : {}),
          placement: receipt.receipt.placement || {
            mapId: actor.mapId,
            gridX: actor.gridX,
            gridY: actor.gridY,
            facingAngle: actor.facingAngle,
            pose: actor.pose,
          },
        }
      );
    }
    if (
      animate &&
      receipt.receipt.roll &&
      receipt.state.sceneRevision === receipt.applied.sceneRevision
    ) {
      this.presentationRevision = receipt.applied.sceneRevision;
      let presentation;
      try {
        presentation = await this.dice.play(receipt.receipt.roll, {
          commandId: command.commandId,
        });
      } finally {
        if (this.presentationRevision === receipt.applied.sceneRevision)
          this.presentationRevision = undefined;
      }
      if (
        presentation.completed &&
        !this.destroyed &&
        !this.accessEnded &&
        this.observerId === command.observerTokenId &&
        this.state.sceneRevision === receipt.applied.sceneRevision
      ) {
        const roll = receipt.receipt.roll;
        if (this.controls.diceResult) this.controls.diceResult.textContent = roll.text;
        window.sidebarController?.addDiceLogEntry(roll.text, 'roll', roll.summary);
      }
      return presentation;
    }
    return result;
  }

  refresh() {
    if (this.destroyed || this.accessEnded)
      return Promise.resolve({ applied: false, reason: 'application-closed' });
    this.refreshQueued = true;
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = this._refreshQueued().finally(() => {
      this.refreshTask = null;
      if (this.refreshQueued && !this.destroyed && !this.accessEnded)
        this.refreshTimer = setTimeout(() => {
          this.refreshTimer = null;
          void this.refresh().catch((error) => this.fail(error));
        }, 0);
    });
    return this.refreshTask;
  }

  async _refreshQueued() {
    let result;
    for (let read = 0; read < 2 && this.refreshQueued; read++) {
      this.refreshQueued = false;
      const version = this.selectionVersion;
      await this.commands.idle;
      await this.sheets.library.flush();
      if (this.destroyed || this.accessEnded)
        return { applied: false, reason: 'application-closed' };
      if (version !== this.selectionVersion) {
        this.refreshQueued = true;
        continue;
      }
      result = await this._readState(
        {
          observerTokenId: this.observerId,
          ...(this.placementGrantId ? { placementGrantId: this.placementGrantId } : {}),
          mapId: this.mapId,
          assetKey: this.runtime.assetKey,
          sinceSceneRevision: this.runtime.revision >= 0 ? this.runtime.revision : undefined,
        },
        version
      );
    }
    return result;
  }

  async _readState(options, version) {
    let recovery = 0;
    let followed = false;
    while (!this.destroyed && !this.accessEnded) {
      try {
        const state = await this.connection.call('playerState', [
          { ...options, presentationVersion: 1 },
        ]);
        if (this.destroyed || this.accessEnded)
          return { applied: false, reason: 'application-closed' };
        if (version !== this.selectionVersion)
          return { applied: false, reason: 'superseded-selection' };
        const previous = this.state.observers.find(({ id }) => id === state.observerTokenId);
        const observer = state.observers?.find(({ id }) => id === state.observerTokenId);
        if (
          previous &&
          observer &&
          previous.mapId !== observer.mapId &&
          state.publicScene?.presentation.mapId !== observer.mapId
        ) {
          if (followed)
            throw new Error(
              'The host did not follow the relocated character into its current area'
            );
          followed = true;
          await this.runtime.clear();
          options = { observerTokenId: observer.id };
          continue;
        }
        return this.showState(state, version);
      } catch (error) {
        if (version !== this.selectionVersion)
          return { applied: false, reason: 'superseded-selection' };
        if (error.status !== 403 || recovery >= 2) throw error;
        await this.runtime.clear();
        recovery++;
        this.mapId = null;
        options = recovery === 1 ? { observerTokenId: this.observerId } : {};
        this.controls.status.textContent =
          'The selected viewpoint or map is unavailable. Requesting the authorized default...';
        GameErrors.input(error, {
          component: 'PlayerGameApplication',
          operation: 'refreshViewpoint',
        });
      }
    }
    return { applied: false, reason: 'application-closed' };
  }

  async showSheet(characterId) {
    if (this.destroyed || this.accessEnded)
      throw new Error('Player access ended. Reconnect before opening character data.');
    if (!this.sheets.library.list().some(({ id }) => id === characterId))
      throw new Error('This saved character is no longer assigned to the player');
    if (this.connection.kind === 'cloud-player') {
      const version = this.selectionVersion;
      try {
        await this.connection.loadCharacterImages(characterId);
      } catch (error) {
        if (this.destroyed || this.accessEnded || version !== this.selectionVersion)
          return { applied: false, reason: 'superseded-selection' };
        throw error;
      }
      if (this.destroyed || this.accessEnded || version !== this.selectionVersion)
        return { applied: false, reason: 'superseded-selection' };
      if (!this.sheets.library.list().some(({ id }) => id === characterId))
        throw new Error('This saved character is no longer assigned to the player');
    }
    if (this.openSheet) return this.openSheet(characterId);
    return this.sheets.open(characterId);
  }

  async _reopenCacheAuthority() {
    if (this.destroyed || this.accessEnded)
      throw new Error('Reopen the current live game before reloading private artwork.');
    const version = ++this.selectionVersion;
    const state = await this.connection.open({
      observerTokenId: this.observerId,
      mapId: this.mapId,
      assetKey: this.runtime.assetKey,
    });
    if (this.destroyed || this.accessEnded || version !== this.selectionVersion)
      throw new Error('The live viewpoint changed while reloading its private cache.');
    await this._drainCloudUpdates();
    if (this.destroyed || this.accessEnded || version !== this.selectionVersion)
      throw new Error('The live viewpoint changed while reloading its private cache.');
    this._applyArtwork(state);
    this._updateCommandReadiness();
  }

  async changeDoor(doorId, open) {
    return this.commands.mutateScene(async () => {
      await this.sheets.library.flush();
      if (this.destroyed || this.accessEnded)
        throw new Error('Player access ended. Reconnect before using a door.');
      const state = this.state;
      const door = state.doors?.find(({ id }) => id === doorId);
      if (!state.observerTokenId || !door || typeof open !== 'boolean')
        throw new Error('Choose a nearby visible door for your active assigned character');
      if (door.locked) throw new Error('This door is locked. Ask the DM to unlock it.');
      const version = ++this.selectionVersion;
      this.input.targeting.cancel();
      this.dice.cancel();
      await this.runtime.clear();
      try {
        const receipt = await this.connection.call('doorState', [
          state.campaign.id,
          {
            doorId,
            observerTokenId: state.observerTokenId,
            sceneRevision: state.sceneRevision,
            open,
          },
        ]);
        if (
          receipt?.revision !== state.sceneRevision + 1 ||
          receipt.door?.id !== doorId ||
          receipt.door.open !== open ||
          typeof receipt.door.locked !== 'boolean'
        )
          throw new Error('The host returned an invalid door change receipt');
        return await this._readState(
          { observerTokenId: state.observerTokenId, mapId: this.mapId },
          version
        );
      } catch (error) {
        if ([403, 409].includes(error.status) && version === this.selectionVersion) {
          try {
            await this._readState({ observerTokenId: state.observerTokenId }, version);
          } catch (refreshError) {
            await this.fail(refreshError);
            throw refreshError;
          }
          GameErrors.input(error, { component: 'PlayerGameApplication', operation: 'doorState' });
        } else {
          await this.fail(error);
        }
        throw error;
      }
    });
  }

  _selectionReady() {
    if (this.destroyed || this.accessEnded)
      throw new Error('Player access ended. Reopen current account access before changing views.');
    if (
      this.commands.pending ||
      this.commands.canRetry ||
      this.sheets.library.isSaving ||
      this.connection.store?.pending
    )
      throw new Error('Recover the original command online before changing player views.');
  }

  async chooseObserver(id) {
    this._selectionReady();
    if (!this.state.observers.some((observer) => observer.id === id))
      throw new Error('This character is not an available player observer');
    const version = ++this.selectionVersion;
    this.pendingArtwork = null;
    if (this.connection.kind === 'cloud-player') this.connection.invalidateAssets?.();
    this.placementGrantId = null;
    this.observerId = id;
    this.mapId = null;
    this.input.targeting.cancel();
    this.dice.cancel();
    await this.runtime.clear();
    return this._readState({ observerTokenId: id }, version);
  }

  async chooseArea(id) {
    this._selectionReady();
    if (this.placementGrantId)
      throw new Error('The arrival preview is restricted to the DM-granted destination area');
    if (!this.state.maps.some((map) => map.id === id))
      throw new Error('This area is not available to the active character');
    const version = ++this.selectionVersion;
    this.pendingArtwork = null;
    if (this.connection.kind === 'cloud-player') this.connection.invalidateAssets?.();
    this.mapId = id;
    this.input.targeting.cancel();
    this.dice.cancel();
    await this.runtime.clear();
    return this._readState(
      {
        observerTokenId: this.observerId,
        mapId: id,
      },
      version
    );
  }

  async chooseArrivalGrant(id) {
    this._selectionReady();
    const grant = this.state.placementGrants?.find((entry) => entry.id === id);
    if (!grant) throw new Error('Ask the DM for an authorized arrival grant for this character');
    const version = ++this.selectionVersion;
    this.pendingArtwork = null;
    if (this.connection.kind === 'cloud-player') this.connection.invalidateAssets?.();
    this.placementGrantId = id;
    this.observerId = null;
    this.mapId = grant.mapId;
    this.input.targeting.cancel();
    this.dice.cancel();
    await this.runtime.clear();
    return this._readState({ placementGrantId: id, observerTokenId: null }, version);
  }

  async reconnect() {
    if (this.commands.canRetry && !this.pendingRecovered)
      throw new Error('Recover the original command online before reopening the live game.');
    await this.commands.idle;
    await this.sheets.library.flush();
    location.reload();
  }

  async signOut() {
    if (this.commands.canRetry && !this.pendingRecovered)
      throw new Error('Recover the original command online before signing out.');
    await this.commands.idle;
    await this.sheets.library.flush();
    if (!this.accessEnded || this.connection.kind === 'cloud-player')
      await this.connection.logout();
    location.reload();
  }

  async recoverPendingCommand() {
    if (!this.accessEnded) return this.commands.retry();
    const connection = this.connection;
    const original = this.commands.lastRequest;
    const account = connection.store?.connection.account;
    if (
      connection.kind !== 'cloud-player' ||
      !this.commands.canRetry ||
      this.pendingRecovered ||
      !original
    )
      throw new Error('There is no original unconfirmed cloud command to recover.');
    if (account.identity()?.uid !== connection.access.uid)
      throw Object.assign(new Error('Sign in to the original account before command recovery.'), {
        status: 409,
        code: 'account-changed',
      });
    await account.tokenContext(true);
    const result = await connection.store.retryWorldCommand();
    const { presentation, ...receipt } = result;
    if (
      !isCloudWorldCommandReceipt(receipt) ||
      receipt.commandId !== original.command.commandId ||
      receipt.campaignId !== original.campaignId ||
      receipt.sessionId !== connection.sessionId ||
      receipt.kind !== original.command.kind ||
      (receipt.outcome === 'duplicate' && presentation !== null) ||
      receipt.access.uid !== connection.access.uid ||
      receipt.access.seatId !== connection.access.seatId ||
      receipt.access.accessGeneration !== connection.access.accessGeneration
    )
      throw new Error('The original cloud command receipt could not be verified.');
    this.pendingRecovered = true;
    this.controls.retry.hidden = true;
    this.controls.status.textContent =
      'Original command confirmed. Reopen the current authorized live game before editing.';
    return result;
  }

  async fail(error, { endAccess = false } = {}) {
    this.pendingArtwork = null;
    this.commands.setStateError(error);
    this.controls.status.textContent = error.message;
    let closing;
    if (error.status === 401 || endAccess) {
      this.accessEnded = true;
      this.unsubscribe?.();
      closing = this.connection.close();
      this.sheets.destroy();
      this.controls.endAccess({ clearPrivate: this.connection.kind === 'cloud-player' });
      if (this.connection.kind === 'cloud-player') this.state = null;
      this.observerId = null;
      this.mapId = null;
    }
    this.input.targeting.cancel();
    this.dice.cancel();
    await Promise.all([this.runtime.clear(), closing]);
    GameErrors.input(error, { component: 'PlayerGameApplication', operation: 'session' });
  }

  async commandFailed(error, { command }) {
    if (this.destroyed || this.accessEnded) return;
    if (error.code === 'participant-assets-loading') {
      this._updateCommandReadiness();
      return;
    }
    if (error.status === 401) {
      await this.fail(error);
      return;
    }
    if ([403, 409].includes(error.status) && this.observerId === command.observerTokenId) {
      this.input.targeting.cancel();
      this.dice.cancel();
      this.gameManager.threeSceneManager.scene.visible = false;
      await this.sheets.library.flush();
      try {
        await this._readState(
          {
            observerTokenId: this.observerId,
            mapId: this.mapId,
            assetKey: this.runtime.assetKey,
            sinceSceneRevision: this.runtime.revision,
          },
          this.selectionVersion
        );
      } catch (refreshError) {
        await this.fail(refreshError);
        throw refreshError;
      }
    }
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.pendingArtwork = null;
    this.refreshQueued = false;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.pageHide) window.removeEventListener('pagehide', this.pageHide);
    if (this.beforeUnload) window.removeEventListener('beforeunload', this.beforeUnload);
    this.unsubscribe?.();
    const closing = this.connection.close();
    this.dice.destroy();
    this.input.destroy();
    this.sheets.destroy();
    await Promise.all([
      this.runtime.destroy(),
      this.cloudUpdateTask,
      closing,
      this.cacheControls?.destroy(),
    ]);
    this.controls.destroy();
    this.resources?.close();
    if (this.gameManager.playerApplication === this) delete this.gameManager.playerApplication;
  }
}
