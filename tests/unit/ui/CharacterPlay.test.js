import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import snapshot from '../../../assets/data/srd2014.json';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

let sheets;
let token;
let services;

beforeEach(() => {
  localStorage.clear();
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  services = {
    catalog,
    library: new CharacterLibrary({
      ruleset: '2014',
      storage: globalThis.localStorage,
      catalog: catalog.entries,
      classes: catalog.classes,
    }),
  };
  token = { id: 'hero', type: 'knight', name: 'Nora' };
  const gameManager = {
    placedTokens: [token],
    token3DAdapter: {
      setSelectedToken: jest.fn(),
      getSelectedToken: () => token,
      refreshMovementRange: jest.fn(),
      isMovementInProgress: () => false,
    },
  };
  sheets = new CharacterSheetWindow({ gameManager, characterServices: services }).attach();
});

afterEach(() => {
  jest.restoreAllMocks();
  sheets.destroy();
  document.body.replaceChildren();
});

test.each([
  ['fighter', 1, 1],
  ['rogue', 5, 1],
  ['barbarian', 5, 2],
  ['monk', 5, 2],
  ['paladin', 5, 2],
  ['ranger', 5, 2],
  ['fighter', 11, 3],
  ['fighter', 20, 4],
])(
  'a new %s level %i turn displays %i available attacks without committing the action',
  async (classId, level, attacks) => {
    await sheets.open(token);
    services.library.edit(token.characterSheetId, { classId, level });
    await sheets.open(token);
    sheets.root.querySelector('[data-sheet-section="combat"]').click();
    sheets.root.querySelector('[aria-label="Start turn"]').click();
    expect(sheets.root.querySelector('[aria-label="Attacks remaining"]').textContent).toBe(
      String(attacks)
    );
    expect(sheets.root.querySelector('[aria-label="Actions remaining"]').textContent).toBe('1');
    expect(sheets.root.querySelector('[data-action-id="dash"]')).not.toBeNull();
    expect(sheets.root.querySelector('[data-sheet-action="attack-finish"]')).toBeNull();
  }
);

test('Combat movement bar follows the shared allowance, Dash and DM corrections without changing base speed', async () => {
  await sheets.open(token);
  const speed = sheets.root.querySelector('[data-character-field="speed"]');
  speed.value = '40';
  speed.dispatchEvent(new Event('change', { bubbles: true }));
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  const meter = () =>
    sheets.root.querySelector('[role="progressbar"][aria-label="Remaining movement"]');
  const width = () => meter().firstElementChild.style.width;
  expect(meter()).not.toBeNull();
  expect(meter().getAttribute('aria-valuenow')).toBe('40');
  expect(width()).toBe('100%');
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  const session = sheets.gameManager.characterServices.combat;
  const move = session.beginMovement(token, 10);
  session.finishMovement(move, 10);
  expect(meter().getAttribute('aria-valuenow')).toBe('30');
  expect(meter().getAttribute('aria-valuemax')).toBe('40');
  expect(width()).toBe('75%');
  sheets.root.querySelector('[data-action-id="dash"]').click();
  expect(meter().getAttribute('aria-valuenow')).toBe('70');
  expect(meter().getAttribute('aria-valuemax')).toBe('80');
  expect(width()).toBe('87.5%');
  sheets.root.querySelector('[aria-label="Run movement"]').click();
  expect(meter().getAttribute('aria-valuenow')).toBe('70');
  session.adjustMovement(token, 5);
  expect(meter().getAttribute('aria-valuenow')).toBe('5');
  expect(meter().getAttribute('aria-valuemax')).toBe('15');
  expect(parseFloat(width())).toBeCloseTo(100 / 3, 4);
  session.adjustMovement(token, 0);
  expect(width()).toBe('0%');
  sheets.root.querySelector('[data-sheet-section="core"]').click();
  expect(sheets.root.querySelector('[data-character-field="speed"]').value).toBe('40');
  expect(
    new CharacterLibrary({
      ruleset: '2014',
      storage: globalThis.localStorage,
      catalog: snapshot.entries,
      classes: snapshot.classes,
    }).get(token.characterSheetId).speed
  ).toBe(40);
});

