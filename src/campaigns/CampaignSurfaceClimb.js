import {
  campaignToMapFeet,
  localWorldToCampaign,
  mapFeetToCampaign,
} from './CampaignCoordinates.js';
import { ConnectionUnavailableError } from './CampaignConnectionGeometry.js';
import { openingFrame } from './CampaignOpeningClimb.js';

const EPSILON = 1e-5;
const BODY_FEET = 5;
const OFFSET_FEET = 0.5;
const axes = ['x', 'y', 'z'];
const length = (a, b) => Math.max(...axes.map((axis) => Math.abs(a[axis] - b[axis])));
const unavailable = (message, code = 'unavailable') => {
  const error = new ConnectionUnavailableError(message);
  error.code = code;
  throw error;
};
const lerp = (a, b, ratio) =>
  Object.fromEntries(axes.map((axis) => [axis, a[axis] + (b[axis] - a[axis]) * ratio]));
const mapsOf = (world) => world.listMaps().map(({ id }) => world.getMap(id));

export function validGripReference(grip) {
  return (
    grip &&
    typeof grip.mapId === 'string' &&
    Number.isFinite(grip.offsetFeet) &&
    grip.offsetFeet >= OFFSET_FEET &&
    grip.offsetFeet <= 2 &&
    axes.every(
      (axis) => Number.isFinite(grip.pointFeet?.[axis]) && Number.isFinite(grip.normal?.[axis])
    ) &&
    grip.normal.y === 0 &&
    Math.abs(grip.normal.x) + Math.abs(grip.normal.z) === 1 &&
    Number.isInteger(grip.normal.x) &&
    Number.isInteger(grip.normal.z)
  );
}

function frame(maps, grip) {
  const owner = maps.find((map) => map.id === grip.mapId);
  if (!owner || !validGripReference(grip)) return null;
  const contact = mapFeetToCampaign(owner, grip.pointFeet);
  const outward = mapFeetToCampaign(owner, {
    x: grip.pointFeet.x + grip.normal.x,
    y: grip.pointFeet.y,
    z: grip.pointFeet.z + grip.normal.z,
  });
  const normal = {
    x: Math.round(outward.x - contact.x),
    y: 0,
    z: Math.round(outward.z - contact.z),
  };
  const thin = normal.x ? 'x' : 'z';
  return {
    owner,
    contact,
    normal,
    thin,
    wide: thin === 'x' ? 'z' : 'x',
    offsetFeet: grip.offsetFeet,
  };
}

export function isSurfaceGripValid(maps, creature, geometryForMap) {
  const grip = creature.pose?.grip;
  const attachment = frame(maps, grip);
  const map = maps.find((entry) => entry.id === creature.mapId);
  if (!attachment || !map) return false;
  const { owner, contact, normal } = attachment;
  const feet = localWorldToCampaign(map, creature.pose.world);
  if (
    Math.abs(feet.y + BODY_FEET - contact.y) > EPSILON ||
    Math.abs(feet.x - contact.x - normal.x * grip.offsetFeet) > EPSILON ||
    Math.abs(feet.z - contact.z - normal.z * grip.offsetFeet) > EPSILON
  )
    return false;
  const point = campaignToMapFeet(owner, {
    x: contact.x - normal.x * EPSILON,
    y: contact.y - EPSILON,
    z: contact.z - normal.z * EPSILON,
  });
  const geometry = geometryForMap(owner.id);
  if (
    !geometry ||
    point.x < 0 ||
    point.z < 0 ||
    point.x >= geometry.widthFeet ||
    point.z >= geometry.depthFeet ||
    !geometry
      .getSolidSpansAt(point.x, point.z)
      .some((span) => span.bottom <= point.y && span.top >= point.y)
  )
    return false;
  for (const candidate of maps) {
    const physical = geometryForMap(candidate.id);
    if (!physical) continue;
    const a = campaignToMapFeet(candidate, {
      x: feet.x - OFFSET_FEET + EPSILON,
      y: feet.y + EPSILON,
      z: feet.z - OFFSET_FEET + EPSILON,
    });
    const b = campaignToMapFeet(candidate, {
      x: feet.x + OFFSET_FEET - EPSILON,
      y: feet.y + BODY_FEET - EPSILON,
      z: feet.z + OFFSET_FEET - EPSILON,
    });
    const bounds = {
      min: { x: Math.max(0, Math.min(a.x, b.x)), y: a.y, z: Math.max(0, Math.min(a.z, b.z)) },
      max: {
        x: Math.min(physical.widthFeet, Math.max(a.x, b.x)),
        y: b.y,
        z: Math.min(physical.depthFeet, Math.max(a.z, b.z)),
      },
    };
    if (
      bounds.min.x < bounds.max.x &&
      bounds.min.z < bounds.max.z &&
      !physical.isSpaceClear(bounds)
    )
      return false;
  }
  return true;
}

