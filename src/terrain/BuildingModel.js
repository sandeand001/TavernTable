export const ROOF_TYPES = ['flat', 'gable', 'hipped', 'conical', 'domed', 'none', 'battlement'];
export const BUILDING_SIDES = ['north', 'east', 'south', 'west'];
const identifier = (value) =>
  typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(value);
const finite = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const copy = (value) => JSON.parse(JSON.stringify(value));
const EPSILON = 1e-6;

export function structureDisplayName(spec) {
  const label = {
    building: 'Building',
    turret: 'Turret',
    cellar: 'Cellar',
    wall: 'Wall',
    dome: 'Dome',
    cave: 'Cave',
    tunnel: 'Tunnel',
    stalagmite: 'Stalagmite',
    stalactite: 'Stalactite',
  }[spec.kind];
  if (!label || typeof spec.id !== 'string')
    throw new Error('A structure identifier requires a valid definition');
  return spec.name ?? `${label} ${spec.id.replace(/^structure-/, '').slice(0, 55)}`;
}

export function buildingStoreys(spec) {
  return spec.building?.levels?.length ?? spec.heightFeet / 10;
}

export function buildingLevels(spec, { includeDeck = true } = {}) {
  const levels = spec.building?.levels
    ? copy(spec.building.levels)
    : Array.from({ length: spec.heightFeet / 10 }, (_, id) => ({
        id,
        elevationFeet: spec.kind === 'cellar' ? -(id + 1) * 10 : id * 10,
        openings: [],
      }));
  if (includeDeck && spec.building?.roof === 'battlement' && spec.kind !== 'cellar')
    levels.push({ id: 100, elevationFeet: spec.heightFeet, openings: [], roofDeck: true });
  return levels.sort((a, b) => a.elevationFeet - b.elevationFeet);
}

export function buildingLevelElevation(spec, id) {
  const level = buildingLevels(spec).find((entry) => entry.id === id);
  if (!level) throw new Error('The selected building level no longer exists');
  return level.elevationFeet;
}

export function buildingLevelHeight(spec, id) {
  const levels = buildingLevels(spec),
    index = levels.findIndex((entry) => entry.id === id);
  if (index < 0 || levels[index].roofDeck)
    throw new Error('Choose an interior level, not the battlement deck');
  const ceiling =
    levels[index + 1]?.elevationFeet ?? (spec.kind === 'cellar' ? 0 : spec.heightFeet);
  return ceiling - levels[index].elevationFeet;
}

export function explicitBuilding(spec) {
  const levels = buildingLevels(spec, { includeDeck: false });
  return {
    ...copy(spec.building),
    version: 3,
    levels,
    nextLevelId: spec.building.nextLevelId ?? Math.max(...levels.map((level) => level.id)) + 1,
  };
}

export function changeBuildingLevelHeight(spec, id, heightFeet) {
  if (!Number.isFinite(heightFeet) || heightFeet < 10 || heightFeet % 5 !== 0)
    throw new Error('Room heights use five-foot steps, starting at ten feet');
  const delta = heightFeet - buildingLevelHeight(spec, id),
    building = explicitBuilding(spec);
  const elevation = buildingLevelElevation(spec, id);
  for (const level of building.levels) {
    if (spec.kind === 'cellar' ? level.elevationFeet <= elevation : level.elevationFeet > elevation)
      level.elevationFeet += spec.kind === 'cellar' ? -delta : delta;
  }
  const total = spec.heightFeet + delta;
  if (total > 100) throw new Error('The structure height or cellar depth cannot exceed 100 feet');
  return { ...spec, heightFeet: total, building };
}

export function removeBuildingLevel(spec, id) {
  const levels = buildingLevels(spec, { includeDeck: false });
  if (!levels.some((level) => level.id === id))
    throw new Error('Select an existing interior floor');
  if (levels[0]?.id === id || levels.length === 1)
    throw new Error('Keep the ground or lowest base floor; remove an upper slab instead');
  if (
    [...spec.building.windows, ...spec.building.balconies].some((feature) => feature.floor === id)
  )
    throw new Error(
      'Move or remove the windows and balconies assigned to this floor before removing it'
    );
  const building = explicitBuilding(spec);
  building.levels = building.levels.filter((level) => level.id !== id);
  return { ...spec, building };
}

export function addBuildingLevel(spec) {
  const building = explicitBuilding(spec);
  if (building.levels.length >= 10)
    throw new Error('A structure supports at most ten interior levels');
  const id = building.nextLevelId;
  if (id >= 100) throw new Error('This structure has reached its level-identity limit');
  building.nextLevelId = id + 1;
  const heightFeet = spec.heightFeet + 10;
  if (heightFeet > 100)
    throw new Error('The structure height or cellar depth cannot exceed 100 feet');
  building.levels.push({
    id,
    elevationFeet: spec.kind === 'cellar' ? -heightFeet : spec.heightFeet,
    openings: [],
  });
  return { ...spec, heightFeet, building };
}

export function buildingSignature(spec) {
  const sorted = (value) =>
    Array.isArray(value)
      ? value.map(sorted)
      : value && typeof value === 'object'
        ? Object.fromEntries(
            Object.keys(value)
              .sort()
              .map((key) => [key, sorted(value[key])])
          )
        : value;
  return JSON.stringify(sorted(spec));
}

export function buildingForHeight(building, heightFeet) {
  if (building.levels?.every((level) => level.elevationFeet < 0)) {
    const levels = copy(building.levels);
    const lowest = levels.reduce((a, b) => (a.elevationFeet < b.elevationFeet ? a : b));
    lowest.elevationFeet = -heightFeet;
    return { ...building, levels };
  }
  const levels = building.levels?.filter((level) => level.elevationFeet < heightFeet);
  const kept = levels ? new Set(levels.map((level) => level.id)) : null;
  const elevation = (window) =>
    levels?.find((level) => level.id === window.floor)?.elevationFeet ?? window.floor * 10;
  const floors = heightFeet / 10;
  return {
    ...building,
    ...(levels ? { levels } : {}),
    windows: building.windows
      .filter((window) => (kept ? kept.has(window.floor) : window.floor < floors))
      .map((window) => ({
        ...window,
        heightFeet:
          building.version >= 2
            ? Math.min(window.heightFeet, heightFeet - elevation(window) - window.sillFeet - 1)
            : window.heightFeet,
      }))
      .filter((window) => window.heightFeet >= (building.version >= 2 ? 0.5 : 5)),
    balconies: building.balconies.filter((balcony) =>
      kept ? kept.has(balcony.floor) : balcony.floor < floors
    ),
  };
}

