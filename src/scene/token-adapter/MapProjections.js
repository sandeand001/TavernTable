import MapProjectionTerrain from './MapProjectionTerrain.js';

const referenceIds = new WeakMap();
let nextReferenceId = 1;

function referenceId(value) {
  if (!value || typeof value !== 'object') return 0;
  if (!referenceIds.has(value)) referenceIds.set(value, nextReferenceId++);
  return referenceIds.get(value);
}

function projectionStateKey(adapter) {
  const gm = adapter.gameManager;
  const world = gm?.campaignWorld;
  if (!world || !gm?.threeSceneManager?.scene)
    return JSON.stringify([
      'unavailable',
      referenceId(world),
      referenceId(gm?.threeSceneManager?.scene),
    ]);
  const tokens = gm?.placedTokens || [];
  const presentation = gm?.publicPlayerPresentation;
  const terrain = gm?.terrainEngine;
  const playerMaps = gm?.playerVisibleMapIds ? [...gm.playerVisibleMapIds].sort() : [];
  const tokenState = tokens.map((token) => [
    referenceId(token),
    token.id,
    token.mapId,
    token.world?.x,
    token.world?.y,
    token.world?.z,
    token.facingAngle,
    referenceId(token.__threeMesh),
    referenceId(token.openingHold),
    referenceId(token.surfaceHold),
    getTokenConditions(token).join(','),
    presentation?.hasActor(token.id) === true,
  ]);
  return JSON.stringify([
    referenceId(world),
    referenceId(gm?.threeSceneManager?.scene),
    world?.mapRevision,
    world?.hasFloorMaps,
    gm?.campaignMapId,
    gm?.campaignView?.mapId,
    gm?.campaignView?.focusTokenId,
    gm?.campaignMapTransition === true,
    gm?.campaignTraversalAnimating === true,
    gm?.campaignMapFailure === true,
    gm?.sceneAutosave?.ready !== false,
    terrain?.cavern?.version ?? 0,
    terrain?.geometry?.revision ?? 0,
    terrain?.geometry?.terrainThicknessFeet,
    terrain?.visibleLayers?.join(',') ?? null,
    gm?.placeableMeshPool?._revision ?? 0,
    referenceId(presentation),
    presentation?.generation,
    presentation?.revision,
    playerMaps,
    tokenState,
  ]);
}

function clearMapProjectionTerrain() {
  this._mapProjectionTerrain?.clear();
}

function disposeMapProjectionTerrain() {
  this._mapProjectionTerrain?.dispose();
  this._mapProjectionTerrain = null;
}

function syncMapProjectionTerrain() {
  const gm = this.gameManager;
  if (gm.terrainEngine.cavern) {
    this.disposeMapProjectionTerrain();
    return;
  }
  if ((gm.campaignMapTransition && !gm.campaignTraversalAnimating) || gm.campaignMapFailure) {
    this.clearMapProjectionTerrain();
    return;
  }
  const observer = gm.placedTokens.find(
    (token) => token.id === gm.campaignView?.focusTokenId && token.mapId === gm.campaignMapId
  );
  const targets = [...this._mapProjectionVisible].filter(
    (token) => this.isTokenProjection(token) && token.__threeMesh && gm.placedTokens.includes(token)
  );
  if (this._mapProjectionTerrain && this._mapProjectionTerrain.world !== gm.campaignWorld)
    this.disposeMapProjectionTerrain();
  if (
    (targets.length ||
      gm.playerVisibleMapIds ||
      Number.isFinite(gm.terrainEngine.geometry.terrainThicknessFeet) ||
      gm.campaignWorld.hasFloorMaps) &&
    !this._mapProjectionTerrain
  )
    this._mapProjectionTerrain = new MapProjectionTerrain(gm);
  this._mapProjectionTerrain?.update(observer, targets);
}

function isTokenProjection(token) {
  const gm = this.gameManager;
  return !!gm.campaignWorld && token?.mapId !== gm.campaignMapId;
}

function isTokenProjectionVisible(token) {
  const gm = this.gameManager;
  if (gm.terrainEngine.cavern && this.isTokenProjection(token)) return false;
  if (gm.campaignWorld && !gm.campaignWorld.sharesLocation(token.mapId, gm.campaignMapId))
    return false;
  return !this.isTokenProjection(token) || this._mapProjectionVisible?.has(token) === true;
}

