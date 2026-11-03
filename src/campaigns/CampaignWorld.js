import { validateScene, validateMapBoard } from './CampaignScene.js';
import { TerrainGeometry } from '../terrain/TerrainGeometry.js';
import { Box3, Ray, Vector3 } from 'three';
import { planConnection, connectionEntryDistance } from './CampaignConnections.js';
import {
  localWorldToCampaign,
  campaignToLocalWorld,
  campaignFeetBounds,
} from './CampaignCoordinates.js';
import { isOpeningHoldValid } from './CampaignOpeningClimb.js';
import { isSurfaceGripValid, openingSurfaceGrip } from './CampaignSurfaceClimb.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const finitePoint = (value) =>
  value !== null &&
  typeof value === 'object' &&
  ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));

export default class CampaignWorld {
  static fromScene(scene, context) {
    return new CampaignWorld(scene, context);
  }

  constructor(scene, context) {
    validateScene(scene, context);
    this._context = context;
    this._geometries = new Map();
    if (scene.version === 3) {
      this._scene = copy(scene);
      return;
    }
    const saved = copy(scene);
    this._scene = {
      version: 3,
      ruleset: saved.ruleset,
      maps: [
        {
          id: 'map-main',
          name: 'Main map',
          originFeet: { x: 0, y: 0, z: 0 },
          quarterTurns: 0,
          base: 'ground',
          grid: saved.grid,
          terrain: saved.terrain,
        },
      ],
      creatures: saved.creatures.map((creature) => ({ ...creature, mapId: 'map-main' })),
      tokenCounters: saved.tokenCounters,
      combat: saved.combat,
      rollLog: saved.rollLog,
      view: {
        mapId: 'map-main',
        focusTokenId: saved.selection,
        camera: saved.camera,
      },
    };
    const scale = 5 / saved.grid.tileWorldSize;
    const scalePoint = (point) => ({ x: point.x * scale, y: point.y * scale, z: point.z * scale });
    const scaleArea = (area) => {
      area.origin = scalePoint(area.origin);
      for (const key of ['size', 'width', 'height']) area[key] *= scale;
    };
    for (const effect of this._scene.combat.effects || []) {
      if (effect.area) scaleArea(effect.area);
    }
    for (const group of this._scene.combat.histories) {
      for (const entry of group.entries) {
        const selection = entry.targetingSelection;
        if (!selection) continue;
        if (selection.area) scaleArea(selection.area);
        for (const key of ['origin', 'aim']) {
          if (selection[key]) selection[key] = scalePoint(selection[key]);
        }
      }
    }
    validateScene(this._scene, context);
  }

  _map(id) {
    const map = this._scene.maps.find((entry) => entry.id === id);
    if (!map) throw new Error(`The campaign map "${id}" does not exist`);
    return map;
  }

  _creature(id) {
    const creature = this._scene.creatures.find((entry) => entry.id === id);
    if (!creature) throw new Error(`The campaign creature "${id}" does not exist`);
    return creature;
  }

  getMap(id) {
    return copy(this._map(id));
  }

  getMapGeometry(id) {
    // Shared checkpoint geometry is queried here; edits still belong to the map owner.
    return this._geometry(id);
  }

  listMaps() {
    return this._scene.maps.map(({ id, name }) => ({ id, name }));
  }

  getCreature(id) {
    return copy(this._creature(id));
  }

  _commit(next) {
    validateScene(next, this._context);
    this._scene = next;
    this._geometries.clear();
  }

  acceptCheckpoint(scene) {
    if (scene?.version !== 3) throw new Error('A connected campaign needs a version-3 checkpoint');
    this._commit(copy(scene));
  }

  addMap(map) {
    const next = this.save();
    next.maps.push(copy(map));
    this._commit(next);
  }

  addConnection(connection) {
    const next = this.save();
    next.connections = [...(next.connections || []), copy(connection)];
    this._commit(next);
  }

  getConnections(mapId = null, localWorld = null) {
    if (mapId !== null) this._map(mapId);
    return copy(this._scene.connections || []).filter(
      (connection) =>
        (mapId === null || connection.ends.some((end) => end.mapId === mapId)) &&
        (localWorld === null ||
          connectionEntryDistance(this, connection, mapId, localWorld) <= 5 + 1e-6)
    );
  }

  planConnection(id, mapId, localWorld, options = {}) {
    const connection = this.getConnections().find((entry) => entry.id === id);
    if (!connection) throw new Error('The map connection no longer exists');
    return planConnection(this, connection, mapId, localWorld, options);
  }

