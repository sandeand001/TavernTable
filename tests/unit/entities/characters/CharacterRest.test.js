import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import snapshot from '../../../../assets/data/srd2014.json';

function library() {
  return new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: snapshot.entries,
    classes: snapshot.classes,
  });
}

beforeEach(() => localStorage.clear());

test('Hit Dice come from class and level without changing the existing character record format', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, { classId: 'fighter', level: 5, abilities: { constitution: 14 } });
  expect(characters.rest.status(id).hitDice).toEqual({
    sides: 10,
    total: 5,
    spent: 0,
    remaining: 5,
    constitutionModifier: 2,
  });
  const saved = JSON.parse(localStorage.getItem(`taverntable.character.v1.${id}`));
  expect(saved.version).toBe(1);
  expect(saved).not.toHaveProperty('hitDice');
  expect(saved).not.toHaveProperty('resources');
});

test('spending a Hit Die heals with Constitution, preserves temporary HP and persists the spent die', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, {
    classId: 'fighter',
    level: 5,
    abilities: { constitution: 14 },
    hp: { max: 30, current: 5, temp: 4 },
  });
  expect(characters.rest.spendHitDie(id, 7)).toMatchObject({
    roll: 7,
    modifier: 2,
    healing: 9,
    applied: 9,
    remaining: 4,
  });
  expect(library().get(id).hp).toEqual({ max: 30, current: 14, temp: 4 });
  expect(library().rest.status(id).hitDice.spent).toBe(1);
});

test.each([1, 3, 5, 20])(
  'a level %i long rest recovers half the total Hit Dice, rounded down, minimum one',
  (level) => {
    const characters = library();
    const id = characters.create('Nora');
    characters.edit(id, { classId: 'fighter', level, hp: { max: 100, current: 1 } });
    for (let die = 0; die < level; die++) characters.rest.spendHitDie(id, 1);
    expect(characters.rest.status(id).hitDice.remaining).toBe(0);
    characters.longRest(id);
    expect(characters.rest.status(id).hitDice.remaining).toBe(Math.max(1, Math.floor(level / 2)));
    expect(characters.get(id).hp).toEqual({ max: 100, current: 100, temp: 0 });
  }
);

test('Hit Dice cannot be overspent and negative Constitution cannot turn healing into damage', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, {
    classId: 'wizard',
    level: 1,
    abilities: { constitution: 3 },
    hp: { current: 4 },
  });
  expect(characters.rest.spendHitDie(id, 1)).toMatchObject({
    healing: 0,
    applied: 0,
    remaining: 0,
  });
  expect(characters.get(id).hp.current).toBe(4);
  expect(() => characters.rest.spendHitDie(id, 6)).toThrow('No Hit Dice remain');
  expect(characters.rest.status(id).hitDice.spent).toBe(1);
});

test('a stale roll cannot spend a different class or Constitution pool', () => {
  const characters = library();
  const id = characters.create('Nora');
  const before = characters.rest.status(id);
  characters.edit(id, { abilities: { constitution: 16 } });
  expect(() =>
    characters.rest.spendHitDie(id, 5, {
      classId: before.classId,
      level: before.level,
      ...before.hitDice,
    })
  ).toThrow('changed while rolling');
  expect(characters.rest.status(id).hitDice.remaining).toBe(1);
});

test('a failed companion write rolls HP back rather than granting free healing', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, { hp: { current: 2 } });
  const previous = characters.export(id);
  const original = Storage.prototype.setItem;
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.startsWith('taverntable.character-rest.v1.')) throw new Error('Storage quota');
    return original.call(this, key, value);
  });
  try {
    expect(() => characters.rest.spendHitDie(id, 5)).toThrow('previous data was restored');
  } finally {
    write.mockRestore();
  }
  expect(characters.export(id)).toBe(previous);
  expect(characters.rest.status(id).hitDice.spent).toBe(0);
});

test('a long rest cannot revive a character starting at zero HP', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, { hp: { current: 0 } });
  expect(() => characters.longRest(id)).toThrow('at least 1 HP');
  expect(characters.get(id).hp.current).toBe(0);
});

