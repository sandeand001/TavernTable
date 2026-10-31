/* eslint-disable camelcase -- Provider fields and catalog dice-table keys preserve upstream names. */
const title = (value) =>
  String(value)
    .replace(/[-_]/g, ' ')
    .replace(/(\d)([a-z])/g, '$1 $2')
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase());
const sourceSlug = (id) => id.slice(id.indexOf('_') + 1);

function dice(value) {
  if (value === null || value === undefined || value === '') return null;
  const expression = String(value).replace(/\s+/g, '');
  return /^(?:\d+d\d+|\d+|MOD)(?:[+-](?:\d+d\d+|\d+|MOD))*$/.test(expression) ? expression : null;
}

function open5eSpell(row, options, { documentId, ruleset, core }) {
  // Open5e's Spell model defines omitted fixture flags as false.
  const f = { concentration: false, ritual: false, attack_roll: false, ...row.fields };
  for (const field of ['name', 'desc', 'casting_time', 'range_text', 'duration', 'school']) {
    if (typeof f[field] !== 'string' || !f[field].trim()) {
      throw new Error(`Missing or invalid ${field} for spell ${row.pk}`);
    }
  }
  if (
    !Number.isInteger(f.level) ||
    f.level < 0 ||
    f.level > 9 ||
    !Array.isArray(f.classes) ||
    f.classes.some((value) => typeof value !== 'string') ||
    !Array.isArray(f.damage_types) ||
    typeof f.concentration !== 'boolean' ||
    typeof f.ritual !== 'boolean' ||
    typeof f.attack_roll !== 'boolean'
  ) {
    throw new Error(`Invalid spell level, classes or damage types: ${row.pk}`);
  }
  const levelKey = f.level === 0 ? 'damage_at_character_level' : 'damage_at_slot_level';
  const table = {};
  let manualSlot = Infinity;
  let manualCharacter = Infinity;
  const base = dice(f.damage_roll);
  if (base) table[f.level || 1] = base;
  for (const option of options.filter((option) => option.fields.parent === row.pk)) {
    const match = /^(slot|player|character)_level_(\d+)$/.exec(option.fields.type);
    const value = dice(option.fields.damage_roll);
    if (match && value && (match[1] === 'slot') === f.level > 0) table[match[2]] = value;
    if (match && option.fields.damage_roll && !value) {
      if (match[1] === 'slot') manualSlot = Math.min(manualSlot, Number(match[2]));
      else manualCharacter = Math.min(manualCharacter, Number(match[2]));
    }
  }
  if (f.higher_level && base) {
    const thresholds =
      f.level === 0 ? [5, 11, 17] : Array.from({ length: 9 - f.level }, (_, i) => f.level + i + 1);
    const missing = thresholds.find((level) => !Object.hasOwn(table, level));
    if (missing !== undefined) {
      if (f.level === 0) manualCharacter = Math.min(manualCharacter, missing);
      else manualSlot = Math.min(manualSlot, missing);
    }
  }
  const healing =
    f.damage_types.length === 0 &&
    /\bregains?\b[\s\S]*\bHit Points?\b/i.test(f.desc) &&
    !/\btemporary Hit Points?\b/i.test(f.desc) &&
    Object.keys(table).length > 0;
  const addModifier = healing && /\bplus your spellcasting ability modifier\b/i.test(f.desc);
  const notes = [];
  if (f.damage_roll && !base)
    notes.push('Damage/healing formula is reference-only; resolve it from the text.');
  if (f.damage_types.length > 1)
    notes.push('Multiple damage types are reference-only; resolve their amounts from the text.');
  if (Number.isFinite(manualSlot))
    notes.push(
      `From slot level ${manualSlot}, unsupported or conditional scaling must be resolved from the text manually.`
    );
  if (Number.isFinite(manualCharacter))
    notes.push(
      `From character level ${manualCharacter}, unsupported or conditional scaling must be resolved from the text manually.`
    );
  return {
    id: core ? `spell:${sourceSlug(row.pk)}` : `open5e:${documentId}:spell:${row.pk}`,
    kind: 'spell',
    ruleset,
    name: f.name,
    category: 'Spell',
    description: [f.desc, ...(f.higher_level ? [`At higher levels: ${f.higher_level}`] : [])],
    level: f.level,
    school: title(f.school),
    classes: f.classes.map((value) => value.slice(value.indexOf('_') + 1)),
    castingTime: `${title(f.casting_time)}${f.reaction_condition ? `; ${f.reaction_condition}` : ''}`,
    range: f.range_text,
    duration: title(f.duration),
    components: [
      ['verbal', 'V'],
      ['somatic', 'S'],
      ['material', 'M'],
    ]
      .filter(([field]) => f[field])
      .map(([, letter]) => letter)
      .join(', '),
    material: f.material_specified || '',
    concentration: !!f.concentration,
    ritual: !!f.ritual,
    attackType: f.attack_roll ? 'spell' : '',
    saveAbility: f.saving_throw_ability || '',
    saveSuccess: '',
    damage:
      !healing && f.damage_types.length === 1 && base
        ? [{ damage_type: { name: title(f.damage_types[0]) }, [levelKey]: table }]
        : [],
    healing: healing
      ? Object.fromEntries(
          Object.entries(table).map(([level, value]) => [
            level,
            `${value}${addModifier && !value.includes('MOD') ? '+MOD' : ''}`,
          ])
        )
      : null,
    automation: 'spellcasting',
    automationNotes: notes,
    sourceIndex: row.pk,
    ...(Number.isFinite(manualSlot) ? { manualRollFromSlotLevel: manualSlot } : {}),
    ...(Number.isFinite(manualCharacter) ? { manualRollFromCharacterLevel: manualCharacter } : {}),
  };
}

