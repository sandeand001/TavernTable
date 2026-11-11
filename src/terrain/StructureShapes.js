import { createSeededRNG, hash32 } from '../utils/SeededRNG.js';

const AXES = ['x', 'y', 'z'];

function dimensions(id, bounds, wallFeet = 0) {
  if (
    typeof id !== 'string' ||
    !id.trim() ||
    id === 'terrain' ||
    !bounds ||
    !Number.isFinite(wallFeet) ||
    wallFeet < 0 ||
    AXES.some(
      (axis) =>
        !Number.isFinite(bounds.min?.[axis]) ||
        !Number.isFinite(bounds.max?.[axis]) ||
        bounds.max[axis] <= bounds.min[axis]
    )
  )
    throw new RangeError('A structure requires an ID, finite bounds and valid wall thickness');
  const size = Object.fromEntries(AXES.map((axis) => [axis, bounds.max[axis] - bounds.min[axis]]));
  if (size.x <= wallFeet * 2 || size.z <= wallFeet * 2 || size.y <= wallFeet)
    throw new RangeError('The structure is too small for its walls and interior');
  return size;
}

function volume(id, layerId, bounds, shape = null, operation = 'add') {
  if (typeof layerId !== 'string' || !layerId.trim())
    throw new TypeError('Structure layers require a non-empty name');
  return {
    id,
    layerId,
    operation,
    bounds: { min: { ...bounds.min }, max: { ...bounds.max } },
    ...(shape
      ? { shape: { ...shape, center: { ...shape.center }, radii: { ...shape.radii } } }
      : {}),
  };
}

function roundedShape(bounds, kind, axis = 'y') {
  const center = Object.fromEntries(
    AXES.map((key) => [key, (bounds.min[key] + bounds.max[key]) / 2])
  );
  const radii = Object.fromEntries(
    AXES.map((key) => [key, (bounds.max[key] - bounds.min[key]) / 2])
  );
  if (kind === 'ellipsoid' || axis !== 'y') {
    center.y = bounds.min.y;
    radii.y = bounds.max.y - bounds.min.y;
  }
  return { kind, center, radii, ...(kind === 'cylinder' ? { axis } : {}) };
}

function splitShell(id, layerId, bounds, shape) {
  const split = bounds.min.y + Math.min(7.5, (bounds.max.y - bounds.min.y) / 2);
  return [
    volume(`${id}-wall`, layerId, { min: bounds.min, max: { ...bounds.max, y: split } }, shape),
    volume(`${id}-roof`, 'roof', { min: { ...bounds.min, y: split }, max: bounds.max }, shape),
  ];
}

export function createDomeVolumes({ id, bounds, wallFeet = 2, layerId = 'dome' }) {
  dimensions(id, bounds, wallFeet);
  if (wallFeet <= 0) throw new RangeError('A hollow dome requires positive wall thickness');
  const inside = {
    min: { x: bounds.min.x + wallFeet, y: bounds.min.y, z: bounds.min.z + wallFeet },
    max: { x: bounds.max.x - wallFeet, y: bounds.max.y - wallFeet, z: bounds.max.z - wallFeet },
  };
  return [
    ...splitShell(id, layerId, bounds, roundedShape(bounds, 'ellipsoid')),
    volume(`${id}-room`, layerId, inside, roundedShape(inside, 'ellipsoid'), 'subtract'),
  ];
}

export function createTubeVolumes({ id, bounds, axis = 'z', wallFeet = 2, layerId = 'cave' }) {
  dimensions(id, bounds, wallFeet);
  if (!['x', 'z'].includes(axis) || wallFeet <= 0)
    throw new RangeError('A vaulted tube requires a horizontal axis and positive wall thickness');
  const radial = axis === 'x' ? 'z' : 'x';
  const inside = {
    min: { ...bounds.min, [radial]: bounds.min[radial] + wallFeet },
    max: { ...bounds.max, y: bounds.max.y - wallFeet, [radial]: bounds.max[radial] - wallFeet },
  };
  return [
    ...splitShell(id, layerId, bounds, roundedShape(bounds, 'cylinder', axis)),
    volume(`${id}-bore`, layerId, inside, roundedShape(inside, 'cylinder', axis), 'subtract'),
  ];
}

