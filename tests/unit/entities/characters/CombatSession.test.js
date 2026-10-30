import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import snapshot from '../../../../assets/data/srd2014.json';

let library;
let session;
let token;

beforeEach(() => {
  localStorage.clear();
  library = new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: snapshot.entries,
    classes: snapshot.classes,
  });
  token = { id: 'hero', characterSheetId: library.create('Nora') };
  session = new CombatSession({ library });
});

test('a saved combat session restores committed turn budgets and completed rolls without replaying pending work', () => {
  library.edit(token.characterSheetId, { level: 5 });
  session.startTurn(token);
  session.useAction(token, 'attack:unarmed');
  const scope = session.captureRoll(token);
  session.recordRoll(scope, { label: 'Check', expression: '1d20+2', rollText: 'Check: 12' });
  session.prepareAction(token, 'attack:unarmed');
  const saved = session.snapshot();
  const restoredToken = { id: token.id, characterSheetId: token.characterSheetId };
  const restored = new CombatSession({ library });
  restored.restore(saved, [restoredToken]);
  expect(restored.status(restoredToken)).toMatchObject({
    active: true,
    isTurn: true,
    actions: 0,
    attacksRemaining: 1,
    attacksAvailable: 1,
    canUndo: false,
  });
  expect(restored.pending).toBeNull();
  expect(restored.history(restoredToken)).toHaveLength(2);
  restored.useAction(restoredToken, 'attack:unarmed');
  expect(restored.status(restoredToken).attacksAvailable).toBe(0);
});

test('manual combat shares one movement allowance across clicks and never resets it between moves', () => {
  expect(session.active).toBe(false);
  session.startTurn(token);
  const first = session.beginMovement(token, 10);
  expect(session.status(token).movement.remaining).toBe(20);
  session.finishMovement(first, 10);
  const second = session.beginMovement(token, 20);
  session.finishMovement(second, 20);
  expect(session.status(token).movement).toMatchObject({ spent: 30, remaining: 0, total: 30 });
  expect(() => session.beginMovement(token, 5)).toThrow('movement');
  session.endTurn();
  expect(session.status(token).isTurn).toBe(false);
  session.startTurn(token);
  expect(session.status(token).movement.remaining).toBe(30);
  session.endCombat();
  expect(session.active).toBe(false);
});

test('Extra Attack commits the action to attacks without spending bonus actions or reactions', () => {
  library.edit(token.characterSheetId, { classId: 'barbarian', level: 5 });
  const sword = library.add(token.characterSheetId, 'item:longsword');
  library.equip(token.characterSheetId, sword, true);
  session.startTurn(token);
  session.useAction(token, `attack:${sword}`);
  expect(session.status(token)).toMatchObject({
    actions: 0,
    attacksRemaining: 1,
    bonusActions: 1,
    reactions: 1,
  });
  expect(session.availableActions(token).map((action) => action.id)).toContain(`attack:${sword}`);
  expect(session.availableActions(token).map((action) => action.id)).not.toContain('dash');
  session.useAction(token, `attack:${sword}`);
  expect(session.status(token).attacksRemaining).toBe(0);
  expect(session.availableActions(token).map((action) => action.id)).not.toContain(
    `attack:${sword}`
  );
});

test('Dash spends the action and a manual movement correction does not change character speed', () => {
  session.startTurn(token);
  const move = session.beginMovement(token, 10);
  expect(() => session.endTurn()).toThrow('movement');
  session.finishMovement(move, 10);
  session.useAction(token, 'dash');
  expect(session.status(token)).toMatchObject({
    actions: 0,
    movement: { spent: 10, total: 60, remaining: 50 },
  });
  session.adjustMovement(token, 5);
  expect(session.status(token).movement.remaining).toBe(5);
  expect(library.get(token.characterSheetId).speed).toBe(30);
  expect(() => session.beginMovement(token, 10)).toThrow('movement');
});

test('2014 bonus-action casting spends its slot and permits only action cantrips as other spells that turn', () => {
  const id = token.characterSheetId;
  library.edit(id, { classId: 'wizard', level: 7, abilities: { intelligence: 16 } });
  const misty = library.add(id, 'spell:misty-step');
  const fireball = library.add(id, 'spell:fireball');
  const bolt = library.add(id, 'spell:fire-bolt');
  library.prepare(id, misty, true);
  library.prepare(id, fireball, true);
  session.startTurn(token);
  session.useAction(token, `spell:${misty}`);
  expect(session.status(token).bonusActions).toBe(0);
  expect(library.get(id).slotsUsed[1]).toBe(1);
  const available = session.availableActions(token).map((action) => action.id);
  expect(available).not.toContain(`spell:${fireball}`);
  expect(available).toContain(`spell:${bolt}`);
  session.useAction(token, `spell:${bolt}`);
  expect(session.status(token).actions).toBe(0);
});

