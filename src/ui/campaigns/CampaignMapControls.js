import { changeCampaignView } from '../../campaigns/SceneWorld.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { createCampaignLocation } from '../../campaigns/CampaignLocationEditing.js';

function options(select, rows) {
  const signature = JSON.stringify(rows);
  if (select.dataset.options === signature) return;
  select.replaceChildren(
    ...rows.map(([value, label]) => {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      return option;
    })
  );
  select.dataset.options = signature;
}

export default class CampaignMapControls {
  constructor({ gameManager }) {
    this.gameManager = gameManager;
    this.pending = false;
    this.error = null;
    this.root = document.createElement('details');
    this.root.className = 'campaign-map-controls';
    this.loading = document.createElement('div');
    this.loading.className = 'campaign-map-loading';
    this.loading.textContent = 'Changing map view...';
    this.loading.setAttribute('aria-hidden', 'true');
    this.root.innerHTML = `<summary>Maps &amp; focus</summary>
      <div class="campaign-map-panel">
        <label>Location<select aria-label="Viewed location"></select></label>
        <label>Map<select aria-label="Viewed map"></select></label>
        <label>Focus creature<select aria-label="Focused creature"></select></label>
        <button type="button" aria-label="Center focused creature">Center focused creature</button>
        <output role="status" aria-live="polite" aria-label="Map view status"></output>
        <form aria-label="Create independent location">
          <label>New location<input aria-label="New location name" maxlength="100" required></label>
          <button type="submit">Create empty location</button>
        </form>
      </div>`;
    this.location = this.root.querySelector('[aria-label="Viewed location"]');
    this.map = this.root.querySelector('[aria-label="Viewed map"]');
    this.focus = this.root.querySelector('[aria-label="Focused creature"]');
    this.center = this.root.querySelector('[aria-label="Center focused creature"]');
    this.newLocation = this.root.querySelector('form');
    this.status = this.root.querySelector('output');
    this.location.addEventListener('change', () => {
      const world = gameManager.campaignWorld;
      const map = world
        .listMaps()
        .find((entry) => world.getLocationId(entry.id) === this.location.value);
      if (map) void this.change({ mapId: map.id });
    });
    this.newLocation.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.createLocation();
    });
    this.map.addEventListener('change', () => {
      void this.change({ mapId: this.map.value });
    });
    this.focus.addEventListener('change', () => {
      void this.change({ focusTokenId: this.focus.value || null });
    });
    this.center.addEventListener('click', () => {
      void this.change({ focusTokenId: gameManager.campaignView.focusTokenId });
    });
    this.update = (event) => {
      if (event?.type === 'taverntable:campaignViewStateChanged') {
        if (event.detail?.gameManager !== gameManager) return;
        if (gameManager.campaignViewBusy) this.error = null;
      }
      this.render();
    };
    this.unsubscribe = gameManager.sceneAutosave?.subscribe(this.update);
    for (const event of [
      'taverntable:tokenNamesChanged',
      'taverntable:characterChanged',
      'taverntable:campaignViewStateChanged',
    ])
      window.addEventListener(event, this.update);
    this.render();
  }

  render() {
    const gm = this.gameManager;
    this.root.hidden = !gm.campaignWorld && !gm.characterServices?.library?.saveScene;
    if (this.root.hidden) {
      this.loading.remove();
      return;
    }
    const maps = gm.campaignWorld?.listLocationMaps(gm.campaignMapId) || [];
    const allMaps = gm.campaignWorld?.listMaps() || [];
    const names = new Map(allMaps.map((map) => [map.id, map.name]));
    options(
      this.location,
      gm.campaignWorld?.listLocations().map((location) => [location.id, location.name]) || []
    );
    this.location.value = gm.campaignWorld?.getLocationId(gm.campaignMapId) || '';
    options(
      this.map,
      maps.map((map) => [map.id, map.name])
    );
    options(this.focus, [
      ['', 'No focus - browse map'],
      ...gm.placedTokens.map((token) => [
        token.id,
        `${getTokenDisplayName(token)} - ${names.get(token.mapId) || token.mapId}`,
      ]),
    ]);
    this.map.value = gm.campaignMapId;
    const focusId = gm.campaignView?.focusTokenId || null;
    this.focus.value = focusId || '';
    const busy = this.pending || gm.campaignViewBusy;
    this.loading.classList.toggle('campaign-map-presenting', !!gm.campaignTraversalAnimating);
    this.loading.textContent = gm.campaignTraversalAnimating ? '' : 'Changing map view...';
    if (busy) {
      if (!this.loading.isConnected) document.body.append(this.loading);
    } else this.loading.remove();
    const disabled = !!busy || !!gm.campaignMapFailure || gm.sceneAutosave?.ready === false;
    this.location.disabled =
      this.map.disabled =
      this.focus.disabled =
        disabled || !gm.campaignWorld;
    this.center.disabled = disabled || !focusId;
    for (const control of this.newLocation.querySelectorAll('input,button'))
      control.disabled = disabled || !gm.characterServices?.library?.saveScene;
    this.root.setAttribute('aria-busy', String(!!busy));
    const error = this.error || gm.campaignMapFailure;
    this.status.textContent = busy
      ? gm.campaignTraversalAnimating
        ? 'Climbing...'
        : 'Changing map view...'
      : error
        ? error.message
        : gm.campaignWorld
          ? `Viewing ${names.get(gm.campaignMapId)}.${focusId ? ` Focused on ${getTokenDisplayName(gm.placedTokens.find((token) => token.id === focusId))}.` : ' Browsing without creature focus.'}`
          : 'Current board is one location. Create a separate location to enable location browsing.';
    this.status.dataset.state = error ? 'error' : 'ready';
  }

  async createLocation() {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    const field = this.newLocation.querySelector('input');
    const name = field.value;
    this.render();
    try {
      await createCampaignLocation(this.gameManager, name);
      field.value = '';
    } catch (error) {
      this.error = error;
      GameErrors.input(error, { component: 'CampaignMapControls', operation: 'createLocation' });
    } finally {
      this.pending = false;
      this.render();
    }
  }

  async change(selection) {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    this.render();
    try {
      await changeCampaignView(this.gameManager, selection);
    } catch (error) {
      this.error = error;
      GameErrors.input(error, { component: 'CampaignMapControls', operation: 'changeView' });
    } finally {
      this.pending = false;
      this.render();
    }
  }

  dispose() {
    this.unsubscribe?.();
    for (const event of [
      'taverntable:tokenNamesChanged',
      'taverntable:characterChanged',
      'taverntable:campaignViewStateChanged',
    ])
      window.removeEventListener(event, this.update);
    this.root.remove();
    this.loading.remove();
  }
}