export function buildingDimensions(spec) {
  return spec.kind === 'turret'
    ? { length: spec.diameterFeet, width: spec.diameterFeet }
    : { length: spec.lengthFeet, width: spec.widthFeet };
}

export function buildingFeatureLimits(spec, kind, feature) {
  const { length, width } = buildingDimensions(spec);
  const span = ['north', 'south'].includes(feature?.side) ? length : width;
  const modern = spec.building.version >= 2;
  const margin = modern && kind === 'window' && spec.kind === 'turret' ? 3 : 1;
  return {
    span,
    margin,
    minWidthFeet: modern && kind === 'window' ? 0.5 : 2.5,
    maxWidthFeet: span - margin * 2,
    minHeightFeet: modern ? 0.5 : 5,
    maxHeightFeet: modern
      ? spec.heightFeet - buildingLevelElevation(spec, feature.floor) - feature.sillFeet - 1
      : Math.min(8, 9 - feature.sillFeet),
    minSillFeet: modern ? 0.5 : 1,
    maxSillFeet: modern ? Math.max(8.5, buildingLevelHeight(spec, feature.floor) - 1.5) : 4,
    minDepthFeet: 2.5,
    maxDepthFeet: 30,
  };
}

export function buildingStairs(spec, riseFeet = 10) {
  if (!Number.isFinite(riseFeet) || riseFeet < 5 || riseFeet % 5 !== 0 || riseFeet > 100)
    throw new Error('Physical stairs require a positive five-foot rise');
  const { length, width } = buildingDimensions(spec);
  const dx = spec.kind === 'turret' ? length / 2 - 11.25 : 0;
  const dz =
    spec.kind === 'turret'
      ? width / 2 - 10
      : spec.kind === 'cellar' && spec.building?.cellarLayout
        ? width - 20
        : 0;
  const steps = [],
    path = [];
  const add = (id, x0, z0, x1, z1, top) =>
    steps.push({
      id,
      bounds: {
        min: { x: x0 + dx, y: top - 0.5, z: z0 + dz },
        max: { x: x1 + dx, y: top, z: z1 + dz },
      },
    });
  const flights = riseFeet / 5;
  for (let flight = 0; flight < flights; flight++) {
    const east = flight % 2 === 0,
      base = flight * 5;
    for (let i = 0; i < 4; i++) {
      const x = east ? 5 + i * 2.5 : 12.5 - i * 2.5,
        z = east ? 5 : 10,
        top = base + (i + 1) * 1.25;
      add(`step-${flight * 4 + i}`, x, z, x + 2.5, z + 5, top);
      path.push({ x: x + 1.25 + dx, y: top, z: z + 2.5 + dz });
    }
    if (east) {
      add(flight === 0 ? 'landing' : `landing-${flight}`, 15, 5, 20, 15, base + 5);
      path.push({ x: 17.5 + dx, y: base + 5, z: 7.5 + dz });
      if (flight < flights - 1) path.push({ x: 17.5 + dx, y: base + 5, z: 12.5 + dz });
    } else if (flight < flights - 1) {
      add(`landing-${flight}`, 0, 5, 5, 15, base + 5);
      path.push(
        { x: 2.5 + dx, y: base + 5, z: 12.5 + dz },
        { x: 2.5 + dx, y: base + 5, z: 7.5 + dz }
      );
    }
  }
  return {
    steps,
    path,
    entry: { x: 2.5 + dx, y: 0, z: 7.5 + dz },
    exit: flights % 2 ? { x: 17.5 + dx, y: 0, z: 2.5 + dz } : { x: 2.5 + dx, y: 0, z: 12.5 + dz },
    hole: { min: { x: 5 + dx, y: -1000, z: 5 + dz }, max: { x: 20 + dx, y: 1000, z: 15 + dz } },
  };
}

function clearLanding(spec, feature) {
  if (!spec.building.stairs) return true;
  const levels = buildingLevels(spec),
    index = levels.findIndex((level) => level.id === feature.floor);
  const { length, width } = buildingDimensions(spec),
    layout = buildingStairs(
      spec,
      index < levels.length - 1 ? levels[index + 1].elevationFeet - levels[index].elevationFeet : 10
    );
  const p = buildingWallPoint(spec, feature.side, feature.u, spec.kind === 'turret' ? -3 : -2.5, 0);
  const x = p.x + length / 2,
    z = p.z + width / 2;
  const overlaps = (bounds) =>
    x + 0.5 > bounds.min.x &&
    x - 0.5 < bounds.max.x &&
    z + 0.5 > bounds.min.z &&
    z - 0.5 < bounds.max.z;
  if (index > 0 && overlaps(layout.hole)) return false;
  if (
    index < levels.length - 1 &&
    layout.steps.some(
      (step) => overlaps(step.bounds) && step.bounds.min.y < 5 && step.bounds.max.y > 0
    )
  )
    return false;
  return true;
}

const WINDOW_SPACING = Object.freeze({ residential: 25, civic: 20, fortress: 30 });

export function createWindowLayout(style, sides = BUILDING_SIDES, seed = undefined) {
  if (
    !Object.hasOwn(WINDOW_SPACING, style) ||
    !Array.isArray(sides) ||
    sides.some((side) => !BUILDING_SIDES.includes(side)) ||
    new Set(sides).size !== sides.length ||
    (seed !== undefined && (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff))
  )
    throw new Error('Choose a valid automatic window style and unique wall sides');
  return {
    version: seed === undefined ? 1 : 2,
    style,
    sides: [...sides],
    ...(seed !== undefined ? { seed } : {}),
  };
}

