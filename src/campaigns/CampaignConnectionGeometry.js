import {
  buildingWindows,
  buildingWindowSections,
  buildingWallPoint,
  buildingLocalToFeet,
} from '../terrain/BuildingModel.js';
import { mapFeetToCampaign } from './CampaignCoordinates.js';
import { MAX_STEP_HEIGHT_FEET } from '../config/TokenMovementConfig.js';

export class ConnectionUnavailableError extends Error {}

function managedWindow(owner, connection) {
  if (connection.building?.kind !== 'window') return null;
  const spec = owner.terrain.geometry?.structures?.find(
    (entry) => entry.id === connection.building.structureId
  );
  const window =
    spec &&
    buildingWindows(spec).find((entry) => `window-${entry.id}` === connection.building.featureId);
  if (!window)
    throw new ConnectionUnavailableError('This window no longer has its building definition');
  return { spec, window };
}

function wideRectangularWindow(owner, connection) {
  const managed = managedWindow(owner, connection);
  return (
    managed?.spec.kind === 'building' &&
    managed.spec.building.version >= 2 &&
    managed.window.widthFeet > 5
  );
}

export function connectionWideCoordinate(owner, connection, bounds, point) {
  const wide = connectionOpeningAxis(owner, connection, bounds) === 'x' ? 'z' : 'x';
  return wideRectangularWindow(owner, connection)
    ? Math.max(bounds.min[wide] + 0.5, Math.min(bounds.max[wide] - 0.5, point[wide]))
    : (bounds.min[wide] + bounds.max[wide]) / 2;
}

export function connectionGroundEntry(world, connection, mapId, localWorld, options = {}) {
  options = { mapId, ...options };
  const end = connection.ends.find((entry) => entry.mapId === mapId);
  if (!end) throw new Error('The connection is not attached to this map');
  const position = connectionEndpointFeet(world, end);
  if (connection.kind === 'window') {
    const owner = world.getMap(connection.feature.mapId);
    if (wideRectangularWindow(owner, connection)) {
      const bounds = connectionFeatureBounds(world, connection, options)[0],
        current = world.toCampaignPosition(mapId, localWorld);
      const wide = connectionOpeningAxis(owner, connection, bounds) === 'x' ? 'z' : 'x';
      position[wide] = connectionWideCoordinate(owner, connection, bounds, current);
      if (mapId === connection.outsideMapId) {
        const support = world.findSupportBelow(
          { ...position, y: current.y + MAX_STEP_HEIGHT_FEET },
          options
        );
        if (!support)
          throw new ConnectionUnavailableError(
            'There is no supported approach to this part of the window'
          );
        position.y = support.positionFeet.y;
      }
    }
  }
  return world.toMapPosition(mapId, position);
}

export function connectionOpeningAxis(owner, connection, bounds) {
  const managed = managedWindow(owner, connection);
  if (!managed) return bounds.max.x - bounds.min.x < bounds.max.z - bounds.min.z ? 'x' : 'z';
  const physical = (offset) =>
    mapFeetToCampaign(
      owner,
      buildingLocalToFeet(
        managed.spec,
        buildingWallPoint(managed.spec, managed.window.side, managed.window.u, offset)
      )
    );
  const a = physical(0),
    b = physical(1);
  return Math.abs(b.x - a.x) > Math.abs(b.z - a.z) ? 'x' : 'z';
}

export function connectionApertureBounds(owner, connection, bounds) {
  const managed = managedWindow(owner, connection);
  if (!managed) return bounds;
  const { spec, window } = managed;
  const section = buildingWindowSections(spec, window).find(
    (entry) => entry.floor === connection.building.floor
  );
  if (!section) throw new ConnectionUnavailableError('This window does not reach that storey');
  const result = { min: { ...bounds.min }, max: { ...bounds.max } };
  result.min.y = Math.max(result.min.y, owner.originFeet.y + spec.baseFeet + section.bottomFeet);
  result.max.y = Math.min(result.max.y, owner.originFeet.y + spec.baseFeet + section.topFeet);
  if (spec.kind === 'turret' && spec.building.version >= 2) {
    const axis = connectionOpeningAxis(owner, connection, bounds);
    const physical = (offset) =>
      mapFeetToCampaign(
        owner,
        buildingLocalToFeet(spec, buildingWallPoint(spec, window.side, window.u, offset))
      );
    const a = physical(-3),
      b = physical(0.1);
    result.min[axis] = Math.min(a[axis], b[axis]);
    result.max[axis] = Math.max(a[axis], b[axis]);
  }
  return result;
}

export function connectionEndpointFeet(world, end) {
  const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
  return world.toCampaignPosition(end.mapId, {
    x: end.positionFeet.x * unit,
    y: end.positionFeet.y * unit,
    z: end.positionFeet.z * unit,
  });
}

export function connectionFeatureBounds(world, connection, options = {}) {
  const { mapId, volumeIds } = connection.feature;
  const map = world.getMap(mapId);
  const geometry =
    mapId === options.mapId && options.geometry ? options.geometry : world.getMapGeometry(mapId);
  const volumes = new Map(geometry.save().volumes.map((volume) => [volume.id, volume]));
  const unit = map.grid.tileWorldSize / 5;
  const local = (point) => ({ x: point.x * unit, y: point.y * unit, z: point.z * unit });
  return volumeIds.map((id) => {
    const volume = volumes.get(id);
    if (!volume)
      throw new ConnectionUnavailableError(
        'This entrance no longer has its physical opening or staircase'
      );
    return connectionApertureBounds(
      map,
      connection,
      world.toCampaignBounds(mapId, {
        min: local(volume.bounds.min),
        max: local(volume.bounds.max),
      })
    );
  });
}
