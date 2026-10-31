import { commitStorageChanges } from './storageChanges.js';

export const REST_STORAGE_PREFIX = 'taverntable.character-rest.v1.';

export default class CharacterRest {
  constructor(library, characterStoragePrefix) {
    this.library = library;
    this.storage = library.storage;
    this.characterStoragePrefix = characterStoragePrefix;
  }

  status(id) {
    const character = this.library.get(id);
    const state = this._read(id);
    const classData = this.library.classes.get(character.classId);
    const sides = classData?.hitDie ?? null;
    if (sides !== null && ![6, 8, 10, 12].includes(sides)) {
      throw new Error('The class Hit Die data is invalid');
    }
    const spent = Math.min(character.level, state.hitDiceSpent);
    const stats = this.library.stats(id);
    const resources = [
      ...this._resources(character, state, stats),
      ...this.library.actions.resourceRows(id),
    ];
    return {
      classId: character.classId,
      level: character.level,
      hitDice: {
        sides,
        total: character.level,
        spent,
        remaining: character.level - spent,
        constitutionModifier: stats.abilityModifiers.constitution,
      },
      resources,
      shortRestChoices: this.library.rules.shortRestChoices(character, resources),
      spellSlots: stats.spellSlots,
      arcaneRecoveryBudget: character.classId === 'wizard' ? Math.ceil(character.level / 2) : 0,
    };
  }

  spendHitDie(id, roll, expected = null) {
    const character = this.library.get(id);
    this._assertShortRest(character);
    const state = this._read(id);
    const status = this.status(id);
    const dice = status.hitDice;
    if (!dice.sides) throw new Error('Choose a character class before spending Hit Dice');
    if (dice.remaining < 1) throw new Error('No Hit Dice remain');
    if (!Number.isInteger(roll) || roll < 1 || roll > dice.sides) {
      throw new Error(`The Hit Die result must be a whole number from 1 to ${dice.sides}`);
    }
    if (
      expected &&
      [
        ['classId', status.classId],
        ['level', status.level],
        ['sides', dice.sides],
        ['spent', dice.spent],
        ['constitutionModifier', dice.constitutionModifier],
      ].some(([key, value]) => expected[key] !== value)
    ) {
      throw new Error('The character or Hit Dice pool changed while rolling; no die was spent');
    }
    const healing = this.library.rules.hitDieHealing(roll, dice.constitutionModifier);
    const applied = Math.min(healing, character.hp.max - character.hp.current);
    character.hp.current += applied;
    state.hitDiceSpent = dice.spent + 1;
    this._write(character, state);
    return {
      roll,
      modifier: dice.constitutionModifier,
      healing,
      applied,
      remaining: dice.remaining - 1,
      hp: { ...character.hp },
    };
  }

  longRest(id) {
    const character = this.library.get(id);
    if (character.hp.current < 1)
      throw new Error('A long rest requires at least 1 HP at its start');
    const state = this._read(id);
    const spent = Math.min(character.level, state.hitDiceSpent);
    const recovered = this.library.rules.hitDiceRecovery(character.level, spent);
    state.hitDiceSpent = spent - recovered;
    character.hp.current = character.hp.max;
    character.hp.temp = 0;
    character.slotsUsed.fill(0);
    character.concentration = '';
    for (const resource of this.status(id).resources) {
      if (!resource.id.startsWith('custom:') && ['short', 'long'].includes(resource.reset))
        state.resources[resource.id] = 0;
    }
    this._write(character, state, this.library.actions.restChanges(id, 'long'));
    return { kind: 'long', hitDiceRecovered: recovered };
  }

