const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PublishedMaps } = require('./published-maps.js');
const { isDeepStrictEqual } = require('node:util');

const reject = (message) => Object.assign(new Error(message), { status: 403 });

class PlayerCampaigns {
  constructor({ root, store, authority, resources }) {
    this.root = root;
    this.store = store;
    this.authority = authority;
    this.resources = resources;
    this.published = new PublishedMaps(root);
  }

  async _modules() {
    return Promise.all([
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignCharacters.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignScene.js')).href),
    ]);
  }

  async _state(session) {
    const profile = this.authority.profile(session);
    if (profile.role !== 'player')
      throw reject('Join with a player invitation to open assigned characters');
    const state = await this.store.readCharacters(profile.campaignId);
    const catalog = await this.resources.catalog(state.campaign);
    const [{ default: CampaignCharacters }] = await this._modules();
    const library = new CampaignCharacters({ ...state, store: this.store, catalog });
    return { profile, state, catalog, library };
  }

  async state(session, options = {}) {
    const { profile, state, library } = await this._state(session);
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
    });
    return {
      campaign: state.campaign,
      revision: state.revision,
      records: state.records.filter((row) =>
        profile.characterIds.includes(campaignRecordCharacterId(row.key))
      ),
      scene: null,
      sceneRevision: state.sceneRevision,
      sceneSavedAt: state.sceneSavedAt,
      profile,
      visitedRoomIds: this.authority.visitedRoomIds(session),
      ...view,
    };
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
    const { profile, state, catalog, library: previousLibrary } = await this._state(session);
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
    const library = new CampaignCharacters({ ...state, records, store: this.store, catalog });
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
    return this.store.commitCharacters(campaignId, {
      ruleset: change.ruleset,
      revision: change.revision,
      records,
      ...(changedScene ? { scene: changedScene } : {}),
    });
  }
}

module.exports = { PlayerCampaigns };
