import {
  createDomeVolumes,
  createTubeVolumes,
  createCastleWallVolumes,
  createRoundTowerVolumes,
  createRockFormationVolumes,
} from './StructureShapes.js';
import { normalizeBuilding, buildingVolumes, createWindowLayout } from './BuildingModel.js';
import { WALL_STAIR_FIELDS, validateWallStairs, wallStairVolumes } from './WallStairs.js';
import { normalizeConstructionAppearance } from '../config/biome/ConstructionPalettes.js';

export const STRUCTURE_TYPES = Object.freeze([
  { kind: 'wall', label: 'Wall', heightFeet: 10, diameterFeet: 30, lengthFeet: 30, widthFeet: 2 },
  {
    kind: 'turret',
    label: 'Turret',
    heightFeet: 20,
    diameterFeet: 30,
    lengthFeet: 30,
    widthFeet: 20,
  },
  { kind: 'dome', label: 'Dome', heightFeet: 12, diameterFeet: 30, lengthFeet: 30, widthFeet: 20 },
  {
    kind: 'building',
    label: 'Building',
    heightFeet: 10,
    diameterFeet: 30,
    lengthFeet: 25,
    widthFeet: 20,
  },
  { kind: 'cave', label: 'Cave', heightFeet: 15, diameterFeet: 35, lengthFeet: 30, widthFeet: 20 },
  {
    kind: 'cellar',
    label: 'Cellar',
    heightFeet: 20,
    diameterFeet: 30,
    lengthFeet: 40,
    widthFeet: 30,
  },
  {
    kind: 'tunnel',
    label: 'Tunnel',
    heightFeet: 10,
    diameterFeet: 30,
    lengthFeet: 25,
    widthFeet: 15,
  },
]);

// Keep saved prototype formations readable and removable without offering new Build tools.
const LEGACY_ROCK_TYPES = Object.freeze([
  {
    kind: 'stalagmite',
    label: 'Stalagmite',
    heightFeet: 20,
    diameterFeet: 5,
    lengthFeet: 15,
    widthFeet: 15,
  },
  {
    kind: 'stalactite',
    label: 'Stalactite',
    heightFeet: 10,
    diameterFeet: 3,
    lengthFeet: 15,
    widthFeet: 15,
  },
]);

const KEYS = [
  'id',
  'kind',
  'xFeet',
  'zFeet',
  'baseFeet',
  'heightFeet',
  'diameterFeet',
  'lengthFeet',
  'widthFeet',
  'angleRadians',
  'style',
  'source',
  'ruined',
  'opening',
  'openingWidthFeet',
  'openingHeightFeet',
  'openingShape',
  'building',
  'name',
  'appearance',
  'rockProfileVersion',
  ...WALL_STAIR_FIELDS,
];
const clone = (value) => JSON.parse(JSON.stringify(value));

export function structureMinimumHeight(spec) {
  return spec.kind === 'wall' ? (spec.wallStairs ? 0.5 : 5) : 7;
}

export function isRockFormation(spec) {
  return ['stalagmite', 'stalactite'].includes(spec?.kind);
}

export function structureMinimumDiameter(spec) {
  return isRockFormation(spec) ? 1 : 15;
}

export function isRoundStructure(spec) {
  return ['dome', 'cave', 'turret'].includes(spec?.kind) || isRockFormation(spec);
}

export function structureHeightChanges(spec, heightFeet) {
  return {
    heightFeet,
    ...(spec.kind === 'stalactite'
      ? { baseFeet: spec.baseFeet + spec.heightFeet - heightFeet }
      : {}),
  };
}

