import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { validatePlayerCommand } from '../../campaigns/PlayerCommandProtocol.js';
import {
  validatePlayerCommandAcknowledgement,
  validatePlayerCommandResult,
} from '../../campaigns/PlayerPublicProtocol.js';
import { validateAuthoritativeRoll } from '../../systems/dice/AuthoritativeDiceReplay.js';
import { getCharacterDefinition } from '../../config/CharacterCatalog.js';

const STALE_REBASE_LIMIT = 16;
const STALE_REBASE_WINDOW_MS = 3000;

export default class PlayerCommandAdapter {
  constructor({
    connection,
    getState,
    getCachedAssets = () => getState().publicScene.assets,
    createCommandId = () => crypto.randomUUID(),
    onReceipt = () => {},
    onAccepted = () => {},
    onFailure = () => {},
    onChanged = () => {},
  }) {
    this.connection = connection;
    this.getState = getState;
    this.getCachedAssets = getCachedAssets;
    this.createCommandId = createCommandId;
    this.onReceipt = onReceipt;
    this.onAccepted = onAccepted;
    this.onFailure = onFailure;
    this.onChanged = onChanged;
    this.pending = false;
    this.submitting = false;
    this.mutationPending = false;
    this.idle = Promise.resolve();
    this.failure = null;
    this.stateError = null;
    this.lastRequest = null;
    this.seen = new Set();
  }

  get canRetry() {
    return (
      !!this.lastRequest &&
      !!this.failure &&
      (this.failure.status === undefined || this.failure.status >= 500)
    );
  }

  _publish() {
    try {
      this.onChanged(this);
    } catch (error) {
      GameErrors.input(error, { component: 'PlayerCommandAdapter', operation: 'notify' });
    }
  }

  setStateError(error) {
    if (this.stateError === error) return;
    this.stateError = error;
    this._publish();
  }

  move(tokenId, target) {
    return this.send('move', tokenId, { target });
  }

  _commandBaseline(state, command) {
    const actor = state.publicScene.actors.find(({ id }) => id === command.tokenId);
    const owned = state.gameplay.ownedTokens.find(({ tokenId }) => tokenId === command.tokenId);
    const grant =
      command.kind === 'place'
        ? state.placementGrants?.find(
            (entry) =>
              entry.id === command.payload.grantId &&
              entry.characterId === command.payload.characterId
          )
        : null;
    return JSON.stringify({
      observerTokenId: state.observerTokenId,
      actor,
      owned,
      turn: state.gameplay.turn,
      grant,
    });
  }

  place(characterId, { appearance, grantId }) {
    return this.send('place', null, { characterId, appearance, grantId });
  }

  availability(kind, tokenId, payload = {}) {
    const state = this.getState();
    if (state.gameplay?.version !== 1 || !Array.isArray(state.gameplay.commands))
      throw new Error('The host has not supplied valid player gameplay capabilities');
    if (this.canRetry)
      return {
        allowed: false,
        code: 'uncertain-command',
        reason:
          'Resolve the uncertain host command with same-ID retry or reconnect before playing.',
      };
    if (this.stateError)
      return {
        allowed: false,
        code: 'player-state-unavailable',
        reason: 'Refresh the authorized game state or reconnect before playing.',
      };
    if (!state.gameplay.commands.includes(kind))
      return { allowed: false, code: 'unsupported-command' };
    if (kind === 'place') {
      const grant = state.placementGrants?.find(
        (entry) => entry.id === payload.grantId && entry.characterId === payload.characterId
      );
      if (!grant || !state.profile.characterIds.includes(payload.characterId))
        return {
          allowed: false,
          code: 'placement-grant-required',
          reason: 'Ask the DM for an arrival grant for this assigned character.',
        };
      if (state.gameplay.turn?.active)
        return {
          allowed: false,
          code: 'combat-dm-only',
          reason: 'Only the DM may place or retrieve sprites during combat.',
        };
      if (
        state.observerTokenId !== null ||
        state.view?.mode !== 'placement-preview' ||
        state.view.id !== grant.mapId
      )
        return {
          allowed: false,
          code: 'arrival-preview-required',
          reason: 'Open the DM-granted arrival preview before placing this character.',
        };
      if (!getCharacterDefinition(payload.appearance))
        return {
          allowed: false,
          code: 'appearance-required',
          reason: 'Choose a canonical Next sprite before placement.',
        };
      return { allowed: true, code: 'allowed' };
    }
    if (
      tokenId !== state.observerTokenId ||
      !state.publicScene?.actors.some((actor) => actor.id === tokenId && actor.owned)
    )
      return { allowed: false, code: 'active-assigned-character-required' };
    const token = state.gameplay.ownedTokens.find((entry) => entry.tokenId === tokenId);
    const availability = token?.availability[kind];
    if (!availability)
      return {
        allowed: false,
        code: 'availability-unavailable',
        reason: 'The host has not provided eligibility for this action yet.',
      };
    if (typeof availability.allowed !== 'boolean')
      throw new Error('The host has not supplied valid player action availability');
    if (
      availability.allowed &&
      kind === 'action.use' &&
      payload.actionId &&
      !token.availableActions.some(({ id }) => id === payload.actionId)
    )
      return {
        allowed: false,
        code: 'action-unavailable',
        reason: 'The host has not offered this action for the active character.',
      };
    return availability;
  }

