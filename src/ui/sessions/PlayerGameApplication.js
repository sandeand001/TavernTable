import PlayerCharacterSheets from './PlayerCharacterSheets.js';
import PublicPlayerRuntime from './PublicPlayerRuntime.js';
import PlayerCommandAdapter from './PlayerCommandAdapter.js';
import PlayerInputController from './PlayerInputController.js';
import PlayerControls from './PlayerControls.js';
import { connectCharacterServices } from '../characters/characterServices.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { validatePlayerState } from '../../campaigns/PlayerPublicProtocol.js';
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
        ['id', 'name', 'mapId', 'characterId'].some(
          (field) => typeof observer[field] !== 'string' || !observer[field]
        )
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
    actor.mapId !== observer.mapId
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
      onRetry: () => void this.commands.retry().catch((error) => this.fail(error)),
      onDice: (sides, count) => this.input.rollDice(sides, count),
      onArrival: (id) => this.chooseArrivalGrant(id),
      onPlace: (id, appearance, grantId) => this.commands.place(id, { appearance, grantId }),
      onRetrieve: (id) => this.commands.send('remove', id, {}),
    });
  }

  async start(state = this.state) {
    await this.showState(state);
    this.unsubscribe = this.connection.subscribe((event) => {
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
      if (!this.sheets.library.isSaving && !this.sheets.library.failure && !this.commands.pending)
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('pagehide', this.pageHide, { once: true });
    window.addEventListener('beforeunload', this.beforeUnload);
    return this;
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
    this.controls.update(state, { placementGrantId: this.placementGrantId });
    if (result.sharedMovements?.length) {
      this.presentationRevision = state.sceneRevision;
      try {
        await Promise.all(
          result.sharedMovements.map((motion) =>
            this.gameManager.token3DAdapter.playApprovedMovement(
              this.gameManager.placedTokens.find(({ id }) => id === motion.tokenId),
              motion
            )
          )
        );
      } finally {
        if (this.presentationRevision === state.sceneRevision)
          this.presentationRevision = undefined;
      }
    }
    return result;
  }

  async receiveReceipt(receipt, { animate, command }) {
    if (this.observerId !== command.observerTokenId || this.destroyed)
      return { applied: false, reason: 'superseded-selection' };
    if (command.kind === 'place') this.placementGrantId = null;
    const canAnimate =
      animate &&
      receipt.receipt.motion &&
      this.state.sceneRevision === command.sceneRevision &&
      receipt.state.sceneRevision === receipt.applied.sceneRevision;
    const movement = canAnimate
      ? {
          tokenId: command.tokenId,
          commandId: command.commandId,
          ...receipt.receipt.motion,
        }
      : null;
    const result = await this.showState(receipt.state, this.selectionVersion, { movement });
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
    if (this.openSheet) return this.openSheet(characterId);
    return this.sheets.open(characterId);
  }

  async chooseObserver(id) {
    if (!this.state.observers.some((observer) => observer.id === id))
      throw new Error('This character is not an available player observer');
    const version = ++this.selectionVersion;
    this.placementGrantId = null;
    this.observerId = id;
    this.mapId = null;
    this.input.targeting.cancel();
    this.dice.cancel();
    await this.runtime.clear();
    return this._readState({ observerTokenId: id }, version);
  }

  async chooseArea(id) {
    if (this.placementGrantId)
      throw new Error('The arrival preview is restricted to the DM-granted destination area');
    if (!this.state.maps.some((map) => map.id === id))
      throw new Error('This area is not available to the active character');
    const version = ++this.selectionVersion;
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
    const grant = this.state.placementGrants?.find((entry) => entry.id === id);
    if (!grant) throw new Error('Ask the DM for an authorized arrival grant for this character');
    const version = ++this.selectionVersion;
    this.placementGrantId = id;
    this.observerId = null;
    this.mapId = grant.mapId;
    this.input.targeting.cancel();
    this.dice.cancel();
    await this.runtime.clear();
    return this._readState({ placementGrantId: id, observerTokenId: null }, version);
  }

  async reconnect() {
    await this.commands.idle;
    await this.sheets.library.flush();
    location.reload();
  }

  async signOut() {
    await this.commands.idle;
    await this.sheets.library.flush();
    if (!this.accessEnded) await this.connection.logout();
    location.reload();
  }

  async fail(error) {
    this.controls.status.textContent = error.message;
    if (error.status === 401) {
      this.accessEnded = true;
      this.unsubscribe?.();
      this.connection.close();
      this.sheets.destroy();
      this.controls.endAccess();
      this.observerId = null;
      this.mapId = null;
    }
    this.input.targeting.cancel();
    this.dice.cancel();
    await this.runtime.clear();
    GameErrors.input(error, { component: 'PlayerGameApplication', operation: 'session' });
  }

  async commandFailed(error, { command }) {
    if (this.destroyed || this.accessEnded) return;
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
    this.refreshQueued = false;
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    if (this.pageHide) window.removeEventListener('pagehide', this.pageHide);
    if (this.beforeUnload) window.removeEventListener('beforeunload', this.beforeUnload);
    this.unsubscribe?.();
    this.connection.close();
    this.dice.destroy();
    this.input.destroy();
    this.sheets.destroy();
    await this.runtime.destroy();
    this.controls.destroy();
    this.resources?.close();
    if (this.gameManager.playerApplication === this) delete this.gameManager.playerApplication;
  }
}
