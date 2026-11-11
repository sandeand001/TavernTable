import {
  buildingLevels,
  buildingLocalToFeet,
  buildingStairs,
  cellarAccessLayout,
  buildingSignature,
  buildingFloorId,
} from '../../terrain/BuildingModel.js';
import { mapFeetToCampaign, campaignToMapFeet } from '../../campaigns/CampaignCoordinates.js';
import { TerrainVolumeMeshBuilder } from './TerrainVolumeMeshBuilder.js';

const EPSILON = 1e-6;

export class UndergroundConstructionView {
  constructor(gameManager) {
    this.gm = gameManager;
    this.enabled = false;
    this.materials = new Map();
    this.revision = 0;
    this.frame = () => {
      if (!this._available()) this._hide();
      else {
        if (this.mapId !== this.gm.campaignMapId || this.world !== this.gm.campaignWorld)
          this._refresh();
        this._syncMaterials();
      }
    };
    this.unsubscribers = [
      gameManager.terrainEngine.onChanged(() => {
        this.revision++;
        if (this.enabled) this._refresh();
      }),
      gameManager.terrainEngine.onEditorChanged(() => {
        if (!this._available()) this._hide();
      }),
    ];
  }

  _available() {
    return (
      this.enabled &&
      this.gm.terrainEngine.isActive &&
      !Number.isFinite(this.gm.terrainEngine.geometry.terrainThicknessFeet)
    );
  }

  update({ enabled, candidate = null, selectedId = null, levelId = null }) {
    this.enabled = enabled;
    this.candidate = candidate?.kind === 'cellar' ? candidate : null;
    this.selectedId = selectedId;
    this.levelId = levelId;
    if (!this._available()) {
      this._hide();
      return;
    }
    this._refresh();
  }

  _ensureRoot() {
    const manager = this.gm.threeSceneManager,
      three = manager?.three;
    if (!three || !manager.scene)
      throw new Error('The underground construction renderer is not ready');
    if (!this.root) {
      this.root = new three.Group();
      this.root.name = 'UndergroundConstructionView';
      this.linesMaterial = new three.LineBasicMaterial({
        color: 0x64bfce,
        transparent: true,
        opacity: 0.7,
        depthTest: false,
        depthWrite: false,
      });
      this.activeLinesMaterial = new three.LineBasicMaterial({
        color: 0xffd279,
        transparent: true,
        opacity: 1,
        depthTest: false,
        depthWrite: false,
      });
      this.floorMaterial = new three.MeshBasicMaterial({
        color: 0x355d70,
        transparent: true,
        opacity: 0.82,
        side: three.DoubleSide,
        depthTest: false,
        depthWrite: false,
      });
      this.wireMaterial = new three.LineBasicMaterial({
        color: 0x819ca8,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        toneMapped: false,
      });
      this.surfaceWires = new three.Group();
      this.surfaceWires.name = 'UndergroundSurfaceWireframe';
      manager.scene.add(this.surfaceWires);
      manager.scene.add(this.root);
    }
    if (!this.listening && manager.addAnimationCallback) {
      manager.addAnimationCallback(this.frame);
      this.listening = true;
    }
    this.root.visible = true;
    this.surfaceWires.visible = true;
  }

  _clearGroup(group) {
    if (!group) return;
    group.traverse((object) => object.geometry?.dispose());
    group.clear();
  }

  _refresh() {
    if (!this._available()) {
      this._hide();
      return;
    }
    this._ensureRoot();
    const gm = this.gm,
      three = gm.threeSceneManager.three;
    const recordsKey = `${this.revision}:${gm.campaignMapId}:${gm.campaignWorld?.mapRevision}`;
    if (this.recordsKey !== recordsKey || this.world !== gm.campaignWorld) {
      this.recordsKey = recordsKey;
      this.world = gm.campaignWorld;
      this.mapId = gm.campaignMapId;
      this.cellars = gm.terrainEngine.geometry
        .getStructures()
        .filter((spec) => spec.kind === 'cellar');
      this._clearGroup(this.root);
      this.stored = new three.Group();
      this.stored.name = 'UndergroundStoredCellars';
      for (const spec of this.cellars) {
        const group = new three.Group();
        group.name = `cellar:${spec.id}`;
        group.userData.cellarId = spec.id;
        group.add(this._outline(spec));
        this.stored.add(group);
      }
      this.root.add(this.stored);
      this.activeKey = null;
      this.active = null;
      this.savedMaps = new Map();
      if (this.world)
        for (const { id } of this.world.listLocationMaps(gm.campaignMapId))
          this.savedMaps.set(id, null);
    }
    const activeKey = JSON.stringify([this.candidate, this.selectedId, this.levelId]);
    if (activeKey !== this.activeKey) {
      this._clearGroup(this.active);
      this.active?.removeFromParent();
      this.active = new three.Group();
      this.active.name = 'UndergroundSelectedCellar';
      this.root.add(this.active);
      if (this.candidate) {
        this.active.add(this._outline(this.candidate, true));
        this._showFloor(this.candidate);
      }
      this.activeKey = activeKey;
    }
    for (const group of this.stored.children)
      group.visible = group.userData.cellarId !== this.selectedId;
    this.root.updateMatrixWorld(true);
    this._syncMaterials();
  }

