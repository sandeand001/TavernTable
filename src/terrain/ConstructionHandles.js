import { createStructure } from './ConstructionBlueprints.js';
import {
  buildingForHeight,
  buildingDimensions,
  buildingFeatureLimits,
  buildingWallPoint,
  buildingLevelElevation,
  buildingLevels,
} from './BuildingModel.js';
import { wallStairFootprint } from './WallStairs.js';

const snap = (value, step) => Math.round(value / step) * step;

export function stretchStructure(original, handle, point, { fine = false } = {}) {
  const c = Math.cos(original.angleRadians),
    s = Math.sin(original.angleRadians);
  const dx = point.x - original.xFeet,
    dz = point.z - original.zFeet;
  const local = { x: dx * c + dz * s, z: -dx * s + dz * c };
  const round = ['dome', 'cave', 'turret'].includes(original.kind);
  const step = fine ? 0.5 : 5;
  const minRound =
    original.building && original.heightFeet > 10 && original.building.stairs ? 25 : 15;
  let length = round ? original.diameterFeet : original.lengthFeet;
  let width = round ? original.diameterFeet : original.widthFeet;
  let x0 = -length / 2,
    x1 = length / 2,
    z0 = -width / 2,
    z1 = width / 2;
  const minLength =
    original.building && original.heightFeet > 10 && original.building.stairs
      ? 20
      : original.kind === 'wall'
        ? original.wallStairs
          ? wallStairFootprint(original).lengthFeet + (original.wallStairOffsetFeet ?? 0)
          : 5
        : 10;
  const minWidth =
    original.building && original.heightFeet > 10 && original.building.stairs ? 15 : 10;
  if (handle.includes('west'))
    x0 = x1 - Math.max(round ? minRound : minLength, snap(x1 - local.x, step));
  if (handle.includes('east'))
    x1 = x0 + Math.max(round ? minRound : minLength, snap(local.x - x0, step));
  if (handle.includes('north'))
    z0 = z1 - Math.max(round ? minRound : minWidth, snap(z1 - local.z, step));
  if (handle.includes('south'))
    z1 = z0 + Math.max(round ? minRound : minWidth, snap(local.z - z0, step));
  let shiftX = (x0 + x1) / 2,
    shiftZ = (z0 + z1) / 2;
  if (round) {
    const diameter = handle.includes('west') || handle.includes('east') ? x1 - x0 : z1 - z0;
    if (handle.includes('west') || handle.includes('east')) shiftZ = 0;
    else shiftX = 0;
    length = diameter;
    width = diameter;
  } else {
    length = x1 - x0;
    width = z1 - z0;
  }
  return createStructure(
    {
      ...original,
      xFeet: original.xFeet + shiftX * c - shiftZ * s,
      zFeet: original.zFeet + shiftX * s + shiftZ * c,
      ...(round ? { diameterFeet: length } : { lengthFeet: length, widthFeet: width }),
    },
    { legacy: true }
  );
}

export function slideWallStairs(original, deltaFeet, { fine = false } = {}) {
  if (!original.wallStairs || !Number.isFinite(deltaFeet))
    throw new Error('Choose wall stairs and a finite along-wall drag');
  const maximum = original.lengthFeet - wallStairFootprint(original).lengthFeet;
  return createStructure(
    {
      ...original,
      wallStairOffsetFeet: Math.max(
        0,
        Math.min(maximum, (original.wallStairOffsetFeet ?? 0) + snap(deltaFeet, fine ? 0.5 : 5))
      ),
    },
    { legacy: true }
  );
}

export function stretchStructureHeight(original, deltaFeet) {
  const step = original.building && original.building.version < 3 ? 10 : 5;
  if (original.kind === 'cellar') deltaFeet = -deltaFeet;
  const heightFeet = Math.min(
    100,
    Math.max(
      original.building
        ? original.kind === 'cellar'
          ? Math.abs(buildingLevels(original)[1]?.elevationFeet ?? 0) + 10
          : Math.max(
              ...buildingLevels(original, { includeDeck: false }).map(
                (level) => level.elevationFeet
              )
            ) + 10
        : original.kind === 'wall'
          ? 5
          : 10,
      snap(original.heightFeet + deltaFeet, step)
    )
  );
  return createStructure(
    {
      ...original,
      heightFeet,
      ...(original.building ? { building: buildingForHeight(original.building, heightFeet) } : {}),
    },
    { legacy: true }
  );
}

export function changeBuildingFootprint(original, kind) {
  if (
    !original.building ||
    !['building', 'turret'].includes(original.kind) ||
    !['building', 'turret'].includes(kind)
  )
    throw new Error('Choose a rectangular or round building base');
  const dimensions = buildingDimensions(original);
  return createStructure({
    ...original,
    kind,
    ...(kind === original.kind
      ? {}
      : kind === 'turret'
        ? { diameterFeet: Math.max(dimensions.length, dimensions.width) }
        : { lengthFeet: original.diameterFeet, widthFeet: original.diameterFeet }),
    building: { ...original.building, version: Math.max(2, original.building.version) },
  });
}

