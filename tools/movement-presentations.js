const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PublishedMaps } = require('./published-maps.js');

const copy = (value) => JSON.parse(JSON.stringify(value));
const invalid = (message) =>
  Object.assign(new Error(message), { status: 422, code: 'invalid-scene-presentation' });

async function validateMovementPresentations({ root, previous, scene, presentations }) {
  if (
    !Array.isArray(presentations) ||
    presentations.length > 256 ||
    new Set(presentations.map((entry) => entry?.commandId)).size !== presentations.length ||
    !scene ||
    !Array.isArray(scene.creatures) ||
    (scene.version === 3 && !Array.isArray(scene.maps))
  )
    throw invalid('Shared movement requires a valid scene and bounded unique presentations');
  const [{ validatePlayerMotion }, { samePlacement, sceneActorPlacement }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'src', 'campaigns', 'PlayerPublicProtocol.js')).href),
    import(
      pathToFileURL(path.join(root, 'src', 'scene', 'token-adapter', 'SavedPlacements.js')).href
    ),
  ]);
  const published = new PublishedMaps(root);
  const currentMaps = new Map(published.maps(scene).map((map) => [map.id, map]));
  const previousMaps = new Map(published.maps(previous).map((map) => [map.id, map]));
  const maps = new Map(previousMaps);
  for (const [id, map] of currentMaps) {
    const old = maps.get(id);
    if (!map.grid || !Number.isSafeInteger(map.grid.cols) || !Number.isSafeInteger(map.grid.rows))
      throw invalid('Shared movement requires valid map dimensions');
    maps.set(id, {
      ...map,
      grid: {
        ...map.grid,
        cols: Math.max(map.grid.cols, old?.grid.cols ?? 0),
        rows: Math.max(map.grid.rows, old?.grid.rows ?? 0),
      },
    });
  }
  for (const entry of presentations) {
    if (
      !entry ||
      Object.keys(entry).some((key) => !['commandId', 'tokenId', 'kind', 'motion'].includes(key)) ||
      typeof entry.commandId !== 'string' ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(entry.commandId) ||
      entry.kind !== 'move'
    )
      throw invalid('The shared movement presentation is invalid');
    try {
      validatePlayerMotion(entry.motion, maps);
    } catch (error) {
      if (!['invalid-player-state', 'invalid-saved-placement'].includes(error.code)) throw error;
      throw Object.assign(invalid(error.message), { cause: error });
    }
    if (
      ![entry.motion.from, ...entry.motion.route].every((point) =>
        [currentMaps.get(point.mapId), previousMaps.get(point.mapId)].some(
          (map) => map && point.gridX < map.grid.cols && point.gridY < map.grid.rows
        )
      )
    )
      throw invalid('A shared waypoint is outside the before/after map bounds');
    const actor = scene.creatures.find(({ id }) => id === entry.tokenId);
    const origin = previous?.creatures.find(({ id }) => id === entry.tokenId);
    if (
      !actor ||
      !origin ||
      !samePlacement(entry.motion.from, sceneActorPlacement(previous, origin)) ||
      !samePlacement(entry.motion.route.at(-1), sceneActorPlacement(scene, actor))
    )
      throw invalid('Shared movement must connect the previous and committed poses');
  }
}

async function visibleMovementPresentations({
  root,
  scene,
  library,
  view,
  updates,
  state,
  sinceSceneRevision,
}) {
  if (!scene || !view.observerTokenId || !updates.length) return [];
  const [
    { default: CampaignWorld },
    { physicalSightObstacles },
    { samePlacement, coalesceMovementPresentations },
  ] = await Promise.all([
    import(pathToFileURL(path.join(root, 'src', 'campaigns', 'CampaignWorld.js')).href),
    import(pathToFileURL(path.join(root, 'src', 'campaigns', 'CreatureVisibility.js')).href),
    import(
      pathToFileURL(path.join(root, 'src', 'scene', 'token-adapter', 'SavedPlacements.js')).href
    ),
  ]);
  const world = CampaignWorld.fromScene(scene, { ruleset: scene.ruleset, library });
  const observer = scene.creatures.find(({ id }) => id === view.observerTokenId);
  const observerMapId = scene.version === 3 ? observer.mapId : 'map-main';
  const origin = world.toCampaignPosition(observerMapId, observer.pose.world);
  const geometry = {
    mapId: observerMapId,
    obstacles: physicalSightObstacles(world, observerMapId),
  };
  const maps = new Set(view.maps.map(({ id }) => id));
  const actors = new Map(view.publicScene.actors.map((actor) => [actor.id, actor]));
  const visible = new Map();
  const current = updates.filter(
    (update) =>
      update.motion &&
      update.sceneRevision <= state.sceneRevision &&
      update.charactersRevision <= state.revision &&
      (sinceSceneRevision === undefined || update.sceneRevision > sinceSceneRevision)
  );
  for (const update of coalesceMovementPresentations(current)) {
    const actor = actors.get(update.tokenId);
    if (
      !actor ||
      !samePlacement(update.motion.route.at(-1), actor) ||
      ![update.motion.from, ...update.motion.route].every(
        (point) =>
          maps.has(point.mapId) &&
          point.gridX < world.getMap(point.mapId).grid.cols &&
          point.gridY < world.getMap(point.mapId).grid.rows &&
          (actor.owned ||
            world.hasLineOfSight(
              origin,
              world.toCampaignPosition(point.mapId, point.pose.world),
              geometry
            ))
      )
    )
      continue;
    const presented = copy(update);
    if (!actor.owned) {
      delete presented.costFeet;
      delete presented.budget;
    }
    visible.set(presented.commandId, presented);
  }
  return [...visible.values()];
}

module.exports = { validateMovementPresentations, visibleMovementPresentations };
