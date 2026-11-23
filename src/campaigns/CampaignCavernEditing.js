import CampaignWorld from './CampaignWorld.js';
import { addCavernArea } from './CavernAssembly.js';
import { captureCampaignScene, isCampaignActionInProgress } from './SceneWorld.js';
import { validateConstructionEdit } from './CampaignConstruction.js';
import { encodeScene } from './CampaignScene.js';
import { TerrainGeometry } from '../terrain/TerrainGeometry.js';
import { addLogicalCavernArea } from './CampaignLogicalPassages.js';
import { logicalPassageEndpoint } from './CampaignLogicalPassageTravel.js';
import { sameJsonValue } from '../utils/JsonValue.js';
import { verifyRejectedSceneSave } from './CampaignSaveOutcome.js';

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

export async function createCampaignLogicalCavernArea(gm, options) {
  const library = gm.characterServices?.library;
  if (!library?.saveScene || !gm.campaignWorld || !gm.terrainEngine.cavern)
    throw new Error('Open a saved cavern interior before linking a blank area');
  if (
    gm.sceneAutosave?.ready === false ||
    gm.sceneAutosave?.error ||
    gm.campaignViewBusy ||
    gm.campaignMapFailure ||
    gm.terrainEngine.isActive ||
    gm.terrainEngine.hasPendingStroke ||
    isCampaignActionInProgress(gm)
  )
    throw new Error('Finish the current action or terrain edit before adding a cavern area');
  await gm.sceneAutosave?.flush();
  await library.flush?.();
  const mapId = gm.campaignMapId;
  const engine = gm.terrainEngine;
  const originalWorld = gm.campaignWorld;
  const captureOptions = {
    completedActionsOnly: true,
    rollLog: gm.sceneAutosave?.getRollLog() || [],
  };
  const before = await captureCampaignScene(gm, library, captureOptions);
  const context = { ruleset: library.ruleset, library };
  const scene = addLogicalCavernArea(before, { mapId, ...options });
  const world = CampaignWorld.fromScene(scene, context);
  const passage = scene.logicalPassages.at(-1);
  for (const end of passage.ends) {
    const position = logicalPassageEndpoint(world.getMap(end.mapId), end.side).world;
    world.planLogicalPassage(passage.id, end.mapId, position);
  }
  const current = await captureCampaignScene(gm, library, captureOptions);
  if (
    gm.campaignMapId !== mapId ||
    gm.terrainEngine !== engine ||
    gm.campaignWorld !== originalWorld ||
    gm.campaignViewBusy ||
    gm.sceneAutosave?.writing ||
    gm.sceneAutosave?.error ||
    gm.sceneAutosave?.ready === false ||
    gm.terrainEngine.isActive ||
    gm.terrainEngine.hasPendingStroke ||
    gm.characterServices.library.isSaving ||
    gm.characterServices.library.pendingScenes > 0 ||
    isCampaignActionInProgress(gm) ||
    !sameJsonValue(before, current)
  )
    throw new Error('The active map changed while the cavern passage was being prepared');
  const value = encodeScene(scene, context);
  const previous = {
    sceneRevision: library.sceneRevision,
    charactersRevision: library.revision,
    scene: library.savedScene,
  };
  let committed = false;
  let saveAttempted = false;
  let failure = null;
  let result = null;
  gm.campaignViewBusy = true;
  try {
    notify(gm);
    saveAttempted = true;
    await library.saveScene(() => ({ scene, value }));
    committed = true;
    gm.campaignWorld.acceptCheckpoint(scene);
    gm.terrainRebuilder?.request();
    result = {
      mapId: passage.ends[1].mapId,
      passageId: passage.id,
      name: world.getMap(passage.ends[1].mapId).name,
    };
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error));
    if (committed) {
      gm.campaignMapFailure = new Error(
        'The cavern passage was saved, but its local view could not finish updating. Reload the campaign.',
        { cause: error }
      );
      failure = gm.campaignMapFailure;
    } else {
      const uncertain = saveAttempted
        ? await verifyRejectedSceneSave(library, error, previous)
        : null;
      if (uncertain) {
        gm.campaignMapFailure = new AggregateError(
          [error, uncertain],
          'The cavern passage save could not be verified. Reload the campaign before making changes.'
        );
        failure = gm.campaignMapFailure;
      }
    }
  } finally {
    gm.campaignViewBusy = false;
    try {
      notify(gm);
    } catch (notificationError) {
      gm.campaignMapFailure = committed
        ? new Error(
            'The cavern passage was saved, but its local view could not finish updating. Reload the campaign.',
            { cause: notificationError }
          )
        : new AggregateError(
            [failure, notificationError].filter(Boolean),
            'The cavern passage view could not finish updating. Reload the campaign.'
          );
      failure = gm.campaignMapFailure;
    }
  }
  if (failure) throw failure;
  return result;
}

function notify(gm) {
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('taverntable:campaignViewStateChanged', {
        detail: { gameManager: gm },
      })
    );
}
