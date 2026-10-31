import { rollDiceExpression, setDiceDomPorts } from '../../../../src/systems/dice/dice.js';

afterEach(() => {
  setDiceDomPorts({});
  delete window.sidebarController;
});

test('a character check uses the settled physical d20 value and applies its modifier once', async () => {
  const log = jest.fn();
  window.sidebarController = { addDiceLogEntry: log };
  const physicalRoll = jest.fn(async () => ({ success: true, value: 13 }));
  const result = await rollDiceExpression(
    { expression: '1d20+7', label: 'Aster: Athletics' },
    {
      physicalRoll,
      random: () => {
        throw new Error('A physical roll must not be rerolled digitally');
      },
    }
  );
  expect(result).toMatchObject({ total: 20, values: [13], physical: true });
  expect(result.text).toContain('Aster: Athletics');
  expect(physicalRoll).toHaveBeenCalledTimes(1);
  expect(log).toHaveBeenCalledWith(
    expect.stringContaining('20'),
    'roll',
    expect.objectContaining({ total: 20, label: 'Aster: Athletics' })
  );
});

test.each([
  ['advantage', 27],
  ['disadvantage', 9],
])('%s keeps the correct d20 instead of summing both', async (mode, total) => {
  const values = [0.05, 0.99];
  const result = await rollDiceExpression(
    { expression: '1d20+7', mode },
    { random: () => values.shift() }
  );
  expect(result).toMatchObject({ values: [2, 20], total, physical: false });
  expect(result.text).toContain(mode);
});

test('damage expressions roll every die and apply the constant modifier only once', async () => {
  const result = await rollDiceExpression(
    { expression: '2d6+3', label: 'Damage' },
    { random: () => 0.5 }
  );
  expect(result).toMatchObject({ values: [4, 4], total: 11 });
});

test('a failed physical roll clears both the in-progress message and the roll lock', async () => {
  const resultElement = document.createElement('output');
  setDiceDomPorts({ getDiceResultEl: () => resultElement });
  await expect(
    rollDiceExpression(
      { expression: '1d20+2' },
      {
        physicalRoll: async () => {
          throw new Error('Physics unavailable');
        },
      }
    )
  ).rejects.toThrow('Physics unavailable');
  expect(resultElement.textContent).not.toContain('Rolling');
  await expect(
    rollDiceExpression({ expression: '1d6' }, { random: () => 0 })
  ).resolves.toMatchObject({ total: 1 });
});