export function normalizeBuilding(input, spec) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).some(
      (key) =>
        ![
          'version',
          'roof',
          'roofRiseFeet',
          'autoWindows',
          'windows',
          'removedWindows',
          'balconies',
          'stairs',
          'levels',
          'access',
          'nextLevelId',
          'windowLayout',
          'cellarLayout',
        ].includes(key)
    )
  )
    throw new Error('The saved building definition is invalid');
  const building = {
    version: input.version ?? 2,
    roof:
      input.roof ??
      (spec.kind === 'turret' ? 'battlement' : spec.kind === 'cellar' ? 'none' : 'gable'),
    roofRiseFeet: input.roofRiseFeet ?? 5,
    autoWindows: input.autoWindows ?? spec.kind !== 'cellar',
    stairs: input.stairs ?? true,
    windows: copy(input.windows ?? []),
    removedWindows: copy(input.removedWindows ?? []),
    balconies: copy(input.balconies ?? []),
    ...(input.levels ? { levels: copy(input.levels) } : {}),
    ...(input.access ? { access: copy(input.access) } : {}),
    ...(input.nextLevelId !== undefined ? { nextLevelId: input.nextLevelId } : {}),
  };
  if (input.windowLayout !== undefined) {
    const layout = input.windowLayout;
    if (
      !layout ||
      typeof layout !== 'object' ||
      Array.isArray(layout) ||
      ![1, 2].includes(layout.version) ||
      Object.keys(layout).some(
        (key) =>
          !['version', 'style', 'sides', ...(layout.version === 2 ? ['seed'] : [])].includes(key)
      ) ||
      (layout.version === 2 && layout.seed === undefined) ||
      !Array.isArray(layout.sides)
    )
      throw new Error('The saved automatic window layout is invalid');
    building.windowLayout = createWindowLayout(
      layout.style,
      layout.sides,
      layout.version === 2 ? layout.seed : undefined
    );
  }
  if (input.cellarLayout !== undefined) {
    const layout = input.cellarLayout;
    if (
      spec.kind !== 'cellar' ||
      !layout ||
      typeof layout !== 'object' ||
      Array.isArray(layout) ||
      Object.keys(layout).some((key) => !['version', 'style', 'seed'].includes(key)) ||
      layout.version !== 1 ||
      layout.style !== 'castle-dungeon' ||
      !Number.isInteger(layout.seed) ||
      !finite(layout.seed, 0, 0xffffffff)
    )
      throw new Error('The saved cellar layout is invalid');
    building.cellarLayout = copy(layout);
  }
  if (spec.kind === 'cellar' && !building.levels) {
    building.version = 3;
    const count = Math.max(1, Math.floor(spec.heightFeet / 10));
    building.levels = Array.from({ length: count }, (_, id) => ({
      id,
      elevationFeet: id === count - 1 ? -spec.heightFeet : -(id + 1) * 10,
      openings: [],
    }));
  }
  if (spec.kind === 'cellar' && !building.access)
    building.access = { kind: 'none', structureId: null, xFeet: 0, zFeet: 0 };
  if (
    spec.kind === 'cellar' &&
    (building.roof !== 'none' ||
      building.autoWindows ||
      building.windows.length ||
      building.balconies.length)
  )
    throw new Error('Cellars use excavated rooms without above-ground roofs, windows or balconies');
  if (building.levels) {
    const ids = new Set(),
      { length, width } = buildingDimensions(spec);
    if (
      building.version !== 3 ||
      !Array.isArray(building.levels) ||
      !building.levels.length ||
      building.levels.length > 10
    )
      throw new Error('A custom building needs one to ten explicitly defined levels');
    let previous = -Infinity;
    for (const level of [...building.levels].sort((a, b) => a.elevationFeet - b.elevationFeet)) {
      if (
        !level ||
        !Number.isInteger(level.id) ||
        level.id < 0 ||
        level.id >= 100 ||
        ids.has(level.id) ||
        Object.keys(level).some((key) => !['id', 'elevationFeet', 'openings'].includes(key)) ||
        !finite(
          level.elevationFeet,
          spec.kind === 'cellar' ? -spec.heightFeet : 0,
          spec.kind === 'cellar' ? -10 : spec.heightFeet - 10
        ) ||
        level.elevationFeet % 5 !== 0 ||
        level.elevationFeet - previous < 10 ||
        !Array.isArray(level.openings) ||
        level.openings.length > 32
      )
        throw new Error(
          'Level elevations use five-foot steps with at least ten feet of room height'
        );
      ids.add(level.id);
      previous = level.elevationFeet;
      const holes = new Set();
      for (const hole of level.openings) {
        if (
          !hole ||
          !identifier(hole.id) ||
          holes.has(hole.id) ||
          Object.keys(hole).some(
            (key) => !['id', 'xFeet', 'zFeet', 'lengthFeet', 'widthFeet'].includes(key)
          ) ||
          !finite(hole.xFeet, 0, length) ||
          !finite(hole.zFeet, 0, width) ||
          !finite(hole.lengthFeet, 5, length) ||
          !finite(hole.widthFeet, 5, width) ||
          ['xFeet', 'zFeet', 'lengthFeet', 'widthFeet'].some((key) => hole[key] % 5 !== 0) ||
          hole.xFeet + hole.lengthFeet > length ||
          hole.zFeet + hole.widthFeet > width
        )
          throw new Error(
            'Floor openings require valid five-foot rectangular bounds within the footprint'
          );
        holes.add(hole.id);
      }
    }
    if (
      spec.kind !== 'cellar' &&
      !building.levels.some((level) => level.id === 0 && level.elevationFeet === 0)
    )
      throw new Error('Keep the ground floor at the building base');
    if (
      building.nextLevelId !== undefined &&
      (!Number.isInteger(building.nextLevelId) ||
        building.nextLevelId <= Math.max(...building.levels.map((level) => level.id)) ||
        building.nextLevelId > 100)
    )
      throw new Error('The saved building has an invalid next-level identity');
    if (
      spec.kind === 'cellar' &&
      Math.min(...building.levels.map((level) => level.elevationFeet)) !== -spec.heightFeet
    )
      throw new Error('The lowest cellar floor must match the excavation depth');
  } else if (building.version === 3 || building.nextLevelId !== undefined)
    throw new Error('The custom building definition is missing its levels');
  if (
    building.access &&
    (spec.kind !== 'cellar' ||
      !['none', 'stairs', 'ladder'].includes(building.access.kind) ||
      (building.access.structureId !== null && !identifier(building.access.structureId)) ||
      !finite(building.access.xFeet, -spec.lengthFeet / 2, spec.lengthFeet / 2) ||
      !finite(building.access.zFeet, -spec.widthFeet / 2, spec.widthFeet / 2) ||
      Object.keys(building.access).some(
        (key) => !['kind', 'structureId', 'xFeet', 'zFeet'].includes(key)
      ))
  )
    throw new Error('Choose a valid cellar access type, building and position');
  const floors = building.levels?.length ?? buildingStoreys(spec);
  const { length, width } = buildingDimensions(spec);
  if (
    ![1, 2, 3].includes(building.version) ||
    !Number.isInteger(floors) ||
    floors < 1 ||
    floors > 10 ||
    Math.abs(spec.angleRadians / (Math.PI / 2) - Math.round(spec.angleRadians / (Math.PI / 2))) >
      1e-7 ||
    !ROOF_TYPES.includes(building.roof) ||
    (building.version === 3 && spec.heightFeet % 5 !== 0) ||
    !finite(building.roofRiseFeet, 1, 30) ||
    typeof building.autoWindows !== 'boolean' ||
    typeof building.stairs !== 'boolean' ||
    !Array.isArray(building.windows) ||
    building.windows.length > 64 ||
    !Array.isArray(building.balconies) ||
    building.balconies.length > 16 ||
    !Array.isArray(building.removedWindows) ||
    building.removedWindows.length > 256 ||
    building.removedWindows.some((id) => !identifier(id))
  )
    throw new Error(
      'Buildings use ten-foot storeys and quarter-turn orientations, with a valid roof and features'
    );
  if (
    floors > 1 &&
    building.stairs &&
    (spec.kind === 'turret' ? spec.diameterFeet < 25 : length < 20 || width < 15)
  )
    throw new Error(
      'Multiple floors with stairs need at least 20 by 15 feet, or a 25-foot turret diameter'
    );
  const ids = new Set();
  for (const [kind, features] of [
    ['window', building.windows],
    ['balcony', building.balconies],
  ]) {
    for (const feature of features) {
      const allowed =
        kind === 'window'
          ? ['id', 'floor', 'side', 'u', 'widthFeet', 'heightFeet', 'sillFeet']
          : ['id', 'floor', 'side', 'u', 'widthFeet', 'depthFeet'];
      const wallLength = ['north', 'south'].includes(feature?.side) ? length : width;
      const limits = buildingFeatureLimits({ ...spec, building }, kind, feature || {});
      if (
        !feature ||
        !identifier(feature.id) ||
        ids.has(feature.id) ||
        Object.keys(feature).some((key) => !allowed.includes(key)) ||
        !Number.isInteger(feature.floor) ||
        feature.floor < (kind === 'balcony' ? 1 : 0) ||
        !buildingLevels({ ...spec, building }, { includeDeck: false }).some(
          (level) => level.id === feature.floor
        ) ||
        !BUILDING_SIDES.includes(feature.side) ||
        !finite(feature.u, 0, 1) ||
        !finite(feature.widthFeet, limits.minWidthFeet, limits.maxWidthFeet) ||
        feature.u * wallLength - feature.widthFeet / 2 < limits.margin - 1e-7 ||
        feature.u * wallLength + feature.widthFeet / 2 > wallLength - limits.margin + 1e-7 ||
        (kind === 'window' &&
          (!finite(feature.heightFeet, limits.minHeightFeet, limits.maxHeightFeet) ||
            !finite(feature.sillFeet, limits.minSillFeet, limits.maxSillFeet))) ||
        (kind === 'balcony' && !finite(feature.depthFeet, limits.minDepthFeet, limits.maxDepthFeet))
      )
        throw new Error(`The building has an invalid ${kind} position or size`);
      if (building.version >= 2 && spec.kind === 'turret' && Math.abs(feature.u - 0.5) > EPSILON)
        throw new Error('Round bases use centred windows and balconies on each cardinal wall');
      ids.add(feature.id);
      if (
        kind === 'window' &&
        feature.floor === 0 &&
        feature.side === 'south' &&
        Math.abs(feature.u - 0.5) * wallLength < (feature.widthFeet + 5) / 2 + 1 - EPSILON
      )
        throw new Error('Leave a wall post between the window and the entrance door');
      if (kind === 'balcony' && !clearLanding({ ...spec, building }, feature))
        throw new Error('The stairs occupy this balcony doorway; choose another wall position');
    }
  }
  return building;
}