  toCampaignPosition(mapId, localWorld) {
    if (!finitePoint(localWorld)) throw new Error('The map-local creature position is invalid');
    return localWorldToCampaign(this._map(mapId), localWorld);
  }

  toMapPosition(mapId, campaignPosition) {
    if (!finitePoint(campaignPosition))
      throw new Error('The campaign creature position is invalid');
    return campaignToLocalWorld(this._map(mapId), campaignPosition);
  }

  getViewTransform(mapId) {
    const map = this._map(mapId);
    return {
      position: this.toMapPosition(mapId, { x: 0, y: 0, z: 0 }),
      yaw: (map.quarterTurns * Math.PI) / 2,
      scale: map.grid.tileWorldSize / 5,
    };
  }

  getCampaignPosition(id) {
    const creature = this._creature(id);
    return this.toCampaignPosition(creature.mapId, creature.pose.world);
  }

  toCampaignFacing(mapId, facingAngle) {
    if (!Number.isFinite(facingAngle)) throw new Error('The map-local creature facing is invalid');
    return facingAngle - (this._map(mapId).quarterTurns * Math.PI) / 2;
  }

  _campaignBounds(map, bounds) {
    return campaignFeetBounds(map, bounds);
  }

  toCampaignBounds(mapId, bounds) {
    if (
      !finitePoint(bounds?.min) ||
      !finitePoint(bounds?.max) ||
      ['x', 'y', 'z'].some((axis) => bounds.min[axis] > bounds.max[axis])
    )
      throw new Error('The map-local obstruction bounds are invalid');
    const map = this._map(mapId);
    const scale = 5 / map.grid.tileWorldSize;
    const scaled = (point) => ({ x: point.x * scale, y: point.y * scale, z: point.z * scale });
    return this._campaignBounds(map, { min: scaled(bounds.min), max: scaled(bounds.max) });
  }

  _geometry(mapId) {
    let geometry = this._geometries.get(mapId);
    if (geometry) return geometry;
    const map = this._map(mapId);
    const board = validateMapBoard(map.grid, map.terrain, map.terrain.geometry ? 2 : 1, map.base);
    geometry =
      board.geometry ||
      new TerrainGeometry({
        widthFeet: map.grid.cols * 5,
        depthFeet: map.grid.rows * 5,
        getTerrainHeightFeet: (x, z) =>
          map.terrain.heights[Math.floor(z / 5)][Math.floor(x / 5)] *
          map.terrain.worldElevationUnit *
          board.feetPerWorld,
      });
    this._geometries.set(mapId, geometry);
    return geometry;
  }

  getObstacles({
    mapId = null,
    geometry: activeGeometry = null,
    coverBounds = null,
    excludeMapId = null,
  } = {}) {
    if (mapId !== null) this._map(mapId);
    if (excludeMapId !== null) this._map(excludeMapId);
    const obstacles = [];
    for (const map of this._scene.maps) {
      if (map.id === excludeMapId) continue;
      const geometry = activeGeometry && map.id === mapId ? activeGeometry : this._geometry(map.id);
      const axes = geometry.getPartition();
      for (let x = 1; x < axes.x.length; x++)
        for (let z = 1; z < axes.z.length; z++) {
          const cx = (axes.x[x - 1] + axes.x[x]) / 2;
          const cz = (axes.z[z - 1] + axes.z[z]) / 2;
          for (const span of geometry.getSolidSpansAt(cx, cz)) {
            obstacles.push(
              this._campaignBounds(map, {
                min: {
                  x: axes.x[x - 1],
                  y: Math.max(-1000000, span.bottom),
                  z: axes.z[z - 1],
                },
                max: { x: axes.x[x], y: span.top, z: axes.z[z] },
              })
            );
          }
        }
      const cover =
        map.id === mapId && coverBounds !== null ? coverBounds : map.terrain.coverBounds || [];
      for (const bounds of cover) obstacles.push(this.toCampaignBounds(map.id, bounds));
    }
    return obstacles;
  }

