const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const stableStringify = require('fast-json-stable-stringify');
const { PhysicalDice } = require('./physical-dice.js');

const denied = () =>
  Object.assign(new Error('This actor is not available to your player'), {
    status: 403,
    code: 'actor-forbidden',
  });

class PlayerGameplay {
  constructor({ root, players }) {
    this.root = root;
    this.players = players;
    this.dice = new PhysicalDice({ root });
  }

  async grant(session, campaignId, playerId, characterId, destination) {
    this.players.authority.requireDM(session);
    const state = await this.players.store.readCharacters(campaignId);
    const catalog = await this.players.resources.catalog(state.campaign);
    const [{ default: CampaignCharacters }, { decodeScene }, { default: CampaignWorld }] =
      await Promise.all([
        import(
          pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignCharacters.js')).href
        ),
        import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignScene.js')).href),
        import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignWorld.js')).href),
      ]);
    const library = new CampaignCharacters({ ...state, catalog, store: this.players.store });
    library.get(characterId);
    const scene = decodeScene(state.scene, { library, ruleset: state.campaign.ruleset });
    const world = CampaignWorld.fromScene(scene, { library, ruleset: state.campaign.ruleset });
    const map = world.getMap(destination?.mapId);
    if (
      !Number.isInteger(destination.gridX) ||
      !Number.isInteger(destination.gridY) ||
      destination.gridX < 0 ||
      destination.gridY < 0 ||
      destination.gridX >= map.grid.cols ||
      destination.gridY >= map.grid.rows
    )
      throw Object.assign(new Error('Choose an explicit placement cell inside the map'), {
        status: 400,
        code: 'invalid-placement',
      });
    return this.players.authority.grantPlacement(
      session,
      campaignId,
      playerId,
      characterId,
      destination
    );
  }

  async command(session, campaignId, command) {
    const { validatePlayerCommand } = await import(
      pathToFileURL(path.join(this.root, 'src', 'campaigns', 'PlayerCommandProtocol.js')).href
    );
    validatePlayerCommand(command);
    if (['roll', 'action.use'].includes(command.kind)) await this.dice.load();
    const { profile, library } = await this.players._state(session);
    if (campaignId !== profile.campaignId) throw denied();
    const [
      { default: CampaignStore },
      { default: CampaignCharacters },
      { decodeScene },
      { executePlayerCommand, playerCommandReceipt },
    ] = await Promise.all([
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignStore.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignCharacters.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignScene.js')).href),
      import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'ServerGameplay.js')).href),
    ]);
    const { view, ...intent } = command;
    const fingerprint = createHash('sha256').update(stableStringify(intent)).digest('hex');
    const authorizedState = async (store, receipt, snapshot) => {
      const observed = snapshot.creatures.some((actor) => actor.id === receipt.tokenId)
        ? receipt.tokenId
        : null;
      return this.players.state(
        session,
        {
          presentationVersion: 1,
          observerTokenId: observed,
          mapId: observed ? view?.mapId : null,
          assetKey: observed ? view?.assetKey : null,
        },
        store
      );
    };
    return this.players.store.storage.transaction('readwrite', async (transaction) => {
      const currentProfile = this.players.authority.profile(session);
      if (currentProfile.playerId !== profile.playerId || currentProfile.campaignId !== campaignId)
        throw denied();
      const store = new CampaignStore({
        packs: [...this.players.store.packs.values()],
        storage: { transaction: (_mode, operation) => operation(transaction) },
      });
      const current = await store.readCharacters(campaignId);
      const currentLibrary = new CampaignCharacters({
        ...current,
        store,
        catalog: library.sourceCatalog,
      });
      const scene = decodeScene(current.scene, {
        ruleset: current.campaign.ruleset,
        library: currentLibrary,
      });
      const actor = scene.creatures.find((entry) => entry.id === command.tokenId);
      const previous = transaction.readPlayerCommand(
        campaignId,
        currentProfile.playerId,
        command.commandId
      );
      if (previous) {
        if (
          !currentProfile.characterIds.includes(previous.characterId) ||
          (actor && actor.characterId !== previous.characterId)
        )
          throw denied();
        if (previous.fingerprint !== fingerprint)
          throw Object.assign(new Error('This command ID was already used for another intent'), {
            status: 409,
            code: 'command-id-conflict',
          });
        const state = await authorizedState(store, previous.receipt.receipt, scene);
        state.publicScene.updates = [];
        return { ...previous.receipt, outcome: 'duplicate', state };
      }
      if (
        command.sceneRevision !== current.sceneRevision ||
        command.charactersRevision !== current.revision
      )
        throw Object.assign(new Error('Refresh the current game state before retrying'), {
          status: 409,
          code: 'stale-revision',
          current: { sceneRevision: current.sceneRevision, charactersRevision: current.revision },
        });
      const characterId =
        command.kind === 'place' ? command.payload.characterId : actor?.characterId;
      if (
        !currentProfile.characterIds.includes(characterId) ||
        (command.kind !== 'place' && (!actor || command.observerTokenId !== actor.id))
      )
        throw denied();
      const placementGrant =
        command.kind === 'place'
          ? this.players.authority.placementGrant(session, command.payload.grantId)
          : null;
      const result = await executePlayerCommand(scene, currentLibrary, command, {
        dice: this.dice,
        ownedIds: currentProfile.characterIds,
        placementGrant,
      });
      const saved = await store.commitScene(campaignId, {
        ruleset: current.campaign.ruleset,
        revision: current.sceneRevision,
        charactersRevision: currentLibrary.revision,
        scene: JSON.stringify(result.scene),
      });
      const finalProfile = this.players.authority.profile(session);
      if (!finalProfile.characterIds.includes(characterId)) throw denied();
      if (placementGrant) this.players.authority.placementGrant(session, command.payload.grantId);
      const receipt = {
        version: 1,
        commandId: command.commandId,
        outcome: 'applied',
        applied: { sceneRevision: saved.revision, charactersRevision: currentLibrary.revision },
        receipt: playerCommandReceipt(result, scene, currentLibrary),
      };
      transaction.writePlayerCommand(
        campaignId,
        finalProfile.playerId,
        command.commandId,
        characterId,
        fingerprint,
        receipt
      );
      const state = await authorizedState(store, receipt.receipt, result.scene);
      return { ...receipt, state };
    });
  }
}

module.exports = { PlayerGameplay };
