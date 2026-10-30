import { commitStorageChanges } from './storageChanges.js';
import { REST_STORAGE_PREFIX } from './CharacterRest.js';

export const ACTION_STORAGE_PREFIX = 'taverntable.character-actions.v1.';
const COSTS = ['action', 'bonus', 'reaction', 'free'];
const RESETS = ['turn', 'short', 'long', 'daily', 'manual'];

export default class CharacterActions {
  constructor(library, characterStoragePrefix) {
    this.library = library;
    this.storage = library.storage;
    this.characterStoragePrefix = characterStoragePrefix;
  }

  // -- Custom definitions --
  key(id) {
    return `${ACTION_STORAGE_PREFIX}${id}`;
  }

  list(id) {
    return this.snapshot(id).entries.map((entry) => ({
      ...entry,
      remaining:
        entry.maximum === null
          ? null
          : entry.reset === 'turn'
            ? entry.maximum
            : Math.max(0, entry.maximum - entry.used),
    }));
  }

  upsert(id, definition) {
    const state = this.snapshot(id);
    if (
      !definition ||
      typeof definition !== 'object' ||
      Object.keys(definition).some(
        (key) =>
          ![
            'id',
            'name',
            'cost',
            'maximum',
            'reset',
            'note',
            'resourceId',
            'resourceCost',
            'magicAction',
          ].includes(key)
      ) ||
      (definition.magicAction !== undefined && typeof definition.magicAction !== 'boolean')
    )
      throw new Error('Unsupported custom ability fields');
    const previous = definition.id
      ? state.entries.find((entry) => entry.id === definition.id)
      : null;
    if (definition.id && !previous) throw new Error('The custom ability no longer exists');
    const entry = {
      id: previous?.id || globalThis.crypto.randomUUID(),
      name: definition.name,
      cost: definition.cost,
      maximum: definition.maximum ?? null,
      reset: definition.reset || 'manual',
      note: definition.note ?? '',
      resourceId: definition.resourceId ?? '',
      resourceCost: definition.resourceCost ?? 1,
      used: previous?.used || 0,
      ...((definition.magicAction ?? previous?.magicAction) ? { magicAction: true } : {}),
    };
    if (previous) state.entries[state.entries.indexOf(previous)] = entry;
    else state.entries.push(entry);
    this._save(state);
    return entry.id;
  }

  remove(id, actionId) {
    const state = this.snapshot(id);
    const index = state.entries.findIndex((entry) => entry.id === actionId);
    if (index < 0) throw new Error('The custom ability no longer exists');
    state.entries.splice(index, 1);
    this._save(state);
  }

  resourceRows(id) {
    return this.list(id)
      .filter((entry) => entry.maximum !== null && entry.reset !== 'turn')
      .map((entry) => ({
        id: `custom:${entry.id}`,
        name: entry.name,
        maximum: entry.maximum,
        used: Math.min(entry.maximum, entry.used),
        remaining: entry.remaining,
        reset: entry.reset,
        shortRecovery: 0,
      }));
  }

  setRemaining(id, actionId, remaining) {
    const state = this.snapshot(id);
    const entry = state.entries.find((action) => action.id === actionId);
    if (!entry || entry.maximum === null || entry.reset === 'turn')
      throw new Error('No persistent ability pool exists for this action');
    if (!Number.isInteger(remaining) || remaining < 0 || remaining > entry.maximum) {
      throw new Error(`Remaining uses must be a whole number from 0 to ${entry.maximum}`);
    }
    entry.used = entry.maximum - remaining;
    this._save(state);
  }

  setAttackCount(id, count) {
    const state = this.snapshot(id);
    state.attackCountOverride = count;
    this._save(state);
  }

  restChanges(id, kind) {
    const state = this.snapshot(id);
    let changed = false;
    for (const entry of state.entries) {
      if (
        entry.used > 0 &&
        (entry.reset === kind || (kind === 'long' && entry.reset === 'short'))
      ) {
        entry.used = 0;
        changed = true;
      }
    }
    if (!changed) return [];
    this.validate(state, id);
    return [[this.key(id), JSON.stringify(state)]];
  }

