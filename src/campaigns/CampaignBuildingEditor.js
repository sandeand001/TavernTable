import CampaignWorld from './CampaignWorld.js';
import { captureReadyCampaignScene } from './SceneWorld.js';
import { captureBuildingContext, buildingJoinConnections } from './BuildingAssembly.js';
import { isBuildingJoinConnection, isGeneratedBuildingJoin } from '../terrain/BuildingSnaps.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const definitions = (geometry) =>
  JSON.stringify(geometry.getStructures().filter((spec) => spec.building));

export function applyBuildingScene(gm, scene, world) {
  gm.campaignWorld = world;
  gm.campaignMapId = scene.view.mapId;
  gm.campaignView = world.createView({
    mapId: scene.view.mapId,
    focusTokenId: scene.view.focusTokenId,
  });
  const byId = new Map(scene.creatures.map((creature) => [creature.id, creature]));
  for (const token of gm.placedTokens) {
    const saved = byId.get(token.id);
    if (!saved) throw new Error('A building edit cannot remove a creature');
    gm.token3DAdapter.reframeStablePlacement(token, saved);
  }
}

export class CampaignBuildingEditor {
  constructor(gameManager) {
    this.gm = gameManager;
    this.changed = false;
  }

  prepare(geometry, restoreContext = null) {
    const gm = this.gm,
      library = gm.characterServices?.library;
    const joining = restoreContext?.buildingJoins !== undefined;
    if (joining && !Array.isArray(restoreContext.buildingJoins))
      throw new Error('A building snap requires valid shared-floor openings');
    if (
      !library ||
      (!restoreContext && definitions(geometry) === definitions(gm.terrainEngine.geometry))
    )
      return null;
    if (gm.campaignWorld?.getMap(gm.campaignMapId).building)
      throw new Error('Return to the exterior map to edit the building assembly');
    const options = { completedActionsOnly: true, rollLog: gm.sceneAutosave?.getRollLog() || [] };
    const capturedBefore = captureReadyCampaignScene(gm, library, {
      ...options,
      ...(restoreContext?.cavernGeneration
        ? { cavernOverride: restoreContext.previousCavern }
        : {}),
    });
    const beforeScene =
      capturedBefore.version === 3
        ? capturedBefore
        : CampaignWorld.fromScene(capturedBefore, { ruleset: library.ruleset, library }).save();
    const owner = gm.campaignMapId || 'map-main';
    let buildingContext = joining ? null : restoreContext;
    if (joining && restoreContext.replacingGeneratedJoins === true) {
      buildingContext = captureBuildingContext(beforeScene, owner);
      const maps = new Map(beforeScene.maps.map((map) => [map.id, map])),
        originalGeometry = maps.get(owner).terrain.geometry;
      buildingContext.connections = buildingContext.connections.filter(
        (connection) =>
          !isGeneratedBuildingJoin(connection, owner, originalGeometry, (id) => maps.get(id))
      );
    }
    if (restoreContext?.cavernGeneration === true) {
      buildingContext ??= captureBuildingContext(beforeScene, owner);
      buildingContext.cavernGeneration = true;
    }
    if (restoreContext?.protectAuthoredCellars === true) {
      if (!buildingContext)
        throw new Error('Cellar generation requires the saved building context');
      buildingContext.protectAuthoredCellars = true;
    }
    const afterScene = captureReadyCampaignScene(gm, library, {
      ...options,
      geometryOverride: geometry.save(),
      buildingContext,
    });
    const additions = joining
      ? buildingJoinConnections(afterScene, owner, restoreContext.buildingJoins)
      : [];
    if (additions.length) {
      const replacements = new Set(additions.map((connection) => connection.id));
      if (
        afterScene.connections.some(
          (connection) =>
            replacements.has(connection.id) && !isBuildingJoinConnection(connection, owner)
        )
      )
        throw new Error('A building join identity conflicts with an existing connection');
      const retained = afterScene.connections.filter(
        (connection) => !replacements.has(connection.id)
      );
      afterScene.connections = [
        ...retained.filter((connection) => !connection.building),
        ...additions,
        ...retained.filter((connection) => connection.building),
      ];
    }
    const addedIds = new Set([
      ...additions.map((connection) => connection.id),
      ...(joining ? [] : restoreContext?.connections || []).map((connection) => connection.id),
    ]);
    const before = captureBuildingContext(beforeScene, owner);
    const after = captureBuildingContext(afterScene, owner);
    const nextWorld = CampaignWorld.fromScene(afterScene, { ruleset: library.ruleset, library });
    for (const connection of nextWorld
      .getConnections()
      .filter(
        (entry) => entry.building?.kind === 'access' || entry.cavern || addedIds.has(entry.id)
      )) {
      const end = connection.ends[0],
        unit = nextWorld.getMap(end.mapId).grid.tileWorldSize / 5;
      try {
        nextWorld.planConnection(connection.id, end.mapId, {
          x: end.positionFeet.x * unit,
          y: end.positionFeet.y * unit,
          z: end.positionFeet.z * unit,
        });
      } catch (error) {
        error.message = `${nextWorld.getMap(end.mapId).name}: ${error.message}`;
        throw error;
      }
    }
    const original = {
      world: gm.campaignWorld,
      mapId: gm.campaignMapId,
      view: gm.campaignView,
      camera: copy(beforeScene.view.camera),
      tokens: gm.placedTokens.map((token) => ({
        token,
        mapId: token.mapId,
        placement: gm.token3DAdapter.getStablePlacement(token),
      })),
    };
    return {
      before,
      after,
      apply: () => {
        applyBuildingScene(gm, afterScene, nextWorld);
        if (restoreContext?.cavernGeneration)
          gm.threeSceneManager.restoreView(afterScene.view.camera);
        this.changed = true;
      },
      rollback: () => {
        gm.campaignWorld = original.world;
        gm.campaignMapId = original.mapId;
        gm.campaignView = original.view;
        if (restoreContext?.cavernGeneration) gm.threeSceneManager.restoreView(original.camera);
        for (const entry of original.tokens)
          gm.token3DAdapter.reframeStablePlacement(entry.token, {
            ...copy(entry.placement),
            mapId: entry.mapId,
          });
      },
    };
  }

  publish() {
    if (!this.changed) return;
    this.changed = false;
    if (typeof window !== 'undefined')
      window.dispatchEvent(
        new CustomEvent('taverntable:campaignViewStateChanged', {
          detail: { gameManager: this.gm },
        })
      );
  }
}
