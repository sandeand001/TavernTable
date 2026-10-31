import CharacterRest from './CharacterRest.js';
import CharacterActions from './CharacterActions.js';
import CharacterPlayLayout from './CharacterPlayLayout.js';
import { rulesFor } from '../../rules/rulesets.js';
import { validateMovementEffects } from '../../rules/falling.js';
import { FALL_TRAITS_DEFAULTS } from '../../config/TokenMovementConfig.js';

const STORAGE_PREFIX = 'taverntable.character.v1.';
export const ABILITIES = [
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
];
export const SKILLS = [
  ['acrobatics', 'Acrobatics', 'dexterity'],
  ['animal-handling', 'Animal Handling', 'wisdom'],
  ['arcana', 'Arcana', 'intelligence'],
  ['athletics', 'Athletics', 'strength'],
  ['deception', 'Deception', 'charisma'],
  ['history', 'History', 'intelligence'],
  ['insight', 'Insight', 'wisdom'],
  ['intimidation', 'Intimidation', 'charisma'],
  ['investigation', 'Investigation', 'intelligence'],
  ['medicine', 'Medicine', 'wisdom'],
  ['nature', 'Nature', 'intelligence'],
  ['perception', 'Perception', 'wisdom'],
  ['performance', 'Performance', 'charisma'],
  ['persuasion', 'Persuasion', 'charisma'],
  ['religion', 'Religion', 'intelligence'],
  ['sleight-of-hand', 'Sleight of Hand', 'dexterity'],
  ['stealth', 'Stealth', 'dexterity'],
  ['survival', 'Survival', 'wisdom'],
].map(([id, name, ability]) => ({ id, name, ability }));

export class CharacterLibrary {
  constructor({ catalog, classes = [], storage, ruleset, enabledEntryIds }) {
    Object.defineProperty(this, 'rules', { value: rulesFor(ruleset) });
    Object.defineProperty(this, 'ruleset', { value: ruleset, enumerable: true });
    if (
      !storage ||
      ['getItem', 'setItem', 'removeItem', 'key'].some(
        (method) => typeof storage[method] !== 'function'
      )
    ) {
      throw new Error('An explicit character storage adapter is required');
    }
    this.catalog = new Map(catalog.map((entry) => [entry.id, entry]));
    this.classes = new Map(classes.map((entry) => [entry.id, entry]));
    this.enabledEntryIds = new Set(enabledEntryIds ?? catalog.map((entry) => entry.id));
    this.storage = storage;
    this.rest = new CharacterRest(this, STORAGE_PREFIX);
    this.actions = new CharacterActions(this, STORAGE_PREFIX);
    this.layouts = new CharacterPlayLayout(this);
  }

