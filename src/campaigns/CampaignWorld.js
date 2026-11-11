import { validateScene, validateMapBoard } from './CampaignScene.js';
import { TerrainGeometry } from '../terrain/TerrainGeometry.js';
import {
  pointInsideSolid,
  segmentIntersectsSolid,
  boundsIntersectSolid,
} from '../terrain/ConvexGeometry.js';
import { planConnection, connectionEntryDistance } from './CampaignConnections.js';
import {
  localWorldToCampaign,
  campaignToLocalWorld,
  campaignFeetBounds,
  mapFeetToCampaign,
} from './CampaignCoordinates.js';
import { isOpeningHoldValid } from './CampaignOpeningClimb.js';
import { isSurfaceGripValid, openingSurfaceGrip } from './CampaignSurfaceClimb.js';
import { DEFAULT_LOCATION_ID, mapLocationId } from './CampaignLocations.js';
import { doorLeafCells } from './CampaignDoors.js';
import {
  mapGeometryObstacles,
  localMapSupport,
  supportBelowMaps,
  physicalCreatureSight,
} from './PhysicalMapQueries.js';

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
    this._obstacleCache = new Map();
    this._mapRevision = 0;
    if (scene.version === 3) {
      this._scene = copy(scene);
      this._mapsById = new Map(this._scene.maps.map((map) => [map.id, map]));
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
      if (effect.kind === 'point') effect.origin = scalePoint(effect.origin);
    }
    for (const group of this._scene.combat.histories) {
      for (const entry of group.entries) {
        if (entry.effectOrigin) entry.effectOrigin = scalePoint(entry.effectOrigin);
        if (entry.effectSnapshot?.area) scaleArea(entry.effectSnapshot.area);
        if (entry.effectSnapshot?.kind === 'point')
          entry.effectSnapshot.origin = scalePoint(entry.effectSnapshot.origin);
        const selection = entry.targetingSelection;
        if (!selection) continue;
        if (selection.area) scaleArea(selection.area);
        for (const key of ['origin', 'aim']) {
          if (selection[key]) selection[key] = scalePoint(selection[key]);
        }
      }
    }
    validateScene(this._scene, context);
    this._mapsById = new Map(this._scene.maps.map((map) => [map.id, map]));
  }

  _map(id) {
    const map = this._mapsById.get(id);
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

  getLocationId(mapId) {
    return mapLocationId(this._map(mapId));
  }

  sharesLocation(firstMapId, secondMapId) {
    return this.getLocationId(firstMapId) === this.getLocationId(secondMapId);
  }

  listLocations() {
    return copy(this._scene.locations || [{ id: DEFAULT_LOCATION_ID, name: 'Main location' }]);
  }

  listLocationMaps(mapId) {
    const locationId = this.getLocationId(mapId);
    return this._scene.maps
      .filter((map) => mapLocationId(map) === locationId)
      .map(({ id, name }) => ({ id, name }));
  }

  addLocation({ id, name, map }) {
    if (!map || this._scene.maps.some((existing) => existing.id === map.id))
      throw new Error('A new campaign location needs a unique initial map');
    const next = this.save();
    if (!next.locations) {
      next.locations = this.listLocations();
      for (const entry of next.maps) entry.locationId = DEFAULT_LOCATION_ID;
      for (const effect of next.combat.effects || [])
        if (effect.locationId === undefined) effect.locationId = DEFAULT_LOCATION_ID;
    }
    next.locations.push({ id, name });
    next.maps.push({ ...copy(map), locationId: id });
    this._commit(next);
  }

  getCreature(id) {
    return copy(this._creature(id));
  }

  _commit(next) {
    validateScene(next, this._context);
    const sameMaps = JSON.stringify(this._scene.maps) === JSON.stringify(next.maps);
    const sameConnections =
      JSON.stringify(this._scene.connections) === JSON.stringify(next.connections);
    const oldMaps = new Map(this._scene.maps.map((map) => [map.id, map]));
    const kept = new Map();
    for (const map of next.maps) {
      const old = oldMaps.get(map.id),
        cached = this._geometries.get(map.id);
      // Geometry identity also invalidates cached map transforms in movement and projections.
      if (cached && (sameMaps || JSON.stringify(old) === JSON.stringify(map)))
        kept.set(map.id, cached);
    }
    this._scene = next;
    this._mapsById = new Map(next.maps.map((map) => [map.id, map]));
    this._geometries = kept;
    if (!sameMaps || !sameConnections) this._mapRevision++;
    this._obstacleCache.clear();
  }

  get mapRevision() {
    return this._mapRevision;
  }
  get hasFloorMaps() {
    return this._scene.maps.some((map) => map.base === 'floor');
  }

  acceptCheckpoint(scene) {
    if (scene?.version !== 3) throw new Error('A connected campaign needs a version-3 checkpoint');
    this._commit(copy(scene));
  }

  addMap(map) {
    const next = this.save();
    next.maps.push({
      ...copy(map),
      ...(next.locations && map.locationId === undefined
        ? { locationId: this.getLocationId(next.view.mapId) }
        : {}),
    });
    this._commit(next);
  }

  addConnection(connection) {
    const next = this.save();
    next.connections = [...(next.connections || []), copy(connection)];
    this._commit(next);
  }

  setDoorState(id, change) {
    if (
      !change ||
      typeof change !== 'object' ||
      !Object.keys(change).length ||
      Object.keys(change).some(
        (key) => !['open', 'locked'].includes(key) || typeof change[key] !== 'boolean'
      )
    )
      throw new Error('A door change requires an open or locked boolean state');
    const next = this.save();
    const connection = next.connections?.find((entry) => entry.id === id);
    if (!connection || connection.kind !== 'door')
      throw new Error('The campaign door no longer exists');
    const open = change.open ?? connection.open === true;
    const locked = change.locked ?? connection.locked === true;
    if (open && locked) throw new Error('Unlock the locked door before opening it');
    if (!open && connection.open === true) {
      const panels = doorLeafCells(this, connection, { open: false }).map((cell) =>
        this._campaignSolid(this._map(connection.feature.mapId), cell)
      );
      for (const creature of this._scene.creatures) {
        if (!this.sharesLocation(creature.mapId, connection.feature.mapId)) continue;
        const position = this.getCampaignPosition(creature.id);
        const body = {
          min: { x: position.x - 0.5, y: position.y + 1e-5, z: position.z - 0.5 },
          max: { x: position.x + 0.5, y: position.y + 5 - 1e-5, z: position.z + 0.5 },
        };
        if (panels.some((panel) => boundsIntersectSolid(body, panel)))
          throw new Error('A creature is in the doorway; move it before closing the door');
      }
    }
    connection.open = open;
    connection.locked = locked;
    this._commit(next);
    return { id, open, locked };
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

  toCampaignSolid(mapId, cell) {
    return this._campaignSolid(this._map(mapId), cell);
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

  _campaignSolid(map, cell) {
    const bounds = this._campaignBounds(map, cell.bounds);
    if (
      cell.planes.every(({ normal }) =>
        ['x', 'y', 'z'].some((axis) => Math.abs(normal[axis]) > 1 - 1e-10)
      )
    )
      return bounds;
    const origin = mapFeetToCampaign(map, { x: 0, y: 0, z: 0 });
    return {
      ...bounds,
      planes: cell.planes.map(({ normal, distance }) => {
        const endpoint = mapFeetToCampaign(map, normal);
        const rotated = {
          x: endpoint.x - origin.x,
          y: endpoint.y - origin.y,
          z: endpoint.z - origin.z,
        };
        return {
          normal: rotated,
          distance: distance + rotated.x * origin.x + rotated.y * origin.y + rotated.z * origin.z,
        };
      }),
    };
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
      if (!this.sharesLocation(map.id, mapId ?? excludeMapId ?? this._scene.view.mapId)) continue;
      if (map.id === excludeMapId) continue;
      const geometry = activeGeometry && map.id === mapId ? activeGeometry : this._geometry(map.id);
      obstacles.push(...mapGeometryObstacles(map, geometry, this._obstacleCache));
      const cover =
        map.id === mapId && coverBounds !== null ? coverBounds : map.terrain.coverBounds || [];
      for (const bounds of cover) obstacles.push(this.toCampaignBounds(map.id, bounds));
    }
    for (const connection of this._scene.connections || []) {
      if (
        connection.kind !== 'door' ||
        !this.sharesLocation(
          connection.feature.mapId,
          mapId ?? excludeMapId ?? this._scene.view.mapId
        )
      )
        continue;
      const owner = this._map(connection.feature.mapId);
      for (const cell of doorLeafCells(this, connection, { mapId, geometry: activeGeometry }))
        obstacles.push(this._campaignSolid(owner, cell));
    }
    return obstacles;
  }

  findLocalSupport(mapId, world, { surfaceId = null, clearanceFeet = 0 } = {}) {
    const map = this._map(mapId);
    return localMapSupport(map, this._geometry(mapId), world, { surfaceId, clearanceFeet });
  }

  findSupportBelow(point, { mapId = null, geometry: activeGeometry = null } = {}) {
    if (!finitePoint(point)) throw new Error('Campaign support requires a valid physical position');
    if (mapId !== null) this._map(mapId);
    if (activeGeometry && mapId === null)
      throw new Error('Live support geometry requires its owning map');
    return supportBelowMaps(
      this._scene.maps.filter((map) =>
        this.sharesLocation(map.id, mapId ?? this._scene.view.mapId)
      ),
      (id) => this._geometry(id),
      point,
      { mapId, geometry: activeGeometry }
    );
  }

  isOpeningHoldValid(
    mapId,
    localWorld,
    openingId,
    { mapId: activeMapId = null, geometry = null } = {}
  ) {
    const connection = (this._scene.connections || []).find((entry) => entry.id === openingId);
    if (connection && !this.sharesLocation(mapId, connection.feature.mapId)) return false;
    return isOpeningHoldValid(
      this._scene.maps,
      this._scene.connections || [],
      { mapId, pose: { kind: 'ledge', world: localWorld, openingId } },
      (id) => (id === activeMapId && geometry ? geometry : this._geometry(id))
    );
  }

  isSurfaceGripValid(mapId, localWorld, grip, { mapId: activeMapId = null, geometry = null } = {}) {
    if (!grip || !this.sharesLocation(mapId, grip.mapId)) return false;
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

  contains(point, mapId = null) {
    if (!finitePoint(point)) throw new Error('The campaign point is invalid');
    if (mapId === null && this.listLocations().length > 1)
      throw new Error('A physical point requires its location-owning map');
    const source = mapId ?? this._scene.view.mapId;
    return this._scene.maps.some((map) => {
      if (!this.sharesLocation(map.id, source)) return false;
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
    if (geometry.mapId === undefined && this.listLocations().length > 1)
      throw new Error('Physical sight requires the observer map when locations are independent');
    if (
      geometry.targetMapId !== undefined &&
      !this.sharesLocation(geometry.mapId ?? this._scene.view.mapId, geometry.targetMapId)
    )
      return false;
    const obstacles = geometry.obstacles ?? this.getObstacles(geometry);
    return physicalCreatureSight(observerFeet, targetFeet, obstacles);
  }

  hasSurfaceLineOfSight(observerFeet, surfaceFeet, geometry = {}) {
    if (!finitePoint(observerFeet) || !finitePoint(surfaceFeet))
      throw new Error('Surface sight requires valid physical positions');
    if (geometry.mapId === undefined && this.listLocations().length > 1)
      throw new Error('Surface sight requires the observer map');
    const start = { ...observerFeet, y: observerFeet.y + 4 };
    const delta = {
      x: surfaceFeet.x - start.x,
      y: surfaceFeet.y - start.y,
      z: surfaceFeet.z - start.z,
    };
    const length = Math.hypot(delta.x, delta.y, delta.z);
    if (length < 1e-5) return true;
    const end = Object.fromEntries(
      ['x', 'y', 'z'].map((axis) => [axis, surfaceFeet[axis] - (delta[axis] / length) * 1e-5])
    );
    const obstacles = geometry.obstacles ?? this.getObstacles(geometry);
    if (!Array.isArray(obstacles)) throw new Error('Surface sight requires physical obstacles');
    return !obstacles.some(
      (solid) => pointInsideSolid(start, solid) || segmentIntersectsSolid(start, end, solid)
    );
  }

  visibleProjections(observerId, viewMapId) {
    this._map(viewMapId);
    const observer = this._creature(observerId);
    if (observer.mapId !== viewMapId)
      throw new Error('The viewing creature is not on this campaign map');
    const eye = this.getCampaignPosition(observerId);
    const geometry = { mapId: viewMapId, obstacles: this.getObstacles({ mapId: viewMapId }) };
    return this._scene.creatures
      .filter(
        (creature) => creature.mapId !== viewMapId && this.sharesLocation(creature.mapId, viewMapId)
      )
      .filter((creature) =>
        this.hasLineOfSight(eye, this.getCampaignPosition(creature.id), geometry)
      )
      .map((creature) => this.projectCreature(creature.id, viewMapId));
  }

  projectCreature(id, viewMapId) {
    const creature = this._creature(id);
    const source = this._map(creature.mapId);
    const view = this._map(viewMapId);
    if (!this.sharesLocation(source.id, view.id))
      throw new Error('Creatures cannot be projected between independent locations');
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
    if (!this.sharesLocation(source.id, target.id))
      throw new Error('Moving to an independent location requires an explicit DM relocation');
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
