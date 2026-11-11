import CampaignWorld from './CampaignWorld.js';
import { addCavernArea } from './CavernAssembly.js';
import { captureCampaignScene, isCampaignActionInProgress } from './SceneWorld.js';
import { validateConstructionEdit } from './CampaignConstruction.js';
import { encodeScene } from './CampaignScene.js';
import { TerrainGeometry } from '../terrain/TerrainGeometry.js';

export async function createCampaignCavernArea(gm, options) {
  const library = gm.characterServices?.library;
  if (!library?.saveScene || !gm.campaignWorld || !gm.terrainEngine.cavern)
    throw new Error('Open a saved cavern interior before adding a tunnel or chamber');
  if (
    gm.sceneAutosave?.ready === false ||
    gm.campaignViewBusy ||
    gm.campaignMapFailure ||
    gm.terrainEngine.hasPendingStroke ||
    isCampaignActionInProgress(gm)
  )
    throw new Error(
      'Finish the current action, map change or terrain preview before adding a cavern area'
    );
  let committed = false;
  try {
    await gm.sceneAutosave?.flush();
    await library.flush?.();
    const before = await captureCampaignScene(gm, library, {
      completedActionsOnly: true,
      rollLog: gm.sceneAutosave?.getRollLog() || [],
    });
    const context = { ruleset: library.ruleset, library };
    const scene = addCavernArea(before, context, gm.campaignMapId, options);
    const map = scene.maps.find((entry) => entry.id === gm.campaignMapId);
    const geometry = new TerrainGeometry({
      widthFeet: map.grid.cols * 5,
      depthFeet: map.grid.rows * 5,
      terrainThicknessFeet: map.base === 'floor' ? 0.5 : null,
      getTerrainHeightFeet: (x, z) =>
        (map.terrain.heights[Math.floor(z / 5)][Math.floor(x / 5)] *
          map.terrain.worldElevationUnit *
          5) /
        map.grid.tileWorldSize,
    });
    if (map.terrain.geometry) geometry.load(map.terrain.geometry);
    validateConstructionEdit(gm, geometry);
    const world = CampaignWorld.fromScene(scene, context);
    const connection = scene.connections.at(-1);
    for (const end of connection.ends) {
      const scale = world.getMap(end.mapId).grid.tileWorldSize / 5;
      world.planConnection(connection.id, end.mapId, {
        x: end.positionFeet.x * scale,
        y: end.positionFeet.y * scale,
        z: end.positionFeet.z * scale,
      });
    }
    gm.campaignViewBusy = true;
    notify(gm);
    await library.saveScene(() => ({ scene, value: encodeScene(scene, context) }));
    committed = true;
    gm.campaignWorld.acceptCheckpoint(scene);
    gm.terrainEngine.load({
      ...gm.terrainEngine.save(),
      heights: map.terrain.heights,
      geometry: map.terrain.geometry ?? { version: 1, volumes: [] },
      cavern: map.terrain.cavern,
    });
    gm.notifyTerrainHeightsChanged();
    await gm.token3DAdapter.syncMapProjections();
    return { mapId: connection.ends[1].mapId, name: world.getMap(connection.ends[1].mapId).name };
  } catch (error) {
    if (committed) {
      gm.campaignMapFailure = new Error(
        'The cavern area was saved, but its local view could not finish updating. Reload the campaign.',
        { cause: error }
      );
      throw gm.campaignMapFailure;
    }
    throw error;
  } finally {
    gm.campaignViewBusy = false;
    notify(gm);
  }
}

function notify(gm) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('taverntable:campaignViewStateChanged', {
        detail: { gameManager: gm },
      })
    );
}