  shortRest(id, choices = {}) {
    const character = this.library.get(id);
    this._assertShortRest(character);
    const state = this._read(id);
    const restored = [];
    const info = this.status(id);
    const optional = this.library.rules.shortRestRecovery({
      character,
      resources: info.resources,
      choices,
    });
    for (const resource of info.resources) {
      if (resource.reset === 'short') {
        if (!resource.id.startsWith('custom:')) state.resources[resource.id] = 0;
        if (resource.used > 0) restored.push(resource.name);
      } else if (resource.shortRecovery > 0) {
        const recovered = Math.min(resource.used, resource.shortRecovery);
        state.resources[resource.id] = resource.used - recovered;
        if (recovered > 0) restored.push(`${resource.name} (+${recovered})`);
      }
    }
    for (const change of optional.changes) state.resources[change.id] = change.used;
    restored.push(...optional.restored);
    let slotsRecovered = 0;
    if (character.classId === 'warlock') {
      const base = this.library.classes.get('warlock').slots[character.level];
      base.slice(0, 5).forEach((maximum, index) => {
        if (maximum > 0) {
          slotsRecovered += character.slotsUsed[index];
          character.slotsUsed[index] = 0;
        }
      });
    }
    const customChanges = this.library.actions.restChanges(id, 'short');
    if (slotsRecovered > 0) this._write(character, state, customChanges);
    else this._writeState(state, customChanges);
    return { kind: 'short', restored, slotsRecovered };
  }