  list() {
    const characters = [];
    for (let index = 0; index < this.storage.length; index++) {
      const key = this.storage.key(index);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      const character = this.get(key.slice(STORAGE_PREFIX.length));
      characters.push({
        id: character.id,
        name: character.name,
        classId: character.classId,
        level: character.level,
      });
    }
    return characters.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  export(id) {
    return JSON.stringify(
      {
        format: 'taverntable-character',
        version: 4,
        character: this.get(id),
        rest: this.rest.snapshot(id),
        actions: this.actions.snapshot(id),
        layout: this.layouts.snapshot(id),
      },
      null,
      2
    );
  }

  import(text) {
    if (typeof text !== 'string' || text.length > 1000000) {
      throw new Error('Choose a TavernTable character JSON backup smaller than 1 MB');
    }
    const data = JSON.parse(text);
    if (
      data?.format !== 'taverntable-character' ||
      ![1, 2, 3, 4].includes(data.version) ||
      !data.character ||
      (data.version >= 2 && !data.rest) ||
      (data.version >= 3 && !data.actions) ||
      (data.version >= 4 && !data.layout)
    ) {
      throw new Error('Unsupported character backup format');
    }
    const character = { ...data.character, id: globalThis.crypto.randomUUID() };
    this.rest.restore(
      character,
      data.version >= 2 ? data.rest : null,
      data.character.id,
      data.version >= 3 ? data.actions : null,
      data.version >= 4 ? data.layout : null
    );
    return character.id;
  }

  delete(id) {
    this.rest.remove(id);
  }

  create(name, { fallTraits, conditions } = {}) {
    const character = this._newCharacter(name);
    if (fallTraits !== undefined) character.fallTraits = fallTraits;
    if (conditions !== undefined) character.conditions = conditions;
    this._save(character);
    return character.id;
  }

  replace(id, name) {
    this.get(id);
    const character = this._newCharacter(name);
    this._validate(character);
    this.rest.remove(id, [[`${STORAGE_PREFIX}${character.id}`, JSON.stringify(character)]]);
    return character.id;
  }

  _newCharacter(name) {
    if (typeof name !== 'string' || !name.trim()) throw new Error('A character needs a name');
    return {
      version: 1,
      id: globalThis.crypto.randomUUID(),
      name: name.trim(),
      classId: this.classes.has('fighter') ? 'fighter' : '',
      level: 1,
      ancestry: '',
      background: '',
      alignment: '',
      experience: 0,
      abilities: Object.fromEntries(ABILITIES.map((ability) => [ability, 10])),
      hp: { max: 10, current: 10, temp: 0 },
      speed: 30,
      conditions: [],
      fallTraits: { ...FALL_TRAITS_DEFAULTS },
      initiativeBonus: 0,
      acBonus: 0,
      inspiration: false,
      skills: {},
      saveOverrides: {},
      castingAbility: 'auto',
      slotsUsed: Array(9).fill(0),
      slotOverrides: {},
      concentration: '',
      spells: [],
      notes: '',
      equipment: [],
    };
  }

  get(id) {
    const raw = this.storage.getItem(`${STORAGE_PREFIX}${id}`);
    if (raw === null) throw new Error('The saved character was not found');
    let character;
    try {
      character = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('The saved character contains invalid JSON', { cause: error });
    }
    if (character?.id !== id) {
      throw new Error('The saved character has an unsupported or invalid format');
    }
    this._validate(character);
    return character;
  }

  edit(id, updates) {
    const character = this.get(id);
    const fields = [
      'name',
      'classId',
      'level',
      'ancestry',
      'background',
      'alignment',
      'experience',
      'abilities',
      'hp',
      'speed',
      'conditions',
      'fallTraits',
      'initiativeBonus',
      'acBonus',
      'inspiration',
      'skills',
      'saveOverrides',
      'castingAbility',
      'slotsUsed',
      'slotOverrides',
      'notes',
    ];
    const merged = ['abilities', 'hp', 'skills', 'saveOverrides', 'slotOverrides', 'fallTraits'];
    for (const [field, value] of Object.entries(updates)) {
      if (!fields.includes(field))
        throw new Error(`Unknown or read-only character field: ${field}`);
      if (merged.includes(field)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
          throw new Error(`Invalid character field: ${field}`);
        }
        character[field] = { ...character[field], ...value };
      } else {
        character[field] = value;
      }
    }
    this._save(character);
  }

  adjustHitPoints(id, kind, amount) {
    if (!['damage', 'heal'].includes(kind)) throw new Error('Choose Damage or Heal');
    if (!Number.isInteger(amount) || amount < 0 || amount > 1000000) {
      throw new RangeError('HP amount must be a whole number from 0 to 1000000');
    }
    const character = this.get(id);
    if (kind === 'damage') {
      this._damage(character, amount);
    } else {
      character.hp.current = Math.min(character.hp.max, character.hp.current + amount);
    }
    this._save(character);
    return character.hp;
  }

