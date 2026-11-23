import { DEFAULT_LOCATION_ID, mapLocationId } from './CampaignLocations.js';

const PIXELS_PER_FOOT = 2;
const GAP = 40;
const LEVEL_HEADING = 36;
const OUTER_MARGIN = 24;
const SIDES = ['north', 'east', 'south', 'west'];

function localPoint(map, end) {
  if (end.positionFeet) return { x: end.positionFeet.x, z: end.positionFeet.z };
  const width = map.grid.cols * 5;
  const depth = map.grid.rows * 5;
  return {
    north: { x: width / 2, z: 0 },
    east: { x: width, z: depth / 2 },
    south: { x: width / 2, z: depth },
    west: { x: 0, z: depth / 2 },
  }[end.side];
}

export function overviewPoint(node, point) {
  const x = point.x * PIXELS_PER_FOOT;
  const z = point.z * PIXELS_PER_FOOT;
  const width = node.map.grid.cols * 5 * PIXELS_PER_FOOT;
  const depth = node.map.grid.rows * 5 * PIXELS_PER_FOOT;
  const rotated = [
    { x, y: z },
    { x: depth - z, y: x },
    { x: width - x, y: depth - z },
    { x: z, y: width - x },
  ][node.map.quarterTurns];
  if (!rotated) throw new Error('The overview map has an invalid rotation');
  return { x: node.x + rotated.x, y: node.y + rotated.y };
}

function sideOf(node, end) {
  if (end.side) return SIDES[(SIDES.indexOf(end.side) + node.map.quarterTurns) % 4];
  const point = overviewPoint({ ...node, x: 0, y: 0 }, localPoint(node.map, end));
  return [
    ['west', point.x],
    ['east', node.width - point.x],
    ['north', point.y],
    ['south', node.height - point.y],
  ].sort((a, b) => a[1] - b[1])[0][0];
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width + GAP / 2 &&
    a.x + a.width + GAP / 2 > b.x &&
    a.y < b.y + b.height + GAP / 2 &&
    a.y + a.height + GAP / 2 > b.y
  );
}

function placeBeside(source, target, sourceEnd, targetEnd, placed) {
  const sourcePoint = overviewPoint(source, localPoint(source.map, sourceEnd));
  const targetPoint = overviewPoint({ ...target, x: 0, y: 0 }, localPoint(target.map, targetEnd));
  const side = sideOf(source, sourceEnd);
  const horizontal = side === 'west' || side === 'east';
  const initial =
    side === 'east'
      ? { x: source.x + source.width + GAP, y: sourcePoint.y - targetPoint.y }
      : side === 'west'
        ? { x: source.x - target.width - GAP, y: sourcePoint.y - targetPoint.y }
        : side === 'south'
          ? { x: sourcePoint.x - targetPoint.x, y: source.y + source.height + GAP }
          : { x: sourcePoint.x - targetPoint.x, y: source.y - target.height - GAP };
  const axis = horizontal ? 'y' : 'x';
  const size = horizontal ? 'height' : 'width';
  const choices = [
    initial[axis],
    ...placed.flatMap((other) => [
      other[axis] - target[size] - GAP / 2,
      other[axis] + other[size] + GAP / 2,
    ]),
  ].sort((a, b) => Math.abs(a - initial[axis]) - Math.abs(b - initial[axis]) || a - b);
  for (const coordinate of choices) {
    const candidate = {
      ...target,
      ...initial,
      [axis]: coordinate,
    };
    if (placed.every((other) => !overlaps(candidate, other))) return candidate;
  }
  throw new Error('The location overview could not arrange its connected areas');
}

