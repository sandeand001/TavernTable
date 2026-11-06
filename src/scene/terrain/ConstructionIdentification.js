import { structureDisplayName } from '../../terrain/BuildingModel.js';
import { ConstructionPreview } from './ConstructionPreview.js';

export class ConstructionIdentification {
  constructor(gameManager, onSelect) {
    this.gm = gameManager;
    this.onSelect = onSelect;
    this.targetPreview = new ConstructionPreview(gameManager);
    this.labels = new Map();
    this.frame = () => this._positionLabels();
  }

  update({ selectedId = null, targetId = null, underground = false, candidate = null } = {}) {
    const gm = this.gm;
    if (
      !gm.terrainEngine.isActive ||
      Number.isFinite(gm.terrainEngine.geometry.terrainThicknessFeet)
    ) {
      this.clear();
      return;
    }
    if (!this.root) {
      this.root = document.createElement('div');
      this.root.className = 'construction-label-layer';
      this.root.setAttribute('aria-label', 'Structure identifiers');
      document.body.append(this.root);
    }
    this.root.hidden = false;
    let positionsChanged = false;
    const definitions = gm.terrainEngine.geometry.getStructures();
    this.definitions = new Map(definitions.map((spec) => [spec.id, spec]));
    const wanted = new Set();
    for (const original of definitions) {
      if (!original.building || (original.kind === 'cellar' && !underground)) continue;
      const spec = candidate?.id === original.id ? candidate : original;
      wanted.add(spec.id);
      let label = this.labels.get(spec.id);
      if (!label) {
        const element = document.createElement('button');
        element.type = 'button';
        element.className = 'construction-map-label';
        element.hidden = true;
        element.dataset.structureId = spec.id;
        element.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.onSelect(this.definitions.get(spec.id));
        });
        this.root.append(element);
        label = { element };
        this.labels.set(spec.id, label);
        positionsChanged = true;
      }
      const name = structureDisplayName(spec);
      if (label.element.textContent !== name) {
        label.element.textContent = name;
        label.element.setAttribute('aria-label', `Select ${name}`);
      }
      const state =
        spec.id === targetId ? 'connection-target' : spec.id === selectedId ? 'selected' : '';
      if (label.element.dataset.state !== state) label.element.dataset.state = state;
      const roof = spec.building.roof;
      const rise = ['none', 'flat'].includes(roof)
        ? 0
        : roof === 'battlement'
          ? 3
          : spec.building.roofRiseFeet;
      const unit = gm.spatial.tileWorldSize / 5;
      const point = {
        x: spec.xFeet * unit,
        y: (spec.baseFeet + (spec.kind === 'cellar' ? 0.5 : spec.heightFeet + rise + 2)) * unit,
        z: spec.zFeet * unit,
      };
      if (!label.point || ['x', 'y', 'z'].some((axis) => point[axis] !== label.point[axis]))
        positionsChanged = true;
      label.point = point;
    }
    for (const [id, label] of this.labels)
      if (!wanted.has(id)) {
        label.element.remove();
        this.labels.delete(id);
      }
    const target = this.definitions.get(targetId);
    if (target) {
      this.targetPreview.show(target, { wireframe: true });
      this.targetPreview.mesh.name = 'ConstructionConnectionTarget';
      this.targetPreview.mesh.material.color.setHex(0xffcc66);
      this.targetPreview.mesh.renderOrder = 29;
    } else this.targetPreview.clear();
    if (!this.listening && gm.threeSceneManager?.addAnimationCallback) {
      gm.threeSceneManager.addAnimationCallback(this.frame);
      this.listening = true;
    }
    if (positionsChanged) this.positionKey = null;
    this._positionLabels();
  }

  _positionLabels() {
    const gm = this.gm;
    if (!gm.terrainEngine.isActive) {
      this.clear();
      return;
    }
    const camera = gm.threeSceneManager?.camera,
      three = gm.threeSceneManager?.three;
    const canvas = gm.getEventCanvas?.() || gm.threeSceneManager?.canvas;
    if (!this.root || this.root.hidden || !camera || !three || !canvas) return;
    camera.updateMatrixWorld();
    const rect = canvas.getBoundingClientRect();
    const key = [
      rect.left,
      rect.top,
      rect.width,
      rect.height,
      ...camera.matrixWorld.elements,
      ...camera.projectionMatrix.elements,
    ].join(',');
    if (key === this.positionKey) return;
    const point = new three.Vector3();
    for (const label of this.labels.values()) {
      point.set(label.point.x, label.point.y, label.point.z).project(camera);
      const visible =
        Number.isFinite(point.x) &&
        Math.abs(point.x) <= 1.05 &&
        Math.abs(point.y) <= 1.05 &&
        Math.abs(point.z) <= 1;
      label.element.hidden = !visible;
      if (visible) {
        label.element.style.left = `${rect.left + ((point.x + 1) * rect.width) / 2}px`;
        label.element.style.top = `${rect.top + ((1 - point.y) * rect.height) / 2}px`;
      }
    }
    this.positionKey = key;
  }

  clear() {
    if (this.root) this.root.hidden = true;
    this.targetPreview.clear();
    this.positionKey = null;
    if (this.listening) {
      this.gm.threeSceneManager.removeAnimationCallback(this.frame);
      this.listening = false;
    }
  }

  dispose() {
    this.clear();
    this.targetPreview.dispose();
    this.root?.remove();
    this.labels.clear();
  }
}
