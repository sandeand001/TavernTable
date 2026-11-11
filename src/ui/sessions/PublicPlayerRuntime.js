import { applyMapTerrain } from '../../campaigns/SceneWorld.js';
import {
  linkTokenCharacter,
  unlinkTokenCharacter,
} from '../../entities/creatures/TokenMovement.js';
import PublicPlayerLocation from './PublicPlayerLocation.js';
import { validatePlayerState, validatePlayerAssets } from '../../campaigns/PlayerPublicProtocol.js';
import { samePlacement } from '../../scene/token-adapter/SavedPlacements.js';

export default class PublicPlayerRuntime {
  constructor({ gameManager }) {
    this.gameManager = gameManager;
    this.assetKey = null;
    this.mapId = null;
    this.revision = -1;
    this.requestedRevision = -1;
    this.generation = 0;
    this.pending = Promise.resolve();
  }

  async update(state, { movement = null, placementGrantId = null } = {}) {
    if (state.publicScene?.version !== 1)
      throw new Error(
        'The host does not provide the interactive player snapshot. Update the host before playing.'
      );
    if (!Number.isSafeInteger(state.sceneRevision) || state.sceneRevision < 0)
      throw new Error('The host returned an invalid player scene revision');
    if (state.sceneRevision < Math.max(this.revision, this.requestedRevision))
      return { applied: false, reason: 'stale-snapshot' };
    validatePlayerState(state, { cachedAssets: this.assets });
    state = JSON.parse(JSON.stringify(state));
    movement = movement ? JSON.parse(JSON.stringify(movement)) : null;
    this.requestedRevision = state.sceneRevision;
    const generation = ++this.generation;
    const gm = this.gameManager;
    this.visibleIds = new Set(state.publicScene.actors.map(({ id }) => id));
    gm.publicPlayerPresentation = this;
    gm.threeSceneManager.scene.visible = false;
    for (const token of [...gm.placedTokens])
      if (!this.visibleIds.has(token.id)) gm.tokenManager.removeToken(token);
    const apply = async () => {
      if (generation !== this.generation) return { applied: false, reason: 'superseded-snapshot' };
      try {
        return await this._hydrate(state, { movement, placementGrantId }, generation);
      } catch (error) {
        this.assetKey = null;
        this.mapId = null;
        throw error;
      }
    };
    const result = this.pending.then(apply, apply);
    this.pending = result;
    return result;
  }