export function openingSurfaceGrip(world, mapId, position, openingId, options = {}) {
  const connection = world.getConnections().find((entry) => entry.id === openingId);
  if (!connection) throw new Error('The held opening no longer exists');
  const opening = openingFrame(world, connection, options);
  const feet = world.toCampaignPosition(mapId, position);
  const attachment = {
    owner: world.getMap(connection.feature.mapId),
    normal: {
      x: opening.thin === 'x' ? opening.sign : 0,
      y: 0,
      z: opening.thin === 'z' ? opening.sign : 0,
    },
  };
  for (let offsetFeet = OFFSET_FEET; offsetFeet <= 2; offsetFeet += 0.25) {
    const grip = gripAt(world, mapId, feet, { ...attachment, offsetFeet });
    if (
      isSurfaceGripValid(
        mapsOf(world),
        { mapId, pose: { kind: 'grip', world: position, grip } },
        (id) => geometryFor(world, options, id)
      )
    )
      return grip;
  }
  unavailable('The opening no longer has a reachable physical grip');
}

export function gripAt(world, mapId, feet, attachment) {
  const owner = attachment.owner;
  const offsetFeet = attachment.offsetFeet ?? OFFSET_FEET;
  const contact = {
    x: feet.x - attachment.normal.x * offsetFeet,
    y: feet.y + BODY_FEET,
    z: feet.z - attachment.normal.z * offsetFeet,
  };
  const local = campaignToMapFeet(owner, contact);
  const outward = campaignToMapFeet(owner, {
    ...contact,
    x: contact.x + attachment.normal.x,
    z: contact.z + attachment.normal.z,
  });
  return {
    mapId: owner.id,
    pointFeet: local,
    offsetFeet,
    normal: { x: Math.round(outward.x - local.x), y: 0, z: Math.round(outward.z - local.z) },
  };
}

function geometryFor(world, options, id) {
  return id === options.mapId && options.geometry ? options.geometry : world.getMapGeometry(id);
}

function poseAt(world, mapId, feet, attachment) {
  return {
    kind: 'grip',
    world: world.toMapPosition(mapId, feet),
    grip: gripAt(world, mapId, feet, attachment),
  };
}

function validAt(world, mapId, feet, attachment, options) {
  return isSurfaceGripValid(
    mapsOf(world),
    {
      mapId,
      pose: poseAt(world, mapId, feet, attachment),
    },
    (id) => geometryFor(world, options, id)
  );
}

function columnIntervals(world, attachment, feet, options) {
  const local = campaignToMapFeet(attachment.owner, {
    ...feet,
    x: feet.x - attachment.normal.x * (attachment.offsetFeet + EPSILON),
    z: feet.z - attachment.normal.z * (attachment.offsetFeet + EPSILON),
  });
  const geometry = geometryFor(world, options, attachment.owner.id);
  return geometry.getSolidSpansAt(local.x, local.z).map((span) => ({
    low: span.bottom + attachment.owner.originFeet.y - BODY_FEET + EPSILON * 2,
    high: span.top + attachment.owner.originFeet.y - BODY_FEET,
  }));
}