export function buildLocationOverview(scene, locationId = DEFAULT_LOCATION_ID) {
  if (!scene || !Array.isArray(scene.maps) || !scene.maps.length)
    throw new Error('A location overview requires campaign maps');
  const byId = new Map(scene.maps.map((map) => [map.id, map]));
  const includedLocations = new Set([locationId]);
  if (![...byId.values()].some((map) => mapLocationId(map) === locationId))
    throw new Error('The selected location has no maps');
  const passages = (scene.logicalPassages || []).filter((passage) => passage.kind === 'chamber');
  let changed = true;
  while (changed) {
    changed = false;
    for (const passage of passages) {
      const maps = passage.ends.map((end) => byId.get(end.mapId));
      if (maps.some((map) => !map)) throw new Error('A cavern overview passage has a missing area');
      if (!maps.some((map) => includedLocations.has(mapLocationId(map)))) continue;
      for (const map of maps) {
        const id = mapLocationId(map);
        if (!includedLocations.has(id)) {
          includedLocations.add(id);
          changed = true;
        }
      }
    }
  }
  const maps = scene.maps.filter((map) => includedLocations.has(mapLocationId(map)));
  const included = new Set(maps.map((map) => map.id));
  const rawConnections = [...(scene.connections || []), ...passages]
    .filter((connection) => connection.ends.every((end) => included.has(end.mapId)))
    .map((connection) => ({
      id: connection.id,
      name: connection.name || 'Cavern passage',
      kind: connection.kind === 'chamber' ? 'passage' : connection.kind,
      ends: connection.ends,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const pairKey = (connection) =>
    connection.ends
      .map((end) => end.mapId)
      .sort()
      .join('\u0000');
  const connections = rawConnections.filter((connection) => connection.kind !== 'window');
  const connectedPairs = new Set(connections.map(pairKey));
  const windows = new Map();
  for (const connection of rawConnections) {
    if (connection.kind !== 'window') continue;
    const key = pairKey(connection);
    if (connectedPairs.has(key)) continue;
    if (!windows.has(key)) windows.set(key, []);
    windows.get(key).push(connection);
  }
  for (const group of windows.values()) {
    const [first] = group;
    connections.push({
      ...first,
      name: group.length === 1 ? first.name : `Window access (${group.length} openings)`,
    });
  }
  connections.sort((a, b) => a.id.localeCompare(b.id));
  const nodes = maps
    .map((map) => {
      const rotated = map.quarterTurns % 2 === 1;
      return {
        id: map.id,
        name: map.name,
        map,
        level: Math.round(map.originFeet.y * 10000) / 10000,
        width: (rotated ? map.grid.rows : map.grid.cols) * 5 * PIXELS_PER_FOOT,
        height: (rotated ? map.grid.cols : map.grid.rows) * 5 * PIXELS_PER_FOOT,
        x: 0,
        y: 0,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const levels = [...new Set(nodes.map((node) => node.level))].sort((a, b) => b - a);
  const levelLayouts = [];
  let yOffset = OUTER_MARGIN;
  let totalWidth = 0;
  for (const level of levels) {
    const members = nodes.filter((node) => node.level === level);
    const unplaced = new Set(members.map((node) => node.id));
    const placed = [];
    while (unplaced.size) {
      const first = members.find((node) => unplaced.has(node.id));
      first.x = placed.length ? Math.max(...placed.map((node) => node.x + node.width)) + GAP : 0;
      first.y = 0;
      placed.push(first);
      unplaced.delete(first.id);
      const queue = [first];
      for (let cursor = 0; cursor < queue.length; cursor++) {
        const source = queue[cursor];
        for (const connection of connections) {
          const sourceEnd = connection.ends.find((end) => end.mapId === source.id);
          const targetEnd = connection.ends.find((end) => end.mapId !== source.id);
          if (!sourceEnd || !targetEnd || !unplaced.has(targetEnd.mapId)) continue;
          const target = nodesById.get(targetEnd.mapId);
          if (target.level !== level) continue;
          Object.assign(target, placeBeside(source, target, sourceEnd, targetEnd, placed));
          placed.push(target);
          unplaced.delete(target.id);
          queue.push(target);
        }
      }
    }
    const minX = Math.min(...members.map((node) => node.x));
    const minY = Math.min(...members.map((node) => node.y));
    const maxX = Math.max(...members.map((node) => node.x + node.width));
    const maxY = Math.max(...members.map((node) => node.y + node.height));
    for (const node of members) {
      node.x += OUTER_MARGIN - minX;
      node.y += yOffset + LEVEL_HEADING - minY;
    }
    levelLayouts.push({ level, y: yOffset });
    yOffset += LEVEL_HEADING + maxY - minY + GAP;
    totalWidth = Math.max(totalWidth, maxX - minX);
  }
  const edges = connections.map((connection) => ({
    ...connection,
    points: connection.ends.map((end) =>
      overviewPoint(nodesById.get(end.mapId), localPoint(byId.get(end.mapId), end))
    ),
  }));
  return {
    nodes,
    edges,
    levels: levelLayouts,
    width: totalWidth + OUTER_MARGIN * 2,
    height: yOffset + OUTER_MARGIN,
  };
}
