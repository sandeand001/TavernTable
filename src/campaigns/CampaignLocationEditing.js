import CampaignWorld from './CampaignWorld.js';
import { captureCampaignScene, isCampaignActionInProgress } from './SceneWorld.js';
import { applyBuildingScene } from './CampaignBuildingEditor.js';
import { encodeScene } from './CampaignScene.js';

function notify(gm) {
  gm.characterServices.combat.syncMovementStatus();
  if (typeof window !== 'undefined')
    window.dispatchEvent(
      new CustomEvent('taverntable:campaignViewStateChanged', {
        detail: { gameManager: gm },
      })
    );
}

export async function createCampaignLocation(gm, name) {
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 100)
    throw new Error('A location needs a name of at most 100 characters');
  const library = gm.characterServices?.library;
  if (
    !library?.saveScene ||
    gm.sceneAutosave?.ready === false ||
    gm.campaignViewBusy ||
    gm.campaignMapFailure ||
    gm.terrainEngine.hasPendingStroke ||
    isCampaignActionInProgress(gm)
  )
    throw new Error(
      'Finish the current action, map change or terrain preview before creating a location'
    );
  gm.campaignViewBusy = true;
  let committed = false;
  try {
    notify(gm);
    await gm.sceneAutosave?.flush({ waitForScene: false });
    await library.flush?.();
    const before = await captureCampaignScene(gm, library, {
      completedActionsOnly: true,
      rollLog: gm.sceneAutosave?.getRollLog() || [],
    });
    const context = { ruleset: library.ruleset, library };
    const world = CampaignWorld.fromScene(before, context);
    const source = world.getMap(world.save().view.mapId);
    const id = `location:${crypto.randomUUID()}`;
    const mapId = `map:${crypto.randomUUID()}`;
    world.addLocation({
      id,
      name: name.trim(),
      map: {
        id: mapId,
        name: 'Main area',
        originFeet: { x: 0, y: 0, z: 0 },
        quarterTurns: 0,
        base: 'ground',
        grid: { ...source.grid },
        terrain: {
          heights: Array.from({ length: source.grid.rows }, () => Array(source.grid.cols).fill(0)),
          biome: null,
          seed: source.terrain.seed,
          elevationScale: source.terrain.elevationScale,
          worldElevationUnit: source.terrain.worldElevationUnit,
          treeDensity: 0,
          richShading: {},
          placeables: [],
          sightBounds: [],
        },
      },
    });
    const scene = world.save();
    await library.saveScene(() => ({ scene, value: encodeScene(scene, context) }));
    committed = true;
    if (gm.campaignWorld) gm.campaignWorld.acceptCheckpoint(scene);
    else {
      applyBuildingScene(gm, scene, world);
      gm.characterServices.combat.restore(scene.combat, gm.placedTokens);
    }
    return { id, name: name.trim(), mapId };
  } catch (error) {
    if (committed) {
      gm.campaignMapFailure = new Error(
        'The new location was saved, but its local view could not finish updating. Reload the campaign.',
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
