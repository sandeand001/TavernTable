import CreatureLocations from '../../campaigns/CreatureLocations.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import { changeCampaignView } from '../../campaigns/SceneWorld.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

const ROW_WIDTH = 234;
const ROW_HEIGHT = 48;
const TOKEN_SIZE = 36;

export function tacticalFootprintContains(map, position, structure = null) {
  const scale = 5 / map.grid.tileWorldSize;
  const x = position.x * scale;
  const z = position.z * scale;
  if (!Number.isFinite(x) || !Number.isFinite(z))
    throw new Error('A tactical marker requires a finite physical position');
  if (!map.building) return x >= 0 && z >= 0 && x < map.grid.cols * 5 && z < map.grid.rows * 5;
  const { offsetX, offsetZ, lengthFeet, widthFeet } = map.building;
  const localX = x - offsetX;
  const localZ = z - offsetZ;
  if (localX < 0 || localZ < 0 || localX >= lengthFeet || localZ >= widthFeet) return false;
  if (structure?.kind === 'turret') {
    const radius = lengthFeet / 2;
    for (let side = 0; side < 16; side++) {
      const angle = (side * Math.PI) / 8;
      if (
        (localX - radius) * Math.cos(angle) + (localZ - widthFeet / 2) * Math.sin(angle) >
        radius * Math.cos(Math.PI / 16) + 1e-6
      )
        return false;
    }
  }
  return true;
}

export function layoutOverviewTokens(points, viewport) {
  const result = [];
  for (const point of [...points].sort((a, b) => a.y - b.y || a.id.localeCompare(b.id))) {
    let x = Math.max(
      viewport.left + 4,
      Math.min(point.x - TOKEN_SIZE / 2, viewport.right - ROW_WIDTH)
    );
    let y = Math.max(viewport.top + 4, point.y - TOKEN_SIZE / 2);
    for (let attempt = 0; attempt <= result.length; attempt++) {
      const collision = result.find(
        (other) =>
          x < other.x + ROW_WIDTH &&
          x + ROW_WIDTH > other.x &&
          y < other.y + ROW_HEIGHT &&
          y + ROW_HEIGHT > other.y
      );
      if (!collision) break;
      y = collision.y + ROW_HEIGHT;
      if (y + ROW_HEIGHT > viewport.bottom) {
        x =
          x + ROW_WIDTH <= viewport.right - ROW_WIDTH
            ? x + ROW_WIDTH
            : Math.max(viewport.left + 4, x - ROW_WIDTH);
        y = viewport.top + 4;
      }
    }
    result.push({ ...point, x, y });
  }
  return result;
}

export default class TacticalOverview {
  constructor(gameManager, three) {
    this.gameManager = gameManager;
    this.three = three;
    this.locations = new CreatureLocations(gameManager.campaignWorld);
    this.unsubscribe = gameManager.terrainEngine.onChanged(() => {
      this.locations.invalidate();
      this.scope = null;
    });
    this.entries = new Map();
    this.pendingFocus = false;
    this.disposed = false;
    this.root = document.createElement('div');
    this.root.className = 'tactical-overview';
    this.root.setAttribute('aria-label', 'DM creature locations');
    this.root.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:20;';
    this.status = document.createElement('output');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-label', 'Tactical focus status');
    this.status.style.cssText =
      'position:absolute;bottom:12px;left:12px;max-width:360px;padding:8px;' +
      'background:#451a1a;color:#fff;font:13px system-ui;';
    this.status.hidden = true;
    this.root.append(this.status);
    document.body.append(this.root);
    this.projected = new three.Vector3();
  }

  contains(token) {
    const gm = this.gameManager;
    if (token.mapId === gm.campaignMapId) return true;
    const world = gm.campaignWorld;
    if (!world.sharesLocation(token.mapId, gm.campaignMapId)) return false;
    if (
      this.scope?.world !== world ||
      this.scope.revision !== world.mapRevision ||
      this.scope.map.id !== gm.campaignMapId
    ) {
      const map = world.getMap(gm.campaignMapId);
      const structure = map.building
        ? world
            .getMapGeometry(map.building.ownerMapId)
            .getStructures()
            .find((spec) => spec.id === map.building.structureId)
        : null;
      this.scope = { world, revision: world.mapRevision, map, structure };
    }
    return tacticalFootprintContains(
      this.scope.map,
      world.toMapPosition(gm.campaignMapId, world.toCampaignPosition(token.mapId, token.world)),
      this.scope.structure
    );
  }

  async focusCreature(id) {
    if (this.pendingFocus || this.disposed) return;
    this.pendingFocus = true;
    this.status.hidden = true;
    this._syncFocusButtons();
    try {
      await changeCampaignView(this.gameManager, { focusTokenId: id });
    } catch (error) {
      if (!this.disposed) {
        this.status.textContent = error.message;
        this.status.hidden = false;
      }
      GameErrors.input(error, { component: 'TacticalOverview', operation: 'focusCreature' });
    } finally {
      this.pendingFocus = false;
      if (!this.disposed) this._syncFocusButtons();
    }
  }

  _syncFocusButtons() {
    const gm = this.gameManager;
    const disabled =
      this.pendingFocus ||
      gm.campaignViewBusy ||
      !!gm.campaignMapFailure ||
      gm.sceneAutosave?.ready === false;
    for (const { focus } of this.entries.values()) focus.disabled = disabled;
  }

