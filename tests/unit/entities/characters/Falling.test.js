import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import { snapshotCombat } from '../../../../src/entities/characters/combat/persistence.js';
import classic from '../../../../assets/data/srd2014.json';
import revised from '../../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

describe.each([
  ['2014', classic],
  ['2024', revised],
])('%s falling, health and movement', (ruleset, data) => {
  let library;
  let token;
  let session;
  const fall = (updates = {}) => ({
    id: 'fall-one',
    characterId: token.characterSheetId,
    distanceFeet: 20,
    rawDamage: 9,
    reduction: 0,
    proneImmune: false,
    avoidDamage: false,
    featherFall: false,
    roll: { expression: '2d6', text: '2d6 [4, 5] = 9' },
    ...updates,
  });
  const prone = () => library.edit(token.characterSheetId, { conditions: ['prone'] });

  beforeEach(() => {
    localStorage.clear();
    library = new CharacterLibrary({
      ruleset,
      storage: localStorage,
      catalog: data.entries,
      classes: data.classes,
    });
    token = { id: 'hero', characterSheetId: library.create('Nora') };
    session = new CombatSession({ library });
  });

  test('landing damages temporary HP first, persists Prone and records the result only once', () => {
    library.edit(token.characterSheetId, { hp: { temp: 3 } });
    session.startTurn(token);
    session.applyFall(token, fall());
    expect(library.get(token.characterSheetId)).toMatchObject({
      hp: { temp: 0, current: 4 },
      conditions: ['prone'],
      lastFall: { id: 'fall-one', damage: 9, prone: true },
    });
    session.applyFall(token, fall());
    expect(library.get(token.characterSheetId).hp.current).toBe(4);
    expect(session.history(token)).toHaveLength(1);
    session.endTurn();
    session.startTurn(token);
    expect(library.get(token.characterSheetId).conditions).toContain('prone');
  });

  test('temporary HP absorbing all damage still leaves the creature Prone', () => {
    library.edit(token.characterSheetId, { hp: { temp: 20 } });
    library.applyFall(token.characterSheetId, fall());
    expect(library.get(token.characterSheetId)).toMatchObject({
      hp: { current: 10, temp: 11 },
      conditions: ['prone'],
    });
  });

  test('full reduction avoids Prone; Feather Fall ends on landing; existing Prone is not cleared', () => {
    library.applyFall(token.characterSheetId, fall({ reduction: 20 }));
    expect(library.get(token.characterSheetId)).toMatchObject({
      hp: { current: 10 },
      conditions: [],
    });
    library.edit(token.characterSheetId, { fallTraits: { featherFall: true } });
    library.applyFall(
      token.characterSheetId,
      fall({ id: 'feather', rawDamage: 0, avoidDamage: true, featherFall: true })
    );
    expect(library.get(token.characterSheetId).fallTraits.featherFall).toBe(false);
    prone();
    library.applyFall(token.characterSheetId, fall({ id: 'already-prone', reduction: 20 }));
    expect(library.get(token.characterSheetId).conditions).toContain('prone');
  });

  test('standing spends half Speed and absolutely no action economy', () => {
    prone();
    session.startTurn(token);
    const move = session.beginMovement(token, 10);
    session.finishMovement(move, 10);
    session.standUp(token);
    expect(library.get(token.characterSheetId).conditions).not.toContain('prone');
    expect(session.status(token)).toMatchObject({
      actions: 1,
      bonusActions: 1,
      reactions: 1,
      movement: { total: 30, spent: 25, remaining: 5 },
    });
  });

  test('Dash changes the allowance but not the cost of standing', () => {
    prone();
    session.startTurn(token);
    session.useAction(token, 'dash');
    const move = session.beginMovement(token, 40);
    session.finishMovement(move, 40);
    session.standUp(token);
    expect(session.status(token)).toMatchObject({
      actions: 0,
      bonusActions: 1,
      reactions: 1,
      movement: { base: 30, total: 60, spent: 55, remaining: 5 },
    });
  });

  test('cannot stand without enough movement, on another turn, at Speed 0 or while restrained', () => {
    prone();
    session.startTurn(token);
    const move = session.beginMovement(token, 20);
    session.finishMovement(move, 20);
    expect(() => session.standUp(token)).toThrow('15 feet');
    session.endTurn();
    expect(() => session.standUp(token)).toThrow('turn');
    session.endCombat();
    library.edit(token.characterSheetId, { speed: 0 });
    expect(() => session.standUp(token)).toThrow('Speed 0');
    library.edit(token.characterSheetId, { speed: 30, conditions: ['prone', 'restrained'] });
    expect(() => session.standUp(token)).toThrow('restricted');
  });

  test('exactly half the allowance can be spent to stand, leaving zero movement', () => {
    prone();
    session.startTurn(token);
    const move = session.beginMovement(token, 15);
    session.finishMovement(move, 15);
    session.standUp(token);
    expect(session.movementAllowance(token)).toBe(0);
  });

  test('standing preserves the previous action undo without refunding standing movement', () => {
    prone();
    session.startTurn(token);
    session.useAction(token, 'dash');
    session.standUp(token);
    expect(session.status(token).canUndo).toBe(true);
    session.undoLastUse(token);
    expect(session.status(token)).toMatchObject({
      actions: 1,
      movement: { spent: 15, total: 30, remaining: 15 },
    });
    expect(library.get(token.characterSheetId).conditions).not.toContain('prone');
  });

  test('a hovering prone flyer rights itself using half fly speed without an action', () => {
    library.edit(token.characterSheetId, {
      conditions: ['prone'],
      fallTraits: { flySpeed: 40, hover: true },
    });
    token.flightActive = true;
    session.startTurn(token);
    expect(session.standingAvailability(token)).toMatchObject({ allowed: true, cost: 20 });
    session.standUp(token);
    expect(session.status(token)).toMatchObject({
      actions: 1,
      bonusActions: 1,
      reactions: 1,
      movement: { base: 40, spent: 20, remaining: 20 },
    });
  });

  test('Incapacitated alone does not prevent movement-only standing', () => {
    library.edit(token.characterSheetId, { conditions: ['prone', 'incapacitated'] });
    session.startTurn(token);
    session.standUp(token);
    expect(library.get(token.characterSheetId).conditions).toEqual(['incapacitated']);
    expect(session.status(token)).toMatchObject({
      actions: 1,
      bonusActions: 1,
      reactions: 1,
      movement: { spent: 15, remaining: 15 },
    });
    expect(session.availableActions(token)).toEqual([]);
  });

  test('free-play standing reduces the next move allowance and survives scene reload', () => {
    prone();
    session.standUp(token);
    expect(session.freeMovementAllowance(token)).toBe(15);
    const restored = new CombatSession({ library });
    restored.restore(session.snapshot(), [token]);
    expect(restored.freeMovementAllowance(token)).toBe(15);
    restored.completeFreeMovement(token);
    expect(restored.freeMovementAllowance(token)).toBe(30);
  });

  test('the character commit snapshot includes the new standing movement cost', async () => {
    prone();
    session.startTurn(token);
    let saved;
    library.withCombatSnapshot = (factory, operation) => {
      const result = operation();
      saved = snapshotCombat(factory(library), { movementSession: session });
      return Promise.resolve(result);
    };
    await session.standUp(token);
    expect(saved.states[0].movementSpent).toBe(15);
    const restored = new CombatSession({ library });
    restored.restore(saved, [token]);
    expect(restored.movementAllowance(token)).toBe(15);
  });

  test('a failed standing save leaves Prone and every budget unchanged', async () => {
    prone();
    session.startTurn(token);
    jest.spyOn(library, 'edit').mockRejectedValueOnce(new Error('Storage full'));
    await expect(session.standUp(token)).rejects.toThrow('Storage full');
    expect(library.get(token.characterSheetId).conditions).toContain('prone');
    expect(session.status(token)).toMatchObject({
      actions: 1,
      bonusActions: 1,
      reactions: 1,
      movement: { spent: 0, remaining: 30 },
      busy: false,
    });
  });

  test('Slow Fall consumes one reaction and cannot be spent twice for the same fall', () => {
    library.edit(token.characterSheetId, { classId: 'monk', level: 4 });
    session.startTurn(token);
    expect(session.slowFallAvailability(token)).toMatchObject({ allowed: true, reduction: 20 });
    expect(session.useSlowFall(token, 'fall-one')).toBe(20);
    expect(session.useSlowFall(token, 'fall-one')).toBe(20);
    expect(session.status(token)).toMatchObject({ actions: 1, bonusActions: 1, reactions: 0 });
    expect(session.slowFallAvailability(token).allowed).toBe(false);
    expect(() => session.useSlowFall(token, 'fall-two')).toThrow('reaction');
    expect(session.history(token)).toHaveLength(1);
  });

  test('Prone and flight round-trip through backups; old records still load', () => {
    prone();
    library.edit(token.characterSheetId, { fallTraits: { flySpeed: 40, hover: true } });
    const imported = library.import(library.export(token.characterSheetId));
    expect(library.get(imported)).toMatchObject({
      conditions: ['prone'],
      fallTraits: { flySpeed: 40, hover: true },
    });
    const old = library.get(token.characterSheetId);
    delete old.conditions;
    delete old.fallTraits;
    localStorage.setItem(`taverntable.character.v1.${old.id}`, JSON.stringify(old));
    expect(library.get(old.id).name).toBe('Nora');
  });
});
