import { notifyCharacterChanged } from '../characters/characterServices.js';
import { isCampaignActionInProgress } from '../../campaigns/SceneWorld.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { prepareSharedDoorScene } from '../../campaigns/CampaignDoorActions.js';

export function attachHostSessionUpdates({ gameManager, services, parent }) {
  const store = services.workspace.store;
  const output = document.createElement('output');
  output.setAttribute('aria-label', 'Shared session status');
  parent.append(output);
  let pending = false;
  let updating = false;
  let closed = false;
  let timer = null;
  let lastKind = null;
  const refresh = async () => {
    if (closed || updating || !pending) return;
    if (
      !services.autosave?.ready ||
      services.library.isSaving ||
      services.library.pendingScenes ||
      isCampaignActionInProgress(gameManager)
    ) {
      output.textContent = 'Player update waiting for the current action/save to finish.';
      timer = setTimeout(() => void refresh(), 250);
      return;
    }
    if (services.autosave.error || services.library.failure || services.autosave.dirty) {
      output.textContent =
        'A shared update is waiting. Resolve the current save or reopen the campaign before continuing.';
      return;
    }
    updating = true;
    pending = false;
    try {
      const state = await store.readCharacters(services.campaign.id);
      const library = services.library;
      if (
        JSON.stringify(state.campaign.sourcePacks) !== JSON.stringify(library.campaign.sourcePacks)
      )
        throw new Error('Campaign sources changed in another host window. Reopen this campaign.');
      let sharedDoors = null;
      if (state.sceneRevision !== library.sceneRevision) {
        const scene = JSON.parse(state.scene);
        if (gameManager.campaignWorld && scene.version === 3)
          sharedDoors = prepareSharedDoorScene(gameManager, scene);
        else if (lastKind !== 'playerCommit')
          throw new Error(
            'The board changed in another host window. Reopen it before further edits.'
          );
      }
      if (state.revision !== library.revision || state.sceneRevision !== library.sceneRevision) {
        library.reload(state);
        if (sharedDoors) {
          try {
            gameManager.campaignWorld.acceptCheckpoint(sharedDoors);
            await gameManager.token3DAdapter.syncMapProjections();
            gameManager.characterServices.combat.syncMovementStatus();
            window.dispatchEvent(
              new CustomEvent('taverntable:campaignViewStateChanged', {
                detail: { gameManager },
              })
            );
          } catch (error) {
            gameManager.campaignMapFailure = new Error(
              'The shared door state could not update locally. Reload the campaign.',
              { cause: error }
            );
            throw gameManager.campaignMapFailure;
          }
        }
        for (const character of library.list()) notifyCharacterChanged(gameManager, character.id);
      }
      output.textContent = 'Player character and door data is up to date.';
    } catch (error) {
      output.textContent = error.message;
      GameErrors.gameState(error, { component: 'HostSessionUpdates', operation: 'refresh' });
    } finally {
      updating = false;
      if (pending) timer = setTimeout(() => void refresh(), 0);
    }
  };
  const unsubscribe = store.subscribeChanges((event) => {
    if (event.type === 'disconnected') {
      output.textContent = 'Session connection interrupted. Reconnecting...';
      return;
    }
    if (event.type === 'invalid-update') {
      output.textContent = 'Invalid shared update. Reopen the campaign before continuing.';
      return;
    }
    if (event.actorId === store.identity.id) return;
    if (event.type === 'connected' || event.campaignId === services.campaign.id) {
      lastKind = event.kind || lastKind;
      pending = true;
      void refresh();
    }
  });
  const dispose = () => {
    closed = true;
    clearTimeout(timer);
    unsubscribe();
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
