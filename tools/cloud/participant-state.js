const path = require('node:path');
const { setImmediate: yieldToIO } = require('node:timers/promises');
const {
  default: CampaignCharacters,
  campaignRecordCharacterId,
} = require('../../src/campaigns/CampaignCharacters.js');
const { decodeScene } = require('../../src/campaigns/CampaignScene.js');
const { default: CampaignWorld } = require('../../src/campaigns/CampaignWorld.js');
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

const sources = new WeakMap();
const predecessors = new WeakMap();
let projectionTail = Promise.resolve();

function reuseParticipantGeometry(state, previous) {
  const source = sources.get(previous);
  if (
    source?.world &&
    source.campaignId === state.campaign.id &&
    source.ruleset === state.campaign.ruleset
  )
    predecessors.set(state, {
      campaignId: source.campaignId,
      ruleset: source.ruleset,
      world: source.world,
    });
}

function projectionSource(state, catalog, campaign) {
  const fingerprint = stableStringify(state);
  const cached = sources.get(state);
  if (
    cached?.fingerprint === fingerprint &&
    cached.catalog === catalog &&
    cached.ruleset === campaign.ruleset
  )
    return cached;
  const library = new CampaignCharacters({ ...state, catalog });
  const scene = state.scene
    ? decodeScene(state.scene, { library, ruleset: campaign.ruleset })
    : null;
  const previous = predecessors.get(state) ?? cached;
  const context = { ruleset: campaign.ruleset, library };
  const world = scene
    ? previous?.world &&
      previous.campaignId === state.campaign.id &&
      previous.ruleset === campaign.ruleset
      ? previous.world.forkQuery(scene, context)
      : CampaignWorld.fromScene(scene, context)
    : null;
  const source = {
    fingerprint,
    catalog,
    ruleset: campaign.ruleset,
    campaignId: state.campaign.id,
    library,
    scene,
    world,
    published: new PublishedMaps(path.resolve(__dirname, '..', '..'), world),
    views: new Map(),
  };
  predecessors.delete(state);
  sources.set(state, source);
  return source;
}

function participantState(input) {
  const project = async () => {
    await yieldToIO();
    return projectParticipantState(input);
  };
  const task = projectionTail.then(project, project);
  projectionTail = task;
  return task;
}

async function projectParticipantState({
  state,
  catalog,
  campaign,
  characterIds,
  options,
  images,
  undo,
  placementGrants = [],
  visitedRoomIds = [],
}) {
  const { library, scene, world, published, views } = projectionSource(state, catalog, campaign);
  const known = new Set(library.list().map((character) => character.id));
  if (characterIds.some((id) => !known.has(id)))
    throw new CloudError(
      503,
      'invalid-campaign-membership',
      'Current assigned character data could not be verified'
    );
  const grant =
    options.placementGrantId === undefined
      ? null
      : placementGrants.find((entry) => entry.id === options.placementGrantId);
  if (options.placementGrantId !== undefined && !grant)
    throw new CloudError(
      403,
      'placement-forbidden',
      'This arrival grant is not currently assigned to the player'
    );
  if (grant && options.mapId !== null && options.mapId !== grant.mapId)
    throw new CloudError(
      403,
      'placement-forbidden',
      'Use only the explicitly granted arrival area'
    );
  const placed = grant && scene?.creatures.find((entry) => entry.characterId === grant.characterId);
  const observerTokenId = placed ? placed.id : options.observerTokenId;
  const mapId = placed ? (scene.version === 3 ? placed.mapId : 'map-main') : options.mapId;
  const arrival = grant && !placed ? { grantId: grant.id, mapId: grant.mapId } : null;
  if (
    observerTokenId !== null &&
    !scene?.creatures.some(
      (actor) => actor.id === observerTokenId && characterIds.includes(actor.characterId)
    )
  )
    throw new CloudError(
      403,
      'participant-view-forbidden',
      'Choose a currently assigned real creature before viewing the world'
    );
  const viewOptions = {
    scene,
    library,
    ownedIds: characterIds,
    observerTokenId,
    mapId,
    presentationVersion: 1,
    placementGrant: arrival ? grant : null,
    noObserver: observerTokenId === null,
  };
  const viewKey = stableStringify([characterIds, observerTokenId, mapId, arrival ? grant : null]);
  let pendingView = views.get(viewKey);
  if (!pendingView) {
    pendingView = published.view(viewOptions);
    if (views.size >= 32) views.delete(views.keys().next().value);
    views.set(viewKey, pendingView);
    void pendingView.catch(() => {
      if (views.get(viewKey) === pendingView) views.delete(viewKey);
    });
  }
  const view = await pendingView;
  const render = arrival
    ? {
        version: 1,
        assetKey: view.view.presentation.assetKey,
        assets: view.view.presentation.assets,
        presentation: { mapId: grant.mapId, focusTokenId: null },
        actors: [],
        updates: [],
      }
    : view.publicScene;
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
  const actors = render.actors.map((actor) => {
    const characterId = scene.creatures.find((creature) => creature.id === actor.id).characterId;
    imageSlot('actor', actor.id, characterId, 'portraitImage');
    return { ...actor, portraitImage: null };
  });
  const visible = new Set(actors.filter((actor) => actor.owned).map((actor) => actor.id));
  const gameplay = playerGameplayState(scene, library, characterIds, undo, {
    visibleIds: visible,
    world: world ?? undefined,
    observerSight: {
      tokenId: view.observerTokenId,
      tokenIds: new Set(actors.map((actor) => actor.id)),
    },
  });
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
    maps: (arrival ? render.assets.maps : view.maps).map(({ id, name }) => ({ id, name })),
    location: view.location ? { id: view.location.id, name: view.location.name } : null,
    doors: view.doors || [],
    gameplay,
    ...(placementGrants.length ? { placementGrants: structuredClone(placementGrants) } : {}),
    ...(visitedRoomIds.length ? { visitedRoomIds: [...visitedRoomIds] } : {}),
    ...(arrival ? { arrival } : {}),
    publicScene: {
      ...render,
      assets: render.assetKey === options.assetKey ? null : render.assets,
      actors,
    },
  };
  validatePlayerState(result, { cachedAssets: render.assets });
  return { state: result, imageSlots: slots, assets: render.assets };
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
    same(previous.state.placementGrants ?? null, current.state.placementGrants ?? null) &&
    same(previous.state.arrival ?? null, current.state.arrival ?? null) &&
    same(previous.state.visitedRoomIds ?? null, current.state.visitedRoomIds ?? null) &&
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

module.exports = { participantState, participantDelta, reuseParticipantGeometry };