test('Action Surge, Second Wind and off-turn reactions use their own actual pools', () => {
  const id = token.characterSheetId;
  library.edit(id, { classId: 'fighter', level: 5 });
  session.startTurn(token);
  session.useAction(token, 'dash');
  session.useAction(token, 'ability:action-surge');
  expect(session.status(token).actions).toBe(1);
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === 'action-surge').remaining
  ).toBe(0);
  session.useAction(token, 'ability:second-wind');
  expect(session.status(token).bonusActions).toBe(0);
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === 'second-wind').remaining
  ).toBe(0);
  session.endTurn();
  session.useAction(token, 'reaction:manual');
  expect(session.status(token).reactions).toBe(0);
  const other = { id: 'other', characterSheetId: library.create('Other') };
  session.startTurn(other);
  expect(session.status(token).reactions).toBe(0);
  session.endTurn();
  session.startTurn(token);
  expect(session.status(token).reactions).toBe(1);
});

test('undo refunds only the latest use and leaves movement and later HP changes intact', () => {
  const id = token.characterSheetId;
  library.edit(id, { classId: 'fighter', level: 5 });
  session.startTurn(token);
  const move = session.beginMovement(token, 10);
  session.finishMovement(move, 10);
  session.useAction(token, 'dash');
  session.useAction(token, 'ability:second-wind');
  library.edit(id, { hp: { current: 3 } });
  session.undoLastUse(token);
  expect(session.status(token)).toMatchObject({
    actions: 0,
    bonusActions: 1,
    movement: { spent: 10, total: 60, remaining: 50 },
  });
  expect(library.get(id).hp.current).toBe(3);
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === 'second-wind').remaining
  ).toBe(1);
});

test('a saved attack override grants the configured count and changes during a roll cancel without spending', () => {
  const id = token.characterSheetId;
  library.actions.setAttackCount(id, 3);
  const restored = new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: snapshot.entries,
    classes: snapshot.classes,
  });
  session = new CombatSession({ library: restored });
  session.startTurn(token);
  const ticket = session.prepareAction(token, 'attack:unarmed');
  restored.actions.setAttackCount(id, 2);
  expect(() => session.commitAction(ticket)).toThrow('changed');
  expect(session.pending).toBeNull();
  expect(session.status(token)).toMatchObject({ actions: 1, attacksRemaining: 0 });
  session.useAction(token, 'attack:unarmed');
  expect(session.status(token)).toMatchObject({ actions: 0, attacksRemaining: 1 });
  session.useAction(token, 'attack:unarmed');
  expect(session.availableActions(token).map((action) => action.id)).not.toContain(
    'attack:unarmed'
  );
  expect(() => restored.actions.setAttackCount(id, 0)).toThrow();
  expect(restored.actions.snapshot(id).attackCountOverride).toBe(2);
});

test('zero HP blocks ordinary combat actions and requested movement without spending their budgets', () => {
  const id = token.characterSheetId;
  session.startTurn(token);
  const ticket = session.prepareAction(token, 'attack:unarmed');
  library.edit(id, { hp: { current: 0 } });
  expect(() => session.commitAction(ticket)).toThrow('available');
  expect(session.pending).toBeNull();
  expect(session.availableActions(token)).toEqual([]);
  expect(session.movementAllowance(token)).toBe(0);
  expect(() => session.beginMovement(token, 0)).toThrow('0 HP');
  expect(session.status(token)).toMatchObject({ actions: 1, bonusActions: 1, reactions: 1 });
  library.edit(id, { hp: { current: 1 } });
  expect(session.movementAllowance(token)).toBe(30);
  expect(session.availableActions(token).map((action) => action.id)).toContain('attack:unarmed');
});

test('a failed persistent cost does not spend the in-memory action pool or leave a pending use', () => {
  const id = token.characterSheetId;
  library.edit(id, { classId: 'fighter', level: 5 });
  session.startTurn(token);
  const original = Storage.prototype.setItem;
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.startsWith('taverntable.character-rest.v1.')) throw new Error('Storage quota');
    return original.call(this, key, value);
  });
  try {
    expect(() => session.useAction(token, 'ability:second-wind')).toThrow(
      'previous data was restored'
    );
  } finally {
    write.mockRestore();
  }
  expect(session.pending).toBeNull();
  expect(session.status(token).bonusActions).toBe(1);
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === 'second-wind').remaining
  ).toBe(1);
  session.useAction(token, 'ability:second-wind');
  expect(session.status(token).bonusActions).toBe(0);
});