export function createRockFormationVolumes({ id, bounds, inverted = false, profileVersion = 2 }) {
  const size = dimensions(id, bounds);
  if (![1, 2].includes(profileVersion)) throw new Error('Choose a valid rock formation profile');
  const random = createSeededRNG(hash32(id), 731);
  const segments = profileVersion === 1 ? 16 : 24;
  const phase = random() * Math.PI * 2,
    secondPhase = random() * Math.PI * 2;
  let outline = Array.from({ length: segments }, (_, index) => {
    const angle = (index * Math.PI * 2) / segments;
    const radius =
      profileVersion === 1
        ? 1
        : 1 + Math.sin(angle * 3 + phase) * 0.045 + Math.cos(angle * 2 + secondPhase) * 0.075;
    return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
  });
  if (profileVersion === 2) {
    const ranges = Object.fromEntries(
      ['x', 'z'].map((axis) => [
        axis,
        [Math.min(...outline.map((p) => p[axis])), Math.max(...outline.map((p) => p[axis]))],
      ])
    );
    outline = outline.map((point) =>
      Object.fromEntries(
        ['x', 'z'].map((axis) => [
          axis,
          ((point[axis] - ranges[axis][0]) * 2) / (ranges[axis][1] - ranges[axis][0]) - 1,
        ])
      )
    );
  }
  const tipRadius = 0.018 + random() * 0.01;
  const profile =
    profileVersion === 1
      ? [
          [0, 1],
          [0.65, 0.82],
          [0.92, 0.3],
          [1, 0.06],
        ]
      : [0, 0.08, 0.2, 0.34, 0.49, 0.64, 0.78, 0.9, 0.97, 1].map((along) => [
          along,
          1 - along * (1 - tipRadius),
        ]);
  const stem = (stemId, levels, { radius = 1, height = 1, x = 0, z = 0 } = {}) => {
    const rings = levels.map(([along, width]) =>
      outline.map((point) => ({
        x:
          (bounds.min.x + bounds.max.x) / 2 +
          (x * size.x) / 2 +
          (point.x * size.x * width * radius) / 2,
        y: inverted
          ? bounds.max.y - size.y * height * along
          : bounds.min.y + size.y * height * along,
        z:
          (bounds.min.z + bounds.max.z) / 2 +
          (z * size.z) / 2 +
          (point.z * size.z * width * radius) / 2,
      }))
    );
    if (inverted) rings.reverse();
    // Homothetic outlines keep each joining section convex, closed and planar.
    return rings.slice(1).map((top, index) => {
      const vertices = [...rings[index], ...top];
      return {
        id: `${stemId}-rock-${index + 1}`,
        layerId: 'cave',
        operation: 'add',
        bounds: {
          min: Object.fromEntries(
            AXES.map((axis) => [axis, Math.min(...vertices.map((p) => p[axis]))])
          ),
          max: Object.fromEntries(
            AXES.map((axis) => [axis, Math.max(...vertices.map((p) => p[axis]))])
          ),
        },
        shape: {
          kind: 'polyhedron',
          vertices,
          faces: [
            Array.from({ length: segments }, (_, i) => segments - 1 - i),
            Array.from({ length: segments }, (_, i) => segments + i),
            ...Array.from({ length: segments }, (_, i) => [
              i,
              (i + 1) % segments,
              ((i + 1) % segments) + segments,
              i + segments,
            ]),
          ],
        },
      };
    });
  };
  const volumes = stem(id, profile);
  if (profileVersion === 2) {
    const growths = 1 + Math.floor(random() * 2),
      angle = random() * Math.PI * 2;
    for (let index = 0; index < growths; index++) {
      const direction = angle + index * (1.8 + random() * 0.6),
        distance = 0.72 + random() * 0.06;
      volumes.push(
        ...stem(
          `${id}-growth-${index + 1}`,
          profile.filter((_level, i) => i % 2 === 0 || i === profile.length - 1),
          {
            radius: 0.16 + random() * 0.04,
            height: 0.3 + random() * 0.3,
            x: Math.cos(direction) * distance,
            z: Math.sin(direction) * distance,
          }
        )
      );
    }
  }
  return volumes;
}

