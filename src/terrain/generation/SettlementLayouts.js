import { createSeededRNG } from '../../utils/SeededRNG.js';
import { getConstructionAppearance } from '../../config/biome/ConstructionPalettes.js';
import { getSettlementProfile } from '../../config/biome/SettlementProfiles.js';
import { BUILDING_SIDES, createWindowLayout } from '../BuildingModel.js';
import { wallStairLayout } from '../WallStairs.js';

const snap = (value) => Math.round(value / 2.5) * 2.5;
const flowerNames = [
  'Foxglove',
  'Alder',
  'Copperleaf',
  'Rosemary',
  'Oakheart',
  'Willow',
  'Juniper',
  'Larkspur',
];
const trades = [
  'Scribe Row',
  'Weavers Row',
  'Potters Lane',
  'Merchants Row',
  'Carters Yard',
  'Tanners Lane',
];
const overlaps = (a, b, padding = 3) =>
  a.min.x < b.max.x + padding &&
  a.max.x > b.min.x - padding &&
  a.min.z < b.max.z + padding &&
  a.max.z > b.min.z - padding;

function footprint(input, includePorch = true) {
  const round = input.kind === 'turret';
  const length = round ? input.diameterFeet : input.lengthFeet,
    width = round ? input.diameterFeet : input.widthFeet;
  const [c, s] = [Math.cos(input.angleRadians), Math.sin(input.angleRadians)].map((value) =>
    Math.abs(value) < 1e-12 ? 0 : value
  );
  const x = (length * Math.abs(c) + width * Math.abs(s)) / 2,
    z = (length * Math.abs(s) + width * Math.abs(c)) / 2;
  const b = {
    min: { x: input.xFeet - x, z: input.zFeet - z },
    max: { x: input.xFeet + x, z: input.zFeet + z },
  };
  if (includePorch && (input.kind === 'building' || round)) {
    const dx = -s * 5,
      dz = c * 5;
    if (dx < 0) b.min.x += dx;
    else b.max.x += dx;
    if (dz < 0) b.min.z += dz;
    else b.max.z += dz;
  }
  return b;
}

function houseProfile({
  ruined,
  heightFeet,
  roof,
  roofRiseFeet = 5,
  random,
  balcony = false,
  lengthFeet,
  widthFeet,
}) {
  const profile = {
    roof,
    roofRiseFeet,
    balconies: balcony
      ? [
          {
            id: 'front',
            floor: 1,
            side: 'south',
            u: 0.5,
            widthFeet: 10,
            depthFeet: 5,
          },
        ]
      : [],
  };
  if (!ruined) return profile;
  const levels = [];
  for (let id = 0; id < heightFeet / 10; id++) {
    if (id >= 2 && random() < 0.18) continue;
    levels.push({
      id,
      elevationFeet: id * 10,
      openings: id
        ? [
            {
              id: 'collapse',
              xFeet: Math.max(0, Math.floor((lengthFeet - 10) / 5) * 5),
              zFeet: Math.max(0, Math.floor((widthFeet - 10) / 5) * 5),
              lengthFeet: 10,
              widthFeet: 10,
            },
          ]
        : [],
    });
  }
  return {
    version: 3,
    roof: random() < 0.78 ? 'none' : roof,
    roofRiseFeet,
    levels,
    nextLevelId: heightFeet / 10,
    balconies: [],
  };
}

