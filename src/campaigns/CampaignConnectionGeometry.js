export class ConnectionUnavailableError extends Error {}

export function connectionEndpointFeet(world, end) {
  const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
  return world.toCampaignPosition(end.mapId, {
    x: end.positionFeet.x * unit,
    y: end.positionFeet.y * unit,
    z: end.positionFeet.z * unit,
  });
}

export function connectionFeatureBounds(world, connection, options = {}) {
  const { mapId, volumeIds } = connection.feature;
  const map = world.getMap(mapId);
  const geometry =
    mapId === options.mapId && options.geometry ? options.geometry : world.getMapGeometry(mapId);
  const volumes = new Map(geometry.save().volumes.map((volume) => [volume.id, volume]));
  const unit = map.grid.tileWorldSize / 5;
  const local = (point) => ({ x: point.x * unit, y: point.y * unit, z: point.z * unit });
  return volumeIds.map((id) => {
    const volume = volumes.get(id);
    if (!volume)
      throw new ConnectionUnavailableError(
        'This entrance no longer has its physical opening or staircase'
      );
    return world.toCampaignBounds(mapId, {
      min: local(volume.bounds.min),
      max: local(volume.bounds.max),
    });
  });
}