  // -- Persistent action costs and targeted undo --
  consume(id, effect = {}) {
    if (
      !effect ||
      typeof effect !== 'object' ||
      Object.keys(effect).some(
        (key) =>
          ![
            'spellId',
            'slotLevel',
            'resourceId',
            'resourceCost',
            'customId',
            'dropConcentration',
          ].includes(key)
      )
    )
      throw new Error('Unsupported action cost');
    const character = this.library.get(id);
    const rest = this.library.rest.snapshot(id);
    const actions = this.snapshot(id);
    const beforeSlots = [...character.slotsUsed];
    const beforeConcentration = character.concentration;
    const beforeResources = { ...rest.resources };
    const beforeUses = new Map(actions.entries.map((entry) => [entry.id, entry.used]));
    const custom = effect.customId
      ? actions.entries.find((entry) => entry.id === effect.customId)
      : null;
    if (effect.customId && !custom) throw new Error('The custom ability no longer exists');
    if (effect.spellId) this.library._applyCast(character, effect.spellId, effect.slotLevel);
    if (effect.dropConcentration) character.concentration = '';
    const resourceId = custom?.resourceId || effect.resourceId;
    const resourceCost = custom?.resourceId ? custom.resourceCost : (effect.resourceCost ?? 1);
    if (resourceId) {
      const resource = this.library.rest
        .status(id)
        .resources.find((entry) => entry.id === resourceId);
      if (!resource) throw new Error('The required class resource is not available');
      if (!Number.isInteger(resourceCost) || resourceCost < 1 || resourceCost > 10000) {
        throw new Error('Invalid class-resource cost');
      }
      if (resource.maximum !== null) {
        if (resource.remaining < resourceCost)
          throw new Error(`Not enough ${resource.name} remains`);
        rest.resources[resourceId] = resource.used + resourceCost;
      }
    }
    if (custom?.maximum !== null && custom && custom.reset !== 'turn') {
      if (custom.used >= custom.maximum) throw new Error('No custom ability uses remain');
      custom.used++;
    }
    const changes = [];
    character.slotsUsed.forEach((value, index) => {
      if (value !== beforeSlots[index])
        changes.push({ type: 'slot', key: index, before: beforeSlots[index], after: value });
    });
    if (character.concentration !== beforeConcentration) {
      changes.push({
        type: 'concentration',
        before: beforeConcentration,
        after: character.concentration,
      });
    }
    for (const [key, value] of Object.entries(rest.resources)) {
      if (beforeResources[key] !== value) {
        changes.push({
          type: 'resource',
          key,
          before: beforeResources[key],
          beforePresent: Object.hasOwn(beforeResources, key),
          after: value,
        });
      }
    }
    for (const entry of actions.entries) {
      if (beforeUses.get(entry.id) !== entry.used) {
        changes.push({
          type: 'custom',
          key: entry.id,
          before: beforeUses.get(entry.id),
          after: entry.used,
        });
      }
    }
    this._writeDrafts(character, rest, actions, changes);
    return { characterId: id, changes };
  }

  undo(receipt) {
    if (!receipt || !Array.isArray(receipt.changes) || receipt.changes.length > 20) {
      throw new Error('Invalid action-cost receipt');
    }
    const id = receipt.characterId;
    const character = this.library.get(id);
    const rest = this.library.rest.snapshot(id);
    const actions = this.snapshot(id);
    for (const change of receipt.changes) {
      let current;
      if (
        change.type === 'slot' &&
        Number.isInteger(change.key) &&
        change.key >= 0 &&
        change.key < 9
      ) {
        current = character.slotsUsed[change.key];
        if (current === change.after) character.slotsUsed[change.key] = change.before;
      } else if (change.type === 'concentration') {
        current = character.concentration;
        if (current === change.after) character.concentration = change.before;
      } else if (change.type === 'resource') {
        current = rest.resources[change.key];
        if (current === change.after) {
          if (change.beforePresent) rest.resources[change.key] = change.before;
          else delete rest.resources[change.key];
        }
      } else if (change.type === 'custom') {
        const entry = actions.entries.find((entry) => entry.id === change.key);
        current = entry?.used;
        if (entry && current === change.after) entry.used = change.before;
      } else {
        throw new Error('Unknown action-cost receipt entry');
      }
      if (current !== change.after) {
        throw new Error(
          'Resources changed since this action; use an explicit manual adjustment instead'
        );
      }
    }
    this._writeDrafts(character, rest, actions, receipt.changes);
  }

