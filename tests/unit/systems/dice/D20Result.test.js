import { playD20RollOnGrid, playPlayerDieRollOnGrid } from '../../../../src/systems/dice/dice3d.js';
import { rollDice } from '../../../../src/systems/dice/dice.js';
import { ErrorHandler } from '../../../../src/utils/error/ErrorHandler.js';

jest.mock('../../../../src/systems/dice/dice3d.js', () => ({
  playD20RollOnGrid: jest.fn(),
  playPlayerDieRollOnGrid: jest.fn(),
}));

describe('Large d20 result authority', () => {
  let originalRAF;
  let errorHandler;
  let random;

  beforeEach(() => {
    jest.useFakeTimers();
    originalRAF = global.requestAnimationFrame;
    global.requestAnimationFrame = (callback) => {
      callback();
      return 0;
    };
    document.body.innerHTML = `
      <input data-dice-count value="1" />
      <button data-dice data-sides="20"></button>
      <div data-dice-result></div>
    `;
    window.sidebarController = { addDiceLogEntry: jest.fn() };
    errorHandler = jest.spyOn(ErrorHandler.prototype, 'handle').mockReturnValue('test-error');
    random = jest.spyOn(Math, 'random').mockReturnValue(0.5);
    playD20RollOnGrid.mockReset();
    playPlayerDieRollOnGrid.mockReset();
    playPlayerDieRollOnGrid.mockResolvedValue({
      success: false,
      value: null,
      reason: 'no-manager',
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    global.requestAnimationFrame = originalRAF;
    jest.useRealTimers();
    errorHandler.mockRestore();
    random.mockRestore();
    delete window.sidebarController;
  });

  async function roll(sides = 20, options = {}) {
    expect(rollDice(sides, options)).toBe(true);
    for (let i = 0; i < 6; i += 1) await Promise.resolve();
    return document.querySelector('[data-dice-result]').textContent;
  }

  test('shows and logs the actual settled numbered face', async () => {
    playD20RollOnGrid.mockResolvedValue({ success: true, value: 17 });

    expect(await roll(20, { goldD20: true })).toBe('Result: d20 \u2192 17');
    expect(window.sidebarController.addDiceLogEntry).toHaveBeenCalledWith(
      'Rolled d20: 17',
      'roll',
      expect.objectContaining({ label: 'd20', total: 17 })
    );
  });

  test.each([null, 0, 21])(
    'never substitutes RNG for an invalid physical value %s',
    async (value) => {
      playD20RollOnGrid.mockResolvedValue({ success: true, value });

      const text = await roll(20, { goldD20: true });

      expect(text).not.toContain('\u2192');
      expect(text).toMatch(/unable|failed|again/i);
      expect(errorHandler).toHaveBeenCalled();
      expect(window.sidebarController.addDiceLogEntry).not.toHaveBeenCalled();
      expect(document.querySelector('[data-dice]').disabled).toBe(false);
    }
  );

  test('cancellation releases the controls without inventing a roll', async () => {
    playD20RollOnGrid.mockResolvedValue({ success: false, value: null, reason: 'cancelled' });

    expect(await roll(20, { goldD20: true })).toMatch(/cancel/i);
    expect(window.sidebarController.addDiceLogEntry).not.toHaveBeenCalled();
    expect(document.querySelector('[data-dice]').disabled).toBe(false);
  });

  test('a cocked die asks for a manual reroll without logging a result or an error', async () => {
    playD20RollOnGrid.mockResolvedValue({ success: false, value: null, reason: 'cocked' });

    expect(await roll(20, { goldD20: true })).toMatch(/cocked.*roll again/i);
    expect(window.sidebarController.addDiceLogEntry).not.toHaveBeenCalled();
    expect(errorHandler).not.toHaveBeenCalled();
    expect(document.querySelector('[data-dice]').disabled).toBe(false);
  });

  test('uses the existing 2D roll only when there is no 3D renderer', async () => {
    playD20RollOnGrid.mockResolvedValue({ success: false, value: null, reason: 'no-manager' });

    expect(await roll(20, { goldD20: true })).toBe('Result: d20 \u2192 11');
    expect(errorHandler).not.toHaveBeenCalled();
  });

  test('uses the selected player d20 for the ordinary d20 button', async () => {
    playPlayerDieRollOnGrid.mockResolvedValue({ success: true, value: 7 });

    expect(await roll()).toBe('Result: d20 \u2192 7');
    expect(playPlayerDieRollOnGrid).toHaveBeenCalledWith(expect.objectContaining({ sides: 20 }));
    expect(playD20RollOnGrid).not.toHaveBeenCalled();
  });

  test('rolls multiple selected-color dice physically when count is greater than one', async () => {
    document.querySelector('[data-dice-count]').value = '3';
    playPlayerDieRollOnGrid.mockResolvedValue({
      success: true,
      values: [2, 5, 1],
    });

    expect(await roll(6)).toBe('Result: 3d6 \u2192 [2, 5, 1] = 8');
    expect(playPlayerDieRollOnGrid).toHaveBeenCalledWith(
      expect.objectContaining({ sides: 6, diceCount: 3 })
    );
    expect(playD20RollOnGrid).not.toHaveBeenCalled();
  });

  test('does not change other dice types', async () => {
    expect(await roll(6)).toBe('Result: d6 \u2192 4');
    expect(playPlayerDieRollOnGrid).toHaveBeenCalledWith(expect.objectContaining({ sides: 6 }));
    expect(playD20RollOnGrid).not.toHaveBeenCalled();
  });

  test('does not change multiple-d20 rolls', async () => {
    document.querySelector('[data-dice-count]').value = '2';

    expect(await roll()).toBe('Result: 2d20 \u2192 [11, 11] = 22');
    expect(playD20RollOnGrid).not.toHaveBeenCalled();
  });
});