  async _hydrate(state, { movement, placementGrantId }, generation) {
    const current = () => generation === this.generation;
    const superseded = { applied: false, reason: 'superseded-snapshot' };
    const snapshot = state.publicScene;
    const gm = this.gameManager;
    if (state.observerTokenId === null && placementGrantId)
      return this._hydrateArrival(state, placementGrantId, generation);
    if (state.observerTokenId === null) {
      await this.clear({ invalidate: false });
      if (!current()) return superseded;
      if (
        snapshot.assets !== null ||
        snapshot.assetKey !== null ||
        snapshot.presentation?.mapId !== null ||
        snapshot.presentation?.focusTokenId !== null ||
        !Array.isArray(snapshot.actors) ||
        snapshot.actors.length ||
        !Array.isArray(snapshot.updates) ||
        snapshot.updates.length
      )
        throw new Error('The host returned an invalid no-observer player snapshot');
      gm.token3DAdapter.disposeTacticalTokens();
      gm.token3DAdapter.disposeMapProjectionTerrain();
      this.location = null;
      this.assets = null;
      this.mapId = null;
      this.assetKey = null;
      gm.campaignWorld = null;
      gm.campaignMapId = null;
      gm.campaignView = null;
      gm.publicPlayerPresentation = this;
      this.revision = state.sceneRevision;
      return { applied: true };
    }

    const selectedId = gm.token3DAdapter.getSelectedToken()?.id;
    const changedObserver = this.observerId !== snapshot.presentation.focusTokenId;
    const assetsChanged = this.assetKey !== snapshot.assetKey;
    if (snapshot.assets && (!this.location || this.assetKey !== snapshot.assetKey)) {
      this.location = new PublicPlayerLocation(snapshot.assets);
      this.assets = snapshot.assets;
      this.assetKey = snapshot.assetKey;
    } else if (this.assetKey !== snapshot.assetKey) {
      throw new Error('The public location assets are not cached. Request the complete snapshot.');
    }
    const mapId = snapshot.presentation.mapId;
    this.location.viewMapId = mapId;
    const map = this.location.getMap(mapId);
    const changingMap = this.mapId !== mapId || gm.campaignWorld !== this.location;
    gm.campaignWorld = this.location;
    gm.campaignMapId = mapId;
    gm.campaignView = {
      mapId,
      focusTokenId: snapshot.presentation.focusTokenId,
      focus(token) {
        this.focusTokenId = token?.id || null;
      },
    };
    gm.playerVisibleMapIds = new Set(this.location.listMaps().map(({ id }) => id));
    gm.playerSightObstacles = this.location.getObstacles({ mapId });
    if (changingMap) {
      gm.token3DAdapter.disposeMapProjectionTerrain();
      gm.token3DAdapter.disposeTacticalTokens();
      await applyMapTerrain(gm, map);
      if (!current()) return superseded;
      this.mapId = mapId;
    }
    const visible = new Set(snapshot.actors.map(({ id }) => id));
    this.visibleIds = visible;
    gm.publicPlayerPresentation = this;
    for (const token of [...gm.placedTokens])
      if (!visible.has(token.id)) gm.tokenManager.removeToken(token);
    const sharedMovements = snapshot.updates
      .filter(
        (update) =>
          this.revision >= 0 &&
          !assetsChanged &&
          update.sceneRevision > this.revision &&
          movement?.tokenId !== update.tokenId &&
          samePlacement(
            gm.placedTokens.find(({ id }) => id === update.tokenId),
            update.motion.from
          )
      )
      .map((update) => ({
        tokenId: update.tokenId,
        commandId: update.commandId,
        ...update.motion,
      }));
    const movements = new Map(
      [...sharedMovements, ...(movement ? [movement] : [])].map((entry) => [entry.tokenId, entry])
    );
    for (const actor of snapshot.actors) {
      if (!current()) return superseded;
      const presented = movements.get(actor.id)?.from || actor;
      let token = gm.placedTokens.find(({ id }) => id === actor.id);
      if (!token) {
        token = {
          id: actor.id,
          creature: gm.tokenManager.createCreatureByType(actor.type),
        };
        gm.placedTokens.push(token);
      } else if (token.type !== actor.type) {
        gm.token3DAdapter.onTokenRemoved(token);
        token.creature = gm.tokenManager.createCreatureByType(actor.type);
      }
      Object.assign(token, {
        name: actor.name,
        nameMode: actor.owned ? 'character' : 'custom',
        type: actor.type,
        mapId: presented.mapId,
        gridX: presented.gridX,
        gridY: presented.gridY,
        world: { ...presented.pose.world },
        facingAngle: presented.facingAngle,
        movementSettings: { ...actor.movement },
        conditions: actor.flags.prone ? ['prone'] : [],
        publicPortraitImage: actor.portraitImage,
        owned: actor.owned,
      });
      if (actor.owned && actor.characterId)
        linkTokenCharacter(token, gm.characterServices.library, actor.characterId);
      else unlinkTokenCharacter(token, actor.movement);
      const placement = {
        gridX: presented.gridX,
        gridY: presented.gridY,
        facingAngle: presented.facingAngle,
        pose: presented.pose,
      };
      await gm.token3DAdapter.onTokenAdded(token, placement);
      if (!current()) {
        if (!this.visibleIds.has(token.id)) {
          if (gm.placedTokens.includes(token)) gm.tokenManager.removeToken(token);
          else gm.token3DAdapter.onTokenRemoved(token);
        }
        return superseded;
      }
      await gm.token3DAdapter.restoreStablePlacement(token, placement);
      if (!current()) return superseded;
    }
    const focused = gm.placedTokens.find(({ id }) => id === snapshot.presentation.focusTokenId);
    const selected = gm.placedTokens.find(({ id }) => id === selectedId);
    gm.campaignView.focusTokenId = snapshot.presentation.focusTokenId;
    if (changingMap || changedObserver || !selected)
      await gm.token3DAdapter.setSelectedToken(focused || null);
    else if (gm.token3DAdapter.getSelectedToken() !== selected)
      await gm.token3DAdapter.setSelectedToken(selected);
    if (!current()) return superseded;
    this.observerId = snapshot.presentation.focusTokenId;
    await gm.token3DAdapter.syncMapProjections();
    if (!current()) return superseded;
    this.revision = state.sceneRevision;
    gm.threeSceneManager.scene.visible = true;
    return { applied: true, ...(sharedMovements.length ? { sharedMovements } : {}) };
  }