export function createStructure(input, { legacy = false } = {}) {
  const type = [...STRUCTURE_TYPES, ...LEGACY_ROCK_TYPES].find(
    (entry) => entry.kind === input?.kind
  );
  if (
    !type ||
    Object.keys(input).some((key) => !KEYS.includes(key)) ||
    typeof input.id !== 'string' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/.test(input.id) ||
    input.id === 'terrain'
  )
    throw new TypeError('Choose a valid structure type and unique ID');
  const spec = {
    id: input.id,
    kind: type.kind,
    xFeet: input.xFeet,
    zFeet: input.zFeet,
    baseFeet: input.baseFeet === undefined ? 0 : input.baseFeet,
    heightFeet: input.heightFeet === undefined ? type.heightFeet : input.heightFeet,
    diameterFeet: input.diameterFeet === undefined ? type.diameterFeet : input.diameterFeet,
    lengthFeet: input.lengthFeet === undefined ? type.lengthFeet : input.lengthFeet,
    widthFeet:
      input.widthFeet === undefined
        ? input.style === 'battlement'
          ? 10
          : type.widthFeet
        : input.widthFeet,
    angleRadians: input.angleRadians === undefined ? 0 : input.angleRadians,
    style: input.style === undefined ? 'plain' : input.style,
    source: input.source === undefined ? 'manual' : input.source,
    ruined: input.ruined === undefined ? false : input.ruined,
    opening: input.opening === undefined ? false : input.opening,
    ...Object.fromEntries(
      ['openingWidthFeet', 'openingHeightFeet', 'openingShape']
        .filter((key) => input[key] !== undefined)
        .map((key) => [key, input[key]])
    ),
    ...(input.wallStairs !== undefined ? { wallStairs: input.wallStairs } : {}),
    ...Object.fromEntries(
      WALL_STAIR_FIELDS.slice(1)
        .filter((key) => input[key] !== undefined)
        .map((key) => [key, input[key]])
    ),
  };
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9 .-]{0,79}$/.test(input.name))
      throw new Error('A structure name uses one to eighty plain-text letters, numbers or spaces');
    spec.name = input.name;
  }
  if (input.appearance !== undefined)
    spec.appearance = normalizeConstructionAppearance(input.appearance);
  if (input.rockProfileVersion !== undefined || (!legacy && isRockFormation(spec))) {
    const profileVersion = input.rockProfileVersion === undefined ? 2 : input.rockProfileVersion;
    if (!isRockFormation(spec) || ![1, 2].includes(profileVersion))
      throw new Error('Rock profile versions only apply to valid natural rock formations');
    spec.rockProfileVersion = profileVersion;
  }
  if (spec.wallStairs && !legacy && input.wallStairLayout === undefined)
    spec.wallStairLayout = 'auto';
  if (spec.wallStairs && !legacy && input.wallStairVersion === undefined) spec.wallStairVersion = 2;
  if (
    [
      'xFeet',
      'zFeet',
      'baseFeet',
      'heightFeet',
      'diameterFeet',
      'lengthFeet',
      'widthFeet',
      'angleRadians',
    ].some((key) => !Number.isFinite(spec[key])) ||
    spec.heightFeet < structureMinimumHeight(spec) ||
    spec.heightFeet > 100 ||
    spec.diameterFeet < structureMinimumDiameter(spec) ||
    spec.diameterFeet > 500 ||
    spec.lengthFeet < 5 ||
    spec.lengthFeet > 1000 ||
    spec.widthFeet < 1 ||
    spec.widthFeet > 500 ||
    (spec.kind === 'wall' && spec.style === 'battlement' && spec.widthFeet < 7) ||
    (spec.kind !== 'wall' && spec.widthFeet < 10) ||
    !['plain', 'battlement'].includes(spec.style) ||
    !['manual', 'generated'].includes(spec.source) ||
    typeof spec.ruined !== 'boolean' ||
    typeof spec.opening !== 'boolean' ||
    (spec.wallStairs !== undefined &&
      (typeof spec.wallStairs !== 'boolean' || spec.kind !== 'wall'))
  )
    throw new RangeError('Structure dimensions or style are invalid');
  if (Math.abs(spec.angleRadians) > Math.PI)
    spec.angleRadians = Math.atan2(Math.sin(spec.angleRadians), Math.cos(spec.angleRadians));
  if (isRockFormation(spec) && (spec.opening || spec.ruined || spec.style !== 'plain'))
    throw new Error('Rock formations are solid natural rock without doors or battlements');
  if (WALL_STAIR_FIELDS.slice(1).some((key) => spec[key] !== undefined) && spec.kind !== 'wall')
    throw new Error('Wall stair settings only apply to walls');
  validateWallStairs(spec);
  if (
    ['openingWidthFeet', 'openingHeightFeet', 'openingShape'].some(
      (key) => spec[key] !== undefined
    ) &&
    (spec.kind !== 'wall' ||
      (spec.openingWidthFeet !== undefined &&
        (!Number.isFinite(spec.openingWidthFeet) ||
          spec.openingWidthFeet < 5 ||
          (spec.opening && spec.openingWidthFeet > spec.lengthFeet - 2))) ||
      (spec.openingHeightFeet !== undefined &&
        (!Number.isFinite(spec.openingHeightFeet) ||
          spec.openingHeightFeet < 5 ||
          (spec.opening && spec.openingHeightFeet > spec.heightFeet - 1))) ||
      (spec.openingShape !== undefined && !['rectangular', 'arch'].includes(spec.openingShape)))
  )
    throw new Error('The doorway shape and size must fit inside its wall');
  if (
    ['building', 'turret', 'cellar'].includes(spec.kind) &&
    (input.building !== undefined || !legacy)
  ) {
    const definition = input.building ?? {};
    const fresh =
      !legacy &&
      definition &&
      typeof definition === 'object' &&
      !Array.isArray(definition) &&
      definition.version === undefined &&
      definition.windowLayout === undefined;
    spec.building = normalizeBuilding(
      fresh
        ? {
            ...definition,
            windowLayout:
              spec.kind === 'turret'
                ? createWindowLayout('fortress', ['south'], 0)
                : createWindowLayout('residential', undefined, 0),
          }
        : definition,
      spec
    );
  } else if (input.building !== undefined)
    throw new Error('Only buildings and turrets have storeys and roofs');
  return spec;
}