export function wallClimbStarts(world, mapId, startWorld, surface, options = {}) {
  const viewed = options.mapId || mapId;
  const owner = world.getMap(surface.mapId || viewed);
  const hit = world.toCampaignPosition(viewed, surface.point);
  const normalPoint = world.toCampaignPosition(viewed, {
    x: surface.point.x + surface.normal.x,
    y: surface.point.y,
    z: surface.point.z + surface.normal.z,
  });
  const normal = {
    x: Math.round(Math.sign(normalPoint.x - hit.x)),
    y: 0,
    z: Math.round(Math.sign(normalPoint.z - hit.z)),
  };
  if (Math.abs(normal.x) + Math.abs(normal.z) !== 1)
    unavailable('Choose an axis-aligned physical wall');
  const thin = normal.x ? 'x' : 'z',
    wide = thin === 'x' ? 'z' : 'x';
  const offsetFeet = surface.gripOffsetFeet ?? OFFSET_FEET;
  if (!Number.isFinite(offsetFeet) || offsetFeet < OFFSET_FEET || offsetFeet > 2)
    throw new Error('The requested wall grip has an invalid reach');
  const attachment = { owner, normal, thin, wide, offsetFeet };
  const target = {
    x: hit.x + normal.x * offsetFeet,
    y: hit.y - BODY_FEET,
    z: hit.z + normal.z * offsetFeet,
  };
  const intervals = columnIntervals(world, attachment, target, options);
  const interval = intervals.find(
    (span) => target.y >= span.low - EPSILON && target.y <= span.high + EPSILON
  );
  if (!interval) unavailable('The clicked wall has no reachable hand grip');
  target.y = Math.min(target.y, interval.high);
  if (!validAt(world, mapId, target, attachment, options))
    unavailable('The clicked wall has no clear climbing hold');
  const start = world.toCampaignPosition(mapId, startWorld);
  const candidates = [target[wide]];
  const geometry = geometryFor(world, options, owner.id);
  const partition = geometry.getPartition();
  for (const axis of ['x', 'z'])
    for (const value of partition[axis]) {
      const local = campaignToMapFeet(owner, target);
      local[axis] = value;
      const campaign = mapFeetToCampaign(owner, local);
      for (const offset of [-0.5, 0.5]) candidates.push(campaign[wide] + offset);
    }
  const starts = [];
  for (const lateral of new Set(candidates)) {
    const position = { ...target, [wide]: lateral, y: start.y + EPSILON };
    const support = world.findSupportBelow(position, options);
    if (!support || support.mapId !== mapId) continue;
    position.y = support.positionFeet.y;
    if (!validAt(world, mapId, position, attachment, options)) continue;
    starts.push({
      world: world.toMapPosition(mapId, position),
      grip: gripAt(world, mapId, position, attachment),
      destination: {
        ...surface,
        point: world.toMapPosition(viewed, { ...target, y: target.y + BODY_FEET }),
      },
      distance: length(start, position) + length(position, target) * 2,
    });
  }
  return starts.sort((a, b) => a.distance - b.distance);
}

export function platformClimbWalls(world, mapId, surface, options = {}) {
  const viewed = options.mapId || mapId;
  const target = world.toCampaignPosition(viewed, surface.point);
  const candidates = [];
  for (const owner of mapsOf(world)) {
    const localTarget = campaignToMapFeet(owner, target);
    for (const volume of geometryFor(world, options, owner.id).save().volumes) {
      if (
        volume.operation !== 'add' ||
        volume.bounds.min.y > localTarget.y - BODY_FEET + EPSILON ||
        volume.bounds.max.y < localTarget.y - EPSILON
      )
        continue;
      for (const thin of ['x', 'z'])
        for (const sign of [-1, 1]) {
          const wide = thin === 'x' ? 'z' : 'x';
          const contact = {
            ...localTarget,
            y: localTarget.y - BODY_FEET,
            [thin]: sign < 0 ? volume.bounds.min[thin] : volume.bounds.max[thin],
            [wide]: Math.max(
              volume.bounds.min[wide] + EPSILON,
              Math.min(volume.bounds.max[wide] - EPSILON, localTarget[wide])
            ),
          };
          for (const lift of [-BODY_FEET, 0, BODY_FEET]) {
            contact.y = localTarget.y + lift + BODY_FEET;
            const physical = mapFeetToCampaign(owner, contact);
            const outward = mapFeetToCampaign(owner, { ...contact, [thin]: contact[thin] + sign });
            const point = world.toMapPosition(viewed, physical);
            const normalPoint = world.toMapPosition(viewed, outward);
            const scale = 5 / world.getMap(viewed).grid.tileWorldSize;
            candidates.push({
              mapId: owner.id,
              kind: 'wall',
              point,
              normal: {
                x: Math.round((normalPoint.x - point.x) * scale),
                y: 0,
                z: Math.round((normalPoint.z - point.z) * scale),
              },
              distance: length(physical, target),
            });
          }
        }
    }
  }
  return candidates.sort((a, b) => a.distance - b.distance);
}

