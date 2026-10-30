export function validateCreatureName(name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100) {
    throw new Error('A creature name must contain 1 to 100 characters');
  }
  return name.trim();
}

export function notifyCreatureNames(gameManager, tokens) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent('taverntable:tokenNamesChanged', {
        detail: { gameManager, tokens },
      })
    );
  }
  gameManager.sceneAutosave?.changed('names');
}

export function syncLinkedCreatureNames(gameManager, characterId) {
  const tokens = gameManager.placedTokens.filter((token) => token.characterSheetId === characterId);
  if (!tokens.length) return;
  const character = gameManager.characterServices.library.get(characterId);
  for (const token of tokens) {
    token.name = character.name;
    token.nameMode = 'character';
  }
  notifyCreatureNames(gameManager, tokens);
}

export async function renameCreature(gameManager, token, name) {
  if (!gameManager.placedTokens.includes(token))
    throw new Error('Choose a creature in this campaign');
  const value = validateCreatureName(name);
  if (token.characterSheetId) {
    if (!gameManager.characterServices)
      throw new Error('Open the campaign character data before renaming');
    await gameManager.characterServices.library.edit(token.characterSheetId, { name: value });
    syncLinkedCreatureNames(gameManager, token.characterSheetId);
  } else {
    token.name = value;
    token.nameMode = 'custom';
    notifyCreatureNames(gameManager, [token]);
  }
  await gameManager.sceneAutosave?.flush();
  return value;
}