test('a short rest restores Fighter short-rest uses but not Indomitable, HP or Hit Dice', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, { classId: 'fighter', level: 9, hp: { max: 40, current: 9, temp: 3 } });
  for (const resource of ['second-wind', 'action-surge', 'indomitable']) {
    characters.rest.setResourceRemaining(id, resource, 0);
  }
  characters.rest.shortRest(id);
  const remaining = Object.fromEntries(
    characters.rest.status(id).resources.map((resource) => [resource.id, resource.remaining])
  );
  expect(remaining).toEqual({ 'second-wind': 1, 'action-surge': 1, indomitable: 0 });
  expect(characters.get(id).hp).toEqual({ max: 40, current: 9, temp: 3 });
  expect(characters.rest.status(id).hitDice.remaining).toBe(9);
  characters.longRest(id);
  expect(
    characters.rest.status(id).resources.find((resource) => resource.id === 'indomitable').remaining
  ).toBe(1);
});

test.each([
  ['barbarian', 5, 'rage', 3, 'long'],
  ['barbarian', 20, 'rage', null, 'long'],
  ['bard', 4, 'bardic-inspiration', 3, 'long'],
  ['bard', 5, 'bardic-inspiration', 3, 'short'],
  ['cleric', 6, 'channel-divinity', 2, 'short'],
  ['cleric', 18, 'channel-divinity', 3, 'short'],
  ['druid', 2, 'wild-shape', 2, 'short'],
  ['druid', 20, 'wild-shape', null, 'short'],
  ['fighter', 17, 'action-surge', 2, 'short'],
  ['fighter', 17, 'indomitable', 3, 'long'],
  ['monk', 7, 'ki', 7, 'short'],
  ['paladin', 4, 'lay-on-hands', 20, 'long'],
  ['paladin', 4, 'divine-sense', 4, 'long'],
  ['rogue', 20, 'stroke-of-luck', 1, 'short'],
  ['sorcerer', 7, 'sorcery-points', 7, 'long'],
  ['warlock', 11, 'mystic-arcanum-6', 1, 'long'],
  ['warlock', 17, 'mystic-arcanum-9', 1, 'long'],
  ['warlock', 20, 'eldritch-master', 1, 'long'],
  ['wizard', 7, 'arcane-recovery', 1, 'daily'],
  ['wizard', 20, 'signature-spell-1', 1, 'short'],
  ['wizard', 20, 'signature-spell-2', 1, 'short'],
])(
  '%s level %i derives %s capacity and rest policy',
  (classId, level, resourceId, maximum, reset) => {
    const characters = library();
    const id = characters.create('Nora');
    characters.edit(id, { classId, level, abilities: { charisma: 16 } });
    expect(
      characters.rest.status(id).resources.find((resource) => resource.id === resourceId)
    ).toMatchObject({ maximum, remaining: maximum, reset });
  }
);

test.each([
  ['bard', 4, 'bardic-inspiration', 0, 0],
  ['bard', 5, 'bardic-inspiration', 0, 3],
  ['sorcerer', 19, 'sorcery-points', 1, 1],
  ['sorcerer', 20, 'sorcery-points', 1, 5],
])(
  '%s level %i applies its exact short-rest recovery rule',
  (classId, level, resourceId, before, after) => {
    const characters = library();
    const id = characters.create('Nora');
    characters.edit(id, { classId, level, abilities: { charisma: 16 } });
    characters.rest.setResourceRemaining(id, resourceId, before);
    characters.rest.shortRest(id);
    expect(
      characters.rest.status(id).resources.find((resource) => resource.id === resourceId).remaining
    ).toBe(after);
  }
);

test('a Warlock short rest restores only Pact Magic slots and retains concentration, temp HP and Arcanum uses', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, {
    classId: 'warlock',
    level: 11,
    hp: { max: 30, current: 9, temp: 4 },
    slotOverrides: { 6: 1 },
  });
  const fly = characters.add(id, 'spell:fly');
  characters.cast(id, fly, 5);
  characters.edit(id, { slotsUsed: [0, 0, 0, 0, 3, 1, 0, 0, 0] });
  characters.rest.setResourceRemaining(id, 'mystic-arcanum-6', 0);
  characters.rest.shortRest(id);
  expect(characters.get(id)).toMatchObject({
    hp: { max: 30, current: 9, temp: 4 },
    concentration: fly,
    slotsUsed: [0, 0, 0, 0, 0, 1, 0, 0, 0],
  });
  expect(
    characters.rest.status(id).resources.find((resource) => resource.id === 'mystic-arcanum-6')
      .remaining
  ).toBe(0);
});

