/* eslint-disable camelcase -- Fixtures intentionally preserve the providers' external schemas. */
import { normalizeEquipment2024, normalizeOpen5e } from '../../../tools/resource-import.js';

test('the 2024 adapter preserves native casting, healing modifiers, and explicit upcasting tables', () => {
  const spell = {
    pk: 'srd-2024_cure-wounds',
    fields: {
      document: 'srd-2024',
      name: 'Cure Wounds',
      level: 1,
      school: 'abjuration',
      desc: 'A creature you touch regains Hit Points equal to 2d8 plus your spellcasting ability modifier.',
      higher_level: 'The healing increases by 2d8 for each spell slot level above 1.',
      casting_time: 'action',
      range_text: 'Touch',
      duration: 'instantaneous',
      verbal: true,
      somatic: true,
      material: false,
      concentration: false,
      ritual: false,
      attack_roll: false,
      saving_throw_ability: '',
      damage_roll: '2d8',
      damage_types: [],
      classes: ['srd-2024_cleric'],
    },
  };
  const collections = {
    Spell: [spell],
    SpellCastingOption: [
      {
        pk: 10163,
        fields: {
          parent: spell.pk,
          type: 'slot_level_2',
          damage_roll: '4d8',
        },
      },
    ],
  };
  const entries = normalizeOpen5e({
    documentId: 'srd-2024',
    ruleset: '2024',
    core: true,
    collections,
  });

  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    id: 'spell:cure-wounds',
    ruleset: '2024',
    castingTime: 'Action',
    classes: ['cleric'],
    healing: { 1: '2d8+MOD', 2: '4d8+MOD' },
    description: [spell.fields.desc, `At higher levels: ${spell.fields.higher_level}`],
  });
  expect(entries[0].manualRollFromSlotLevel).toBe(3);
  expect(
    normalizeOpen5e({
      documentId: 'srd-2024',
      ruleset: '2024',
      core: false,
      collections,
    })[0].id
  ).toBe('open5e:srd-2024:spell:srd-2024_cure-wounds');
  expect(() =>
    normalizeOpen5e({
      documentId: 'srd-2024',
      ruleset: '2024',
      core: true,
      collections: { Spell: [{ ...spell, fields: { ...spell.fields, casting_time: null } }] },
    })
  ).toThrow('casting');
});

test('2024 equipment categories preserve armor rules and manual Weapon Mastery rather than using 2014 fields', () => {
  const armor = normalizeEquipment2024({
    index: 'chain-mail',
    name: 'Chain Mail',
    equipment_categories: [
      { index: 'armor', name: 'Armor' },
      { index: 'heavy-armor', name: 'Heavy Armor' },
    ],
    armor_class: { base: 16, dex_bonus: false },
    str_minimum: 13,
    stealth_disadvantage: true,
    cost: { quantity: 75, unit: 'gp' },
    weight: 55,
  });
  expect(armor).toMatchObject({
    id: 'item:chain-mail',
    ruleset: '2024',
    equipmentType: 'armor',
    armor: {
      base: 16,
      dexterity: false,
      category: 'Heavy',
      strengthMinimum: 13,
      stealthDisadvantage: true,
    },
  });
  const weapon = normalizeEquipment2024({
    index: 'longsword',
    name: 'Longsword',
    equipment_categories: [
      { index: 'martial-weapons', name: 'Martial Weapons' },
      { index: 'melee-weapons', name: 'Melee Weapons' },
    ],
    damage: { damage_dice: '1d8', damage_type: { name: 'Slashing' } },
    two_handed_damage: { damage_dice: '1d10' },
    range: { normal: 5 },
    properties: [{ index: 'versatile' }],
    mastery: { index: 'sap', name: 'Sap' },
  });
  expect(weapon.weapon).toMatchObject({
    category: 'martial',
    range: 'melee',
    damage: '1d8',
    versatile: '1d10',
    mastery: 'Sap',
  });
  expect(weapon.automationNotes.join(' ')).toContain('manual');
});

test('reference collections retain stat blocks and their child actions under namespaced source IDs', () => {
  const entries = normalizeOpen5e({
    documentId: 'tob',
    ruleset: '2014',
    collections: {
      Creature: [
        {
          pk: 'tob_test-creature',
          fields: { document: 'tob', name: 'Test Creature', armor_class: 15, hit_points: 40 },
        },
      ],
      CreatureAction: [
        {
          pk: 'tob_test-creature_bite',
          fields: {
            parent: 'tob_test-creature',
            name: 'Bite',
            desc: 'Melee attack; 1d8 piercing damage.',
          },
        },
      ],
    },
  });
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({
    id: 'reference:tob:monster:tob_test-creature',
    kind: 'monster',
    ruleset: '2014',
    automation: 'reference',
  });
  expect(entries[0].description.join('\n')).toContain('Armor Class: 15');
  expect(entries[0].description.join('\n')).toContain('Bite');
  expect(entries[0].description.join('\n')).toContain('1d8 piercing damage');
});
