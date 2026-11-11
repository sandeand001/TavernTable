import {
  ConnectionUnavailableError,
  connectionEndpointFeet,
  connectionFeatureBounds,
  connectionOpeningAxis,
  connectionApertureBounds,
  connectionGroundEntry,
} from './CampaignConnectionGeometry.js';
import { facingAngleFromDirection } from '../entities/creatures/TokenMovement.js';
import {
  campaignFeetBounds,
  campaignToMapFeet,
  localWorldToCampaign,
  mapFeetToCampaign,
} from './CampaignCoordinates.js';
import { FEET_PER_GRID_SQUARE } from '../config/TokenMovementConfig.js';
import { boundsIntersectSolid } from '../terrain/ConvexGeometry.js';

const EPSILON = 1e-6;
const distance = (a, b) => Math.max(...['x', 'y', 'z'].map((axis) => Math.abs(a[axis] - b[axis])));
const unavailable = (message) => {
  throw new ConnectionUnavailableError(message);
};

export function isOpeningHoldValid(maps, connections, creature, geometryForMap) {
  const connection = connections.find((entry) => entry.id === creature.pose?.openingId);
  if (!connection || connection.kind !== 'window' || connection.outsideMapId !== creature.mapId)
    return false;
  const owner = maps.find((map) => map.id === connection.feature.mapId);
  const outsideMap = maps.find((map) => map.id === creature.mapId);
  const geometry = owner && geometryForMap(owner.id);
  const feature = geometry
    ?.save()
    .volumes.find(
      (volume) =>
        connection.feature.volumeIds.includes(volume.id) && volume.operation === 'subtract'
    );
  if (!feature || !outsideMap) return false;
  const bounds = connectionApertureBounds(
    owner,
    connection,
    campaignFeetBounds(owner, feature.bounds)
  );
  const thin = connectionOpeningAxis(owner, connection, bounds);
  const wide = thin === 'x' ? 'z' : 'x';
  const outsideEnd = connection.ends.find((end) => end.mapId === creature.mapId);
  const outside = mapFeetToCampaign(outsideMap, outsideEnd.positionFeet);
  const sign = outside[thin] < (bounds.min[thin] + bounds.max[thin]) / 2 ? -1 : 1;
  const grip = (sign < 0 ? bounds.min[thin] : bounds.max[thin]) + sign * 0.5;
  const point = localWorldToCampaign(outsideMap, creature.pose.world);
  if (
    Math.abs(point[thin] - grip) > 1e-4 ||
    point.y > bounds.min.y - 5 + EPSILON ||
    point[wide] < bounds.min[wide] - 0.5 - EPSILON ||
    point[wide] > bounds.max[wide] + 0.5 + EPSILON
  )
    return false;
  const hand = campaignToMapFeet(owner, {
    ...point,
    [thin]: (bounds.min[thin] + bounds.max[thin]) / 2,
    y: point.y + 5 - EPSILON,
  });
  if (hand.x < 0 || hand.z < 0 || hand.x >= owner.grid.cols * 5 || hand.z >= owner.grid.rows * 5)
    return false;
  if (
    !geometry
      .getSolidSpansAt(hand.x, hand.z)
      .some((span) => span.bottom <= hand.y && span.top >= hand.y)
  )
    return false;
  const exterior = geometryForMap(outsideMap.id);
  if (exterior) {
    const a = campaignToMapFeet(outsideMap, {
      x: point.x - 0.5,
      y: point.y + EPSILON,
      z: point.z - 0.5,
    });
    const b = campaignToMapFeet(outsideMap, {
      x: point.x + 0.5,
      y: point.y + 5 - EPSILON,
      z: point.z + 0.5,
    });
    const body = {
      min: { x: Math.max(0, Math.min(a.x, b.x)), y: a.y, z: Math.max(0, Math.min(a.z, b.z)) },
      max: {
        x: Math.min(outsideMap.grid.cols * 5, Math.max(a.x, b.x)),
        y: b.y,
        z: Math.min(outsideMap.grid.rows * 5, Math.max(a.z, b.z)),
      },
    };
    if (body.min.x < body.max.x && body.min.z < body.max.z && !exterior.isSpaceClear(body))
      return false;
  }
  return true;
}

