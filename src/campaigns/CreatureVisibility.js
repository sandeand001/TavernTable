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
  const visible = creatures.filter(
    (token) =>
      published.has(token.mapId) &&
      world.sharesLocation(observer.mapId, token.mapId) &&
      (token === observer ||
        world.hasLineOfSight(
          origin,
          world.toCampaignPosition(token.mapId, token.pose.world),
          geometry
        ))
  );
  return { observer, observers, visible };
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
