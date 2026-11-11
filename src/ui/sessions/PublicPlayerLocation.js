import {
  campaignToLocalWorld,
  localWorldToCampaign,
  campaignFeetBounds,
} from '../../campaigns/CampaignCoordinates.js';
import { TerrainGeometry } from '../../terrain/TerrainGeometry.js';
import {
  mapGeometryObstacles,
  mapSolidToCampaign,
  localMapSupport,
  supportBelowMaps,
  physicalCreatureSight,
} from '../../campaigns/PhysicalMapQueries.js';
import { isOpeningHoldValid } from '../../campaigns/CampaignOpeningClimb.js';
import { isSurfaceGripValid } from '../../campaigns/CampaignSurfaceClimb.js';
import { createBoxCell, clipCell, createConvexCell } from '../../terrain/ConvexGeometry.js';

export default class PublicPlayerLocation {
  constructor(assets) {
    this.location = assets.location;
    this.maps = new Map(assets.maps.map((map) => [map.id, map]));
    this.connections = assets.connections;
    this.doorPanels = assets.doorPanels || [];
    this.geometries = new Map();
    this.obstacles = new Map();
    this.mapRevision = 0;
  }

  getMap(id) {
    const map = this.maps.get(id);
    if (!map) throw new Error('The host has not authorized this location area');
    return map;
  }

  listMaps() {
    return [...this.maps.values()].map(({ id, name }) => ({ id, name }));
  }

  listLocations() {
    return [this.location];
  }

  getLocationId(id) {
    return this.getMap(id).locationId;
  }

  sharesLocation(a, b) {
    return this.getLocationId(a) === this.getLocationId(b);
  }

  listLocationMaps(id) {
    const location = this.getLocationId(id);
    return this.listMaps().filter((map) => this.getLocationId(map.id) === location);
  }

  get hasFloorMaps() {
    return [...this.maps.values()].some((map) => map.base === 'floor');
  }

  toCampaignPosition(id, point) {
    return localWorldToCampaign(this.getMap(id), point);
  }

  toMapPosition(id, point) {
    return campaignToLocalWorld(this.getMap(id), point);
  }

  toCampaignFacing(id, angle) {
    return angle - (this.getMap(id).quarterTurns * Math.PI) / 2;
  }

  getViewTransform(id) {
    const map = this.getMap(id);
    return {
      position: this.toMapPosition(id, { x: 0, y: 0, z: 0 }),
      yaw: (map.quarterTurns * Math.PI) / 2,
      scale: map.grid.tileWorldSize / 5,
    };
  }

  getMapGeometry(id) {
    let geometry = this.geometries.get(id);
    if (!geometry) {
      const map = this.getMap(id);
      const scale = 5 / map.grid.tileWorldSize;
      geometry = new TerrainGeometry({
        widthFeet: map.grid.cols * 5,
        depthFeet: map.grid.rows * 5,
        terrainThicknessFeet:
          map.floorContext?.terrainThicknessFeet ?? (map.base === 'floor' ? 0.5 : null),
        getTerrainHeightFeet: (x, z) =>
          map.terrain.heights[Math.floor(z / 5)][Math.floor(x / 5)] *
          map.terrain.worldElevationUnit *
          scale,
      });
      if (map.terrain.geometry) geometry.load(map.terrain.geometry);
      this.geometries.set(id, geometry);
    }
    return geometry;
  }

  getBuildingFloorRenderContext(id) {
    return this.getMap(id).floorContext ?? null;
  }

  getConnections(mapId = null) {
    if (mapId !== null) this.getMap(mapId);
    return this.connections.filter(
      (connection) => mapId === null || connection.ends.some((end) => end.mapId === mapId)
    );
  }

  getDoorRenderGroups(mapId) {
    const map = this.getMap(mapId);
    const scale = 5 / map.grid.tileWorldSize;
    return this.doorPanels.map((door) => ({
      id: door.id,
      map,
      local: door.mapIds.includes(mapId),
      cells: door.cells.map((solid) => {
        let cell = createBoxCell(solid);
        for (const plane of solid.planes || []) cell = clipCell(cell, plane);
        if (!cell) throw new Error('The public door panel has empty physical geometry');
        const polygons = cell.faces.map((face) =>
          face.vertices.map((point) => {
            const local = this.toMapPosition(mapId, point);
            return { x: local.x * scale, y: local.y * scale, z: local.z * scale };
          })
        );
        const result = createConvexCell(polygons, {
          materialColor: 0x795438,
          materialStyle: 'timber',
        });
        if (!result) throw new Error('The public door panel cannot be rendered');
        return result;
      }),
    }));
  }

  toCampaignBounds(id, bounds) {
    const map = this.getMap(id);
    const scale = 5 / map.grid.tileWorldSize;
    const scaled = (point) => ({ x: point.x * scale, y: point.y * scale, z: point.z * scale });
    return campaignFeetBounds(map, { min: scaled(bounds.min), max: scaled(bounds.max) });
  }

  toCampaignSolid(id, cell) {
    return mapSolidToCampaign(this.getMap(id), cell);
  }

  getObstacles({ mapId = null, geometry = null, coverBounds = null, excludeMapId = null } = {}) {
    const maps = this.listLocationMaps(mapId || this.viewMapId);
    const result = [];
    for (const { id } of maps) {
      if (id === excludeMapId) continue;
      const map = this.getMap(id);
      result.push(
        ...mapGeometryObstacles(
          map,
          id === mapId && geometry ? geometry : this.getMapGeometry(id),
          this.obstacles
        )
      );
      const cover =
        id === mapId && coverBounds !== null ? coverBounds : map.terrain.coverBounds || [];
      for (const bounds of cover) result.push(this.toCampaignBounds(id, bounds));
    }
    return [...result, ...this.doorPanels.flatMap((door) => door.cells)];
  }

  findLocalSupport(id, point, options = {}) {
    return localMapSupport(this.getMap(id), this.getMapGeometry(id), point, options);
  }

  findSupportBelow(point, options = {}) {
    const maps = this.listLocationMaps(options.mapId || this.viewMapId).map(({ id }) =>
      this.getMap(id)
    );
    return supportBelowMaps(maps, (id) => this.getMapGeometry(id), point, options);
  }

  hasLineOfSight(observer, target, options = {}) {
    if (
      options.targetMapId &&
      !this.sharesLocation(options.mapId || this.viewMapId, options.targetMapId)
    )
      return false;
    return physicalCreatureSight(observer, target, options.obstacles || this.getObstacles(options));
  }

  isOpeningHoldValid(id, point, openingId, { mapId = null, geometry = null } = {}) {
    return isOpeningHoldValid(
      [...this.maps.values()],
      this.connections,
      { mapId: id, pose: { kind: 'ledge', world: point, openingId } },
      (source) => (source === mapId && geometry ? geometry : this.getMapGeometry(source))
    );
  }

  isSurfaceGripValid(id, point, grip, { mapId = null, geometry = null } = {}) {
    return isSurfaceGripValid(
      [...this.maps.values()],
      { mapId: id, pose: { kind: 'grip', world: point, grip } },
      (source) => (source === mapId && geometry ? geometry : this.getMapGeometry(source))
    );
  }
}
