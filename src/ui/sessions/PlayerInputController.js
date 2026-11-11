import { TOKEN_COMMANDS, getTokenCommand } from '../../config/TokenCommandConfig.js';
import { GameValidators } from '../../utils/Validation.js';
import PlayerTargetingController from './PlayerTargetingController.js';

const protocolKind = (action) =>
  action.flight
    ? `flight.${action.flight.kind === 'takeoff' ? 'takeoff' : action.flight.kind}`
    : 'emote';

export default class PlayerInputController {
  constructor({ gameManager, commands }) {
    this.gameManager = gameManager;
    this.commands = commands;
    this.targeting = new PlayerTargetingController({
      gameManager,
      getState: () => commands.getState(),
    });
    gameManager.playerInput = this;
  }

  requestMove(token, target) {
    if (!token) throw new Error('Select the active assigned character before moving');
    if (target.wallSurface && target.wallSurface.kind !== 'floor')
      throw new Error('The host has not enabled this surface movement command');
    return this.commands.move(token.id, {
      mapId: target.wallSurface?.mapId || this.gameManager.campaignMapId,
      gridX: target.gridX,
      gridY: target.gridY,
    });
  }

  async rollDice(sides, count, mode = 'normal') {
    if (
      !GameValidators.validateDiceSides(sides).isValid ||
      !GameValidators.validateDiceCount(count).isValid
    )
      throw new Error('Choose a supported die and a whole dice count');
    const state = this.commands.getState();
    const token = state.publicScene.actors.find(({ id }) => id === state.observerTokenId);
    if (!token?.owned) throw new Error('Choose a placed assigned character before rolling');
    return this.commands.send('roll', token.id, {
      expression: `${count}d${sides}`,
      label: `${token.name}: ${count}d${sides}`,
      mode,
    });
  }

  endTurn(token) {
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('Select the active assigned character before ending its turn');
    return this.commands.send('turn.end', token.id, {});
  }

  requestFacing(token, angle) {
    if (!this.gameManager.placedTokens.includes(token) || !Number.isFinite(angle))
      throw new Error('Facing requires a placed assigned character and a finite angle');
    const availability = this.commands.availability('facing', token.id);
    if (!availability.allowed)
      throw Object.assign(
        new Error(
          `Facing requires a host-authorized player command: ${availability.reason || availability.code}`
        ),
        { code: availability.code }
      );
    return this.commands.send('facing', token.id, { angle });
  }

  setMovementSettings(token, settings) {
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('Choose the active assigned character before changing its movement settings');
    return this.commands.send('movement.settings', token.id, settings);
  }

  async applyRadial(token, actionId) {
    const action = getTokenCommand(actionId);
    if (!action || action.disabled || action.subActions?.length || actionId === 'character-sheet')
      throw new Error('Choose an available creature sub-action');
    const kind = protocolKind(action);
    const available = this.commands.availability(kind, token.id);
    if (!available.allowed)
      throw Object.assign(
        new Error(
          `Creature actions require a host-authorized player command: ${available.reason || available.code}`
        ),
        { code: available.code }
      );
    if (kind === 'flight.drop') {
      if (!window.confirm('Drop and let the host resolve the actual fall, damage and landing?'))
        return { cancelled: true };
      const character = this.gameManager.characterServices.library.get(token.characterSheetId);
      const canSlowFall =
        character.classId === 'monk' &&
        character.level >= 4 &&
        this.ownedToken(token).economy.reactions > 0;
      const useSlowFall =
        canSlowFall && window.confirm('Use your available Slow Fall reaction for this fall?');
      return this.commands.send(kind, token.id, { useSlowFall });
    }
    return this.commands.send(
      kind,
      token.id,
      action.flight
        ? action.flight.feet && ['raise', 'lower'].includes(action.flight.kind)
          ? { feet: action.flight.feet }
          : {}
        : { actionId }
    );
  }

