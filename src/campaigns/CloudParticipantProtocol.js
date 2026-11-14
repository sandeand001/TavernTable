import {
  isCloudAccessScope,
  isCloudAccessGeneration,
  isCloudAssetReference,
  isCloudAssignedCharacterState,
  isCloudDigest,
  isCloudUUID,
} from './CloudProtocol.js';
import { campaignRecordCharacterId } from './CampaignCharacters.js';
import { validatePlayerState } from './PlayerPublicProtocol.js';
import { CHARACTER_IMAGE_FIELDS } from '../config/characters/CharacterImages.js';

const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const keys = (value, names) =>
  object(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
const id = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);
const invalid = () => {
  throw Object.assign(new Error('The authorized participant checkpoint could not be verified'), {
    code: 'invalid-cloud-participant',
  });
};

export function validateCloudParticipantSnapshot(value, { cachedAssets = null } = {}) {
  if (
    !keys(value, [
      'version',
      'access',
      'sessionId',
      'generation',
      'viewKey',
      'state',
      'manifest',
    ]) ||
    value.version !== 1 ||
    !isCloudAccessScope(value.access) ||
    value.access.role !== 'member' ||
    !isCloudUUID(value.sessionId) ||
    !isCloudAccessGeneration(value.generation) ||
    !isCloudDigest(value.viewKey) ||
    !keys(value.state, [
      'campaign',
      'revision',
      'records',
      'scene',
      'sceneRevision',
      'sceneSavedAt',
      'characterIds',
      'observerTokenId',
      'observers',
      'maps',
      'location',
      'doors',
      'gameplay',
      'publicScene',
    ])
  )
    invalid();
  const state = value.state;
  if (
    !isCloudAssignedCharacterState({
      version: 1,
      access: value.access,
      characterIds: state.characterIds,
      campaign: state.campaign,
      revision: state.revision,
      records: state.records,
      scene: state.scene,
      sceneRevision: state.sceneRevision,
      sceneSavedAt: state.sceneSavedAt,
    }) ||
    state.revision !== state.campaign.charactersRevision ||
    state.sceneRevision !== state.campaign.sceneRevision ||
    state.sceneSavedAt !== state.campaign.sceneSavedAt ||
    !Array.isArray(state.observers) ||
    state.observers.some(
      (observer) =>
        !keys(observer, ['id', 'name', 'characterId']) ||
        !id(observer.id) ||
        typeof observer.name !== 'string' ||
        !state.characterIds.includes(observer.characterId)
    ) ||
    new Set(state.observers.map((observer) => observer.id)).size !== state.observers.length ||
    !Array.isArray(state.maps) ||
    state.maps.some(
      (map) => !keys(map, ['id', 'name']) || !id(map.id) || typeof map.name !== 'string'
    ) ||
    new Set(state.maps.map((map) => map.id)).size !== state.maps.length ||
    !(
      state.location === null ||
      (keys(state.location, ['id', 'name']) &&
        id(state.location.id) &&
        typeof state.location.name === 'string')
    )
  )
    invalid();
  const roots = new Set();
  for (const row of state.records) {
    const characterId = campaignRecordCharacterId(row.key);
    if (!state.characterIds.includes(characterId)) invalid();
    if (row.key !== `taverntable.character.v1.${characterId}`) continue;
    let character;
    try {
      character = JSON.parse(row.value);
    } catch (error) {
      if (error instanceof SyntaxError) invalid();
      throw error;
    }
    if (
      !object(character) ||
      character.id !== characterId ||
      CHARACTER_IMAGE_FIELDS.some(
        (field) => character[field] !== undefined && character[field] !== null
      )
    )
      invalid();
    roots.add(characterId);
  }
  if (state.characterIds.some((characterId) => !roots.has(characterId))) invalid();
  validatePlayerState(state, {
    cachedAssets: state.publicScene?.assetKey === null ? null : cachedAssets,
  });
  const assets =
    state.publicScene.assetKey === null ? null : state.publicScene.assets || cachedAssets;
  if (
    state.publicScene.updates.length ||
    (state.observerTokenId !== null && !assets) ||
    (state.observerTokenId === null &&
      (state.maps.length || state.location !== null || state.gameplay.ownedTokens.length)) ||
    state.publicScene.actors.some(
      (actor) =>
        actor.portraitImage !== null ||
        (actor.owned && !state.characterIds.includes(actor.characterId))
    )
  )
    invalid();
  const actors = new Map(state.publicScene.actors.map((actor) => [actor.id, actor]));
  if (
    state.gameplay.ownedTokens.some((token) => !actors.get(token.tokenId)?.owned) ||
    (assets &&
      (state.maps.some(
        (map) => !assets.maps.some((visible) => visible.id === map.id && visible.name === map.name)
      ) ||
        !state.location ||
        state.location.id !== assets.location.id ||
        state.location.name !== assets.location.name))
  )
    invalid();
  if (
    !keys(value.manifest, ['version', 'images']) ||
    value.manifest.version !== 1 ||
    !Array.isArray(value.manifest.images)
  )
    invalid();
  const slots = new Set();
  for (const slot of value.manifest.images) {
    if (
      !keys(slot, ['source', 'id', 'field', 'reference']) ||
      !id(slot.id) ||
      !isCloudAssetReference(slot.reference, value.access.campaignId) ||
      (slot.source === 'character'
        ? !state.characterIds.includes(slot.id) || !CHARACTER_IMAGE_FIELDS.includes(slot.field)
        : slot.source !== 'actor' || !actors.has(slot.id) || slot.field !== 'portraitImage')
    )
      invalid();
    const key = slot.source + ':' + slot.id + ':' + slot.field;
    if (slots.has(key)) invalid();
    slots.add(key);
  }
  return value;
}