test('Flurry spends one bonus action and Ki for exactly two follow-up strikes, not extra reactions', () => {
  const id = token.characterSheetId;
  library.edit(id, { classId: 'monk', level: 5 });
  session.startTurn(token);
  expect(session.availableActions(token).map((action) => action.id)).not.toContain(
    'ability:flurry'
  );
  session.useAction(token, 'attack:unarmed');
  session.useAction(token, 'attack:unarmed');
  session.useAction(token, 'ability:flurry');
  expect(session.status(token)).toMatchObject({
    bonusActions: 0,
    bonusAttacksRemaining: 2,
    reactions: 1,
  });
  expect(library.rest.status(id).resources.find((resource) => resource.id === 'ki').remaining).toBe(
    4
  );
  session.useAction(token, 'bonus:flurry-strike');
  session.useAction(token, 'bonus:flurry-strike');
  expect(session.availableActions(token).map((action) => action.id)).not.toContain(
    'bonus:flurry-strike'
  );
  expect(
    session.availableActions(token).filter((action) => action.id === 'opportunity:unarmed')
  ).toHaveLength(1);
  session.endTurn();
  const opportunity = session.useAction(token, 'opportunity:unarmed');
  expect(opportunity.followups[0].expression).toContain('1d6');
  expect(session.status(token)).toMatchObject({ reactions: 0, attacksRemaining: 0 });
});

test('a no-action turn-limited feature refreshes on each creature turn, not each view or End Turn', () => {
  const custom = library.actions.upsert(token.characterSheetId, {
    name: 'Once per turn',
    cost: 'free',
    maximum: 1,
    reset: 'turn',
  });
  const actionId = `custom:${custom}`;
  session.startTurn(token);
  session.useAction(token, actionId);
  expect(session.status(token)).toMatchObject({ actions: 1, bonusActions: 1, reactions: 1 });
  expect(session.availableActions(token).map((action) => action.id)).not.toContain(actionId);
  session.endTurn();
  expect(session.availableActions(token).map((action) => action.id)).not.toContain(actionId);
  const other = { id: 'other', characterSheetId: library.create('Other') };
  session.startTurn(other);
  expect(session.availableActions(token).map((action) => action.id)).toContain(actionId);
  session.useAction(token, actionId);
  expect(session.status(other).actions).toBe(1);
  expect(library.actions.snapshot(token.characterSheetId).entries[0].used).toBe(0);
});

test('a custom feature linked to a class pool shares the real counter and targeted Undo', () => {
  const id = token.characterSheetId;
  library.edit(id, { classId: 'fighter', level: 5 });
  const custom = library.actions.upsert(id, {
    name: 'Alternate Wind',
    cost: 'free',
    resourceId: 'second-wind',
    resourceCost: 1,
  });
  session.startTurn(token);
  session.useAction(token, `custom:${custom}`);
  expect(session.status(token).bonusActions).toBe(1);
  expect(session.availableActions(token).map((action) => action.id)).not.toContain(
    'ability:second-wind'
  );
  expect(
    library.rest.status(id).resources.some((resource) => resource.id === `custom:${custom}`)
  ).toBe(false);
  session.undoLastUse(token);
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === 'second-wind').remaining
  ).toBe(1);
  expect(session.availableActions(token).map((action) => action.id)).toContain(
    'ability:second-wind'
  );
});

test('Undo cannot refund already-used Dash movement or overwrite a later DM movement correction', () => {
  session.startTurn(token);
  session.useAction(token, 'dash');
  const movement = session.beginMovement(token, 40);
  session.finishMovement(movement, 40);
  expect(() => session.undoLastUse(token)).toThrow('movement has already been used');
  expect(session.status(token).movement.remaining).toBe(20);
  session.adjustMovement(token, 5);
  expect(session.status(token)).toMatchObject({
    canUndo: false,
    movement: { spent: 40, remaining: 5 },
  });
  expect(() => session.undoLastUse(token)).toThrow('No matching action');
});

test('combat cannot begin or change turns while a free-play route or forced scene movement is unfinished', () => {
  let moving = true;
  session = new CombatSession({ library, isSceneMoving: () => moving });
  expect(session.status(token).busy).toBe(true);
  expect(() => session.startTurn(token)).toThrow('movement');
  expect(session.active).toBe(false);
  moving = false;
  session.startTurn(token);
  moving = true;
  expect(() => session.endTurn()).toThrow('movement');
  expect(() => session.endCombat()).toThrow('movement');
  moving = false;
  session.endCombat();
  expect(session.active).toBe(false);
});
