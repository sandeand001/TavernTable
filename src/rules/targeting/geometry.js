import { FEET_PER_GRID_SQUARE } from '../../config/TokenMovementConfig.js';
import { TARGET_ALLEGIANCES } from '../../config/targeting/SpellProfiles.js';
import { TARGET_AREA_SHAPES } from '../../config/targeting/SpellProfiles.js';

const EPSILON = 1e-7;

export function finitePoint(point) {
  return (
    point !== null &&
    typeof point === 'object' &&
    !Array.isArray(point) &&
    ['x', 'y', 'z'].every((key) => Number.isFinite(point[key]))
  );
}

function creaturePoint(world, tileSize, height) {
  if (!finitePoint(world) || !Number.isFinite(tileSize) || tileSize <= 0)
    throw new Error('Creature sight requires a valid position and physical grid scale');
  return { ...world, y: world.y + tileSize * height };
}

export function creatureEye(world, tileSize) {
  return creaturePoint(world, tileSize, 0.8);
}

export function creatureCenter(world, tileSize) {
  return creaturePoint(world, tileSize, 0.5);
}

export function facingDirection(actor) {
  const angle = actor.facingAngle ?? 0;
  if (!Number.isFinite(angle)) throw new Error('Spell aiming requires a valid creature facing');
  return { x: Math.cos(angle), y: 0, z: -Math.sin(angle) };
}

export function validateAreaGeometry(area) {
  if (
    !area ||
    typeof area !== 'object' ||
    Array.isArray(area) ||
    !TARGET_AREA_SHAPES.includes(area.shape) ||
    !finitePoint(area.origin) ||
    !finitePoint(area.direction) ||
    Math.abs(Math.hypot(area.direction.x, area.direction.y, area.direction.z) - 1) > EPSILON ||
    (area.shape === 'cube' && Math.abs(area.direction.y) > EPSILON) ||
    ['size', 'width', 'height'].some(
      (key) => !Number.isFinite(area[key]) || area[key] <= 0 || area[key] > 100000
    ) ||
    Object.keys(area).some(
      (key) => !['shape', 'origin', 'direction', 'size', 'width', 'height'].includes(key)
    )
  )
    throw new Error('Spell area geometry or direction is invalid');
  return area;
}

export function boardDistance(from, to, tileSize) {
  if (!finitePoint(from) || !finitePoint(to) || !Number.isFinite(tileSize) || tileSize <= 0)
    throw new Error('Target distance requires valid world positions and grid scale');
  return (
    (FEET_PER_GRID_SQUARE *
      Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z))) /
    tileSize
  );
}

export function targetRelation(actor, target) {
  if (actor.id === target.id) return 'self';
  const a = actor.allegiance || 'neutral',
    b = target.allegiance || 'neutral';
  if (!TARGET_ALLEGIANCES.includes(a) || !TARGET_ALLEGIANCES.includes(b))
    throw new Error('Target allegiance is invalid');
  if (a === 'neutral' || b === 'neutral') return 'neutral';
  return a === b ? 'friendly' : 'hostile';
}

export function clearSegment(start, end, obstacles) {
  if (!finitePoint(start) || !finitePoint(end) || !Array.isArray(obstacles))
    throw new Error('Cover testing requires a valid segment and obstacles');
  for (const box of obstacles) {
    if (
      !finitePoint(box.min) ||
      !finitePoint(box.max) ||
      ['x', 'y', 'z'].some((axis) => box.min[axis] > box.max[axis])
    )
      throw new Error('Cover bounds are invalid');
    let low = 0,
      high = 1;
    for (const axis of ['x', 'y', 'z']) {
      const delta = end[axis] - start[axis];
      if (Math.abs(delta) < EPSILON) {
        if (start[axis] < box.min[axis] || start[axis] > box.max[axis]) {
          high = -1;
          break;
        }
      } else {
        const a = (box.min[axis] - start[axis]) / delta,
          b = (box.max[axis] - start[axis]) / delta;
        low = Math.max(low, Math.min(a, b));
        high = Math.min(high, Math.max(a, b));
      }
    }
    if (low <= high && high > EPSILON && low < 1 - EPSILON) return false;
  }
  return true;
}

