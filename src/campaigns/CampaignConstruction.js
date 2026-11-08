import { isSurfaceGripValid } from './CampaignSurfaceClimb.js';
import { campaignToMapFeet, localWorldToCampaign } from './CampaignCoordinates.js';
import { isBuildingJoinConnection, isGeneratedBuildingJoin } from '../terrain/BuildingSnaps.js';
import { captureBuildingContext } from './BuildingAssembly.js';

export function unlinkBuildingInteriors(gm, structureId) {
  const world = gm.campaignWorld,
    ownerId = gm.campaignMapId;
  if (!world || !ownerId || world.getMap(ownerId).building)
    throw new Error('Return to the exterior map to disconnect building interiors');
  const scene = world.save(),
    floorIds = new Set(
      scene.maps
        .filter(
          (map) => map.building?.ownerMapId === ownerId && map.building.structureId === structureId
        )
        .map((map) => map.id)
    );
  const connections = scene.connections.filter(
    (connection) =>
      isBuildingJoinConnection(connection, ownerId) &&
      connection.ends.some((end) => floorIds.has(end.mapId))
  );
  if (!connections.length) return false;
  const removed = new Set(connections.map((connection) => connection.id)),
    context = captureBuildingContext(scene, ownerId);
  context.connections = context.connections.filter((connection) => !removed.has(connection.id));
  return gm.terrainEngine.removeBuildingJoins(
    [...new Set(connections.flatMap((connection) => connection.feature.volumeIds))],
    context
  );
}

export function validateConstructionEdit(gm, geometry, context = null) {
  if (
    gm.sceneAutosave?.ready === false ||
    gm.campaignViewBusy ||
    gm.characterServices?.combat?.pending ||
    gm.characterServices?.combat?.committing ||
    gm.characterServices?.library?.isSaving ||
    gm.characterServices?.library?.pendingScenes > 0 ||
    gm.sceneAutosave?.writing ||
    gm.placedTokens?.some((token) => gm.token3DAdapter?.isMovementInProgress(token))
  )
    throw new Error('Finish the current action before changing a structure');
  const world = gm.campaignWorld;
  if (world) {
    const volumes = new Map(geometry.save().volumes.map((volume) => [volume.id, volume]));
    const previous = gm.terrainEngine.geometry.save();
    const original = new Map(previous.volumes.map((volume) => [volume.id, volume]));
    for (const connection of world.getConnections())
      if (connection.feature.mapId === gm.campaignMapId && !connection.building)
        for (const id of connection.feature.volumeIds)
          if (
            JSON.stringify(volumes.get(id)) !== JSON.stringify(original.get(id)) &&
            !(
              isBuildingJoinConnection(connection, gm.campaignMapId) &&
              ((context?.ownerMapId === gm.campaignMapId && Array.isArray(context.connections)) ||
                (context?.replacingGeneratedJoins === true &&
                  isGeneratedBuildingJoin(connection, gm.campaignMapId, previous, (id) =>
                    world.getMap(id)
                  )))
            )
          )
            throw new Error(
              'This structure has a connected opening or stairway; unlink it before resizing'
            );
  }
  const map = world?.getMap(gm.campaignMapId);
  const nextStructures = new Map(geometry.getStructures().map((spec) => [spec.id, spec]));
  const changed = new Set(
    gm.terrainEngine.geometry
      .getStructures()
      .filter((spec) => JSON.stringify(spec) !== JSON.stringify(nextStructures.get(spec.id)))
      .map((spec) => spec.id)
  );
  const unit = gm.spatial.tileWorldSize / 5;
  for (const token of gm.placedTokens || []) {
    if (world && !world.sharesLocation(token.mapId, gm.campaignMapId)) continue;
    const pose = gm.token3DAdapter.getStablePlacement(token).pose;
    const tokenMap = world?.getMap(token.mapId);
    if (
      tokenMap?.building?.ownerMapId === gm.campaignMapId &&
      changed.has(tokenMap.building.structureId)
    )
      throw new Error(
        'A creature occupies a floor in this structure; move it outside before editing'
      );
    const point = world
      ? campaignToMapFeet(map, localWorldToCampaign(tokenMap, pose.world))
      : { x: pose.world.x / unit, y: pose.world.y / unit, z: pose.world.z / unit };
    if (
      point.x < 0 ||
      point.z < 0 ||
      point.x >= geometry.widthFeet ||
      point.z >= geometry.depthFeet
    )
      continue;
    if (changed.size && changed.has(gm.terrainEngine.geometry.structureAt(point)?.id))
      throw new Error('A creature occupies this structure; move it outside before editing');
    if (pose.kind === 'grip' && world) {
      if (
        !isSurfaceGripValid(world.save().maps, { mapId: token.mapId, pose }, (id) =>
          id === gm.campaignMapId ? geometry : world.getMapGeometry(id)
        )
      )
        throw new Error('A creature is gripping this structure; move it before resizing');
    }
    const radius = pose.kind === 'flight' ? 2.49 : 0.49;
    const body = {
      min: {
        x: Math.max(0, point.x - radius),
        y: point.y + 1e-5,
        z: Math.max(0, point.z - radius),
      },
      max: {
        x: Math.min(geometry.widthFeet, point.x + radius),
        y: point.y + 5 - 1e-5,
        z: Math.min(geometry.depthFeet, point.z + radius),
      },
    };
    const clear =
      pose.kind === 'ground'
        ? geometry.isGroundSpaceClear(body, point.y + 2.5)
        : geometry.isSpaceClear(body);
    if (!clear) throw new Error('A creature would be inside the changed structure');
    if (pose.kind === 'ground' && (!world || token.mapId === gm.campaignMapId)) {
      const support = geometry.findSupport(point.x, point.z, {
        belowFeet: point.y + 1e-5,
        clearanceFeet: 5,
      });
      if (!support || Math.abs(support.heightFeet - point.y) > 1e-4)
        throw new Error('A creature would lose its floor; move it before resizing');
    }
  }
}