function composedWindows(spec, layout) {
  const { length, width } = buildingDimensions(spec),
    levels = buildingLevels(spec, { includeDeck: false });
  const result = [];
  for (const [sideIndex, side] of BUILDING_SIDES.entries()) {
    if (!layout.sides.includes(side)) continue;
    const span = ['north', 'south'].includes(side) ? length : width;
    for (const [levelIndex, level] of levels.entries()) {
      const random = createSeededRNG(
        (layout.seed ^
          Math.imul(level.id + 1, 0x85ebca6b) ^
          Math.imul(sideIndex + 1, 0xc2b2ae35)) >>>
          0,
        173
      );
      const choose = (values) => values[Math.floor(random() * values.length)];
      const roomHeight = buildingLevelHeight(spec, level.id);
      const hall =
        spec.kind !== 'turret' &&
        layout.style !== 'residential' &&
        levelIndex === 1 &&
        levels[levelIndex + 1]?.elevationFeet === level.elevationFeet + roomHeight &&
        span >= 25 &&
        ['north', 'east'].includes(side);
      if (!hall && levelIndex > 1 && (level.id + sideIndex + (layout.seed % 4)) % 4 === 2) continue;
      const count =
        spec.kind === 'turret' || hall
          ? 1
          : Math.min(2, Math.max(1, Math.floor(span / WINDOW_SPACING[layout.style])));
      const shift = choose([-0.07, 0, 0.07]);
      for (let slot = 0; slot < count; slot++) {
        const sill = hall
          ? choose([1, 1.5, 2])
          : layout.style === 'fortress' && levelIndex === 0
            ? choose([3, 4])
            : choose([1.5, 2, 2.5, 3]);
        const maxHeight = spec.heightFeet - level.elevationFeet - sill - 1;
        const height = Math.min(
          hall
            ? choose([12, 14, 16])
            : layout.style === 'fortress' && levelIndex === 0
              ? choose([3, 4, 5])
              : choose([4, 5, 6, 7]),
          hall ? maxHeight : roomHeight - sill - 1,
          maxHeight
        );
        const apertureWidth = Math.min(
          hall
            ? choose([6, 8, 10])
            : layout.style === 'fortress' && levelIndex === 0
              ? choose([2, 3, 4])
              : layout.style === 'civic'
                ? choose([4, 5, 6, 7])
                : choose([3, 4, 5, 6]),
          span * (count === 2 ? 0.22 : 0.42),
          spec.kind === 'turret' ? span - 6 : span - 2
        );
        const widthFeet = Math.floor(apertureWidth * 2) / 2;
        const u =
          spec.kind === 'turret'
            ? 0.5
            : count === 2
              ? (slot === 0 ? 0.28 : 0.72) + shift
              : !level.id && side === 'south'
                ? choose([0.22, 0.78])
                : [0.35, 0.5, 0.65][(levelIndex + sideIndex + (layout.seed % 3)) % 3];
        const window = {
          id: `f${level.id}-${side}-${slot}`,
          floor: level.id,
          side,
          u,
          widthFeet,
          heightFeet: height,
          sillFeet: sill,
        };
        const low = level.elevationFeet + sill,
          high = low + height;
        if (
          result.some(
            (other) =>
              other.side === side &&
              other.floor !== level.id &&
              buildingLevelElevation(spec, other.floor) + other.sillFeet < high + 1 &&
              buildingLevelElevation(spec, other.floor) + other.sillFeet + other.heightFeet >
                low - 1
          )
        )
          continue;
        const margin = spec.kind === 'turret' ? 3 : 1;
        if (
          widthFeet < 0.5 ||
          height < 0.5 ||
          u * span - widthFeet / 2 < margin ||
          u * span + widthFeet / 2 > span - margin
        )
          continue;
        if (!level.id && side === 'south' && Math.abs(u - 0.5) * span < (widthFeet + 5) / 2 + 1)
          continue;
        if (!clearLanding(spec, window)) continue;
        result.push(window);
      }
    }
  }
  return result;
}

