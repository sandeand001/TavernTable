import CampaignWorld from '../../campaigns/CampaignWorld.js';
import { captureCampaignScene } from '../../campaigns/SceneWorld.js';
import { buildLocationOverview } from '../../campaigns/LocationOverview.js';
import { CAVERN_FLOOR_MAX_LEVEL } from '../../terrain/generation/CavernInteriors.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

const SVG = 'http://www.w3.org/2000/svg';
const PIXELS_PER_FOOT = 2;
const SAMPLE_FEET = 2.5;

function element(name, attributes = {}) {
  const node = document.createElementNS(SVG, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
  return node;
}

function levelName(level) {
  return level === 0 ? 'Ground level' : `Level ${level > 0 ? '+' : ''}${level} ft`;
}

function connectionType(kind) {
  return (
    {
      stairs: 'Stairs',
      ladder: 'Ladder',
      door: 'Door',
      window: 'Window',
      opening: 'Opening',
      passage: 'Cavern passage',
    }[kind] || kind
  );
}

function mapTransform(node) {
  const width = node.map.grid.cols * 5 * PIXELS_PER_FOOT;
  const depth = node.map.grid.rows * 5 * PIXELS_PER_FOOT;
  return [
    `matrix(1 0 0 1 ${node.x} ${node.y})`,
    `matrix(0 1 -1 0 ${node.x + depth} ${node.y})`,
    `matrix(-1 0 0 -1 ${node.x + width} ${node.y + depth})`,
    `matrix(0 -1 1 0 ${node.x} ${node.y + width})`,
  ][node.map.quarterTurns];
}

function surfacePaths(world, map) {
  const geometry = world.getMapGeometry(map.id);
  const partition = geometry.getPartition();
  const refine = (cuts) => {
    if (!geometry.hasCurves) return cuts;
    const values = new Set(cuts);
    for (let coordinate = SAMPLE_FEET; coordinate < cuts.at(-1); coordinate += SAMPLE_FEET)
      values.add(coordinate);
    return [...values].sort((a, b) => a - b);
  };
  const xs = refine(partition.x);
  const zs = refine(partition.z);
  const elevationScale = (map.terrain.worldElevationUnit * 5) / map.grid.tileWorldSize;
  const cavern = map.terrain.cavern?.version >= 2;
  const classify = (x, z) => {
    const height = map.terrain.heights[Math.floor(z / 5)][Math.floor(x / 5)];
    if (cavern && height > CAVERN_FLOOR_MAX_LEVEL) return 'rock';
    if (!geometry.hasVolumes && map.base !== 'floor') return null;
    const ground = height * elevationScale;
    const spans = geometry.getSolidSpansAt(x, z);
    if (
      spans.some(
        (span) => span.layerId !== 'stairs' && span.bottom < ground + 2.5 && span.top > ground + 2.5
      )
    )
      return 'wall';
    if (
      map.base === 'floor' &&
      !spans.some((span) => span.bottom < ground + 1e-5 && span.top >= ground - 1e-5)
    )
      return 'void';
    return null;
  };
  const paths = { rock: '', wall: '', void: '' };
  for (let z = 0; z < zs.length - 1; z++) {
    let start = 0;
    let previous = null;
    for (let x = 0; x < xs.length; x++) {
      const current =
        x < xs.length - 1 ? classify((xs[x] + xs[x + 1]) / 2, (zs[z] + zs[z + 1]) / 2) : null;
      if (current === previous) continue;
      if (previous) {
        const left = xs[start] * PIXELS_PER_FOOT;
        const top = zs[z] * PIXELS_PER_FOOT;
        const width = (xs[x] - xs[start]) * PIXELS_PER_FOOT;
        const height = (zs[z + 1] - zs[z]) * PIXELS_PER_FOOT;
        paths[previous] += `M${left} ${top}h${width}v${height}h-${width}Z`;
      }
      start = x;
      previous = current;
    }
  }
  return paths;
}

function drawMap(svg, world, node, creatures, openArea) {
  const map = node.map;
  const width = map.grid.cols * 5 * PIXELS_PER_FOOT;
  const height = map.grid.rows * 5 * PIXELS_PER_FOOT;
  const group = element('g', {
    transform: mapTransform(node),
    'data-overview-map': node.id,
    role: 'button',
    tabindex: '0',
    'aria-label': `Browse ${node.name}, ${levelName(node.level)}`,
  });
  const title = element('title');
  title.textContent = `${node.name} - ${levelName(node.level)}`;
  group.append(title);
  group.append(element('rect', { width, height, class: 'overview-map-floor' }));
  const paths = surfacePaths(world, map);
  for (const kind of ['void', 'rock', 'wall'])
    if (paths[kind])
      group.append(element('path', { d: paths[kind], class: `overview-map-${kind}` }));
  let grid = '';
  for (let x = 1; x < map.grid.cols; x++) grid += `M${x * 10} 0v${height}`;
  for (let z = 1; z < map.grid.rows; z++) grid += `M0 ${z * 10}h${width}`;
  if (grid) group.append(element('path', { d: grid, class: 'overview-map-grid' }));
  for (const structure of map.terrain.geometry?.structures || []) {
    if (structure.kind !== 'wall' || !structure.opening) continue;
    const marker = element('circle', {
      cx: structure.xFeet * PIXELS_PER_FOOT,
      cy: structure.zFeet * PIXELS_PER_FOOT,
      r: 3,
      class: 'overview-door',
      'data-overview-door': structure.id,
    });
    const label = element('title');
    label.textContent = structure.name || 'Doorway';
    marker.append(label);
    group.append(marker);
  }
  for (const creature of creatures.filter((entry) => entry.mapId === map.id)) {
    const position = creature.pose.world;
    const marker = element('circle', {
      cx: (position.x * 5 * PIXELS_PER_FOOT) / map.grid.tileWorldSize,
      cy: (position.z * 5 * PIXELS_PER_FOOT) / map.grid.tileWorldSize,
      r: 4,
      class: `overview-creature overview-creature-${creature.characterId ? 'friendly' : creature.allegiance || 'neutral'}`,
      'data-overview-creature': creature.id,
    });
    const label = element('title');
    label.textContent = creature.name;
    marker.append(label);
    group.append(marker);
  }
  group.append(element('rect', { width, height, class: 'overview-map-outline' }));
  group.addEventListener('click', () => void openArea(node.id));
  group.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    void openArea(node.id);
  });
  svg.append(group);
  const label = element('text', { x: node.x, y: node.y - 7, class: 'overview-map-label' });
  label.textContent = node.name.length > 38 ? `${node.name.slice(0, 35)}...` : node.name;
  svg.append(label);
}