const sameAccess = (left, right) =>
  ['version', 'uid', 'campaignId', 'role', 'seatId', 'accessGeneration'].every(
    (field) => left[field] === right[field]
  );
const deltaFailure = (code) => {
  throw Object.assign(new Error('Refresh the current authorized participant checkpoint'), {
    code,
    status: 409,
  });
};

function applyKeyed(values, patch, field) {
  if (
    !keys(patch, ['upserts', 'removes']) ||
    !Array.isArray(patch.upserts) ||
    patch.upserts.length > 10000 ||
    !Array.isArray(patch.removes) ||
    patch.removes.length > 10000 ||
    patch.removes.some((entry) => typeof entry !== 'string') ||
    new Set(patch.removes).size !== patch.removes.length ||
    patch.upserts.some((entry) => !object(entry) || typeof entry[field] !== 'string') ||
    new Set(patch.upserts.map((entry) => entry[field])).size !== patch.upserts.length
  )
    invalid();
  const result = new Map(values.map((entry) => [entry[field], structuredClone(entry)]));
  for (const id of patch.removes) {
    if (!result.delete(id) || patch.upserts.some((entry) => entry[field] === id)) invalid();
  }
  for (const entry of patch.upserts) result.set(entry[field], structuredClone(entry));
  return [...result.values()];
}

export function applyCloudParticipantDelta(previous, delta, { cachedAssets = null } = {}) {
  validateCloudParticipantSnapshot(previous, { cachedAssets });
  if (
    !object(delta) ||
    !['update', 'replace'].includes(delta.kind) ||
    !keys(delta, [
      'version',
      'access',
      'sessionId',
      'baseGeneration',
      'generation',
      'viewKey',
      'kind',
      delta.kind === 'replace' ? 'checkpoint' : 'changes',
      ...(Object.hasOwn(delta, 'presentations') ? ['presentations'] : []),
    ]) ||
    delta.version !== 1 ||
    !isCloudAccessScope(delta.access) ||
    !isCloudUUID(delta.sessionId) ||
    !isCloudDigest(delta.viewKey) ||
    !isCloudAccessGeneration(delta.baseGeneration) ||
    !isCloudAccessGeneration(delta.generation)
  )
    invalid();
  if (!sameAccess(previous.access, delta.access)) deltaFailure('campaign-access-changed');
  if (previous.sessionId !== delta.sessionId) deltaFailure('live-session-changed');
  if (previous.generation !== delta.baseGeneration || delta.generation !== delta.baseGeneration + 1)
    deltaFailure('participant-delta-gap');
  const assets = previous.state.publicScene.assets || cachedAssets;
  if (delta.kind === 'replace') {
    if (Object.hasOwn(delta, 'presentations')) invalid();
    const next = delta.checkpoint;
    validateCloudParticipantSnapshot(next, {
      cachedAssets:
        next?.state?.publicScene?.assetKey === previous.state.publicScene.assetKey ? assets : null,
    });
    if (
      !sameAccess(next.access, delta.access) ||
      next.sessionId !== delta.sessionId ||
      next.generation !== delta.generation ||
      next.viewKey !== delta.viewKey
    )
      invalid();
    return structuredClone(next);
  }
  if (delta.viewKey !== previous.viewKey) deltaFailure('participant-view-changed');
  const changes = delta.changes;
  if (
    !keys(changes, [
      'campaign',
      'revision',
      'sceneRevision',
      'sceneSavedAt',
      'actors',
      'records',
      'observers',
      'doors',
      'gameplay',
    ])
  )
    invalid();
  const next = structuredClone(previous);
  next.generation = delta.generation;
  for (const field of ['campaign', 'revision', 'sceneRevision', 'sceneSavedAt'])
    next.state[field] = structuredClone(changes[field]);
  next.state.records = applyKeyed(previous.state.records, changes.records, 'key');
  next.state.publicScene.actors = applyKeyed(
    previous.state.publicScene.actors,
    changes.actors,
    'id'
  );
  const priorActors = new Set(previous.state.publicScene.actors.map((actor) => actor.id));
  if (
    next.state.publicScene.actors.length !== priorActors.size ||
    next.state.publicScene.actors.some((actor) => !priorActors.has(actor.id))
  )
    deltaFailure('participant-view-changed');
  for (const field of ['observers', 'doors', 'gameplay'])
    if (changes[field] !== null) next.state[field] = structuredClone(changes[field]);
  validateCloudParticipantSnapshot(next, { cachedAssets: assets });
  if (Object.hasOwn(delta, 'presentations')) {
    const entries = delta.presentations;
    if (
      !Array.isArray(entries) ||
      entries.length > 256 ||
      new Set(entries.map((entry) => entry?.commandId)).size !== entries.length ||
      entries.some(
        (entry) =>
          !object(entry) ||
          entry.sceneRevision !== next.state.sceneRevision ||
          entry.charactersRevision !== next.state.revision ||
          entry.sceneRevision <= previous.state.sceneRevision
      )
    )
      invalid();
    validatePlayerState(
      {
        ...next.state,
        publicScene: { ...next.state.publicScene, updates: entries },
      },
      { cachedAssets: assets }
    );
  }
  return next;
}
