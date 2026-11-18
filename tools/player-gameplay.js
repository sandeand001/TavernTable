const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const stableStringify = require('fast-json-stable-stringify');
const { advancePlayerUndo } = require('./player-undo-sessions.js');
const { PhysicalDice } = require('./physical-dice.js');
const { playerRoomVisitEntries } = require('./player-room-visits.js');
const { scopePlayerReceipt: scopedReceipt } = require('../src/campaigns/PlayerPublicProtocol.js');

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
    const [{ default: CampaignCharacters }, { decodeScene }, { validatePlayerArrival }] =
      await Promise.all([
        import(
          pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignCharacters.js')).href
        ),
        import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'CampaignScene.js')).href),
        import(pathToFileURL(path.join(this.root, 'src', 'campaigns', 'ServerGameplay.js')).href),
      ]);
    const library = new CampaignCharacters({ ...state, catalog, store: this.players.store });
    const scene = decodeScene(state.scene, { library, ruleset: state.campaign.ruleset });
    validatePlayerArrival(scene, library, characterId, destination);
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
    const authorizedState = async (store, receipt, snapshot, undo = null) => {
      const actor = snapshot.creatures.find((actor) => actor.id === receipt.tokenId);
      const observed = actor?.id || null;
      const mapId = snapshot.version === 3 ? actor?.mapId : 'map-main';
      const follow = observed && receipt.motion && receipt.motion.from.mapId !== mapId;
      return this.players.state(
        session,
        {
          presentationVersion: 1,
          observerTokenId: observed,
          mapId: observed ? (follow ? mapId : view?.mapId) : null,
          assetKey: observed && !follow ? view?.assetKey : null,
        },
        store,
        undo,
        { deferRoomVisits: true }
      );
    };
    const committed = await this.players.store.storage.transaction(
      'readwrite',
      async (transaction) => {
        const currentProfile = this.players.authority.profile(session);
        if (
          currentProfile.playerId !== profile.playerId ||
          currentProfile.campaignId !== campaignId
        )
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
          return {
            response: {
              ...previous.receipt,
              receipt: scopedReceipt(previous.receipt.receipt, state),
              outcome: 'duplicate',
              state,
            },
          };
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
        const undo = this.players.undoFor(currentProfile, current);
        const result = await executePlayerCommand(scene, currentLibrary, command, {
          dice: this.dice,
          ownedIds: currentProfile.characterIds,
          placementGrant,
          undo,
        });
        const saved = await store.commitScene(campaignId, {
          ruleset: current.campaign.ruleset,
          revision: current.sceneRevision,
          charactersRevision: currentLibrary.revision,
          scene: JSON.stringify(result.scene),
          roomVisits: playerRoomVisitEntries(result.scene),
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
        const { tokens: nextUndo, reset } = advancePlayerUndo(undo, scene, result, command);
        const state = await authorizedState(store, receipt.receipt, result.scene, nextUndo);
        return {
          response: { ...receipt, receipt: scopedReceipt(receipt.receipt, state), state },
          profile: finalProfile,
          undo: {
            previous: { sceneRevision: current.sceneRevision, revision: current.revision },
            current: { sceneRevision: saved.revision, revision: currentLibrary.revision },
            tokens: nextUndo,
            tokenId: command.tokenId,
            reset,
          },
        };
      }
    );
    if (committed.undo) this.players.rememberUndo(committed.profile, committed.undo);
    return committed.response;
  }
}

module.exports = { PlayerGameplay };
