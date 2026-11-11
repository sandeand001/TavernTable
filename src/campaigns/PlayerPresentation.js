import { buildingLevelHeight } from '../terrain/BuildingModel.js';

const copy = (value) => JSON.parse(JSON.stringify(value));
const fields = (value, names) =>
  Object.fromEntries(
    names.filter((name) => value[name] !== undefined).map((name) => [name, copy(value[name])])
  );

export function playerRenderAssets(world, observerMapId) {
  const locationId = world.getLocationId(observerMapId);
  const maps = world.listLocationMaps(observerMapId).map(({ id }) => {
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
    terrain.geometry = world.getMapGeometry(id).save();
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
      const owner = world.getMap(map.building.ownerMapId);
      const spec = owner.terrain.geometry?.structures?.find(
        (entry) => entry.id === map.building.structureId
      );
      if (!spec) throw new Error('The public floor is missing its authoritative structure');
      result.building = {
        ...fields(map.building, [
          'ownerMapId',
          'structureId',
          'offsetX',
          'offsetZ',
          'lengthFeet',
          'widthFeet',
        ]),
        floor: map.building.floor,
        roomHeightFeet:
          map.building.floor === 100 ? null : buildingLevelHeight(spec, map.building.floor),
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
        'ends',
        'pathFeet',
        'feature',
        'outsideMapId',
        'building',
      ])
    );
  return {
    location: world.listLocations().find((entry) => entry.id === locationId),
    maps,
    connections,
  };
}
