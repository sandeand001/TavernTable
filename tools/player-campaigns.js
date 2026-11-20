const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PublishedMaps } = require('./published-maps.js');
const { isDeepStrictEqual } = require('node:util');
const { prepareAssignedCharacterChange } = require('./assigned-character-change.js');
const { playerUndoFor, rememberPlayerUndo } = require('./player-undo-sessions.js');
const { playerRoomVisitEntries } = require('./player-room-visits.js');
const { reconcileRoomVisits } = require('./room-visit-recovery.js');
const {
  validateMovementPresentations,
  visibleMovementPresentations,
} = require('./movement-presentations.js');

const reject = (message) => Object.assign(new Error(message), { status: 403 });
const copy = (value) => JSON.parse(JSON.stringify(value));
const presentationError = (message) =>
  Object.assign(new Error(message), { status: 422, code: 'invalid-scene-presentation' });

class PlayerCampaigns {
  constructor({ root, store, authority, resources }) {
    this.root = root;
    this.store = store;
    this.authority = authority;
    this.resources = resources;
    this.published = new PublishedMaps(root);
    this.presentations = new Map();
    this.undoSessions = new Map();
    this.authorityContexts = new WeakMap();
    this.liveCampaigns = new Map();
    this.liveProjections = new WeakMap();
  }

  undoFor(profile, state) {
    return playerUndoFor(this.undoSessions, profile, state);
  }

  rememberUndo(profile, update) {
    rememberPlayerUndo(this.undoSessions, profile, update);
  }

  async _modules() {
    return Promise.all([
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignCharacters.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignScene.js')).href),
    ]);
  }

  async _state(session, store = this.store) {
    const profile = this.authority.profile(session);
    if (profile.role !== 'player')
      throw reject('Join with a player invitation to open assigned characters');
    const state = await store.readCharacters(profile.campaignId, { includeRoomVisits: true });
    const catalog = await this.resources.catalog(state.campaign);
    const [{ default: CampaignCharacters }] = await this._modules();
    const library = new CampaignCharacters({ ...state, store, catalog });
    return { profile, state, catalog, library };
  }