  applyFall(id, fall) {
    const character = this.get(id);
    if (
      !fall ||
      typeof fall.id !== 'string' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(fall.id) ||
      typeof fall.featherFall !== 'boolean'
    ) {
      throw new Error('A fall needs a valid, unique result and explicit spell state');
    }
    if (character.lastFall?.id === fall.id) {
      return { ...character.lastFall, hp: { ...character.hp } };
    }
    const result = this.rules.resolveFall(fall);
    this._damage(character, result.damage);
    if (result.prone && !(character.conditions || []).includes('prone')) {
      character.conditions = [...(character.conditions || []), 'prone'];
    }
    if (fall.featherFall) {
      character.fallTraits = { ...character.fallTraits, featherFall: false };
    }
    character.lastFall = {
      id: fall.id,
      ...result,
      featherFall: fall.featherFall,
      avoidDamage: fall.avoidDamage,
    };
    this._save(character);
    return { ...character.lastFall, hp: { ...character.hp } };
  }

  _damage(character, amount) {
    const absorbed = Math.min(character.hp.temp, amount);
    character.hp.temp -= absorbed;
    character.hp.current = Math.max(0, character.hp.current - (amount - absorbed));
  }

  add(id, entryId, { equip = false } = {}) {
    if (typeof equip !== 'boolean') throw new Error('Invalid Add and equip option');
    const character = this.get(id);
    const entry = this.catalog.get(entryId);
    if (!entry) throw new Error('Unknown compendium entry');
    if (!this.enabledEntryIds.has(entryId)) {
      throw new Error('Enable this source pack before adding new content');
    }
    if (entry.kind === 'spell') {
      const existing = character.spells.find((spell) => spell.entryId === entryId);
      if (existing) return existing.id;
      const spell = {
        id: globalThis.crypto.randomUUID(),
        entryId,
        prepared: entry.level === 0 || !this._preparesSpells(character),
      };
      character.spells.push(spell);
      this._save(character);
      return spell.id;
    }
    if (entry.kind !== 'item') throw new Error('Unsupported compendium entry');
    const item = {
      id: globalThis.crypto.randomUUID(),
      entryId,
      quantity: 1,
      equipped: false,
      attuned: false,
    };
    character.equipment.push(item);
    if (equip) this._equip(character, item.id, true);
    this._save(character);
    return item.id;
  }

  setSlotUsed(id, level, used) {
    if (!Number.isInteger(level) || level < 1 || level > 9)
      throw new Error('Choose a spell-slot level from 1 to 9');
    const character = this.get(id);
    character.slotsUsed[level - 1] = used;
    this._save(character);
  }

  prepare(id, spellId, prepared) {
    const character = this.get(id);
    const spell = character.spells.find((entry) => entry.id === spellId);
    if (!spell || typeof prepared !== 'boolean') throw new Error('Invalid prepared spell change');
    spell.prepared = prepared;
    this._save(character);
  }

  spell(id, spellId, slotLevel) {
    const character = this.get(id);
    const owned = character.spells.find((entry) => entry.id === spellId);
    if (!owned) throw new Error('The character does not know this spell');
    const entry = this.catalog.get(owned.entryId);
    const level = slotLevel ?? entry.level;
    if (
      !Number.isInteger(level) ||
      level < entry.level ||
      level > 9 ||
      (entry.level === 0 && level !== 0)
    ) {
      throw new RangeError('Choose a valid spell slot level');
    }
    const stats = this.stats(id);
    const atLevel = (table, target) => {
      if (!table) return null;
      const keys = Object.keys(table)
        .map(Number)
        .filter((key) => key <= target)
        .sort((a, b) => b - a);
      return keys.length ? table[keys[0]] : null;
    };
    const notation = (value) => {
      if (!value) return null;
      if (/\bMOD\b/.test(value) && !stats.castingAbility) return null;
      return value
        .replace(/\bMOD\b/g, String(stats.abilityModifiers[stats.castingAbility]))
        .replace(/\s+/g, '')
        .replace(/\+-/g, '-');
    };
    const manualRolls =
      (entry.manualRollFromSlotLevel !== undefined && level >= entry.manualRollFromSlotLevel) ||
      (entry.manualRollFromCharacterLevel !== undefined &&
        character.level >= entry.manualRollFromCharacterLevel);
    const damage = manualRolls
      ? []
      : entry.damage.map((part) => ({
          notation: notation(
            atLevel(part.damage_at_slot_level, level) ||
              atLevel(part.damage_at_character_level, character.level)
          ),
          type: part.damage_type?.name || 'Damage',
        }));
    return {
      entry,
      slotLevel: level,
      attackBonus: entry.attackType ? stats.spellAttack : null,
      saveDC: entry.saveAbility ? stats.spellSaveDC : null,
      saveAbility: entry.saveAbility,
      damage,
      healing: manualRolls ? null : notation(atLevel(entry.healing, level)),
      manualRolls,
      prepared: owned.prepared,
    };
  }

