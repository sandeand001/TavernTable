import { TokenManager } from '../../../../src/managers/TokenManager.js';
import {
  renameCreature,
  syncLinkedCreatureNames,
  notifyCreatureNames,
} from '../../../../src/entities/creatures/CreatureNames.js';
import { getCreatureTypeLabel } from '../../../../src/entities/creatures/creatureHelpers.js';
import { getCharacterDefinition } from '../../../../src/config/CharacterCatalog.js';
import { TOKEN_3D_MODELS } from '../../../../src/config/token-adapter/MannequinConfig.js';

test('the zombie appearance keeps its legacy ID and the same Yaku model', () => {
  const zombie = getCharacterDefinition('monk');
  expect(getCreatureTypeLabel('monk')).toBe('Zombie');
  expect(zombie.id).toBe('monk');
  expect(zombie.label).toBe('Zombie');
  expect(zombie.icon).toBe('\uD83E\uDDDF');
  expect(zombie.mixamoName).toBe('Yaku J Ignite');
  expect(zombie.model.path).toBe('assets/animated-sprites/Yaku J Ignite.fbx');
  expect(getCharacterDefinition('zombie')).toBe(zombie);
  expect(TOKEN_3D_MODELS.zombie).toBe(TOKEN_3D_MODELS.monk);
});

test('new zombies use automatic Zombie names while custom names and numbering are retained', async () => {
  const gameManager = {
    getTerrainHeight: () => 0,
    spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }) },
  };
  const manager = new TokenManager(gameManager);
  Object.defineProperty(gameManager, 'placedTokens', { get: () => manager.placedTokens });
  manager.addTokenToCollection({}, 1, 1, 'monk');
  const first = manager.placedTokens[0];
  expect(first.name).toBe('Zombie');
  await renameCreature(gameManager, first, 'Brother Ash');
  manager.addTokenToCollection({}, 2, 1, 'zombie');
  expect(manager.placedTokens.map((token) => token.name)).toEqual(['Brother Ash', 'Zombie 2']);
  expect(manager._tokenTypeCounts.get('monk')).toBe(2);
  manager.setSelectedTokenType('zombie');
  expect(manager.getSelectedTokenType()).toBe('monk');
});

test('an unlinked custom name is validated, saved and not replaced by later duplicate numbering', async () => {
  const gameManager = {
    getTerrainHeight: () => 0,
    spatial: { gridToWorld: (x, y) => ({ x, y: 0, z: y }) },
    sceneAutosave: { changed: jest.fn(), flush: jest.fn(async () => {}) },
  };
  const manager = new TokenManager(gameManager);
  Object.defineProperty(gameManager, 'placedTokens', { get: () => manager.placedTokens });
  manager.addTokenToCollection({}, 1, 1, 'mannequin');
  const first = manager.placedTokens[0];
  await renameCreature(gameManager, first, '  Sentinel  ');
  expect(first).toMatchObject({ name: 'Sentinel', nameMode: 'custom' });
  expect(gameManager.sceneAutosave.flush).toHaveBeenCalledTimes(1);
  manager.addTokenToCollection({}, 2, 1, 'mannequin');
  expect(first.name).toBe('Sentinel');
  expect(manager.placedTokens[1].name).toBe('Mannequin 2');
  await expect(renameCreature(gameManager, first, '   ')).rejects.toThrow('1 to 100');
  await expect(renameCreature(gameManager, first, 'x'.repeat(101))).rejects.toThrow('1 to 100');
  expect(first.name).toBe('Sentinel');
});

test('ordinary linked-character refreshes do not mark unchanged names dirty', () => {
  const token = { characterSheetId: 'hero', name: 'Nora', nameMode: 'character' };
  const gameManager = {
    placedTokens: [token],
    characterServices: { library: { get: () => ({ name: 'Nora' }) } },
    sceneAutosave: { changed: jest.fn() },
  };
  syncLinkedCreatureNames(gameManager, 'hero');
  expect(gameManager.sceneAutosave.changed).not.toHaveBeenCalled();
  token.name = 'Old name';
  syncLinkedCreatureNames(gameManager, 'hero');
  expect(token.name).toBe('Nora');
  expect(gameManager.sceneAutosave.changed).toHaveBeenCalledTimes(1);
});

test('already acknowledged names still notify the UI without requesting another scene save', () => {
  const token = { name: 'Nora' };
  const gameManager = { sceneAutosave: { changed: jest.fn() } };
  const notified = jest.fn();
  window.addEventListener('taverntable:tokenNamesChanged', notified);
  try {
    notifyCreatureNames(gameManager, [token], { saved: true });
    expect(notified).toHaveBeenCalledTimes(1);
    expect(notified.mock.calls[0][0].detail.tokens).toEqual([token]);
    expect(gameManager.sceneAutosave.changed).not.toHaveBeenCalled();
  } finally {
    window.removeEventListener('taverntable:tokenNamesChanged', notified);
  }
});
