import {
  connectionEndpointFeet,
  connectionFeatureBounds,
  connectionOpeningAxis,
} from './CampaignConnectionGeometry.js';

export function playerCreatureVisibility({
  world,
  creatures,
  ownedIds,
  publishedIds,
  observerTokenId = null,
}) {
  const owned = new Set(ownedIds);
  const published = new Set(publishedIds);
  const observers = creatures.filter(
    (token) => owned.has(token.characterId) && published.has(token.mapId)
  );
  const observer =
    observerTokenId === null
      ? observers[0] || null
      : observers.find((token) => token.id === observerTokenId);
  if (observerTokenId !== null && !observer)
    throw Object.assign(new Error('Choose a currently assigned creature in this campaign'), {
      status: 403,
    });
  if (!observer) return { observer: null, observers, visible: [] };
  const origin = world.toCampaignPosition(observer.mapId, observer.pose.world);
  const geometry = {
    mapId: observer.mapId,
    obstacles: physicalSightObstacles(world, observer.mapId),
  };
  const visibleMapIds = visiblePlayerMapIds(
    world,
    { mapId: observer.mapId, world: observer.pose.world },
    geometry
  );
  const visible = creatures.filter(
    (token) =>
      published.has(token.mapId) &&
      visibleMapIds.has(token.mapId) &&
      world.sharesLocation(observer.mapId, token.mapId) &&
      (token === observer ||
        world.hasLineOfSight(
          origin,
          world.toCampaignPosition(token.mapId, token.pose.world),
          geometry
        ))
  );
  return { observer, observers, visible, visibleMapIds, sightGeometry: geometry };
}

export function visiblePlayerMapIds(world, observer, options = {}) {
  const origin = world.toCampaignPosition(observer.mapId, observer.world);
  const sight = {
    mapId: observer.mapId,
    obstacles: options.obstacles ?? physicalSightObstacles(world, observer.mapId),
  };
  const visible = new Set(
    world
      .listLocationMaps(observer.mapId)
      .filter(({ id }) => world.getMap(id).base !== 'floor')
      .map(({ id }) => id)
  );
  visible.add(observer.mapId);
  const connections = world.getConnections();
  let changed = true;
  while (changed) {
    changed = false;
    for (const connection of connections) {
      if (
        connection.enabled === false ||
        (connection.kind === 'door' && connection.open !== true) ||
        !connection.ends.some((end) => visible.has(end.mapId)) ||
        connection.ends.every((end) => visible.has(end.mapId)) ||
        !world.sharesLocation(observer.mapId, connection.feature.mapId)
      )
        continue;
      let seen;
      if (['door', 'window', 'opening'].includes(connection.kind)) {
        const owner = world.getMap(connection.feature.mapId);
        seen = connectionFeatureBounds(world, connection).some((bounds) => {
          const axis = connectionOpeningAxis(owner, connection, bounds);
          const wide = axis === 'x' ? 'z' : 'x';
          const plane =
            origin[axis] < (bounds.min[axis] + bounds.max[axis]) / 2
              ? bounds.max[axis]
              : bounds.min[axis];
          const height = Math.max(bounds.min.y + 1e-4, Math.min(bounds.max.y - 1e-4, origin.y + 4));
          return [0.25, 0.5, 0.75].some((fraction) =>
            world.hasSurfaceLineOfSight(
              origin,
              {
                x: 0,
                y: height,
                z: 0,
                [axis]: plane,
                [wide]: bounds.min[wide] + (bounds.max[wide] - bounds.min[wide]) * fraction,
              },
              sight
            )
          );
        });
      } else {
        seen = connection.ends.some((end) => {
          if (visible.has(end.mapId)) return false;
          const target = connectionEndpointFeet(world, end);
          return world.hasSurfaceLineOfSight(origin, { ...target, y: target.y + 4 }, sight);
        });
      }
      if (!seen) continue;
      for (const end of connection.ends)
        if (!visible.has(end.mapId)) {
          visible.add(end.mapId);
          changed = true;
        }
    }
  }
  return visible;
}

export function isSightPlaceable(source) {
  return (
    source?.metricsOnly !== true &&
    (/^tree-/.test(source?.placeableId || '') || source?.type === 'rock')
  );
}

export function physicalSightObstacles(world, mapId = null) {
  const origin = mapId ?? world.save().view.mapId;
  const obstacles = world.getObstacles({ mapId: origin });
  for (const { id } of world.listLocationMaps(origin)) {
    const map = world.getMap(id);
    if (map.terrain.sightBounds === undefined && map.terrain.placeables.some(isSightPlaceable))
      throw Object.assign(
        new Error(
          'The DM must reopen and save maps with trees or rocks before publishing physical sight'
        ),
        { status: 409 }
      );
    for (const bounds of map.terrain.sightBounds || [])
      obstacles.push(world.toCampaignBounds(id, bounds));
  }
  return obstacles;
}
