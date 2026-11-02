const EPSILON = 1e-6;

function footprint(world, map, cols = map.grid.cols, rows = map.grid.rows) {
  const a = world.toCampaignPosition(map.id, { x: 0, y: 0, z: 0 });
  const b = world.toCampaignPosition(map.id, {
    x: cols * map.grid.tileWorldSize,
    y: 0,
    z: rows * map.grid.tileWorldSize,
  });
  return {
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minZ: Math.min(a.z, b.z),
    maxZ: Math.max(a.z, b.z),
  };
}

function overlaps(a, b) {
  return (
    a.minX <= b.maxX + EPSILON &&
    a.maxX >= b.minX - EPSILON &&
    a.minZ <= b.maxZ + EPSILON &&
    a.maxZ >= b.minZ - EPSILON
  );
}

export function createInteriorCutaway(gm) {
  if (!gm.campaignWorld || !Number.isFinite(gm.terrainEngine?.geometry.terrainThicknessFeet))
    return null;
  const world = gm.campaignWorld;
  const maps = world.listMaps().map(({ id }) => world.getMap(id));
  const map = maps.find((entry) => entry.id === gm.campaignMapId);
  const region = footprint(world, map, gm.cols, gm.rows);
  const above = maps.filter((entry) => {
    if (
      entry.id === map.id ||
      entry.base !== 'floor' ||
      entry.originFeet.y <= map.originFeet.y + EPSILON
    )
      return false;
    const bounds = footprint(world, entry);
    return (
      Math.min(region.maxX, bounds.maxX) - Math.max(region.minX, bounds.minX) > EPSILON &&
      Math.min(region.maxZ, bounds.maxZ) - Math.max(region.minZ, bounds.minZ) > EPSILON
    );
  });
  const ceilingFeet = Math.min(
    Infinity,
    ...above.map(
      (entry) => entry.originFeet.y - world.getMapGeometry(entry.id).terrainThicknessFeet
    )
  );
  return {
    map,
    maps,
    intersects: (source) => overlaps(region, footprint(world, source)),
    query(geometry, source, partition, { includeFloor = false } = {}) {
      const sourceUnit = source.grid.tileWorldSize / 5;
      const sourceScale = 1 / sourceUnit;
      const sourcePoint = (x, z) => ({
        x: x * sourceUnit,
        y: 0,
        z: z * sourceUnit,
      });
      const toSource = (x, z) =>
        world.toMapPosition(
          source.id,
          world.toCampaignPosition(map.id, {
            x: x * gm.spatial.tileWorldSize,
            y: 0,
            z: z * gm.spatial.tileWorldSize,
          })
        );
      const a = toSource(0, 0);
      const b = toSource(gm.cols, gm.rows);
      const bounds = {
        minX: Math.min(a.x, b.x) * sourceScale,
        maxX: Math.max(a.x, b.x) * sourceScale,
        minZ: Math.min(a.z, b.z) * sourceScale,
        maxZ: Math.max(a.z, b.z) * sourceScale,
      };
      const roofs = geometry
        .save()
        .volumes.filter((volume) => volume.operation === 'add' && volume.layerId === 'roof');
      return {
        getPartition: () => partition,
        getSolidSpansAt(x, z) {
          const i = partition.x.findIndex((value) => value > x);
          const j = partition.z.findIndex((value) => value > z);
          if (
            !overlaps(bounds, {
              minX: partition.x[i - 1],
              maxX: partition.x[i],
              minZ: partition.z[j - 1],
              maxZ: partition.z[j],
            })
          )
            return [];
          const local = world.toMapPosition(
            map.id,
            world.toCampaignPosition(source.id, sourcePoint(x, z))
          );
          const gx = Math.max(
            0,
            Math.min(gm.cols - 1, Math.floor(local.x / gm.spatial.tileWorldSize))
          );
          const gz = Math.max(
            0,
            Math.min(gm.rows - 1, Math.floor(local.z / gm.spatial.tileWorldSize))
          );
          const floor =
            map.originFeet.y -
            source.originFeet.y +
            gm.terrainEngine.getHeightAt(gx, gz) *
              gm.spatial.elevationUnit *
              (5 / gm.spatial.tileWorldSize);
          let ceiling = ceilingFeet - source.originFeet.y;
          for (const { bounds: roof } of roofs)
            if (
              roof.min.y > floor + EPSILON &&
              x >= roof.min.x &&
              x < roof.max.x &&
              z >= roof.min.z &&
              z < roof.max.z
            )
              ceiling = Math.min(ceiling, roof.min.y);
          // Clip the mesh query without removing physical roofs or walls.
          return geometry
            .getSolidSpansAt(x, z)
            .map((span) => ({
              ...span,
              bottom: includeFloor ? span.bottom : Math.max(floor, span.bottom),
              top: Math.min(ceiling, span.top),
            }))
            .filter((span) => span.top - span.bottom > EPSILON);
        },
      };
    },
  };
}