  cast(id, spellId, slotLevel) {
    const character = this.get(id);
    const casting = this._applyCast(character, spellId, slotLevel);
    this._save(character);
    return casting;
  }

  _applyCast(character, spellId, slotLevel) {
    const casting = this.spell(character.id, spellId, slotLevel);
    if (!this.stats(character.id).castingAbility)
      throw new Error('Choose a spellcasting ability before casting');
    if (casting.entry.level > 0) {
      if (this._preparesSpells(character) && !casting.prepared) {
        throw new Error('Prepare this spell before casting it');
      }
      const slot = this._slots(character)[casting.slotLevel - 1];
      if (!slot || slot.remaining < 1) throw new Error('No spell slot remains at that level');
      character.slotsUsed[casting.slotLevel - 1]++;
    }
    if (casting.entry.concentration) character.concentration = spellId;
    return casting;
  }

  longRest(id) {
    return this.rest.longRest(id);
  }

  endConcentration(id) {
    const character = this.get(id);
    character.concentration = '';
    this._save(character);
  }

  equip(id, itemId, equipped) {
    const character = this.get(id);
    this._equip(character, itemId, equipped);
    this._save(character);
  }

  _equip(character, itemId, equipped) {
    const item = character.equipment.find((entry) => entry.id === itemId);
    if (!item || typeof equipped !== 'boolean') throw new Error('Invalid equipment change');
    const type = this.catalog.get(item.entryId).equipmentType;
    if (equipped && ['armor', 'shield'].includes(type)) {
      for (const other of character.equipment) {
        if (this.catalog.get(other.entryId)?.equipmentType === type) other.equipped = false;
      }
    }
    item.equipped = equipped;
  }

  attune(id, itemId, attuned) {
    const character = this.get(id);
    const item = character.equipment.find((entry) => entry.id === itemId);
    if (
      !item ||
      typeof attuned !== 'boolean' ||
      !this.catalog.get(item.entryId)?.requiresAttunement
    ) {
      throw new Error('This item cannot be attuned');
    }
    if (
      attuned &&
      !item.attuned &&
      character.equipment.filter((entry) => entry.attuned).length >= 3
    ) {
      throw new Error('A character can attune to at most three items');
    }
    item.attuned = attuned;
    this._save(character);
  }

  setItem(id, itemId, updates) {
    const character = this.get(id);
    const item = character.equipment.find((entry) => entry.id === itemId);
    if (
      !item ||
      Object.keys(updates).some((field) => !['quantity', 'proficiencyOverride'].includes(field))
    ) {
      throw new Error('Invalid inventory change');
    }
    Object.assign(item, updates);
    this._save(character);
  }

  remove(id, instanceId) {
    const character = this.get(id);
    if (![...character.equipment, ...character.spells].some((entry) => entry.id === instanceId)) {
      throw new Error('The character does not own this entry');
    }
    character.equipment = character.equipment.filter((entry) => entry.id !== instanceId);
    character.spells = character.spells.filter((entry) => entry.id !== instanceId);
    if (character.concentration === instanceId) character.concentration = '';
    this._save(character);
  }