function assertBodyRoute(world, start, end, options, obstacles) {
  const body = {
    min: {
      x: Math.min(start.x, end.x) - OFFSET_FEET + EPSILON,
      y: Math.min(start.y, end.y) + EPSILON,
      z: Math.min(start.z, end.z) - OFFSET_FEET + EPSILON,
    },
    max: {
      x: Math.max(start.x, end.x) + OFFSET_FEET - EPSILON,
      y: Math.max(start.y, end.y) + BODY_FEET - EPSILON,
      z: Math.max(start.z, end.z) + OFFSET_FEET - EPSILON,
    },
  };
  if (
    obstacles.some((bounds) =>
      axes.every(
        (axis) =>
          body.min[axis] < bounds.max[axis] - EPSILON && body.max[axis] > bounds.min[axis] + EPSILON
      )
    )
  )
    unavailable('A wall, floor or railing blocks the climbing route');
  for (const actor of options.occupants || []) {
    const position = world.toCampaignPosition(actor.mapId, actor.world);
    if (
      position.x + 2 > body.min.x &&
      position.x - 2 < body.max.x &&
      position.z + 2 > body.min.z &&
      position.z - 2 < body.max.z &&
      position.y + BODY_FEET > body.min.y &&
      position.y < body.max.y
    )
      unavailable('Another creature blocks the climbing route');
  }
}

function verticalRoute(world, mapId, start, end, attachment, options) {
  const direction = Math.sign(end.y - start.y);
  if (!direction) return [];
  const intervals = columnIntervals(world, attachment, start, options);
  const route = [];
  let point = { ...start };
  for (
    let count = 0;
    count <= intervals.length + 1 && Math.abs(point.y - end.y) > EPSILON;
    count++
  ) {
    const span = intervals.find(
      ({ low, high }) => point.y >= low - EPSILON && point.y <= high + EPSILON
    );
    if (!span) unavailable('There is no physical wall grip along this route');
    const y = direction < 0 ? Math.max(end.y, span.low) : Math.min(end.y, span.high);
    if (Math.abs(y - point.y) > EPSILON) {
      point = { ...point, y };
      route.push({ point, kind: 'climb' });
    }
    if (Math.abs(point.y - end.y) <= EPSILON) break;
    if (direction > 0) unavailable('An upward opening gap needs another climbing route');
    const below = intervals
      .filter((entry) => entry.high < point.y - EPSILON)
      .sort((a, b) => b.high - a.high)[0];
    if (!below || below.high < end.y - EPSILON)
      unavailable('There is no reachable wall grip below this opening');
    point = { ...point, y: below.high };
    route.push({ point, kind: 'catch', fallFeet: y - point.y });
  }
  return route;
}

function lateralRoute(world, mapId, start, end, attachment, options) {
  const { wide } = attachment;
  const lateral = { ...start, [wide]: end[wide] };
  const segments = [];
  if (length(start, lateral) > EPSILON) {
    const geometry = geometryFor(world, options, attachment.owner.id);
    const cuts = geometry.getPartition();
    const candidates = [0, 1];
    const source = campaignToMapFeet(attachment.owner, start);
    const target = campaignToMapFeet(attachment.owner, lateral);
    for (const axis of ['x', 'z']) {
      const delta = target[axis] - source[axis];
      if (Math.abs(delta) <= EPSILON) continue;
      for (const cut of cuts[axis]) {
        const ratio = (cut - source[axis]) / delta;
        if (ratio > 0 && ratio < 1) candidates.push(ratio);
      }
    }
    candidates.sort((a, b) => a - b);
    if (
      candidates.some(
        (ratio, index) =>
          index > 0 &&
          !validAt(
            world,
            mapId,
            lerp(start, lateral, (ratio + candidates[index - 1]) / 2),
            attachment,
            options
          )
      )
    )
      unavailable('Sideways travel through an opening needs another solid-wall route');
    segments.push({ point: lateral, kind: 'climb' });
  }
  return segments;
}

