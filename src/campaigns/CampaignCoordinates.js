function rotate(point, turns) {
  if (turns === 0) return { ...point };
  if (turns === 1) return { x: -point.z, y: point.y, z: point.x };
  if (turns === 2) return { x: -point.x, y: point.y, z: -point.z };
  return { x: point.z, y: point.y, z: -point.x };
}

export function mapFeetToCampaign(map, point) {
  const offset = rotate(point, map.quarterTurns);
  return {
    x: map.originFeet.x + offset.x,
    y: map.originFeet.y + offset.y,
    z: map.originFeet.z + offset.z,
  };
}

export function campaignToMapFeet(map, point) {
  return rotate(
    {
      x: point.x - map.originFeet.x,
      y: point.y - map.originFeet.y,
      z: point.z - map.originFeet.z,
    },
    (4 - map.quarterTurns) % 4
  );
}

export function localWorldToCampaign(map, point) {
  const scale = 5 / map.grid.tileWorldSize;
  return mapFeetToCampaign(map, { x: point.x * scale, y: point.y * scale, z: point.z * scale });
}

export function campaignToLocalWorld(map, point) {
  const offset = campaignToMapFeet(map, point);
  const scale = map.grid.tileWorldSize / 5;
  return { x: offset.x * scale, y: offset.y * scale, z: offset.z * scale };
}

export function campaignFeetBounds(map, bounds) {
  const a = mapFeetToCampaign(map, bounds.min);
  const b = mapFeetToCampaign(map, bounds.max);
  const min = {},
    max = {};
  for (const axis of ['x', 'y', 'z']) {
    min[axis] = Math.min(a[axis], b[axis]);
    max[axis] = Math.max(a[axis], b[axis]);
  }
  return { min, max };
}
