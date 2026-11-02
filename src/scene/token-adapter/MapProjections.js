import MapProjectionTerrain from './MapProjectionTerrain.js';

function clearMapProjectionTerrain() {
  this._mapProjectionTerrain?.clear();
}

function disposeMapProjectionTerrain() {
  this._mapProjectionTerrain?.dispose();
  this._mapProjectionTerrain = null;
}

function syncMapProjectionTerrain() {
  const gm = this.gameManager;
  if (gm.campaignMapTransition || gm.campaignMapFailure) {
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
    (targets.length || Number.isFinite(gm.terrainEngine.geometry.terrainThicknessFeet)) &&
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
  return !this.isTokenProjection(token) || this._mapProjectionVisible?.has(token) === true;
}

async function syncMapProjections() {
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
  if (
    observer &&
    projections.length &&
    gm.sceneAutosave?.ready !== false &&
    !getTokenConditions(observer).includes('blinded')
  ) {
    const position = gm.campaignWorld.toCampaignPosition(observer.mapId, observer.world);
    geometry = {
      obstacles: gm.campaignWorld.getObstacles({
        mapId: gm.campaignMapId,
        geometry: gm.terrainEngine.geometry,
        coverBounds: gm.placeableMeshPool?.targetingCoverBounds() ?? null,
      }),
    };
    for (const token of projections) {
      if (
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
        this.updateTokenOrientation(token);
      }
    }
  }
  this.syncMapProjectionTerrain();
}

export function installMapProjectionMethods(prototype) {
  prototype.clearMapProjectionTerrain = clearMapProjectionTerrain;
  prototype.disposeMapProjectionTerrain = disposeMapProjectionTerrain;
  prototype.syncMapProjectionTerrain = syncMapProjectionTerrain;
  prototype.isTokenProjection = isTokenProjection;
  prototype.isTokenProjectionVisible = isTokenProjectionVisible;
  prototype.syncMapProjections = syncMapProjections;
}
import { getTokenConditions } from '../../entities/creatures/TokenMovement.js';