export function openingFrame(world, connection, options = {}, start = null) {
  const bounds = connectionFeatureBounds(world, connection, options)[0];
  const thin = connectionOpeningAxis(world.getMap(connection.feature.mapId), connection, bounds);
  const wide = thin === 'x' ? 'z' : 'x';
  const outsideEnd = connection.ends.find((end) => end.mapId === connection.outsideMapId);
  if (!outsideEnd) throw new Error('The window has no exterior attachment');
  const insideEnd = connection.ends.find((end) => end !== outsideEnd);
  const positioned = (end) =>
    start
      ? world.toCampaignPosition(
          end.mapId,
          connectionGroundEntry(
            world,
            connection,
            end.mapId,
            world.toMapPosition(end.mapId, start),
            options
          )
        )
      : connectionEndpointFeet(world, end);
  const outside = positioned(outsideEnd);
  const inside = positioned(insideEnd);
  const sign = outside[thin] < (bounds.min[thin] + bounds.max[thin]) / 2 ? -1 : 1;
  const center = inside[wide];
  const grip = {
    ...outside,
    [thin]: (sign < 0 ? bounds.min[thin] : bounds.max[thin]) + sign * 0.5,
    [wide]: center,
    y: bounds.min.y - 5,
  };
  const sill = { ...grip, y: bounds.min.y };
  const inner = { ...sill, [thin]: sign < 0 ? bounds.max[thin] : bounds.min[thin] };
  return {
    bounds,
    thin,
    wide,
    sign,
    center,
    outside,
    inside,
    outsideEnd,
    insideEnd,
    grip,
    sill,
    inner,
  };
}

function assertClear(world, route, options) {
  const obstacles = world.getObstacles(options);
  for (const actor of options.occupants || []) {
    if (!world.sharesLocation(actor.mapId, options.mapId)) continue;
    const position = world.toCampaignPosition(actor.mapId, actor.world);
    obstacles.push({
      min: { x: position.x - 2, y: position.y + EPSILON, z: position.z - 2 },
      max: { x: position.x + 2, y: position.y + 5 - EPSILON, z: position.z + 2 },
    });
  }
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1],
      b = route[i];
    const body = {
      min: {
        x: Math.min(a.x, b.x) - 0.5,
        y: Math.min(a.y, b.y) + EPSILON,
        z: Math.min(a.z, b.z) - 0.5,
      },
      max: {
        x: Math.max(a.x, b.x) + 0.5,
        y: Math.max(a.y, b.y) + 5 - EPSILON,
        z: Math.max(a.z, b.z) + 0.5,
      },
    };
    if (obstacles.some((bounds) => boundsIntersectSolid(body, bounds, EPSILON)))
      unavailable('The window climbing route is blocked or lacks body clearance');
  }
}

function climbPlan(
  world,
  connection,
  frame,
  { targetMapId, targetFeet, pose, routeFeet, costFeet, label, crossing = null },
  options
) {
  const route = routeFeet.filter(
    (point, index, all) => index === 0 || distance(point, all[index - 1]) > EPSILON
  );
  assertClear(world, route, options);
  const targetWorld = world.toMapPosition(targetMapId, targetFeet);
  if (
    pose.kind === 'ledge' &&
    !world.isOpeningHoldValid(targetMapId, targetWorld, pose.openingId, options)
  ) {
    pose = {
      kind: 'grip',
      grip: world.openingSurfaceGrip(targetMapId, targetWorld, connection.id, options),
    };
  }
  const localFace = world.toMapPosition(targetMapId, {
    ...targetFeet,
    [frame.thin]: targetFeet[frame.thin] - frame.sign,
  });
  return {
    connectionId: connection.id,
    kind: connection.kind,
    travelMode: 'ground',
    actionLabel: label,
    targetMapId,
    targetWorld,
    targetPose: { ...pose, world: targetWorld },
    targetFacingAngle: facingAngleFromDirection(
      localFace.x - targetWorld.x,
      localFace.z - targetWorld.z
    ),
    routeFeet: route,
    ...(crossing ? { openingCrossing: crossing } : {}),
    costFeet: Math.ceil(costFeet / 5 - EPSILON) * 5,
    facingDelta: 0,
  };
}

function budgetedRoute(start, segments, allowance = Infinity) {
  if ((allowance !== Infinity && !Number.isFinite(allowance)) || allowance < 0)
    throw new Error('Climbing requires a valid remaining movement allowance');
  const budget = allowance === Infinity ? Infinity : Math.floor(allowance / 5 + EPSILON) * 5;
  const routeFeet = [start];
  let costFeet = 0;
  let current = start;
  for (const { point, factor } of segments) {
    const cost = distance(current, point) * factor;
    if (costFeet + cost <= budget + EPSILON) {
      routeFeet.push(point);
      costFeet += cost;
      current = point;
      continue;
    }
    const ratio = cost > EPSILON ? Math.max(0, (budget - costFeet) / cost) : 0;
    if (ratio > EPSILON) {
      current = Object.fromEntries(
        ['x', 'y', 'z'].map((axis) => [axis, current[axis] + (point[axis] - current[axis]) * ratio])
      );
      routeFeet.push(current);
      costFeet = budget;
    }
    break;
  }
  if (costFeet <= EPSILON) {
    const error = new ConnectionUnavailableError('No climbing movement remains');
    error.code = 'insufficient-movement';
    throw error;
  }
  return { routeFeet, costFeet, targetFeet: current };
}

