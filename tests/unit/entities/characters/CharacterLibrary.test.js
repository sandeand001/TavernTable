import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import snapshot from '../../../../assets/data/srd2014.json';

const catalog = [
  {
    id: 'item:shield',
    kind: 'item',
    name: 'Shield',
    equipmentType: 'shield',
    armor: { base: 2 },
    automation: 'equipment',
  },
  {
    id: 'item:chain-mail',
    kind: 'item',
    name: 'Chain Mail',
    equipmentType: 'armor',
    armor: { base: 16, dexterity: false },
    automation: 'equipment',
  },
  {
    id: 'item:leather',
    kind: 'item',
    name: 'Leather',
    equipmentType: 'armor',
    armor: { base: 11, dexterity: true },
    automation: 'equipment',
  },
  {
    id: 'magic:ring-of-protection',
    kind: 'item',
    name: 'Ring of Protection',
    equipmentType: 'magic',
    requiresAttunement: true,
    effects: { ac: 1, saves: 1 },
    automation: 'effects',
  },
];

beforeEach(() => localStorage.clear());

test('health adjustments absorb temporary HP, cap healing and never persist negative HP', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog,
  });
  const id = library.create('Mira');
  library.edit(id, { hp: { max: 30, current: 20, temp: 5 } });
  library.adjustHitPoints(id, 'damage', 8);
  expect(library.get(id).hp).toEqual({ max: 30, current: 17, temp: 0 });
  library.adjustHitPoints(id, 'heal', 100);
  expect(library.get(id).hp).toEqual({ max: 30, current: 30, temp: 0 });
  library.adjustHitPoints(id, 'damage', 100);
  expect(
    new CharacterLibrary({ ruleset: '2014', storage: globalThis.localStorage, catalog }).get(id).hp
  ).toEqual({ max: 30, current: 0, temp: 0 });
});

test('a shield changes AC only while equipped and removing it restores the prior value', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog, storage: localStorage });
  const id = library.create('Aster');
  library.edit(id, { abilities: { dexterity: 14 } });
  const shield = library.add(id, 'item:shield');
  expect(library.stats(id).armorClass).toBe(12);
  library.equip(id, shield, true);
  expect(library.stats(id).armorClass).toBe(14);
  library.equip(id, shield, false);
  expect(library.stats(id).armorClass).toBe(12);
});

test('armor replaces the unarmored formula and equipping new armor replaces the old suit', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog, storage: localStorage });
  const id = library.create('Aster');
  library.edit(id, { abilities: { dexterity: 14 } });
  const chain = library.add(id, 'item:chain-mail');
  library.equip(id, chain, true);
  expect(library.stats(id).armorClass).toBe(16);
  const leather = library.add(id, 'item:leather');
  library.equip(id, leather, true);
  expect(library.stats(id).armorClass).toBe(13);
  expect(library.get(id).equipment.find((item) => item.id === chain).equipped).toBe(false);
});

test('a worn attunement item grants its bonus only after attunement and removes it when unattuned', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog, storage: localStorage });
  const id = library.create('Aster');
  const ring = library.add(id, 'magic:ring-of-protection');
  library.equip(id, ring, true);
  expect(library.stats(id).armorClass).toBe(10);
  library.attune(id, ring, true);
  expect(library.stats(id).armorClass).toBe(11);
  library.attune(id, ring, false);
  expect(library.stats(id).armorClass).toBe(10);
});

test('editable core character data survives a new library instance', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });

  const id = library.create('Aster');
  library.edit(id, {
    name: 'Mira',
    classId: 'wizard',
    level: 5,
    ancestry: 'Human',
    abilities: { intelligence: 16 },
    hp: { max: 32, current: 18, temp: 5 },
    notes: 'North gate expedition.',
  });
  const reopened = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });
  expect(reopened.get(id)).toMatchObject({
    name: 'Mira',
    classId: 'wizard',
    level: 5,
    ancestry: 'Human',
    abilities: { intelligence: 16, strength: 10 },
    hp: { max: 32, current: 18, temp: 5 },
    notes: 'North gate expedition.',
  });
});

test('2014 derived modifiers, skills, saves and spell DC follow abilities and level', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });
  const id = library.create('Mira');
  library.edit(id, {
    classId: 'wizard',
    level: 5,
    abilities: { dexterity: 14, intelligence: 16 },
    skills: { arcana: 1, perception: 2 },
    saveOverrides: { strength: true },
  });
  expect(library.stats(id)).toMatchObject({
    abilityModifiers: { dexterity: 2, intelligence: 3 },
    proficiencyBonus: 3,
    initiative: 2,
    skills: { arcana: 6, perception: 6 },
    saves: { intelligence: 6, wisdom: 3, strength: 3 },
    spellAttack: 6,
    spellSaveDC: 14,
  });
  library.edit(id, { level: 9 });
  expect(library.stats(id)).toMatchObject({
    proficiencyBonus: 4,
    skills: { arcana: 7 },
    spellAttack: 7,
    spellSaveDC: 15,
  });
});

test('equipped magical weapons derive attacks and damage from ability, proficiency and enhancement', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });
  const id = library.create('Aster');
  library.edit(id, { level: 5, abilities: { strength: 16, dexterity: 14 } });
  const weapon = library.add(id, 'enhanced:longsword:1');
  library.equip(id, weapon, true);
  expect(library.stats(id).attacks).toEqual([
    expect.objectContaining({
      name: 'Longsword +1',
      attackBonus: 7,
      damage: '1d8+4',
      proficient: true,
    }),
  ]);
  library.edit(id, { classId: 'wizard' });
  expect(library.stats(id).attacks[0]).toMatchObject({
    attackBonus: 4,
    damage: '1d8+4',
    proficient: false,
  });
});

