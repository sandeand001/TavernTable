import { isCloudAccessScope, isCloudAccessGeneration, isCloudUUID } from './CloudProtocol.js';
import { campaignRecordCharacterId } from './CampaignCharacters.js';
import {
  validatePlayerMotion,
  validateBudget,
  validatePlayerVisual,
} from './PlayerPublicProtocol.js';
import { PLAYER_COMMAND_KINDS } from './PlayerCommandProtocol.js';
import { sceneActorPlacement, samePlacement } from '../scene/token-adapter/SavedPlacements.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) =>
  object(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const copy = (value) => structuredClone(value);
const invalid = () => {
  throw Object.assign(new Error('The current owner world could not be verified'), {
    code: 'invalid-cloud-owner-state',
    status: 503,
  });
};
const sameAccess = (left, right) =>
  ['version', 'uid', 'campaignId', 'role', 'seatId', 'accessGeneration'].every(
    (field) => left[field] === right[field]
  );
const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) invalid();
    throw error;
  }
};

function keyed(values, key, read = (value) => copy(value)) {
  if (!Array.isArray(values) || values.length > 10000) invalid();
  const order = values.map((value) => value?.[key]);
  if (order.some((value) => typeof value !== 'string') || new Set(order).size !== order.length)
    invalid();
  return { order, values: Object.fromEntries(values.map((value) => [value[key], read(value)])) };
}

function unkeyed(value, write) {
  if (
    !keys(value, ['order', 'values']) ||
    !Array.isArray(value.order) ||
    value.order.length > 10000 ||
    !object(value.values) ||
    Object.keys(value.values).length !== value.order.length ||
    new Set(value.order).size !== value.order.length ||
    value.order.some((key) => typeof key !== 'string' || !Object.hasOwn(value.values, key))
  )
    invalid();
  return value.order.map((key) => write(key, value.values[key]));
}

function model(state) {
  const scene = state.scene === null ? null : parse(state.scene);
  if (scene !== null && (!object(scene) || !Array.isArray(scene.creatures))) invalid();
  return {
    ...copy(state),
    records: keyed(state.records, 'key', (row) => parse(row.value)),
    scene: scene === null ? null : { ...scene, creatures: keyed(scene.creatures, 'id') },
  };
}

function materialize(value) {
  const scene =
    value.scene === null
      ? null
      : {
          ...value.scene,
          creatures: unkeyed(value.scene?.creatures, (id, actor) => {
            if (!object(actor) || actor.id !== id) invalid();
            return copy(actor);
          }),
        };
  return {
    ...copy(value),
    records: unkeyed(value.records, (key, record) => ({ key, value: JSON.stringify(record) })),
    scene: scene === null ? null : JSON.stringify(scene),
  };
}

export function validateCloudOwnerSnapshot(value) {
  if (
    !keys(value, ['version', 'access', 'sessionId', 'generation', 'origin', 'state']) ||
    value.version !== 1 ||
    !isCloudAccessScope(value.access) ||
    value.access.role !== 'owner' ||
    !isCloudUUID(value.sessionId) ||
    !isCloudAccessGeneration(value.generation) ||
    value.generation < 1 ||
    !keys(value.state, [
      'campaign',
      'revision',
      'records',
      'scene',
      'sceneRevision',
      'sceneSavedAt',
    ])
  )
    invalid();
  const state = value.state;
  if (
    !object(state.campaign) ||
    state.campaign.version !== 1 ||
    state.campaign.id !== value.access.campaignId ||
    !isCloudAccessGeneration(state.revision) ||
    state.revision !== state.campaign.charactersRevision ||
    !isCloudAccessGeneration(state.sceneRevision) ||
    state.sceneRevision !== state.campaign.sceneRevision ||
    state.sceneSavedAt !== state.campaign.sceneSavedAt ||
    (state.sceneRevision === 0
      ? state.scene !== null || state.sceneSavedAt !== null
      : typeof state.scene !== 'string' ||
        !state.scene ||
        typeof state.sceneSavedAt !== 'string' ||
        !Number.isFinite(Date.parse(state.sceneSavedAt))) ||
    !Array.isArray(state.records) ||
    state.records.some(
      (row) =>
        !keys(row, ['key', 'value']) ||
        campaignRecordCharacterId(row.key) === null ||
        typeof row.value !== 'string'
    )
  )
    invalid();
  if (
    value.origin !== null &&
    (!keys(value.origin, ['uid', 'commandId', 'kind', 'generation']) ||
      typeof value.origin.uid !== 'string' ||
      !value.origin.uid ||
      value.origin.uid.length > 128 ||
      !isCloudUUID(value.origin.commandId) ||
      typeof value.origin.kind !== 'string' ||
      !/^[a-z][a-z.-]+$/.test(value.origin.kind) ||
      value.origin.generation !== value.generation)
  )
    invalid();
  model(state);
  return value;
}