  stats(id) {
    const character = this.get(id);
    const active = new Map(
      character.equipment
        .filter(
          (item) =>
            item.equipped && (!this.catalog.get(item.entryId).requiresAttunement || item.attuned)
        )
        .map((item) => [item.entryId, this.catalog.get(item.entryId)])
    );
    const abilityScores = { ...character.abilities };
    for (const entry of active.values()) {
      for (const [ability, minimum] of Object.entries(entry.effects?.abilityMinimum || {})) {
        abilityScores[ability] = Math.max(abilityScores[ability], minimum);
      }
    }
    const abilityModifiers = Object.fromEntries(
      ABILITIES.map((ability) => [ability, Math.floor((abilityScores[ability] - 10) / 2)])
    );
    const dexterity = abilityModifiers.dexterity;
    const classData = this.classes.get(character.classId);
    const proficiencyBonus = 2 + Math.floor((character.level - 1) / 4);
    const armorItem = character.equipment.find(
      (item) => item.equipped && this.catalog.get(item.entryId)?.equipmentType === 'armor'
    );
    const armor = armorItem ? this.catalog.get(armorItem.entryId).armor : null;
    const armorDexterity = armor?.dexterity
      ? Math.min(dexterity, armor.maxDexterity ?? Infinity)
      : 0;
    const shield = character.equipment.find(
      (item) => item.equipped && this.catalog.get(item.entryId)?.equipmentType === 'shield'
    );
    let bonus = 0;
    let saveBonus = 0;
    for (const entry of active.values()) {
      if (entry.effects?.unarmoredOnly && (armor || shield)) continue;
      bonus += entry.effects?.ac || 0;
      saveBonus += entry.effects?.saves || 0;
    }
    const saveProficiencies = Object.fromEntries(
      ABILITIES.map((ability) => [
        ability,
        character.saveOverrides[ability] ?? !!classData?.saves.includes(ability),
      ])
    );
    const saves = Object.fromEntries(
      ABILITIES.map((ability) => [
        ability,
        abilityModifiers[ability] + (saveProficiencies[ability] ? proficiencyBonus : 0) + saveBonus,
      ])
    );
    const skills = Object.fromEntries(
      SKILLS.map(({ id: skill, ability }) => [
        skill,
        abilityModifiers[ability] + (character.skills[skill] || 0) * proficiencyBonus,
      ])
    );
    const castingAbility =
      character.castingAbility === 'auto'
        ? classData?.castingAbility || ''
        : character.castingAbility;
    const attacks = character.equipment
      .filter((item) => item.equipped && this.catalog.get(item.entryId).weapon)
      .map((item) => {
        const entry = this.catalog.get(item.entryId);
        const weapon = entry.weapon;
        const ability =
          weapon.range === 'ranged' ||
          (weapon.properties.includes('finesse') &&
            abilityModifiers.dexterity > abilityModifiers.strength)
            ? 'dexterity'
            : 'strength';
        const proficient =
          typeof item.proficiencyOverride === 'boolean'
            ? item.proficiencyOverride
            : !!classData?.proficiencies.some(
                (proficiency) =>
                  proficiency === `${weapon.category}-weapons` || proficiency === weapon.proficiency
              );
        const modifier = abilityModifiers[ability] + (entry.bonus || 0);
        const expression = (dice) =>
          `${dice}${modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''}`;
        return {
          itemId: item.id,
          entryId: entry.id,
          name: entry.name,
          ability,
          proficient,
          attackBonus: modifier + (proficient ? proficiencyBonus : 0),
          damage: expression(weapon.damage),
          versatileDamage: weapon.versatile ? expression(weapon.versatile) : '',
          damageType: weapon.damageType,
          properties: weapon.properties,
        };
      });
    return {
      abilityScores,
      abilityModifiers,
      proficiencyBonus,
      initiative: dexterity + character.initiativeBonus,
      saves,
      saveProficiencies,
      skills,
      passivePerception: 10 + skills.perception,
      castingAbility,
      spellAttack: castingAbility ? abilityModifiers[castingAbility] + proficiencyBonus : null,
      spellSaveDC: castingAbility ? 8 + abilityModifiers[castingAbility] + proficiencyBonus : null,
      spellSlots: this._slots(character),
      preparesSpells: this._preparesSpells(character),
      attacks,
      carriedWeight: character.equipment.reduce((sum, item) => {
        const weight = this.catalog.get(item.entryId).weight;
        return sum + (Number.isFinite(weight) ? weight * item.quantity : 0);
      }, 0),
      unknownWeightItems: character.equipment.filter(
        (item) => !Number.isFinite(this.catalog.get(item.entryId).weight)
      ).length,
      armorClass:
        (armor ? armor.base + armorDexterity : 10 + dexterity) +
        (shield ? this.catalog.get(shield.entryId).armor.base : 0) +
        bonus +
        character.acBonus,
      armorName: armorItem ? this.catalog.get(armorItem.entryId).name : 'Unarmored',
      shieldName: shield ? this.catalog.get(shield.entryId).name : '',
      equipmentACBonus: bonus,
    };
  }

