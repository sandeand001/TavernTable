import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import snapshot from '../../../../assets/data/srd2014.json';

let library;
let session;
let hero;
let other;

beforeEach(() => {
  localStorage.clear();
  library = new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: snapshot.entries,
    classes: snapshot.classes,
  });
  hero = { id: 'hero', characterSheetId: library.create('Hero') };
  other = { id: 'other', characterSheetId: library.create('Other') };
  session = new CombatSession({ library });
});

test('all history retains every use for the selected character while this-turn history follows the manual turn', () => {
  const action = library.actions.upsert(hero.characterSheetId, { name: 'Signal', cost: 'free' });
  session.startTurn(hero);
  for (let index = 0; index < 12; index++) session.useAction(hero, `custom:${action}`);
  expect(session.history(hero, 'all')).toHaveLength(12);
  expect(session.history(hero, 'turn')).toHaveLength(12);
  session.endTurn();
  session.startTurn(other);
  session.useAction(other, 'dash');
  expect(session.history(hero, 'turn')).toEqual([]);
  expect(session.history(hero, 'all')).toHaveLength(12);
  expect(session.history(other, 'all')).toHaveLength(1);
  session.endCombat();
  expect(session.history(hero, 'all')).toHaveLength(12);
  expect(session.history(hero, 'turn')).toEqual([]);
});

test('a roll is attributed to the character and turn where it began without spending an action', () => {
  const originalId = hero.characterSheetId;
  session.startTurn(hero);
  const scope = session.captureRoll(hero);
  session.endTurn();
  session.startTurn(other);
  hero.characterSheetId = other.characterSheetId;
  const roll = { label: 'Hero: Stealth', expression: '1d20', rollText: 'Stealth = 14' };
  session.recordRoll(scope, roll);
  expect(session.history(hero, 'all')).toEqual([]);
  hero.characterSheetId = originalId;
  expect(session.history(hero, 'all')).toEqual([
    expect.objectContaining({ type: 'roll', label: 'Hero: Stealth', turn: 1 }),
  ]);
  expect(session.history(hero, 'turn')).toEqual([]);
  expect(session.status(hero)).toMatchObject({ actions: 1, bonusActions: 1, reactions: 1 });
  expect(() => session.recordRoll(scope, roll)).toThrow('roll context');
});

test('Undo marks the use without removing its roll history or treating a free roll as a paid use', () => {
  session.startTurn(hero);
  const use = session.useAction(hero, 'dash');
  session.recordRoll(session.captureRoll(hero), {
    label: 'Wisdom save',
    expression: '1d20',
    rollText: 'Wisdom = 12',
  });
  session.undoLastUse(hero);
  expect(session.status(hero)).toMatchObject({ actions: 1, movement: { total: 30 } });
  expect(session.history(hero)).toHaveLength(2);
  expect(session.historyEntry(hero, use.sequence).undone).toBe(true);
  expect(session.history(hero)[0].rollText).toBe('Wisdom = 12');
});

test('invalid roll summaries fail before costs and valid history summaries are independent snapshots', () => {
  library.edit(hero.characterSheetId, { classId: 'fighter', level: 5 });
  session.startTurn(hero);
  const invalid = session.prepareAction(hero, 'ability:second-wind');
  expect(() =>
    session.commitAction(invalid, 'Healing', {
      label: 'Second Wind healing',
      total: NaN,
      breakdown: 'Invalid',
    })
  ).toThrow('invalid');
  expect(session.pending).toBeNull();
  expect(session.status(hero).bonusActions).toBe(1);
  expect(
    library.rest.status(hero.characterSheetId).resources.find((row) => row.id === 'second-wind')
      .remaining
  ).toBe(1);
  const summary = { label: 'Second Wind healing', total: 8, breakdown: '1d10 [3] + 5 = 8' };
  const use = session.commitAction(
    session.prepareAction(hero, 'ability:second-wind'),
    'Healing = 8',
    summary
  );
  summary.total = 99;
  const copy = session.historyEntry(hero, use.sequence);
  copy.rollResult.total = 100;
  expect(session.historyEntry(hero, use.sequence).rollResult.total).toBe(8);
  expect(session.status(hero).bonusActions).toBe(0);
});