  async state(
    session,
    options = {},
    store = this.store,
    undo = null,
    { deferRoomVisits = false } = {}
  ) {
    const { profile, state, library } = await this._state(session, store);
    if (
      options.sinceSceneRevision !== undefined &&
      (!Number.isSafeInteger(options.sinceSceneRevision) || options.sinceSceneRevision < 0)
    )
      throw presentationError('Choose a valid shared scene revision');
    const [{ campaignRecordCharacterId }, { decodeScene }] = await this._modules();
    const scene = state.scene
      ? decodeScene(state.scene, { ruleset: state.campaign.ruleset, library })
      : null;
    const visitedRoomIds = deferRoomVisits
      ? this.authority.visitedRoomIds(session)
      : await reconcileRoomVisits({
          store,
          authority: this.authority,
          session,
          campaignId: profile.campaignId,
          state,
          scene,
        });
    const view = await this.published.view({
      scene,
      library,
      ownedIds: profile.characterIds,
      mapId: options.mapId || null,
      terrainKey: options.terrainKey || null,
      observerTokenId: options.observerTokenId ?? null,
      presentationVersion: options.presentationVersion ?? null,
      assetKey: options.assetKey ?? null,
      placementGrant:
        options.placementGrantId === undefined
          ? null
          : this.authority.placementGrant(session, options.placementGrantId),
      noObserver: Object.hasOwn(options, 'observerTokenId') && options.observerTokenId === null,
    });
    const { playerGameplayState } = await import(
      pathToFileURL(path.join(this.root, 'src', 'campaigns', 'ServerGameplay.js')).href
    );
    const { validatePlayerState } = await import(
      pathToFileURL(path.join(this.root, 'src', 'campaigns', 'PlayerPublicProtocol.js')).href
    );
    const updates = [...(this.presentations.get(profile.campaignId) || [])];
    if (view.view?.tokens.length)
      await store.storage.transaction('readonly', (transaction) => {
        for (const token of view.view.tokens) {
          const latest = transaction.readActorPlayerCommand(
            profile.campaignId,
            token.id,
            state.sceneRevision
          );
          token.visualCommand =
            latest?.receipt.kind === 'emote'
              ? {
                  commandId: latest.commandId,
                  sceneRevision: latest.applied.sceneRevision,
                  actionId: latest.receipt.actionId,
                  animationKey: latest.receipt.animationKey,
                }
              : null;
          const actor = view.publicScene.actors.find((entry) => entry.id === token.id);
          if (actor) actor.visualCommand = token.visualCommand;
          if (actor && latest?.receipt.motion)
            updates.push({
              commandId: latest.commandId,
              tokenId: token.id,
              kind: latest.receipt.kind,
              sceneRevision: latest.applied.sceneRevision,
              charactersRevision: latest.applied.charactersRevision,
              costFeet: latest.receipt.costFeet,
              budget: latest.receipt.budget,
              motion: latest.receipt.motion,
            });
        }
      });
    view.publicScene.updates = await this.visiblePresentations(
      scene,
      library,
      view,
      updates,
      state,
      options.sinceSceneRevision
    );
    const currentProfile = this.authority.profile(session);
    if (
      currentProfile.campaignId !== profile.campaignId ||
      !isDeepStrictEqual(currentProfile.characterIds, profile.characterIds)
    )
      throw reject('Your character assignments changed; refresh and choose an authorized observer');
    const gameplay = playerGameplayState(
      scene,
      library,
      profile.characterIds,
      undo || this.undoFor(profile, state)
    );
    const visible = new Set(
      view.publicScene.actors.filter((actor) => actor.owned).map((actor) => actor.id)
    );
    gameplay.ownedTokens = gameplay.ownedTokens.filter((actor) => visible.has(actor.tokenId));
    if (gameplay.turn && !visible.has(gameplay.turn.tokenId)) gameplay.turn.tokenId = null;
    const snapshot = {
      campaign: state.campaign,
      revision: state.revision,
      records: state.records.filter((row) =>
        profile.characterIds.includes(campaignRecordCharacterId(row.key))
      ),
      scene: null,
      sceneRevision: state.sceneRevision,
      sceneSavedAt: state.sceneSavedAt,
      profile: currentProfile,
      visitedRoomIds,
      gameplay,
      placementGrants: this.authority.placementGrants(session),
      ...view,
    };
    const validated = validatePlayerState(snapshot);
    this.rememberAuthorityContext(session, scene, validated);
    const observer = scene?.creatures.find(({ id }) => id === validated.observerTokenId);
    this.liveProjections.set(session, {
      campaignId: state.campaign.id,
      sceneRevision: state.sceneRevision,
      charactersRevision: state.revision,
      scene: { version: scene?.version, creatures: observer ? [copy(observer)] : [] },
      library: null,
      view: {
        observerTokenId: view.observerTokenId,
        maps: view.maps,
        publicScene: { actors: view.publicScene.actors },
      },
      world: this.published.cachedWorld(scene),
    });
    return validated;
  }

