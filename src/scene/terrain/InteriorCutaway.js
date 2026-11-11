import { clipCellToBounds } from '../../terrain/ConvexGeometry.js';
import { buildingLevels, buildingLevelHeight } from '../../terrain/BuildingModel.js';
import { isBuildingJoinConnection } from '../../terrain/BuildingSnaps.js';
import TerrainSightMask from './TerrainSightMask.js';

const EPSILON = 1e-6;

export function getBuildingFloorReference(world, map) {
  if (typeof world.getBuildingFloorRenderContext === 'function') {
    if (Object.hasOwn(map, 'building'))
      throw new Error('Public floor maps must use floorContext, not private building records');
    return map.floorContext ?? null;
  }
  return map.building ?? null;
}

export function getBuildingFloorRenderContext(world, mapId) {
  const map = world.getMap(mapId);
  if (typeof world.getBuildingFloorRenderContext === 'function')
    return publicFloorContext(world, map);
  if (!map.building) return null;
  const owner = world.getMap(map.building.ownerMapId),
    spec = owner.terrain.geometry?.structures?.find(
      (entry) => entry.id === map.building.structureId
    ),
    level = spec && buildingLevels(spec).find((entry) => entry.id === map.building.floor);
  if (!level) throw new Error('The building floor render definition is unavailable');
  return {
    ceilingFeet: level.roofDeck
      ? null
      : map.originFeet.y + buildingLevelHeight(spec, level.id) - 0.5,
    terrainThicknessFeet: world.getMapGeometry(map.id).terrainThicknessFeet,
    floorAppearance: spec.appearance
      ? {
          floorColor: spec.appearance.floorColor,
          floorMaterial: spec.appearance.floorMaterial,
        }
      : null,
  };
}

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

function publicFloorContext(world, map) {
  if (
    typeof world.getBuildingFloorRenderContext !== 'function' ||
    !getBuildingFloorReference(world, map)
  )
    return null;
  const context = world.getBuildingFloorRenderContext(map.id);
  if (
    !context ||
    (context.ceilingFeet !== null && !Number.isFinite(context.ceilingFeet)) ||
    !Number.isFinite(context.terrainThicknessFeet) ||
    context.terrainThicknessFeet <= 0
  )
    throw new Error('The public building floor render context is missing or invalid');
  return context;
}

function createMapCutaway(gm, world, maps, map) {
  const active = map.id === gm.campaignMapId,
    cols = active ? gm.cols : map.grid.cols,
    rows = active ? gm.rows : map.grid.rows,
    unit = map.grid.tileWorldSize,
    region = footprint(world, map, cols, rows);
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
  const context =
    publicFloorContext(world, map) ||
    (map.building ? getBuildingFloorRenderContext(world, map.id) : null);
  const managedCeiling = context?.ceilingFeet ?? Infinity;
  const ceilingFeet = Math.min(
    managedCeiling,
    Infinity,
    ...above.map(
      (entry) =>
        entry.originFeet.y -
        (publicFloorContext(world, entry)?.terrainThicknessFeet ??
          world.getMapGeometry(entry.id).terrainThicknessFeet)
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
            x: x * unit,
            y: 0,
            z: z * unit,
          })
        );
      const a = toSource(0, 0);
      const b = toSource(cols, rows);
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
        const gx = Math.max(0, Math.min(cols - 1, Math.floor(local.x / unit)));
        const gz = Math.max(0, Math.min(rows - 1, Math.floor(local.z / unit)));
        const floor =
          map.originFeet.y -
          source.originFeet.y +
          (active ? gm.terrainEngine.getHeightAt(gx, gz) : map.terrain.heights[gz][gx]) *
            (active ? gm.spatial.elevationUnit : map.terrain.worldElevationUnit) *
            (5 / unit);
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

export function createInteriorCutaway(gm) {
  if (!gm.campaignWorld || !Number.isFinite(gm.terrainEngine?.geometry.terrainThicknessFeet))
    return null;
  const world = gm.campaignWorld,
    maps = world.listLocationMaps(gm.campaignMapId).map(({ id }) => world.getMap(id)),
    map = maps.find((entry) => entry.id === gm.campaignMapId),
    members = [map],
    visited = new Set([map.id]);
  const reference = getBuildingFloorReference(world, map);
  if (reference)
    for (let i = 0; i < members.length; i++)
      for (const connection of world.getConnections()) {
        if (
          connection.enabled === false ||
          !isBuildingJoinConnection(connection, reference.ownerMapId) ||
          !connection.ends.some((end) => end.mapId === members[i].id)
        )
          continue;
        for (const end of connection.ends) {
          const candidate = maps.find((entry) => entry.id === end.mapId);
          if (
            !candidate ||
            visited.has(candidate.id) ||
            getBuildingFloorReference(world, candidate)?.ownerMapId !== reference.ownerMapId ||
            Math.abs(candidate.originFeet.y - map.originFeet.y) > EPSILON
          )
            continue;
          visited.add(candidate.id);
          members.push(candidate);
        }
      }
  const views = members.map((member) => createMapCutaway(gm, world, maps, member));
  if (views.length === 1) return views[0];
  return {
    map,
    maps,
    intersects: (source) => views.some((view) => view.intersects(source)),
    query(geometry, source, partition, options) {
      const queries = views.map((view) => view.query(geometry, source, partition, options));
      return {
        hasCurves: true,
        getPartition: () => partition,
        getSolidCells: () => queries.flatMap((query) => query.getSolidCells()),
        getSolidSpansAt: (x, z) => queries.flatMap((query) => query.getSolidSpansAt(x, z)),
      };
    },
  };
}