test('Wizard Arcane Recovery is optional, budgeted and once per declared game day', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, { classId: 'wizard', level: 7, slotsUsed: [2, 1, 1, 1, 0, 0, 0, 0, 0] });
  characters.rest.shortRest(id);
  expect(characters.get(id).slotsUsed).toEqual([2, 1, 1, 1, 0, 0, 0, 0, 0]);
  characters.rest.recoverSpellSlots(id, { 1: 1, 3: 1 });
  expect(characters.get(id).slotsUsed).toEqual([1, 1, 0, 1, 0, 0, 0, 0, 0]);
  expect(() => characters.rest.recoverSpellSlots(id, { 2: 1 })).toThrow('already used');
  characters.rest.shortRest(id);
  characters.longRest(id);
  expect(
    characters.rest.status(id).resources.find((resource) => resource.id === 'arcane-recovery')
      .remaining
  ).toBe(0);
  characters.rest.resetDaily(id);
  expect(
    characters.rest.status(id).resources.find((resource) => resource.id === 'arcane-recovery')
      .remaining
  ).toBe(1);
});

test('portable backups preserve rest usage under a new ID and legacy backups start with unspent dice', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.edit(id, { classId: 'fighter', level: 5, hp: { max: 30, current: 5 } });
  characters.rest.spendHitDie(id, 3);
  characters.rest.setResourceRemaining(id, 'second-wind', 0);
  const backup = characters.export(id);
  expect(JSON.parse(backup).version).toBe(4);
  const copy = characters.import(backup);
  expect(copy).not.toBe(id);
  expect(characters.rest.status(copy).hitDice.spent).toBe(1);
  expect(
    characters.rest.status(copy).resources.find((resource) => resource.id === 'second-wind')
      .remaining
  ).toBe(0);
  const legacy = characters.import(
    JSON.stringify({
      format: 'taverntable-character',
      version: 1,
      character: characters.get(id),
    })
  );
  expect(characters.rest.status(legacy).hitDice.spent).toBe(0);
  expect(
    characters.rest.status(legacy).resources.find((resource) => resource.id === 'second-wind')
      .remaining
  ).toBe(1);
});

test.each([{ 6: 1 }, { 3: 2 }, { 1: 4 }, { 1: -1 }, { 1: 0.5 }, {}])(
  'an invalid Arcane Recovery choice %p consumes neither slots nor the daily use',
  (selection) => {
    const characters = library();
    const id = characters.create('Nora');
    characters.edit(id, { classId: 'wizard', level: 7, slotsUsed: [2, 0, 3, 0, 0, 0, 0, 0, 0] });
    const before = characters.export(id);
    expect(() => characters.rest.recoverSpellSlots(id, selection)).toThrow();
    expect(characters.export(id)).toBe(before);
  }
);

test('malformed rest imports and failed companion imports leave no partial saved character', () => {
  const characters = library();
  const id = characters.create('Nora');
  const data = JSON.parse(characters.export(id));
  data.rest.hitDiceSpent = 21;
  expect(() => characters.import(JSON.stringify(data))).toThrow('invalid format');
  expect(characters.list()).toHaveLength(1);
  const original = Storage.prototype.setItem;
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.startsWith('taverntable.character-rest.v1.')) throw new Error('Storage quota');
    return original.call(this, key, value);
  });
  try {
    data.rest.hitDiceSpent = 0;
    expect(() => characters.import(JSON.stringify(data))).toThrow('previous data was restored');
  } finally {
    write.mockRestore();
  }
  expect(characters.list()).toHaveLength(1);
});

test('deleting a character also removes its rest companion', () => {
  const characters = library();
  const id = characters.create('Nora');
  characters.rest.spendHitDie(id, 1);
  characters.delete(id);
  expect(localStorage.getItem(`taverntable.character-rest.v1.${id}`)).toBeNull();
  expect(characters.list()).toHaveLength(0);
});

test('corrupt saved rest state is reported and never replaced with a fresh full pool', () => {
  const characters = library();
  const id = characters.create('Nora');
  const key = `taverntable.character-rest.v1.${id}`;
  localStorage.setItem(key, '{invalid');
  expect(() => characters.rest.status(id)).toThrow('invalid JSON');
  expect(localStorage.getItem(key)).toBe('{invalid');
  expect(characters.get(id).name).toBe('Nora');
});