function normalizeOpen5e({ documentId, ruleset, core = false, collections }) {
  if (!['2014', '2024'].includes(ruleset) || typeof documentId !== 'string' || !documentId) {
    throw new Error('Resource normalization requires an explicit document and ruleset');
  }
  const context = { documentId, ruleset, core };
  const sourceRow = (row) => {
    if (
      !row?.fields ||
      row.fields.document !== documentId ||
      typeof row.pk !== 'string' ||
      !row.pk
    ) {
      throw new Error(`A resource belongs to another source document: ${documentId} / ${row?.pk}`);
    }
  };
  const options = collections.SpellCastingOption || [];
  const entries = (collections.Spell || []).map((row) => {
    sourceRow(row);
    return { ...open5eSpell(row, options, context), sourceCollection: 'Spell' };
  });
  const children = new Map();
  const parents = {
    CreatureAction: 'Creature',
    CreatureTrait: 'Creature',
    CreatureActionAttack: 'CreatureAction',
    ClassFeature: 'CharacterClass',
    ClassFeatureItem: 'ClassFeature',
    BackgroundBenefit: 'Background',
    FeatBenefit: 'Feat',
    SpeciesTrait: 'Species',
    SpellCastingOption: 'Spell',
  };
  for (const [collection, rows] of Object.entries(collections)) {
    if (!parents[collection]) continue;
    for (const row of rows) {
      if (!row.fields?.parent) continue;
      const parent = `${parents[collection]}:${row.fields.parent}`;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push({ ...row, sourceCollection: collection });
    }
  }
  const referenceKinds = {
    Creature: 'monster',
    Species: 'species',
    Background: 'background',
    Feat: 'feat',
    CharacterClass: 'class',
    ClassFeature: 'feature',
    ConditionDescription: 'condition',
    Rule: 'rule',
    WeaponProperty: 'property',
    AbilityDescription: 'rule',
    SkillDescription: 'rule',
    DamageTypeDescription: 'rule',
  };
  for (const [collection, kind] of Object.entries(referenceKinds)) {
    for (const row of collections[collection] || []) {
      sourceRow(row);
      const actualKind =
        collection === 'CharacterClass' && row.fields.subclass_of ? 'subclass' : kind;
      entries.push({
        id: `reference:${documentId}:${actualKind}:${row.pk}`,
        kind: actualKind,
        ruleset,
        name: row.fields.name || title(row.fields.describes || sourceSlug(row.pk)),
        category: title(actualKind),
        description: referenceText({ ...row, sourceCollection: collection }, children),
        automation: 'reference',
        automationNotes: ['Reference only; apply character and scene effects manually.'],
        sourceIndex: row.pk,
        sourceCollection: collection,
      });
    }
  }
  const items = new Map();
  for (const collection of ['Item', 'MagicItem']) {
    for (const row of collections[collection] || []) {
      sourceRow(row);
      const previous = items.get(row.pk);
      if (previous && previous.name !== row.fields.name)
        throw new Error('Conflicting item inheritance data');
      const weight =
        row.fields.weight === null || row.fields.weight === undefined
          ? null
          : Number(row.fields.weight);
      if (weight !== null && (!Number.isFinite(weight) || weight < 0))
        throw new Error(`Invalid item weight: ${row.pk}`);
      items.set(row.pk, {
        id: core
          ? `${collection === 'MagicItem' ? 'magic' : 'item'}:${sourceSlug(row.pk)}`
          : `open5e:${documentId}:item:${row.pk}`,
        kind: 'item',
        ruleset,
        name: row.fields.name,
        category: title(row.fields.category || 'Equipment'),
        description: referenceText({ ...row, sourceCollection: collection }, children),
        equipmentType: collection === 'MagicItem' ? 'magic' : 'gear',
        weight: collection === 'MagicItem' && weight === 0 ? null : weight,
        cost: collection === 'MagicItem' || !row.fields.cost ? '' : `${row.fields.cost} gp`,
        rarity: title(row.fields.rarity || ''),
        requiresAttunement: !!row.fields.requires_attunement,
        effects: {},
        bonus: 0,
        armor: null,
        weapon: null,
        automation: 'reference',
        automationNotes: ['Inventory/reference only; conditional bonuses and effects are manual.'],
        sourceIndex: row.pk,
        sourceCollection: collection,
      });
    }
  }
  return [...entries, ...items.values()];
}