  findLocalSupport(mapId, world, { surfaceId = null, clearanceFeet = 0 } = {}) {
    if (
      !finitePoint(world) ||
      !Number.isFinite(clearanceFeet) ||
      clearanceFeet < 0 ||
      (surfaceId !== null && typeof surfaceId !== 'string')
    )
      throw new Error('Map support requires a valid local position and clearance');
    const map = this._map(mapId);
    const x = Math.floor(world.x / map.grid.tileWorldSize);
    const z = Math.floor(world.z / map.grid.tileWorldSize);
    if (x < 0 || z < 0 || x >= map.grid.cols || z >= map.grid.rows)
      throw new Error('The creature support query is outside its own grid');
    const scale = 5 / map.grid.tileWorldSize;
    const support = this._geometry(mapId).findSupport(world.x * scale, world.z * scale, {
      belowFeet: world.y * scale + 1e-5,
      clearanceFeet,
      surfaceId,
    });
    if (!support) return null;
    return { ...support, heightWorld: support.heightFeet / scale };
  }

  findSupportBelow(point, { mapId = null, geometry: activeGeometry = null } = {}) {
    if (!finitePoint(point)) throw new Error('Campaign support requires a valid physical position');
    if (mapId !== null) this._map(mapId);
    if (activeGeometry && mapId === null)
      throw new Error('Live support geometry requires its owning map');
    let best = null;
    let priority = -1;
    for (const map of this._scene.maps) {
      const local = this.toMapPosition(map.id, point);
      const scale = 5 / map.grid.tileWorldSize;
      const x = local.x * scale;
      const z = local.z * scale;
      if (x < 0 || z < 0 || x >= map.grid.cols * 5 || z >= map.grid.rows * 5) continue;
      const geometry = activeGeometry && map.id === mapId ? activeGeometry : this._geometry(map.id);
      const support = geometry.findSupport(x, z, { belowFeet: local.y * scale + 1e-6 });
      if (!support) continue;
      const height = map.originFeet.y + support.heightFeet;
      const rank = (map.id === mapId ? 2 : 0) + (map.base === 'floor' ? 1 : 0);
      if (
        best &&
        (height < best.positionFeet.y - 1e-6 ||
          (Math.abs(height - best.positionFeet.y) <= 1e-6 && rank <= priority))
      )
        continue;
      const positionFeet = { x: point.x, y: height, z: point.z };
      best = {
        mapId: map.id,
        surfaceId: support.id,
        layerId: support.layerId,
        positionFeet,
        world: this.toMapPosition(map.id, positionFeet),
      };
      priority = rank;
    }
    return best;
  }

  isOpeningHoldValid(
    mapId,
    localWorld,
    openingId,
    { mapId: activeMapId = null, geometry = null } = {}
  ) {
    return isOpeningHoldValid(
      this._scene.maps,
      this._scene.connections || [],
      { mapId, pose: { kind: 'ledge', world: localWorld, openingId } },
      (id) => (id === activeMapId && geometry ? geometry : this._geometry(id))
    );
  }

  isSurfaceGripValid(mapId, localWorld, grip, { mapId: activeMapId = null, geometry = null } = {}) {
    return isSurfaceGripValid(
      this._scene.maps,
      {
        mapId,
        pose: { kind: 'grip', world: localWorld, grip },
      },
      (id) => (id === activeMapId && geometry ? geometry : this._geometry(id))
    );
  }

  openingSurfaceGrip(mapId, localWorld, openingId, options = {}) {
    return openingSurfaceGrip(this, mapId, localWorld, openingId, options);
  }

  contains(point) {
    if (!finitePoint(point)) throw new Error('The campaign point is invalid');
    return this._scene.maps.some((map) => {
      const local = this.toMapPosition(map.id, point);
      return (
        local.x >= 0 &&
        local.z >= 0 &&
        local.x < map.grid.cols * map.grid.tileWorldSize &&
        local.z < map.grid.rows * map.grid.tileWorldSize
      );
    });
  }

  hasLineOfSight(observerFeet, targetFeet, geometry = {}) {
    if (!finitePoint(observerFeet) || !finitePoint(targetFeet))
      throw new Error('Campaign sight requires valid physical creature positions');
    const start = new Vector3(observerFeet.x, observerFeet.y + 4, observerFeet.z);
    const box = new Box3();
    const hit = new Vector3();
    const obstacles = geometry.obstacles ?? this.getObstacles(geometry);
    if (!Array.isArray(obstacles)) throw new Error('Campaign sight requires physical obstacles');
    return [2.5, 4.5].some((height) => {
      const end = new Vector3(targetFeet.x, targetFeet.y + height, targetFeet.z);
      const direction = end.clone().sub(start);
      const distance = direction.length();
      if (distance < 1e-7) return true;
      const ray = new Ray(start, direction.divideScalar(distance));
      for (const bounds of obstacles) {
        box.min.set(bounds.min.x, bounds.min.y, bounds.min.z);
        box.max.set(bounds.max.x, bounds.max.y, bounds.max.z);
        if (box.containsPoint(start)) return false;
        if (ray.intersectBox(box, hit) && start.distanceTo(hit) < distance - 1e-7) return false;
      }
      return true;
    });
  }

