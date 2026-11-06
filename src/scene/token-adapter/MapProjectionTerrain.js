import { GRID_CONFIG } from '../../config/GameConstants.js';
import { getBiomeColorWithHydrology } from '../../config/biome/BiomePalettes.js';
import { TerrainVolumeMeshBuilder } from '../terrain/TerrainVolumeMeshBuilder.js';
import {
  getTerrainLayerColor,
  getBuildingFloorAppearance,
} from '../terrain/TerrainMaterialFactory.js';
import { CONSTRUCTION_MATERIALS } from '../../config/biome/ConstructionPalettes.js';
import { createInteriorCutaway } from '../terrain/InteriorCutaway.js';
import { clipCellToBounds } from '../../terrain/ConvexGeometry.js';
import {
  configureConstructionMaterial,
  hasConstructionMaterials,
} from '../terrain/ConstructionMaterials.js';

const CONTEXT_RADIUS_FEET = 10;
const EPSILON = 1e-6;

export default class MapProjectionTerrain {
  constructor(gameManager) {
    this.gm = gameManager;
    this.world = gameManager.campaignWorld;
    this.three = gameManager.threeSceneManager.three;
    this.root = new this.three.Group();
    this.root.name = 'MapProjectionTerrain';
    this.root.visible = false;
    this.walls = new this.three.Group();
    this.walls.name = 'MapInteriorWalls';
    this.walls.visible = false;
    this.floors = new this.three.Group();
    this.floors.name = 'MapPhysicalFloors';
    this.floorMeshes = new Map();
    this.floorBatch = null;
    this.material = new this.three.MeshLambertMaterial({
      vertexColors: true,
      side: this.three.DoubleSide,
    });
    this.sources = new Map();
    this.wallMeshes = new Map();
    this.revision = 0;
    this.unsubscribe = gameManager.terrainEngine.onChanged(() => this.revision++);
    gameManager.threeSceneManager.scene.add(this.root);
    gameManager.threeSceneManager.scene.add(this.walls);
    gameManager.threeSceneManager.scene.add(this.floors);
  }

  clear() {
    this.root.visible = false;
    this.signature = null;
    this.walls.visible = false;
    this.wallSignature = null;
    this.floors.visible = false;
    this.floorSignature = null;
  }

  dispose() {
    this.unsubscribe();
    for (const source of this.sources.values()) {
      source.full.dispose();
      source.mesh.geometry.dispose();
    }
    this.sources.clear();
    for (const mesh of this.wallMeshes.values()) mesh.geometry.dispose();
    this.wallMeshes.clear();
    for (const mesh of this.floorMeshes.values()) mesh.geometry.dispose();
    this.floorMeshes.clear();
    this.floorBatch?.geometry.dispose();
    this.floorBatch?.removeFromParent();
    this.floorBatch = null;
    this.material.dispose();
    this.root.removeFromParent();
    this.walls.removeFromParent();
    this.floors.removeFromParent();
  }