function connectionIcon(svg, point, connection, destination) {
  const group = element('g', {
    transform: `translate(${point.x} ${point.y})`,
    'data-overview-connection': connection.id,
    'data-kind': connection.kind,
    class: 'overview-connection-marker',
  });
  const label = element('title');
  label.textContent = `${connectionType(connection.kind)}: ${connection.name} to ${destination.name} (${levelName(destination.level)})`;
  group.append(label, element('circle', { r: 7 }));
  const shape =
    connection.kind === 'stairs'
      ? 'M-4 4h3V1h3v-3h3'
      : connection.kind === 'ladder'
        ? 'M-3 -5v10M3 -5v10M-3 -3h6M-3 0h6M-3 3h6'
        : connection.kind === 'door'
          ? 'M-4 -5v10M-4 -4a8 8 0 0 1 8 8'
          : connection.kind === 'window'
            ? 'M-5 -3h10v6H-5zM0 -3v6'
            : 'M-5 -3h10M-5 3h10';
  group.append(element('path', { d: shape }));
  svg.append(group);
}

export default class LocationOverviewView {
  constructor({ gameManager, onViewMap }) {
    this.gameManager = gameManager;
    this.onViewMap = onViewMap;
    this.generation = 0;
    this.browsing = false;
    this.zoom = 1;
    this.root = document.createElement('section');
    this.root.className = 'location-overview';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'DM location overview');
    this.root.innerHTML = `<div class="location-overview-dialog">
      <header>
        <h2>Location overview <small>DM only</small></h2>
        <button type="button" aria-label="Close location overview">Close</button>
      </header>
      <div class="location-overview-toolbar">
        <label>Location <select aria-label="Overview location"></select></label>
        <button type="button" aria-label="Zoom out overview">-</button>
        <button type="button" aria-label="Zoom in overview">+</button>
        <button type="button" aria-label="Fit overview">Fit</button>
        <button type="button" aria-label="Refresh overview">Refresh</button>
      </div>
      <p>Scroll to pan. Select an area to browse without moving creatures. Gold marks connections; refresh updates this snapshot.</p>
      <output role="status" aria-live="polite"></output>
      <div class="location-overview-content">
        <div class="location-overview-viewport" role="region" aria-label="Connected area map" tabindex="0"></div>
        <aside>
          <strong>Areas</strong>
          <ul data-overview-areas></ul>
          <strong>Connections</strong>
          <ul data-overview-links></ul>
        </aside>
      </div>
    </div>`;
    this.location = this.root.querySelector('[aria-label="Overview location"]');
    this.viewport = this.root.querySelector('[aria-label="Connected area map"]');
    this.areaList = this.root.querySelector('[data-overview-areas]');
    this.linkList = this.root.querySelector('[data-overview-links]');
    this.status = this.root.querySelector('output');
    this.closeButton = this.root.querySelector('[aria-label="Close location overview"]');
    this.closeButton.addEventListener('click', () => this.close());
    this.location.addEventListener('change', () => {
      try {
        this.render();
        this.fitZoom();
        this.status.textContent = '';
      } catch (error) {
        this.status.textContent = error.message;
        GameErrors.input(error, { component: 'LocationOverviewView', operation: 'changeLocation' });
      }
    });
    this.root.querySelector('[aria-label="Zoom out overview"]').addEventListener('click', () => {
      this.zoom = Math.max(0.03, this.zoom / 1.25);
      this.applyZoom();
    });
    this.root.querySelector('[aria-label="Zoom in overview"]').addEventListener('click', () => {
      this.zoom = Math.min(3, this.zoom * 1.25);
      this.applyZoom();
    });
    this.root
      .querySelector('[aria-label="Fit overview"]')
      .addEventListener('click', () => this.fitZoom());
    this.root
      .querySelector('[aria-label="Refresh overview"]')
      .addEventListener('click', () => void this.refresh());
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
        return;
      }
      if (event.key === 'Tab') {
        const controls = [
          ...this.root.querySelectorAll('button:not(:disabled), select, [tabindex="0"]'),
        ];
        const first = controls[0];
        const last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    });
    document.body.append(this.root);
  }

  async open() {
    const gm = this.gameManager;
    const library = gm.characterServices?.library;
    if (!gm.campaignWorld || !library) throw new Error('Open a campaign to view its locations');
    const generation = ++this.generation;
    const scene = await captureCampaignScene(gm, library);
    if (generation !== this.generation) return;
    this.world = CampaignWorld.fromScene(scene, { ruleset: library.ruleset, library });
    this.scene = scene;
    this.populateLocations(this.world.getLocationId(gm.campaignMapId));
    this.zoom = 1;
    this.returnFocus = document.activeElement;
    this.root.hidden = false;
    try {
      this.render();
      this.fitZoom();
      this.status.textContent = '';
    } catch (error) {
      this.root.hidden = true;
      throw error;
    }
    this.closeButton.focus();
  }

  populateLocations(selected) {
    this.location.replaceChildren(
      ...this.world.listLocations().map(({ id, name }) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        return option;
      })
    );
    this.location.value = selected;
  }

  render() {
    const overview = buildLocationOverview(this.scene, this.location.value);
    this.overview = overview;
    const svg = element('svg', {
      viewBox: `0 0 ${overview.width} ${overview.height}`,
      'aria-label': 'Top-down connected areas',
    });
    const nodes = new Map(overview.nodes.map((node) => [node.id, node]));
    for (const { level, y } of overview.levels) {
      const heading = element('text', { x: 24, y: y + 15, class: 'overview-level-label' });
      heading.textContent = levelName(level);
      svg.append(heading);
    }
    for (const edge of overview.edges) {
      const [a, b] = edge.points;
      const middle = (a.x + b.x) / 2;
      svg.append(
        element('path', {
          d: `M${a.x} ${a.y}H${middle}V${b.y}H${b.x}`,
          class: 'overview-link',
        })
      );
    }
    for (const node of overview.nodes)
      drawMap(svg, this.world, node, this.scene.creatures, (id) => this.browse(id));
    for (const edge of overview.edges) {
      connectionIcon(svg, edge.points[0], edge, nodes.get(edge.ends[1].mapId));
      connectionIcon(svg, edge.points[1], edge, nodes.get(edge.ends[0].mapId));
    }
    this.viewport.replaceChildren(svg);
    this.areaList.replaceChildren(
      ...overview.nodes.map((node) => {
        const item = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = `${node.name} - ${levelName(node.level)}`;
        button.addEventListener('click', () => void this.browse(node.id));
        item.append(button);
        return item;
      })
    );
    this.linkList.replaceChildren(
      ...overview.edges.map((edge) => {
        const [first, second] = edge.ends.map((end) => nodes.get(end.mapId));
        const item = document.createElement('li');
        item.textContent = `${connectionType(edge.kind)} - ${edge.name}: ${first.name} (${levelName(first.level)}) - ${second.name} (${levelName(second.level)})`;
        return item;
      })
    );
    if (!overview.edges.length) {
      const item = document.createElement('li');
      item.textContent = 'No connected areas';
      this.linkList.append(item);
    }
    this.applyZoom();
  }

  async refresh() {
    const gm = this.gameManager;
    const library = gm.characterServices.library;
    const selected = this.location.value;
    const generation = ++this.generation;
    this.status.textContent = 'Refreshing overview...';
    try {
      const scene = await captureCampaignScene(gm, library);
      if (generation !== this.generation) return;
      const world = CampaignWorld.fromScene(scene, { ruleset: library.ruleset, library });
      if (!world.listLocations().some((location) => location.id === selected))
        throw new Error('The selected location is no longer available');
      this.scene = scene;
      this.world = world;
      this.populateLocations(selected);
      this.render();
      this.status.textContent = 'Overview updated.';
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.textContent = error.message;
      GameErrors.input(error, { component: 'LocationOverviewView', operation: 'refresh' });
    }
  }

  applyZoom() {
    const svg = this.viewport.querySelector('svg');
    if (!svg || !this.overview) return;
    svg.setAttribute('width', String(this.overview.width * this.zoom));
    svg.setAttribute('height', String(this.overview.height * this.zoom));
  }

  fitZoom() {
    const width = this.viewport.clientWidth;
    const height = this.viewport.clientHeight;
    if (width > 0 && height > 0 && this.overview) {
      this.zoom = Math.max(
        0.03,
        Math.min(3, (width - 8) / this.overview.width, (height - 8) / this.overview.height)
      );
    }
    this.applyZoom();
  }

  async browse(id) {
    if (this.browsing) return;
    this.browsing = true;
    const generation = this.generation;
    try {
      const changed = await this.onViewMap(id);
      if (generation !== this.generation) return;
      if (changed) this.close();
      else this.status.textContent = 'The map view could not be changed.';
    } catch (error) {
      if (generation !== this.generation) return;
      this.status.textContent = error.message;
      GameErrors.input(error, { component: 'LocationOverviewView', operation: 'browseArea' });
    } finally {
      this.browsing = false;
    }
  }

  close() {
    this.generation++;
    this.root.hidden = true;
    this.returnFocus?.focus?.();
  }

  dispose() {
    this.close();
    this.root.remove();
    this.scene = null;
    this.world = null;
  }
}
