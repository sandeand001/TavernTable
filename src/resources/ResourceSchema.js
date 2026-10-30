export const RESOURCE_KINDS = Object.freeze([
  'item',
  'spell',
  'monster',
  'species',
  'background',
  'feat',
  'class',
  'subclass',
  'feature',
  'condition',
  'rule',
  'property',
]);

const ABILITIES = ['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'];
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const strings = (value) => Array.isArray(value) && value.every((text) => typeof text === 'string');
const text = (value) => typeof value === 'string' && value.trim().length > 0;
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const notation = (value) =>
  typeof value === 'string' &&
  /^[+-]?(?:\d+d\d+|\d+|MOD)(?:[+-](?:\d+d\d+|\d+|MOD))*$/.test(value.replace(/\s+/g, ''));
const table = (value, maximum) =>
  record(value) &&
  Object.entries(value).every(
    ([level, formula]) =>
      /^\d+$/.test(level) && integer(Number(level), 1, maximum) && notation(formula)
  );

export function validateResourceEntry(entry, ruleset) {
  if (
    !entry ||
    !text(entry.id) ||
    !text(entry.name) ||
    !RESOURCE_KINDS.includes(entry.kind) ||
    !strings(entry.description) ||
    entry.description.some((paragraph) => paragraph.length > 1000000) ||
    (entry.ruleset !== undefined && entry.ruleset !== ruleset)
  ) {
    throw new Error('The resource pack contains an invalid entry or ruleset');
  }
  if (entry.kind === 'spell') {
    if (
      !integer(entry.level, 0, 9) ||
      !text(entry.castingTime) ||
      !text(entry.range) ||
      !text(entry.duration) ||
      !text(entry.school) ||
      !strings(entry.classes) ||
      typeof entry.components !== 'string' ||
      typeof entry.concentration !== 'boolean' ||
      typeof entry.ritual !== 'boolean' ||
      typeof entry.attackType !== 'string' ||
      !['', ...ABILITIES].includes(entry.saveAbility) ||
      !Array.isArray(entry.damage) ||
      entry.damage.some(
        (part) =>
          !record(part) ||
          (!part.damage_at_slot_level && !part.damage_at_character_level) ||
          (part.damage_at_slot_level && !table(part.damage_at_slot_level, 9)) ||
          (part.damage_at_character_level && !table(part.damage_at_character_level, 20))
      ) ||
      (entry.healing != null && !table(entry.healing, 9))
    ) {
      throw new Error(`Invalid normalized spell data: ${entry.id}`);
    }
  } else if (entry.kind === 'item') {
    if (
      !['armor', 'shield', 'weapon', 'gear', 'magic'].includes(entry.equipmentType) ||
      !record(entry.effects) ||
      typeof entry.requiresAttunement !== 'boolean' ||
      !integer(entry.bonus, -100, 100)
    ) {
      throw new Error(`Invalid normalized equipment data: ${entry.id}`);
    }
    if (
      ['armor', 'shield'].includes(entry.equipmentType) &&
      (!record(entry.armor) ||
        !integer(entry.armor.base, 0, 100) ||
        typeof entry.armor.dexterity !== 'boolean')
    ) {
      throw new Error(`Invalid armor data: ${entry.id}`);
    }
    if (
      entry.equipmentType === 'weapon' &&
      (!record(entry.weapon) ||
        !['simple', 'martial'].includes(entry.weapon.category) ||
        !['melee', 'ranged'].includes(entry.weapon.range) ||
        !notation(entry.weapon.damage) ||
        !text(entry.weapon.damageType) ||
        !strings(entry.weapon.properties) ||
        !text(entry.weapon.proficiency) ||
        (entry.weapon.versatile && !notation(entry.weapon.versatile)))
    ) {
      throw new Error(`Invalid weapon data: ${entry.id}`);
    }
    const effects = entry.effects;
    if (
      Object.keys(effects).some(
        (key) => !['ac', 'saves', 'unarmoredOnly', 'abilityMinimum'].includes(key)
      ) ||
      (effects.ac !== undefined && !integer(effects.ac, -100, 100)) ||
      (effects.saves !== undefined && !integer(effects.saves, -100, 100)) ||
      (effects.unarmoredOnly !== undefined && typeof effects.unarmoredOnly !== 'boolean') ||
      (effects.abilityMinimum !== undefined &&
        (!record(effects.abilityMinimum) ||
          Object.entries(effects.abilityMinimum).some(
            ([ability, value]) => !ABILITIES.includes(ability) || !integer(value, 1, 30)
          )))
    ) {
      throw new Error(`Invalid automated item effects: ${entry.id}`);
    }
  }
}

export function validateResourceClasses(classes) {
  if (
    !Array.isArray(classes) ||
    new Set(classes.map((entry) => entry?.id)).size !== classes.length ||
    classes.some(
      (entry) =>
        !entry ||
        !text(entry.id) ||
        !text(entry.name) ||
        ![6, 8, 10, 12].includes(entry.hitDie) ||
        !strings(entry.saves) ||
        entry.saves.some((ability) => !ABILITIES.includes(ability)) ||
        !strings(entry.proficiencies) ||
        !['', ...ABILITIES].includes(entry.castingAbility) ||
        !record(entry.slots) ||
        Array.from({ length: 20 }, (_, i) => entry.slots[i + 1]).some(
          (row) =>
            !Array.isArray(row) || row.length !== 9 || row.some((value) => !integer(value, 0, 20))
        )
    )
  ) {
    throw new Error('The resource pack contains invalid class progression data');
  }
}
