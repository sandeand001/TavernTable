import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import snapshot from '../../../../assets/data/srd2014.json';

const createLibrary = () =>
  new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: snapshot.entries,
    classes: snapshot.classes,
  });
beforeEach(() => localStorage.clear());

test('custom abilities persist their activation cost and limited-use policy without changing primary records', () => {
  const library = createLibrary();
  const id = library.create('Nora');
  const actionId = library.actions.upsert(id, {
    name: 'Shadow step',
    cost: 'bonus',
    maximum: 2,
    reset: 'short',
    note: 'Resolve the destination and conditions manually.',
  });
  expect(createLibrary().actions.list(id)).toEqual([
    expect.objectContaining({
      id: actionId,
      name: 'Shadow step',
      cost: 'bonus',
      maximum: 2,
      remaining: 2,
      reset: 'short',
    }),
  ]);
  expect(JSON.parse(localStorage.getItem(`taverntable.character.v1.${id}`))).not.toHaveProperty(
    'actions'
  );
});

test('action costs reuse the rest pool and undo only their own changes, not later HP edits', () => {
  const library = createLibrary();
  const id = library.create('Nora');
  library.edit(id, { classId: 'fighter', level: 5 });
  const receipt = library.actions.consume(id, { resourceId: 'second-wind', resourceCost: 1 });
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === 'second-wind').remaining
  ).toBe(0);
  library.edit(id, { hp: { current: 3 } });
  library.actions.undo(receipt);
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === 'second-wind').remaining
  ).toBe(1);
  expect(library.get(id).hp.current).toBe(3);
});

test('limited custom uses participate in their declared rest policy without entering the class pool', () => {
  const library = createLibrary();
  const id = library.create('Nora');
  const actionId = library.actions.upsert(id, {
    name: 'Veil <test>',
    cost: 'free',
    maximum: 2,
    reset: 'short',
  });
  library.actions.consume(id, { customId: actionId });
  expect(library.actions.list(id)[0].remaining).toBe(1);
  expect(
    library.rest.status(id).resources.find((resource) => resource.id === `custom:${actionId}`)
      .remaining
  ).toBe(1);
  library.rest.shortRest(id);
  expect(library.actions.list(id)[0].remaining).toBe(2);
  library.actions.consume(id, { customId: actionId });
  library.actions.upsert(id, {
    id: actionId,
    name: 'Veil <test>',
    cost: 'free',
    maximum: 2,
    reset: 'daily',
  });
  library.longRest(id);
  expect(library.actions.list(id)[0].remaining).toBe(1);
  library.rest.resetDaily(id);
  expect(library.actions.list(id)[0].remaining).toBe(2);
});

test('new backups preserve custom definitions and usage while version-2 backups still import', () => {
  const library = createLibrary();
  const id = library.create('Nora');
  const actionId = library.actions.upsert(id, {
    name: 'Veil',
    cost: 'bonus',
    maximum: 2,
    reset: 'short',
  });
  library.actions.consume(id, { customId: actionId });
  const data = JSON.parse(library.export(id));
  expect(data.version).toBe(4);
  const copy = library.import(JSON.stringify(data));
  expect(library.actions.list(copy)[0]).toMatchObject({ name: 'Veil', remaining: 1 });
  library.delete(copy);
  expect(localStorage.getItem(`taverntable.character-actions.v1.${copy}`)).toBeNull();
  delete data.actions;
  data.version = 2;
  const legacy = library.import(JSON.stringify(data));
  expect(library.actions.list(legacy)).toHaveLength(0);
});
