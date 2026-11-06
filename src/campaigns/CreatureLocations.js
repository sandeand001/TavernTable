import {
  buildingDimensions,
  buildingFeetToLocal,
  buildingLevels,
  structureDisplayName,
} from '../terrain/BuildingModel.js';

const floorLabel = (spec, floor) =>
  floor === 100 ? 'Battlement deck' : `${spec?.kind === 'cellar' ? 'Level' : 'Floor'} ${floor + 1}`;

export default class CreatureLocations {
  constructor(world) {
    this.world = world;
    this.revision = null;
    this.structures = new Map();
  }

  _refresh() {
    if (this.revision === this.world.mapRevision) return;
    this.maps = new Map(this.world.listMaps().map(({ id }) => [id, this.world.getMap(id)]));
    this.structures.clear();
    this.revision = this.world.mapRevision;
  }

  _structures(mapId, active) {
    const geometry = active?.mapId === mapId ? active.geometry : this.world.getMapGeometry(mapId);
    const previous = this.structures.get(mapId);
    if (previous?.geometry === geometry) return previous.value;
    const value = geometry.getStructures();
    this.structures.set(mapId, { geometry, value });
    return value;
  }

  invalidate() {
    this.structures.clear();
  }

  describe(token, active = null) {
    this._refresh();
    const map = this.maps.get(token.mapId);
    if (!map) throw new Error('The creature location refers to an unknown map');
    let structure = null;
    let level = null;
    if (map.building) {
      structure = this._structures(map.building.ownerMapId, active).find(
        (spec) => spec.id === map.building.structureId
      );
      if (!structure) throw new Error('The creature floor has no owning structure');
      level = floorLabel(structure, map.building.floor);
    } else {
      const position = token.world || token.pose?.world;
      if (!position) throw new Error('The creature location has no physical position');
      const scale = 5 / map.grid.tileWorldSize;
      const point = {
        x: position.x * scale,
        y: position.y * scale,
        z: position.z * scale,
      };
      structure = this._structures(map.id, active).find((spec) => {
        const local = buildingFeetToLocal(spec, point);
        const round = ['turret', 'dome', 'cave'].includes(spec.kind);
        const { length, width } = buildingDimensions(spec);
        const inside = round
          ? Math.hypot(local.x, local.z) <= spec.diameterFeet / 2
          : Math.abs(local.x) <= length / 2 && Math.abs(local.z) <= width / 2;
        const low = spec.kind === 'cellar' ? -spec.heightFeet : 0;
        const high = spec.kind === 'cellar' ? 0 : spec.heightFeet;
        return inside && local.y >= low - 1e-5 && local.y <= high + 1e-5;
      });
      if (structure?.building) {
        const height = point.y - structure.baseFeet;
        const floors = buildingLevels(structure).filter(
          (entry) => entry.elevationFeet <= height + 1e-5
        );
        if (floors.length) level = floorLabel(structure, floors.at(-1).id);
      }
    }
    const name = structure ? structureDisplayName(structure) : null;
    return {
      mapId: map.id,
      mapName: map.name,
      structure: name,
      level,
      label: name ? [name, level].filter(Boolean).join(' \u00b7 ') : map.name,
    };
  }
}
