import { toggleFacing } from '../../src/managers/token-manager/internals/facing.js';
import { removeToken } from '../../src/managers/token-manager/internals/removal.js';
import {
  rotateToken,
  normalizeAngle,
} from '../../src/managers/token-manager/internals/orientation.js';

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

  test('rotateToken normalizes angle and requests orientation update', () => {
    const adapter = { updateTokenOrientation: jest.fn() };
    const c = { gameManager: { token3DAdapter: adapter } };
    const token = { facingAngle: 0 };

    rotateToken(c, token, Math.PI / 2);

    expect(token.facingAngle).toBeCloseTo(Math.PI / 2);
    expect(adapter.updateTokenOrientation).toHaveBeenCalledWith(token);

    rotateToken(c, token, Math.PI * 2);
    expect(token.facingAngle).toBeCloseTo(Math.PI / 2);
  });

  test('normalizeAngle constrains values to range [-pi, pi]', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(Math.PI * 3)).toBeCloseTo(Math.PI);
    expect(normalizeAngle(-Math.PI * 3)).toBeCloseTo(-Math.PI);
  });
});