  async send(kind, tokenId, payload) {
    if (this.pending) {
      if (this.mutationPending) throw new Error('Wait for the current host command to finish');
      const queuedPayload = JSON.parse(JSON.stringify(payload));
      const idle = this.idle;
      return idle.then(() => this.send(kind, tokenId, queuedPayload));
    }
    const availability = this.availability(kind, tokenId, payload);
    if (!availability.allowed)
      throw Object.assign(
        new Error(availability.reason || `Player action unavailable: ${availability.code}`),
        {
          code: availability.code,
        }
      );
    const state = this.getState();
    const command = {
      version: 1,
      commandId: this.createCommandId(),
      sceneRevision: state.sceneRevision,
      charactersRevision: state.revision,
      observerTokenId: state.observerTokenId,
      tokenId,
      kind,
      payload: JSON.parse(JSON.stringify(payload)),
      view: {
        mapId: kind === 'place' ? state.view.id : state.publicScene.presentation.mapId,
        assetKey: kind === 'place' ? state.view.presentation.assetKey : state.publicScene.assetKey,
      },
    };
    validatePlayerCommand(command);
    const actor = state.publicScene.actors.find(({ id }) => id === tokenId);
    const origin =
      kind === 'place'
        ? null
        : JSON.parse(
            JSON.stringify({
              mapId: actor.mapId,
              gridX: actor.gridX,
              gridY: actor.gridY,
              pose: actor.pose,
              facingAngle: actor.facingAngle,
            })
          );
    this.lastRequest = {
      campaignId: state.campaign.id,
      command,
      origin,
      baseline: this._commandBaseline(state, command),
      startedAt: Date.now(),
    };
    return this._submit(this.lastRequest);
  }

  async retry() {
    if (this.pending) throw new Error('Wait for the current host command to finish');
    if (!this.canRetry) throw new Error('There is no uncertain host command to retry');
    if (this.getState().observerTokenId !== this.lastRequest.command.observerTokenId)
      throw new Error('The active character changed. Reconnect before retrying the old command.');
    return this._submit(this.lastRequest);
  }

  acceptLive(result) {
    const request = this.lastRequest;
    if (
      !request ||
      this.lastRequest !== request ||
      !this.pending ||
      !request.acceptLive ||
      result?.commandId !== request.command.commandId
    )
      return false;
    try {
      validatePlayerCommandAcknowledgement(result, { cachedAssets: this.getCachedAssets() });
    } catch (error) {
      GameErrors.input(error, {
        component: 'PlayerCommandAdapter',
        operation: 'validateAcceptedCommand',
        commandId: result?.commandId,
      });
      return false;
    }
    if (
      result.actorId !== this.getState().profile.id ||
      result.campaignId !== request.campaignId ||
      result.receipt.kind !== request.command.kind ||
      result.receipt.tokenId !== request.command.tokenId
    )
      return false;
    request.acceptLive(result);
    return true;
  }

  async mutateScene(operation) {
    if (this.pending) throw new Error('Wait for the current host command to finish');
    if (this.canRetry)
      throw new Error('Resolve the uncertain host command before changing the board');
    if (this.stateError)
      throw new Error('Refresh the authorized game state or reconnect before changing the board');
    this.pending = true;
    this.mutationPending = true;
    this.failure = null;
    let finishIdle;
    this.idle = new Promise((resolve) => {
      finishIdle = resolve;
    });
    this._publish();
    try {
      return await operation();
    } finally {
      this.pending = false;
      this.mutationPending = false;
      finishIdle();
      this._publish();
    }
  }