async function reconcileMapProjections() {
  const gm = this.gameManager;
  if (!gm.campaignWorld || !gm.threeSceneManager?.scene) {
    this.disposeMapProjectionTerrain();
    return;
  }
  const observer = gm.placedTokens.find(
    (token) => token.id === gm.campaignView?.focusTokenId && token.mapId === gm.campaignMapId
  );
  const projections = gm.placedTokens.filter((token) => this.isTokenProjection(token));
  const visible = new Set();
  let geometry = null;
  if (gm.publicPlayerPresentation) {
    for (const token of projections)
      if (gm.publicPlayerPresentation.hasActor(token.id)) visible.add(token);
  } else if (
    observer &&
    projections.length &&
    !gm.terrainEngine.cavern &&
    gm.sceneAutosave?.ready !== false &&
    !getTokenConditions(observer).includes('blinded')
  ) {
    const position = gm.campaignWorld.toCampaignPosition(observer.mapId, observer.world);
    geometry = {
      mapId: observer.mapId,
      obstacles: gm.campaignWorld.getObstacles({
        mapId: gm.campaignMapId,
        geometry: gm.terrainEngine.geometry,
        coverBounds: gm.placeableMeshPool?.targetingCoverBounds() ?? null,
      }),
    };
    for (const token of projections) {
      if (
        gm.campaignWorld.sharesLocation(observer.mapId, token.mapId) &&
        !getTokenConditions(token).includes('invisible') &&
        gm.campaignWorld.hasLineOfSight(
          position,
          gm.campaignWorld.toCampaignPosition(token.mapId, token.world),
          geometry
        )
      )
        visible.add(token);
    }
  }
  this._mapProjectionVisible = visible;
  this.syncMapProjectionTerrain();
  for (const token of projections) {
    if (visible.has(token) && !token.__threeMesh)
      await this._ensureTokenMesh(token, gm.threeSceneManager.scene);
    if (!gm.placedTokens.includes(token)) {
      this.onTokenRemoved(token);
      continue;
    }
    if (token.__threeMesh) {
      token.__threeMesh.visible = this.isTokenProjectionVisible(token);
      if (this.isTokenProjectionVisible(token)) {
        this._positionMesh(token.__threeMesh, token);
        this._applyOrientationImmediate(token, token.facingAngle ?? 0);
        if (token.openingHold) this.syncOpeningHoldVisual(token);
        if (token.surfaceHold) this.syncSurfaceGripVisual(token);
      }
    }
  }
  this.syncMapProjectionTerrain();
}

async function drainMapProjectionSync(adapter) {
  do {
    adapter._mapProjectionSyncDirty = false;
    adapter._mapProjectionSyncForce = false;
    const key = projectionStateKey(adapter);
    adapter._mapProjectionSyncActiveKey = key;
    await reconcileMapProjections.call(adapter);
    adapter._mapProjectionSyncKey = key;
  } while (
    adapter._mapProjectionSyncForce ||
    adapter._mapProjectionSyncDirty ||
    projectionStateKey(adapter) !== adapter._mapProjectionSyncKey
  );
}

function queueMapProjectionSync({ force = false } = {}) {
  const key = projectionStateKey(this);
  if (this._mapProjectionSyncPromise) {
    if (force) this._mapProjectionSyncForce = true;
    if (key !== this._mapProjectionSyncActiveKey) this._mapProjectionSyncDirty = true;
    return this._mapProjectionSyncPromise;
  }
  if (!force && key === this._mapProjectionSyncKey) return Promise.resolve(false);
  this._mapProjectionSyncDirty = true;
  this._mapProjectionSyncForce = force;
  const pending = drainMapProjectionSync(this);
  this._mapProjectionSyncPromise = pending;
  pending.then(
    () => {
      if (this._mapProjectionSyncPromise === pending) {
        this._mapProjectionSyncPromise = null;
        this._mapProjectionSyncActiveKey = null;
      }
    },
    () => {
      if (this._mapProjectionSyncPromise === pending) {
        this._mapProjectionSyncPromise = null;
        this._mapProjectionSyncActiveKey = null;
      }
    }
  );
  return pending;
}

function requestMapProjectionSync() {
  return queueMapProjectionSync.call(this);
}

function syncMapProjections() {
  return queueMapProjectionSync.call(this, { force: true });
}

export function installMapProjectionMethods(prototype) {
  prototype.clearMapProjectionTerrain = clearMapProjectionTerrain;
  prototype.disposeMapProjectionTerrain = disposeMapProjectionTerrain;
  prototype.syncMapProjectionTerrain = syncMapProjectionTerrain;
  prototype.isTokenProjection = isTokenProjection;
  prototype.isTokenProjectionVisible = isTokenProjectionVisible;
  prototype.requestMapProjectionSync = requestMapProjectionSync;
  prototype.syncMapProjections = syncMapProjections;
}
import { getTokenConditions } from '../../entities/creatures/TokenMovement.js';