test('the movement bar distinguishes waiting for a turn, zero speed and a downed character', async () => {
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  const session = sheets.gameManager.characterServices.combat;
  const meter = () =>
    sheets.root.querySelector('[role="progressbar"][aria-label="Remaining movement"]');
  session.endTurn();
  expect(meter().getAttribute('aria-valuenow')).toBe('0');
  expect(meter().getAttribute('aria-valuetext')).toContain('Waiting for your turn');
  sheets.root.querySelector('[data-sheet-section="core"]').click();
  const speed = sheets.root.querySelector('[data-character-field="speed"]');
  speed.value = '0';
  speed.dispatchEvent(new Event('change', { bubbles: true }));
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  expect(meter().getAttribute('aria-valuenow')).toBe('0');
  expect(meter().getAttribute('aria-valuemax')).toBe('1');
  expect(meter().firstElementChild.style.width).toBe('0%');
  expect(meter().getAttribute('aria-valuetext')).toContain('0 of 0 feet');
  services.library.edit(token.characterSheetId, { speed: 30, hp: { current: 0 } });
  await sheets.open(token);
  expect(meter().getAttribute('aria-valuenow')).toBe('0');
  expect(meter().getAttribute('aria-valuemax')).toBe('30');
  expect(meter().firstElementChild.style.width).toBe('0%');
  expect(meter().getAttribute('aria-valuetext')).toContain('0 HP');
});

test('Combat hides spent action choices, retains the second attack and keeps damage rolls accessible across views', async () => {
  await sheets.open(token);
  const id = token.characterSheetId;
  services.library.edit(id, { classId: 'barbarian', level: 5 });
  const sword = services.library.add(id, 'item:longsword');
  services.library.equip(id, sword, true);
  await sheets.open(token);
  const combatTab = sheets.root.querySelector('[data-sheet-section="combat"]');
  expect(combatTab).not.toBeNull();
  combatTab.click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  const mode = sheets.root.querySelector('[aria-label="Character roll mode"]');
  mode.value = 'advantage';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  const selector = `[data-sheet-action="use-action"][data-action-id="attack:${sword}"]`;
  sheets.root.querySelector(selector).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheets.root.querySelector('[aria-label="Actions remaining"]').textContent).toBe('0');
  expect(sheets.root.querySelector('[aria-label="Attacks remaining"]').textContent).toBe('1');
  expect(
    sheets.root.querySelector('[data-sheet-action="use-action"][data-action-id="dash"]')
  ).toBeNull();
  expect(sheets.root.querySelector(selector)).not.toBeNull();
  sheets.root.querySelector('[data-sheet-section="noncombat"]').click();
  expect(
    sheets.root.querySelector('[aria-label="Non-combat play"] [aria-label="Roll Stealth"]')
  ).not.toBeNull();
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  expect(sheets.root.querySelector('[aria-label="Attacks remaining"]').textContent).toBe('1');
  sheets.root.querySelector(selector).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheets.root.querySelector(selector)).toBeNull();
  expect(sheets.root.querySelector('[data-sheet-action="recent-roll"]')).not.toBeNull();
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(0);
});