export function createCastleWallVolumes({ id, bounds, axis = 'x' }) {
  const size = dimensions(id, bounds);
  if (!['x', 'z'].includes(axis)) throw new RangeError('A castle wall requires a horizontal axis');
  const side = axis === 'x' ? 'z' : 'x';
  if (size[side] < 7) throw new RangeError('Battlements require a five-foot path between parapets');
  const result = [volume(`${id}-wall`, 'castle', bounds)];
  for (const [edge, start] of [
    ['near', bounds.min[side]],
    ['far', bounds.max[side] - 1],
  ]) {
    result.push(
      volume(`${id}-${edge}-parapet`, 'castle', {
        min: { ...bounds.min, y: bounds.max.y, [side]: start },
        max: { ...bounds.max, y: bounds.max.y + 1.5, [side]: start + 1 },
      })
    );
    let index = 0;
    for (let along = bounds.min[axis]; along < bounds.max[axis]; along += 5) {
      result.push(
        volume(`${id}-${edge}-merlon-${index++}`, 'castle', {
          min: { ...bounds.min, y: bounds.max.y + 1.5, [side]: start, [axis]: along },
          max: {
            ...bounds.max,
            y: bounds.max.y + 3,
            [side]: start + 1,
            [axis]: Math.min(along + 2.5, bounds.max[axis]),
          },
        })
      );
    }
  }
  return result;
}

export function createRoundTowerVolumes({ id, bounds, wallFeet = 2 }) {
  const size = dimensions(id, bounds, wallFeet);
  if (wallFeet <= 0 || size.y <= 1 || size.x < 10 || size.z < 10)
    throw new RangeError('A round tower requires a usable interior and positive wall thickness');
  const wall = { min: bounds.min, max: { ...bounds.max, y: bounds.max.y - 0.5 } };
  const room = {
    min: { x: bounds.min.x + wallFeet, y: bounds.min.y, z: bounds.min.z + wallFeet },
    max: { x: bounds.max.x - wallFeet, y: wall.max.y, z: bounds.max.z - wallFeet },
  };
  const deck = { min: { ...bounds.min, y: wall.max.y }, max: bounds.max };
  const parapet = {
    min: { ...bounds.min, y: bounds.max.y },
    max: { ...bounds.max, y: bounds.max.y + 1.5 },
  };
  const crownRoom = {
    min: { ...room.min, y: parapet.min.y },
    max: { ...room.max, y: parapet.max.y },
  };
  const result = [
    volume(`${id}-wall`, 'castle', wall, roundedShape(wall, 'cylinder')),
    volume(`${id}-room`, 'castle', room, roundedShape(room, 'cylinder'), 'subtract'),
    volume(`${id}-deck`, 'roof', deck, roundedShape(deck, 'cylinder')),
    volume(`${id}-parapet`, 'roof', parapet, roundedShape(parapet, 'cylinder')),
    volume(
      `${id}-parapet-room`,
      'roof',
      crownRoom,
      roundedShape(crownRoom, 'cylinder'),
      'subtract'
    ),
  ];
  const center = roundedShape(bounds, 'cylinder').center;
  for (let i = 0; i < 12; i++) {
    const angle = (i * Math.PI) / 6;
    const x = center.x + (size.x / 2 - 1.25) * Math.cos(angle);
    const z = center.z + (size.z / 2 - 1.25) * Math.sin(angle);
    result.push(
      volume(`${id}-merlon-${i}`, 'roof', {
        min: { x: x - 1.25, y: parapet.max.y, z: z - 1.25 },
        max: { x: x + 1.25, y: bounds.max.y + 3, z: z + 1.25 },
      })
    );
  }
  return result;
}