function ascentPlan(world, connection, frame, start, safeSegments, options) {
  const suffix = [
    { point: frame.sill, factor: 2 },
    { point: frame.inner, factor: 2 },
    { point: frame.inside, factor: 2 },
  ];
  const complete = budgetedRoute(start, [...safeSegments, ...suffix]);
  const allowance = options.allowanceFeet ?? Infinity;
  const prefixCost = safeSegments.reduce(
    (result, segment) => ({
      point: segment.point,
      cost: result.cost + segment.factor * distance(result.point, segment.point),
    }),
    { point: start, cost: 0 }
  ).cost;
  const costFeet = prefixCost + FEET_PER_GRID_SQUARE;
  const needed = Math.ceil(costFeet / 5 - EPSILON) * 5;
  if (needed <= allowance + EPSILON || prefixCost <= EPSILON)
    return climbPlan(
      world,
      connection,
      frame,
      {
        ...complete,
        costFeet,
        targetMapId: frame.insideEnd.mapId,
        pose: { kind: 'ground' },
        label: 'Climb in',
        crossing: crossingFrame(frame, 'in'),
      },
      options
    );
  const partial = budgetedRoute(start, safeSegments, allowance);
  return climbPlan(
    world,
    connection,
    frame,
    {
      ...partial,
      targetMapId: connection.outsideMapId,
      pose:
        partial.targetFeet.y > frame.outside.y + EPSILON
          ? { kind: 'ledge', openingId: connection.id }
          : { kind: 'ground' },
      label: 'Climb toward window',
    },
    options
  );
}

function crossingFrame(frame, direction) {
  return {
    direction,
    gripFeet: frame.grip,
    sillFeet: frame.sill,
    innerFeet: frame.inner,
    insideFeet: frame.inside,
  };
}

function directEntryFrame(world, connection, frame, start, options) {
  if (
    start[frame.wide] < frame.bounds.min[frame.wide] + 0.5 - EPSILON ||
    start[frame.wide] > frame.bounds.max[frame.wide] - 0.5 + EPSILON ||
    Math.abs(start[frame.thin] - frame.grip[frame.thin]) > 2 ||
    start.y > frame.grip.y + EPSILON
  )
    return null;
  const owner = world.getMap(options.surfaceGrip?.mapId || connection.feature.mapId);
  const sample = campaignToMapFeet(owner, {
    ...start,
    [frame.thin]: (frame.bounds.min[frame.thin] + frame.bounds.max[frame.thin]) / 2,
    y: start.y + 5 - EPSILON,
  });
  const top = frame.bounds.min.y - owner.originFeet.y - EPSILON;
  const geometry =
    owner.id === options.mapId && options.geometry
      ? options.geometry
      : world.getMapGeometry(owner.id);
  if (
    !geometry
      .getSolidSpansAt(sample.x, sample.z)
      .some((span) => span.bottom <= sample.y && span.top >= top)
  )
    return null;
  const grip = { ...start, y: frame.grip.y };
  return {
    ...frame,
    grip,
    sill: { ...grip, y: frame.sill.y },
    inner: { ...frame.inner, [frame.wide]: start[frame.wide] },
  };
}

