import { addTokenToCollection } from '../../../../src/managers/token-manager/internals/collection.js';
import { removeToken } from '../../../../src/managers/token-manager/internals/removal.js';

describe('addTokenToCollection', () => {
  test('pushes a new token with correct fields and uses instance defaults', () => {
    const placedTokens = [];
    const c = {
      selectedTokenType: 'mannequin',
      placedTokens,
    };
    const creature = { sprite: { id: 'sprite-1' } };

    addTokenToCollection(c, creature, 3, 4);

    expect(placedTokens.length).toBe(1);
    const token = placedTokens[0];
    expect(token.creature).toBe(creature);
    expect(token.gridX).toBe(3);
    expect(token.gridY).toBe(4);
    expect(token.type).toBe('mannequin');
    expect(token.world).toEqual({ x: 0, y: 0, z: 0 });
    // New fields added for stability across projections
    expect(token.__originGridX).toBe(3);
    expect(token.__originGridY).toBe(4);
    // baseIsoY is initialized lazily only when sprite present & not previously set; allow undefined or number
    expect(['number', 'undefined']).toContain(typeof token.creature.sprite.baseIsoY);
  });

  test('uses provided overrides for token type and tokens array', () => {
    const otherTokens = [];
    const c = {
      selectedTokenType: 'mannequin',
      placedTokens: [],
    };
    const creature = { sprite: {} };

    addTokenToCollection(c, creature, 1, 2, 'mannequin', otherTokens);

    expect(c.placedTokens.length).toBe(0); // unchanged
    expect(otherTokens.length).toBe(1);
    expect(otherTokens[0].type).toBe('mannequin');
    expect(otherTokens[0].gridX).toBe(1);
    expect(otherTokens[0].gridY).toBe(2);
    expect(otherTokens[0].world).toBeDefined();
    expect(typeof otherTokens[0].world.x).toBe('number');
  });

  test('numbers duplicates without changing their identity or reusing a removed number', () => {
    const c = { selectedTokenType: 'mannequin', placedTokens: [] };
    addTokenToCollection(c, {}, 1, 1);
    const first = c.placedTokens[0];
    const firstId = first.id;
    expect(first.name).toBe('Mannequin');

    addTokenToCollection(c, {}, 2, 1);
    const second = c.placedTokens[1];
    expect(first.name).toBe('Mannequin 1');
    expect(second.name).toBe('Mannequin 2');
    expect(first.id).toBe(firstId);
    expect(first.id).toBeTruthy();
    expect(first.id).not.toBe(second.id);

    removeToken(c, second);
    addTokenToCollection(c, {}, 3, 1);
    expect(c.placedTokens.map((token) => token.name)).toEqual(['Mannequin 1', 'Mannequin 3']);
    expect(c.placedTokens[1].id).not.toBe(second.id);
  });

  test('counts separately by canonical creature type, including legacy aliases', () => {
    const c = { selectedTokenType: 'mannequin', placedTokens: [] };
    addTokenToCollection(c, {}, 1, 1, 'female-humanoid');
    addTokenToCollection(c, {}, 2, 1, 'mannequin');
    addTokenToCollection(c, {}, 3, 1, 'test-dragon');

    expect(c.placedTokens.map((token) => token.name)).toEqual([
      'Mannequin 1',
      'Mannequin 2',
      'Test Dragon',
    ]);
  });

  test('notifies open UI labels when a duplicate renames the original token', () => {
    const changed = jest.fn();
    window.addEventListener('taverntable:tokenNamesChanged', changed);
    try {
      const c = { selectedTokenType: 'mannequin', placedTokens: [] };
      addTokenToCollection(c, {}, 1, 1);
      addTokenToCollection(c, {}, 2, 1);

      expect(changed).toHaveBeenCalled();
      const tokens = changed.mock.calls.at(-1)[0].detail.tokens;
      expect(tokens.map((token) => token.name)).toEqual(['Mannequin 1', 'Mannequin 2']);
    } finally {
      window.removeEventListener('taverntable:tokenNamesChanged', changed);
    }
  });

  test('removes a 3D-only creature and notifies sheets even without legacy stage methods', () => {
    const removed = jest.fn();
    window.addEventListener('taverntable:tokenRemoved', removed);
    try {
      const c = { placedTokens: [{ creature: {} }] };
      const token = c.placedTokens[0];
      removeToken(c, token);

      expect(c.placedTokens).toHaveLength(0);
      expect(removed).toHaveBeenCalledTimes(1);
      expect(removed.mock.calls[0][0].detail.token).toBe(token);
    } finally {
      window.removeEventListener('taverntable:tokenRemoved', removed);
    }
  });
});
