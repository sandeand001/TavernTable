import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import snapshot from '../../../assets/data/srd2014.json';
import modern from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';
import CombatSession from '../../../src/entities/characters/CombatSession.js';

function libraryFor(ruleset) {
  const data = ruleset === '2014' ? snapshot : modern;
  return new CharacterLibrary({
    ruleset,
    catalog: data.entries,
    classes: data.classes,
    storage: ruleset === '2014' ? localStorage : sessionStorage,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

test.each(['2014', '2024'])(
  'available attacks follow actions, attack sequences and Undo under %s rules',
  (ruleset) => {
    const library = libraryFor(ruleset);
    const id = library.create('Fighter');
    library.edit(id, { level: 5 });
    const token = { id: 'hero', characterSheetId: id };
    const combat = new CombatSession({ library });
    combat.startTurn(token);
    expect(combat.status(token)).toMatchObject({ attacksAvailable: 2, actions: 1 });
    const pending = combat.prepareAction(token, 'attack:unarmed');
    expect(combat.status(token).attacksAvailable).toBe(2);
    combat.cancelAction(pending);
    combat.useAction(token, 'ability:action-surge');
    expect(combat.status(token)).toMatchObject({ attacksAvailable: 4, actions: 2 });
    combat.useAction(token, 'attack:unarmed');
    expect(combat.status(token)).toMatchObject({ attacksAvailable: 3, actions: 1 });
    combat.finishAttackAction(token);
    expect(combat.status(token).attacksAvailable).toBe(2);
    combat.useAction(token, 'dash');
    expect(combat.status(token).attacksAvailable).toBe(0);
    expect(combat.availableActions(token).some((action) => action.id === 'attack:unarmed')).toBe(
      false
    );
    combat.undoLastUse(token);
    expect(combat.status(token)).toMatchObject({ attacksAvailable: 2, actions: 1 });
  }
);

test.each(['2014', '2024'])(
  'available attacks respect overrides, end of turn and 0 HP under %s rules',
  (ruleset) => {
    const library = libraryFor(ruleset);
    const id = library.create('Fighter');
    library.actions.setAttackCount(id, 3);
    const token = { id: 'hero', characterSheetId: id };
    const combat = new CombatSession({ library });
    combat.startTurn(token);
    expect(combat.status(token)).toMatchObject({ attacksAvailable: 3, actions: 1 });
    combat.useAction(token, 'attack:unarmed');
    expect(combat.status(token)).toMatchObject({ attacksAvailable: 2, actions: 0 });
    combat.endTurn();
    expect(combat.status(token).attacksAvailable).toBe(0);
    combat.startTurn(token);
    expect(combat.status(token).attacksAvailable).toBe(3);
    library.edit(id, { hp: { current: 0 } });
    expect(combat.status(token).attacksAvailable).toBe(0);
    expect(combat.availableActions(token).some((action) => action.id === 'attack:unarmed')).toBe(
      false
    );
  }
);

test('an explicit ruleset selects distinct Hit Dice and Fighter recovery policies', () => {
  expect(() => new CharacterLibrary({ catalog: [] })).toThrow('ruleset');
  expect(() => new CharacterLibrary({ catalog: [], ruleset: 'unknown' })).toThrow('ruleset');
  for (const [ruleset, storage, maximum, recovery] of [
    ['2014', localStorage, 1, 2],
    ['2024', sessionStorage, 3, 4],
  ]) {
    const library = new CharacterLibrary({
      ruleset,
      storage,
      catalog: [],
      classes: snapshot.classes.filter((entry) => entry.id === 'fighter'),
    });
    const id = library.create('Fighter');
    library.edit(id, { level: 5, hp: { max: 100, current: 1 } });
    for (let die = 0; die < 4; die++) library.rest.spendHitDie(id, 1);
    const resource = () =>
      library.rest.status(id).resources.find((row) => row.id === 'second-wind');
    expect(resource().maximum).toBe(maximum);
    library.rest.setResourceRemaining(id, 'second-wind', 0);
    library.rest.shortRest(id);
    expect(resource().remaining).toBe(1);
    expect(library.rest.longRest(id).hitDiceRecovered).toBe(recovery);
    expect(resource().remaining).toBe(maximum);
  }
});

test('2024 replaces the bonus-action casting restriction with one expended spell slot per global turn', () => {
  for (const ruleset of ['2014', '2024']) {
    const library = libraryFor(ruleset);
    const id = library.create('Druid');
    library.edit(id, { classId: 'druid', level: 3, abilities: { wisdom: 16 } });
    const bonus = library.add(id, 'spell:shillelagh');
    const heal = library.add(id, 'spell:cure-wounds');
    const shield = library.add(id, 'spell:shield');
    library.prepare(id, heal, true);
    library.prepare(id, shield, true);
    const token = { id: 'hero', characterSheetId: id };
    const combat = new CombatSession({ library });
    combat.startTurn(token);
    combat.useAction(token, `spell:${bonus}`);
    expect(combat.availableActions(token).some((action) => action.id === `spell:${heal}`)).toBe(
      ruleset === '2024'
    );
    if (ruleset === '2014') continue;
    combat.useAction(token, `spell:${heal}`);
    expect(combat.availableActions(token).some((action) => action.id === `spell:${shield}`)).toBe(
      false
    );
    combat.endTurn();
    const other = { id: 'other', characterSheetId: library.create('Other') };
    combat.startTurn(other);
    expect(combat.availableActions(token).some((action) => action.id === `spell:${shield}`)).toBe(
      true
    );
    combat.adjustEconomy(token, { reactions: 2 });
    combat.useAction(token, `spell:${shield}`);
    expect(combat.status(token).reactions).toBe(1);
    expect(combat.availableActions(token).some((action) => action.id === `spell:${shield}`)).toBe(
      false
    );
    expect(library.get(id).slotsUsed[0]).toBe(2);
  }
});

test('2024 Action Surge excludes Magic actions and spends restricted credit before ordinary actions', () => {
  for (const ruleset of ['2014', '2024']) {
    const library = libraryFor(ruleset);
    const id = library.create('Fighter');
    library.edit(id, { level: 2, castingAbility: 'intelligence', slotOverrides: { 1: 2 } });
    const spell = library.add(id, 'spell:magic-missile');
    const token = { id: 'hero', characterSheetId: id };
    const combat = new CombatSession({ library });
    combat.startTurn(token);
    combat.useAction(token, 'dash');
    combat.useAction(token, 'ability:action-surge');
    expect(combat.availableActions(token).some((action) => action.id === `spell:${spell}`)).toBe(
      ruleset === '2014'
    );
    combat.useAction(token, 'dash');
    combat.undoLastUse(token);
    expect(combat.availableActions(token).some((action) => action.id === `spell:${spell}`)).toBe(
      ruleset === '2014'
    );
    combat.endCombat();
    library.rest.longRest(id);
    combat.startTurn(token);
    combat.useAction(token, 'ability:action-surge');
    combat.useAction(token, 'dash');
    expect(combat.availableActions(token).some((action) => action.id === `spell:${spell}`)).toBe(
      true
    );
  }
});

test('2024 martial actions use revised dice, target saves and independent Focus bonus strikes', () => {
  for (const ruleset of ['2014', '2024']) {
    const library = libraryFor(ruleset);
    const id = library.create('Monk');
    library.edit(id, { classId: 'monk', level: 5, abilities: { dexterity: 16, wisdom: 14 } });
    const token = { id: 'hero', characterSheetId: id };
    const combat = new CombatSession({ library });
    combat.startTurn(token);
    const actions = combat.availableActions(token);
    expect(actions.find((action) => action.id === 'attack:unarmed').followups[0].expression).toBe(
      ruleset === '2014' ? '1d6+3' : '1d8+3'
    );
    expect(actions.some((action) => action.id === 'bonus:martial-arts')).toBe(ruleset === '2024');
    expect(actions.some((action) => action.id === 'ability:flurry')).toBe(ruleset === '2024');
    const grapple = actions.find((action) => action.id === 'grapple');
    if (ruleset === '2014') {
      expect(grapple.roll.expression).toContain('1d20');
      continue;
    }
    expect(grapple.roll).toBeNull();
    expect(grapple.note).toContain('DC 14');
    combat.useAction(token, 'ability:flurry');
    expect(combat.status(token).bonusAttacksRemaining).toBe(2);
    expect(
      library.rest.status(id).resources.find((resource) => resource.id === 'focus').remaining
    ).toBe(4);
    combat.endCombat();
    library.edit(id, { level: 10 });
    combat.startTurn(token);
    combat.useAction(token, 'ability:flurry');
    expect(combat.status(token).bonusAttacksRemaining).toBe(3);
    combat.endCombat();
    library.edit(id, { classId: 'paladin', level: 3 });
    combat.startTurn(token);
    const paladin = combat.availableActions(token);
    expect(paladin.find((action) => action.id === 'ability:lay-on-hands').cost).toBe('bonus');
    expect(paladin.find((action) => action.id === 'ability:divine-sense')).toMatchObject({
      cost: 'bonus',
      resourceId: 'channel-divinity',
    });
  }
});

test('2024 short-rest choices and minimum Hit Die healing obey their own recovery rules', () => {
  const library = libraryFor('2024');
  const id = library.create('Sorcerer');
  library.edit(id, { classId: 'sorcerer', level: 5, abilities: { constitution: 6 } });
  const resource = (key) => library.rest.status(id).resources.find((row) => row.id === key);
  library.rest.setResourceRemaining(id, 'sorcery-points', 0);
  library.rest.shortRest(id);
  expect(resource('sorcery-points').remaining).toBe(0);
  expect(library.rest.status(id).shortRestChoices).toHaveLength(1);
  library.rest.shortRest(id, { sorcerousRestoration: true });
  expect(resource('sorcery-points').remaining).toBe(2);
  expect(resource('sorcerous-restoration').remaining).toBe(0);
  expect(() => library.rest.shortRest(id, { sorcerousRestoration: true })).toThrow('Long Rest');
  library.rest.longRest(id);
  expect(resource('sorcerous-restoration').remaining).toBe(1);
  library.edit(id, { hp: { current: 0 } });
  expect(() => library.rest.shortRest(id)).toThrow('1 HP');
  library.edit(id, { hp: { current: 5 } });
  expect(library.rest.spendHitDie(id, 1)).toMatchObject({ healing: 1, applied: 1 });
});

test('custom Magic actions cannot use 2024 Action Surge credit', () => {
  const library = libraryFor('2024');
  const id = library.create('Fighter');
  library.edit(id, { level: 2 });
  const action = library.actions.upsert(id, {
    name: 'Magic feature',
    cost: 'action',
    magicAction: true,
  });
  const token = { id: 'hero', characterSheetId: id };
  const combat = new CombatSession({ library });
  combat.startTurn(token);
  combat.useAction(token, 'dash');
  combat.useAction(token, 'ability:action-surge');
  expect(combat.availableActions(token).some((entry) => entry.id === `custom:${action}`)).toBe(
    false
  );
});

test('Wizard Arcane Recovery uses a calendar day only in 2014, not in 2024', () => {
  for (const ruleset of ['2014', '2024']) {
    const library = libraryFor(ruleset);
    const id = library.create('Wizard');
    library.edit(id, { classId: 'wizard', level: 3 });
    library.setSlotUsed(id, 1, 1);
    library.rest.shortRest(id);
    library.rest.recoverSpellSlots(id, { 1: 1 });
    const remaining = () =>
      library.rest.status(id).resources.find((resource) => resource.id === 'arcane-recovery')
        .remaining;
    expect(remaining()).toBe(0);
    library.rest.longRest(id);
    expect(remaining()).toBe(ruleset === '2024' ? 1 : 0);
  }
});