  async publishLivePresentations(session, campaignId, packet) {
    const profile = this.authority.profile(session);
    if (profile.role !== 'dm') throw reject('Only the host may publish live movement');
    if (
      !packet ||
      Object.keys(packet).some(
        (key) => !['sceneRevision', 'charactersRevision', 'presentations'].includes(key)
      ) ||
      !Number.isSafeInteger(packet.sceneRevision) ||
      packet.sceneRevision < 0 ||
      !Number.isSafeInteger(packet.charactersRevision) ||
      packet.charactersRevision < 0 ||
      !Array.isArray(packet.presentations) ||
      !packet.presentations.length ||
      packet.presentations.length > 256
    )
      throw presentationError('Choose valid bounded live movement presentations');
    const state = await this.store.readCharacters(campaignId);
    if (packet.sceneRevision > state.sceneRevision || packet.charactersRevision > state.revision)
      throw Object.assign(new Error('Refresh the live campaign before publishing movement'), {
        status: 409,
        code: 'stale-scene-revision',
      });
    const scene = state.scene ? JSON.parse(state.scene) : null;
    if (!scene || !Array.isArray(scene.creatures))
      throw presentationError('Save the campaign board before publishing live movement');
    const [
      { validateLivePlayerPresentation },
      { samePlacement, sceneActorPlacement },
      { coalesceLiveMovementPresentations },
    ] = await Promise.all([
      import(
        pathToFileURL(path.join(this.root, 'src', 'campaigns', 'PlayerPublicProtocol.js')).href
      ),
      import(
        pathToFileURL(path.join(this.root, 'src', 'scene', 'token-adapter', 'SavedPlacements.js'))
          .href
      ),
      import(
        pathToFileURL(path.join(this.root, 'src', 'campaigns', 'LiveMovementPresentations.js')).href
      ),
    ]);
    const presentations = coalesceLiveMovementPresentations(packet.presentations);
    const same = (left, right) =>
      samePlacement(left, right) && Math.abs(left?.facingAngle - right?.facingAngle) < 1e-6;
    let live = this.liveCampaigns.get(campaignId);
    if (!live) {
      live = { sequence: 0, actors: new Map() };
      this.liveCampaigns.set(campaignId, live);
    }
    for (const entry of presentations) {
      validateLivePlayerPresentation(entry);
      if (entry.kind === 'move' && entry.motion.completed !== false)
        throw presentationError('Host live movement must be provisional and continuable');
      const actor = scene.creatures.find(({ id }) => id === entry.tokenId);
      if (!actor) throw presentationError('Live movement must reference a real campaign actor');
      const canonical = sceneActorPlacement(scene, actor);
      const combatState =
        scene.combat?.states.find(({ tokenId }) => tokenId === entry.tokenId) || null;
      const tracked = live.actors.get(entry.tokenId);
      if (tracked) {
        const endpointActor = {
          ...tracked.baseActor,
          gridX: tracked.endpoint.gridX,
          gridY: tracked.endpoint.gridY,
          facingAngle: tracked.endpoint.facingAngle,
          pose: copy(tracked.endpoint.pose),
          ...(scene.version === 3 ? { mapId: tracked.endpoint.mapId } : {}),
        };
        const matchesBase =
          isDeepStrictEqual(actor, tracked.baseActor) &&
          isDeepStrictEqual(combatState, tracked.baseCombat);
        const matchesEndpoint =
          isDeepStrictEqual(actor, endpointActor) &&
          packet.sceneRevision === state.sceneRevision &&
          packet.charactersRevision === state.revision;
        if (!matchesBase && !matchesEndpoint)
          throw Object.assign(new Error('Refresh the live actor before continuing movement'), {
            status: 409,
            code: 'live-actor-conflict',
          });
        if (matchesEndpoint) {
          tracked.baseActor = copy(actor);
          tracked.baseCombat = copy(combatState);
          tracked.base = canonical;
        }
      }
      const expected = tracked?.endpoint || canonical;
      if (entry.kind === 'move') {
        if (!same(entry.motion.from, expected))
          throw Object.assign(new Error('Refresh the live actor before continuing movement'), {
            status: 409,
            code: 'live-actor-conflict',
          });
        live.actors.set(entry.tokenId, {
          base: tracked?.base || canonical,
          baseActor: tracked?.baseActor || copy(actor),
          baseCombat: tracked ? copy(tracked.baseCombat) : copy(combatState),
          endpoint: entry.motion.route.at(-1),
        });
      } else {
        if (!tracked || !same(entry.placement, tracked.endpoint))
          throw presentationError('Live movement must finish at its last published pose');
      }
    }
    live.sequence++;
    return {
      version: 1,
      campaignId,
      sequence: live.sequence,
      presentations: copy(presentations),
    };
  }

  async visibleLivePresentations(session, campaignId, presentations) {
    const profile = this.authority.profile(session);
    if (profile.role !== 'player' || profile.campaignId !== campaignId) return [];
    const projection = this.liveProjections.get(session);
    if (!projection || projection.campaignId !== campaignId || !projection.view.observerTokenId)
      return [];
    if (!projection.world)
      throw presentationError('The player live projection lost its authorized world');
    const visible = [];
    for (const entry of presentations) {
      const actor = projection.view.publicScene.actors.find(({ id }) => id === entry.tokenId);
      if (!actor) continue;
      const endpoint = entry.kind === 'move' ? entry.motion.route.at(-1) : entry.placement;
      const view = {
        ...projection.view,
        publicScene: {
          ...projection.view.publicScene,
          actors: projection.view.publicScene.actors.map((current) =>
            current.id === entry.tokenId ? { ...current, ...copy(endpoint) } : current
          ),
        },
      };
      const synthetic =
        entry.kind === 'move'
          ? entry
          : {
              ...entry,
              kind: 'move',
              motion: {
                kind: 'walk',
                completed: true,
                from: copy(endpoint),
                route: [copy(endpoint)],
              },
            };
      const updates = await visibleMovementPresentations({
        root: this.root,
        scene: projection.scene,
        library: projection.library,
        view,
        updates: [
          {
            ...copy(synthetic),
            sceneRevision: projection.sceneRevision,
            charactersRevision: projection.charactersRevision,
          },
        ],
        state: {
          sceneRevision: projection.sceneRevision,
          revision: projection.charactersRevision,
        },
        previousView: view,
        world: projection.world,
      });
      if (updates.length) visible.push(copy(entry));
    }
    return visible;
  }