  update(observer, targets) {
    this._updatePhysicalFloors();
    this._updateInteriorWalls();
    if (!observer || !targets.length) {
      this.root.visible = false;
      this.signature = null;
      return;
    }
    const groups = new Map();
    for (const token of targets) {
      if (!groups.has(token.mapId)) groups.set(token.mapId, []);
      groups.get(token.mapId).push(token);
    }
    const signature = JSON.stringify([
      this.gm.campaignMapId,
      this.revision,
      observer.id,
      observer.world,
      targets.map((token) => [token.id, token.mapId, token.world]),
    ]);
    if (
      signature === this.signature &&
      [...groups.keys()].every(
        (id) => this.sources.get(id)?.reference === this.world.getMapGeometry(id)
      )
    )
      return;
    const sightGeometry = {
      mapId: observer.mapId,
      obstacles: this.world.getObstacles({
        mapId: this.gm.campaignMapId,
        geometry: this.gm.terrainEngine.geometry,
        coverBounds: this.gm.placeableMeshPool?.targetingCoverBounds() ?? null,
      }),
    };
    const observerFeet = this.world.toCampaignPosition(observer.mapId, observer.world);
    for (const source of this.sources.values()) source.mesh.visible = false;
    for (const [mapId, tokens] of groups) {
      const source = this._source(mapId);
      const scale = 5 / source.map.grid.tileWorldSize;
      const localObserver = this.world.toMapPosition(mapId, observerFeet);
      const start = new this.three.Vector3(localObserver.x * scale, 0, localObserver.z * scale);
      const feet = tokens.map((token) => ({
        x: token.world.x * scale,
        y: token.world.y * scale,
        z: token.world.z * scale,
        support: this.world.findLocalSupport(mapId, token.world)?.heightFeet,
        line: new this.three.Line3(
          start,
          new this.three.Vector3(token.world.x * scale, 0, token.world.z * scale)
        ),
      }));
      const sample = new this.three.Vector3();
      const closest = new this.three.Vector3();
      // A visible creature keeps its actual support even if a window hides the tile center.
      const faces = source.faces.filter(
        (face) =>
          feet.some((point) => {
            sample.set(face.center.x, 0, face.center.z);
            if (point.line.start.distanceToSquared(point.line.end) <= EPSILON ** 2)
              closest.copy(point.line.end);
            else point.line.closestPointToPoint(sample, true, closest);
            return (
              face.high <= point.y + EPSILON &&
              sample.distanceToSquared(closest) <= CONTEXT_RADIUS_FEET ** 2
            );
          }) &&
          !this._covered(face) &&
          (feet.some(
            (point) =>
              point.support !== undefined &&
              Math.abs(face.high - face.low) <= EPSILON &&
              Math.abs(face.high - point.support) <= EPSILON &&
              point.x >= face.minX - EPSILON &&
              point.x <= face.maxX + EPSILON &&
              point.z >= face.minZ - EPSILON &&
              point.z <= face.maxZ + EPSILON
          ) ||
            this.world.hasLineOfSight(observerFeet, face.campaign, sightGeometry))
      );
      const mask = faces.map((face) => face.start).join(',');
      if (mask !== source.mask) {
        const geometry = new this.three.BufferGeometry();
        for (const key of ['position', 'normal', 'color', 'constructionMaterial']) {
          const original = source.full.getAttribute(key);
          const values = [];
          for (const face of faces)
            for (
              let i = face.start * original.itemSize;
              i < (face.start + face.count) * original.itemSize;
              i++
            )
              values.push(original.array[i]);
          geometry.setAttribute(
            key,
            new this.three.Float32BufferAttribute(values, original.itemSize)
          );
        }
        geometry.applyMatrix4(source.toView);
        geometry.computeBoundingSphere();
        source.mesh.geometry.dispose();
        source.mesh.geometry = geometry;
        source.mask = mask;
      }
      source.mesh.visible = faces.length > 0;
    }
    this.root.visible = [...this.sources.values()].some((source) => source.mesh.visible);
    this.signature = signature;
  }

  _updatePhysicalFloors() {
    const signature = `${this.gm.campaignMapId}:${this.revision}:${this.world.mapRevision}`;
    if (signature === this.floorSignature) return;
    const maps = this.world
      .listLocationMaps(this.gm.campaignMapId)
      .map(({ id }) => this.world.getMap(id))
      .filter((map) => map.id !== this.gm.campaignMapId && map.base === 'floor');
    const references = maps.map((map) => this.world.getMapGeometry(map.id));
    if (
      signature === this.floorSignature &&
      references.length === this.floorReferences?.length &&
      references.every((reference, index) => reference === this.floorReferences[index])
    )
      return;
    for (const mesh of this.floorMeshes.values()) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.floorMeshes.clear();
    this.floorBatch?.geometry.dispose();
    this.floorBatch?.removeFromParent();
    this.floorBatch = null;
    if (!Number.isFinite(this.gm.terrainEngine.geometry.terrainThicknessFeet))
      for (let index = 0; index < maps.length; index++)
        this._addInteriorMesh(
          maps[index],
          references[index],
          maps[index].id,
          this.floors,
          this.floorMeshes
        );
    this._batchPhysicalFloors();
    this.floors.visible = this.floorMeshes.size > 0;
    this.floorSignature = signature;
    this.floorReferences = references;
  }