export function buildingWindows(spec) {
  if (!spec.building) return [];
  const { length, width } = buildingDimensions(spec);
  const windows = new Map();
  const layout = spec.building.windowLayout;
  if (spec.building.autoWindows && layout?.version === 2)
    for (const window of composedWindows(spec, layout)) windows.set(window.id, window);
  else if (spec.building.autoWindows)
    for (const { id: floor } of buildingLevels(spec, { includeDeck: false }))
      for (const side of BUILDING_SIDES) {
        if (layout && !layout.sides.includes(side)) continue;
        const span = ['north', 'south'].includes(side) ? length : width;
        const count =
          spec.kind === 'turret'
            ? 1
            : layout
              ? Math.min(2, Math.max(1, Math.floor(span / WINDOW_SPACING[layout.style])))
              : Math.min(4, Math.max(1, Math.floor(span / 10)));
        for (let slot = 0; slot < count; slot++) {
          const window = {
            id: `f${floor}-${side}-${slot}`,
            floor,
            side,
            u:
              layout &&
              !floor &&
              side === 'south' &&
              count === 1 &&
              span >= 25 &&
              spec.kind !== 'turret'
                ? 0.25
                : (slot + 0.5) / count,
            widthFeet: 5,
            heightFeet: 5,
            sillFeet: 2,
          };
          if (!floor && side === 'south' && Math.abs(window.u - 0.5) * span < 6) continue;
          if (!clearLanding(spec, window)) continue;
          windows.set(window.id, window);
        }
      }
  const manualIds = new Set(spec.building.windows.map((window) => window.id));
  for (const window of spec.building.windows) {
    const span = ['north', 'south'].includes(window.side) ? length : width;
    for (const [id, other] of windows)
      if (
        id !== window.id &&
        !manualIds.has(id) &&
        windowVerticalOverlap(other, window, spec) &&
        other.side === window.side &&
        Math.abs(other.u - window.u) * span < (other.widthFeet + window.widthFeet) / 2 - EPSILON
      )
        windows.delete(id);
    windows.set(window.id, { ...window });
  }
  for (const id of spec.building.removedWindows) windows.delete(id);
  return [...windows.values()].filter(
    (window) =>
      (spec.building.version >= 2 && manualIds.has(window.id)) ||
      !spec.building.balconies.some(
        (balcony) =>
          (spec.building.version >= 2
            ? buildingLevelElevation(spec, window.floor) + window.sillFeet <
                buildingLevelElevation(spec, balcony.floor) + 8 &&
              buildingLevelElevation(spec, window.floor) + window.sillFeet + window.heightFeet >
                buildingLevelElevation(spec, balcony.floor)
            : balcony.floor === window.floor) &&
          balcony.side === window.side &&
          Math.abs(window.u - balcony.u) *
            (['north', 'south'].includes(window.side) ? length : width) <
            (window.widthFeet + 5) / 2 + 1
      )
  );
}

export function windowVerticalOverlap(a, b, spec = null) {
  const low = (window) =>
    (spec ? buildingLevelElevation(spec, window.floor) : window.floor * 10) + window.sillFeet;
  return low(a) < low(b) + b.heightFeet - EPSILON && low(b) < low(a) + a.heightFeet - EPSILON;
}