export function planWindowClimb(world, connection, mapId, localWorld, options = {}) {
  const action = options.action || 'cross';
  if (!['cross', 'down', 'drop'].includes(action))
    throw new Error('Unknown window climbing action');
  const start = world.toCampaignPosition(mapId, localWorld);
  const frame = openingFrame(world, connection, options, start);
  if (
    action === 'cross' &&
    (frame.bounds.max[frame.wide] - frame.bounds.min[frame.wide] < 1 - EPSILON ||
      frame.bounds.max.y - frame.bounds.min.y < 5 - EPSILON)
  )
    unavailable('This window is too small for the creature; it needs body clearance');
  if (
    mapId === connection.outsideMapId &&
    (options.openingHold === connection.id || options.surfaceGrip)
  ) {
    if (
      !(options.surfaceGrip
        ? world.isSurfaceGripValid(mapId, localWorld, options.surfaceGrip, options)
        : world.isOpeningHoldValid(mapId, localWorld, connection.id, options))
    )
      unavailable('The window no longer supports this hold');
    if (action === 'drop') {
      const landing = world.findSupportBelow(start, options);
      if (!landing) unavailable('There is no physical landing surface below this window');
      return {
        connectionId: connection.id,
        kind: connection.kind,
        actionLabel: 'Let go',
        travelMode: 'ground',
        targetMapId: landing.mapId,
        targetWorld: landing.world,
        targetPose: { kind: 'ground', world: landing.world, surfaceId: landing.surfaceId },
        routeFeet: [start, landing.positionFeet],
        costFeet: 0,
        facingDelta: 0,
        fall: { distanceFeet: start.y - landing.positionFeet.y, ignoreFlight: true },
      };
    }
    if (action === 'down') {
      const landing = world.findSupportBelow({ ...frame.outside, y: start.y }, options);
      if (!landing) unavailable('There is no supported surface below this window');
      const column = { ...start, [frame.wide]: frame.outside[frame.wide] };
      const foot = { ...column, y: landing.positionFeet.y };
      const end = { ...frame.outside, y: landing.positionFeet.y };
      const route = budgetedRoute(
        start,
        [
          { point: column, factor: 2 },
          { point: foot, factor: 2 },
          { point: end, factor: 1 },
        ],
        options.allowanceFeet
      );
      const holds = route.targetFeet.y > landing.positionFeet.y + EPSILON;
      return climbPlan(
        world,
        connection,
        frame,
        {
          ...route,
          targetMapId: holds ? mapId : landing.mapId,
          pose: holds ? { kind: 'ledge', openingId: connection.id } : { kind: 'ground' },
          label: 'Climb down',
        },
        options
      );
    }
    const direct = directEntryFrame(world, connection, frame, start, options);
    if (direct)
      return ascentPlan(
        world,
        connection,
        direct,
        start,
        [{ point: direct.grip, factor: 2 }],
        options
      );
    const column = { ...start, [frame.wide]: frame.outside[frame.wide] };
    const safe =
      start.y < frame.grip.y - EPSILON
        ? [
            { point: column, factor: 2 },
            { point: { ...column, y: frame.grip.y }, factor: 2 },
            { point: frame.grip, factor: 2 },
          ]
        : [{ point: frame.grip, factor: 2 }];
    return ascentPlan(world, connection, frame, start, safe, options);
  }
  if (mapId === connection.outsideMapId) {
    if (action !== 'cross') unavailable('Climb down or Let go requires an exterior hold');
    const support = world.findSupportBelow(start, options);
    if (!support || Math.abs(support.positionFeet.y - start.y) > EPSILON)
      unavailable('Reach supported ground before climbing toward this window');
    if (distance(start, frame.outside) > 5 + EPSILON)
      unavailable('Move within 5 feet of the exterior climbing position first');
    if (frame.grip.y > frame.outside.y + EPSILON) {
      const foot = { ...frame.grip, [frame.wide]: frame.outside[frame.wide], y: frame.outside.y };
      return ascentPlan(
        world,
        connection,
        frame,
        start,
        [
          { point: frame.outside, factor: 1 },
          { point: foot, factor: 1 },
          { point: { ...foot, y: frame.grip.y }, factor: 2 },
          { point: frame.grip, factor: 2 },
        ],
        options
      );
    }
    const route = [start, frame.outside, frame.sill, frame.inner, frame.inside];
    const cost = distance(start, frame.outside) + FEET_PER_GRID_SQUARE;
    return climbPlan(
      world,
      connection,
      frame,
      {
        targetMapId: frame.insideEnd.mapId,
        targetFeet: frame.inside,
        pose: { kind: 'ground' },
        routeFeet: route,
        costFeet: cost,
        label: 'Climb in',
        crossing: crossingFrame(frame, 'in'),
      },
      options
    );
  }
  if (mapId !== frame.insideEnd.mapId) throw new Error('The window is not on this creature map');
  if (distance(start, frame.inside) > 5 + EPSILON)
    unavailable('Move within 5 feet of the window first');
  const landingPoint = { ...frame.outside, [frame.wide]: frame.center, y: frame.bounds.min.y };
  const landing = world.findSupportBelow(landingPoint, options);
  const holds = !landing || landing.positionFeet.y < frame.grip.y - EPSILON;
  const targetFeet = holds ? frame.grip : landing.positionFeet;
  const routeFeet = [start, frame.inside, frame.inner, frame.sill, targetFeet];
  const targetMapId = holds ? connection.outsideMapId : landing.mapId;
  const pose = holds
    ? { kind: 'ledge', openingId: connection.id }
    : { kind: 'ground', surfaceId: landing.surfaceId };
  const cost = distance(start, frame.inside) + FEET_PER_GRID_SQUARE;
  return climbPlan(
    world,
    connection,
    frame,
    {
      targetMapId,
      targetFeet,
      pose,
      routeFeet,
      costFeet: cost,
      label: 'Climb out',
      crossing: crossingFrame(frame, 'out'),
    },
    options
  );
}
