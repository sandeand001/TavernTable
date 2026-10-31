import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';
import { syncLinkedCreatureNames } from '../../entities/creatures/CreatureNames.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import {
  getTokenMovementSettings,
  linkTokenCharacter,
} from '../../entities/creatures/TokenMovement.js';
import CombatSession from '../../entities/characters/CombatSession.js';

const pendingCharacters = new WeakMap();

export function connectCharacterServices(gameManager, services) {
  if (
    !services?.library?.ruleset ||
    services.library.ruleset !== services.catalog?.ruleset ||
    (services.campaign && services.campaign.ruleset !== services.library.ruleset)
  ) {
    throw new Error('Character services require a matching campaign ruleset and catalog');
  }
  if (
    gameManager.characterServices?.library === services.library &&
    gameManager.characterServices.combat
  )
    return gameManager.characterServices;
  const combat = new CombatSession({
    library: services.library,
    hasToken: (token) => gameManager.placedTokens.includes(token),
    isMoving: (token) => gameManager.token3DAdapter?.isMovementInProgress?.(token) || false,
    isSceneMoving: () =>
      gameManager.placedTokens.some(
        (token) => gameManager.token3DAdapter?.isMovementInProgress?.(token) || false
      ),
  });
  const connected = { ...services, combat };
  gameManager.characterServices = connected;
  combat.subscribe(() => {
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
  syncLinkedCreatureNames(gameManager, characterId);
  window.dispatchEvent(
    new CustomEvent('taverntable:characterChanged', {
      detail: { gameManager, characterId, entryKind, origin },
    })
  );
}