  async _rebaseStale(request, error) {
    const { command } = request;
    if (
      error?.status !== 409 ||
      error?.code !== 'stale-revision' ||
      Date.now() - request.startedAt >= STALE_REBASE_WINDOW_MS
    )
      return false;
    const current = await this.connection.call('playerState', [
      {
        presentationVersion: 1,
        observerTokenId: command.observerTokenId,
        mapId: command.view.mapId,
        assetKey: command.view.assetKey,
        sinceSceneRevision: command.sceneRevision,
      },
    ]);
    if (this._commandBaseline(current, command) !== request.baseline) return false;
    if (
      current.sceneRevision <= command.sceneRevision &&
      current.revision <= command.charactersRevision
    )
      return false;
    request.command = {
      ...command,
      sceneRevision: current.sceneRevision,
      charactersRevision: current.revision,
    };
    validatePlayerCommand(request.command);
    this.lastRequest = request;
    return true;
  }

  async _submit(request) {
    const { campaignId } = request;
    this.pending = true;
    this.submitting = true;
    let finishIdle;
    this.idle = new Promise((resolve) => {
      finishIdle = resolve;
    });
    this.failure = null;
    this._publish();
    try {
      for (let rebase = 0; rebase <= STALE_REBASE_LIMIT; rebase++) {
        const { command, origin } = request;
        try {
          let resolveLive;
          const liveReceipt = new Promise((resolve) => {
            resolveLive = resolve;
          });
          request.acceptLive = resolveLive;
          const response = this.connection.call('playerCommand', [campaignId, command]);
          const received = await Promise.race([
            response.then((receipt) => ({ receipt, live: false })),
            liveReceipt.then((receipt) => ({ receipt, live: true })),
          ]);
          const { receipt, live } = received;
          if (live) {
            response.catch((error) => {
              GameErrors.input(error, {
                component: 'PlayerCommandAdapter',
                operation: 'reconcileAcceptedCommand',
                commandId: command.commandId,
              });
            });
            const animate =
              receipt.outcome === 'applied' &&
              !this.seen.has(command.commandId) &&
              this.connection.canAnimateReceipt?.(receipt) !== false;
            this.seen.add(command.commandId);
            if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
            try {
              await this.onAccepted(receipt, { animate, command, origin });
            } catch (error) {
              GameErrors.input(error, {
                component: 'PlayerCommandAdapter',
                operation: 'presentAcceptedCommand',
                commandId: command.commandId,
              });
            }
            this.failure = null;
            return receipt;
          }
          validatePlayerCommandResult(receipt, { cachedAssets: this.getCachedAssets() });
          if (
            receipt.receipt.kind === 'roll' &&
            (receipt.outcome === 'applied' || receipt.receipt.roll !== undefined)
          )
            validateAuthoritativeRoll(receipt.receipt.roll);
          if (
            receipt?.version !== 1 ||
            receipt.commandId !== command.commandId ||
            !['applied', 'duplicate'].includes(receipt.outcome) ||
            receipt.receipt?.kind !== command.kind ||
            (command.kind === 'place'
              ? receipt.receipt.characterId !== command.payload.characterId
              : receipt.receipt.tokenId !== command.tokenId) ||
            !Number.isSafeInteger(receipt.applied?.sceneRevision) ||
            !Number.isSafeInteger(receipt.applied?.charactersRevision) ||
            receipt.state?.publicScene?.version !== 1
          )
            throw new Error('The host returned an invalid player command receipt');
          const animate =
            receipt.outcome === 'applied' &&
            !this.seen.has(command.commandId) &&
            this.connection.canAnimateReceipt?.(receipt) !== false;
          this.seen.add(command.commandId);
          if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
          await this.onReceipt(receipt, { animate, command, origin });
          return receipt;
        } catch (error) {
          if (rebase < STALE_REBASE_LIMIT && (await this._rebaseStale(request, error))) {
            await new Promise((resolve) => setTimeout(resolve, Math.min(rebase * 4, 16)));
            continue;
          }
          throw error;
        }
      }
      throw new Error('The host command could not be rebased after concurrent updates');
    } catch (error) {
      this.failure = error;
      await this.onFailure(error, { command: request.command });
      throw error;
    } finally {
      request.acceptLive = null;
      this.pending = false;
      this.submitting = false;
      finishIdle();
      this._publish();
    }
  }
}