  _batchPhysicalFloors() {
    if (!this.floorMeshes.size) return;
    const sources = [...this.floorMeshes.values()];
    const count = sources.reduce(
      (total, mesh) => total + mesh.geometry.getAttribute('position').count,
      0
    );
    const geometry = new this.three.BufferGeometry();
    for (const key of ['position', 'normal', 'color', 'constructionMaterial']) {
      const itemSize = sources[0].geometry.getAttribute(key).itemSize;
      const values = new Float32Array(count * itemSize);
      let offset = 0;
      for (const mesh of sources) {
        const attribute = mesh.geometry.getAttribute(key);
        values.set(attribute.array, offset);
        offset += attribute.array.length;
      }
      geometry.setAttribute(key, new this.three.Float32BufferAttribute(values, itemSize));
    }
    geometry.computeBoundingSphere();
    const batch = new this.three.Mesh(geometry, this.material);
    batch.name = 'MapPhysicalFloors:batch';
    // Keep per-map meshes as the picking authority while rendering all slabs in one draw.
    batch.raycast = (raycaster, intersections) => {
      for (const mesh of sources) mesh.raycast(raycaster, intersections);
    };
    for (const mesh of sources) {
      mesh.updateMatrixWorld(true);
      mesh.removeFromParent();
    }
    this.floors.add(batch);
    this.floorBatch = batch;
  }

  _updateInteriorWalls() {
    if (!Number.isFinite(this.gm.terrainEngine.geometry.terrainThicknessFeet)) {
      this.walls.visible = false;
      this.wallSignature = null;
      return;
    }
    const signature = `${this.gm.campaignMapId}:${this.revision}:${this.world.mapRevision}`;
    if (signature === this.wallSignature) return;
    const references = this.world
      .listLocationMaps(this.gm.campaignMapId)
      .map(({ id }) => this.world.getMapGeometry(id));
    if (
      signature === this.wallSignature &&
      references.length === this.wallReferences?.length &&
      references.every((reference, i) => reference === this.wallReferences[i])
    )
      return;
    const cutaway = createInteriorCutaway(this.gm);
    for (const mesh of this.wallMeshes.values()) {
      mesh.geometry.dispose();
      mesh.removeFromParent();
    }
    this.wallMeshes.clear();
    const connections = this.world.getConnections(this.gm.campaignMapId);
    for (const map of cutaway.maps) {
      if (map.id === this.gm.campaignMapId || !cutaway.intersects(map)) continue;
      const reference = this.world.getMapGeometry(map.id);
      const partition = this._partition(map, reference);
      this._addInteriorMesh(map, cutaway.query(reference, map, partition), map.id);
      const ids = new Set(
        connections
          .filter(
            (connection) => connection.kind === 'stairs' && connection.feature.mapId === map.id
          )
          .flatMap((connection) => connection.feature.volumeIds)
      );
      if (ids.size && map.originFeet.y < cutaway.map.originFeet.y - EPSILON) {
        const bounds = reference
          .save()
          .volumes.filter((volume) => ids.has(volume.id) && volume.operation === 'add')
          .map((volume) => volume.bounds);
        const stairs = {
          hasCurves: reference.hasCurves,
          getSolidCells: () =>
            reference
              .getSolidCells()
              .flatMap((cell) =>
                bounds.map((clip) => clipCellToBounds(cell, clip)).filter(Boolean)
              ),
          getPartition: () => partition,
          getSolidSpansAt: (x, z) => {
            const regions = bounds.filter(
              ({ min, max }) => x >= min.x && x < max.x && z >= min.z && z < max.z
            );
            return reference.getSolidSpansAt(x, z).flatMap((span) =>
              regions
                .map(({ min, max }) => ({
                  ...span,
                  bottom: Math.max(span.bottom, min.y),
                  top: Math.min(span.top, max.y),
                }))
                .filter((span) => span.top - span.bottom > EPSILON)
            );
          },
        };
        this._addInteriorMesh(map, stairs, `${map.id}:stairs`);
      }
    }
    this.walls.visible = this.wallMeshes.size > 0;
    this.wallReferences = references;
    this.wallSignature = signature;
  }

