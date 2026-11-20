import { notifyCharacterChanged } from '../characters/characterServices.js';
import { isCampaignActionInProgress } from '../../campaigns/SceneWorld.js';
import {
  samePlacement,
  sceneActorPlacement,
  coalesceMovementPresentations,
} from '../../scene/token-adapter/SavedPlacements.js';
import {
  validateLivePlayerPresentation,
  validatePlayerMotion,
  validatePlayerVisual,
} from '../../campaigns/PlayerPublicProtocol.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export function attachHostSessionUpdates({
  gameManager,
  services,
  parent,
  store = services.workspace.store,
}) {
  const output = document.createElement('output');
  output.setAttribute('aria-label', 'Shared session status');
  parent.append(output);
  const discard = document.createElement('button');
  discard.type = 'button';
  discard.dataset.discardSharedDraft = '';
  discard.textContent = 'Discard local changes and refresh';
  discard.hidden = true;
  parent.append(discard);
  let pending = false;
  let updating = false;
  let closed = false;
  let timer = null;
  let lastKind = null;
  let presentations = [];
  let initialCheckpointReady = services.autosave.ready;
  const conflictingWork = () =>
    services.autosave?.dirty ||
    services.autosave?.writing ||
    services.autosave?.error ||
    services.autosave?.sharedConflict ||
    services.library.failure ||
    services.library.isSaving ||
    services.library.pendingScenes;
  const saveInProgress = () =>
    !!(services.autosave?.writing || services.library.isSaving || services.library.pendingScenes);
  const pauseConflict = () => {
    pending = true;
    const error = services.autosave.pauseForSharedUpdate();
    output.textContent = `Paused / conflict: ${error.message}`;
  };
  const presentImmediately = (entry, { live = false } = {}) => {
    try {
      if (live) validateLivePlayerPresentation(entry);
      else if (entry.motion) validatePlayerMotion(entry.motion);
      const token = gameManager.placedTokens.find(({ id }) => id === entry.tokenId);
      if (!token) return;
      if (entry.kind === 'move-finish') {
        gameManager.token3DAdapter.finishApprovedMovement?.(token, entry.placement);
        return;
      }
      if (entry.kind !== 'move') return;
      void gameManager.token3DAdapter
        .playApprovedMovement(token, {
          tokenId: entry.tokenId,
          commandId: entry.commandId,
          ...entry.motion,
          continuing: entry.motion.completed === false ? entry.motion.continuing : true,
          holdUntilFinish: entry.motion.completed === true,
        })
        .catch((error) =>
          GameErrors.rendering(error, {
            component: 'HostSessionUpdates',
            operation: live ? 'livePresentation' : 'acceptedPresentation',
            tokenId: entry.tokenId,
          })
        );
    } catch (error) {
      GameErrors.gameState(error, {
        component: 'HostSessionUpdates',
        operation: live ? 'readLivePresentation' : 'readAcceptedPresentation',
      });
    }
  };
  const applyState = async (state, options = {}) => {
    const library = services.library;
    const scene = state.scene ? JSON.parse(state.scene) : null;
    const maps = new Map(
      (scene?.version === 3 ? scene.maps : scene ? [{ id: 'map-main', grid: scene.grid }] : []).map(
        (map) => [map.id, map]
      )
    );
    const movements = [];
    const visuals = [];
    const eligible = [];
    for (const entry of presentations) {
      if (
        !entry ||
        typeof entry.commandId !== 'string' ||
        !/^[a-zA-Z0-9_-]{8,100}$/.test(entry.commandId) ||
        typeof entry.tokenId !== 'string' ||
        !Number.isSafeInteger(entry.sceneRevision) ||
        !Number.isSafeInteger(entry.charactersRevision) ||
        entry.sceneRevision < 0 ||
        entry.charactersRevision < 0
      )
        throw new Error('The host returned an invalid shared movement notice');
      if (
        options.discardLocal ||
        entry.sceneRevision <= library.sceneRevision ||
        entry.sceneRevision > state.sceneRevision ||
        entry.charactersRevision > state.revision
      )
        continue;
      if (entry.kind === 'emote') {
        validatePlayerVisual(entry, maps);
        const actor = scene?.creatures.find((actor) => actor.id === entry.tokenId);
        if (!actor || !samePlacement(entry.placement, sceneActorPlacement(scene, actor)))
          throw new Error('The shared visual action does not match its committed creature');
        visuals.push(entry);
        continue;
      }
      validatePlayerMotion(entry.motion, maps);
      eligible.push(entry);
    }
    for (const entry of coalesceMovementPresentations(eligible)) {
      const actor = scene?.creatures.find(({ id }) => id === entry.tokenId);
      const token = gameManager.placedTokens.find(({ id }) => id === entry.tokenId);
      const current = token && {
        mapId: token.mapId ?? 'map-main',
        gridX: token.gridX,
        gridY: token.gridY,
        world: token.world,
      };
      if (
        actor &&
        token?.__threeMesh &&
        (!gameManager.campaignWorld ||
          gameManager.campaignWorld.sharesLocation(
            gameManager.campaignMapId,
            entry.motion.from.mapId
          )) &&
        !gameManager.token3DAdapter._approvedMovements?.has(token) &&
        !gameManager.token3DAdapter._approvedMovementRequests?.has(token) &&
        samePlacement(current, entry.motion.from) &&
        samePlacement(entry.motion.route.at(-1), sceneActorPlacement(scene, actor))
      )
        movements.push({ tokenId: entry.tokenId, commandId: entry.commandId, ...entry.motion });
    }
    if (JSON.stringify(state.campaign.sourcePacks) !== JSON.stringify(library.campaign.sourcePacks))
      throw new Error('Campaign sources changed in another host window. Reopen this campaign.');
    if (options.rebaseShared)
      await services.autosave.rebaseSharedUpdate(state, {
        allowMovementInProgress: options.preserveMovingActors === true,
      });
    if (
      !options.discardLocal &&
      state.sceneRevision !== library.sceneRevision &&
      !['playerCommit', 'playerCommand', 'doorState'].includes(lastKind) &&
      !movements.length &&
      !visuals.length
    )
      throw new Error('The board changed in another host window. Reopen it before further edits.');
    if (
      options.discardLocal ||
      state.revision !== library.revision ||
      state.sceneRevision !== library.sceneRevision
    ) {
      if (options.discardLocal || state.sceneRevision !== library.sceneRevision)
        await services.autosave.reconcile(state, options);
      else library.reload(state);
      services.campaign = library.campaign;
      for (const character of library.list()) notifyCharacterChanged(gameManager, character.id);
    }
    for (const actor of scene?.creatures || []) {
      const token = gameManager.placedTokens.find(({ id }) => id === actor.id);
      if (!token) continue;
      gameManager.token3DAdapter.finishApprovedMovement?.(token, sceneActorPlacement(scene, actor));
    }
    presentations = presentations.filter((entry) => entry.sceneRevision > state.sceneRevision);
    await Promise.all(
      movements.map((motion) =>
        gameManager.token3DAdapter.playApprovedMovement(
          gameManager.placedTokens.find(({ id }) => id === motion.tokenId),
          motion
        )
      )
    );
    for (const entry of visuals) {
      if (closed) return;
      await gameManager.token3DAdapter.playApprovedVisual(
        gameManager.placedTokens.find((token) => token.id === entry.tokenId),
        entry
      );
    }
    output.textContent = 'Shared scene and character data are up to date.';
  };
  const refresh = async () => {
    if (closed || updating || !pending) return;
    if (!initialCheckpointReady) {
      output.textContent = services.autosave.status.text;
      return;
    }
    if (isCampaignActionInProgress(gameManager, { allowMovementCheckpoint: true })) {
      pending = true;
      output.textContent =
        'Waiting for the current DM action to finish before applying the player update.';
      timer = setTimeout(() => void refresh(), 100);
      return;
    }
    const canRebase =
      services.autosave.canRebaseSharedUpdate?.({ allowMovementInProgress: true }) === true;
    if (saveInProgress() && !canRebase) {
      pending = true;
      output.textContent = 'Player update waiting for the current save to finish.';
      timer = setTimeout(() => void refresh(), 50);
      return;
    }
    if (conflictingWork() && !canRebase) {
      pauseConflict();
      return;
    }
    if (!services.autosave?.ready) {
      output.textContent = 'Player update waiting for the current action/save to finish.';
      timer = setTimeout(() => void refresh(), 250);
      return;
    }
    updating = true;
    pending = false;
    try {
      const state = await store.readCharacters(services.campaign.id);
      if (closed) return;
      if (isCampaignActionInProgress(gameManager, { allowMovementCheckpoint: true })) {
        pending = true;
        return;
      }
      const rebaseShared =
        services.autosave.canRebaseSharedUpdate?.({ allowMovementInProgress: true }) === true;
      if (saveInProgress() && !rebaseShared) {
        pending = true;
        return;
      }
      if (conflictingWork() && !rebaseShared) {
        pauseConflict();
        return;
      }
      const movementActive = isCampaignActionInProgress(gameManager);
      const preserveMovingActors =
        movementActive &&
        (rebaseShared ||
          services.autosave.canReconcileSharedUpdate?.(state, {
            allowMovementInProgress: true,
          }) === true);
      if (movementActive && !preserveMovingActors) {
        pauseConflict();
        return;
      }
      await applyState(state, {
        rebaseShared,
        preserveMovingActors,
      });
    } catch (error) {
      for (const token of gameManager.placedTokens)
        if (gameManager.token3DAdapter._approvedMovements?.get(token)?.holdUntilFinish)
          gameManager.token3DAdapter.cancelApprovedMovement(token);
      output.textContent = error.message;
      GameErrors.gameState(error, { component: 'HostSessionUpdates', operation: 'refresh' });
    } finally {
      updating = false;
      updateDiscard();
      if (pending && !services.autosave.sharedConflict) timer = setTimeout(() => void refresh(), 0);
    }
  };
  const updateDiscard = () => {
    discard.hidden = !services.autosave.sharedConflict;
    discard.disabled =
      updating ||
      !services.autosave.ready ||
      !!services.autosave.writing ||
      services.library.isSaving ||
      !!services.library.pendingScenes ||
      isCampaignActionInProgress(gameManager);
  };
  const unsubscribeSave = services.autosave.subscribe((status) => {
    if (status.state === 'saved') initialCheckpointReady = true;
    updateDiscard();
    if (pending && !services.autosave.sharedConflict && !updating) void refresh();
  });
  const discardDraft = async () => {
    if (closed || discard.disabled || !services.autosave.sharedConflict) return;
    if (
      !window.confirm(
        'Discard local unsaved campaign changes and load the current host state? No local changes will be saved or automatically merged.'
      )
    )
      return;
    const expectedGeneration = services.autosave.generation;
    updating = true;
    pending = false;
    updateDiscard();
    try {
      const state = await store.readCharacters(services.campaign.id);
      if (closed) return;
      await applyState(state, { discardLocal: true, expectedGeneration });
    } catch (error) {
      pending = true;
      output.textContent = error.message;
      GameErrors.gameState(error, {
        component: 'HostSessionUpdates',
        operation: 'discardAndRefresh',
      });
    } finally {
      updating = false;
      updateDiscard();
      if (pending && !services.autosave.sharedConflict) void refresh();
    }
  };
  discard.addEventListener('click', discardDraft);
  const unsubscribe = store.subscribeChanges((event) => {
    if (event.type === 'live-presentations') {
      if (event.campaignId !== services.campaign.id || !Array.isArray(event.presentations)) return;
      for (const entry of event.presentations) presentImmediately(entry, { live: true });
      return;
    }
    if (event.type === 'disconnected') {
      output.textContent = 'Session connection interrupted. Reconnecting...';
      return;
    }
    if (event.type === 'invalid-update') {
      output.textContent = 'Invalid shared update. Reopen the campaign before continuing.';
      return;
    }
    const local =
      typeof store.isLocalChange === 'function'
        ? store.isLocalChange(event)
        : event.actorId === store.identity.id;
    if (local && event.reconcile !== true) return;
    if (event.reconcile === true) {
      presentations = [];
      for (const token of gameManager.placedTokens)
        gameManager.token3DAdapter.cancelApprovedMovement(token);
    }
    if (event.type === 'connected' || event.campaignId === services.campaign.id) {
      if (event.presentations !== undefined) {
        if (!Array.isArray(event.presentations)) {
          const error = new Error('The host returned an invalid shared movement list');
          output.textContent = error.message;
          GameErrors.gameState(error, {
            component: 'HostSessionUpdates',
            operation: 'readPresentations',
          });
          return;
        }
        presentations = [...presentations, ...event.presentations].slice(-256);
        for (const entry of event.presentations) presentImmediately(entry);
      }
      lastKind = event.kind || lastKind;
      pending = true;
      void refresh();
    }
  });
  const dispose = () => {
    closed = true;
    clearTimeout(timer);
    unsubscribe();
    unsubscribeSave();
    discard.removeEventListener('click', discardDraft);
    window.removeEventListener('pagehide', dispose);
  };
  window.addEventListener('pagehide', dispose, { once: true });
  return dispose;
}