function difference(previous, next) {
  if (Object.is(previous, next)) return null;
  if (object(previous) && object(next)) {
    const remove = Object.keys(previous).filter((key) => !Object.hasOwn(next, key));
    const set = [];
    for (const key of Object.keys(next)) {
      const change = Object.hasOwn(previous, key)
        ? difference(previous[key], next[key])
        : { kind: 'replace', value: copy(next[key]) };
      if (change) set.push({ key, change });
    }
    return remove.length || set.length
      ? {
          kind: 'object',
          ...(set.length ? { set } : {}),
          ...(remove.length ? { remove } : {}),
        }
      : null;
  }
  return JSON.stringify(previous) === JSON.stringify(next)
    ? null
    : { kind: 'replace', value: copy(next) };
}

function patched(previous, patch, budget, depth = 0) {
  if (patch === null) return copy(previous);
  if (++budget.nodes > 50000 || depth > 64 || !object(patch)) invalid();
  if (patch.kind === 'replace') {
    if (!keys(patch, ['kind', 'value'])) invalid();
    return copy(patch.value);
  }
  const hasSet = Object.hasOwn(patch, 'set');
  const hasRemove = Object.hasOwn(patch, 'remove');
  const set = hasSet ? patch.set : [];
  const remove = hasRemove ? patch.remove : [];
  if (
    patch.kind !== 'object' ||
    !object(previous) ||
    (!hasSet && !hasRemove) ||
    !keys(patch, ['kind', ...(hasSet ? ['set'] : []), ...(hasRemove ? ['remove'] : [])]) ||
    !Array.isArray(set) ||
    !Array.isArray(remove) ||
    set.length > 10000 ||
    remove.length > 10000 ||
    remove.some((key) => typeof key !== 'string') ||
    new Set(remove).size !== remove.length ||
    set.some((entry) => !keys(entry, ['key', 'change']) || typeof entry.key !== 'string') ||
    new Set(set.map((entry) => entry.key)).size !== set.length
  )
    invalid();
  const next = copy(previous);
  for (const key of remove) {
    if (!Object.hasOwn(next, key) || set.some((entry) => entry.key === key)) invalid();
    delete next[key];
  }
  for (const { key, change } of set)
    Object.defineProperty(next, key, {
      value: patched(Object.hasOwn(next, key) ? next[key] : undefined, change, budget, depth + 1),
      writable: true,
      enumerable: true,
      configurable: true,
    });
  return next;
}