  _addInteriorMesh(map, query, key, group = this.walls, registry = this.wallMeshes) {
    const floorAppearance = getBuildingFloorAppearance(this.world, map.id);
    const geometry = new TerrainVolumeMeshBuilder().build({
      geometry: query,
      three: this.three,
      worldUnitsPerFoot: 1,
      getStyle: (_x, _z, _y, span) =>
        CONSTRUCTION_MATERIALS[
          floorAppearance && span.materialColor === undefined
            ? floorAppearance.floorMaterial
            : (span.materialStyle ?? 'none')
        ],
      getColor: (_x, _z, _height, span) =>
        floorAppearance && span.materialColor === undefined
          ? floorAppearance.floorColor
          : getTerrainLayerColor(
              span.layerId === 'roof' ? 'ground' : span.layerId,
              map.terrain.biome,
              span.materialRole,
              span.materialColor
            ),
    });
    if (geometry.getAttribute('position').count === 0) {
      geometry.dispose();
      return;
    }
    if (hasConstructionMaterials(geometry))
      configureConstructionMaterial(
        this.material,
        (this.gm.spatial?.tileWorldSize ??
          this.world.getMap(this.gm.campaignMapId).grid.tileWorldSize) / 5
      );
    geometry.applyMatrix4(this._transform(map, this.gm.campaignMapId));
    const mesh = new this.three.Mesh(geometry, this.material);
    mesh.name = `${group.name}:${key}`;
    mesh.userData.campaignMapId = map.id;
    if (key !== map.id) mesh.renderOrder = -1;
    group.add(mesh);
    registry.set(key, mesh);
  }

  _transform(map, targetMapId = null) {
    const unit = map.grid.tileWorldSize / 5;
    const point = (x, y, z) => {
      const campaign = this.world.toCampaignPosition(map.id, {
        x: x * unit,
        y: y * unit,
        z: z * unit,
      });
      const value =
        targetMapId === null ? campaign : this.world.toMapPosition(targetMapId, campaign);
      return new this.three.Vector3(value.x, value.y, value.z);
    };
    const origin = point(0, 0, 0);
    return new this.three.Matrix4()
      .makeBasis(point(1, 0, 0).sub(origin), point(0, 1, 0).sub(origin), point(0, 0, 1).sub(origin))
      .setPosition(origin);
  }

  _partition(map, geometry) {
    const axes = geometry.getPartition();
    const cuts = { x: [...axes.x], z: [...axes.z] };
    // Split at active-map boundaries to avoid coplanar context over its existing ground.
    const active = this.gm.terrainEngine.geometry.getPartition();
    const unit = this.gm.spatial.tileWorldSize / 5;
    const scale = 5 / map.grid.tileWorldSize;
    for (const axis of ['x', 'z'])
      for (const value of active[axis]) {
        const campaign = this.world.toCampaignPosition(this.gm.campaignMapId, {
          x: axis === 'x' ? value * unit : 0,
          y: 0,
          z: axis === 'z' ? value * unit : 0,
        });
        const local = this.world.toMapPosition(map.id, campaign);
        for (const coordinate of ['x', 'z']) {
          const cut = local[coordinate] * scale;
          if (cut > 0 && cut < axes[coordinate].at(-1)) cuts[coordinate].push(cut);
        }
      }
    for (const axis of ['x', 'z'])
      cuts[axis] = cuts[axis]
        .sort((a, b) => a - b)
        .filter((value, i, sorted) => i === 0 || value - sorted[i - 1] > EPSILON);
    return cuts;
  }

