import { MAX_STEP_HEIGHT_FEET } from '../config/TokenMovementConfig.js';
import { facingAngleFromDirection } from '../entities/creatures/TokenMovement.js';
import { boundsIntersectSolid } from '../terrain/ConvexGeometry.js';
import { CAVERN_SIDES } from '../terrain/generation/CavernInteriors.js';
import { ConnectionUnavailableError } from './CampaignConnectionGeometry.js';
import { localMapSupport } from './PhysicalMapQueries.js';

const EPS = 1e-6;
const point = (value) => value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
const distance = (a, b) => Math.max(...['x', 'y', 'z'].map((axis) => Math.abs(a[axis] - b[axis])));
const unavailable = (message) => {
  throw new ConnectionUnavailableError(message);
};

export function logicalPassageEndpoint(
  map,
  side,
  getTerrainHeight = null,
  elevationUnit = map?.terrain?.worldElevationUnit
) {
  if (!map?.grid || !CAVERN_SIDES.includes(side))
    throw new Error('A cavern entrance requires a valid map and side');
  const { cols, rows, tileWorldSize } = map.grid;
  const [gridX, gridY] = {
    north: [Math.floor(cols / 2), 0],
    east: [cols - 1, Math.floor(rows / 2)],
    south: [Math.floor(cols / 2), rows - 1],
    west: [0, Math.floor(rows / 2)],
  }[side];
  const height = getTerrainHeight
    ? getTerrainHeight(gridX, gridY)
    : map.terrain.heights[gridY][gridX];
  if (!Number.isFinite(height) || !Number.isFinite(elevationUnit) || elevationUnit < 0)
    throw new Error('The cavern entrance height is invalid');
  return {
    gridX,
    gridY,
    world: {
      x: (gridX + 0.5) * tileWorldSize,
      y: height * elevationUnit,
      z: (gridY + 0.5) * tileWorldSize,
    },
  };
}

function occupantBounds(world, mapId, occupants) {
  return occupants
    .filter((actor) => world.sharesLocation(actor.mapId, mapId))
    .map((actor) => {
      const position = world.toCampaignPosition(actor.mapId, actor.world);
      return {
        min: { x: position.x - 2, y: position.y + EPS, z: position.z - 2 },
        max: { x: position.x + 2, y: position.y + 5 - EPS, z: position.z + 2 },
      };
    });
}

function bodyBetween(a, b) {
  return {
    min: {
      x: Math.min(a.x, b.x) - 0.5,
      y: Math.max(a.y, b.y) + EPS,
      z: Math.min(a.z, b.z) - 0.5,
    },
    max: {
      x: Math.max(a.x, b.x) + 0.5,
      y: Math.max(a.y, b.y) + 5 - EPS,
      z: Math.max(a.z, b.z) + 0.5,
    },
  };
}

