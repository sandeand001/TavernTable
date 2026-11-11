import { clipCellToBounds } from '../../terrain/ConvexGeometry.js';
import { buildingLevels, buildingLevelHeight } from '../../terrain/BuildingModel.js';
import TerrainSightMask from './TerrainSightMask.js';

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

export function mapTerrainTransform(world, map, three, targetMapId = null) {
  const unit = map.grid.tileWorldSize / 5;
  const point = (x, y, z) => {
    const campaign = world.toCampaignPosition(map.id, {
      x: x * unit,
      y: y * unit,
      z: z * unit,
    });
    const value = targetMapId === null ? campaign : world.toMapPosition(targetMapId, campaign);
    return new three.Vector3(value.x, value.y, value.z);
  };
  const origin = point(0, 0, 0);
  return new three.Matrix4()
    .makeBasis(point(1, 0, 0).sub(origin), point(0, 1, 0).sub(origin), point(0, 0, 1).sub(origin))
    .setPosition(origin);
}

export function clipFloorSurfaceOverlap(geometry, { world, map, three, visibleMapIds = null }) {
  const solids = world
    .listLocationMaps(map.id)
    .filter(
      ({ id }) =>
        id !== map.id &&
        world.getMap(id).base === 'floor' &&
        (!visibleMapIds || visibleMapIds.has(id))
    )
    .flatMap(({ id }) =>
      world
        .getMapGeometry(id)
        .getSolidCells()
        .map((cell) => world.toCampaignSolid(id, cell))
    );
  if (!solids.length) return geometry;
  const transform = mapTerrainTransform(world, map, three);
  const scale = 5 / map.grid.tileWorldSize;
  transform.scale(new three.Vector3(scale, scale, scale));
  return new TerrainSightMask({ three, unrestricted: true }).apply(geometry, {
    toCampaign: transform,
    excludeSolids: solids,
    excludeSolidsForTriangle: (_start, normal) => normal.y > 0,
  });
}

export function createInteriorCutaway(gm) {
  if (!gm.campaignWorld || !Number.isFinite(gm.terrainEngine?.geometry.terrainThicknessFeet))
    return null;
  const world = gm.campaignWorld;
  const maps = world.listLocationMaps(gm.campaignMapId).map(({ id }) => world.getMap(id));
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
  const owner = map.building && maps.find((entry) => entry.id === map.building.ownerMapId);
  const spec = owner?.terrain.geometry?.structures?.find(
    (entry) => entry.id === map.building.structureId
  );
  const level = spec && buildingLevels(spec).find((entry) => entry.id === map.building.floor);
  const managedCeiling =
    level && !level.roofDeck
      ? map.originFeet.y + buildingLevelHeight(spec, level.id) - 0.5
      : Infinity;
  const ceilingFeet = Math.min(
    managedCeiling,
    Infinity,
    ...above.map(
      (entry) => entry.originFeet.y - world.getMapGeometry(entry.id).terrainThicknessFeet
    )
  );
  return {
    map,
    maps,
    ceilingFeet,
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
      const limitsAt = (x, z) => {
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
        return { floor, ceiling };
      };
      return {
        hasCurves: geometry.hasCurves,
        getPartition: () => partition,
        getSolidCells() {
          const cells = geometry.getSolidCells();
          const result = [];
          for (let i = 1; i < partition.x.length; i++)
            for (let j = 1; j < partition.z.length; j++) {
              const x0 = Math.max(bounds.minX, partition.x[i - 1]);
              const x1 = Math.min(bounds.maxX, partition.x[i]);
              const z0 = Math.max(bounds.minZ, partition.z[j - 1]);
              const z1 = Math.min(bounds.maxZ, partition.z[j]);
              if (x1 - x0 <= EPSILON || z1 - z0 <= EPSILON) continue;
              const { floor, ceiling } = limitsAt((x0 + x1) / 2, (z0 + z1) / 2);
              const clip = {
                min: { x: x0, y: includeFloor ? -Infinity : floor, z: z0 },
                max: { x: x1, y: ceiling, z: z1 },
              };
              for (const cell of cells) {
                const clipped = clipCellToBounds(cell, clip);
                if (clipped) result.push(clipped);
              }
            }
          return result;
        },
        getSolidSpansAt(x, z) {
          if (x < bounds.minX || x >= bounds.maxX || z < bounds.minZ || z >= bounds.maxZ) return [];
          const { floor, ceiling } = limitsAt(x, z);
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