function attachedRoute(world, mapId, start, end, attachment, options) {
  const upright = { ...start, y: end.y };
  try {
    return [
      ...verticalRoute(world, mapId, start, upright, attachment, options),
      ...lateralRoute(world, mapId, upright, end, attachment, options),
    ];
  } catch (error) {
    if (!(error instanceof ConnectionUnavailableError)) throw error;
    const across = { ...start, [attachment.wide]: end[attachment.wide] };
    return [
      ...lateralRoute(world, mapId, start, across, attachment, options),
      ...verticalRoute(world, mapId, across, end, attachment, options),
    ];
  }
}

function raisedPlatformRoute(world, mapId, start, end, attachment, options, obstacles) {
  const floor = world.findSupportBelow({ ...end, y: end.y + EPSILON }, options);
  if (!floor || floor.mapId !== mapId || Math.abs(floor.positionFeet.y - end.y) > EPSILON)
    unavailable('This platform has no supported landing beside the climbing wall');
  const minimum = Math.max(start.y, end.y);
  const heights = [...new Set([minimum, ...obstacles.map((bounds) => bounds.max.y)])]
    .filter((height) => height >= minimum - EPSILON && height <= end.y + BODY_FEET + EPSILON)
    .sort((a, b) => a - b);
  for (const height of heights) {
    const raised = { ...end, y: height };
    if (!validAt(world, mapId, raised, attachment, options)) continue;
    try {
      const route = attachedRoute(world, mapId, start, raised, attachment, options);
      route.push({ point: end, kind: 'drop', fallFeet: height - end.y, support: floor });
      let previous = start;
      for (const segment of route) {
        assertBodyRoute(world, previous, segment.point, options, obstacles);
        previous = segment.point;
      }
      return route;
    } catch (error) {
      if (!(error instanceof ConnectionUnavailableError)) throw error;
    }
  }
  unavailable('No supported wall route clears this platform and its railings');
}