  rememberAuthorityContext(session, scene, state) {
    if (state.observerTokenId === null) return;
    let contexts = this.authorityContexts.get(session);
    if (!contexts) {
      contexts = new Map();
      this.authorityContexts.set(session, contexts);
    }
    const key = [
      state.campaign.id,
      state.sceneRevision,
      state.revision,
      state.observerTokenId,
    ].join(':');
    contexts.set(
      key,
      copy({
        campaignId: state.campaign.id,
        characterIds: state.profile.characterIds,
        observerTokenId: state.observerTokenId,
        actor: scene.creatures.find(({ id }) => id === state.observerTokenId) || null,
        owned:
          state.gameplay.ownedTokens.find(({ tokenId }) => tokenId === state.observerTokenId) ||
          null,
        turn: state.gameplay.turn,
      })
    );
    while (contexts.size > 32) contexts.delete(contexts.keys().next().value);
  }

  canRebaseCommand(session, campaignId, command, scene, gameplay, profile) {
    const contexts = this.authorityContexts.get(session);
    const baseline = contexts?.get(
      [campaignId, command.sceneRevision, command.charactersRevision, command.observerTokenId].join(
        ':'
      )
    );
    if (
      !baseline ||
      baseline.campaignId !== campaignId ||
      baseline.observerTokenId !== command.observerTokenId ||
      command.tokenId !== command.observerTokenId
    )
      return false;
    const actor = scene.creatures.find(({ id }) => id === command.observerTokenId) || null;
    const owned =
      gameplay.ownedTokens.find(({ tokenId }) => tokenId === command.observerTokenId) || null;
    return (
      isDeepStrictEqual(baseline.characterIds, profile.characterIds) &&
      isDeepStrictEqual(baseline.actor, actor) &&
      isDeepStrictEqual(baseline.owned, owned) &&
      isDeepStrictEqual(baseline.turn, gameplay.turn)
    );
  }

  async validatePresentations(
    campaignId,
    presentations,
    sceneValue,
    sceneRevision,
    charactersRevision
  ) {
    if (
      !Number.isSafeInteger(sceneRevision) ||
      sceneRevision < 0 ||
      !Number.isSafeInteger(charactersRevision) ||
      charactersRevision < 0 ||
      !Array.isArray(presentations) ||
      presentations.length > 256 ||
      new Set(presentations.map((entry) => entry?.commandId)).size !== presentations.length
    )
      throw presentationError('Shared scene presentations must be a bounded, unique list');
    let scene;
    try {
      scene = JSON.parse(sceneValue);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw Object.assign(presentationError('Shared movement requires a valid scene snapshot'), {
        cause: error,
      });
    }
    if (
      !scene ||
      !Array.isArray(scene.creatures) ||
      (scene.version === 3 && !Array.isArray(scene.maps))
    )
      throw presentationError('Shared movement requires a valid scene snapshot');
    const before = await this.store.readScene(campaignId);
    if (before.revision !== sceneRevision)
      throw Object.assign(new Error('Refresh the shared scene before publishing movement'), {
        status: 409,
        code: 'stale-scene-revision',
      });
    const previous = before.scene ? JSON.parse(before.scene) : null;
    await validateMovementPresentations({ root: this.root, previous, scene, presentations });
  }

  rememberPresentations(campaignId, presentations, revisions) {
    if (!presentations.length) return [];
    const updates = presentations.map((entry) => ({ ...copy(entry), ...revisions }));
    this.presentations.set(
      campaignId,
      [...(this.presentations.get(campaignId) || []), ...updates].slice(-256)
    );
    return updates;
  }

