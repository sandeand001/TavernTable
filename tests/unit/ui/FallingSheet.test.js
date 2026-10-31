import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import data from '../../../assets/data/srd2014.json';

let library, token, gm, sheets, session;
const flush = async () => {
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
};
const button = () => sheets.root.querySelector('[aria-label="Stand up"]');

beforeEach(async () => {
  localStorage.clear();
  library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: data.entries,
    classes: data.classes,
  });
  const id = library.create('Nora');
  library.edit(id, { conditions: ['prone'] });
  token = { id: 'hero', type: 'mannequin', name: 'Nora', characterSheetId: id };
  gm = {
    placedTokens: [token],
    token3DAdapter: {
      setSelectedToken: jest.fn(),
      getSelectedToken: () => token,
      isMovementInProgress: () => false,
      isWallAttached: () => false,
      playStandUp: jest.fn(),
      refreshMovementRange: jest.fn(),
    },
  };
  sheets = new CharacterSheetWindow({
    gameManager: gm,
    characterServices: { library, catalog: { ruleset: '2014', classes: data.classes } },
  }).attach();
  await sheets.open(token);
  session = gm.characterServices.combat;
});

afterEach(() => {
  sheets.destroy();
  gm.characterServices.falling.dispose();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

test('Stand Up is on every sheet page and spends only half maximum movement', async () => {
  for (const section of ['combat', 'noncombat', 'core']) {
    sheets.root.querySelector(`[data-sheet-section="${section}"]`).click();
    expect(button().disabled).toBe(false);
    expect(button().textContent).toContain('15 ft');
  }
  session.startTurn(token);
  const move = session.beginMovement(token, 10);
  session.finishMovement(move, 10);
  button().click();
  await flush();
  expect(library.get(token.characterSheetId).conditions).not.toContain('prone');
  expect(session.status(token)).toMatchObject({
    actions: 1,
    bonusActions: 1,
    reactions: 1,
    movement: { spent: 25, remaining: 5 },
  });
  expect(gm.token3DAdapter.playStandUp).toHaveBeenCalledWith(token);
});

test('the Prone checkbox cannot bypass the stand-up cost in free play', async () => {
  const prone = sheets.root.querySelector('[aria-label="Prone condition"][type="checkbox"]');
  prone.checked = false;
  prone.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  expect(session.freeMovementAllowance(token)).toBe(15);
  expect(gm.token3DAdapter.playStandUp).toHaveBeenCalledTimes(1);
  expect(
    sheets.root.querySelector('[aria-label="Free-play movement allowance"]').textContent
  ).toContain('15/30 ft');
});

test('too little movement disables Stand Up and the condition-clearing shortcut', () => {
  session.startTurn(token);
  const move = session.beginMovement(token, 20);
  session.finishMovement(move, 20);
  expect(button().disabled).toBe(true);
  expect(button().title).toContain('15 feet');
  expect(
    sheets.root.querySelector('[aria-label="Prone condition"][type="checkbox"]').disabled
  ).toBe(true);
});

test('failed standing saves show an error without animation, condition changes or movement costs', async () => {
  session.startTurn(token);
  jest.spyOn(library, 'edit').mockRejectedValueOnce(new Error('Storage full'));
  button().click();
  await flush();
  expect(sheets.root.querySelector('.sheet-save-status').textContent).toContain('Storage full');
  expect(library.get(token.characterSheetId).conditions).toContain('prone');
  expect(session.status(token).movement.spent).toBe(0);
  expect(gm.token3DAdapter.playStandUp).not.toHaveBeenCalled();
});