function validatePresentations(previous, next, entries) {
  if (
    !Array.isArray(entries) ||
    entries.length > 256 ||
    new Set(entries.map((entry) => entry?.commandId)).size !== entries.length
  )
    invalid();
  const scene = next.state.scene === null ? null : parse(next.state.scene);
  const maps = new Map(
    (scene?.version === 3 ? scene.maps : scene ? [{ id: 'map-main', grid: scene.grid }] : []).map(
      (map) => [map.id, map]
    )
  );
  for (const entry of entries) {
    if (entry?.kind === 'emote') {
      validatePlayerVisual(entry, maps);
      const actor = scene?.creatures.find((actor) => actor.id === entry.tokenId);
      if (
        !actor ||
        !samePlacement(entry.placement, sceneActorPlacement(scene, actor)) ||
        entry.sceneRevision !== next.state.sceneRevision ||
        entry.sceneRevision <= previous.state.sceneRevision ||
        entry.charactersRevision !== next.state.revision
      )
        invalid();
      continue;
    }
    if (
      !object(entry) ||
      Object.keys(entry).some(
        (field) =>
          ![
            'commandId',
            'tokenId',
            'kind',
            'sceneRevision',
            'charactersRevision',
            'motion',
            'costFeet',
            'budget',
          ].includes(field)
      ) ||
      typeof entry.commandId !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(entry.commandId) ||
      !PLAYER_COMMAND_KINDS.includes(entry.kind) ||
      (entry.costFeet !== undefined && (!Number.isFinite(entry.costFeet) || entry.costFeet < 0)) ||
      entry.sceneRevision !== next.state.sceneRevision ||
      entry.sceneRevision <= previous.state.sceneRevision ||
      entry.charactersRevision !== next.state.revision
    )
      invalid();
    validatePlayerMotion(entry.motion, maps);
    if (entry.budget !== undefined) validateBudget(entry.budget);
    const actor = scene?.creatures.find((actor) => actor.id === entry.tokenId);
    if (!actor || !samePlacement(entry.motion.route.at(-1), sceneActorPlacement(scene, actor)))
      invalid();
  }
}

export function cloudOwnerDelta(previous, next, presentations = []) {
  validateCloudOwnerSnapshot(previous);
  validateCloudOwnerSnapshot(next);
  const delta = {
    version: 1,
    access: copy(next.access),
    sessionId: next.sessionId,
    baseGeneration: previous.generation,
    generation: next.generation,
    origin: copy(next.origin),
    kind: 'update',
    changes: difference(model(previous.state), model(next.state)),
    ...(presentations.length ? { presentations: copy(presentations) } : {}),
  };
  applyCloudOwnerDelta(previous, delta);
  return delta;
}

export function applyCloudOwnerDelta(previous, delta) {
  validateCloudOwnerSnapshot(previous);
  if (
    !keys(delta, [
      'version',
      'access',
      'sessionId',
      'baseGeneration',
      'generation',
      'origin',
      'kind',
      'changes',
      ...(Object.hasOwn(delta || {}, 'presentations') ? ['presentations'] : []),
    ]) ||
    delta.version !== 1 ||
    delta.kind !== 'update' ||
    !isCloudAccessScope(delta.access) ||
    delta.access.role !== 'owner' ||
    !isCloudUUID(delta.sessionId) ||
    !isCloudAccessGeneration(delta.baseGeneration) ||
    !isCloudAccessGeneration(delta.generation)
  )
    invalid();
  const denied = (code) => {
    throw Object.assign(new Error('Reconcile the current owner world checkpoint'), {
      status: 409,
      code,
    });
  };
  if (!sameAccess(previous.access, delta.access)) denied('campaign-access-changed');
  if (previous.sessionId !== delta.sessionId) denied('live-session-changed');
  if (previous.generation !== delta.baseGeneration || delta.generation !== delta.baseGeneration + 1)
    denied('owner-delta-gap');
  const next = {
    version: 1,
    access: copy(delta.access),
    sessionId: delta.sessionId,
    generation: delta.generation,
    origin: copy(delta.origin),
    state: materialize(patched(model(previous.state), delta.changes, { nodes: 0 })),
  };
  validateCloudOwnerSnapshot(next);
  if (Object.hasOwn(delta, 'presentations'))
    validatePresentations(previous, next, delta.presentations);
  return next;
}