export function structureVolumes(input) {
  const spec = createStructure(input, { legacy: true });
  const round = isRoundStructure(spec);
  const width = round ? spec.diameterFeet : spec.lengthFeet;
  const depth = round ? spec.diameterFeet : spec.widthFeet;
  const bounds = {
    min: { x: -width / 2, y: spec.baseFeet, z: -depth / 2 },
    max: { x: width / 2, y: spec.baseFeet + spec.heightFeet, z: depth / 2 },
  };
  const box = (suffix, low, high, operation = 'add', layerId = 'ground') => ({
    id: `${spec.id}-${suffix}`,
    layerId,
    operation,
    bounds: { min: low, max: high },
  });
  let volumes;
  if (isRockFormation(spec)) {
    volumes = createRockFormationVolumes({
      id: spec.id,
      bounds,
      inverted: spec.kind === 'stalactite',
      profileVersion: spec.rockProfileVersion ?? 1,
    });
  } else if (spec.building) {
    volumes = buildingVolumes(spec);
  } else if (spec.kind === 'wall') {
    volumes =
      spec.style === 'battlement'
        ? createCastleWallVolumes({ id: spec.id, bounds })
        : [box('wall', bounds.min, bounds.max, 'add', 'castle')];
    if (spec.wallStairs) volumes.push(...wallStairVolumes(spec));
  } else if (spec.kind === 'turret') {
    volumes = createRoundTowerVolumes({ id: spec.id, bounds });
  } else if (spec.kind === 'tunnel') {
    volumes = createTubeVolumes({ id: spec.id, bounds, axis: 'x' });
  } else if (spec.kind === 'building') {
    volumes = [
      box('shell', bounds.min, { ...bounds.max, y: bounds.max.y - 0.5 }),
      box('roof', { ...bounds.min, y: bounds.max.y - 0.5 }, bounds.max, 'add', 'roof'),
      box(
        'room',
        { ...bounds.min, x: bounds.min.x + 1, z: bounds.min.z + 1 },
        { ...bounds.max, x: bounds.max.x - 1, y: bounds.max.y - 0.5, z: bounds.max.z - 1 },
        'subtract'
      ),
    ];
  } else {
    volumes = createDomeVolumes({
      id: spec.id,
      bounds,
      layerId: spec.kind === 'cave' ? 'cave' : 'dome',
    });
  }
  if (spec.kind !== 'wall' && !spec.building && !isRockFormation(spec)) {
    const floor = box(
      'floor',
      { ...bounds.min, y: spec.baseFeet - 0.5 },
      { ...bounds.max, y: spec.baseFeet },
      'add',
      spec.kind === 'cave' || spec.kind === 'tunnel' ? 'cave' : 'ground'
    );
    if (round)
      floor.shape = {
        kind: 'cylinder',
        axis: 'y',
        center: { x: 0, y: spec.baseFeet - 0.25, z: 0 },
        radii: { x: width / 2, y: 0.25, z: depth / 2 },
      };
    volumes.unshift(floor);
  }
  if (spec.kind === 'wall' && spec.opening) {
    const doorWidth = spec.openingWidthFeet ?? 7.5,
      doorHeight = spec.openingHeightFeet ?? Math.min(8, spec.heightFeet - 1);
    const opening = box(
      'door',
      { x: -doorWidth / 2, y: spec.baseFeet, z: -depth / 2 },
      { x: doorWidth / 2, y: spec.baseFeet + doorHeight, z: depth / 2 },
      'subtract'
    );
    if (spec.openingShape === 'arch') {
      const profile = wallOpeningProfile(spec),
        count = profile.length;
      opening.shape = {
        kind: 'polyhedron',
        vertices: [-depth / 2, depth / 2].flatMap((z) =>
          profile.map((p) => ({ x: p.x, y: spec.baseFeet + p.y, z }))
        ),
        faces: [
          Array.from({ length: count }, (_, i) => i),
          Array.from({ length: count }, (_, i) => count + i),
          ...Array.from({ length: count }, (_, i) => [
            i,
            (i + 1) % count,
            ((i + 1) % count) + count,
            i + count,
          ]),
        ],
      };
    }
    volumes.push(opening);
  }
  if (!['wall', 'tunnel'].includes(spec.kind) && !spec.building && !isRockFormation(spec)) {
    const doorWidth = Math.min(7.5, width / 3);
    volumes.push(
      box(
        'door',
        { x: -doorWidth / 2, y: spec.baseFeet, z: 0 },
        { x: doorWidth / 2, y: spec.baseFeet + Math.min(8, spec.heightFeet - 1), z: bounds.max.z },
        'subtract',
        spec.kind === 'cave' ? 'cave' : 'ground'
      )
    );
  }
  if (spec.ruined) {
    const top =
      spec.baseFeet +
      spec.heightFeet +
      (spec.building?.roof !== 'none' ? (spec.building?.roofRiseFeet ?? 0) : 0);
    volumes.push(
      box(
        'breach',
        { x: -width * 0.18, y: spec.baseFeet, z: -depth / 2 - 0.1 },
        { x: width * 0.08, y: top + 3.1, z: depth * 0.2 },
        'subtract'
      )
    );
    volumes.push(
      box(
        'broken-crown',
        { x: width * 0.15, y: spec.baseFeet + spec.heightFeet * 0.55, z: -depth / 2 - 0.1 },
        { x: width / 2 + 0.1, y: top + 3.1, z: depth / 2 + 0.1 },
        'subtract'
      )
    );
  }
  // Exact cardinal bases keep coincident wall and opening edges identical.
  const [cosine, sine] = [Math.cos(spec.angleRadians), Math.sin(spec.angleRadians)].map((value) =>
    Math.abs(value) < 1e-12 ? 0 : value
  );
  const point = (value) => ({
    x: spec.xFeet + value.x * cosine - value.z * sine,
    y: value.y,
    z: spec.zFeet + value.x * sine + value.z * cosine,
  });
  return volumes.map((original) => {
    const volume = clone(original);
    const { min, max } = volume.bounds;
    const corners = [
      point({ x: min.x, y: min.y, z: min.z }),
      point({ x: max.x, y: min.y, z: min.z }),
      point({ x: max.x, y: min.y, z: max.z }),
      point({ x: min.x, y: min.y, z: max.z }),
    ];
    volume.bounds = {
      min: {
        x: Math.min(...corners.map((p) => p.x)),
        y: min.y,
        z: Math.min(...corners.map((p) => p.z)),
      },
      max: {
        x: Math.max(...corners.map((p) => p.x)),
        y: max.y,
        z: Math.max(...corners.map((p) => p.z)),
      },
    };
    if (volume.shape?.kind === 'polyhedron') {
      volume.shape.vertices = volume.shape.vertices.map(point);
    } else if (volume.shape) {
      volume.shape.center = point(volume.shape.center);
      volume.shape.yawRadians = spec.angleRadians;
      volume.shape.segments = 16;
      if (volume.shape.kind === 'ellipsoid') volume.shape.rings = 8;
    } else if (Math.abs(sine) > 1e-8) {
      volume.shape = { kind: 'prism', points: corners.map(({ x, z }) => ({ x, z })) };
    }
    volume.structureId = spec.id;
    volume.materialRole =
      spec.kind === 'cave' || spec.kind === 'tunnel' || isRockFormation(spec)
        ? 'rock'
        : volume.layerId === 'roof'
          ? 'roof'
          : 'masonry';
    if (spec.source === 'generated') volume.source = 'generated';
    if (spec.appearance) {
      const floor = volume.id.endsWith('-floor-surface');
      const trim = /-(?:.*parapet|merlon|.*merlon)/.test(volume.id);
      if (trim) volume.materialRole = 'trim';
      if (floor) volume.materialRole = 'timber';
      const role = volume.materialRole;
      volume.materialColor = floor
        ? spec.appearance.floorColor
        : role === 'roof'
          ? spec.appearance.roofColor
          : role === 'trim'
            ? spec.appearance.trimColor
            : spec.appearance.wallColor;
      volume.materialStyle = floor
        ? spec.appearance.floorMaterial
        : role === 'roof'
          ? spec.appearance.roofMaterial
          : role === 'trim'
            ? spec.appearance.detail === 'timber'
              ? 'timber'
              : 'stone'
            : spec.appearance.wallMaterial;
    }
    if (isRockFormation(spec)) {
      volume.materialStyle = spec.rockProfileVersion === 2 ? 'rock' : 'none';
      volume.materialColor = spec.appearance?.wallColor ?? 0x797369;
    }
    return volume;
  });
}

