import { addTokenToCollection } from '../../src/managers/token-manager/internals/collection.js';

describe('addTokenToCollection', () => {
    test('pushes a new token with correct fields and uses instance defaults', () => {
        const placedTokens = [];
        const setupCalls = [];
        const c = {
            selectedTokenType: 'goblin',
            placedTokens,
            setupTokenInteractions: (sprite, data) => setupCalls.push({ sprite, data })
        };
        const creature = { sprite: { id: 'sprite-1' } };

        addTokenToCollection(c, creature, 3, 4);

        expect(placedTokens.length).toBe(1);
        expect(placedTokens[0]).toEqual({
            creature,
            gridX: 3,
            gridY: 4,
            type: 'goblin'
        });
        expect(setupCalls.length).toBe(1);
        expect(setupCalls[0].sprite).toBe(creature.sprite);
        expect(setupCalls[0].data).toBe(placedTokens[0]);
    });

    test('uses provided overrides for token type and tokens array', () => {
        const otherTokens = [];
        const c = {
            selectedTokenType: 'goblin',
            placedTokens: [],
            setupTokenInteractions: () => { }
        };
        const creature = { sprite: {} };

        addTokenToCollection(c, creature, 1, 2, 'dragon', otherTokens);

        expect(c.placedTokens.length).toBe(0); // unchanged
        expect(otherTokens.length).toBe(1);
        expect(otherTokens[0].type).toBe('dragon');
        expect(otherTokens[0].gridX).toBe(1);
        expect(otherTokens[0].gridY).toBe(2);
    });
});