test('adding and preparing a spell creates derived casting data and casting spends real slots', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });
  const id = library.create('Mira');
  library.edit(id, { classId: 'wizard', level: 5, abilities: { intelligence: 16 } });
  const fireball = library.add(id, 'spell:fireball');
  expect(library.stats(id).spellSlots[2]).toMatchObject({
    level: 3,
    max: 2,
    used: 0,
    remaining: 2,
  });
  library.prepare(id, fireball, true);
  expect(library.spell(id, fireball, 3)).toMatchObject({
    saveDC: 14,
    saveAbility: 'dexterity',
    damage: [{ notation: '8d6', type: 'Fire' }],
  });
  library.cast(id, fireball, 3);
  expect(library.stats(id).spellSlots[2].remaining).toBe(1);
  library.cast(id, fireball, 3);
  expect(library.stats(id).spellSlots[2].remaining).toBe(0);
  expect(() => library.cast(id, fireball, 3)).toThrow(/slot/i);
  expect(library.stats(id).spellSlots[2].remaining).toBe(0);
});

test('a saved character can be backed up, deleted and restored without losing equipment state', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog, storage: localStorage });
  const id = library.create('Aster');
  const shield = library.add(id, 'item:shield');
  library.equip(id, shield, true);
  const backup = library.export(id);
  expect(library.list()).toEqual([expect.objectContaining({ id, name: 'Aster' })]);
  library.delete(id);
  expect(library.list()).toEqual([]);
  const restored = library.import(backup);
  expect(restored).not.toBe(id);
  expect(library.get(restored).equipment).toHaveLength(1);
  expect(library.stats(restored).armorClass).toBe(12);
});

test('equipment quantities and removal update carried weight and reverse equipped modifiers', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });
  const id = library.create('Aster');
  const shield = library.add(id, 'item:shield');
  library.equip(id, shield, true);
  library.setItem(id, shield, { quantity: 2 });
  expect(library.stats(id)).toMatchObject({ armorClass: 12, carriedWeight: 12 });
  library.remove(id, shield);
  expect(library.stats(id)).toMatchObject({ armorClass: 10, carriedWeight: 0 });
  expect(library.get(id).equipment).toHaveLength(0);
});

test('a long rest restores HP and spell slots while retaining prepared spell choices', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });
  const id = library.create('Mira');
  library.edit(id, {
    classId: 'wizard',
    level: 5,
    abilities: { intelligence: 16 },
    hp: { max: 32, current: 5, temp: 4 },
  });
  const fly = library.add(id, 'spell:fly');
  library.prepare(id, fly, true);
  library.cast(id, fly, 3);
  expect(library.get(id).concentration).toBe(fly);
  library.longRest(id);
  expect(library.get(id)).toMatchObject({
    hp: { max: 32, current: 32, temp: 0 },
    slotsUsed: Array(9).fill(0),
    concentration: '',
    spells: [{ id: fly, entryId: 'spell:fly', prepared: true }],
  });
});

test('active ability items recalculate derived values without changing base scores or stacking duplicates', () => {
  const library = new CharacterLibrary({
    ruleset: '2014',
    catalog: snapshot.entries,
    classes: snapshot.classes,
    storage: localStorage,
  });
  const id = library.create('Aster');
  const gauntlets = library.add(id, 'magic:gauntlets-of-ogre-power');
  library.equip(id, gauntlets, true);
  library.attune(id, gauntlets, true);
  for (let index = 0; index < 2; index++) {
    const ring = library.add(id, 'magic:ring-of-protection');
    library.equip(id, ring, true);
    library.attune(id, ring, true);
  }
  expect(library.stats(id)).toMatchObject({
    abilityScores: { strength: 19 },
    abilityModifiers: { strength: 4 },
    armorClass: 11,
  });
  expect(library.get(id).abilities.strength).toBe(10);
  const cloak = library.add(id, 'magic:cloak-of-protection');
  expect(() => library.attune(id, cloak, true)).toThrow(/three/i);
  library.equip(id, gauntlets, false);
  expect(library.stats(id).abilityScores.strength).toBe(10);
});

test('invalid backups cannot overwrite or partially change existing characters', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog, storage: localStorage });
  const id = library.create('Aster');
  const backup = library.export(id);
  const malformed = JSON.parse(backup);
  malformed.character.abilities.dexterity = 99;
  expect(() => library.import(JSON.stringify(malformed))).toThrow();
  expect(() => library.import('not json')).toThrow();
  malformed.version = 2;
  expect(() => library.import(JSON.stringify(malformed))).toThrow();
  expect(library.export(id)).toBe(backup);
  expect(library.list()).toHaveLength(1);
});

test('a storage write failure preserves the last saved character rather than losing it', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog, storage: localStorage });
  const id = library.create('Aster');
  const original = library.export(id);
  const write = jest.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
    throw new DOMException('Storage full', 'QuotaExceededError');
  });
  try {
    expect(() => library.edit(id, { name: 'Unsaved name' })).toThrow('Storage full');
    expect(library.export(id)).toBe(original);
  } finally {
    write.mockRestore();
  }
});
