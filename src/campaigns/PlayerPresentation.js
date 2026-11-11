import { getBuildingFloorRenderContext } from '../scene/terrain/InteriorCutaway.js';
import { doorLeafCells } from './CampaignDoors.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const fields = (value, names) =>
  Object.fromEntries(
    names.filter((name) => value[name] !== undefined).map((name) => [name, copy(value[name])])
  );

export function playerRenderAssets(
  world,
  observerMapId,
  { visibleMapIds = new Set([observerMapId]) } = {}
) {
  const locationId = world.getLocationId(observerMapId);
  const maps = world
    .listLocationMaps(observerMapId)
    .filter(({ id }) => visibleMapIds.has(id))
    .map(({ id }) => {
      const map = world.getMap(id);
      const terrain = fields(map.terrain, [
        'heights',
        'biome',
        'seed',
        'elevationScale',
        'worldElevationUnit',
        'treeDensity',
        'richShading',
        'sightBounds',
        'coverBounds',
        'structureGenerationEnabled',
      ]);
      const physical = world.getMapGeometry(id).save();
      const volumes = physical.volumes.map((volume) =>
        fields(volume, [
          'id',
          'operation',
          'layerId',
          'bounds',
          'shape',
          'materialRole',
          'materialColor',
          'materialStyle',
        ])
      );
      terrain.geometry = { version: volumes.some((volume) => volume.shape) ? 2 : 1, volumes };
      if (map.terrain.cavern?.version >= 2) terrain.renderStyle = 'cavern';
      terrain.placeables = map.terrain.placeables.map((entry) =>
        fields(entry, [
          'type',
          'gridX',
          'gridY',
          'heightOffset',
          'persistedScale',
          'modelKey',
          'variantKey',
          'placeableId',
          'rotation',
          'angleRadians',
        ])
      );
      const result = {
        ...fields(map, ['id', 'name', 'originFeet', 'quarterTurns', 'base', 'grid']),
        locationId,
        terrain,
      };
      if (map.building) {
        result.floorContext = {
          ownerMapId: map.building.ownerMapId,
          ...getBuildingFloorRenderContext(world, id),
        };
      }
      return result;
    });
  const ids = new Set(maps.map((map) => map.id));
  const connections = world
    .getConnections()
    .filter(
      (entry) => entry.ends.every((end) => ids.has(end.mapId)) && ids.has(entry.feature.mapId)
    )
    .map((entry) =>
      fields(entry, [
        'id',
        'name',
        'kind',
        'enabled',
        'open',
        'locked',
        'ends',
        'pathFeet',
        'feature',
        'outsideMapId',
      ])
    );
  const doorPanels = world
    .getConnections()
    .filter((entry) => entry.kind === 'door' && entry.ends.some((end) => ids.has(end.mapId)))
    .map((entry) => ({
      id: entry.id,
      mapIds: entry.ends.filter((end) => ids.has(end.mapId)).map((end) => end.mapId),
      cells: doorLeafCells(world, entry).map((cell) =>
        fields(world.toCampaignSolid(entry.feature.mapId, cell), ['min', 'max', 'planes'])
      ),
    }));
  return {
    location: world.listLocations().find((entry) => entry.id === locationId),
    maps,
    connections,
    doorPanels,
  };
}
