import { toggleFacing } from '../../src/managers/token-manager/internals/facing.js';
import { removeToken } from '../../src/managers/token-manager/internals/removal.js';

describe('TokenManager internals - facing and removal', () => {
    test('toggleFacing flips flag and updates button text', () => {
        document.body.innerHTML = '<button id="facing-right">➡️ Right</button>';
        const c = { tokenFacingRight: true };

        toggleFacing(c);
        expect(c.tokenFacingRight).toBe(false);
        expect(document.getElementById('facing-right').textContent).toMatch('⬅️ Left');

        toggleFacing(c);
        expect(c.tokenFacingRight).toBe(true);
        expect(document.getElementById('facing-right').textContent).toMatch('➡️ Right');
    });

    test('removeToken removes sprite from stage and collection', () => {
        const target = { creature: { removeFromStage: jest.fn() } };
        const other = { creature: { removeFromStage: jest.fn() } };
        const c = { placedTokens: [target, other] };

        removeToken(c, target);

        expect(target.creature.removeFromStage).toHaveBeenCalled();
        expect(c.placedTokens).toEqual([other]);
    });
});
