import { TokenManager } from '../../../../src/managers/TokenManager.js';
import { renameCreature } from '../../../../src/entities/creatures/CreatureNames.js';

test('an unlinked custom name is validated, saved and not replaced by later duplicate numbering', async () => {
  const gameManager = {
    terrainCoordinator: { dataStore: { get: () => 0 } },
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
