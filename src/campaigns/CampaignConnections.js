import { MAX_STEP_HEIGHT_FEET } from '../config/TokenMovementConfig.js';
import {
  ConnectionUnavailableError,
  connectionEndpointFeet as endpoint,
  connectionFeatureBounds,
} from './CampaignConnectionGeometry.js';
import { planWindowClimb } from './CampaignOpeningClimb.js';

export {
  ConnectionUnavailableError,
  connectionFeatureBounds,
} from './CampaignConnectionGeometry.js';

const EPSILON = 1e-6;
const point = (value) => value && ['x', 'y', 'z'].every((axis) => Number.isFinite(value[axis]));
const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,299}$/.test(value);
const distance = (a, b) => Math.max(...['x', 'y', 'z'].map((axis) => Math.abs(a[axis] - b[axis])));

function unavailable(message) {
  throw new ConnectionUnavailableError(message);
}

export function validateConnections(connections, maps) {
  if (connections === undefined) return;
  const invalid = () => {
    throw new Error('The saved campaign has invalid physical map connections');
  };
  if (!Array.isArray(connections) || connections.length > 2000) invalid();
  const byId = new Map(maps.map((map) => [map.id, map]));
  const ids = new Set();
  for (const connection of connections) {
    if (
      !identifier(connection?.id) ||
      ids.has(connection.id) ||
      typeof connection.name !== 'string' ||
      !connection.name.trim() ||
      connection.name.length > 100 ||
      !['door', 'stairs', 'window', 'opening'].includes(connection.kind) ||
      (connection.enabled !== undefined && typeof connection.enabled !== 'boolean') ||
      !Array.isArray(connection.ends) ||
      connection.ends.length !== 2 ||
      connection.ends[0]?.mapId === connection.ends[1]?.mapId ||
      !Array.isArray(connection.pathFeet) ||
      connection.pathFeet.length > 256 ||
      connection.pathFeet.some((value) => !point(value))
    )
      invalid();
    for (const end of connection.ends) {
      const map = byId.get(end?.mapId);
      if (
        !map ||
        !point(end.positionFeet) ||
        end.positionFeet.x < 0 ||
        end.positionFeet.z < 0 ||
        end.positionFeet.x >= map.grid.cols * 5 ||
        end.positionFeet.z >= map.grid.rows * 5
      )
        invalid();
    }
    if (
      (connection.kind === 'window' && connection.outsideMapId === undefined) ||
      (connection.outsideMapId !== undefined &&
        !connection.ends.some((end) => end.mapId === connection.outsideMapId))
    )
      invalid();
    const feature = connection.feature;
    const owner = byId.get(feature?.mapId);
    const volumes = new Set(owner?.terrain.geometry?.volumes.map((volume) => volume.id));
    if (
      !owner ||
      !Array.isArray(feature.volumeIds) ||
      !feature.volumeIds.length ||
      feature.volumeIds.length > 256 ||
      new Set(feature.volumeIds).size !== feature.volumeIds.length ||
      feature.volumeIds.some((id) => !volumes.has(id))
    )
      invalid();
    if (
      connection.kind === 'window' &&
      (feature.volumeIds.length !== 1 ||
        owner.terrain.geometry.volumes.find((volume) => volume.id === feature.volumeIds[0])
          .operation !== 'subtract')
    )
      invalid();
    ids.add(connection.id);
  }
}

export function connectionEntryDistance(world, connection, mapId, localWorld, options = {}) {
  if (!point(localWorld)) throw new Error('Connection proximity requires a valid position');
  const end = connection.ends.find((entry) => entry.mapId === mapId);
  if (!end) throw new Error('The connection is not attached to this map');
  const entry =
    options.travelMode === 'fly'
      ? world.toCampaignPosition(
          mapId,
          connectionFlightEntry(world, connection, mapId, localWorld, options)
        )
      : endpoint(world, end);
  return distance(world.toCampaignPosition(mapId, localWorld), entry);
}