export function createSettlementLayout({ biomeKey, seed, width, depth }) {
  const profile = getSettlementProfile(biomeKey);
  if (!profile) throw new Error('Choose a settlement biome for an architectural layout');
  const random = createSeededRNG((Math.imul(seed, 0x9e3779b1) ^ 0x74a6d329) >>> 0, 211);
  const damageRandom = createSeededRNG((Math.imul(seed, 0x85ebca6b) ^ 0x5b62a817) >>> 0, 223);
  const ruined = biomeKey.startsWith('ruined'),
    structures = [],
    volumes = [],
    joins = [],
    occupied = [];
  const cx = width / 2,
    cz = depth / 2,
    size = Math.min(width, depth);
  const heraldry = Math.floor(random() * 4),
    prefix = flowerNames[Math.floor(random() * flowerNames.length)];
  let serial = 0;
  const inside = (b, margin = 0) =>
    b.min.x >= margin &&
    b.min.z >= margin &&
    b.max.x <= width - margin &&
    b.max.z <= depth - margin;
  const place = (input, { overlap = false } = {}) => {
    const box = footprint(input),
      body = footprint(input, profile.kind === 'town');
    let stairBounds;
    if (input.wallStairs) {
      const points = wallStairLayout(input)
        .steps.flatMap((step) => [
          step.bounds.min,
          step.bounds.max,
          { ...step.bounds.min, x: step.bounds.max.x },
          { ...step.bounds.max, x: step.bounds.min.x },
        ])
        .map((point) => ({
          x:
            input.xFeet +
            point.x * Math.cos(input.angleRadians) -
            point.z * Math.sin(input.angleRadians),
          z:
            input.zFeet +
            point.x * Math.sin(input.angleRadians) +
            point.z * Math.cos(input.angleRadians),
        }));
      stairBounds = {
        min: { x: Math.min(...points.map((p) => p.x)), z: Math.min(...points.map((p) => p.z)) },
        max: { x: Math.max(...points.map((p) => p.x)), z: Math.max(...points.map((p) => p.z)) },
      };
    }
    if (
      structures.length >= profile.structures - (profile.kind === 'castle' ? 1 : 0) ||
      !inside(box, 5) ||
      (stairBounds && !inside(stairBounds, 5)) ||
      (!overlap && occupied.some((other) => overlaps(body, other)))
    )
      return false;
    structures.push(input);
    occupied.push(body);
    if (stairBounds) occupied.push(stairBounds);
    return true;
  };
  const building = (kind, x, z, extra = {}) => {
    const heightFeet = extra.heightFeet ?? 10,
      roof = extra.roof ?? 'gable';
    const variant = extra.variant ?? Math.floor(random() * 8);
    const appearance = extra.appearance ?? getConstructionAppearance(biomeKey, variant, heraldry);
    const definition =
      extra.building ??
      houseProfile({
        ruined,
        heightFeet,
        roof,
        roofRiseFeet: extra.roofRiseFeet ?? 5,
        random: damageRandom,
        balcony: extra.balcony ?? false,
        lengthFeet: kind === 'turret' ? (extra.diameterFeet ?? 30) : (extra.lengthFeet ?? 25),
        widthFeet: kind === 'turret' ? (extra.diameterFeet ?? 30) : (extra.widthFeet ?? 20),
      });
    const angle = extra.angleRadians ?? 0;
    const sides =
      extra.windowSides ??
      (profile.kind === 'castle' && kind === 'turret'
        ? BUILDING_SIDES.filter((side) => {
            const normal = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[side];
            const nx = normal[0] * Math.cos(angle) - normal[1] * Math.sin(angle);
            const nz = normal[0] * Math.sin(angle) + normal[1] * Math.cos(angle);
            return nx * (cx - x) + nz * (cz - z) > 1e-6;
          })
        : BUILDING_SIDES);
    return {
      kind,
      xFeet: snap(x),
      zFeet: snap(z),
      baseFeet: extra.baseFeet ?? 0,
      lengthFeet: extra.lengthFeet ?? 25,
      widthFeet: extra.widthFeet ?? 20,
      diameterFeet: extra.diameterFeet ?? 30,
      heightFeet,
      angleRadians: extra.angleRadians ?? 0,
      ruined,
      name: extra.name ?? `${prefix} House ${structures.length + 1}`,
      appearance,
      building: {
        ...definition,
        windowLayout:
          definition.windowLayout ??
          createWindowLayout(
            profile.kind === 'castle'
              ? 'fortress'
              : profile.kind === 'city'
                ? 'civic'
                : 'residential',
            sides,
            (seed ^
              Math.imul(Math.round(x * 2), 0x9e3779b1) ^
              Math.imul(Math.round(z * 2), 0x85ebca6b)) >>>
              0
          ),
      },
    };
  };
  const volume = (
    layer,
    bounds,
    color,
    materialStyle = 'stone',
    operation = 'add',
    shape = null
  ) => {
    if (!inside(bounds) || bounds.max.x <= bounds.min.x || bounds.max.z <= bounds.min.z) return;
    volumes.push({
      id: `site-${biomeKey}-${seed}-${++serial}`,
      layerId: layer,
      source: 'generated',
      operation,
      bounds,
      materialRole:
        materialStyle === 'grass'
          ? 'grass'
          : materialStyle === 'timber'
            ? 'timber'
            : materialStyle === 'paving'
              ? 'paving'
              : 'masonry',
      materialColor: color,
      materialStyle,
      ...(shape ? { shape } : {}),
    });
  };
  const box = (layer, x, z, length, wide, bottom, top, color, style = 'stone') =>
    volume(
      layer,
      {
        min: { x: x - length / 2, y: bottom, z: z - wide / 2 },
        max: { x: x + length / 2, y: top, z: z + wide / 2 },
      },
      color,
      style
    );
  const cylinder = (layer, x, z, radius, bottom, top, color, operation = 'add') =>
    volume(
      layer,
      {
        min: { x: x - radius, y: bottom, z: z - radius },
        max: { x: x + radius, y: top, z: z + radius },
      },
      color,
      'stone',
      operation,
      {
        kind: 'cylinder',
        axis: 'y',
        center: { x, y: (bottom + top) / 2, z },
        radii: { x: radius, y: (top - bottom) / 2, z: radius },
      }
    );
  const road = (points, wide, color) => {
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        length = Math.hypot(b.x - a.x, b.z - a.z);
      if (length < 1) continue;
      const nx = ((-(b.z - a.z) / length) * wide) / 2,
        nz = (((b.x - a.x) / length) * wide) / 2;
      const polygon = [
        { x: a.x + nx, z: a.z + nz },
        { x: b.x + nx, z: b.z + nz },
        { x: b.x - nx, z: b.z - nz },
        { x: a.x - nx, z: a.z - nz },
      ];
      volume(
        'street',
        {
          min: {
            x: Math.min(...polygon.map((p) => p.x)),
            y: -0.1,
            z: Math.min(...polygon.map((p) => p.z)),
          },
          max: {
            x: Math.max(...polygon.map((p) => p.x)),
            y: 0,
            z: Math.max(...polygon.map((p) => p.z)),
          },
        },
        color,
        'paving',
        'add',
        { kind: 'prism', points: polygon }
      );
    }
  };
  const fountain = (x, z, grand = false) => {
    const radius = grand ? 6 : 4.5;
    cylinder('landmark', x, z, radius, 0, 1.6, 0xafa78c);
    cylinder('landmark', x, z, radius - 1, 0.35, 2, 0xafa78c, 'subtract');
    cylinder('landmark', x, z, radius - 1.1, 0.25, 0.36, 0x628b93);
    cylinder('landmark', x, z, grand ? 0.8 : 0.6, 0.35, grand ? 7 : 5, 0xc4bba1);
    cylinder('landmark', x, z, grand ? 2 : 1.5, grand ? 5.5 : 3.8, grand ? 6.1 : 4.3, 0xc4bba1);
  };
  const stall = (x, z, colour, index) => {
    const wood = 0x755139;
    for (const dx of [-4, 4])
      for (const dz of [-3, 3]) box('market', x + dx, z + dz, 0.35, 0.35, 0, 7.4, wood, 'timber');
    box('market', x, z + 1, 7, 2, 0, 2.6, wood, 'timber');
    box('market', x, z, 9, 7, 7.1, 7.35, colour, 'timber');
    for (let stripe = 0; stripe < 4; stripe++)
      box(
        'market',
        x - 3.3 + stripe * 2.2,
        z,
        1,
        7,
        7.35,
        7.39,
        index % 2 ? 0xd9caa9 : 0xcab98f,
        'timber'
      );
  };
  const garden = (input, index) => {
    const angle = input.angleRadians,
      c = Math.cos(angle),
      s = Math.sin(angle);
    const backward = input.widthFeet / 2 + 7;
    const x = input.xFeet + backward * s,
      z = input.zFeet - backward * c;
    const length = 12,
      wide = 8,
      turned = Math.abs(s) > 0.5;
    const footprint = {
      min: { x: x - (turned ? wide : length) / 2, z: z - (turned ? length : wide) / 2 },
      max: { x: x + (turned ? wide : length) / 2, z: z + (turned ? length : wide) / 2 },
    };
    if (!inside(footprint, 5) || occupied.some((b) => overlaps(footprint, b, 1))) return;
    box(
      'garden',
      x,
      z,
      turned ? wide : length,
      turned ? length : wide,
      -0.08,
      0,
      index % 2 ? 0x758950 : 0x8a945b,
      'grass'
    );
    for (let row = 0; row < 3; row++) {
      const offset = (row - 1) * 3;
      box(
        'garden',
        x + offset * c,
        z + offset * s,
        turned ? wide - 1 : 1,
        turned ? 1 : wide - 1,
        -0.025,
        0,
        0x846245,
        'timber'
      );
    }
    const front = turned ? Math.sign(s) : Math.sign(-c);
    for (const sign of [-1, 1]) {
      if (turned && sign === front)
        for (const end of [-1, 1])
          box(
            'garden-fence',
            x + (sign * wide) / 2,
            z + end * 4.5,
            0.22,
            3,
            0,
            2.3,
            0x6e553c,
            'timber'
          );
      else
        box(
          'garden-fence',
          x + (sign * (turned ? wide : length)) / 2,
          z,
          0.22,
          turned ? length : wide,
          0,
          2.3,
          0x6e553c,
          'timber'
        );
      if (!turned && sign === front)
        for (const end of [-1, 1])
          box(
            'garden-fence',
            x + end * 4.5,
            z + (sign * wide) / 2,
            3,
            0.22,
            0,
            2.3,
            0x6e553c,
            'timber'
          );
      else
        box(
          'garden-fence',
          x,
          z + (sign * (turned ? length : wide)) / 2,
          turned ? wide : length,
          0.22,
          0,
          2.3,
          0x6e553c,
          'timber'
        );
    }
  };
  const rubble = () => {
    if (!ruined) return;
    for (const input of structures.filter((s) => s.kind === 'building').slice(0, 12))
      for (let i = 0; i < 3; i++) {
        const x = input.xFeet + (input.lengthFeet / 2 + 2 + random() * 3) * (i % 2 ? 1 : -1);
        const z = input.zFeet + (random() - 0.5) * input.widthFeet;
        const doorX = input.xFeet - Math.sin(input.angleRadians) * (input.widthFeet / 2 + 2.5);
        const doorZ = input.zFeet + Math.cos(input.angleRadians) * (input.widthFeet / 2 + 2.5);
        if (Math.hypot(x - doorX, z - doorZ) < 6) continue;
        box(
          'rubble',
          x,
          z,
          1.1 + random() * 1.8,
          1 + random(),
          0,
          0.4 + random() * 0.7,
          input.appearance.wallColor
        );
      }
  };

  if (profile.kind === 'town') {
    const green = Math.min(24, Math.max(13, size * 0.12));
    const greenBounds = {
      min: { x: cx - green, y: -0.08, z: cz - green * 0.8 },
      max: { x: cx + green, y: 0, z: cz + green * 0.8 },
    };
    volume('garden', greenBounds, ruined ? 0x778269 : 0x829b61, 'grass', 'add', {
      kind: 'cylinder',
      axis: 'y',
      center: { x: cx, y: -0.04, z: cz },
      radii: { x: green, y: 0.04, z: green * 0.8 },
    });
    road(
      [
        { x: cx - 15, z: 5 },
        { x: cx - 10, z: depth * 0.25 },
        { x: cx - green, z: cz - 5 },
        { x: cx - green * 0.6, z: cz + green * 0.8 },
        { x: cx + 20, z: depth * 0.77 },
        { x: width - 8, z: depth - 8 },
      ],
      10,
      ruined ? 0x91846c : 0x9c805f
    );
    fountain(cx, cz);
    const offset = Math.min(42.5, size * 0.28);
    place(
      building('building', cx - offset, cz + size * 0.12, {
        lengthFeet: size >= 100 ? 30 : 20,
        widthFeet: size >= 100 ? 25 : 15,
        heightFeet: size >= 100 ? 20 : 10,
        angleRadians: -Math.PI / 2,
        name: `${prefix} Inn`,
        variant: 0,
        balcony: size >= 100,
      })
    );
    place(
      building('building', cx + offset, cz - size * 0.12, {
        lengthFeet: 25,
        widthFeet: 20,
        heightFeet: 10,
        angleRadians: Math.PI / 2,
        name: `${prefix} Forge`,
        variant: 4,
      })
    );
    if (size >= 160)
      place(
        building('turret', cx - 20, cz - 47.5, {
          diameterFeet: 30,
          heightFeet: 20,
          roof: 'conical',
          roofRiseFeet: 8,
          name: 'Village Bellhouse',
          variant: 5,
        })
      );
    const target = Math.min(profile.structures, size >= 160 ? 14 : size >= 100 ? 9 : 5);
    for (let attempt = 0; attempt < 120 && structures.length < target; attempt++) {
      const angle = random() * Math.PI * 2;
      const radius = green + 22 + random() * Math.max(0, size / 2 - green - 47);
      const x = cx + Math.cos(angle) * radius,
        z = cz + Math.sin(angle) * radius;
      const facing = (Math.round(Math.atan2(x - cx, cz - z) / (Math.PI / 2)) * Math.PI) / 2;
      const tall = size >= 150 && random() < 0.2;
      const length = tall ? 25 : 20 + (random() > 0.6 ? 5 : 0),
        wide = tall ? 20 : 15 + (random() > 0.5 ? 5 : 0);
      place(
        building('building', x, z, {
          lengthFeet: length,
          widthFeet: wide,
          heightFeet: tall ? 20 : 10,
          angleRadians: facing,
          roof: random() < 0.2 ? 'hipped' : 'gable',
          name: `${flowerNames[Math.floor(random() * flowerNames.length)]} Cottage ${structures.length + 1}`,
        })
      );
    }
    for (const input of structures.filter((s) => s.kind === 'building').slice(2))
      garden(input, structures.indexOf(input));
    for (const input of structures) {
      const door = {
        x: input.xFeet - Math.sin(input.angleRadians) * (input.widthFeet / 2 + 4),
        z: input.zFeet + Math.cos(input.angleRadians) * (input.widthFeet / 2 + 4),
      };
      const dx = door.x - cx,
        dz = door.z - cz,
        d = Math.hypot(dx, dz);
      road(
        [{ x: cx + (dx / d) * green * 0.9, z: cz + (dz / d) * green * 0.9 }, door],
        5.5,
        0x9d8666
      );
    }
  } else if (profile.kind === 'city') {
    const compact = size < 170;
    const avenue = compact ? 10 : 15;
    road(
      [
        { x: cx, z: 5 },
        { x: cx - 2.5, z: cz },
        { x: cx + 2.5, z: depth - 5 },
      ],
      avenue,
      0x858476
    );
    if (size < 90) {
      place(
        building('building', cx - 17.5, cz - 7.5, {
          lengthFeet: 20,
          widthFeet: 15,
          heightFeet: 10,
          angleRadians: -Math.PI / 2,
          name: 'Market House',
          variant: 2,
        })
      );
      place(
        building('building', cx + 17.5, cz + 7.5, {
          lengthFeet: 20,
          widthFeet: 15,
          heightFeet: 10,
          angleRadians: Math.PI / 2,
          name: 'Scribe House',
          variant: 0,
        })
      );
      return { structures, volumes };
    }
    if (!compact)
      road(
        [
          { x: 5, z: cz - 2.5 },
          { x: cx, z: cz },
          { x: width - 5, z: cz + 2.5 },
        ],
        12,
        0x858476
      );
    const plaza = compact ? 14 : 26;
    box('plaza', cx, cz, plaza * 2, plaza * 1.4, -0.09, 0, 0xbbb198, 'paving');
    const hallX = compact ? cx + 27.5 : cx + 42.5;
    place(
      building('building', hallX, cz, {
        lengthFeet: compact ? 25 : 35,
        widthFeet: compact ? 20 : 30,
        heightFeet: compact ? 20 : 30,
        angleRadians: Math.PI / 2,
        roof: 'hipped',
        roofRiseFeet: 8,
        name: 'Mercantile Hall',
        variant: 2,
      })
    );
    if (!compact) {
      place(
        building('turret', cx - width * 0.32, cz - depth * 0.32, {
          diameterFeet: 30,
          heightFeet: 30,
          roof: 'conical',
          roofRiseFeet: 10,
          name: 'Westgate Bell Tower',
          variant: 6,
        })
      );
      fountain(cx, cz, true);
      for (let i = 0; i < 6; i++)
        stall(
          cx + ((i % 3) - 1) * 12,
          cz + (i < 3 ? -1 : 1) * 15,
          [0x873f3a, 0x3d6778, 0x6a7c4e][i % 3],
          i
        );
      box('garden', cx - width * 0.32, cz + depth * 0.32, 28, 22, -0.08, 0, 0x7d9469, 'grass');
    } else fountain(cx, cz, false);
    const zones = compact
      ? [
          { min: { x: 6, z: 6 }, max: { x: cx - 8, z: depth - 6 } },
          { min: { x: cx + 8, z: 6 }, max: { x: width - 6, z: depth - 6 } },
        ]
      : [
          { min: { x: 7, z: 7 }, max: { x: cx - 12, z: cz - 20 } },
          { min: { x: cx + 12, z: 7 }, max: { x: width - 7, z: cz - 20 } },
          { min: { x: 7, z: cz + 20 }, max: { x: cx - 12, z: depth - 7 } },
          { min: { x: cx + 12, z: cz + 20 }, max: { x: width - 7, z: depth - 7 } },
        ];
    const quota = Math.max(1, Math.floor((profile.structures - structures.length) / zones.length));
    for (let district = 0; district < zones.length; district++) {
      const zone = zones[district],
        w = zone.max.x - zone.min.x,
        d = zone.max.z - zone.min.z;
      const columns = Math.max(1, Math.floor((w + 6) / (compact ? 26 : 31)));
      const rows = Math.max(1, Math.floor((d + 6) / 31));
      const pitchX = w / columns,
        pitchZ = d / rows;
      let placed = 0;
      for (let column = 0; column < columns; column++) {
        if (column)
          road(
            [
              { x: zone.min.x + column * pitchX, z: zone.min.z - 3 },
              { x: zone.min.x + column * pitchX, z: zone.max.z + 3 },
            ],
            6,
            0xaaa28e
          );
        for (let row = 0; row < rows; row++) {
          if (row && column === 0)
            road(
              [
                { x: zone.min.x - 3, z: zone.min.z + row * pitchZ },
                { x: zone.max.x + 3, z: zone.min.z + row * pitchZ },
              ],
              6,
              0xaaa28e
            );
          const facing =
            zone.max.x <= cx
              ? column % 2
                ? -Math.PI / 2
                : Math.PI / 2
              : column % 2
                ? Math.PI / 2
                : -Math.PI / 2;
          const length = Math.min(30, Math.floor((pitchZ - 5) / 5) * 5),
            wide = Math.min(25, Math.floor((pitchX - 5) / 5) * 5);
          if (length < 20 || wide < 15) continue;
          const tall = length >= 25 && wide >= 20;
          const x = zone.min.x + (column + 0.5) * pitchX;
          const z = zone.min.z + (row + 0.5) * pitchZ + (random() - 0.5) * 5;
          const roof = random() < 0.25 ? 'flat' : random() < 0.4 ? 'hipped' : 'gable';
          if (placed >= quota) continue;
          if (
            place(
              building('building', x, z, {
                lengthFeet: length,
                widthFeet: wide,
                heightFeet: tall ? (random() < 0.36 ? 30 : 20) : 10,
                angleRadians: facing,
                roof,
                variant: (district * 2 + Math.floor(random() * 2) + (row % 2)) % 8,
                name: `${trades[district % trades.length]} ${row * columns + column + 1}`,
              })
            )
          )
            placed++;
        }
      }
    }
  } else {
    const architecture = createSeededRNG((Math.imul(seed, 0x27d4eb2d) ^ 0xa511e9b3) >>> 0, 239);
    const choose = (values) => values[Math.floor(architecture() * values.length)];
    const grand = size >= 210,
      medium = size >= 170;
    if (size < 100) {
      place(
        building('turret', cx - 10, cz - 10, {
          diameterFeet: 30,
          heightFeet: choose([20, 30]),
          roof: 'battlement',
          angleRadians: -Math.PI / 2,
          name: 'Gate Watch',
          variant: 0,
          building: {
            roof: ruined ? 'none' : 'battlement',
            removedWindows: ['f0-west-0', 'f1-west-0'],
          },
        })
      );
      place(
        {
          kind: 'wall',
          xFeet: cx,
          zFeet: cz + 7.5,
          lengthFeet: choose([30, 35]),
          widthFeet: 10,
          heightFeet: 10,
          diameterFeet: 30,
          baseFeet: 0,
          angleRadians: 0,
          style: 'battlement',
          ruined,
          opening: true,
          openingWidthFeet: 7.5,
          openingHeightFeet: 8,
          openingShape: 'arch',
          name: 'Village Gate',
          appearance: getConstructionAppearance(biomeKey, 1, heraldry),
        },
        { overlap: true }
      );
      road(
        [
          { x: cx, z: depth - 5 },
          { x: cx, z: cz - 2.5 },
        ],
        8,
        0xa6a08e
      );
      return { structures, volumes };
    }
    const family = choose(['citadel', 'bailey', 'palace']);
    const span = grand
      ? Math.min(
          choose(biomeKey === 'castle' ? [180, 190, 200] : [140, 150, 160, 170]),
          Math.floor((size - (biomeKey === 'castle' ? 50 : 70)) / 5) * 5
        )
      : medium
        ? Math.min(choose([90, 100, 110]), Math.floor((size - 60) / 5) * 5)
        : choose([60, 65, 70]);
    const courtDepth = grand
      ? Math.min(
          choose(biomeKey === 'castle' ? [180, 190, 200] : [140, 150, 160, 170]),
          Math.floor((size - (biomeKey === 'castle' ? 50 : 70)) / 5) * 5
        )
      : medium
        ? Math.min(choose([100, 110, 120]), Math.floor((size - 60) / 5) * 5)
        : Math.min(choose([60, 65, 70]), Math.floor((size - 40) / 5) * 5);
    const frontSpan = span + (grand || medium ? choose([-20, 0, 20]) : 0);
    const wallHeight = grand ? choose([15, 20, 25]) : medium ? choose([15, 20]) : choose([10, 15]),
      wallWidth = grand ? 12 : 10;
    const keepLength = grand
      ? choose(
          family === 'palace' ? [50, 55, 60] : family === 'citadel' ? [40, 45, 50] : [40, 45, 55]
        )
      : medium
        ? choose([30, 35, 40])
        : 25;
    const keepWidth = grand
      ? choose(family === 'palace' ? [35, 40, 45] : [30, 35, 40])
      : medium
        ? choose([25, 30])
        : 20;
    const keepHeight = grand
      ? choose(family === 'citadel' ? [50, 60] : family === 'palace' ? [40, 50] : [40, 50, 60])
      : medium
        ? choose([30, 40])
        : choose(biomeKey === 'castle' ? [30, 40] : [20, 30]);
    const keepX = cx + (grand ? choose([-7.5, 0, 7.5]) : 0),
      keepZ = cz + (grand ? choose([-7.5, 0, 5]) : 0) - (biomeKey === 'castle' && grand ? 20 : 0);
    const mainIndex = structures.length;
    const main = building('building', keepX, keepZ, {
      lengthFeet: keepLength,
      widthFeet: keepWidth,
      heightFeet: keepHeight,
      roof: biomeKey === 'castle' ? 'battlement' : 'hipped',
      roofRiseFeet: grand ? choose([8, 10, 12]) : choose([5, 8]),
      name: `${prefix} High Keep`,
      variant: 2,
      ...(biomeKey === 'castle' ? { windowSides: ['north', 'south'] } : {}),
    });
    if (!place(main, { overlap: true }) && biomeKey === 'castle')
      throw new Error('The castle main building does not fit this map');
    if (biomeKey === 'castle') {
      const part = (x, z, title, extra) => {
        const index = structures.length;
        if (
          !place(building('building', x, z, { name: `${prefix} ${title}`, ...extra }), {
            overlap: true,
          })
        )
          throw new Error('The connected castle main building does not fit this map');
        return index;
      };
      if (grand) {
        const wingLength = Math.min(40, Math.floor((size - keepLength - 100) / 10) * 5),
          wingDepth = Math.min(30, keepWidth),
          frontWidth = 30,
          frontDepth = 60,
          gateDepth = 20,
          wingOffset = (keepLength + wingLength) / 2,
          courtWingZ = keepZ + (wingDepth + frontDepth) / 2,
          gateZ = keepZ + wingDepth / 2 + frontDepth - gateDepth / 2,
          gateLength = 2 * wingOffset - frontWidth;
        const west = part(keepX - wingOffset, keepZ, 'West Residential Wing', {
          lengthFeet: wingLength,
          widthFeet: wingDepth,
          heightFeet: 30,
          roof: 'hipped',
          roofRiseFeet: 8,
          windowSides: ['north', 'west'],
        });
        const east = part(keepX + wingOffset, keepZ, 'Great Hall', {
          lengthFeet: wingLength,
          widthFeet: wingDepth,
          heightFeet: 20,
          building: {
            version: 3,
            roof: 'gable',
            roofRiseFeet: 10,
            levels: [{ id: 0, elevationFeet: 0, openings: [] }],
            nextLevelId: 1,
            stairs: false,
          },
          windowSides: ['north', 'east'],
        });
        const westCourt = part(keepX - wingOffset, courtWingZ, 'West Court Wing', {
          lengthFeet: frontDepth,
          widthFeet: frontWidth,
          heightFeet: 20,
          angleRadians: -Math.PI / 2,
          roof: 'gable',
          roofRiseFeet: 6,
          windowSides: ['north', 'west', 'south'],
        });
        const eastCourt = part(keepX + wingOffset, courtWingZ, 'East Court Wing', {
          lengthFeet: frontDepth,
          widthFeet: frontWidth,
          heightFeet: 30,
          angleRadians: Math.PI / 2,
          roof: 'gable',
          roofRiseFeet: 8,
          windowSides: ['north', 'east', 'south'],
        });
        if (
          !place(
            {
              kind: 'wall',
              xFeet: keepX,
              zFeet: gateZ,
              lengthFeet: gateLength,
              widthFeet: gateDepth,
              heightFeet: 10,
              baseFeet: 0,
              diameterFeet: 30,
              angleRadians: 0,
              ruined: false,
              style: 'plain',
              opening: true,
              openingWidthFeet: 12,
              openingHeightFeet: 8,
              openingShape: 'arch',
              name: `${prefix} Gatehouse Arch`,
              appearance: getConstructionAppearance(biomeKey, structures.length, heraldry),
            },
            { overlap: true }
          )
        )
          throw new Error('The castle gatehouse arch does not fit');
        const gate = part(keepX, gateZ, 'Keep Gatehouse', {
          lengthFeet: gateLength,
          widthFeet: gateDepth,
          heightFeet: 20,
          baseFeet: 10,
          roof: 'battlement',
          windowSides: ['north', 'south'],
        });
        const watch = part(
          keepX - keepLength / 2 + 12.5,
          keepZ - keepWidth / 2 - 12.5,
          'Northern Watch',
          {
            lengthFeet: 25,
            widthFeet: 25,
            heightFeet: Math.min(100, keepHeight + 10),
            roof: 'battlement',
            windowSides: ['north', 'east', 'west'],
          }
        );
        joins.push(
          { sourceIndex: west, targetIndex: mainIndex },
          { sourceIndex: east, targetIndex: mainIndex },
          { sourceIndex: westCourt, targetIndex: west },
          { sourceIndex: eastCourt, targetIndex: east },
          { sourceIndex: gate, targetIndex: westCourt },
          { sourceIndex: gate, targetIndex: eastCourt },
          { sourceIndex: watch, targetIndex: mainIndex }
        );
      } else {
        for (const [side, title, height] of [
          [-1, 'Keep West Wing', 20],
          [1, 'Keep East Hall', 30],
        ]) {
          const index = part(keepX + side * (keepLength / 2 + 10), keepZ, title, {
            lengthFeet: 20,
            widthFeet: Math.min(keepWidth, 20),
            heightFeet: Math.min(height, keepHeight - 10),
            building: {
              version: 3,
              roof: 'gable',
              roofRiseFeet: 5,
              levels: [{ id: 0, elevationFeet: 0, openings: [] }],
              nextLevelId: 1,
              stairs: false,
            },
            windowSides: side < 0 ? ['north', 'south', 'west'] : ['north', 'south', 'east'],
          });
          joins.push({ sourceIndex: index, targetIndex: mainIndex });
        }
      }
    }
    const sideLength = Math.hypot(courtDepth, (frontSpan - span) / 2);
    const eastAngle = Math.atan2(courtDepth, (frontSpan - span) / 2);
    const eastStairs = grand && family !== 'bailey' && architecture() > 0.35;
    for (const [index, x, z, angle, length] of [
      [0, cx, cz - courtDepth / 2, 0, span],
      [1, cx - (span + frontSpan) / 4, cz, Math.PI - eastAngle, sideLength],
      [2, cx + (span + frontSpan) / 4, cz, eastAngle, sideLength],
      [3, cx, cz + courtDepth / 2, 0, frontSpan],
    ]) {
      const stairs = (index === 0 || (eastStairs && index === 2)) && length >= 60;
      const input = {
        kind: 'wall',
        xFeet: x,
        zFeet: z,
        lengthFeet: length,
        widthFeet: wallWidth,
        heightFeet: wallHeight,
        diameterFeet: 30,
        angleRadians: angle,
        baseFeet: 0,
        style: 'battlement',
        ruined,
        name: index === 3 ? 'Royal Gate' : `${['North', 'West', 'East'][index]} Curtain`,
        appearance: getConstructionAppearance(biomeKey, 1, heraldry),
        opening: index === 3,
        ...(index === 3
          ? {
              openingWidthFeet: grand ? choose([10, 12.5, 15]) : 7.5,
              openingHeightFeet: Math.min(grand ? choose([10, 12, 14]) : 8, wallHeight - 1),
              openingShape: 'arch',
            }
          : {}),
        ...(stairs
          ? {
              wallStairs: true,
              wallStairVersion: 2,
              wallStairLayout: 'auto',
              wallStairSide: 'far',
              wallStairOffsetFeet: Math.max(0, (length - (wallHeight <= 10 ? 45 : 55)) / 2),
            }
          : {}),
      };
      if (index === 2 && stairs) input.wallStairSide = 'far';
      place(input, { overlap: true });
    }
    const radius = grand ? choose([30, 35, 40]) : biomeKey === 'castle' && !medium ? 25 : 30;
    const chosenOuterHeight = grand ? choose([20, 30, 40]) : choose([20, 30]);
    const outerHeight =
      biomeKey === 'castle' && !grand && !medium
        ? Math.min(chosenOuterHeight, keepHeight - 10)
        : chosenOuterHeight;
    for (const xSign of [-1, 1])
      for (const zSign of [-1, 1]) {
        if (!grand && !medium && zSign < 0) continue;
        const angle = zSign < 0 ? 0 : Math.PI;
        place(
          building(
            'turret',
            cx + xSign * ((zSign < 0 ? span : frontSpan) / 2 - 12.5),
            cz + (zSign * courtDepth) / 2,
            {
              diameterFeet: radius,
              heightFeet: outerHeight,
              roof: 'battlement',
              angleRadians: angle,
              name: `${zSign < 0 ? 'North' : 'South'} ${xSign < 0 ? 'West' : 'East'} Bastion`,
              variant: 0,
            }
          ),
          { overlap: true }
        );
      }
    if (grand) {
      const innerCount =
        biomeKey === 'castle' ? 0 : family === 'citadel' ? 4 : family === 'palace' ? 2 : 0;
      const innerHeight = choose([30, 40, 50]);
      const innerSides = [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ].slice(0, innerCount);
      for (const [xSign, zSign] of innerSides)
        place(
          building(
            'turret',
            keepX + xSign * (keepLength / 2 + 20),
            keepZ + zSign * (keepWidth / 2 + 15),
            {
              diameterFeet: 30,
              heightFeet: innerHeight,
              roof: 'conical',
              roofRiseFeet: 10,
              angleRadians: xSign > 0 ? Math.PI / 2 : -Math.PI / 2,
              name: `${zSign < 0 ? 'Upper' : 'Lower'} ${xSign < 0 ? 'West' : 'East'} Bailey Tower`,
              variant: 3,
            }
          )
        );
      if (biomeKey !== 'castle' && (family !== 'bailey' || architecture() > 0.4))
        place(
          building('building', cx, cz + courtDepth / 2, {
            lengthFeet: choose([40, 45, 50]),
            widthFeet: 20,
            heightFeet: choose([20, 30]),
            baseFeet: wallHeight,
            roof: 'gable',
            roofRiseFeet: 8,
            name: 'Royal Gatehouse',
            variant: 0,
            building: {
              roof: ruined ? 'none' : 'gable',
              roofRiseFeet: 8,
              windows: ['east', 'west'].map((side) => ({
                id: `walkway-${side}`,
                floor: 0,
                side,
                u: 0.5,
                widthFeet: 8,
                heightFeet: 8,
                sillFeet: 0.5,
              })),
            },
          }),
          { overlap: true }
        );
      const target =
        family === 'bailey'
          ? choose([2, 3, 4])
          : family === 'palace'
            ? choose([1, 2, 3])
            : choose([0, 1]);
      let outbuildings = 0;
      const lots = [
        [-1, -1, 'Guardhouse'],
        [-1, 1, 'Barracks'],
        [1, 1, 'Great Hall'],
        [1, -1, 'Chapel'],
      ];
      for (const [xSign, zSign, name] of lots) {
        if (outbuildings >= target) break;
        const x = cx + xSign * (Math.min(span, frontSpan) / 2 - 22.5),
          z = cz + zSign * (courtDepth * 0.26);
        const hall = building('building', x, z, {
          lengthFeet: choose([25, 30]),
          widthFeet: 20,
          heightFeet: choose([10, 20]),
          angleRadians: xSign > 0 ? Math.PI / 2 : -Math.PI / 2,
          roof: choose(['gable', 'hipped']),
          name,
          variant: name === 'Chapel' ? 2 : 1,
        });
        if (place(hall)) outbuildings++;
      }
    }
    box(
      'garden',
      cx,
      cz,
      Math.min(width - 10, Math.max(span, frontSpan) + 70),
      Math.min(depth - 10, span + 70),
      -0.1,
      0,
      0x6b855c,
      'grass'
    );
    box(
      'plaza',
      cx,
      cz,
      Math.min(span, frontSpan) - wallWidth,
      courtDepth - wallWidth,
      -0.075,
      0,
      0xb2ad98,
      'paving'
    );
    road(
      [
        { x: cx, z: depth - 5 },
        { x: cx, z: cz + courtDepth / 2 },
        { x: keepX, z: keepZ + keepWidth / 2 + 5 },
      ],
      grand ? 15 : 10,
      0xb6b09b
    );
    if (biomeKey !== 'castle' && (grand || medium) && family === 'palace')
      fountain(keepX - keepLength / 2 - 18, cz - 5, true);
  }
  rubble();
  return { structures, volumes, ...(joins.length ? { joins } : {}) };
}