  _geometry(positions) {
    const three = this.gm.threeSceneManager.three,
      geometry = new three.BufferGeometry();
    geometry.setAttribute('position', new three.Float32BufferAttribute(positions, 3));
    geometry.computeBoundingSphere();
    return geometry;
  }

  _line(positions, selected = false) {
    const mesh = new this.gm.threeSceneManager.three.LineSegments(
      this._geometry(positions),
      selected ? this.activeLinesMaterial : this.linesMaterial
    );
    mesh.renderOrder = selected ? 18 : 12;
    return mesh;
  }

  _point(spec, p) {
    const unit = this.gm.spatial.tileWorldSize / 5,
      world = buildingLocalToFeet(spec, p);
    return { x: world.x * unit, y: world.y * unit, z: world.z * unit };
  }

  _outline(spec, selected = false) {
    const positions = [],
      length = spec.lengthFeet / 2,
      width = spec.widthFeet / 2;
    const levels = buildingLevels(spec);
    const segment = (a, b) => {
      for (const local of [a, b]) {
        const p = this._point(spec, local);
        positions.push(p.x, p.y, p.z);
      }
    };
    for (const level of [...levels, { elevationFeet: 0 }]) {
      const y = level.elevationFeet;
      const points = [
        { x: -length, y, z: -width },
        { x: length, y, z: -width },
        { x: length, y, z: width },
        { x: -length, y, z: width },
      ];
      for (let i = 0; i < 4; i++) segment(points[i], points[(i + 1) % 4]);
    }
    for (const x of [-length, length])
      for (const z of [-width, width])
        segment({ x, y: levels[0].elevationFeet, z }, { x, y: 0, z });
    return this._line(positions, selected);
  }