  _source(mapId) {
    const reference = this.world.getMapGeometry(mapId);
    const cached = this.sources.get(mapId);
    const map = cached?.reference === reference ? cached.map : this.world.getMap(mapId);
    const partition = this._partition(map, reference);
    const key = JSON.stringify([this.gm.campaignMapId, partition]);
    if (cached?.reference === reference && cached.key === key) return cached;
    if (cached) {
      cached.full.dispose();
      cached.mesh.geometry.dispose();
      cached.mesh.removeFromParent();
    }
    const feetPerLevel = (map.terrain.worldElevationUnit * 5) / map.grid.tileWorldSize;
    const full = new TerrainVolumeMeshBuilder().build({
      geometry: {
        hasCurves: reference.hasCurves,
        getSolidCells: () => reference.getSolidCells({ partition }),
        getPartition: () => partition,
        getSolidSpansAt: (x, z) => reference.getSolidSpansAt(x, z),
      },
      three: this.three,
      worldUnitsPerFoot: 1,
      getColor: (_x, _z, height, span) =>
        span.materialColor !== undefined
          ? getTerrainLayerColor(
              span.layerId,
              map.terrain.biome,
              span.materialRole,
              span.materialColor
            )
          : span.id === 'terrain'
            ? map.terrain.biome
              ? getBiomeColorWithHydrology(map.terrain.biome, height / feetPerLevel)
              : GRID_CONFIG.TILE_COLOR
            : getTerrainLayerColor(
                span.layerId,
                map.terrain.biome,
                span.materialRole,
                span.materialColor
              ),
    });
    if (hasConstructionMaterials(full))
      configureConstructionMaterial(
        this.material,
        (this.gm.spatial?.tileWorldSize ??
          this.world.getMap(this.gm.campaignMapId).grid.tileWorldSize) / 5
      );
    const toView = this._transform(map, this.gm.campaignMapId);
    const toCampaign = this._transform(map);
    const positions = full.getAttribute('position');
    const faces = [];
    const faceSize = reference.hasCurves ? 3 : 6;
    for (let start = 0; start < positions.count; start += faceSize) {
      const center = new this.three.Vector3();
      let low = Infinity;
      let high = -Infinity;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      for (let i = start; i < start + faceSize; i++) {
        const point = new this.three.Vector3().fromBufferAttribute(positions, i);
        center.add(point);
        low = Math.min(low, point.y);
        high = Math.max(high, point.y);
        minX = Math.min(minX, point.x);
        maxX = Math.max(maxX, point.x);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      }
      center.divideScalar(faceSize);
      const viewScale = 5 / this.gm.spatial.tileWorldSize;
      const viewY = (y) =>
        new this.three.Vector3(center.x, y, center.z).applyMatrix4(toView).y * viewScale;
      faces.push({
        start,
        count: faceSize,
        center,
        low,
        high,
        minX,
        maxX,
        minZ,
        maxZ,
        view: center.clone().applyMatrix4(toView),
        campaign: center.clone().applyMatrix4(toCampaign),
        viewLow: viewY(low),
        viewHigh: viewY(high),
      });
    }
    const mesh = new this.three.Mesh(new this.three.BufferGeometry(), this.material);
    mesh.name = `MapProjectionTerrain:${mapId}`;
    this.root.add(mesh);
    const source = { reference, map, key, full, faces, toView, mesh, mask: null };
    this.sources.set(mapId, source);
    return source;
  }

  _covered(face) {
    const gm = this.gm;
    const scale = 5 / gm.spatial.tileWorldSize;
    const x = face.view.x * scale;
    const z = face.view.z * scale;
    if (x < 0 || z < 0 || x >= gm.cols * 5 || z >= gm.rows * 5) return false;
    return gm.terrainEngine.geometry
      .getSolidSpansAt(x, z)
      .some((span) => span.bottom <= face.viewLow + EPSILON && span.top >= face.viewHigh - EPSILON);
  }
}