  _preparesSpells(character) {
    return this.rules.preparesSpells(character.classId);
  }

  _slots(character) {
    const classData = this.classes.get(character.classId);
    const base = classData ? classData.slots[character.level] : Array(9).fill(0);
    if (!Array.isArray(base) || base.length !== 9)
      throw new Error('The class spell-slot data is incomplete');
    return base.map((value, index) => {
      const max = character.slotOverrides[index + 1] ?? value;
      const used = character.slotsUsed[index];
      return { level: index + 1, max, used, remaining: max - used };
    });
  }

  _save(character) {
    this._validate(character);
    this.storage.setItem(`${STORAGE_PREFIX}${character.id}`, JSON.stringify(character));
  }

  _validate(character) {
    const integer = (value, min, max, label) => {
      if (!Number.isInteger(value) || value < min || value > max) {
        throw new RangeError(`${label} must be a whole number from ${min} to ${max}`);
      }
    };
    if (character?.version !== 1 || typeof character.id !== 'string') {
      throw new Error('Unsupported character format');
    }
    const allowed = [
      'version',
      'id',
      'name',
      'classId',
      'level',
      'ancestry',
      'background',
      'alignment',
      'experience',
      'abilities',
      'hp',
      'speed',
      'conditions',
      'fallTraits',
      'lastFall',
      'initiativeBonus',
      'acBonus',
      'inspiration',
      'skills',
      'saveOverrides',
      'castingAbility',
      'slotsUsed',
      'slotOverrides',
      'concentration',
      'spells',
      'notes',
      'equipment',
    ];
    if (Object.keys(character).some((field) => !allowed.includes(field))) {
      throw new Error('Character data contains unsupported fields');
    }
    validateMovementEffects(character);
    for (const field of ['skills', 'saveOverrides', 'slotOverrides']) {
      if (
        !character[field] ||
        typeof character[field] !== 'object' ||
        Array.isArray(character[field])
      ) {
        throw new Error(`Invalid character ${field}`);
      }
    }
    for (const field of ['name', 'ancestry', 'background', 'alignment', 'notes']) {
      if (
        typeof character[field] !== 'string' ||
        character[field].length > (field === 'notes' ? 20000 : 160)
      ) {
        throw new Error(`Invalid character ${field}`);
      }
    }
    if (!character.name.trim()) throw new Error('A character needs a name');
    if (character.classId !== '' && !this.classes.has(character.classId)) {
      throw new Error('Unknown character class');
    }
    integer(character.level, 1, 20, 'Level');
    integer(character.experience, 0, 1000000000, 'Experience');
    integer(character.speed, 0, 1000, 'Speed');
    integer(character.initiativeBonus, -30, 30, 'Initiative adjustment');
    integer(character.acBonus, -30, 30, 'AC adjustment');
    if (typeof character.inspiration !== 'boolean') throw new Error('Invalid inspiration state');
    if (!character.abilities || Object.keys(character.abilities).length !== ABILITIES.length) {
      throw new Error('All six ability scores are required');
    }
    for (const ability of ABILITIES) integer(character.abilities[ability], 1, 30, ability);
    for (const field of ['max', 'current', 'temp'])
      integer(character.hp?.[field], 0, 9999, `HP ${field}`);
    if (character.hp.current > character.hp.max)
      throw new RangeError('Current HP cannot exceed maximum HP');
    if (!['auto', '', ...ABILITIES].includes(character.castingAbility)) {
      throw new Error('Invalid spellcasting ability');
    }
    if (!Array.isArray(character.slotsUsed) || character.slotsUsed.length !== 9) {
      throw new Error('All nine spell-slot levels are required');
    }
    character.slotsUsed.forEach((value) => integer(value, 0, 99, 'Used spell slots'));
    if (!Array.isArray(character.equipment) || !Array.isArray(character.spells)) {
      throw new Error('Invalid equipment or spell list');
    }
    const ids = new Set();
    for (const item of character.equipment) {
      if (
        typeof item.id !== 'string' ||
        ids.has(item.id) ||
        this.catalog.get(item.entryId)?.kind !== 'item' ||
        typeof item.equipped !== 'boolean' ||
        typeof item.attuned !== 'boolean'
      ) {
        throw new Error('Invalid or unknown equipment in character data');
      }
      ids.add(item.id);
      integer(item.quantity, 1, 9999, 'Item quantity');
      if (item.proficiencyOverride != null && typeof item.proficiencyOverride !== 'boolean') {
        throw new Error('Invalid weapon proficiency override');
      }
      if (item.attuned && !this.catalog.get(item.entryId).requiresAttunement) {
        throw new Error(
          'An item that does not require attunement cannot occupy an attunement slot'
        );
      }
    }
    if (character.equipment.filter((item) => item.attuned).length > 3) {
      throw new Error('A character can attune to at most three items');
    }
    for (const type of ['armor', 'shield']) {
      if (
        character.equipment.filter(
          (item) => item.equipped && this.catalog.get(item.entryId).equipmentType === type
        ).length > 1
      ) {
        throw new Error(`Only one ${type} can be equipped`);
      }
    }
    for (const [ability, value] of Object.entries(character.saveOverrides || {})) {
      if (!ABILITIES.includes(ability) || typeof value !== 'boolean')
        throw new Error('Invalid saving throw proficiency');
    }
    for (const [skill, value] of Object.entries(character.skills || {})) {
      if (!SKILLS.some((entry) => entry.id === skill)) throw new Error('Unknown skill');
      integer(value, 0, 2, 'Skill proficiency (0 none, 1 proficient, 2 expertise)');
    }
    for (const [level, value] of Object.entries(character.slotOverrides || {})) {
      integer(Number(level), 1, 9, 'Spell slot level');
      integer(value, 0, 99, 'Spell slot maximum');
    }
    for (const spell of character.spells) {
      if (
        typeof spell.id !== 'string' ||
        ids.has(spell.id) ||
        this.catalog.get(spell.entryId)?.kind !== 'spell' ||
        typeof spell.prepared !== 'boolean'
      ) {
        throw new Error('Invalid or unknown spell in character data');
      }
      ids.add(spell.id);
    }
    if (
      typeof character.concentration !== 'string' ||
      (character.concentration &&
        !character.spells.some((spell) => spell.id === character.concentration))
    ) {
      throw new Error('Invalid concentration spell');
    }
    if (this._slots(character).some((slot) => slot.used > slot.max)) {
      throw new Error(
        'Used slots exceed the available slots; restore them before reducing casting levels'
      );
    }
  }
}
