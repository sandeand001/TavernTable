import CampaignWorld from './CampaignWorld.js';
import { captureCampaignScene, isCampaignActionInProgress } from './SceneWorld.js';
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

export async function changeCampaignDoor(gm, id, change) {
  const library = gm.characterServices?.library;
  if (gm.characterServices?.workspace?.store.identity?.role === 'player')
    throw new Error('Player doors require an authorized host command');
  if (
    !gm.campaignWorld ||
    !library?.saveScene ||
    gm.sceneAutosave?.ready === false ||
    gm.campaignViewBusy ||
    gm.campaignMapFailure ||
    gm.terrainEngine.hasPendingStroke ||
    isCampaignActionInProgress(gm)
  )
    throw new Error('Finish the current action, save or map change before changing a door');
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
    const state = world.setDoorState(id, change);
    const scene = world.save();
    await library.saveScene(() => ({ scene, value: encodeScene(scene, context) }));
    committed = true;
    gm.campaignWorld.acceptCheckpoint(scene);
    await gm.token3DAdapter.syncMapProjections();
    return state;
  } catch (error) {
    if (committed) {
      gm.campaignMapFailure = new Error(
        'The door was saved, but its local view could not update. Reload the campaign.',
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

export function prepareSharedDoorScene(gm, incoming) {
  if (!gm.campaignWorld || incoming?.version !== 3)
    throw new Error('Shared door updates require a connected campaign');
  const before = gm.campaignWorld.save();
  const sharedState = (scene) => {
    const value = JSON.parse(JSON.stringify(scene));
    delete value.view;
    for (const connection of value.connections || []) {
      delete connection.open;
      delete connection.locked;
    }
    for (const creature of value.creatures) if (creature.characterId) delete creature.name;
    return JSON.stringify(value);
  };
  if (sharedState(before) !== sharedState(incoming))
    throw new Error('The board changed in another host window. Reopen it before further edits.');
  before.connections = incoming.connections;
  const names = new Map(incoming.creatures.map((creature) => [creature.id, creature.name]));
  for (const creature of before.creatures)
    if (creature.characterId) creature.name = names.get(creature.id);
  return before;
}