export function connectionFlightEntry(world, connection, mapId, localWorld, options = {}) {
  const end = connection.ends.find((entry) => entry.mapId === mapId);
  if (!end) throw new Error('The connection is not attached to this map');
  const position = endpoint(world, end);
  const current = world.toCampaignPosition(mapId, localWorld);
  if (connection.kind === 'stairs')
    return world.toMapPosition(mapId, { ...position, y: current.y });
  let closest = null;
  for (const bounds of connectionFeatureBounds(world, connection, options)) {
    if (bounds.max.y - bounds.min.y < 5 - EPSILON) continue;
    const wide = bounds.max.x - bounds.min.x < bounds.max.z - bounds.min.z ? 'z' : 'x';
    const center = (bounds.min[wide] + bounds.max[wide]) / 2;
    const ceiling = bounds.max.y - 5;
    const floors = connection.ends.map((side) => {
      const point = endpoint(world, side);
      const support = world.findSupportBelow({ ...point, [wide]: center, y: ceiling }, options);
      return support ? support.positionFeet.y : -Infinity;
    });
    const floor = Math.max(...floors);
    if (ceiling <= floor + EPSILON) continue;
    let height = Math.max(bounds.min.y, Math.min(ceiling, current.y));
    if (height <= floor + EPSILON) height = ceiling;
    const delta = Math.abs(current.y - height);
    if (!closest || delta < closest.delta) closest = { height, delta, bounds };
  }
  if (!closest) unavailable('This opening has insufficient clearance for flight');
  const widthAxis =
    closest.bounds.max.x - closest.bounds.min.x < closest.bounds.max.z - closest.bounds.min.z
      ? 'z'
      : 'x';
  position[widthAxis] = (closest.bounds.min[widthAxis] + closest.bounds.max[widthAxis]) / 2;
  return world.toMapPosition(mapId, { ...position, y: closest.height });
}

function supported(world, position, options, minimumHeight = position.y) {
  return world.listMaps().some(({ id }) => {
    const map = world.getMap(id);
    const local = world.toMapPosition(id, position);
    const scale = 5 / map.grid.tileWorldSize;
    const x = local.x * scale;
    const z = local.z * scale;
    if (x < 0 || z < 0 || x >= map.grid.cols * 5 || z >= map.grid.rows * 5) return false;
    const geometry =
      id === options.mapId && options.geometry ? options.geometry : world.getMapGeometry(id);
    const support = geometry.findSupport(x, z, { belowFeet: local.y * scale + EPSILON });
    const height = support ? support.heightFeet + map.originFeet.y : -Infinity;
    return height >= minimumHeight - EPSILON && height <= position.y + EPSILON;
  });
}