  setResourceRemaining(id, resourceId, remaining) {
    if (resourceId.startsWith('custom:'))
      return this.library.actions.setRemaining(id, resourceId.slice(7), remaining);
    const resource = this.status(id).resources.find((entry) => entry.id === resourceId);
    if (!resource) throw new Error('That resource is not available to this class and level');
    if (resource.maximum === null) throw new Error('This resource has unlimited uses');
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > resource.maximum) {
      throw new Error(
        `Remaining ${resource.name} must be a whole number from 0 to ${resource.maximum}`
      );
    }
    const state = this._read(id);
    state.resources[resourceId] = resource.maximum - remaining;
    this._writeState(state);
  }

  recoverSpellSlots(id, selection) {
    const character = this.library.get(id);
    const resource = this.status(id).resources.find((entry) => entry.id === 'arcane-recovery');
    if (!resource) throw new Error('Arcane Recovery requires the Wizard class');
    if (resource.remaining < 1)
      throw new Error(
        `Arcane Recovery is already used; ${resource.reset === 'daily' ? 'declare a new game day' : 'complete a Long Rest'} before using it again`
      );
    if (!selection || typeof selection !== 'object' || Array.isArray(selection)) {
      throw new Error('Choose expended spell slots for Arcane Recovery');
    }
    let points = 0;
    for (const [key, count] of Object.entries(selection)) {
      const level = Number(key);
      if (
        !Number.isInteger(level) ||
        String(level) !== key ||
        level < 1 ||
        level > 5 ||
        !Number.isInteger(count) ||
        count < 0 ||
        count > character.slotsUsed[level - 1]
      ) {
        throw new Error('Choose available expended slots of levels 1 through 5');
      }
      points += level * count;
      character.slotsUsed[level - 1] -= count;
    }
    const budget = Math.ceil(character.level / 2);
    if (points < 1 || points > budget) {
      throw new Error(`Arcane Recovery must restore between 1 and ${budget} total slot levels`);
    }
    const state = this._read(id);
    state.resources['arcane-recovery'] = 1;
    this._write(character, state);
    return { points, budget };
  }

  resetDaily(id) {
    const state = this._read(id);
    for (const resource of this.status(id).resources) {
      if (!resource.id.startsWith('custom:') && resource.reset === 'daily')
        state.resources[resource.id] = 0;
    }
    this._writeState(state, this.library.actions.restChanges(id, 'daily'));
  }

  snapshot(id) {
    this.library.get(id);
    return this._read(id);
  }

  restore(
    character,
    snapshot = null,
    sourceId = character.id,
    actionSnapshot = null,
    layoutSnapshot = null
  ) {
    if (snapshot !== null) this._validate(snapshot, sourceId);
    const state =
      snapshot === null
        ? { version: 1, characterId: character.id, hitDiceSpent: 0, resources: {} }
        : { ...snapshot, characterId: character.id, resources: { ...snapshot.resources } };
    if (
      this.storage.getItem(`${this.characterStoragePrefix}${character.id}`) !== null ||
      this.storage.getItem(`${REST_STORAGE_PREFIX}${character.id}`) !== null ||
      this.storage.getItem(this.library.actions.key(character.id)) !== null ||
      this.storage.getItem(this.library.layouts.key(character.id)) !== null
    ) {
      throw new Error('A character with the generated ID already exists; retry the import');
    }
    const actions = this.library.actions.rebind(character.id, actionSnapshot, sourceId);
    const layout = this.library.layouts.rebind(character.id, layoutSnapshot, sourceId);
    this._write(character, state, [
      [this.library.actions.key(character.id), JSON.stringify(actions)],
      [this.library.layouts.key(character.id), JSON.stringify(layout)],
    ]);
  }

  remove(id, additional = []) {
    this.library.get(id);
    this._transaction([
      [`${this.characterStoragePrefix}${id}`, null],
      [`${REST_STORAGE_PREFIX}${id}`, null],
      [this.library.actions.key(id), null],
      [this.library.layouts.key(id), null],
      ...additional,
    ]);
  }

  _resources(character, state, stats) {
    return this.library.rules.restResources
      .filter(
        (resource) =>
          resource.classId === character.classId && character.level >= resource.minimumLevel
      )
      .map((resource) => {
        const maximum =
          resource.unlimitedAt && character.level >= resource.unlimitedAt
            ? null
            : this._maximum(resource, character, stats);
        const used = maximum === null ? 0 : Math.min(maximum, state.resources[resource.id] ?? 0);
        const reset =
          resource.shortRestAt && character.level >= resource.shortRestAt
            ? 'short'
            : resource.reset;
        return {
          id: resource.id,
          name: resource.name,
          maximum,
          used,
          remaining: maximum === null ? null : maximum - used,
          reset,
          shortRecovery:
            resource.shortRecovery ??
            (resource.shortRecoveryAt && character.level >= resource.shortRecoveryAt
              ? resource.shortRecoveryAmount
              : 0),
        };
      });
  }

  _maximum(resource, character, stats) {
    if (Array.isArray(resource.maximum)) {
      const step = resource.maximum.findLast(([level]) => level <= character.level);
      if (!step) throw new Error(`Incomplete ${resource.name} resource progression`);
      return step[1];
    }
    if (resource.maximum === 'level') return character.level;
    if (resource.maximum === 'five-per-level') return 5 * character.level;
    if (resource.maximum === 'charisma') return Math.max(1, stats.abilityModifiers.charisma);
    if (resource.maximum === 'one-plus-charisma')
      return Math.max(0, 1 + stats.abilityModifiers.charisma);
    throw new Error(`Unknown ${resource.name} resource capacity rule`);
  }

  // -- Persistent companion state --
  _writeState(state, additional = []) {
    this._validate(state, state.characterId);
    this._transaction([
      [`${REST_STORAGE_PREFIX}${state.characterId}`, JSON.stringify(state)],
      ...additional,
    ]);
  }

  _write(character, state, additional = []) {
    this.library._validate(character);
    this._validate(state, character.id);
    this._transaction([
      [`${this.characterStoragePrefix}${character.id}`, JSON.stringify(character)],
      [`${REST_STORAGE_PREFIX}${character.id}`, JSON.stringify(state)],
      ...additional,
    ]);
  }

  _transaction(changes) {
    return commitStorageChanges(this.storage, changes);
  }

  _read(id) {
    const raw = this.storage.getItem(`${REST_STORAGE_PREFIX}${id}`);
    if (raw === null) {
      return { version: 1, characterId: id, hitDiceSpent: 0, resources: {} };
    }
    let state;
    try {
      state = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('Saved rest data contains invalid JSON; it was not reset', { cause: error });
    }
    this._validate(state, id);
    return state;
  }

  _validate(state, id) {
    if (
      state?.version !== 1 ||
      state.characterId !== id ||
      Object.keys(state).some(
        (key) => !['version', 'characterId', 'hitDiceSpent', 'resources'].includes(key)
      ) ||
      !Number.isInteger(state.hitDiceSpent) ||
      state.hitDiceSpent < 0 ||
      state.hitDiceSpent > 20 ||
      !state.resources ||
      typeof state.resources !== 'object' ||
      Array.isArray(state.resources) ||
      Object.keys(state.resources).some(
        (key) => !this.library.rules.restResources.some((resource) => resource.id === key)
      ) ||
      Object.values(state.resources).some(
        (used) => !Number.isInteger(used) || used < 0 || used > 1000000
      )
    ) {
      throw new Error('Saved rest data has an unsupported or invalid format; it was not reset');
    }
  }

  _assertShortRest(character) {
    if (!this.library.rules.canStartShortRest(character)) {
      throw new Error('A short rest requires at least 1 HP at its start under this ruleset');
    }
  }
}