export function structureBounds(spec) {
  const volumes = structureVolumes(spec);
  const add = volumes.filter((volume) => volume.operation === 'add');
  return {
    min: Object.fromEntries(
      ['x', 'y', 'z'].map((axis) => [axis, Math.min(...add.map((v) => v.bounds.min[axis]))])
    ),
    max: Object.fromEntries(
      ['x', 'y', 'z'].map((axis) => [axis, Math.max(...add.map((v) => v.bounds.max[axis]))])
    ),
  };
}

export function replaceStructureGeometry(snapshot, spec) {
  if (!snapshot.structures?.some((entry) => entry.id === spec.id))
    throw new Error('Choose an existing structure before replacing its geometry');
  const replacement = structureVolumes(spec);
  const first = snapshot.volumes.findIndex((volume) => volume.structureId === spec.id);
  const owned = new Set(
    snapshot.volumes.filter((volume) => volume.structureId === spec.id).map((volume) => volume.id)
  );
  if (first < 0) throw new Error('The saved structure has no physical geometry');
  const scattered = snapshot.volumes
    .slice(first, first + owned.size)
    .some((volume) => volume.structureId !== spec.id);
  const byId = new Map(replacement.map((volume) => [volume.id, volume]));
  const last = snapshot.volumes.findLastIndex((volume) => volume.structureId === spec.id);
  const volumes = [];
  for (let i = 0; i < snapshot.volumes.length; i++) {
    const volume = snapshot.volumes[i];
    if (!scattered && i === first) volumes.push(...replacement);
    if (volume.structureId !== spec.id) volumes.push(volume);
    else if (scattered) {
      if (byId.has(volume.id)) volumes.push(byId.get(volume.id));
      if (i === last) volumes.push(...replacement.filter((entry) => !owned.has(entry.id)));
    }
  }
  return {
    ...snapshot,
    version: 3,
    structures: snapshot.structures.map((entry) => (entry.id === spec.id ? spec : entry)),
    volumes,
  };
}

export function wallOpeningProfile(spec) {
  const width = spec.openingWidthFeet ?? 7.5,
    height = spec.openingHeightFeet ?? Math.min(8, spec.heightFeet - 1);
  if (spec.openingShape !== 'arch')
    return [
      { x: -width / 2, y: 0 },
      { x: width / 2, y: 0 },
      { x: width / 2, y: height },
      { x: -width / 2, y: height },
    ];
  const rise = Math.min(width / 2, height - 5);
  return [
    { x: -width / 2, y: 0 },
    { x: width / 2, y: 0 },
    ...Array.from({ length: 9 }, (_, i) => ({
      x: (width / 2) * Math.cos((i * Math.PI) / 8),
      y: height - rise + rise * Math.sin((i * Math.PI) / 8),
    })),
  ];
}