test('Spells, Equipment and Non-combat cannot bypass the active turn or restore resources by resting', async () => {
  const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  await sheets.open(token);
  const id = token.characterSheetId;
  services.library.edit(id, { classId: 'wizard', level: 7, abilities: { intelligence: 16 } });
  const fireball = services.library.add(id, 'spell:fireball');
  services.library.prepare(id, fireball, true);
  const sword = services.library.add(id, 'item:longsword');
  services.library.equip(id, sword, true);
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  expect(sheets.root.querySelector('[aria-label="Short rest"]').disabled).toBe(true);
  sheets.root.querySelector('[data-sheet-section="spells"]').click();
  sheets.root.querySelector(`[data-sheet-action="cast"][data-instance-id="${fireball}"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(0);
  expect(services.library.get(id).slotsUsed[2]).toBe(1);
  sheets.root.querySelector('[data-sheet-section="equipment"]').click();
  sheets.root.querySelector(`[data-roll-kind="attack"][data-key="${sword}"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(error).toHaveBeenCalled();
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(0);
  sheets.root.querySelector('[data-sheet-section="noncombat"]').click();
  expect(
    sheets.root.querySelector(
      `[data-sheet-action="use-action"][data-action-id="spell:${fireball}"]`
    )
  ).toBeNull();
});

test('Core can configure a limited bonus ability that the play view spends and short rest restores', async () => {
  await sheets.open(token);
  const editor = sheets.root.querySelector('[aria-label="Custom ability editor"]');
  expect(editor).not.toBeNull();
  editor.querySelector('[data-custom-action="new"]').click();
  editor.querySelector('[aria-label="Custom ability name"]').value = 'Shadow <step>';
  editor.querySelector('[aria-label="Custom ability activation"]').value = 'bonus';
  editor.querySelector('[aria-label="Limit custom ability uses"]').click();
  editor.querySelector('[aria-label="Custom ability maximum uses"]').value = '2';
  editor.querySelector('[aria-label="Custom ability reset"]').value = 'short';
  editor.querySelector('[data-custom-action="save"]').click();
  const saved = services.library.actions.list(token.characterSheetId)[0];
  expect(saved).toMatchObject({ name: 'Shadow <step>', remaining: 2, cost: 'bonus' });
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  expect(sheets.root.querySelector(`[data-action-id="custom:${saved.id}"]`).textContent).toContain(
    '2/2 uses'
  );
  sheets.root.querySelector(`[data-action-id="custom:${saved.id}"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(services.library.actions.list(token.characterSheetId)[0].remaining).toBe(1);
  expect(sheets.root.querySelector('[aria-label="Bonus actions remaining"]').textContent).toBe('0');
  expect(sheets.root.querySelector('step')).toBeNull();
  sheets.root.querySelector('[data-sheet-action="combat-end"]').click();
  sheets.root.querySelector('[aria-label="Short rest"]').click();
  sheets.root.querySelector('[data-rest-action="complete-short"]').click();
  expect(services.library.actions.list(token.characterSheetId)[0].remaining).toBe(2);
});

test('explicit DM corrections restore a turn choice without changing the saved character', async () => {
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  sheets.root.querySelector('[data-action-id="attack:unarmed"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheets.root.querySelector('[aria-label="Actions remaining"]').textContent).toBe('0');
  const input = sheets.root.querySelector('[aria-label="DM actions remaining"]');
  expect(input).not.toBeNull();
  input.value = '1';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  sheets.root.querySelector('[data-sheet-action="economy-adjust"]').click();
  expect(sheets.root.querySelector('[aria-label="Actions remaining"]').textContent).toBe('1');
  expect(sheets.root.querySelector('[data-action-id="attack:unarmed"]')).not.toBeNull();
  expect(services.library.get(token.characterSheetId).speed).toBe(30);
});

test('cancelled and failed dice requests release reservations without spending the bonus action or Second Wind', async () => {
  jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const dice = await import('../../../src/systems/dice/dice.js');
  const roll = jest
    .spyOn(dice, 'rollDiceExpression')
    .mockResolvedValueOnce({ cancelled: true, text: 'Cancelled' })
    .mockRejectedValueOnce(new Error('Dice unavailable'))
    .mockResolvedValueOnce({ cancelled: false, text: 'Second Wind: 8', total: 8 });
  await sheets.open(token);
  const id = token.characterSheetId;
  services.library.edit(id, { classId: 'fighter', level: 5 });
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  const session = sheets.gameManager.characterServices.combat;
  const use = async () => {
    sheets.root.querySelector('[data-action-id="ability:second-wind"]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  await use();
  expect(session.pending).toBeNull();
  expect(session.status(token).bonusActions).toBe(1);
  await use();
  expect(session.pending).toBeNull();
  expect(session.status(token).bonusActions).toBe(1);
  expect(
    services.library.rest.status(id).resources.find((resource) => resource.id === 'second-wind')
      .remaining
  ).toBe(1);
  await use();
  expect(session.status(token).bonusActions).toBe(0);
  expect(
    services.library.rest.status(id).resources.find((resource) => resource.id === 'second-wind')
      .remaining
  ).toBe(0);
  expect(roll).toHaveBeenCalledTimes(3);
});

test('starting combat while a rest Hit Die is rolling cannot grant healing or spend a die', async () => {
  const dice = await import('../../../src/systems/dice/dice.js');
  let finishRoll;
  jest.spyOn(dice, 'rollDiceExpression').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRoll = resolve;
      })
  );
  await sheets.open(token);
  const id = token.characterSheetId;
  services.library.edit(id, { classId: 'fighter', level: 5, hp: { max: 30, current: 2 } });
  await sheets.open(token);
  sheets.root.querySelector('[aria-label="Short rest"]').click();
  sheets.root.querySelector('[data-rest-action="complete-short"]').click();
  sheets.root.querySelector('[data-rest-action="hit-die"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  finishRoll({ cancelled: false, text: 'Hit Die: 8', total: 8 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(services.library.get(id).hp.current).toBe(2);
  expect(services.library.rest.status(id).hitDice.spent).toBe(0);
  expect(sheets.root.querySelector('[aria-label="Short rest"]').disabled).toBe(true);
});