  _writeDrafts(character, rest, actions, changes) {
    const writes = [];
    if (changes.some((change) => ['slot', 'concentration'].includes(change.type))) {
      this.library._validate(character);
      writes.push([`${this.characterStoragePrefix}${character.id}`, JSON.stringify(character)]);
    }
    if (changes.some((change) => change.type === 'resource')) {
      this.library.rest._validate(rest, character.id);
      writes.push([`${REST_STORAGE_PREFIX}${character.id}`, JSON.stringify(rest)]);
    }
    if (changes.some((change) => change.type === 'custom')) {
      this.validate(actions, character.id);
      writes.push([this.key(character.id), JSON.stringify(actions)]);
    }
    if (writes.length) commitStorageChanges(this.storage, writes);
  }

  // -- Companion storage --
  snapshot(id) {
    this.library.get(id);
    const raw = this.storage.getItem(this.key(id));
    if (raw === null)
      return { version: 1, characterId: id, entries: [], attackCountOverride: null };
    let state;
    try {
      state = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('Saved custom abilities contain invalid JSON; they were not reset', {
        cause: error,
      });
    }
    this.validate(state, id);
    return state;
  }

  rebind(id, snapshot = null, sourceId = id) {
    if (snapshot === null)
      return { version: 1, characterId: id, entries: [], attackCountOverride: null };
    this.validate(snapshot, sourceId);
    return {
      ...snapshot,
      characterId: id,
      entries: snapshot.entries.map((entry) => ({ ...entry })),
    };
  }

  _save(state) {
    this.validate(state, state.characterId);
    commitStorageChanges(this.storage, [[this.key(state.characterId), JSON.stringify(state)]]);
  }

  validate(state, id) {
    if (
      state?.version !== 1 ||
      state.characterId !== id ||
      Object.keys(state).some(
        (key) => !['version', 'characterId', 'entries', 'attackCountOverride'].includes(key)
      ) ||
      !Array.isArray(state.entries) ||
      state.entries.length > 100 ||
      (state.attackCountOverride !== null &&
        (!Number.isInteger(state.attackCountOverride) ||
          state.attackCountOverride < 1 ||
          state.attackCountOverride > 10))
    ) {
      throw new Error(
        'Saved custom abilities have an unsupported or invalid format; they were not reset'
      );
    }
    const ids = new Set();
    for (const entry of state.entries) {
      if (
        !entry ||
        typeof entry.id !== 'string' ||
        !/^[a-zA-Z0-9-]{1,100}$/.test(entry.id) ||
        ids.has(entry.id) ||
        Object.keys(entry).some(
          (key) =>
            ![
              'id',
              'name',
              'cost',
              'maximum',
              'reset',
              'note',
              'resourceId',
              'resourceCost',
              'used',
              'magicAction',
            ].includes(key)
        ) ||
        typeof entry.name !== 'string' ||
        !entry.name.trim() ||
        entry.name.length > 100 ||
        !COSTS.includes(entry.cost) ||
        (entry.magicAction !== undefined && typeof entry.magicAction !== 'boolean') ||
        (entry.magicAction === true && entry.cost !== 'action') ||
        !RESETS.includes(entry.reset) ||
        typeof entry.note !== 'string' ||
        entry.note.length > 2000 ||
        !Number.isInteger(entry.used) ||
        entry.used < 0 ||
        entry.used > 1000000 ||
        (entry.maximum !== null &&
          (!Number.isInteger(entry.maximum) || entry.maximum < 1 || entry.maximum > 10000)) ||
        typeof entry.resourceId !== 'string' ||
        (entry.resourceId &&
          (!this.library.rules.restResources.some((resource) => resource.id === entry.resourceId) ||
            entry.maximum !== null)) ||
        !Number.isInteger(entry.resourceCost) ||
        entry.resourceCost < 1 ||
        entry.resourceCost > 10000
      ) {
        throw new Error('A custom ability has invalid cost, use, resource or reset settings');
      }
      ids.add(entry.id);
    }
  }
}
