import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';
import { syncLinkedCreatureNames } from '../../entities/creatures/CreatureNames.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import {
  getTokenMovementSettings,
  linkTokenCharacter,
  getTokenFallTraits,
  getTokenConditions,
} from '../../entities/creatures/TokenMovement.js';
import CombatSession from '../../entities/characters/CombatSession.js';
import FallingController from './FallingController.js';
import TargetingController from './TargetingController.js';

const pendingCharacters = new WeakMap();

export function connectCharacterServices(gameManager, services) {
  if (
    !services?.library?.ruleset ||
    services.library.ruleset !== services.catalog?.ruleset ||
    (services.campaign && services.campaign.ruleset !== services.library.ruleset)
  ) {
    throw new Error('Character services require a matching campaign ruleset and catalog');
  }
  if (services.sessionRole === 'player' && gameManager.playerInput) {
    gameManager.characterServices?.falling?.dispose();
    gameManager.characterServices?.targeting?.dispose();
    const connected = {
      ...services,
      combat: null,
      falling: null,
      targeting: null,
      playerGameplay: gameManager.playerInput,
    };
    gameManager.characterServices = connected;
    return connected;
  }
  if (
    gameManager.characterServices?.library === services.library &&
    gameManager.characterServices.combat
  )
    return gameManager.characterServices;
  gameManager.characterServices?.falling?.dispose();
  gameManager.characterServices?.targeting?.dispose();
  gameManager.characterServices?.combat?.dispose();
  gameManager.campaignRequests?.dispose();
  gameManager.campaignRequests = null;
  const combat = new CombatSession({
    library: services.library,
    getLocationId: (token) => gameManager.campaignWorld?.getLocationId(token.mapId) ?? null,
    hasToken: (token) => gameManager.placedTokens.includes(token),
    isMoving: (token) =>
      gameManager.campaignViewBusy ||
      !!gameManager.campaignMapFailure ||
      gameManager.sceneAutosave?.ready === false ||
      !!gameManager.inputCoordinator?.savedCharacterPending ||
      !!gameManager.terrainEngine?.hasPendingStroke ||
      gameManager.token3DAdapter?.isMovementInProgress?.(token) ||
      false,
    isSceneMoving: () =>
      gameManager.campaignViewBusy ||
      !!gameManager.campaignMapFailure ||
      gameManager.placedTokens.some(
        (token) => gameManager.token3DAdapter?.isMovementInProgress?.(token) || false
      ),
  });
  const connected = { ...services, combat };
  gameManager.characterServices = connected;
  connected.falling = new FallingController({
    gameManager,
    library: services.library,
    combat,
    getCharacter: (token) => getTokenCharacter(gameManager, token, connected),
    onChanged: (id) => notifyCharacterChanged(gameManager, id),
  });
  if (gameManager.spatial && typeof gameManager.getTerrainHeight === 'function') {
    connected.targeting = new TargetingController({
      gameManager,
      library: services.library,
      session: combat,
      onChanged: (id) => notifyCharacterChanged(gameManager, id),
    });
    combat.targeting = connected.targeting;
  }
  combat.subscribe(() => {
    gameManager.campaignRequests?.flush();
    gameManager.token3DAdapter?.refreshMovementRange?.();
    window.dispatchEvent(new CustomEvent('taverntable:combatChanged', { detail: { gameManager } }));
  });
  return connected;
}

export async function loadCharacterServices(gameManager) {
  if (gameManager.characterServices)
    return connectCharacterServices(gameManager, gameManager.characterServices);
  if (!gameManager.campaignContext?.campaign)
    throw new Error('Choose a campaign before opening character data');
  return connectCharacterServices(gameManager, gameManager.campaignContext);
}

export function getTokenCharacter(gameManager, token, services) {
  if (!gameManager.placedTokens.includes(token)) {
    throw new Error('Select a creature in the current scene');
  }
  if (gameManager.playerInput && (!token.owned || !token.characterSheetId))
    throw new Error('Only assigned character sheets are available to this player');
  const previousSpeed = getTokenMovementSettings(token).speed;
  const link = (id) => {
    if (!gameManager.placedTokens.includes(token)) {
      throw new Error('The character was saved, but its creature was removed before linking');
    }
    token.characterSheetId = id;
    const character = linkTokenCharacter(token, services.library, id);
    if (previousSpeed !== character.speed) gameManager.token3DAdapter?.refreshMovementRange?.();
    return character;
  };
  if (token.characterSheetId) return link(token.characterSheetId);
  if (pendingCharacters.has(token)) return pendingCharacters.get(token);
  const result = afterCharacterCommit(
    services.library.create(getTokenDisplayName(token), {
      linkTokenId: token.id,
      fallTraits: getTokenFallTraits(token),
      conditions: [...getTokenConditions(token)],
    }),
    link
  );
  if (typeof result?.then !== 'function') return result;
  const pending = result.finally(() => {
    if (pendingCharacters.get(token) === pending) pendingCharacters.delete(token);
  });
  pendingCharacters.set(token, pending);
  return pending;
}

export function notifyCharacterChanged(gameManager, characterId, entryKind = null, origin = null) {
  gameManager.characterServices?.targeting?.beginQuery();
  gameManager.characterServices?.combat?.syncEffects();
  syncLinkedCreatureNames(gameManager, characterId);
  for (const token of gameManager.placedTokens) {
    if (token.characterSheetId === characterId) {
      gameManager.token3DAdapter?.refreshTokenAppearance?.(token);
      gameManager.token3DAdapter?.syncProneState?.(token);
    }
  }
  gameManager.token3DAdapter?.refreshMovementRange?.();
  window.dispatchEvent(
    new CustomEvent('taverntable:characterChanged', {
      detail: { gameManager, characterId, entryKind, origin },
    })
  );
}
