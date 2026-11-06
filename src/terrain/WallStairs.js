export const WALL_STAIR_FIELDS = [
  'wallStairs',
  'wallStairVersion',
  'wallStairLayout',
  'wallStairDirection',
  'wallStairSide',
  'wallStairOffsetFeet',
  'wallStairExit',
];

export function wallStairFootprint(spec) {
  const setting = spec.wallStairLayout ?? 'straight';
  const mode = setting === 'auto' ? (spec.heightFeet > 10 ? 'switchback' : 'straight') : setting;
  const count = Math.ceil(spec.heightFeet / 1.25);
  return {
    mode,
    lengthFeet: mode === 'switchback' ? 55 : count * 5 + 5,
    widthFeet:
      mode === 'switchback'
        ? (spec.wallStairVersion ?? 1) >= 2
          ? Math.max(2, Math.ceil(spec.heightFeet / 10)) * 7.5
          : 15
        : 5,
  };
}

export function validateWallStairs(spec) {
  if (
    ![1, 2].includes(spec.wallStairVersion ?? 1) ||
    !['auto', 'straight', 'switchback'].includes(spec.wallStairLayout ?? 'straight') ||
    !['forward', 'reverse'].includes(spec.wallStairDirection ?? 'forward') ||
    !['near', 'far'].includes(spec.wallStairSide ?? 'near') ||
    !['walkway', 'terrace'].includes(spec.wallStairExit ?? 'walkway') ||
    !Number.isFinite(spec.wallStairOffsetFeet ?? 0) ||
    (spec.wallStairOffsetFeet ?? 0) < 0
  )
    throw new Error('Choose a valid wall stair layout, direction, side and position');
  if (!spec.wallStairs) return;
  if (spec.kind !== 'wall' || spec.style !== 'battlement')
    throw new Error('Wall stairs require battlements');
  if (spec.wallStairLayout === 'switchback' && spec.heightFeet <= 10)
    throw new Error('Use straight stairs for walls no taller than ten feet');
  const layout = wallStairFootprint(spec);
  if (spec.lengthFeet + 1e-6 < layout.lengthFeet + (spec.wallStairOffsetFeet ?? 0))
    throw new Error(
      `Wall stairs need ${layout.lengthFeet} feet plus their offset within the wall length`
    );
}

export function wallStairLayout(spec) {
  validateWallStairs(spec);
  const footprint = wallStairFootprint(spec);
  const reverse = spec.wallStairDirection === 'reverse',
    far = spec.wallStairSide === 'far';
  const origin = -spec.lengthFeet / 2 + (spec.wallStairOffsetFeet ?? 0);
  const point = (p) => ({
    x: origin + (reverse ? footprint.lengthFeet - p.x : p.x),
    y: p.y,
    z: (far ? 1 : -1) * (spec.widthFeet / 2 + p.z),
  });
  const steps = [],
    path = [];
  const slab = (id, x0, z0, x1, z1, top, thin = true) => {
    const a = point({ x: x0, y: thin ? top - 0.5 : 0, z: z0 });
    const b = point({ x: x1, y: top, z: z1 });
    steps.push({
      id,
      bounds: {
        min: { x: Math.min(a.x, b.x), y: a.y, z: Math.min(a.z, b.z) },
        max: { x: Math.max(a.x, b.x), y: b.y, z: Math.max(a.z, b.z) },
      },
    });
  };
  let entry, exit, topX;
  if (footprint.mode === 'straight') {
    const count = Math.ceil(spec.heightFeet / 1.25),
      run = count * 5;
    for (let i = 0; i < count; i++) {
      const top = (spec.heightFeet * (i + 1)) / count;
      slab(`stair-${i}`, i * 5, 0, (i + 1) * 5, 5, top, false);
      path.push(point({ x: i * 5 + 2.5, y: top, z: 2.5 }));
    }
    slab('stair-landing', run, -2.5, run + 5, 5, spec.heightFeet, false);
    path.push(
      point({ x: run + 2.5, y: spec.heightFeet, z: 2.5 }),
      point({ x: run + 2.5, y: spec.heightFeet, z: -2.5 })
    );
    entry = point({ x: -2.5, y: 0, z: 2.5 });
    exit = point({ x: run + 2.5, y: spec.heightFeet, z: -2.5 });
    topX = run;
  } else {
    const flights = Math.max(2, Math.ceil(spec.heightFeet / 10)),
      rise = spec.heightFeet / flights;
    const lane = 7.5;
    const solid = (spec.wallStairVersion ?? 1) >= 2;
    for (let flight = 0; flight < flights; flight++) {
      const forward = flight % 2 === 0,
        z = solid ? (flights - 1 - flight) * lane : forward ? 0 : lane,
        floor = flight * rise;
      for (let i = 0; i < 8; i++) {
        const x = forward ? 7.5 + i * 5 : 42.5 - i * 5,
          top = floor + (rise * (i + 1)) / 8;
        slab(`stair-${flight * 8 + i}`, x, z, x + 5, z + lane, top, !solid);
        path.push(point({ x: x + 2.5, y: top, z: z + lane / 2 }));
      }
      const x = forward ? 47.5 : 0,
        top = floor + rise;
      slab(
        flight === flights - 1 ? 'stair-landing' : `stair-turn-${flight}`,
        x,
        flight === flights - 1 ? -2.5 : solid ? z - lane : 0,
        x + 7.5,
        solid ? z + lane : lane * 2,
        top,
        !solid
      );
      path.push(point({ x: x + 3.75, y: top, z: z + lane / 2 }));
      if (flight < flights - 1)
        path.push(
          point({ x: x + 3.75, y: top, z: solid ? z - lane / 2 : forward ? lane * 1.5 : lane / 2 })
        );
    }
    topX = flights % 2 ? 47.5 : 0;
    path.push(point({ x: topX + 3.75, y: spec.heightFeet, z: -2.5 }));
    entry = point({ x: 5, y: 0, z: solid ? (flights - 0.5) * lane : lane / 2 });
    exit = point({ x: topX + 3.75, y: spec.heightFeet, z: -2.5 });
  }
  const a = point({ x: topX - 0.6, y: spec.heightFeet, z: 0.01 });
  const b = point({
    x: topX + (footprint.mode === 'switchback' ? 8.1 : 5.6),
    y: spec.heightFeet + 3.1,
    z: spec.wallStairExit === 'terrace' ? -spec.widthFeet - 0.1 : -1.1,
  });
  return {
    ...footprint,
    steps,
    path,
    entry,
    exit,
    center: point({ x: footprint.lengthFeet / 2, y: 2, z: footprint.widthFeet / 2 }),
    access: {
      min: { x: Math.min(a.x, b.x), y: a.y, z: Math.min(a.z, b.z) },
      max: { x: Math.max(a.x, b.x), y: b.y, z: Math.max(a.z, b.z) },
    },
  };
}

export function wallStairVolumes(spec) {
  const layout = wallStairLayout(spec);
  return [
    ...layout.steps.map((step) => ({
      id: `${spec.id}-${step.id}`,
      layerId: 'castle',
      operation: 'add',
      bounds: {
        min: { ...step.bounds.min, y: step.bounds.min.y + spec.baseFeet },
        max: { ...step.bounds.max, y: step.bounds.max.y + spec.baseFeet },
      },
    })),
    {
      id: `${spec.id}-stair-access`,
      layerId: 'castle',
      operation: 'subtract',
      bounds: {
        min: { ...layout.access.min, y: layout.access.min.y + spec.baseFeet },
        max: { ...layout.access.max, y: layout.access.max.y + spec.baseFeet },
      },
    },
  ];
}