  async _hydrateArrival(state, placementGrantId, generation) {
    const grant = state.placementGrants?.find(({ id }) => id === placementGrantId);
    const view = state.view;
    const presentation = view?.presentation;
    if (
      !grant ||
      view?.mode !== 'placement-preview' ||
      view.id !== grant.mapId ||
      presentation?.version !== 1 ||
      typeof presentation.assetKey !== 'string' ||
      !Array.isArray(view.tokens) ||
      view.tokens.length ||
      state.observers.length ||
      state.gameplay.ownedTokens.length
    )
      throw new Error('The host did not provide an authorized actorless arrival preview');
    const assets =
      presentation.assets || (this.assetKey === presentation.assetKey ? this.assets : null);
    if (!assets)
      throw new Error('The arrival assets are not cached. Request the full grant preview.');
    validatePlayerAssets(assets);
    const gm = this.gameManager;
    await this.clear({ invalidate: false });
    if (generation !== this.generation) return { applied: false, reason: 'superseded-snapshot' };
    if (!this.location || this.assetKey !== presentation.assetKey) {
      this.location = new PublicPlayerLocation(assets);
      this.assets = assets;
      this.assetKey = presentation.assetKey;
    }
    const map = this.location.getMap(grant.mapId);
    if (
      !Number.isInteger(grant.gridX) ||
      !Number.isInteger(grant.gridY) ||
      grant.gridX < 0 ||
      grant.gridY < 0 ||
      grant.gridX >= map.grid.cols ||
      grant.gridY >= map.grid.rows
    )
      throw new Error('The host arrival destination is outside its authorized map');
    const changingMap = this.mapId !== map.id || gm.campaignWorld !== this.location;
    this.location.viewMapId = map.id;
    gm.campaignWorld = this.location;
    gm.campaignMapId = map.id;
    gm.campaignView = { mapId: map.id, focusTokenId: null };
    gm.publicPlayerPresentation = this;
    gm.playerVisibleMapIds = new Set(this.location.listMaps().map(({ id }) => id));
    gm.playerSightObstacles = this.location.getObstacles({ mapId: map.id });
    if (changingMap) {
      gm.token3DAdapter.disposeMapProjectionTerrain();
      gm.token3DAdapter.disposeTacticalTokens();
      await applyMapTerrain(gm, map);
    }
    if (generation !== this.generation) return { applied: false, reason: 'superseded-snapshot' };
    this.mapId = map.id;
    await gm.token3DAdapter.syncMapProjections();
    if (generation !== this.generation) return { applied: false, reason: 'superseded-snapshot' };
    this.revision = state.sceneRevision;
    gm.threeSceneManager.scene.visible = true;
    return { applied: true };
  }

  hasActor(id) {
    return this.visibleIds?.has(id) === true;
  }

  async clear({ invalidate = true } = {}) {
    if (invalidate) this.generation++;
    const gm = this.gameManager;
    gm.threeSceneManager.scene.visible = false;
    gm.playerVisibleMapIds = new Set();
    gm.playerSightObstacles = [];
    this.visibleIds = new Set();
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    await gm.token3DAdapter.setSelectedToken(null);
    this.observerId = null;
  }

  async destroy() {
    const gm = this.gameManager;
    await this.clear();
    gm.token3DAdapter.disposeTacticalTokens();
    gm.token3DAdapter.disposeMapProjectionTerrain();
    if (gm.publicPlayerPresentation === this) delete gm.publicPlayerPresentation;
    delete gm.playerVisibleMapIds;
    delete gm.playerSightObstacles;
  }
}
