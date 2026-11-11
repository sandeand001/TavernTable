import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { validatePlayerCommand } from '../../campaigns/PlayerCommandProtocol.js';
import { validatePlayerCommandResult } from '../../campaigns/PlayerPublicProtocol.js';
import { validateAuthoritativeRoll } from '../../systems/dice/AuthoritativeDiceReplay.js';
import { getCharacterDefinition } from '../../config/CharacterCatalog.js';

export default class PlayerCommandAdapter {
  constructor({
    connection,
    getState,
    getCachedAssets = () => getState().publicScene.assets,
    createCommandId = () => crypto.randomUUID(),
    onReceipt = () => {},
    onFailure = () => {},
    onChanged = () => {},
  }) {
    this.connection = connection;
    this.getState = getState;
    this.getCachedAssets = getCachedAssets;
    this.createCommandId = createCommandId;
    this.onReceipt = onReceipt;
    this.onFailure = onFailure;
    this.onChanged = onChanged;
    this.pending = false;
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
    if (this.pending) throw new Error('Wait for the current host command to finish');
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
    this.lastRequest = { campaignId: state.campaign.id, command, origin };
    return this._submit(this.lastRequest);
  }

  async retry() {
    if (this.pending) throw new Error('Wait for the current host command to finish');
    if (!this.canRetry) throw new Error('There is no uncertain host command to retry');
    if (this.getState().observerTokenId !== this.lastRequest.command.observerTokenId)
      throw new Error('The active character changed. Reconnect before retrying the old command.');
    return this._submit(this.lastRequest);
  }

  async mutateScene(operation) {
    if (this.pending) throw new Error('Wait for the current host command to finish');
    if (this.canRetry)
      throw new Error('Resolve the uncertain host command before changing the board');
    if (this.stateError)
      throw new Error('Refresh the authorized game state or reconnect before changing the board');
    this.pending = true;
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
      finishIdle();
      this._publish();
    }
  }

  async _submit({ campaignId, command, origin }) {
    this.pending = true;
    let finishIdle;
    this.idle = new Promise((resolve) => {
      finishIdle = resolve;
    });
    this.failure = null;
    this._publish();
    try {
      const receipt = await this.connection.call('playerCommand', [campaignId, command]);
      validatePlayerCommandResult(receipt, { cachedAssets: this.getCachedAssets() });
      if (receipt.receipt.kind === 'roll') validateAuthoritativeRoll(receipt.receipt.roll);
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
      const animate = receipt.outcome === 'applied' && !this.seen.has(command.commandId);
      this.seen.add(command.commandId);
      if (this.seen.size > 512) this.seen.delete(this.seen.values().next().value);
      await this.onReceipt(receipt, { animate, command, origin });
      return receipt;
    } catch (error) {
      this.failure = error;
      await this.onFailure(error, { command });
      throw error;
    } finally {
      this.pending = false;
      finishIdle();
      this._publish();
    }
  }
}
