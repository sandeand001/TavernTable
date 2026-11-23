import { changeCampaignView } from '../../campaigns/SceneWorld.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { createCampaignLocation } from '../../campaigns/CampaignLocationEditing.js';
import {
  createCampaignCavernArea,
  createCampaignLogicalCavernArea,
} from '../../campaigns/CampaignCavernEditing.js';
import { oppositeCavernSide } from '../../terrain/generation/CavernInteriors.js';
import { occupiedCavernSides } from '../../campaigns/CampaignLogicalPassages.js';
import LocationOverviewView from './LocationOverviewView.js';

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
  constructor({ gameManager, onPassage = null }) {
    this.gameManager = gameManager;
    this.onPassage = onPassage;
    this.pending = false;
    this.pendingViews = 0;
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
        <button type="button" aria-label="Open location overview">Location overview</button>
        <label>Focus creature<select aria-label="Focused creature"></select></label>
        <button type="button" aria-label="Center focused creature">Center focused creature</button>
        <output role="status" aria-live="polite" aria-label="Map view status"></output>
        <p data-logical-passage-help hidden>Gold circles mark passages. Select a creature and click one to travel.</p>
        <div aria-label="Cavern passages" data-logical-passage-list></div>
        <form aria-label="Create independent location">
          <label>New location<input aria-label="New location name" maxlength="100" required></label>
          <button type="submit">Create empty location</button>
        </form>
        <form aria-label="Add connected cavern area" hidden>
          <p>Physical area: generated immediately beside this map.</p>
          <label>New cavern area<input aria-label="Cavern area name" maxlength="100" placeholder="Optional name"></label>
          <label>Area type<select aria-label="Cavern area type"><option value="chamber">Cavern chamber</option><option value="tunnel">Winding tunnel</option></select></label>
          <label>Side<select aria-label="Cavern passage side"><option value="south">South</option><option value="west">West</option><option value="north">North</option><option value="east">East</option></select></label>
          <button type="submit">Add physical tunnel / chamber</button>
        </form>
        <form aria-label="Add blank linked cavern area" hidden>
          <p>New logical areas start blank in separate locations. Outside destinations can be shared.</p>
          <label>New linked area<input aria-label="Linked area name" maxlength="100" placeholder="Optional name"></label>
          <label>Destination type<select aria-label="Linked area type"><option value="chamber">Blank chamber</option><option value="outside">Blank outside map</option></select></label>
          <label>Main entrance<select aria-label="Linked cavern entrance"><option value="north">North</option><option value="east">East</option><option value="south">South</option><option value="west">West</option></select></label>
          <label data-outside-destination hidden>Outside destination<select aria-label="Linked outside destination"></select></label>
          <button type="submit">Add blank linked area</button>
        </form>
      </div>`;
    this.location = this.root.querySelector('[aria-label="Viewed location"]');
    this.map = this.root.querySelector('[aria-label="Viewed map"]');
    this.overviewButton = this.root.querySelector('[aria-label="Open location overview"]');
    this.overview = new LocationOverviewView({
      gameManager,
      onViewMap: async (id) => {
        await this.change({ mapId: id });
        return !this.error;
      },
    });
    this.overviewButton.addEventListener('click', () => void this.openOverview());
    this.focus = this.root.querySelector('[aria-label="Focused creature"]');
    this.center = this.root.querySelector('[aria-label="Center focused creature"]');
    this.newLocation = this.root.querySelector('[aria-label="Create independent location"]');
    this.newCavern = this.root.querySelector('[aria-label="Add connected cavern area"]');
    this.newLogical = this.root.querySelector('[aria-label="Add blank linked cavern area"]');
    this.status = this.root.querySelector('output');
    this.passageList = this.root.querySelector('[data-logical-passage-list]');
    this.passageList.addEventListener('click', (event) => {
      const button = event.target.closest('[data-logical-passage]');
      if (!button || button.disabled || !this.onPassage) return;
      const rect = button.getBoundingClientRect();
      this.onPassage(button.dataset.logicalPassage, { clientX: rect.left, clientY: rect.bottom });
    });
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
    this.newCavern.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.createCavernArea();
    });
    this.newLogical.addEventListener('submit', (event) => {
      event.preventDefault();
      void this.createLogicalArea();
    });
    this.newLogical
      .querySelector('[aria-label="Linked area type"]')
      .addEventListener('change', () => this.render());
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
    const unavailable = !!gm.campaignMapFailure || gm.sceneAutosave?.ready === false;
    const disabled = !!busy || unavailable;
    this.location.disabled =
      this.map.disabled =
      this.focus.disabled =
        unavailable || !gm.campaignWorld;
    this.center.disabled = unavailable || !focusId;
    this.overviewButton.disabled = disabled || !gm.campaignWorld;
    for (const control of this.newLocation.querySelectorAll('input,button'))
      control.disabled = disabled || !gm.characterServices?.library?.saveScene;
    this.newCavern.hidden = !gm.campaignWorld || !gm.terrainEngine?.cavern;
    const used = new Set(
      (gm.campaignWorld?.getConnections(gm.campaignMapId) || [])
        .filter((connection) => connection.cavern)
        .map((connection) =>
          connection.cavern.parentMapId === gm.campaignMapId
            ? connection.cavern.side
            : oppositeCavernSide(connection.cavern.side)
        )
    );
    const logicalPassages = gm.campaignWorld?.getLogicalPassages?.(gm.campaignMapId) || [];
    const passageRows = logicalPassages.map((passage) => {
      const end = passage.ends?.find((entry) => entry.mapId === gm.campaignMapId) || passage;
      return { id: passage.id, side: end.side };
    });
    const passageSignature = JSON.stringify(passageRows);
    if (this.passageList.dataset.signature !== passageSignature) {
      this.passageList.replaceChildren(
        ...passageRows.map(({ id, side }) => {
          const button = document.createElement('button');
          button.type = 'button';
          button.dataset.logicalPassage = id;
          button.textContent = `Use ${side} passage`;
          return button;
        })
      );
      this.passageList.dataset.signature = passageSignature;
    }
    for (const button of this.passageList.querySelectorAll('button'))
      button.disabled = disabled || !this.onPassage;
    for (const passage of logicalPassages) {
      const end = passage.ends?.find((entry) => entry.mapId === gm.campaignMapId) || passage;
      used.add(end.side);
    }
    this.root.querySelector('[data-logical-passage-help]').hidden = !logicalPassages.length;
    const side = this.newCavern.querySelector('[aria-label="Cavern passage side"]');
    for (const option of side.options) option.disabled = used.has(option.value);
    if (used.has(side.value))
      side.value = [...side.options].find((option) => !option.disabled)?.value || '';
    for (const control of this.newCavern.querySelectorAll('input,select,button'))
      control.disabled = disabled || !side.value || !gm.characterServices?.library?.saveScene;
    this.newLogical.hidden =
      !gm.campaignWorld ||
      !gm.terrainEngine?.cavern ||
      !!gm.campaignWorld.getMap(gm.campaignMapId).building;
    const logicalSide = this.newLogical.querySelector('[aria-label="Linked cavern entrance"]');
    const exits = new Set(gm.terrainEngine?.cavern?.exits || []);
    for (const option of logicalSide.options)
      option.disabled = !exits.has(option.value) || used.has(option.value);
    if (!logicalSide.value || logicalSide.selectedOptions[0]?.disabled)
      logicalSide.value = [...logicalSide.options].find((option) => !option.disabled)?.value || '';
    const logicalKind = this.newLogical.querySelector('[aria-label="Linked area type"]').value;
    const destinationLabel = this.newLogical.querySelector('[data-outside-destination]');
    destinationLabel.hidden = logicalKind !== 'outside';
    const destination = this.newLogical.querySelector('[aria-label="Linked outside destination"]');
    const scene = gm.campaignWorld?.save();
    const outsideIds = new Set(
      (scene?.logicalPassages || [])
        .filter((passage) => passage.kind === 'outside')
        .map((passage) => passage.ends[1].mapId)
    );
    options(destination, [
      ['', 'Create a new outside map'],
      ...[...outsideIds]
        .filter((id) => occupiedCavernSides(scene, id).size < 4)
        .map((id) => [id, names.get(id) || id]),
    ]);
    for (const control of this.newLogical.querySelectorAll('input,select,button'))
      control.disabled =
        disabled ||
        !logicalSide.value ||
        !gm.characterServices?.library?.saveScene ||
        (control === destination && logicalKind !== 'outside');
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

  async openOverview() {
    this.error = null;
    try {
      await this.overview.open();
    } catch (error) {
      this.error = error;
      GameErrors.input(error, { component: 'CampaignMapControls', operation: 'locationOverview' });
      this.render();
    }
  }

  async createCavernArea() {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    const field = this.newCavern.querySelector('[aria-label="Cavern area name"]');
    const options = {
      name: field.value,
      side: this.newCavern.querySelector('[aria-label="Cavern passage side"]').value,
      kind: this.newCavern.querySelector('[aria-label="Cavern area type"]').value,
    };
    this.render();
    try {
      await createCampaignCavernArea(this.gameManager, options);
      field.value = '';
    } catch (error) {
      this.error = error;
      GameErrors.input(error, { component: 'CampaignMapControls', operation: 'createCavernArea' });
    } finally {
      this.pending = false;
      this.render();
    }
  }

  async createLogicalArea() {
    if (this.pending) return;
    this.pending = true;
    this.error = null;
    const field = this.newLogical.querySelector('[aria-label="Linked area name"]');
    const kind = this.newLogical.querySelector('[aria-label="Linked area type"]').value;
    const options = {
      name: field.value,
      side: this.newLogical.querySelector('[aria-label="Linked cavern entrance"]').value,
      kind,
      ...(kind === 'outside'
        ? {
            outsideMapId:
              this.newLogical.querySelector('[aria-label="Linked outside destination"]').value ||
              null,
          }
        : {}),
    };
    this.render();
    try {
      await createCampaignLogicalCavernArea(this.gameManager, options);
      field.value = '';
    } catch (error) {
      this.error = error;
      GameErrors.input(error, { component: 'CampaignMapControls', operation: 'createLogicalArea' });
    } finally {
      this.pending = false;
      this.render();
    }
  }

  async change(selection) {
    this.pendingViews++;
    this.pending = true;
    this.error = null;
    this.render();
    try {
      await changeCampaignView(this.gameManager, selection);
    } catch (error) {
      this.error = error;
      GameErrors.input(error, { component: 'CampaignMapControls', operation: 'changeView' });
    } finally {
      this.pendingViews--;
      this.pending = this.pendingViews > 0;
      this.render();
    }
  }

  dispose() {
    this.overview.dispose();
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