  async visiblePresentations(scene, library, view, updates, state, sinceSceneRevision) {
    return visibleMovementPresentations({
      root: this.root,
      scene,
      library,
      view,
      updates,
      state,
      sinceSceneRevision,
    });
  }

  async doorState(session, campaignId, command) {
    const profile = this.authority.profile(session);
    if (profile.role === 'player' && campaignId !== profile.campaignId)
      throw reject('This campaign is not assigned to the player');
    if (
      !command ||
      typeof command.doorId !== 'string' ||
      !Number.isSafeInteger(command.sceneRevision) ||
      command.sceneRevision < 0 ||
      Object.keys(command).some(
        (key) => !['doorId', 'sceneRevision', 'observerTokenId', 'open', 'locked'].includes(key)
      ) ||
      !['open', 'locked'].some((key) => Object.hasOwn(command, key)) ||
      ['open', 'locked'].some(
        (key) => Object.hasOwn(command, key) && typeof command[key] !== 'boolean'
      )
    )
      throw new Error('A door command needs its current scene revision and boolean state');
    if (profile.role === 'player' && Object.hasOwn(command, 'locked'))
      throw reject('Only the DM can lock or unlock doors');
    const state = await this.store.readCharacters(campaignId);
    if (!state.scene) throw new Error('Save the campaign board before changing a door');
    if (state.sceneRevision !== command.sceneRevision)
      throw Object.assign(new Error('The door or board changed. Refresh the view and retry.'), {
        status: 409,
      });
    const catalog = await this.resources.catalog(state.campaign);
    const [{ default: CampaignCharacters }, { decodeScene, encodeScene }] = await this._modules();
    const library = new CampaignCharacters({ ...state, store: this.store, catalog });
    const context = { ruleset: state.campaign.ruleset, library };
    const scene = decodeScene(state.scene, context);
    const [{ default: CampaignWorld }, { playerDoorState }] = await Promise.all([
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignWorld.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'ServerGameplay.js')).href),
    ]);
    let changed;
    let changedScene;
    if (profile.role === 'player') {
      if (typeof command.observerTokenId !== 'string')
        throw reject('Choose your active assigned character before using a door');
      const result = playerDoorState(scene, library, profile.characterIds, command);
      changed = result.door;
      changedScene = result.scene;
    } else {
      const world = CampaignWorld.fromScene(scene, context);
      const door = world.getConnections().find((entry) => entry.id === command.doorId);
      if (!door || door.kind !== 'door') throw new Error('The campaign door no longer exists');
      changed = world.setDoorState(
        door.id,
        Object.fromEntries(
          ['open', 'locked']
            .filter((key) => Object.hasOwn(command, key))
            .map((key) => [key, command[key]])
        )
      );
      changedScene = world.save();
    }
    const receipt = await this.store.commitScene(campaignId, {
      ruleset: state.campaign.ruleset,
      revision: state.sceneRevision,
      charactersRevision: state.revision,
      scene: encodeScene(changedScene, context),
      roomVisits: playerRoomVisitEntries(changedScene),
    });
    return { ...receipt, door: changed };
  }

  async commit(session, campaignId, change) {
    const { default: CampaignStore } = await import(
      pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignStore.js')).href
    );
    return this.store.storage.transaction('readwrite', async (transaction) => {
      const profile = this.authority.profile(session);
      const store = new CampaignStore({
        packs: [...this.store.packs.values()],
        storage: { transaction: (_mode, operation) => operation(transaction) },
      });
      const result = await this._commit(session, campaignId, change, store);
      const current = this.authority.profile(session);
      if (
        current.campaignId !== profile.campaignId ||
        !isDeepStrictEqual(current.characterIds, profile.characterIds)
      )
        throw reject('Your character assignments changed; refresh before editing');
      return result;
    });
  }

  async _commit(session, campaignId, change, store) {
    const { profile, state, library } = await this._state(session, store);
    if (campaignId !== profile.campaignId)
      throw reject('This campaign is not assigned to the player');
    return store.commitCharacters(
      campaignId,
      prepareAssignedCharacterChange({ state, library, characterIds: profile.characterIds, change })
    );
  }
}

module.exports = { PlayerCampaigns };