  _showFloor(spec) {
    const gm = this.gm,
      three = gm.threeSceneManager.three,
      levels = buildingLevels(spec);
    const index = Math.max(
      0,
      levels.findIndex((level) => level.id === this.levelId)
    );
    const level = levels[index],
      length = spec.lengthFeet,
      width = spec.widthFeet;
    const holes = (level.openings || []).map((hole) => ({
      min: { x: hole.xFeet, z: hole.zFeet },
      max: { x: hole.xFeet + hole.lengthFeet, z: hole.zFeet + hole.widthFeet },
    }));
    if (index > 0 && spec.building.stairs)
      holes.push(buildingStairs(spec, level.elevationFeet - levels[index - 1].elevationFeet).hole);
    const xs = new Set([0, length]),
      zs = new Set([0, width]);
    const gridStep = Math.max(5, Math.ceil(Math.max(length, width) / 250) * 5);
    for (let x = gridStep; x < length; x += gridStep) xs.add(x);
    for (let z = gridStep; z < width; z += gridStep) zs.add(z);
    for (const hole of holes) {
      xs.add(Math.max(0, Math.min(length, hole.min.x)));
      xs.add(Math.max(0, Math.min(length, hole.max.x)));
      zs.add(Math.max(0, Math.min(width, hole.min.z)));
      zs.add(Math.max(0, Math.min(width, hole.max.z)));
    }
    const xAxis = [...xs].sort((a, b) => a - b),
      zAxis = [...zs].sort((a, b) => a - b);
    const positions = [],
      grid = [];
    for (let i = 1; i < xAxis.length; i++)
      for (let j = 1; j < zAxis.length; j++) {
        const x0 = xAxis[i - 1],
          x1 = xAxis[i],
          z0 = zAxis[j - 1],
          z1 = zAxis[j];
        if (
          holes.some(
            (h) =>
              (x0 + x1) / 2 > h.min.x &&
              (x0 + x1) / 2 < h.max.x &&
              (z0 + z1) / 2 > h.min.z &&
              (z0 + z1) / 2 < h.max.z
          )
        )
          continue;
        const corners = [
          [x0, z0],
          [x1, z0],
          [x1, z1],
          [x0, z1],
        ].map(([x, z]) =>
          this._point(spec, { x: x - length / 2, y: level.elevationFeet + 0.02, z: z - width / 2 })
        );
        for (const k of [0, 1, 2, 0, 2, 3])
          positions.push(corners[k].x, corners[k].y, corners[k].z);
        for (let k = 0; k < 4; k++)
          for (const p of [corners[k], corners[(k + 1) % 4]]) grid.push(p.x, p.y, p.z);
      }
    let geometry = this._geometry(positions);
    const floorId = gm.campaignMapId && buildingFloorId(gm.campaignMapId, spec.id, level.id);
    if (this.world && this.savedMaps.has(floorId)) {
      let map = this.savedMaps.get(floorId);
      if (!map) {
        map = this.world.getMap(floorId);
        this.savedMaps.set(floorId, map);
      }
      if (map.building.signature === buildingSignature(spec)) {
        const actual = new TerrainVolumeMeshBuilder().build({
          geometry: this.world.getMapGeometry(floorId),
          three,
          worldUnitsPerFoot: 1,
        });
        const owner = this.world.getMap(gm.campaignMapId),
          attr = actual.getAttribute('position');
        for (let i = 0; i < attr.count; i++) {
          const point = campaignToMapFeet(
            owner,
            mapFeetToCampaign(map, {
              x: attr.getX(i),
              y: attr.getY(i),
              z: attr.getZ(i),
            })
          );
          const unit = gm.spatial.tileWorldSize / 5;
          attr.setXYZ(i, point.x * unit, point.y * unit, point.z * unit);
        }
        geometry.dispose();
        geometry = actual;
        geometry.computeBoundingSphere();
      }
    }
    const mesh = new three.Mesh(geometry, this.floorMaterial);
    mesh.name = 'UndergroundActiveFloor';
    mesh.renderOrder = 14;
    this.active.add(mesh, this._line(grid, true));
    const steps = [];
    if (index < levels.length - 1 && spec.building.stairs)
      steps.push(
        ...buildingStairs(spec, levels[index + 1].elevationFeet - level.elevationFeet).steps
      );
    if (index === levels.length - 1 && spec.building.access.kind === 'stairs')
      steps.push(...cellarAccessLayout(spec).steps);
    const outlines = [];
    for (const step of steps) {
      const { min, max } = step.bounds;
      const points = [
        [min.x, min.z],
        [max.x, min.z],
        [max.x, max.z],
        [min.x, max.z],
      ].map(([x, z]) =>
        this._point(spec, { x: x - length / 2, y: level.elevationFeet + max.y, z: z - width / 2 })
      );
      for (let i = 0; i < 4; i++)
        for (const p of [points[i], points[(i + 1) % 4]]) outlines.push(p.x, p.y, p.z);
    }
    if (outlines.length) this.active.add(this._line(outlines, true));
  }

  _syncMaterials() {
    if (!this._available()) return;
    const scene = this.gm.threeSceneManager.scene;
    const seen = new Set();
    for (const name of [
      'TerrainMesh',
      'MapPhysicalFloors',
      'MapInteriorWalls',
      'MapProjectionTerrain',
    ]) {
      const root = scene.getObjectByName(name);
      root?.traverse((object) => {
        if (!object.isMesh || !object.material) return;
        seen.add(object);
        const previous = this.materials.get(object);
        if (previous?.replacement === object.material) {
          this._syncWire(object, previous);
          return;
        }
        if (previous) {
          this._disposeMaterials(previous.replacement);
          previous.wire?.geometry.dispose();
          previous.wire?.removeFromParent();
          this.materials.delete(object);
        }
        const make = (material) => {
          const clone = cloneConstructionMaterial(material);
          clone.wireframe = true;
          clone.transparent = true;
          clone.opacity = 0.12;
          clone.depthWrite = false;
          clone.visible = false;
          return clone;
        };
        const original = object.material;
        const replacement = Array.isArray(original) ? original.map(make) : make(original);
        const entry = { original, replacement };
        this.materials.set(object, entry);
        object.material = replacement;
        this._syncWire(object, entry);
      });
    }
    for (const [object, entry] of this.materials)
      if (!seen.has(object)) {
        if (object.material === entry.replacement) object.material = entry.original;
        this._disposeMaterials(entry.replacement);
        entry.wire?.geometry.dispose();
        entry.wire?.removeFromParent();
        this.materials.delete(object);
      }
  }