export function buildingWindowSections(spec, window) {
  const bottom = buildingLevelElevation(spec, window.floor) + window.sillFeet,
    top = bottom + window.heightFeet;
  const sections = [];
  for (const level of buildingLevels(spec, { includeDeck: false })) {
    const floor = level.id;
    const min = Math.max(bottom, level.elevationFeet),
      max = Math.min(top, level.elevationFeet + buildingLevelHeight(spec, floor) - 0.5);
    if (max - min > EPSILON) sections.push({ floor, bottomFeet: min, topFeet: max });
  }
  return sections;
}

export function buildingWallPoint(spec, side, u, offset = 0, y = 0) {
  const { length, width } = buildingDimensions(spec);
  return side === 'north'
    ? { x: (u - 0.5) * length, y, z: -width / 2 - offset }
    : side === 'south'
      ? { x: (u - 0.5) * length, y, z: width / 2 + offset }
      : side === 'west'
        ? { x: -length / 2 - offset, y, z: (u - 0.5) * width }
        : { x: length / 2 + offset, y, z: (u - 0.5) * width };
}

export function buildingLocalToFeet(spec, point) {
  const c = Math.cos(spec.angleRadians),
    s = Math.sin(spec.angleRadians);
  return {
    x: spec.xFeet + point.x * c - point.z * s,
    y: spec.baseFeet + point.y,
    z: spec.zFeet + point.x * s + point.z * c,
  };
}

export function buildingFeetToLocal(spec, point) {
  const c = Math.cos(spec.angleRadians),
    s = Math.sin(spec.angleRadians);
  const x = point.x - spec.xFeet,
    z = point.z - spec.zFeet;
  return { x: x * c + z * s, y: point.y - spec.baseFeet, z: -x * s + z * c };
}

function box(spec, suffix, min, max, operation = 'add', layerId = 'ground') {
  return {
    id: `${spec.id}-${suffix}`,
    operation,
    layerId,
    bounds: { min: { ...min }, max: { ...max } },
  };
}

function polyhedron(vertices, faces) {
  return { kind: 'polyhedron', vertices, faces };
}