  visibleProjections(observerId, viewMapId) {
    this._map(viewMapId);
    const observer = this._creature(observerId);
    if (observer.mapId !== viewMapId)
      throw new Error('The viewing creature is not on this campaign map');
    const eye = this.getCampaignPosition(observerId);
    const geometry = { obstacles: this.getObstacles() };
    return this._scene.creatures
      .filter((creature) => creature.mapId !== viewMapId)
      .filter((creature) =>
        this.hasLineOfSight(eye, this.getCampaignPosition(creature.id), geometry)
      )
      .map((creature) => this.projectCreature(creature.id, viewMapId));
  }

  projectCreature(id, viewMapId) {
    const creature = this._creature(id);
    const source = this._map(creature.mapId);
    const view = this._map(viewMapId);
    return {
      id,
      sourceMapId: source.id,
      viewMapId: view.id,
      projection: source.id !== view.id,
      world: this.toMapPosition(view.id, this.getCampaignPosition(id)),
      facingAngle: creature.facingAngle + ((view.quarterTurns - source.quarterTurns) * Math.PI) / 2,
    };
  }

  transferCreature(id, mapId) {
    const creature = this._creature(id);
    const source = this._map(creature.mapId);
    const target = this._map(mapId);
    if (creature.pose.kind === 'wall')
      throw new Error('Finish the wall or ledge hold before transferring between grids');
    const world = this.toMapPosition(mapId, this.getCampaignPosition(id));
    const next = this.save();
    const moved = next.creatures.find((entry) => entry.id === id);
    moved.mapId = mapId;
    moved.pose.world = world;
    delete moved.pose.surfaceId;
    moved.gridX = Math.floor(world.x / target.grid.tileWorldSize);
    moved.gridY = Math.floor(world.z / target.grid.tileWorldSize);
    moved.facingAngle += ((target.quarterTurns - source.quarterTurns) * Math.PI) / 2;
    if (next.view.focusTokenId === id) next.view.mapId = mapId;
    this._commit(next);
  }

  createView({ mapId = this._scene.view.mapId, focusTokenId = null } = {}) {
    return new CampaignView(this, mapId, focusTokenId);
  }

  save() {
    return copy(this._scene);
  }
}

class CampaignView {
  constructor(world, mapId, focusTokenId) {
    world.getMap(mapId);
    this._world = world;
    this._mapId = mapId;
    this._focusTokenId = null;
    const saved = world.save().view;
    this._initialCamera = copy(saved.camera);
    this._cameras = new Map(
      (saved.cameras || []).map(({ mapId, camera }) => [mapId, copy(camera)])
    );
    this._cameras.set(saved.mapId, copy(saved.camera));
    if (focusTokenId !== null) this.focus(focusTokenId);
  }

  get mapId() {
    return this._focusTokenId === null
      ? this._mapId
      : this._world.getCreature(this._focusTokenId).mapId;
  }

  get focusTokenId() {
    return this._focusTokenId;
  }

  get camera() {
    return copy(this._cameras.get(this.mapId) || this._initialCamera);
  }

  get hasCamera() {
    return this._cameras.has(this.mapId);
  }

  snapshot(camera = this.camera) {
    const cameras = new Map(this._cameras);
    cameras.set(this.mapId, copy(camera));
    return {
      mapId: this.mapId,
      focusTokenId: this.focusTokenId,
      camera: copy(camera),
      cameras: [...cameras].map(([mapId, value]) => ({ mapId, camera: copy(value) })),
    };
  }

  setCamera(camera) {
    const saved = this._world.save();
    saved.view = {
      mapId: this.mapId,
      focusTokenId: this.focusTokenId,
      camera,
    };
    validateScene(saved, this._world._context);
    this._cameras.set(this.mapId, copy(camera));
  }

  showMap(mapId) {
    this._world.getMap(mapId);
    this._mapId = mapId;
    this._focusTokenId = null;
  }

  focus(id) {
    const mapId = id === null ? this.mapId : this._world.getCreature(id).mapId;
    this._mapId = mapId;
    this._focusTokenId = id;
  }
}
