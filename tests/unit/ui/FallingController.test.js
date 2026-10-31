import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { linkTokenCharacter } from '../../../src/entities/creatures/TokenMovement.js';
import FallingController from '../../../src/ui/characters/FallingController.js';
import { connectCharacterServices } from '../../../src/ui/characters/characterServices.js';
import { rollForSheet } from '../../../src/ui/characters/playActions.js';
import * as dice from '../../../src/systems/dice/dice.js';
import data from '../../../assets/data/srd2014.json';

let library, token, gm, session, controller;
const flush = async () => {
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
};
const button = (text) =>
  [...document.querySelectorAll('[role="dialog"] button')].find(
    (element) => element.textContent === text
  );

beforeEach(() => {
  localStorage.clear();
  library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: data.entries,
    classes: data.classes,
  });
  token = { id: 'hero', type: 'mannequin', name: 'Nora' };
  const id = library.create('Nora');
  library.edit(id, { hp: { max: 100, current: 100 } });
  linkTokenCharacter(token, library, id);
  gm = {
    placedTokens: [token],
    token3DAdapter: {
      isMovementInProgress: () => false,
      isWallAttached: () => false,
      playStandUp: jest.fn(),
      refreshMovementRange: jest.fn(),
    },
    sceneAutosave: { changed: jest.fn() },
  };
  session = new CombatSession({ library });
  controller = new FallingController({
    gameManager: gm,
    library,
    combat: session,
    getCharacter: () => library.get(token.characterSheetId),
    onChanged: jest.fn(),
  });
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
});

afterEach(() => {
  controller.dispose();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

test('Slow Fall prompts before descent, spends one reaction and requests slower animation', async () => {
  library.edit(token.characterSheetId, { classId: 'monk', level: 4 });
  session.startTurn(token);
  const preparing = controller.begin(token, 20);
  await flush();
  expect(button('Use Slow Fall (reaction)')).toBeDefined();
  expect(library.get(token.characterSheetId).hp.current).toBe(100);
  expect(session.status(token).reactions).toBe(1);
  button('Use Slow Fall (reaction)').click();
  const context = await preparing;
  expect(context).toMatchObject({ slowFall: true, reduction: 20, damage: 0, prone: false });
  expect(session.status(token)).toMatchObject({ actions: 1, bonusActions: 1, reactions: 0 });
  await controller.land(token, context);
  expect(library.get(token.characterSheetId)).toMatchObject({
    hp: { current: 100 },
    conditions: [],
  });
});

test('declining preserves the reaction; damage is applied only by the landing commit', async () => {
  library.edit(token.characterSheetId, { classId: 'monk', level: 4 });
  session.startTurn(token);
  const preparing = controller.begin(token, 20);
  await flush();
  button('Fall normally').click();
  const context = await preparing;
  expect(context).toMatchObject({ slowFall: false, damage: 8, prone: true });
  expect(library.get(token.characterSheetId).hp.current).toBe(100);
  await controller.land(token, context);
  expect(library.get(token.characterSheetId)).toMatchObject({
    hp: { current: 92 },
    conditions: ['prone'],
  });
  expect(session.status(token).reactions).toBe(1);
});

test('a spent reaction or a fall below ten feet does not offer Slow Fall', async () => {
  library.edit(token.characterSheetId, { classId: 'monk', level: 4 });
  session.startTurn(token);
  session.useSlowFall(token, 'previous-fall');
  const context = await controller.begin(token, 20);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(context).toMatchObject({ slowFall: false, reduction: 0, damage: 8 });
  await controller.land(token, context);
  const short = await controller.begin(token, 9.999);
  expect(short).toMatchObject({ damage: 0, slowFall: false });
  await controller.land(token, short);
});

test('a deliberate flight drop falls, but active Feather Fall protects and ends on landing', async () => {
  library.edit(token.characterSheetId, { fallTraits: { flySpeed: 40 } });
  const dropped = await controller.begin(token, 20, { ignoreFlight: true });
  expect(dropped).toMatchObject({ avoidDamage: false, damage: 8, prone: true });
  await controller.land(token, dropped);
  library.edit(token.characterSheetId, { fallTraits: { featherFall: true } });
  const feather = await controller.begin(token, 20, { ignoreFlight: true });
  expect(feather).toMatchObject({ avoidDamage: true, featherFall: true, damage: 0 });
  await controller.land(token, feather);
  expect(library.get(token.characterSheetId).fallTraits.featherFall).toBe(false);
});

test('a failed landing save exposes Retry without rerolling or spending HP twice', async () => {
  const roll = jest.spyOn(dice, 'rollDiceExpression');
  const context = await controller.begin(token, 20);
  jest.spyOn(library, 'applyFall').mockRejectedValueOnce(new Error('Storage full'));
  const landing = controller.land(token, context);
  await flush();
  expect(document.querySelector('[role="dialog"]').textContent).toContain('Storage full');
  expect(library.get(token.characterSheetId).hp.current).toBe(100);
  button('Retry fall resolution').click();
  await landing;
  expect(library.get(token.characterSheetId).hp.current).toBe(92);
  expect(roll).toHaveBeenCalledTimes(1);
  expect(session.history(token)).toHaveLength(1);
});

test('the first sheet preserves an unlinked creature’s flight traits and existing Prone', async () => {
  controller.dispose();
  const creature = {
    id: 'new-creature',
    name: 'Flyer',
    type: 'mannequin',
    fallTraits: { flySpeed: 40, hover: true },
    conditions: ['prone'],
  };
  gm.placedTokens = [creature];
  const connected = connectCharacterServices(gm, {
    library,
    catalog: { ruleset: '2014', classes: data.classes },
  });
  controller = connected.falling;
  const context = await controller.begin(creature, 20);
  expect(library.get(creature.characterSheetId)).toMatchObject({
    conditions: ['prone'],
    fallTraits: { flySpeed: 40, hover: true },
  });
  expect(context).toMatchObject({ avoidDamage: true, wasProne: true });
  await controller.land(creature, context);
});

test('removal cancels the prompt without spending the reaction or HP', async () => {
  library.edit(token.characterSheetId, { classId: 'monk', level: 4 });
  session.startTurn(token);
  const preparing = controller.begin(token, 20);
  const rejected = expect(preparing).rejects.toThrow('removed');
  await flush();
  gm.placedTokens = [];
  controller.cancel(token);
  await rejected;
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(session.status(token).reactions).toBe(1);
  expect(library.get(token.characterSheetId).hp.current).toBe(100);
});

test.each([
  ['normal', 'disadvantage'],
  ['advantage', 'normal'],
  ['disadvantage', 'disadvantage'],
])('Prone combines attack disadvantage with %s to produce %s', async (rollMode, mode) => {
  library.edit(token.characterSheetId, { conditions: ['prone'] });
  const roll = jest
    .spyOn(dice, 'rollDiceExpression')
    .mockResolvedValue({ total: 13, text: 'Attack: 13' });
  const context = {
    token,
    characterId: token.characterSheetId,
    services: { combat: session },
    rollMode,
    rollStatus: document.createElement('output'),
  };
  await rollForSheet(context, { expression: '1d20+2', label: 'Attack', check: true, attack: true });
  expect(roll).toHaveBeenCalledWith(expect.objectContaining({ mode }));
});
