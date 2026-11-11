import { clipCell, createConvexCell } from '../terrain/ConvexGeometry.js';
import { volumeCell } from '../terrain/TerrainVolumeShape.js';
import { connectionEndpointFeet } from './CampaignConnectionGeometry.js';

const EPSILON = 1e-6;
const AXES = ['x', 'y', 'z'];
const dot = (a, b) => AXES.reduce((total, axis) => total + a[axis] * b[axis], 0);

export function doorLeafCells(world, connection, options = {}) {
  if (connection.kind !== 'door') throw new Error('Choose a door to change its state');
  const map = world.getMap(connection.feature.mapId);
  const unit = map.grid.tileWorldSize / 5;
  const ends = connection.ends.map((end) =>
    world.toMapPosition(map.id, connectionEndpointFeet(world, end))
  );
  const direction = Object.fromEntries(AXES.map((axis) => [axis, ends[1][axis] - ends[0][axis]]));
  const length = Math.hypot(direction.x, direction.y, direction.z);
  if (length <= EPSILON) throw new Error('The door needs distinct physical entrance positions');
  const normal = Object.fromEntries(AXES.map((axis) => [axis, direction[axis] / length]));
  const geometry =
    options.mapId === map.id && options.geometry ? options.geometry : world.getMapGeometry(map.id);
  const volumes = new Map(geometry.save().volumes.map((volume) => [volume.id, volume]));
  return connection.feature.volumeIds.map((id) => {
    const volume = volumes.get(id);
    if (!volume || volume.operation !== 'subtract')
      throw new Error('The door no longer has its physical opening');
    const center = Object.fromEntries(
      AXES.map((axis) => [axis, (volume.bounds.min[axis] + volume.bounds.max[axis]) / 2])
    );
    const distance = dot(normal, center);
    let cell = volumeCell({
      ...volume,
      id: `door:${connection.id}:${id}`,
      materialColor: 0x795438,
      materialStyle: 'timber',
    });
    cell = clipCell(cell, { normal, distance: distance + 0.125 });
    if (cell)
      cell = clipCell(cell, {
        normal: Object.fromEntries(AXES.map((axis) => [axis, -normal[axis]])),
        distance: -distance + 0.125,
      });
    if (!cell) throw new Error('The door panel does not fit its physical opening');
    if (options.open ?? connection.open === true) {
      const tangent = { x: -normal.z, y: 0, z: normal.x };
      const horizontal = Math.hypot(tangent.x, tangent.z);
      if (horizontal > EPSILON) {
        tangent.x /= horizontal;
        tangent.z /= horizontal;
      } else tangent.z = 1;
      const edge = Math.min(
        ...cell.faces.flatMap((face) => face.vertices.map((point) => dot(tangent, point)))
      );
      const hinge = Object.fromEntries(
        AXES.map((axis) => [axis, center[axis] + tangent[axis] * (edge - dot(tangent, center))])
      );
      const rotate = (point) => {
        const x = point.x - hinge.x,
          y = point.y - hinge.y,
          z = point.z - hinge.z;
        return horizontal > EPSILON
          ? { x: hinge.x + z, y: point.y, z: hinge.z - x }
          : { x: point.x, y: hinge.y - z, z: hinge.z + y };
      };
      cell = createConvexCell(
        cell.faces.map((face) => face.vertices.map(rotate)),
        cell
      );
      if (!cell) throw new Error('The open door panel has invalid geometry');
    }
    return { ...cell, doorNormal: normal, worldUnitsPerFoot: unit };
  });
}

export function nearbyDoors(world, observer, options = {}) {
  const position = world.toCampaignPosition(observer.mapId, observer.world);
  const eye = { ...position, y: position.y + 4 };
  return world.getConnections().filter((connection) => {
    if (
      connection.kind !== 'door' ||
      connection.enabled === false ||
      !world.sharesLocation(observer.mapId, connection.feature.mapId)
    )
      return false;
    const map = world.getMap(connection.feature.mapId);
    const unit = map.grid.tileWorldSize / 5;
    return doorLeafCells(world, connection, { ...options, open: false }).some((cell) => {
      const local = (point) => Object.fromEntries(AXES.map((axis) => [axis, point[axis] * unit]));
      const bounds = world.toCampaignBounds(map.id, {
        min: local(cell.bounds.min),
        max: local(cell.bounds.max),
      });
      const nearest = Object.fromEntries(
        AXES.map((axis) => [
          axis,
          Math.max(bounds.min[axis], Math.min(bounds.max[axis], eye[axis])),
        ])
      );
      if (Math.max(...AXES.map((axis) => Math.abs(nearest[axis] - eye[axis]))) > 5 + EPSILON)
        return false;
      return world.hasSurfaceLineOfSight(position, nearest, options);
    });
  });
}