export function buildingVolumes(spec) {
  if (spec.kind === 'cellar') return cellarVolumes(spec);
  const { length, width } = buildingDimensions(spec),
    base = spec.baseFeet,
    top = base + spec.heightFeet;
  const min = { x: -length / 2, y: base, z: -width / 2 },
    max = { x: length / 2, y: top, z: width / 2 };
  const wall = box(spec, 'shell', min, max);
  const room = box(
    spec,
    'room',
    { x: min.x + 1, y: base, z: min.z + 1 },
    { x: max.x - 1, y: top, z: max.z - 1 },
    'subtract'
  );
  if (spec.kind === 'turret') {
    wall.shape = {
      kind: 'cylinder',
      axis: 'y',
      center: { x: 0, y: (base + top) / 2, z: 0 },
      radii: { x: length / 2, y: (top - base) / 2, z: width / 2 },
    };
    room.bounds = {
      min: { x: min.x + 2, y: base, z: min.z + 2 },
      max: { x: max.x - 2, y: top, z: max.z - 2 },
    };
    room.shape = {
      kind: 'cylinder',
      axis: 'y',
      center: { x: 0, y: (base + top) / 2, z: 0 },
      radii: { x: length / 2 - 2, y: (top - base) / 2, z: width / 2 - 2 },
    };
  }
  const result = [wall, room];
  if (spec.appearance) {
    const floor = box(
      spec,
      'floor-surface',
      { x: room.bounds.min.x, y: base - 0.1, z: room.bounds.min.z },
      { x: room.bounds.max.x, y: base, z: room.bounds.max.z }
    );
    if (spec.kind === 'turret')
      floor.shape = {
        kind: 'cylinder',
        axis: 'y',
        center: { x: 0, y: base - 0.05, z: 0 },
        radii: { x: length / 2 - 2, y: 0.05, z: width / 2 - 2 },
      };
    result.push(floor);
  }
  for (const hole of buildingLevels(spec, { includeDeck: false }).find((level) => level.id === 0)
    ?.openings || [])
    result.push(
      box(
        spec,
        `ground-opening-${hole.id}`,
        { x: hole.xFeet - length / 2, y: base - 0.51, z: hole.zFeet - width / 2 },
        {
          x: hole.xFeet + hole.lengthFeet - length / 2,
          y: base + 0.01,
          z: hole.zFeet + hole.widthFeet - width / 2,
        },
        'subtract'
      )
    );
  const cut = (id, side, u, floor, apertureWidth, sill, height) => {
    const along = ['north', 'south'].includes(side) ? 'x' : 'z';
    const thin = along === 'x' ? 'z' : 'x';
    const elevation = buildingLevelElevation(spec, floor);
    const point = buildingWallPoint(spec, side, u, 0, elevation);
    let thickness = spec.kind === 'turret' ? 3 : 1.5;
    if (spec.kind === 'turret' && spec.building.version >= 2) {
      const radius = length / 2,
        inner = radius - 2;
      const edge = Math.abs(point[along]) + apertureWidth / 2;
      thickness = Math.max(
        thickness,
        radius - Math.sqrt(Math.max(0, inner * inner - edge * edge)) + 0.5
      );
    }
    const lo = { ...point, y: base + elevation + sill },
      hi = { ...point, y: base + elevation + sill + height };
    lo[along] -= apertureWidth / 2;
    hi[along] += apertureWidth / 2;
    const sign = ['east', 'south'].includes(side) ? 1 : -1;
    lo[thin] = Math.min(point[thin] + sign * 0.1, point[thin] - sign * thickness);
    hi[thin] = Math.max(point[thin] + sign * 0.1, point[thin] - sign * thickness);
    result.push(box(spec, id, lo, hi, 'subtract'));
  };
  cut('entry-door', 'south', 0.5, 0, 5, 0, 8);
  result.push(
    box(
      spec,
      'porch',
      { x: -2.5, y: base - 0.5, z: width / 2 - 1 },
      { x: 2.5, y: base, z: width / 2 + 3 }
    )
  );
  for (const window of buildingWindows(spec))
    cut(
      `window-${window.id}`,
      window.side,
      window.u,
      window.floor,
      window.widthFeet,
      window.sillFeet,
      window.heightFeet
    );
  for (const balcony of spec.building.balconies) {
    cut(`balcony-${balcony.id}-door`, balcony.side, balcony.u, balcony.floor, 5, 0, 8);
    const along = ['north', 'south'].includes(balcony.side) ? 'x' : 'z',
      thin = along === 'x' ? 'z' : 'x';
    const sign = ['east', 'south'].includes(balcony.side) ? 1 : -1;
    const point = buildingWallPoint(
      spec,
      balcony.side,
      balcony.u,
      0,
      buildingLevelElevation(spec, balcony.floor)
    );
    const low = { ...point, y: base + point.y - 0.5 },
      high = { ...point, y: base + point.y };
    low[along] -= balcony.widthFeet / 2;
    high[along] += balcony.widthFeet / 2;
    const a = point[thin] - sign,
      b = point[thin] + sign * balcony.depthFeet;
    low[thin] = Math.min(a, b);
    high[thin] = Math.max(a, b);
    result.push(box(spec, `balcony-${balcony.id}-deck`, low, high, 'add', 'balcony'));
    const rail = (suffix, lo, hi) =>
      result.push(
        box(
          spec,
          `balcony-${balcony.id}-${suffix}`,
          { ...lo, y: high.y },
          { ...hi, y: high.y + 3 },
          'add',
          'balcony'
        )
      );
    const outside = point[thin] + sign * balcony.depthFeet;
    rail('outer-rail', { ...low, [thin]: outside - 0.25 }, { ...high, [thin]: outside + 0.25 });
    rail('left-rail', low, { ...high, [along]: low[along] + 0.5 });
    rail('right-rail', { ...low, [along]: high[along] - 0.5 }, high);
  }
  const { roof, roofRiseFeet: rise } = spec.building;
  if (roof === 'battlement') {
    if (spec.kind === 'turret')
      result.push(
        ...createRoundTowerVolumes({
          id: spec.id,
          bounds: { min, max },
        })
          .filter((volume) => volume.id.includes('-parapet') || volume.id.includes('-merlon'))
          .map((volume) => ({ ...volume, layerId: 'castle' }))
      );
    else {
      for (const side of BUILDING_SIDES) {
        const along = ['north', 'south'].includes(side) ? 'x' : 'z',
          thin = along === 'x' ? 'z' : 'x';
        const face = ['north', 'west'].includes(side) ? min[thin] : max[thin] - 1;
        const low = { ...min, y: top, [thin]: face },
          high = { ...max, y: top + 1.5, [thin]: face + 1 };
        result.push(box(spec, `${side}-parapet`, low, high, 'add', 'castle'));
        let index = 0;
        for (let start = min[along]; start < max[along]; start += 5)
          result.push(
            box(
              spec,
              `${side}-merlon-${index++}`,
              { ...low, y: top + 1.5, [along]: start },
              { ...high, y: top + 3, [along]: Math.min(start + 2.5, max[along]) },
              'add',
              'castle'
            )
          );
      }
    }
    return result;
  }
  if (roof !== 'none') {
    const ceiling = box(
      spec,
      roof === 'flat' ? 'roof' : 'roof-ceiling',
      { ...min, y: top - 0.5 },
      { ...max, y: top },
      'add',
      'roof'
    );
    if (spec.kind === 'turret')
      ceiling.shape = {
        kind: 'cylinder',
        axis: 'y',
        center: { x: 0, y: top - 0.25, z: 0 },
        radii: { x: length / 2, y: 0.25, z: width / 2 },
      };
    result.push(ceiling);
    if (roof !== 'flat') {
      const roofVolume = box(
        spec,
        'roof-shape',
        { ...min, y: top },
        { ...max, y: top + rise },
        'add',
        'roof'
      );
      const points = [
        { x: min.x, y: top, z: min.z },
        { x: max.x, y: top, z: min.z },
        { x: max.x, y: top, z: max.z },
        { x: min.x, y: top, z: max.z },
      ];
      if (roof === 'gable') {
        points.push({ x: min.x, y: top + rise, z: 0 }, { x: max.x, y: top + rise, z: 0 });
        roofVolume.shape = polyhedron(points, [
          [0, 1, 2, 3],
          [0, 4, 5, 1],
          [3, 2, 5, 4],
          [0, 3, 4],
          [1, 5, 2],
        ]);
      } else if (
        roof === 'hipped' &&
        spec.building.version >= 2 &&
        Math.abs(length - width) > EPSILON
      ) {
        const longX = length > width,
          ridge = Math.abs(length - width) / 2;
        points.push(
          { x: longX ? -ridge : 0, y: top + rise, z: longX ? 0 : -ridge },
          { x: longX ? ridge : 0, y: top + rise, z: longX ? 0 : ridge }
        );
        roofVolume.shape = polyhedron(
          points,
          longX
            ? [
                [0, 1, 2, 3],
                [0, 4, 5, 1],
                [3, 2, 5, 4],
                [0, 3, 4],
                [1, 5, 2],
              ]
            : [
                [0, 1, 2, 3],
                [0, 4, 1],
                [3, 2, 5],
                [0, 3, 5, 4],
                [1, 4, 5, 2],
              ]
        );
      } else if (
        roof === 'hipped' ||
        (roof === 'conical' && spec.kind === 'building' && spec.building.version >= 2)
      ) {
        points.push({ x: 0, y: top + rise, z: 0 });
        roofVolume.shape = polyhedron(points, [
          [0, 1, 2, 3],
          [0, 4, 1],
          [1, 4, 2],
          [2, 4, 3],
          [3, 4, 0],
        ]);
      } else if (roof === 'conical') {
        const vertices = Array.from({ length: 16 }, (_, i) => ({
          x: (length / 2) * Math.cos(((i - 0.5) * Math.PI) / 8),
          y: top,
          z: (width / 2) * Math.sin(((i - 0.5) * Math.PI) / 8),
        }));
        vertices.push({ x: 0, y: top + rise, z: 0 });
        roofVolume.shape = polyhedron(vertices, [
          Array.from({ length: 16 }, (_, i) => i),
          ...vertices.slice(0, 16).map((_, i) => [i, 16, (i + 1) % 16]),
        ]);
      } else if (spec.kind === 'building' && spec.building.version >= 2) {
        const vertices = [...points],
          faces = [[0, 1, 2, 3]],
          rings = 6;
        for (let ring = 1; ring < rings; ring++) {
          const angle = (ring * Math.PI) / (rings * 2),
            scale = Math.cos(angle);
          for (const corner of points)
            vertices.push({
              x: corner.x * scale,
              y: top + rise * Math.sin(angle),
              z: corner.z * scale,
            });
          for (let side = 0; side < 4; side++) {
            const low = (ring - 1) * 4,
              high = ring * 4,
              next = (side + 1) % 4;
            faces.push([low + side, low + next, high + next, high + side]);
          }
        }
        const apex = vertices.length;
        vertices.push({ x: 0, y: top + rise, z: 0 });
        for (let side = 0; side < 4; side++)
          faces.push([(rings - 1) * 4 + side, apex, (rings - 1) * 4 + ((side + 1) % 4)]);
        roofVolume.shape = polyhedron(vertices, faces);
      } else
        roofVolume.shape = {
          kind: 'ellipsoid',
          center: { x: 0, y: top, z: 0 },
          radii: { x: length / 2, y: rise, z: width / 2 },
        };
      result.push(roofVolume);
    }
  }
  return result;
}