export function areaPlacement(profile, actor, selection, tileSize) {
  const scale = tileSize / FEET_PER_GRID_SQUARE;
  const origin = profile.anchor === 'caster' ? actor.world : selection.origin;
  if (!finitePoint(origin)) throw new Error('Choose a valid point for the spell area');
  const facing = facingDirection(actor);
  const aim = selection.aim || { x: origin.x + facing.x, y: origin.y, z: origin.z + facing.z };
  if (!finitePoint(aim)) throw new Error('Spell direction is invalid');
  const vertical = profile.shape === 'cube' ? 0 : aim.y - origin.y;
  const length = Math.hypot(aim.x - origin.x, vertical, aim.z - origin.z);
  const direction =
    length > EPSILON
      ? { x: (aim.x - origin.x) / length, y: vertical / length, z: (aim.z - origin.z) / length }
      : facing;
  return validateAreaGeometry({
    shape: profile.shape,
    origin: { ...origin },
    direction,
    size: profile.sizeFeet * scale,
    width: profile.widthFeet * scale,
    height: profile.heightFeet * scale,
  });
}

export function inArea(point, area) {
  if (!finitePoint(point) || !finitePoint(area.origin) || !finitePoint(area.direction))
    throw new Error('Area testing requires finite geometry');
  const x = point.x - area.origin.x,
    y = point.y - area.origin.y,
    z = point.z - area.origin.z;
  const distance = Math.hypot(x, y, z),
    horizontal = Math.hypot(x, z);
  if (area.shape === 'sphere' || area.shape === 'emanation') return distance <= area.size + EPSILON;
  if (area.shape === 'cylinder')
    return horizontal <= area.size + EPSILON && y >= -EPSILON && y <= area.height + EPSILON;
  if (area.shape === 'square')
    return (
      Math.abs(x) <= area.size / 2 + EPSILON &&
      Math.abs(z) <= area.size / 2 + EPSILON &&
      Math.abs(y) <= area.height + EPSILON
    );
  const forward = x * area.direction.x + y * area.direction.y + z * area.direction.z;
  const sideways = Math.sqrt(Math.max(0, distance * distance - forward * forward));
  if (area.shape === 'cone')
    return (
      forward >= -EPSILON && forward <= area.size + EPSILON && sideways <= forward / 2 + EPSILON
    );
  if (area.shape === 'line') {
    const { x: dx, y: dy, z: dz } = area.direction;
    const divisor = 1 + dz;
    // Match the square cross-section of the preview box's Z-to-direction rotation.
    const right =
      divisor < EPSILON ? -x : x * (1 - (dx * dx) / divisor) - (y * dx * dy) / divisor - z * dx;
    const up =
      divisor < EPSILON ? y : (-x * dx * dy) / divisor + y * (1 - (dy * dy) / divisor) - z * dy;
    return (
      forward >= -EPSILON &&
      forward <= area.size + EPSILON &&
      Math.abs(right) <= area.width / 2 + EPSILON &&
      Math.abs(up) <= area.width / 2 + EPSILON
    );
  }
  if (area.shape === 'cube') {
    const flat = Math.hypot(area.direction.x, area.direction.z) || 1;
    const along = (x * area.direction.x + z * area.direction.z) / flat;
    const side = (x * -area.direction.z + z * area.direction.x) / flat;
    return (
      along >= -EPSILON &&
      along <= area.size + EPSILON &&
      Math.abs(side) <= area.size / 2 + EPSILON &&
      y >= -EPSILON &&
      y <= area.size + EPSILON
    );
  }
  throw new Error('Unknown spell area shape');
}