export function planLogicalPassage(world, passage, mapId, localWorld, options = {}) {
  if (!point(localWorld)) throw new Error('Cavern travel requires a valid creature position');
  if (options.action !== undefined && options.action !== 'cross')
    throw new Error('A cavern passage supports only crossing');
  const travelMode = options.travelMode ?? 'ground';
  if (!['ground', 'fly'].includes(travelMode))
    throw new Error('Cavern travel requires a ground or flying movement mode');
  const source = passage.ends.find((end) => end.mapId === mapId);
  const target = passage.ends.find((end) => end.mapId !== mapId);
  if (!source || !target) throw new Error('The cavern passage is not on this map');
  const sourceMap = world.getMap(mapId);
  const targetMap = world.getMap(target.mapId);
  const sourceEntry = logicalPassageEndpoint(
    sourceMap,
    source.side,
    options.getTerrainHeight,
    options.elevationUnit
  );
  const targetEntry = logicalPassageEndpoint(targetMap, target.side);
  const sourceGeometry = options.geometry ?? world.getMapGeometry(mapId);
  const targetGeometry = world.getMapGeometry(target.mapId);
  const sourceSupport = localMapSupport(sourceMap, sourceGeometry, sourceEntry.world, {
    clearanceFeet: 5,
  });
  const targetSupport = localMapSupport(targetMap, targetGeometry, targetEntry.world, {
    clearanceFeet: 5,
  });
  if (!sourceSupport || Math.abs(sourceSupport.heightWorld - sourceEntry.world.y) > EPS)
    unavailable('The cavern entrance has no clear supported floor');
  if (!targetSupport || Math.abs(targetSupport.heightWorld - targetEntry.world.y) > EPS)
    unavailable('The destination passage has no clear supported landing');

  const flying = travelMode === 'fly';
  const sourceWorld = { ...sourceEntry.world };
  const targetWorld = { ...targetEntry.world };
  if (flying) {
    const heightFeet = (localWorld.y - sourceWorld.y) * (5 / sourceMap.grid.tileWorldSize);
    if (heightFeet < -EPS) unavailable('Fly above the entrance floor before crossing');
    sourceWorld.y = localWorld.y;
    targetWorld.y += (heightFeet * targetMap.grid.tileWorldSize) / 5;
  }
  const start = world.toCampaignPosition(mapId, localWorld);
  const entry = world.toCampaignPosition(mapId, sourceWorld);
  const exit = world.toCampaignPosition(target.mapId, targetWorld);
  const approach = distance(start, entry);
  if (approach > 5 + EPS) unavailable('Move within 5 feet of this entrance first');
  if (!flying && Math.abs(start.y - entry.y) > MAX_STEP_HEIGHT_FEET + EPS)
    unavailable('The cavern entrance requires a supported step');
  if (!flying) {
    const samples = Math.max(1, Math.ceil(approach / 0.5));
    for (let index = 0; index <= samples; index++) {
      const ratio = index / samples;
      const support = world.findSupportBelow(
        {
          x: start.x + (entry.x - start.x) * ratio,
          y: Math.max(start.y, entry.y) + EPS,
          z: start.z + (entry.z - start.z) * ratio,
        },
        { mapId, geometry: sourceGeometry }
      );
      if (!support || support.positionFeet.y < Math.min(start.y, entry.y) - EPS)
        unavailable('The cavern entrance crosses unsupported ground');
    }
  }
  const occupants = options.occupants || [];
  const sourceBody = bodyBetween(start, entry);
  const destinationBody = bodyBetween(exit, exit);
  if (
    world
      .getObstacles({ mapId, geometry: sourceGeometry, coverBounds: options.coverBounds ?? null })
      .some((solid) => boundsIntersectSolid(sourceBody, solid, 0)) ||
    world
      .getObstacles({ mapId: target.mapId })
      .some((solid) => boundsIntersectSolid(destinationBody, solid, 0))
  )
    unavailable('A wall or low ceiling blocks this cavern passage');
  if (
    occupantBounds(world, mapId, occupants).some((bounds) =>
      boundsIntersectSolid(sourceBody, bounds, 0)
    ) ||
    occupantBounds(world, target.mapId, occupants).some((bounds) =>
      boundsIntersectSolid(destinationBody, bounds, 0)
    )
  )
    unavailable('Another creature blocks this cavern passage');
  const direction = {
    north: { x: 0, z: 1 },
    east: { x: -1, z: 0 },
    south: { x: 0, z: -1 },
    west: { x: 1, z: 0 },
  }[target.side];
  return {
    connectionId: passage.id,
    kind: 'logical-passage',
    targetMapId: target.mapId,
    targetWorld,
    targetPose: { kind: flying ? 'flight' : 'ground', world: targetWorld },
    targetFacingAngle: facingAngleFromDirection(direction.x, direction.z),
    costFeet: 5 + Math.max(0, Math.ceil(approach / 5 - EPS) * 5),
    travelMode,
  };
}