  update(tokens, camera, canvas, scene) {
    if (this.locations.world !== this.gameManager.campaignWorld)
      this.locations = new CreatureLocations(this.gameManager.campaignWorld);
    const rect = canvas.getBoundingClientRect();
    this.root.hidden = rect.width <= 0 || rect.height <= 0;
    if (this.root.hidden) return;
    const viewport = {
      left: rect.left,
      top: rect.top,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
    };
    const points = [];
    for (const { token, mesh } of tokens) {
      if (!this.contains(token)) {
        mesh.visible = false;
        continue;
      }
      this.projected.copy(mesh.position).project(camera);
      if (
        Math.abs(this.projected.x) > 1 ||
        Math.abs(this.projected.y) > 1 ||
        Math.abs(this.projected.z) > 1
      ) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      points.push({
        id: token.id,
        token,
        mesh,
        anchor: mesh.position.clone(),
        depth: this.projected.z,
        x: rect.left + ((this.projected.x + 1) * rect.width) / 2,
        y: rect.top + ((1 - this.projected.y) * rect.height) / 2,
      });
    }
    const used = new Set();
    for (const point of layoutOverviewTokens(points, viewport)) {
      const { token, mesh } = point;
      used.add(token.id);
      let entry = this.entries.get(token.id);
      if (!entry) {
        const label = document.createElement('div');
        label.dataset.tacticalTokenId = token.id;
        label.style.cssText =
          'position:absolute;width:190px;padding:3px 5px;border-radius:4px;' +
          'background:rgba(15,23,42,.9);color:#fff;font:12px/16px system-ui,sans-serif;' +
          'box-sizing:border-box;height:40px;';
        const name = document.createElement('strong');
        name.style.cssText =
          'display:block;min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
        const heading = document.createElement('div');
        heading.style.cssText = 'display:flex;align-items:center;gap:6px;';
        const focus = document.createElement('button');
        focus.type = 'button';
        focus.textContent = 'Focus';
        focus.style.cssText =
          'pointer-events:auto;background:none;border:0;padding:0;color:#93c5fd;' +
          'text-decoration:underline;font:inherit;cursor:pointer;flex-shrink:0;';
        focus.addEventListener('click', (event) => {
          event.stopPropagation();
          void this.focusCreature(token.id);
        });
        heading.append(name, focus);
        const location = document.createElement('div');
        location.style.cssText = 'display:flex;color:#cbd5e1;white-space:nowrap;';
        const structure = document.createElement('span');
        structure.style.cssText = 'min-width:0;overflow:hidden;text-overflow:ellipsis;';
        const level = document.createElement('span');
        level.style.flexShrink = '0';
        location.append(structure, level);
        label.append(heading, location);
        this.root.append(label);
        const geometry = new this.three.BufferGeometry().setFromPoints([
          new this.three.Vector3(),
          new this.three.Vector3(),
        ]);
        const line = new this.three.Line(
          geometry,
          new this.three.LineBasicMaterial({
            color: 0xcbd5e1,
            depthTest: false,
            depthWrite: false,
            transparent: true,
            opacity: 0.8,
          })
        );
        line.raycast = () => {};
        line.renderOrder = 999;
        scene.add(line);
        entry = { label, name, focus, structure, level, line };
        this.entries.set(token.id, entry);
      }
      const location = this.locations.describe(token, {
        mapId: this.gameManager.campaignMapId,
        geometry: this.gameManager.terrainEngine.geometry,
      });
      const name = getTokenDisplayName(token);
      if (entry.name.textContent !== name) entry.name.textContent = name;
      entry.focus.setAttribute('aria-label', `Focus ${name}`);
      const place = location.structure || location.mapName;
      if (entry.structure.textContent !== place) entry.structure.textContent = place;
      const level = location.level ? ` \u00b7 ${location.level}` : '';
      if (entry.level.textContent !== level) entry.level.textContent = level;
      entry.label.setAttribute('aria-label', `${name}: ${location.label}`);
      entry.label.style.left = `${point.x + TOKEN_SIZE + 4}px`;
      entry.label.style.top = `${point.y}px`;
      const centerX = point.x + TOKEN_SIZE / 2;
      const centerY = point.y + TOKEN_SIZE / 2;
      mesh.position
        .set(
          ((centerX - rect.left) / rect.width) * 2 - 1,
          1 - ((centerY - rect.top) / rect.height) * 2,
          point.depth
        )
        .unproject(camera);
      const edge = new this.three.Vector3(1, 0, 0)
        .applyQuaternion(camera.quaternion)
        .add(mesh.position);
      const units = Math.abs(
        edge.project(camera).x - (((centerX - rect.left) / rect.width) * 2 - 1)
      );
      if (!(units > 1e-8)) throw new Error('The tactical camera has no measurable screen scale');
      const worldPerPixel = 2 / (units * rect.width);
      mesh.scale.setScalar((TOKEN_SIZE * worldPerPixel) / 0.92);
      mesh.material.depthTest = false;
      mesh.renderOrder = 1000;
      mesh.updateMatrixWorld(true);
      const positions = entry.line.geometry.attributes.position;
      positions.setXYZ(0, point.anchor.x, point.anchor.y, point.anchor.z);
      positions.setXYZ(1, mesh.position.x, mesh.position.y, mesh.position.z);
      positions.needsUpdate = true;
      entry.line.geometry.computeBoundingSphere();
    }
    for (const [id, entry] of this.entries) if (!used.has(id)) this._remove(id, entry);
    this._syncFocusButtons();
  }

  _remove(id, entry) {
    entry.label.remove();
    entry.line.parent?.remove(entry.line);
    entry.line.geometry.dispose();
    entry.line.material.dispose();
    this.entries.delete(id);
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (entry) this._remove(id, entry);
  }

  dispose() {
    this.disposed = true;
    this.unsubscribe();
    for (const [id, entry] of this.entries) this._remove(id, entry);
    this.root.remove();
  }
}