  stand(token) {
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('Choose the active assigned character before standing');
    return this.commands.send('stand', token.id, {});
  }

  roll(token, request) {
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('Select a placed assigned character before rolling');
    return this.commands.send('roll', token.id, request);
  }

  ownedToken(token) {
    const state = this.commands.getState();
    if (!state.publicScene.actors.some((actor) => actor.id === token.id && actor.owned))
      throw new Error('Only assigned, visible character gameplay is available');
    const own = state.gameplay.ownedTokens.find(({ tokenId }) => tokenId === token.id);
    if (!own) throw new Error('The host did not provide this assigned character gameplay');
    return own;
  }

  availableActions(token) {
    return this.ownedToken(token).availableActions;
  }

  async useAction(token, actionId, choice = {}) {
    if (!this.gameManager.placedTokens.includes(token))
      throw new Error('Select the active assigned character before using an action');
    const action = this.availableActions(token).find(({ id }) => id === actionId);
    if (!action) throw new Error('The host has not offered this action for the active character');
    const availability = this.commands.availability('action.use', token.id, { actionId });
    if (!availability.allowed)
      throw Object.assign(new Error(availability.reason || availability.code), {
        code: availability.code,
      });
    if (!action.targeting) return this.commands.send('action.use', token.id, { actionId, choice });
    try {
      const selected = await this.targeting.choose(token, action, choice);
      if (selected.cancelled) return selected;
      return await this.commands.send('action.use', token.id, {
        actionId,
        choice: selected.choice,
        targeting: selected.targeting,
      });
    } finally {
      this.targeting.finish();
    }
  }

  movementAllowance(token) {
    if (!token || !this.commands.availability('move', token.id).allowed) return null;
    return this.movementBudget(token).remainingFeet;
  }

  movementBudget(token) {
    const state = this.commands.getState();
    if (!state.publicScene.actors.some((actor) => actor.id === token.id && actor.owned))
      throw new Error('Only assigned movement budgets are available to this player');
    const movement = state.gameplay.ownedTokens.find(
      ({ tokenId }) => tokenId === token.id
    )?.movement;
    if (
      !movement ||
      !['spentFeet', 'remainingFeet'].every(
        (field) => Number.isFinite(movement[field]) && movement[field] >= 0
      )
    )
      throw new Error('The host returned an invalid movement budget');
    return { ...movement };
  }

  focus(token) {
    const gm = this.gameManager;
    if (!gm.placedTokens.includes(token) || !gm.publicPlayerPresentation.hasActor(token.id))
      throw new Error('This creature is no longer visible to the active character');
    const world = gm.token3DAdapter.getTokenViewPosition(token);
    if (typeof gm.threeSceneManager.setCameraTarget !== 'function')
      throw new Error('The game camera is not available');
    gm.threeSceneManager.setCameraTarget(world.x, world.z, world.y);
  }

  radialAvailability(token) {
    const owned =
      this.gameManager.placedTokens.includes(token) && token.owned && !!token.characterSheetId;
    const entries = TOKEN_COMMANDS.flatMap((action) => [action, ...(action.subActions || [])]);
    return Object.fromEntries(
      entries.map((action) => {
        if (action.id === 'character-sheet')
          return [
            action.id,
            {
              allowed: owned,
              reason: owned ? null : 'This character sheet is not assigned to the player.',
            },
          ];
        if (!owned)
          return [
            action.id,
            {
              allowed: false,
              reason: 'Choose the active assigned character for creature actions.',
            },
          ];
        const capability = this.commands.availability(protocolKind(action), token.id);
        return [
          action.id,
          {
            allowed: capability.allowed && !this.commands.pending,
            reason: this.commands.pending
              ? 'Wait for the current host command and presentation.'
              : capability.reason || capability.code.replaceAll('-', ' '),
          },
        ];
      })
    );
  }

  destroy() {
    this.targeting.destroy();
    if (this.gameManager.playerInput === this) delete this.gameManager.playerInput;
  }
}