function referenceText(row, children, ancestors = new Set()) {
  const key = `${row.sourceCollection}:${row.pk}`;
  if (ancestors.has(key) || ancestors.size > 8)
    throw new Error(`Cyclic source resource references: ${key}`);
  const next = new Set([...ancestors, key]);
  const f = row.fields;
  const omitted = new Set([
    'name',
    'document',
    'parent',
    'desc',
    'detail',
    'illustration',
    'icon',
    'image',
    'ruleset',
    'index',
    'initialHeaderLevel',
    'subclass_of',
    'subspecies_of',
  ]);
  const values = Object.entries(f).filter(
    ([field, value]) =>
      !omitted.has(field) &&
      value !== null &&
      value !== undefined &&
      value !== '' &&
      value !== false &&
      (!Array.isArray(value) || value.length > 0)
  );
  const stats = values.map(
    ([field, value]) =>
      `${title(field)}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value}`
  );
  const body = [f.desc || f.detail, ...stats].filter(Boolean);
  for (const child of children.get(key) || []) {
    const text = referenceText(child, children, next).join('\n');
    if (text)
      body.push(
        `${child.fields.name || (child.fields.level ? `Level ${child.fields.level}` : 'Details')}\n${text}`
      );
  }
  return body;
}

function normalizeEquipment2024(raw) {
  if (!raw?.index || !raw.name || !Array.isArray(raw.equipment_categories)) {
    throw new Error('Invalid 2024 equipment identity or categories');
  }
  const categories = raw.equipment_categories.map((category) => category.index);
  const type = categories.includes('shields')
    ? 'shield'
    : raw.armor_class
      ? 'armor'
      : raw.damage
        ? 'weapon'
        : 'gear';
  const weaponCategory = categories.includes('martial-weapons')
    ? 'martial'
    : categories.includes('simple-weapons')
      ? 'simple'
      : null;
  const weaponRange = categories.includes('ranged-weapons')
    ? 'ranged'
    : categories.includes('melee-weapons')
      ? 'melee'
      : null;
  if (type === 'weapon' && (!weaponCategory || !weaponRange || !dice(raw.damage.damage_dice))) {
    throw new Error(`Invalid 2024 weapon data: ${raw.index}`);
  }
  if (raw.armor_class && !Number.isFinite(raw.armor_class.base)) {
    throw new Error(`Invalid 2024 armor data: ${raw.index}`);
  }
  const armorCategory = raw.equipment_categories.find((category) =>
    /^(light|medium|heavy)-armor$/.test(category.index)
  );
  return {
    id: `item:${raw.index}`,
    kind: 'item',
    ruleset: '2024',
    name: raw.name,
    category: raw.equipment_categories[0]?.name || 'Equipment',
    description: [...(raw.description || []), ...(raw.notes || [])],
    equipmentType: type,
    weight: raw.weight ?? null,
    cost: raw.cost ? `${raw.cost.quantity} ${raw.cost.unit}` : '',
    armor: raw.armor_class
      ? {
          base: raw.armor_class.base,
          dexterity: raw.armor_class.dex_bonus,
          ...(raw.armor_class.max_bonus != null ? { maxDexterity: raw.armor_class.max_bonus } : {}),
          category: type === 'shield' ? 'Shield' : armorCategory?.name.replace(/ Armor$/, ''),
          strengthMinimum: raw.str_minimum || 0,
          stealthDisadvantage: !!raw.stealth_disadvantage,
        }
      : null,
    weapon:
      type === 'weapon'
        ? {
            category: weaponCategory,
            range: weaponRange,
            damage: raw.damage.damage_dice,
            proficiency: `weapon:${raw.index}`,
            damageType: raw.damage.damage_type.name,
            versatile: raw.two_handed_damage?.damage_dice || '',
            properties: (raw.properties || []).map((property) => property.index),
            distance: raw.range,
            mastery: raw.mastery?.name || '',
          }
        : null,
    bonus: 0,
    requiresAttunement: false,
    effects: {},
    automation: type === 'gear' ? 'reference' : 'equipment',
    automationNotes: raw.mastery
      ? [`Weapon Mastery (${raw.mastery.name}) is manual; eligibility and effects are not applied.`]
      : [],
    sourceIndex: raw.index,
  };
}

