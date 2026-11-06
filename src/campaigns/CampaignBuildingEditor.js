import CampaignWorld from './CampaignWorld.js';
import { captureReadyCampaignScene } from './SceneWorld.js';
import { captureBuildingContext } from './BuildingAssembly.js';

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
    if (
      !library ||
      (!restoreContext && definitions(geometry) === definitions(gm.terrainEngine.geometry))
    )
      return null;
    if (gm.campaignWorld?.getMap(gm.campaignMapId).building)
      throw new Error('Return to the exterior map to edit the building assembly');
    const options = { completedActionsOnly: true, rollLog: gm.sceneAutosave?.getRollLog() || [] };
    const beforeScene = captureReadyCampaignScene(gm, library, options);
    const afterScene = captureReadyCampaignScene(gm, library, {
      ...options,
      geometryOverride: geometry.save(),
      buildingContext: restoreContext,
    });
    const owner = gm.campaignMapId || 'map-main';
    const before = captureBuildingContext(beforeScene, owner);
    const after = captureBuildingContext(afterScene, owner);
    const nextWorld = CampaignWorld.fromScene(afterScene, { ruleset: library.ruleset, library });
    for (const connection of nextWorld
      .getConnections()
      .filter((entry) => entry.building?.kind === 'access')) {
      const end = connection.ends[0],
        unit = nextWorld.getMap(end.mapId).grid.tileWorldSize / 5;
      nextWorld.planConnection(connection.id, end.mapId, {
        x: end.positionFeet.x * unit,
        y: end.positionFeet.y * unit,
        z: end.positionFeet.z * unit,
      });
    }
    const original = {
      world: gm.campaignWorld,
      mapId: gm.campaignMapId,
      view: gm.campaignView,
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
        this.changed = true;
      },
      rollback: () => {
        gm.campaignWorld = original.world;
        gm.campaignMapId = original.mapId;
        gm.campaignView = original.view;
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