export function planSurfaceClimb(world, mapId, startWorld, grip, destination, options = {}) {
  if (
    !destination?.point ||
    !destination.normal ||
    !axes.every(
      (axis) =>
        Number.isFinite(destination.point[axis]) && Number.isFinite(destination.normal[axis])
    )
  )
    throw new Error('Climbing requires a finite floor or wall intersection');
  if (!validGripReference(grip))
    throw new Error('Physical climbing requires a valid wall attachment');
  const attachment = frame(mapsOf(world), grip);
  if (!attachment) throw new Error('The climbing wall no longer exists');
  const start = world.toCampaignPosition(mapId, startWorld);
  if (!validAt(world, mapId, start, attachment, options))
    unavailable('The creature no longer has a physical wall hold');
  const target = world.toCampaignPosition(options.mapId || mapId, destination.point);
  if (destination.normal.y < 0.9 && Math.abs(destination.normal.y) >= 0.45)
    unavailable('Choose a wall handhold or a supported floor, not a ceiling');
  if (destination.normal.y < 0.9) target.y -= BODY_FEET;
  if (
    destination.normal.y < 0.9 &&
    Math.abs(target[attachment.thin] - attachment.contact[attachment.thin]) >
      attachment.offsetFeet + 0.1
  )
    unavailable('Choose a destination on the attached wall');
  const end = { ...start, y: target.y, [attachment.wide]: target[attachment.wide] };
  const supported = destination.normal.y > 0.9;
  let support = supported ? world.findSupportBelow(target, options) : null;
  if (supported && (!support || Math.abs(support.positionFeet.y - target.y) > EPSILON))
    unavailable('Choose a real supported destination');
  if (supported && target.y < start.y + EPSILON) {
    support = world.findSupportBelow({ ...end, y: target.y + EPSILON }, options);
    if (!support || Math.abs(support.positionFeet.y - target.y) > EPSILON)
      unavailable(
        'The clicked floor is not beside this wall; choose an opening or another supported route'
      );
  }
  if (support && support.mapId !== mapId)
    unavailable('Use the physical opening to enter the floor on another map');
  const obstacles = world.getObstacles(options);
  let route;
  try {
    if (supported && target.y < start.y + EPSILON) {
      const beforeGround = { ...end, y: Math.min(start.y, target.y + EPSILON) };
      const intervals = columnIntervals(world, attachment, end, options);
      const last = intervals
        .filter((entry) => entry.high >= target.y && entry.low <= start.y)
        .sort((a, b) => a.low - b.low)[0];
      if (last) {
        beforeGround.y = Math.max(target.y, last.low);
        route = attachedRoute(world, mapId, start, beforeGround, attachment, options);
      } else route = [];
      const previous = route.at(-1)?.point || start;
      if (previous.y > target.y + EPSILON)
        route.push({
          point: { ...previous, y: target.y },
          kind: 'drop',
          fallFeet: previous.y - target.y,
          support,
        });
      else route.push({ point: { ...previous, y: target.y }, kind: 'ground', support });
    } else if (supported) {
      const lip = { ...end, y: target.y - BODY_FEET };
      if (!validAt(world, mapId, lip, attachment, options))
        unavailable(
          'This platform needs a reachable solid climbing face, not an unsupported overhang'
        );
      route = attachedRoute(world, mapId, start, lip, attachment, options);
      route.push(
        { point: { ...lip, y: target.y }, kind: 'mantle', support },
        { point: target, kind: 'ground', support }
      );
    } else {
      if (!validAt(world, mapId, end, attachment, options))
        unavailable('Choose a wall point with a solid grip and clear body space');
      route = attachedRoute(world, mapId, start, end, attachment, options);
    }
    if (supported) {
      let previous = start;
      for (const segment of route) {
        assertBodyRoute(world, previous, segment.point, options, obstacles);
        previous = segment.point;
      }
    }
  } catch (error) {
    if (!supported || !(error instanceof ConnectionUnavailableError)) throw error;
    route = raisedPlatformRoute(world, mapId, start, end, attachment, options, obstacles);
  }
  const allowance = options.allowanceFeet ?? Infinity;
  if ((allowance !== Infinity && !Number.isFinite(allowance)) || allowance < 0)
    throw new Error('Climbing requires a valid movement allowance');
  let previous = start,
    spent = 0;
  const points = [];
  for (let routeIndex = 0; routeIndex < route.length; routeIndex++) {
    const segment = route[routeIndex];
    const distance = length(previous, segment.point);
    const cost =
      segment.kind === 'climb' || segment.kind === 'mantle'
        ? distance * 2
        : segment.kind === 'ground'
          ? distance
          : 0;
    if (segment.kind === 'mantle') {
      const suffix = cost + length(segment.point, route[routeIndex + 1].point);
      if (Math.ceil((spent + suffix) / 5 - EPSILON) * 5 > allowance) break;
    }
    if (cost > 0 && spent >= allowance - EPSILON) break;
    const ratio = cost > 0 ? Math.min(1, (allowance - spent) / cost) : 1;
    const point = lerp(previous, segment.point, ratio);
    assertBodyRoute(world, previous, point, options, obstacles);
    const count = segment.kind === 'climb' ? Math.max(1, Math.ceil((distance * ratio) / 2.5)) : 1;
    for (let index = 1; index <= count; index++) {
      const feet = lerp(previous, point, index / count);
      const landed = ratio === 1 && index === count && ['ground', 'drop'].includes(segment.kind);
      const pose = landed
        ? {
            kind: 'ground',
            world: world.toMapPosition(segment.support.mapId, feet),
            surfaceId: segment.support.surfaceId,
          }
        : poseAt(world, mapId, feet, attachment);
      if (!landed && segment.kind !== 'mantle' && !validAt(world, mapId, feet, attachment, options))
        unavailable('The route has no safe physical wall hold');
      points.push({
        world: world.toMapPosition(mapId, feet),
        pose,
        mapId: landed ? segment.support.mapId : mapId,
        kind: segment.kind,
        ...(segment.kind === 'mantle'
          ? {
              transient: true,
              gripHeight: world.toMapPosition(mapId, target).y,
            }
          : {}),
        ...(segment.fallFeet ? { fallFeet: segment.fallFeet } : {}),
        cost: spent + (cost * ratio * index) / count,
      });
    }
    spent += cost * ratio;
    previous = point;
    if (ratio < 1) break;
  }
  if (!points.length) unavailable('No climbing movement remains', 'insufficient-movement');
  const costFeet = Math.ceil(spent / 5 - EPSILON) * 5;
  if (costFeet > allowance + EPSILON)
    unavailable('Not enough movement remains for this climb', 'insufficient-movement');
  points.at(-1).cost = costFeet;
  return {
    points,
    costFeet,
    grip,
    targetWorld: points.at(-1).world,
    gapFalls: points.filter((point) => point.kind === 'catch').map((point) => point.fallFeet),
  };
}