export function buildingFeatureHandlePoints(spec, feature, kind) {
  if (!['window', 'balcony'].includes(kind)) throw new Error('Choose a window or balcony feature');
  const { span } = buildingFeatureLimits(spec, kind, feature),
    center = (feature.u - 0.5) * span;
  const low = center - feature.widthFeet / 2,
    high = center + feature.widthFeet / 2;
  const alongAxis = ['north', 'south'].includes(feature.side) ? 'x' : 'z',
    thin = alongAxis === 'x' ? 'z' : 'x';
  const sign = ['east', 'south'].includes(feature.side) ? 1 : -1;
  const point = (along, y, depth = 0) => {
    const p = buildingWallPoint(spec, feature.side, feature.u, depth, y);
    p[alongAxis] = along;
    if (kind === 'window' && spec.kind === 'turret') {
      const radius = spec.diameterFeet / 2,
        apothem = radius * Math.cos(Math.PI / 16);
      let face = radius;
      for (let i = 0; i < 16; i++) {
        const n = { x: Math.cos((i * Math.PI) / 8), z: Math.sin((i * Math.PI) / 8) },
          normal = n[thin] * sign;
        if (normal > 1e-7) face = Math.min(face, (apothem - n[alongAxis] * along) / normal);
      }
      p[thin] = sign * (face + depth);
    }
    return p;
  };
  const floor = buildingLevelElevation(spec, feature.floor);
  if (kind === 'balcony')
    return {
      'feature-west': point(low, floor, feature.depthFeet / 2),
      'feature-east': point(high, floor, feature.depthFeet / 2),
      'feature-depth': point(center, floor, feature.depthFeet),
      'feature-depth-west': point(low, floor, feature.depthFeet),
      'feature-depth-east': point(high, floor, feature.depthFeet),
      'feature-move': point(center, floor, feature.depthFeet / 2),
    };
  const bottom = floor + feature.sillFeet,
    top = bottom + feature.heightFeet,
    mid = (top + bottom) / 2;
  return {
    'feature-west': point(low, mid, 0.15),
    'feature-east': point(high, mid, 0.15),
    'feature-bottom': point(center, bottom, 0.15),
    'feature-top': point(center, top, 0.15),
    'feature-bottom-west': point(low, bottom, 0.15),
    'feature-bottom-east': point(high, bottom, 0.15),
    'feature-top-west': point(low, top, 0.15),
    'feature-top-east': point(high, top, 0.15),
    'feature-move': point(center, mid, 0.15),
  };
}

export function stretchBuildingFeature(spec, original, kind, handle, delta, { fine = false } = {}) {
  const key = handle.replace(/^feature-/, '');
  const allowed =
    kind === 'window'
      ? [
          'west',
          'east',
          'top',
          'bottom',
          'top-west',
          'top-east',
          'bottom-west',
          'bottom-east',
          'move',
        ]
      : kind === 'balcony'
        ? ['west', 'east', 'depth', 'depth-west', 'depth-east', 'move']
        : [];
  if (
    !allowed.includes(key) ||
    !['alongFeet', 'elevationFeet', 'depthFeet'].every((axis) => Number.isFinite(delta?.[axis]))
  )
    throw new Error('Feature resizing requires a valid handle and finite drag distances');
  const modern = {
    ...spec,
    building: { ...spec.building, version: Math.max(2, spec.building.version) },
  };
  const limits = buildingFeatureLimits(modern, kind, original);
  const step = kind === 'window' ? (fine ? 0.1 : 0.5) : fine ? 0.5 : 5;
  const along = snap(delta.alongFeet, step),
    vertical = snap(delta.elevationFeet, step),
    depth = snap(delta.depthFeet, step);
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const next = { ...original },
    center = (original.u - 0.5) * limits.span;
  let low = center - original.widthFeet / 2,
    high = center + original.widthFeet / 2;
  const min = -limits.span / 2 + limits.margin,
    max = limits.span / 2 - limits.margin;
  if (key === 'move') {
    const position =
      spec.kind === 'turret'
        ? 0
        : clamp(center + along, min + original.widthFeet / 2, max - original.widthFeet / 2);
    next.u = 0.5 + position / limits.span;
    if (kind === 'window')
      next.sillFeet = clamp(
        original.sillFeet + vertical,
        limits.minSillFeet,
        Math.min(
          limits.maxSillFeet,
          spec.heightFeet - buildingLevelElevation(spec, original.floor) - original.heightFeet - 1
        )
      );
    return next;
  }
  if (key.includes('west') || key.includes('east')) {
    if (spec.kind === 'turret') {
      const width = clamp(
        original.widthFeet + 2 * along * (key.includes('west') ? -1 : 1),
        limits.minWidthFeet,
        limits.maxWidthFeet
      );
      low = -width / 2;
      high = width / 2;
    } else {
      if (key.includes('west')) low = clamp(low + along, min, high - limits.minWidthFeet);
      if (key.includes('east')) high = clamp(high + along, low + limits.minWidthFeet, max);
    }
    next.widthFeet = high - low;
    next.u = 0.5 + (high + low) / (2 * limits.span);
  }
  if (kind === 'balcony' && key.includes('depth'))
    next.depthFeet = clamp(original.depthFeet + depth, limits.minDepthFeet, limits.maxDepthFeet);
  if (kind === 'window') {
    const floor = buildingLevelElevation(spec, original.floor);
    let bottom = floor + original.sillFeet,
      top = bottom + original.heightFeet;
    if (key.includes('bottom'))
      bottom = clamp(
        bottom + vertical,
        floor + limits.minSillFeet,
        Math.min(top - limits.minHeightFeet, floor + limits.maxSillFeet)
      );
    if (key.includes('top'))
      top = clamp(top + vertical, bottom + limits.minHeightFeet, spec.heightFeet - 1);
    next.sillFeet = bottom - floor;
    next.heightFeet = top - bottom;
  }
  return next;
}
