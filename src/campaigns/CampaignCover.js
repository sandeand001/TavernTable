import { facingAngleFromDirection } from '../entities/creatures/TokenMovement.js';

export function findCoverWall({
  position,
  gridX,
  gridY,
  cols,
  rows,
  tileWorldSize,
  getHeight,
  minimumHeight = 0,
}) {
  let nearest = null;
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const x = gridX + dx,
      z = gridY + dz;
    if (x < 0 || z < 0 || x >= cols || z >= rows) continue;
    const top = getHeight(x, z);
    if (!Number.isFinite(top)) throw new Error('Cover requires valid adjacent terrain heights');
    if (top - position.y < Math.max(minimumHeight, 1e-6)) continue;
    const plane = dx
      ? (gridX + (dx > 0 ? 1 : 0)) * tileWorldSize
      : (gridY + (dz > 0 ? 1 : 0)) * tileWorldSize;
    const distance = dx ? Math.abs(plane - position.x) : Math.abs(plane - position.z);
    if (!nearest || distance < nearest.distance) nearest = { dx, dz, plane, distance, top };
  }
  return nearest;
}

export function coverDestination(position, wall, back, tileWorldSize) {
  if (
    !wall ||
    !Number.isFinite(back) ||
    back <= 0 ||
    !Number.isFinite(tileWorldSize) ||
    tileWorldSize <= 0
  )
    throw new Error('Cover requires a native pose measurement and supported wall');
  const goal = { ...position };
  const inset = back + tileWorldSize * 0.02;
  if (wall.dx) goal.x = wall.plane - wall.dx * inset;
  else goal.z = wall.plane - wall.dz * inset;
  return { goal, facingAngle: facingAngleFromDirection(-wall.dx, -wall.dz) };
}
