import { ensureSession } from './SessionLogin.js';
import SessionConnection from '../../campaigns/SessionConnection.js';
import { loadBundledResources } from '../../resources/ResourceSeeds.js';
import PlayerCharacterSheets from './PlayerCharacterSheets.js';
import PublishedMapViewer from './PublishedMapViewer.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

const status = document.querySelector('[aria-label="Player session status"]');
const roster = document.querySelector('[data-assigned-characters]');
const mapSelect = document.querySelector('[aria-label="Location area"]');
const observerSelect = document.querySelector('[aria-label="Active character"]');
const observerNotice = document.querySelector('[data-player-observer-notice]');
const doorControls = document.querySelector('[data-player-doors]');
let sheets;
let viewer;
let connection;
let resources;
let unsubscribe;
let refreshPending = false;
let refreshing = false;
let accessEnded = false;
let selectionVersion = 0;
let selectionRecovery = 0;
let renderedObserverId = null;
let renderedObserverMapId = null;
let doorBusy = false;

function concealView() {
  viewer?.concealTerrain();
  viewer?.clearTokens();
}

function failure(error) {
  concealView();
  status.textContent = error.message;
  GameErrors.input(error, { component: 'PlayerApplication', operation: 'session' });
}

function renderCharacters() {
  roster.replaceChildren();
  const characters = sheets.library.list();
  if (!characters.length) {
    roster.textContent =
      'Waiting for the DM to assign a saved character. You do not need to recreate it.';
    return;
  }
  for (const character of characters) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = character.name;
    button.dataset.assignedCharacter = character.id;
    button.addEventListener('click', () => void sheets.open(character.id).catch(failure));
    roster.append(button);
  }
}

function renderObservers(state) {
  if (
    !Array.isArray(state.observers) ||
    state.observers.some(
      (observer) =>
        !observer ||
        ['id', 'name', 'mapId', 'characterId'].some(
          (key) => typeof observer[key] !== 'string' || !observer[key]
        )
    ) ||
    new Set(state.observers.map((observer) => observer.id)).size !== state.observers.length ||
    (state.observerTokenId !== null &&
      !state.observers.some((observer) => observer.id === state.observerTokenId)) ||
    (state.observerTokenId === null &&
      (state.observers.length > 0 || state.view?.tokens?.length > 0))
  ) {
    concealView();
    throw new Error(
      'The host returned invalid player observer options. Reconnect before viewing creatures.'
    );
  }
  if (state.observerTokenId !== renderedObserverId) concealView();
  renderedObserverId = state.observerTokenId;
  const mapNames = new Map(state.maps.map((map) => [map.id, map.name]));
  observerSelect.replaceChildren(
    ...state.observers.map((observer) => {
      const option = document.createElement('option');
      option.value = observer.id;
      option.textContent = `${observer.name} (${observer.locationName ? `${observer.locationName} / ` : ''}${observer.mapName || mapNames.get(observer.mapId) || observer.mapId})`;
      return option;
    })
  );
  observerSelect.value = state.observerTokenId || '';
  observerSelect.disabled = doorBusy || state.observers.length === 0;
  observerNotice.textContent = state.observerTokenId
    ? 'Sight comes from this character only. Opening a sheet, moving the camera or browsing maps does not change it.'
    : 'The DM must assign and place your saved character in a location before it can provide a viewpoint. Assigned sheets remain available.';
  renderedObserverMapId =
    state.observers.find((observer) => observer.id === state.observerTokenId)?.mapId || null;
}

function renderDoors(state) {
  const doors = state.doors ?? [];
  if (
    !Array.isArray(doors) ||
    doors.some(
      (door) =>
        !door ||
        typeof door.id !== 'string' ||
        !door.id ||
        typeof door.name !== 'string' ||
        typeof door.open !== 'boolean' ||
        typeof door.locked !== 'boolean' ||
        (door.open && door.locked)
    ) ||
    new Set(doors.map((door) => door.id)).size !== doors.length ||
    (state.observerTokenId === null && doors.length > 0)
  )
    throw new Error('The host returned invalid door controls. Reconnect before using a door.');
  doorControls.replaceChildren();
  if (!doors.length) {
    doorControls.textContent = 'No doors within reach of the active character.';
    return;
  }
  for (const door of doors) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.playerDoor = door.id;
    button.textContent = `${door.name}: ${door.locked ? 'Locked (DM unlock required)' : door.open ? 'Close' : 'Open'}`;
    button.disabled = doorBusy || door.locked;
    button.addEventListener('click', () => void useDoor(state, door));
    doorControls.append(button);
  }
}

async function useDoor(state, door) {
  if (doorBusy || accessEnded) return;
  doorBusy = true;
  let error;
  renderDoors(state);
  concealView();
  status.textContent = 'Saving door state on the host...';
  try {
    await sheets.library.flush();
    await connection.call('doorState', [
      state.campaign.id,
      {
        doorId: door.id,
        observerTokenId: state.observerTokenId,
        sceneRevision: state.sceneRevision,
        open: !door.open,
      },
    ]);
  } catch (caught) {
    error = caught;
    failure(caught);
  } finally {
    doorBusy = false;
    await refresh();
    if (error) status.textContent = error.message;
  }
}

async function showState(state, version = selectionVersion) {
  if (version !== selectionVersion) return;
  renderObservers(state);
  renderDoors(state);
  sheets.refresh(state);
  const selected = state.view?.id || '';
  mapSelect.replaceChildren(
    ...state.maps.map((map) => {
      const option = document.createElement('option');
      option.value = map.id;
      option.textContent = map.name;
      return option;
    })
  );
  mapSelect.value = selected;
  mapSelect.disabled = doorBusy || !state.maps.length;
  document.querySelector('[data-player-map-notice]').hidden = !!state.view;
  const location = document.querySelector('[aria-label="Current location"]');
  if (location)
    location.textContent =
      state.location?.name || (state.view ? 'Character location' : 'No placed character');
  await viewer.update(state.view);
  if (version === selectionVersion)
    status.textContent = `${state.profile.name} - ${state.campaign.name} - Connected. Character saves are on the host.`;
}

