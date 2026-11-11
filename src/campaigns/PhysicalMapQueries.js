import {
  campaignFeetBounds,
  campaignToLocalWorld,
  mapFeetToCampaign,
} from './CampaignCoordinates.js';
import { pointInsideSolid, segmentIntersectsSolid } from '../terrain/ConvexGeometry.js';

const finitePoint = (point) =>
  point && ['x', 'y', 'z'].every((axis) => Number.isFinite(point[axis]));

export function mapGeometryObstacles(map, geometry, cache) {
  if (geometry.hasCurves) {
    const cells = geometry.getSolidCells();
    let cached = cache.get(map.id);
    if (cached?.geometry !== geometry || cached.cells !== cells) {
      const origin = mapFeetToCampaign(map, { x: 0, y: 0, z: 0 });
      const obstacles = cells.map((cell) => {
        const bounds = campaignFeetBounds(map, cell.bounds);
        if (
          cell.planes.every(({ normal }) =>
            ['x', 'y', 'z'].some((axis) => Math.abs(normal[axis]) > 1 - 1e-10)
          )
        )
          return bounds;
        return {
          ...bounds,
          planes: cell.planes.map(({ normal, distance }) => {
            const endpoint = mapFeetToCampaign(map, normal);
            const rotated = {
              x: endpoint.x - origin.x,
              y: endpoint.y - origin.y,
              z: endpoint.z - origin.z,
            };
            return {
              normal: rotated,
              distance:
                distance + rotated.x * origin.x + rotated.y * origin.y + rotated.z * origin.z,
            };
          }),
        };
      });
      cached = { geometry, cells, obstacles };
      cache.set(map.id, cached);
    }
    return cached.obstacles;
  }
  const result = [];
  const axes = geometry.getPartition();
  for (let x = 1; x < axes.x.length; x++)
    for (let z = 1; z < axes.z.length; z++) {
      const cx = (axes.x[x - 1] + axes.x[x]) / 2;
      const cz = (axes.z[z - 1] + axes.z[z]) / 2;
      for (const span of geometry.getSolidSpansAt(cx, cz))
        result.push(
          campaignFeetBounds(map, {
            min: { x: axes.x[x - 1], y: Math.max(-1000000, span.bottom), z: axes.z[z - 1] },
            max: { x: axes.x[x], y: span.top, z: axes.z[z] },
          })
        );
    }
  return result;
}

export function localMapSupport(
  map,
  geometry,
  world,
  { surfaceId = null, clearanceFeet = 0 } = {}
) {
  if (
    !finitePoint(world) ||
    !Number.isFinite(clearanceFeet) ||
    clearanceFeet < 0 ||
    (surfaceId !== null && typeof surfaceId !== 'string')
  )
    throw new Error('Map support requires a valid local position and clearance');
  const x = Math.floor(world.x / map.grid.tileWorldSize);
  const z = Math.floor(world.z / map.grid.tileWorldSize);
  if (x < 0 || z < 0 || x >= map.grid.cols || z >= map.grid.rows)
    throw new Error('The creature support query is outside its own grid');
  const scale = 5 / map.grid.tileWorldSize;
  const support = geometry.findSupport(world.x * scale, world.z * scale, {
    belowFeet: world.y * scale + 1e-5,
    clearanceFeet,
    surfaceId,
  });
  return support ? { ...support, heightWorld: support.heightFeet / scale } : null;
}

export function supportBelowMaps(
  maps,
  getGeometry,
  point,
  { mapId = null, geometry: activeGeometry = null } = {}
) {
  if (!finitePoint(point)) throw new Error('Campaign support requires a valid physical position');
  if (activeGeometry && mapId === null)
    throw new Error('Live support geometry requires its owning map');
  let best = null;
  let priority = -1;
  for (const map of maps) {
    const local = campaignToLocalWorld(map, point);
    const scale = 5 / map.grid.tileWorldSize;
    const x = local.x * scale;
    const z = local.z * scale;
    if (x < 0 || z < 0 || x >= map.grid.cols * 5 || z >= map.grid.rows * 5) continue;
    const geometry = activeGeometry && map.id === mapId ? activeGeometry : getGeometry(map.id);
    const support = geometry.findSupport(x, z, { belowFeet: local.y * scale + 1e-6 });
    if (!support) continue;
    const height = map.originFeet.y + support.heightFeet;
    const rank = (map.id === mapId ? 2 : 0) + (map.base === 'floor' ? 1 : 0);
    if (
      best &&
      (height < best.positionFeet.y - 1e-6 ||
        (Math.abs(height - best.positionFeet.y) <= 1e-6 && rank <= priority))
    )
      continue;
    const positionFeet = { x: point.x, y: height, z: point.z };
    best = {
      mapId: map.id,
      surfaceId: support.id,
      layerId: support.layerId,
      positionFeet,
      world: campaignToLocalWorld(map, positionFeet),
    };
    priority = rank;
  }
  return best;
}

export function physicalCreatureSight(observerFeet, targetFeet, obstacles) {
  if (!finitePoint(observerFeet) || !finitePoint(targetFeet))
    throw new Error('Campaign sight requires valid physical creature positions');
  if (!Array.isArray(obstacles)) throw new Error('Campaign sight requires physical obstacles');
  const start = { ...observerFeet, y: observerFeet.y + 4 };
  return [2.5, 4.5].some((height) => {
    const end = { ...targetFeet, y: targetFeet.y + height };
    if (Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z) < 1e-7) return true;
    return !obstacles.some(
      (solid) => pointInsideSolid(start, solid) || segmentIntersectsSolid(start, end, solid)
    );
  });
}