function sanitizeLegacySpells(entries) {
  return entries.map((entry) => {
    if (entry.kind !== 'spell') return entry;
    let slot = Infinity;
    let character = Infinity;
    const clean = (table, kind) => {
      if (!table) return table;
      return Object.fromEntries(
        Object.entries(table).filter(([level, value]) => {
          if (dice(value)) return true;
          if (kind === 'slot') slot = Math.min(slot, Number(level));
          else character = Math.min(character, Number(level));
          return false;
        })
      );
    };
    const damage = entry.damage.map((part) => ({
      ...part,
      ...(part.damage_at_slot_level
        ? { damage_at_slot_level: clean(part.damage_at_slot_level, 'slot') }
        : {}),
      ...(part.damage_at_character_level
        ? { damage_at_character_level: clean(part.damage_at_character_level, 'character') }
        : {}),
    }));
    const healing = clean(entry.healing, 'slot');
    const notes = [...(entry.automationNotes || [])];
    if (Number.isFinite(slot))
      notes.push(
        `From slot level ${slot}, resolve conditional damage/healing dice from the text manually.`
      );
    if (Number.isFinite(character))
      notes.push(
        `From character level ${character}, resolve conditional damage/healing dice from the text manually.`
      );
    return {
      ...entry,
      damage,
      healing,
      automationNotes: notes,
      ...(Number.isFinite(slot) ? { manualRollFromSlotLevel: slot } : {}),
      ...(Number.isFinite(character) ? { manualRollFromCharacterLevel: character } : {}),
    };
  });
}

module.exports = { normalizeOpen5e, normalizeEquipment2024, sanitizeLegacySpells };
