import SidebarController from '../../../src/ui/SidebarController.js';
import { rollDice, rollDiceExpression, setDiceDomPorts } from '../../../src/systems/dice/dice.js';

beforeEach(() => {
  document.body.innerHTML = `
    <div id="sidebar-tabs"><button class="tab-button" data-tab="dice-log" aria-controls="dice-log-panel"></button></div>
    <div id="dice-log-panel" class="tab-panel"><div id="dice-log-content"></div></div>`;
  window.richShadingSettings = {};
  window.sidebarController = new SidebarController();
});

afterEach(() => {
  setDiceDomPorts({});
  delete window.sidebarController;
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

test('a shared roll shows only its name and total while the total exposes the real physical breakdown', async () => {
  await rollDiceExpression(
    { expression: '1d20+5', label: 'Ari: Longsword Attack' },
    { physicalRoll: async () => ({ success: true, value: 18 }) }
  );
  const message = document.querySelector('.log-message');
  expect(message.textContent).toBe('Ari: Longsword Attack: 23');
  const total = message.querySelector('.roll-total');
  expect(total.textContent).toBe('23');
  expect(total.title).toContain('1d20+5');
  expect(total.title).toContain('18');
  expect(total.title).toContain('Physical d20');
  expect(total.tabIndex).toBe(0);
});

test.each([
  ['1d20+5', 'advantage', [0.05, 0.89], 23, 'keep 18'],
  ['1d20+5', 'disadvantage', [0.05, 0.89], 7, 'keep 2'],
  ['2d6+1d4-3', 'normal', [0.5, 0.5, 0.5], 8, '2d6 [4, 4] + 1d4 [3] - 3'],
  ['1d4-5', 'normal', [0], -4, '1d4 [1] - 5'],
  ['0', 'normal', [], 0, 'Fixed value'],
])(
  'compact %s (%s) keeps the actual dice and arithmetic in its tooltip',
  async (expression, mode, values, expected, detail) => {
    const result = await rollDiceExpression(
      { expression, mode, label: 'Test roll' },
      { random: () => values.shift() }
    );
    const message = document.querySelector('.log-message');
    expect(result.total).toBe(expected);
    expect(message.textContent).toBe(`Test roll: ${expected}`);
    expect(message.querySelector('.roll-total').title).toContain(detail);
  }
);

test('summary labels and tooltips are escaped while system and legacy messages stay plain text', () => {
  const controller = window.sidebarController;
  const label = '<img src=x onerror=alert(1)>';
  const breakdown = '" onmouseover="alert(1) <svg>';
  controller.addDiceLogEntry('Original text', 'roll', { label, total: 23, breakdown });
  expect(document.querySelector('.log-message').textContent).toBe(`${label}: 23`);
  expect(document.querySelector('.roll-total').title).toBe(breakdown);
  expect(document.querySelector('img,svg')).toBeNull();
  expect(document.querySelector('.roll-total').getAttribute('onmouseover')).toBeNull();
  expect(() =>
    controller.addDiceLogEntry('Invalid', 'roll', { label, total: NaN, breakdown })
  ).toThrow('invalid');
  expect(controller.diceLogEntries).toHaveLength(1);
  controller.clearDiceLog();
  expect(document.querySelector('.log-message').textContent).toBe('Dice log cleared.');
  expect(document.querySelector('.roll-total')).toBeNull();
  controller.addDiceLogEntry('An older unstructured roll', 'roll');
  expect(document.querySelector('.log-message').textContent).toBe('An older unstructured roll');
});

test('ordinary tray dice use the same compact summary without changing their rolled total', async () => {
  const originalRAF = global.requestAnimationFrame;
  jest.useFakeTimers();
  global.requestAnimationFrame = (callback) => {
    callback();
    return 0;
  };
  const count = document.createElement('input');
  count.value = '2';
  const result = document.createElement('output');
  setDiceDomPorts({ getDiceCountEl: () => count, getDiceResultEl: () => result });
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  try {
    expect(rollDice(6)).toBe(true);
    for (let index = 0; index < 6; index++) await Promise.resolve();
    expect(document.querySelector('.log-message').textContent).toBe('2d6: 8');
    expect(document.querySelector('.roll-total').title).toContain('[4, 4]');
  } finally {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    global.requestAnimationFrame = originalRAF;
  }
});

test('an explicitly unnamed roll remains supported and shows its total without inventing a label', async () => {
  const result = await rollDiceExpression({ expression: '1d6', label: '' }, { random: () => 0 });
  expect(result.total).toBe(1);
  expect(document.querySelector('.log-message').textContent).toBe('1');
  expect(document.querySelector('.roll-total').title).toContain('1d6 [1]');
});
