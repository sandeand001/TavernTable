export const DEFAULT_LOCATION_ID = 'location-main';

const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);

export function mapLocationId(map) {
  if (!map || !identifier(map.id)) throw new Error('A location query requires an existing map');
  return map.locationId ?? DEFAULT_LOCATION_ID;
}

export function validateCampaignLocations(scene) {
  if (scene.locations === undefined) {
    if (scene.version === 3 && scene.maps.some((map) => map.locationId !== undefined))
      throw new Error('Campaign map locations require an explicit location collection');
    return;
  }
  if (
    scene.version !== 3 ||
    !Array.isArray(scene.locations) ||
    !scene.locations.length ||
    scene.locations.length > 128 ||
    new Set(scene.locations.map((location) => location?.id)).size !== scene.locations.length ||
    scene.locations.some(
      (location) =>
        !location ||
        !identifier(location.id) ||
        typeof location.name !== 'string' ||
        !location.name.trim() ||
        location.name.length > 100 ||
        Object.keys(location).some((key) => !['id', 'name'].includes(key))
    )
  )
    throw new Error('The campaign location collection is invalid');
  const ids = new Set(scene.locations.map((location) => location.id));
  if (
    scene.maps.some((map) => !ids.has(map.locationId)) ||
    scene.locations.some((location) => !scene.maps.some((map) => map.locationId === location.id))
  )
    throw new Error('Each campaign location requires maps with valid location references');
  const byId = new Map(scene.maps.map((map) => [map.id, map]));
  for (const map of scene.maps)
    if (map.building && byId.get(map.building.ownerMapId)?.locationId !== map.locationId)
      throw new Error('A building and its connected floors must share a location');
  for (const connection of scene.connections || []) {
    const members = [
      ...(connection.ends || []).map((end) => end.mapId),
      ...(connection.feature ? [connection.feature.mapId] : []),
      ...(connection.outsideMapId ? [connection.outsideMapId] : []),
    ];
    if (new Set(members.map((id) => byId.get(id)?.locationId)).size !== 1)
      throw new Error('Physical connections cannot join independent campaign locations');
  }
  for (const creature of scene.creatures || []) {
    const owner = creature.pose?.grip?.mapId;
    if (owner && byId.get(owner)?.locationId !== byId.get(creature.mapId)?.locationId)
      throw new Error('A creature cannot hold a surface in another location');
    const opening =
      creature.pose?.kind === 'ledge'
        ? scene.connections?.find((connection) => connection.id === creature.pose.openingId)
        : null;
    if (
      opening &&
      byId.get(opening.feature.mapId)?.locationId !== byId.get(creature.mapId)?.locationId
    )
      throw new Error('A creature cannot hold an opening in another location');
  }
}