export function cellarAccessLayout(spec) {
  const top = buildingLevels(spec).at(-1),
    access = spec.building.access;
  const { length, width } = buildingDimensions(spec);
  const x = length / 2 + access.xFeet,
    z = width / 2 + access.zFeet;
  const rise = -top.elevationFeet;
  if (access.kind === 'ladder')
    return {
      riseFeet: rise,
      entry: { x, y: 0, z },
      exit: { x: x - 5, y: 0, z },
      path: [{ x, y: rise, z }],
      hole: { min: { x: x - 2.5, y: -1000, z: z - 2.5 }, max: { x: x + 2.5, y: 1000, z: z + 2.5 } },
      steps: [],
    };
  const raw = buildingStairs(spec, rise),
    dx = x - raw.exit.x,
    dz = z - raw.exit.z;
  const move = (point) => ({ ...point, x: point.x + dx, z: point.z + dz });
  const layout = {
    ...raw,
    riseFeet: rise,
    entry: move(raw.entry),
    exit: move(raw.exit),
    path: raw.path.map(move),
    hole: { min: move(raw.hole.min), max: move(raw.hole.max) },
    steps: raw.steps.map((step) => ({
      ...step,
      bounds: { min: move(step.bounds.min), max: move(step.bounds.max) },
    })),
  };
  const points = [
    layout.entry,
    layout.exit,
    ...layout.steps.flatMap((step) => [step.bounds.min, step.bounds.max]),
  ];
  if (points.some((p) => p.x < 0.5 || p.z < 0.5 || p.x > length - 0.5 || p.z > width - 0.5))
    throw new Error(
      'The cellar stairs need more room beside the access point; resize or move the access'
    );
  return layout;
}

function cellarVolumes(spec) {
  const { length, width } = buildingDimensions(spec),
    base = spec.baseFeet,
    bottom = base - spec.heightFeet;
  const min = { x: -length / 2, y: bottom, z: -width / 2 },
    max = { x: length / 2, y: base - 0.5, z: width / 2 };
  const result = [
    box(spec, 'lining', min, max, 'add', 'cave'),
    box(
      spec,
      'excavation',
      { x: min.x + 1, y: bottom, z: min.z + 1 },
      { x: max.x - 1, y: base - 0.5, z: max.z - 1 },
      'subtract',
      'cave'
    ),
  ];
  const access = spec.building.access;
  if (access?.kind !== 'none') {
    const layout = cellarAccessLayout(spec),
      hole = layout.hole;
    result.push(
      box(
        spec,
        'access-opening',
        { x: hole.min.x - length / 2, y: base - 0.5, z: hole.min.z - width / 2 },
        { x: hole.max.x - length / 2, y: base + 0.01, z: hole.max.z - width / 2 },
        'subtract',
        'cave'
      )
    );
    if (access.kind === 'ladder') {
      const x = access.xFeet + 1.5,
        z = access.zFeet,
        y = base + buildingLevels(spec).at(-1).elevationFeet;
      for (const sign of [-1, 1])
        result.push(
          box(
            spec,
            `ladder-rail-${sign}`,
            { x: x - 0.12, y, z: z + sign * 1.5 - 0.12 },
            { x: x + 0.12, y: base + 2, z: z + sign * 1.5 + 0.12 },
            'add',
            'cave'
          )
        );
      for (let rung = 0; rung < base - y; rung++)
        result.push(
          box(
            spec,
            `ladder-rung-${rung}`,
            { x: x - 0.12, y: y + rung, z: z - 1.5 },
            { x: x + 0.12, y: y + rung + 0.15, z: z + 1.5 },
            'add',
            'cave'
          )
        );
    }
  }
  return result;
}

export function buildingIdentity(ownerId, structureId) {
  const hash = (text) => {
    let value = 2166136261;
    for (const c of text) value = Math.imul(value ^ c.charCodeAt(0), 16777619) >>> 0;
    return value.toString(16);
  };
  return `building-${hash(ownerId)}-${hash(structureId)}`;
}

export function buildingFloorId(ownerId, structureId, floor) {
  return `${buildingIdentity(ownerId, structureId)}-floor-${floor}`;
}
import { createRoundTowerVolumes } from './StructureShapes.js';
import { createSeededRNG } from '../utils/SeededRNG.js';