async function refresh() {
  if (accessEnded) return;
  refreshPending = true;
  if (refreshing) return;
  refreshing = true;
  try {
    while (refreshPending && !accessEnded) {
      refreshPending = false;
      const version = selectionVersion;
      await sheets.library.flush();
      if (version !== selectionVersion) {
        refreshPending = true;
        continue;
      }
      const recovery = selectionRecovery;
      let state;
      try {
        state = await connection.call('playerState', [
          recovery === 2
            ? {}
            : recovery === 1
              ? { observerTokenId: observerSelect.value || null }
              : {
                  mapId: mapSelect.value || null,
                  observerTokenId: observerSelect.value || null,
                  terrainKey: viewer.terrainKey,
                },
        ]);
      } catch (error) {
        if (version !== selectionVersion) {
          refreshPending = true;
          continue;
        }
        if (error.status === 403 && recovery < 2) {
          concealView();
          mapSelect.value = '';
          selectionRecovery = recovery + 1;
          if (selectionRecovery === 2) observerSelect.value = '';
          selectionVersion++;
          refreshPending = true;
          status.textContent =
            'The selected viewpoint or map is no longer available. Requesting the authorized default.';
          GameErrors.input(error, {
            component: 'PlayerApplication',
            operation: 'refreshViewpoint',
          });
          continue;
        }
        throw error;
      }
      if (version !== selectionVersion) {
        refreshPending = true;
        continue;
      }
      const observerMapId = state.observers?.find(
        (observer) => observer.id === state.observerTokenId
      )?.mapId;
      if (
        state.observerTokenId === renderedObserverId &&
        renderedObserverMapId &&
        observerMapId &&
        observerMapId !== renderedObserverMapId &&
        state.view?.id !== observerMapId
      ) {
        concealView();
        mapSelect.value = '';
        selectionRecovery = 1;
        renderedObserverMapId = observerMapId;
        selectionVersion++;
        refreshPending = true;
        continue;
      }
      selectionRecovery = 0;
      await showState(state, version);
    }
  } catch (error) {
    if (error.status === 401) {
      accessEnded = true;
      unsubscribe?.();
      connection.close();
      sheets.destroy();
      roster.textContent = 'Player access ended. Reconnect with a valid invitation.';
      mapSelect.replaceChildren();
      mapSelect.disabled = true;
      observerSelect.replaceChildren();
      observerSelect.disabled = true;
      observerNotice.textContent =
        'Character viewpoints are unavailable until you reconnect with a valid invitation.';
      doorControls.replaceChildren();
      await viewer.update(null);
      status.textContent = error.message;
    } else failure(error);
  } finally {
    refreshing = false;
  }
}

function changeViewSelection(event) {
  selectionVersion++;
  selectionRecovery = 0;
  if (event.target === observerSelect) mapSelect.value = '';
  concealView();
  status.textContent = 'Updating the authorized character view...';
  void refresh();
}

async function start() {
  const identity = await ensureSession();
  connection = new SessionConnection({ identity });
  if (identity.role !== 'player') {
    status.textContent =
      'This browser is signed in as the DM. Use another browser or a private window to test a player.';
    const link = document.createElement('a');
    link.href = './';
    link.textContent = 'Open DM workspace';
    roster.append(link);
    return;
  }
  const state = await connection.call('playerState', [{}]);
  const loaded = await loadBundledResources();
  resources = loaded.resources;
  const catalog = await resources.catalog(state.campaign);
  sheets = new PlayerCharacterSheets({ connection, state, catalog, onChanged: renderCharacters });
  window.gameManager = sheets.manager;
  viewer = new PublishedMapViewer(document.getElementById('player-map-view'));
  await showState(state);
  mapSelect.addEventListener('change', changeViewSelection);
  observerSelect.addEventListener('change', changeViewSelection);
  unsubscribe = connection.subscribe((event) => {
    if (event.type === 'disconnected') {
      status.textContent =
        'Session disconnected. Reconnecting; reload and sign in again if the host restarted.';
      void refresh();
    } else if (event.type === 'invalid-update')
      status.textContent = 'Invalid session update. Reconnect before making further changes.';
    else if (event.type === 'connected' || event.campaignId === state.campaign.id) {
      selectionVersion++;
      concealView();
      void refresh();
    }
  });
}

document.querySelector('[data-player-reconnect]').addEventListener('click', async () => {
  try {
    await sheets?.library.flush();
    location.reload();
  } catch (error) {
    failure(error);
    if (
      window.confirm(
        'The latest character change was not acknowledged. Discard that unsaved change and reconnect?'
      )
    )
      location.reload();
  }
});
window.addEventListener(
  'pagehide',
  () => {
    unsubscribe?.();
    connection?.close();
    sheets?.destroy();
    viewer?.destroy();
    resources?.close();
  },
  { once: true }
);

window.addEventListener('beforeunload', (event) => {
  if (!sheets?.library.isSaving && !sheets?.library.failure) return;
  event.preventDefault();
  event.returnValue = '';
});

document.querySelector('[data-player-signout]').addEventListener('click', async () => {
  try {
    await sheets?.library.flush();
    if (connection && !accessEnded) await connection.logout();
    location.reload();
  } catch (error) {
    failure(error);
  }
});

void start().catch(failure);
