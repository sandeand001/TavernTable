const path = require('node:path');
const {
  default: CampaignCharacters,
  campaignRecordCharacterId,
} = require('../../src/campaigns/CampaignCharacters.js');
const { decodeScene } = require('../../src/campaigns/CampaignScene.js');
const { playerGameplayState } = require('../../src/campaigns/ServerGameplay.js');
const { validatePlayerState } = require('../../src/campaigns/PlayerPublicProtocol.js');
const { CHARACTER_IMAGE_FIELDS } = require('../../src/config/characters/CharacterImages.js');
const { PublishedMaps } = require('../published-maps.js');
const { CloudError } = require('./cloud-error.js');
const stableStringify = require('fast-json-stable-stringify');
const {
  validateCloudParticipantSnapshot,
  applyCloudParticipantDelta,
} = require('../../src/campaigns/CloudParticipantProtocol.js');

async function participantState({ state, catalog, campaign, characterIds, options, images }) {
  const library = new CampaignCharacters({ ...state, catalog });
  const known = new Set(library.list().map((character) => character.id));
  if (characterIds.some((id) => !known.has(id)))
    throw new CloudError(
      503,
      'invalid-campaign-membership',
      'Current assigned character data could not be verified'
    );
  const scene = state.scene
    ? decodeScene(state.scene, { library, ruleset: campaign.ruleset })
    : null;
  if (
    options.observerTokenId !== null &&
    !scene?.creatures.some(
      (actor) => actor.id === options.observerTokenId && characterIds.includes(actor.characterId)
    )
  )
    throw new CloudError(
      403,
      'participant-view-forbidden',
      'Choose a currently assigned real creature before viewing the world'
    );
  const published = new PublishedMaps(path.resolve(__dirname, '..', '..'));
  const view = await published.view({
    scene,
    library,
    ownedIds: characterIds,
    observerTokenId: options.observerTokenId,
    mapId: options.mapId,
    presentationVersion: 1,
    noObserver: options.observerTokenId === null,
  });
  const imageEntries = new Map(
    images.map((image) => [image.characterId + ':' + image.field, image])
  );
  const slots = [];
  const imageSlot = (source, id, characterId, field) => {
    const image = imageEntries.get(characterId + ':' + field);
    if (image)
      slots.push({
        source,
        id,
        field,
        sha256: image.sha256,
        mimeType: image.mimeType,
      });
  };
  const records = state.records
    .filter((record) => characterIds.includes(campaignRecordCharacterId(record.key)))
    .map(({ key, value }) => {
      const characterId = campaignRecordCharacterId(key);
      if (key !== `taverntable.character.v1.${characterId}`) return { key, value };
      const character = JSON.parse(value);
      for (const field of CHARACTER_IMAGE_FIELDS) {
        imageSlot('character', characterId, characterId, field);
        delete character[field];
      }
      return { key, value: JSON.stringify(character) };
    });
  const actors = view.publicScene.actors.map((actor) => {
    const characterId = scene.creatures.find((creature) => creature.id === actor.id).characterId;
    imageSlot('actor', actor.id, characterId, 'portraitImage');
    return { ...actor, portraitImage: null };
  });
  const visible = new Set(actors.filter((actor) => actor.owned).map((actor) => actor.id));
  const gameplay = playerGameplayState(scene, library, characterIds);
  gameplay.ownedTokens = gameplay.ownedTokens.filter((actor) => visible.has(actor.tokenId));
  if (gameplay.turn && !visible.has(gameplay.turn.tokenId)) gameplay.turn.tokenId = null;
  const result = {
    campaign,
    revision: state.revision,
    records,
    scene: null,
    sceneRevision: state.sceneRevision,
    sceneSavedAt: state.sceneSavedAt,
    characterIds: [...characterIds],
    observerTokenId: view.observerTokenId,
    observers: view.observers.map(({ id, name, characterId }) => ({ id, name, characterId })),
    maps: view.maps.map(({ id, name }) => ({ id, name })),
    location: view.location ? { id: view.location.id, name: view.location.name } : null,
    doors: view.doors || [],
    gameplay,
    publicScene: {
      ...view.publicScene,
      assets: view.publicScene.assetKey === options.assetKey ? null : view.publicScene.assets,
      actors,
    },
  };
  validatePlayerState(result, { cachedAssets: view.publicScene.assets });
  return { state: result, imageSlots: slots, assets: view.publicScene.assets };
}

function participantDelta(previous, current, { cachedAssets = null } = {}) {
  const assets = previous?.state?.publicScene?.assets || cachedAssets;
  validateCloudParticipantSnapshot(previous, { cachedAssets });
  validateCloudParticipantSnapshot(current, {
    cachedAssets:
      current?.state?.publicScene?.assetKey === previous.state.publicScene.assetKey ? assets : null,
  });
  if (stableStringify(previous.access) !== stableStringify(current.access))
    throw new CloudError(409, 'campaign-access-changed', 'Refresh current participant access');
  if (previous.sessionId !== current.sessionId)
    throw new CloudError(409, 'live-session-changed', 'Reconnect to the current live game');
  if (current.generation === previous.generation) {
    const comparable = (value) => ({
      ...value,
      state: { ...value.state, publicScene: { ...value.state.publicScene, assets: null } },
    });
    if (stableStringify(comparable(previous)) === stableStringify(comparable(current))) return null;
  }
  if (current.generation !== previous.generation + 1)
    throw new CloudError(409, 'participant-delta-gap', 'A fresh authorized checkpoint is required');
  const common = {
    version: 1,
    access: structuredClone(current.access),
    sessionId: current.sessionId,
    baseGeneration: previous.generation,
    generation: current.generation,
    viewKey: current.viewKey,
  };
  const same = (left, right) => stableStringify(left) === stableStringify(right);
  const sameView =
    previous.viewKey === current.viewKey &&
    previous.state.publicScene.assetKey === current.state.publicScene.assetKey &&
    same(previous.state.publicScene.presentation, current.state.publicScene.presentation) &&
    same(previous.state.characterIds, current.state.characterIds) &&
    same(previous.state.maps, current.state.maps) &&
    same(previous.state.location, current.state.location) &&
    same(previous.manifest, current.manifest);
  let delta;
  if (!sameView) {
    delta = { ...common, kind: 'replace', checkpoint: structuredClone(current) };
  } else {
    const keyed = (before, after, field) => {
      const old = new Map(before.map((entry) => [entry[field], entry]));
      const next = new Map(after.map((entry) => [entry[field], entry]));
      return {
        upserts: after
          .filter((entry) => !same(old.get(entry[field]), entry))
          .map((entry) => structuredClone(entry)),
        removes: [...old.keys()].filter((id) => !next.has(id)),
      };
    };
    delta = {
      ...common,
      kind: 'update',
      changes: {
        campaign: structuredClone(current.state.campaign),
        revision: current.state.revision,
        sceneRevision: current.state.sceneRevision,
        sceneSavedAt: current.state.sceneSavedAt,
        actors: keyed(previous.state.publicScene.actors, current.state.publicScene.actors, 'id'),
        records: keyed(previous.state.records, current.state.records, 'key'),
        observers: same(previous.state.observers, current.state.observers)
          ? null
          : structuredClone(current.state.observers),
        doors: same(previous.state.doors, current.state.doors)
          ? null
          : structuredClone(current.state.doors),
        gameplay: same(previous.state.gameplay, current.state.gameplay)
          ? null
          : structuredClone(current.state.gameplay),
      },
    };
  }
  applyCloudParticipantDelta(previous, delta, { cachedAssets: assets });
  return delta;
}

module.exports = { participantState, participantDelta };
