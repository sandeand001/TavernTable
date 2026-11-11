import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import snapshot from '../../../../assets/data/srd2014.json';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: snapshot.entries,
    classes: snapshot.classes,
  });
  const first = { id: 'first', characterSheetId: library.create('First') };
  const second = { id: 'second', characterSheetId: library.create('Second') };
  return { library, first, second, session: new CombatSession({ library }) };
}

test('two free-play characters may reserve and complete independent actions concurrently', () => {
  const { first, second, session } = fixture();
  const a = session.prepareAction(first, 'attack:unarmed');
  const b = session.prepareAction(second, 'attack:unarmed');
  expect(session.isActionPending(a)).toBe(true);
  expect(session.isActionPending(b)).toBe(true);
  session.commitAction(b);
  expect(session.isActionPending(a)).toBe(true);
  session.commitAction(a);
  expect(session.isActionPending(a)).toBe(false);
  expect(session.isActionPending(b)).toBe(false);
});

test('independent free-play movement reservations do not block each other', () => {
  const { first, second, session } = fixture();
  const a = session.beginConnectionMovement(first, 5);
  const b = session.beginConnectionMovement(second, 5);
  expect(session.moves.size).toBe(2);
  session.finishMovement(b, 5);
  expect(session.moves.has(a.id)).toBe(true);
  session.finishMovement(a, 5);
});

test('the same character cannot start a second action until its first action finishes', () => {
  const { first, session } = fixture();
  const pending = session.prepareAction(first, 'attack:unarmed');
  expect(() => session.prepareAction(first, 'attack:unarmed')).toThrow(/current action/i);
  session.cancelAction(pending);
  expect(session.prepareAction(first, 'attack:unarmed')).toBeTruthy();
});

test('combat keeps the existing active-turn and single-action sequencing rules', () => {
  const { first, second, session } = fixture();
  session.startTurn(first);
  const pending = session.prepareAction(first, 'attack:unarmed');
  expect(() => session.prepareAction(second, 'attack:unarmed')).toThrow();
  session.cancelAction(pending);
  expect(() => session.beginMovement(second, 5)).toThrow(/active turn/i);
});

test('independent commits wait for the persistence lane without cancelling their reservations', async () => {
  const { library, first, second, session } = fixture();
  let saving = false;
  Object.defineProperty(library, 'isSaving', { get: () => saving });
  const a = session.prepareAction(first, 'attack:unarmed');
  const b = session.prepareAction(second, 'attack:unarmed');
  saving = true;
  const commitA = session.commitAction(a);
  const commitB = session.commitAction(b);
  expect(session.isActionPending(a)).toBe(true);
  expect(session.isActionPending(b)).toBe(true);
  expect(session.history(first)).toHaveLength(0);
  expect(session.history(second)).toHaveLength(0);
  saving = false;
  session.syncMovementStatus();
  await Promise.all([commitA, commitB]);
  expect(session.history(first)).toHaveLength(1);
  expect(session.history(second)).toHaveLength(1);
  expect(session.pending).toBeNull();
});

test('the next command wakes when its own movement ends even while another creature remains moving', async () => {
  const { first, second, session } = fixture();
  const moving = new Set([first, second]);
  session.isMoving = (token) => moving.has(token);
  session.isSceneMoving = () => moving.size > 0;
  session.syncMovementStatus();
  const execute = jest.fn(() => 'done');
  const request = session.runWhenReady(first, execute);
  await Promise.resolve();
  expect(execute).not.toHaveBeenCalled();
  moving.delete(first);
  session.syncMovementStatus();
  expect(await request).toBe('done');
  expect(moving.has(second)).toBe(true);
  expect(execute).toHaveBeenCalledTimes(1);
});