export function planConnection(world, connection, mapId, localWorld, options = {}) {
  if (!point(localWorld)) throw new Error('Connection travel requires a valid creature position');
  if (options.travelMode !== undefined && !['ground', 'fly'].includes(options.travelMode))
    throw new Error('Connection travel requires a ground or flying movement mode');
  const flying = options.travelMode === 'fly';
  if (connection.enabled === false) unavailable('This connection is unavailable');
  const featureBounds = connectionFeatureBounds(world, connection, options);
  if (connection.kind === 'window' && !flying)
    return planWindowClimb(world, connection, mapId, localWorld, options);
  const index = connection.ends.findIndex((end) => end.mapId === mapId);
  if (index < 0) throw new Error('This connection is not on the creature grid');
  let entry = endpoint(world, connection.ends[index]);
  let exit = endpoint(world, connection.ends[1 - index]);
  const start = world.toCampaignPosition(mapId, localWorld);
  if (flying && connection.kind !== 'stairs') {
    entry = world.toCampaignPosition(
      mapId,
      connectionFlightEntry(world, connection, mapId, localWorld, options)
    );
    const destinationMapId = connection.ends[1 - index].mapId;
    exit = world.toCampaignPosition(
      destinationMapId,
      connectionFlightEntry(
        world,
        connection,
        destinationMapId,
        world.toMapPosition(destinationMapId, start),
        options
      )
    );
    if (Math.abs(entry.y - start.y) > EPSILON)
      unavailable('Fly into the clear opening elevation before crossing');
  }
  if (distance(start, entry) > 5 + EPSILON)
    unavailable('Move within 5 feet of this entrance first');
  if (
    flying &&
    connection.kind !== 'stairs' &&
    !featureBounds.some(
      (bounds) => start.y >= bounds.min.y - EPSILON && start.y + 5 <= bounds.max.y + EPSILON
    )
  )
    unavailable('Fly to an elevation where the creature fits through this opening');
  const middle = index === 0 ? connection.pathFeet : [...connection.pathFeet].reverse();
  const flightPoint = (position) => ({
    ...position,
    y: connection.kind === 'stairs' ? position.y + start.y - entry.y : start.y,
  });
  const routeFeet = [
    start,
    ...[entry, ...middle, exit].map((position) => (flying ? flightPoint(position) : position)),
  ].filter((value, i, all) => i === 0 || distance(value, all[i - 1]) > EPSILON);
  const obstacles = world.getObstacles(options);
  const occupants = (options.occupants || []).map((actor) => {
    const position = world.toCampaignPosition(actor.mapId, actor.world);
    return {
      min: { x: position.x - 2, y: position.y + EPSILON, z: position.z - 2 },
      max: { x: position.x + 2, y: position.y + 5 - EPSILON, z: position.z + 2 },
    };
  });
  let cost = 0;
  for (let i = 0; i < routeFeet.length; i++) {
    const current = routeFeet[i];
    if (!flying && !supported(world, current, options))
      unavailable('This connection has an unsupported step or landing');
    const previous = routeFeet[Math.max(0, i - 1)];
    if (!flying && Math.abs(current.y - previous.y) > MAX_STEP_HEIGHT_FEET + EPSILON)
      unavailable('This connection needs real stair steps rather than a free elevation jump');
    const samples = Math.max(1, Math.ceil(distance(previous, current) / 0.5));
    for (let sample = 0; !flying && sample <= samples; sample++) {
      const ratio = sample / samples;
      if (
        !supported(
          world,
          {
            x: previous.x + (current.x - previous.x) * ratio,
            y: Math.max(previous.y, current.y),
            z: previous.z + (current.z - previous.z) * ratio,
          },
          options,
          Math.min(previous.y, current.y)
        )
      )
        unavailable('This connection crosses unsupported space');
    }
    const bottom =
      (flying ? Math.min(previous.y, current.y) : Math.max(previous.y, current.y)) + EPSILON;
    const body = {
      min: {
        x: Math.min(previous.x, current.x) - 0.5,
        y: bottom,
        z: Math.min(previous.z, current.z) - 0.5,
      },
      max: {
        x: Math.max(previous.x, current.x) + 0.5,
        y: Math.max(previous.y, current.y) + 5 - EPSILON,
        z: Math.max(previous.z, current.z) + 0.5,
      },
    };
    const intersects = (bounds) =>
      ['x', 'y', 'z'].every(
        (axis) => body.min[axis] < bounds.max[axis] && body.max[axis] > bounds.min[axis]
      );
    if (obstacles.some(intersects))
      unavailable('A wall, closed opening or low ceiling blocks this connection');
    if (occupants.some(intersects)) unavailable('Another creature blocks this connection');
    cost += distance(previous, current);
  }
  const targetMapId = connection.ends[1 - index].mapId;
  const targetWorld = world.toMapPosition(targetMapId, flying ? flightPoint(exit) : exit);
  if (!flying) {
    const support = world.findLocalSupport(targetMapId, targetWorld, { clearanceFeet: 5 });
    if (!support || Math.abs(support.heightWorld - targetWorld.y) > EPSILON)
      unavailable('The destination grid has no safe landing');
  }
  return {
    connectionId: connection.id,
    kind: connection.kind,
    targetMapId,
    targetWorld,
    routeFeet,
    costFeet: Math.max(0, Math.ceil(cost / 5 - EPSILON) * 5),
    ...(flying ? { travelMode: 'fly', targetPose: { kind: 'flight', world: targetWorld } } : {}),
    facingDelta:
      ((world.getMap(targetMapId).quarterTurns - world.getMap(mapId).quarterTurns) * Math.PI) / 2,
  };
}
