const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PublishedMaps } = require('./published-maps.js');
const { isDeepStrictEqual } = require('node:util');

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
    const state = await store.readCharacters(profile.campaignId);
    const catalog = await this.resources.catalog(state.campaign);
    const [{ default: CampaignCharacters }] = await this._modules();
    const library = new CampaignCharacters({ ...state, store, catalog });
    return { profile, state, catalog, library };
  }

  async state(session, options = {}, store = this.store) {
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
    if (scene) this.authority.recordRoomVisits(profile.campaignId, scene);
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
    const gameplay = playerGameplayState(scene, library, profile.characterIds);
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
      visitedRoomIds: this.authority.visitedRoomIds(session),
      gameplay,
      placementGrants: this.authority.placementGrants(session),
      ...view,
    };
    return validatePlayerState(snapshot);
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
    const [{ validatePlayerMotion }, { samePlacement, sceneActorPlacement }] = await Promise.all([
      import(
        pathToFileURL(path.join(this.root, 'src', 'campaigns', 'PlayerPublicProtocol.js')).href
      ),
      import(
        pathToFileURL(path.join(this.root, 'src', 'scene', 'token-adapter', 'SavedPlacements.js'))
          .href
      ),
    ]);
    const currentMaps = new Map(this.published.maps(scene).map((map) => [map.id, map]));
    const previousMaps = new Map(this.published.maps(previous).map((map) => [map.id, map]));
    const maps = new Map(previousMaps);
    for (const [id, map] of currentMaps) {
      const old = maps.get(id);
      if (!map.grid || !Number.isSafeInteger(map.grid.cols) || !Number.isSafeInteger(map.grid.rows))
        throw presentationError('Shared movement requires valid map dimensions');
      maps.set(id, {
        ...map,
        grid: {
          ...map.grid,
          cols: Math.max(map.grid.cols, old?.grid.cols ?? 0),
          rows: Math.max(map.grid.rows, old?.grid.rows ?? 0),
        },
      });
    }
    for (const entry of presentations) {
      if (
        !entry ||
        Object.keys(entry).some(
          (key) => !['commandId', 'tokenId', 'kind', 'motion'].includes(key)
        ) ||
        typeof entry.commandId !== 'string' ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(entry.commandId) ||
        entry.kind !== 'move'
      )
        throw presentationError('The shared movement presentation is invalid');
      try {
        validatePlayerMotion(entry.motion, maps);
      } catch (error) {
        if (!['invalid-player-state', 'invalid-saved-placement'].includes(error.code)) throw error;
        throw Object.assign(presentationError(error.message), { cause: error });
      }
      if (
        ![entry.motion.from, ...entry.motion.route].every((point) =>
          [currentMaps.get(point.mapId), previousMaps.get(point.mapId)].some(
            (map) => map && point.gridX < map.grid.cols && point.gridY < map.grid.rows
          )
        )
      )
        throw presentationError('A shared waypoint is outside the before/after map bounds');
      const actor = scene.creatures.find(({ id }) => id === entry.tokenId);
      const origin = previous?.creatures.find(({ id }) => id === entry.tokenId);
      if (
        !actor ||
        !origin ||
        !samePlacement(entry.motion.from, sceneActorPlacement(previous, origin)) ||
        !samePlacement(entry.motion.route.at(-1), sceneActorPlacement(scene, actor))
      )
        throw presentationError('Shared movement must connect the previous and committed poses');
    }
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
    if (!scene || !view.observerTokenId || !updates.length) return [];
    const [
      { default: CampaignWorld },
      { physicalSightObstacles },
      { samePlacement, coalesceMovementPresentations },
    ] = await Promise.all([
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignWorld.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CreatureVisibility.js')).href),
      import(
        pathToFileURL(path.join(this.root, 'src', 'scene', 'token-adapter', 'SavedPlacements.js'))
          .href
      ),
    ]);
    const world = CampaignWorld.fromScene(scene, { ruleset: scene.ruleset, library });
    const observer = scene.creatures.find(({ id }) => id === view.observerTokenId);
    const observerMapId = scene.version === 3 ? observer.mapId : 'map-main';
    const origin = world.toCampaignPosition(observerMapId, observer.pose.world);
    const geometry = {
      mapId: observerMapId,
      obstacles: physicalSightObstacles(world, observerMapId),
    };
    const maps = new Set(view.maps.map(({ id }) => id));
    const actors = new Map(view.publicScene.actors.map((actor) => [actor.id, actor]));
    const visible = new Map();
    const current = updates.filter(
      (update) =>
        update.motion &&
        update.sceneRevision <= state.sceneRevision &&
        update.charactersRevision <= state.revision &&
        (sinceSceneRevision === undefined || update.sceneRevision > sinceSceneRevision)
    );
    for (const update of coalesceMovementPresentations(current)) {
      const actor = actors.get(update.tokenId);
      if (
        !actor ||
        !samePlacement(update.motion.route.at(-1), actor) ||
        ![update.motion.from, ...update.motion.route].every(
          (point) =>
            maps.has(point.mapId) &&
            point.gridX < world.getMap(point.mapId).grid.cols &&
            point.gridY < world.getMap(point.mapId).grid.rows &&
            (actor.owned ||
              world.hasLineOfSight(
                origin,
                world.toCampaignPosition(point.mapId, point.pose.world),
                geometry
              ))
        )
      )
        continue;
      const presented = copy(update);
      if (!actor.owned) {
        delete presented.costFeet;
        delete presented.budget;
      }
      visible.set(presented.commandId, presented);
    }
    return [...visible.values()];
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
    const [{ default: CampaignWorld }, { nearbyDoors }, { playerCreatureVisibility }] =
      await Promise.all([
        import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignWorld.js')).href),
        import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignDoors.js')).href),
        import(
          pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CreatureVisibility.js')).href
        ),
      ]);
    const world = CampaignWorld.fromScene(scene, context);
    const door = world.getConnections().find((entry) => entry.id === command.doorId);
    if (!door || door.kind !== 'door') throw new Error('The campaign door no longer exists');
    if (profile.role === 'player') {
      if (typeof command.observerTokenId !== 'string')
        throw reject('Choose your active assigned character before using a door');
      const visibility = playerCreatureVisibility({
        world,
        creatures: scene.creatures,
        ownedIds: profile.characterIds,
        publishedIds: world.listMaps().map(({ id }) => id),
        observerTokenId: command.observerTokenId,
      });
      if (
        !nearbyDoors(
          world,
          { mapId: visibility.observer.mapId, world: visibility.observer.pose.world },
          visibility.sightGeometry
        ).some((entry) => entry.id === door.id)
      )
        throw reject('Move your active character within 5 feet of the visible door first');
      if (command.open && door.locked) throw reject('This door is locked. Ask the DM to unlock it');
    }
    const changed = world.setDoorState(
      door.id,
      Object.fromEntries(
        ['open', 'locked']
          .filter((key) => Object.hasOwn(command, key))
          .map((key) => [key, command[key]])
      )
    );
    const receipt = await this.store.commitScene(campaignId, {
      ruleset: state.campaign.ruleset,
      revision: state.sceneRevision,
      charactersRevision: state.revision,
      scene: encodeScene(world.save(), context),
    });
    this.authority.recordRoomVisits(campaignId, world.save());
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
    const { profile, state, catalog, library: previousLibrary } = await this._state(session, store);
    if (campaignId !== profile.campaignId)
      throw reject('This campaign is not assigned to the player');
    if (!change || Object.hasOwn(change, 'scene'))
      throw reject('Player world and combat commands are not enabled in this milestone');
    if (change.ruleset !== state.campaign.ruleset)
      throw reject('The character changes belong to another ruleset');
    if (change.revision !== state.revision)
      throw Object.assign(
        new Error(
          'Campaign data changed in another window. Refresh the assigned sheets and retry.'
        ),
        { status: 409 }
      );
    if (
      !Array.isArray(change.records) ||
      change.records.some(
        (row) => !row || typeof row.key !== 'string' || typeof row.value !== 'string'
      )
    )
      throw new Error('Invalid character records');
    const [
      { default: CampaignCharacters, campaignRecordCharacterId, validateCampaignCharacters },
      { decodeScene },
    ] = await this._modules();
    const owned = new Set(profile.characterIds);
    if (change.records.some((row) => !owned.has(campaignRecordCharacterId(row.key))))
      throw reject('Players can edit only their assigned saved characters');
    for (const row of state.records) {
      if (
        row.key.startsWith('taverntable.character.v1.') &&
        owned.has(campaignRecordCharacterId(row.key)) &&
        !change.records.some((next) => next.key === row.key)
      )
        throw reject('Players cannot delete assigned saved characters');
    }
    const records = [
      ...state.records.filter((row) => !owned.has(campaignRecordCharacterId(row.key))),
      ...change.records,
    ];
    validateCampaignCharacters(state.campaign, catalog, records);
    const library = new CampaignCharacters({ ...state, records, store, catalog });
    const enabled = new Set(catalog.enabledEntryIds);
    for (const row of change.records.filter((entry) =>
      entry.key.startsWith('taverntable.character.v1.')
    )) {
      const id = campaignRecordCharacterId(row.key);
      const before = previousLibrary.get(id);
      const after = library.get(id);
      for (const field of ['conditions', 'fallTraits', 'concentration'])
        if (
          !isDeepStrictEqual(
            field === 'conditions' ? [...before.conditions].sort() : before[field],
            field === 'conditions' ? [...after.conditions].sort() : after[field]
          )
        )
          throw reject(
            'World conditions, flight protection and concentration require DM adjudication until player gameplay commands are enabled'
          );
      const oldEntries = new Map(
        [...(before.equipment || []), ...(before.spells || [])].map((entry) => [
          entry.id,
          entry.entryId,
        ])
      );
      for (const entry of [...after.equipment, ...after.spells])
        if (oldEntries.get(entry.id) !== entry.entryId && !enabled.has(entry.entryId))
          throw reject('Ask the DM to enable this source before adding new content');
    }
    let changedScene;
    if (state.scene) {
      const scene = JSON.parse(state.scene);
      for (const creature of scene.creatures)
        if (owned.has(creature.characterId)) creature.name = library.get(creature.characterId).name;
      const serialized = JSON.stringify(scene);
      decodeScene(serialized, { ruleset: state.campaign.ruleset, library });
      if (serialized !== state.scene)
        changedScene = { revision: state.sceneRevision, value: serialized };
    }
    return store.commitCharacters(campaignId, {
      ruleset: change.ruleset,
      revision: change.revision,
      records,
      ...(changedScene ? { scene: changedScene } : {}),
    });
  }
}

module.exports = { PlayerCampaigns };