  _syncWire(object, entry) {
    const three = this.gm.threeSceneManager.three;
    if (entry.geometry !== object.geometry) {
      entry.wire?.geometry.dispose();
      entry.wire?.removeFromParent();
      entry.wire = new three.LineSegments(
        new three.EdgesGeometry(object.geometry, 12),
        this.wireMaterial
      );
      entry.wire.matrixAutoUpdate = false;
      this.surfaceWires.add(entry.wire);
      entry.geometry = object.geometry;
    }
    object.updateWorldMatrix(true, false);
    let visible = true;
    for (let ancestor = object; ancestor; ancestor = ancestor.parent) visible &&= ancestor.visible;
    entry.wire.visible = visible;
    entry.wire.matrix.copy(object.matrixWorld);
    entry.wire.matrixWorldNeedsUpdate = true;
  }

  _disposeMaterials(value) {
    for (const material of Array.isArray(value) ? value : [value]) material.dispose();
  }

  pick(ray) {
    if (!this._available() || !this.root?.visible) return null;
    const three = this.gm.threeSceneManager.three;
    let result = null;
    for (const spec of this.cellars || []) {
      const unit = this.gm.spatial.tileWorldSize / 5;
      const inverse = new three.Matrix4()
        .compose(
          new three.Vector3(spec.xFeet * unit, spec.baseFeet * unit, spec.zFeet * unit),
          new three.Quaternion().setFromAxisAngle(new three.Vector3(0, 1, 0), -spec.angleRadians),
          new three.Vector3(1, 1, 1)
        )
        .invert();
      const local = ray.ray.clone().applyMatrix4(inverse);
      for (const level of buildingLevels(spec)) {
        const hit = local.intersectBox(
          new three.Box3(
            new three.Vector3(
              (-spec.lengthFeet * unit) / 2,
              (level.elevationFeet - 0.1) * unit,
              (-spec.widthFeet * unit) / 2
            ),
            new three.Vector3(
              (spec.lengthFeet * unit) / 2,
              (level.elevationFeet + 0.1) * unit,
              (spec.widthFeet * unit) / 2
            )
          ),
          new three.Vector3()
        );
        if (!hit) continue;
        const distance = hit.distanceTo(local.origin);
        if (!result || distance < result.distance - EPSILON)
          result = { spec, levelId: level.id, distance };
      }
    }
    return result;
  }

  _hide() {
    if (this.root) this.root.visible = false;
    if (this.surfaceWires) this.surfaceWires.visible = false;
    const terrainChanged = [...this.materials.keys()].some(
      (object) => object.name === 'TerrainMesh'
    );
    for (const [object, entry] of this.materials) {
      if (object.material === entry.replacement) object.material = entry.original;
      this._disposeMaterials(entry.replacement);
      entry.wire?.geometry.dispose();
      entry.wire?.removeFromParent();
    }
    this.materials.clear();
    const manager = this.gm.threeSceneManager;
    if (terrainChanged && Number.isFinite(manager._terrainMeshOpacity))
      manager.setTerrainMeshOpacity?.(manager._terrainMeshOpacity);
    if (this.listening) {
      this.gm.threeSceneManager.removeAnimationCallback(this.frame);
      this.listening = false;
    }
  }

  dispose() {
    this._hide();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this._clearGroup(this.root);
    this.root?.removeFromParent();
    this.linesMaterial?.dispose();
    this.activeLinesMaterial?.dispose();
    this.floorMaterial?.dispose();
    this.surfaceWires?.removeFromParent();
    this.wireMaterial?.dispose();
    this.root = null;
  }
}
import { cloneConstructionMaterial } from './ConstructionMaterials.js';
