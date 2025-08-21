import { rollDice } from '../../src/systems/dice/dice.js';

/**
 * Dice smoke tests — ensure exports and basic roll path do not throw.
 */
describe('Dice smoke', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="dice-panel">
        <button data-sides="6"></button>
      </div>
      <input id="dice-count" type="number" value="1" />
      <div id="dice-result"></div>
    `;
  // Make animation complete synchronously so internal isRolling resets
  global.requestAnimationFrame = (cb) => { cb(); return 0; };
  jest.useFakeTimers();
  });

  afterEach(() => {
    // Flush any pending timeouts from showFinalResult so isRolling resets
    try { jest.runOnlyPendingTimers(); } catch (_) {}
    jest.useRealTimers();
  });

  test('rollDice export exists', () => {
    expect(typeof rollDice).toBe('function');
  });

  test('rolling typical inputs returns a boolean and does not throw', () => {
    const ok = rollDice(20);
    expect(typeof ok).toBe('boolean');
    // Allow any timeouts in result display to run
    jest.runOnlyPendingTimers();
  });
});
