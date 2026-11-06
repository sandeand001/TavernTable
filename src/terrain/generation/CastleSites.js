import { createSeededRNG } from '../../utils/SeededRNG.js';
import { getSettlementProfile } from '../../config/biome/SettlementProfiles.js';
import {
  getConstructionAppearance,
  getConstructionPalette,
} from '../../config/biome/ConstructionPalettes.js';
import { createWindowLayout, BUILDING_SIDES } from '../BuildingModel.js';
import { wallStairLayout } from '../WallStairs.js';

const snap = (value) => Math.round(value / 5) * 5;
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const cross = (a, b) => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});

function rockFaces(vertices) {
  const faces = new Map();
  for (let i = 0; i < vertices.length - 2; i++)
    for (let j = i + 1; j < vertices.length - 1; j++)
      for (let k = j + 1; k < vertices.length; k++) {
        let normal = cross(sub(vertices[j], vertices[i]), sub(vertices[k], vertices[i]));
        const length = Math.hypot(normal.x, normal.y, normal.z);
        if (length < 1e-8) continue;
        normal = { x: normal.x / length, y: normal.y / length, z: normal.z / length };
        let distance = dot(normal, vertices[i]);
        const offsets = vertices.map((p) => dot(normal, p) - distance);
        if (Math.min(...offsets) < -1e-6 && Math.max(...offsets) > 1e-6) continue;
        if (Math.max(...offsets) > 1e-6) {
          normal = { x: -normal.x, y: -normal.y, z: -normal.z };
          distance = -distance;
        }
        const key = [normal.x, normal.y, normal.z, distance]
          .map((v) => Math.round(v * 1e6))
          .join(',');
        if (faces.has(key)) continue;
        const indices = vertices
          .map((p, index) => ({ p, index }))
          .filter(({ p }) => Math.abs(dot(normal, p) - distance) < 1e-6);
        const centre = indices.reduce(
          (c, { p }) => ({
            x: c.x + p.x / indices.length,
            y: c.y + p.y / indices.length,
            z: c.z + p.z / indices.length,
          }),
          { x: 0, y: 0, z: 0 }
        );
        let u = cross(
          normal,
          Math.abs(normal.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
        );
        const magnitude = Math.hypot(u.x, u.y, u.z);
        u = { x: u.x / magnitude, y: u.y / magnitude, z: u.z / magnitude };
        const v = cross(normal, u);
        indices.sort((a, b) => {
          const pa = sub(a.p, centre),
            pb = sub(b.p, centre);
          return Math.atan2(dot(v, pa), dot(u, pa)) - Math.atan2(dot(v, pb), dot(u, pb));
        });
        faces.set(
          key,
          indices.map(({ index }) => index)
        );
      }
  return [...faces.values()];
}

function siteFrame(key, seed, width, depth) {
  const site = getSettlementProfile(key)?.site;
  if (!['cliff', 'mountain'].includes(site))
    throw new Error('Choose a supported terrain castle site');
  const random = createSeededRNG((Math.imul(seed, 0x27d4eb2d) ^ 0xb5297a4d) >>> 0, 251);
  const quarter = Math.floor(random() * 4),
    w = quarter % 2 ? depth : width,
    d = quarter % 2 ? width : depth;
  const scale = Math.min(w, d) / 300;
  return {
    site,
    width: w,
    depth: d,
    quarter,
    random,
    scale,
    x: (value) => snap(w / 2 + (value - 150) * scale),
    z: (value) => snap(d / 2 + (value - 150) * scale),
    point(x, z) {
      const [rx, rz] = [
        [x - w / 2, z - d / 2],
        [-(z - d / 2), x - w / 2],
        [-(x - w / 2), -(z - d / 2)],
        [z - d / 2, -(x - w / 2)],
      ][quarter];
      return { x: width / 2 + rx, z: depth / 2 + rz };
    },
    local(x, z) {
      const px = x - width / 2,
        pz = z - depth / 2;
      const [rx, rz] = [
        [px, pz],
        [pz, -px],
        [-px, -pz],
        [-pz, px],
      ][quarter];
      return { x: w / 2 + rx, z: d / 2 + rz };
    },
    design(x, z) {
      return { x: 150 + (x - w / 2) / scale, z: 150 + (z - d / 2) / scale };
    },
  };
}

export function generateCastleSiteHeights(key, rows, cols, { seed = 42 } = {}) {
  const frame = siteFrame(key, seed, cols * 5, rows * 5);
  return Array.from({ length: rows }, (_, z) =>
    Array.from({ length: cols }, (_, x) => {
      const local = frame.local(x * 5 + 2.5, z * 5 + 2.5),
        p = frame.design(local.x, local.z);
      const mainland = 276 + Math.sin(p.x * 0.035 + seed) * 4;
      if (p.z >= mainland) return 0;
      if (frame.site === 'cliff') {
        const halfWidth = 38 + Math.sin(((p.z - 40) / 185) * Math.PI) * 18;
        const centre = 145 + Math.sin(p.z * 0.022 + seed) * 5;
        if (p.z > 45 && p.z < 220 && Math.abs(p.x - centre) < halfWidth - 8) return 0;
      }
      return Math.max(
        -10,
        -10 + Math.round((Math.sin(p.x * 0.042 + seed) + Math.cos(p.z * 0.035 + seed)) * 0.5)
      );
    })
  );
}

function transformVolume(volume, frame) {
  const point = (p) => ({ ...frame.point(p.x, p.z), y: p.y }),
    { min, max } = volume.bounds;
  const corners = [
    point(min),
    point(max),
    point({ ...min, x: max.x }),
    point({ ...max, x: min.x }),
  ];
  const result = {
    ...volume,
    bounds: {
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
    },
  };
  if (volume.shape?.kind === 'polyhedron')
    result.shape = { ...volume.shape, vertices: volume.shape.vertices.map(point) };
  else if (volume.shape?.kind === 'prism')
    result.shape = {
      ...volume.shape,
      points: volume.shape.points.map((p) => frame.point(p.x, p.z)),
    };
  else if (volume.shape)
    result.shape = {
      ...volume.shape,
      center: point(volume.shape.center),
      yawRadians: (volume.shape.yawRadians ?? 0) + (frame.quarter * Math.PI) / 2,
    };
  return result;
}

export function createCastleSiteLayout({ biomeKey, seed, width, depth, feetPerLevel = 2.5 }) {
  if (Math.min(width, depth) < 100)
    throw new RangeError('Terrain-integrated castles need at least a 20 x 20 square map');
  if (!Number.isFinite(feetPerLevel) || feetPerLevel <= 0)
    throw new Error('Terrain-integrated castles require a positive terrain elevation scale');
  const frame = siteFrame(biomeKey, seed, width, depth),
    { x: X, z: Z, scale } = frame;
  const structures = [],
    volumes = [],
    palette = getConstructionPalette(biomeKey),
    random = frame.random;
  const choose = (values) => values[Math.floor(random() * values.length)];
  const large = Math.min(width, depth) >= 260,
    grand = Math.min(width, depth) >= 260;
  const floor = -11 * feetPerLevel;
  let serial = 0;
  const points = (outline) => outline.map(([x, z]) => ({ x: X(x), z: Z(z) }));
  const volume = (
    layer,
    bounds,
    operation = 'add',
    shape = null,
    role = 'rock',
    colour = palette.rock
  ) => {
    if (
      bounds.min.x < 0 ||
      bounds.min.z < 0 ||
      bounds.max.x > frame.width ||
      bounds.max.z > frame.depth
    )
      throw new Error('A terrain castle volume extends beyond its generated site');
    volumes.push({
      id: `site-${biomeKey}-${seed}-${++serial}`,
      layerId: layer,
      source: 'generated',
      operation,
      bounds,
      materialRole: role,
      materialStyle: role === 'paving' ? 'paving' : role === 'rock' ? 'rock' : 'stone',
      materialColor: colour,
      ...(shape ? { shape } : {}),
    });
  };
  const prism = (
    layer,
    polygon,
    bottom,
    top,
    operation = 'add',
    role = 'rock',
    colour = palette.rock
  ) => {
    volume(
      layer,
      {
        min: {
          x: Math.min(...polygon.map((p) => p.x)),
          y: bottom,
          z: Math.min(...polygon.map((p) => p.z)),
        },
        max: {
          x: Math.max(...polygon.map((p) => p.x)),
          y: top,
          z: Math.max(...polygon.map((p) => p.z)),
        },
      },
      operation,
      { kind: 'prism', points: polygon },
      role,
      colour
    );
  };
  const box = (
    layer,
    x,
    z,
    length,
    wide,
    bottom,
    top,
    operation = 'add',
    role = 'rock',
    colour = palette.rock
  ) =>
    volume(
      layer,
      {
        min: { x: x - length / 2, y: bottom, z: z - wide / 2 },
        max: { x: x + length / 2, y: top, z: z + wide / 2 },
      },
      operation,
      null,
      role,
      colour
    );
  const add = (kind, x, z, extra = {}) => {
    const angle = extra.angleRadians ?? 0;
    const sides =
      extra.windowSides ??
      (kind === 'turret'
        ? BUILDING_SIDES.filter((side) => {
            const [nx, nz] = { north: [0, -1], east: [1, 0], south: [0, 1], west: [-1, 0] }[side];
            const rx = nx * Math.cos(angle) - nz * Math.sin(angle),
              rz = nx * Math.sin(angle) + nz * Math.cos(angle);
            return rx * (X(150) - x) + rz * (Z(150) - z) > 1e-6;
          })
        : BUILDING_SIDES);
    const spec = {
      kind,
      xFeet: x,
      zFeet: z,
      baseFeet: extra.baseFeet ?? 0,
      angleRadians: angle,
      lengthFeet: extra.lengthFeet ?? 25,
      widthFeet: extra.widthFeet ?? 20,
      diameterFeet: extra.diameterFeet ?? 30,
      heightFeet: extra.heightFeet ?? 20,
      appearance: getConstructionAppearance(biomeKey, structures.length, seed % 4),
      ...extra,
      ...(['building', 'turret'].includes(kind)
        ? {
            building: {
              roof: extra.roof ?? 'battlement',
              ...(extra.building ?? {}),
              windowLayout: createWindowLayout(
                extra.windowStyle ?? 'fortress',
                sides,
                (seed ^ Math.imul(structures.length + 1, 0x9e3779b1)) >>> 0
              ),
            },
          }
        : {}),
    };
    for (const key of ['roof', 'windowSides', 'windowStyle']) delete spec[key];
    structures.push(spec);
    return spec;
  };
  const rockPeak = (cx, cz, rx, rz, height) => {
    const vertices = Array.from({ length: 8 }, (_, i) => {
      const radius = 0.86 + random() * 0.14;
      return {
        x: cx + rx * radius * Math.cos((i * Math.PI) / 4),
        y: floor,
        z: cz + rz * radius * Math.sin((i * Math.PI) / 4),
      };
    });
    vertices.push(
      { x: cx - rx * 0.74, y: height * 0.4, z: cz + rz * 0.05 },
      { x: cx + rx * 0.72, y: height * 0.45, z: cz + rz * 0.08 },
      { x: cx + rx * 0.05, y: height * 0.35, z: cz + rz * 0.72 },
      { x: cx - rx * 0.15, y: height * 0.48, z: cz - rz * 0.68 },
      { x: cx - rx * 0.1, y: height * 0.88, z: cz - rz * 0.2 },
      { x: cx + rx * 0.3, y: height, z: cz - rz * 0.08 },
      { x: cx - rx * 0.35, y: height * 0.77, z: cz + rz * 0.15 }
    );
    volume(
      'mountain',
      { min: { x: cx - rx, y: floor, z: cz - rz }, max: { x: cx + rx, y: height, z: cz + rz } },
      'add',
      { kind: 'polyhedron', vertices, faces: rockFaces(vertices) }
    );
  };
  const terrace = (outline, bottom, top) => {
    const polygon = points(outline);
    prism('excavation', polygon, top, 160, 'subtract');
    const centre = polygon.reduce(
      (c, p) => ({ x: c.x + p.x / polygon.length, z: c.z + p.z / polygon.length }),
      { x: 0, z: 0 }
    );
    const ring = (y, expansion) =>
      polygon.map((p) => ({
        x: Math.max(3, Math.min(frame.width - 3, centre.x + (p.x - centre.x) * expansion())),
        y,
        z: Math.max(3, Math.min(frame.depth - 3, centre.z + (p.z - centre.z) * expansion())),
      }));
    const vertices = [
      ...ring(bottom, () => 1.08 + random() * 0.08),
      ...ring(bottom + (top - bottom) * 0.55, () => 1.06 + random() * 0.1),
      ...polygon.map((p) => ({ ...p, y: top })),
    ];
    volume(
      'mountain',
      {
        min: {
          x: Math.min(...vertices.map((p) => p.x)),
          y: bottom,
          z: Math.min(...vertices.map((p) => p.z)),
        },
        max: {
          x: Math.max(...vertices.map((p) => p.x)),
          y: top,
          z: Math.max(...vertices.map((p) => p.z)),
        },
      },
      'add',
      { kind: 'polyhedron', vertices, faces: rockFaces(vertices) }
    );
    prism('plaza', polygon, top - 0.12, top, 'add', 'paving', palette.paving);
  };
  const passage = (x, z0, z1, base, wide = 12, high = 12) => {
    const start = Math.min(z0, z1),
      end = Math.max(z0, z1);
    volume(
      'excavation',
      {
        min: { x: x - wide / 2, y: base, z: start },
        max: { x: x + wide / 2, y: base + high, z: end },
      },
      'subtract',
      {
        kind: 'cylinder',
        axis: 'z',
        center: { x, y: base, z: (start + end) / 2 },
        radii: { x: wide / 2, y: high, z: (end - start) / 2 },
      }
    );
    box(
      'approach',
      x,
      (start + end) / 2,
      wide,
      end - start,
      base - 0.12,
      base,
      'add',
      'paving',
      palette.paving
    );
  };
  const bridge = (x, start, end, wide = 14) => {
    const length = end - start;
    box('bridge', x, (start + end) / 2, wide, length, floor, 0, 'add', 'masonry', palette.masonry);
    const count = Math.max(1, Math.floor(length / 25)),
      pitch = length / count;
    for (let i = 0; i < count; i++) {
      const z = start + (i + 0.5) * pitch,
        span = pitch - 5;
      volume(
        'bridge-arch',
        {
          min: { x: x - wide / 2 - 0.1, y: floor - 0.1, z: z - span / 2 },
          max: { x: x + wide / 2 + 0.1, y: -5, z: z + span / 2 },
        },
        'subtract',
        {
          kind: 'cylinder',
          axis: 'x',
          center: { x, y: floor, z },
          radii: { x: wide / 2 + 0.1, y: -floor - 5, z: span / 2 },
        }
      );
    }
    for (const sign of [-1, 1])
      box(
        'bridge-parapet',
        x + sign * (wide / 2 - 0.5),
        (start + end) / 2,
        1,
        length,
        0,
        2.5,
        'add',
        'masonry',
        palette.masonry
      );
  };
  const retainingStair = (name, cx, cz, base, rise) => {
    const spec = add('wall', cx, cz, {
      lengthFeet: rise > 10 ? 60 : 50,
      widthFeet: 8,
      heightFeet: rise,
      baseFeet: base,
      style: 'battlement',
      name,
      wallStairs: true,
      wallStairVersion: 2,
      wallStairLayout: 'auto',
      wallStairSide: 'far',
      wallStairOffsetFeet: 2.5,
      wallStairExit: 'terrace',
    });
    const corners = wallStairLayout(spec).steps.flatMap((step) => [
      step.bounds.min,
      step.bounds.max,
    ]);
    const minX = Math.min(...corners.map((p) => p.x)),
      maxX = Math.max(...corners.map((p) => p.x));
    const minZ = Math.min(...corners.map((p) => p.z)),
      maxZ = Math.max(...corners.map((p) => p.z));
    box(
      'excavation',
      cx + (minX + maxX) / 2,
      cz + (minZ + maxZ) / 2,
      maxX - minX + 8,
      maxZ - minZ + 1,
      base,
      base + rise + 6,
      'subtract'
    );
  };
  const curtain = (name, a, b, height, base = 0) => {
    const p = { x: X(a[0]), z: Z(a[1]) },
      q = { x: X(b[0]), z: Z(b[1]) };
    add('wall', (p.x + q.x) / 2, (p.z + q.z) / 2, {
      lengthFeet: Math.hypot(q.x - p.x, q.z - p.z),
      widthFeet: 8,
      heightFeet: height,
      baseFeet: base,
      angleRadians: Math.atan2(q.z - p.z, q.x - p.x),
      style: 'battlement',
      name,
    });
  };
  if (!large) {
    if (frame.site === 'cliff') {
      terrace(
        [
          [85, 60],
          [145, 35],
          [215, 75],
          [210, 190],
          [175, 220],
          [110, 220],
          [85, 170],
        ],
        floor,
        0
      );
      add('building', X(150), Z(130), {
        lengthFeet: 25,
        widthFeet: 20,
        heightFeet: 30,
        roof: 'hipped',
        name: 'Cliff High Keep',
      });
      add('wall', X(150), Z(205), {
        lengthFeet: 35,
        widthFeet: 8,
        heightFeet: 15,
        opening: true,
        openingWidthFeet: 7.5,
        openingHeightFeet: 8,
        openingShape: 'arch',
        style: 'battlement',
        name: 'Cliff Gate',
      });
      bridge(X(150), Z(210), Z(290), 12);
    } else {
      rockPeak(X(120), Z(80), 25, 25, 45);
      terrace(
        [
          [35, 35],
          [130, 20],
          [260, 45],
          [260, 245],
          [45, 245],
        ],
        floor,
        0
      );
      terrace(
        [
          [150, 55],
          [260, 55],
          [260, 165],
          [150, 165],
        ],
        0,
        10
      );
      retainingStair('Upper Rock Stair', X(185), Z(165), 0, 10);
      add('building', X(200), Z(100), {
        lengthFeet: 25,
        widthFeet: 20,
        heightFeet: 30,
        baseFeet: 10,
        roof: 'hipped',
        name: 'Mountain High Keep',
      });
      rockPeak(X(95), Z(90), Math.min(25, frame.width * 0.24), Math.min(30, frame.depth * 0.3), 40);
      add('building', X(95), Z(100), {
        lengthFeet: 25,
        widthFeet: 20,
        heightFeet: 20,
        roof: 'none',
        name: 'Stoneheart Great Hall',
        windowSides: [],
        building: {
          version: 3,
          levels: [{ id: 0, elevationFeet: 0, openings: [] }],
          nextLevelId: 1,
          stairs: false,
        },
      });
      passage(X(95), Z(100) + 8, Z(210), 0, 10, 12);
      add('wall', X(150), Z(240), {
        lengthFeet: 45,
        widthFeet: 8,
        heightFeet: 10,
        opening: true,
        openingWidthFeet: 7.5,
        openingHeightFeet: 8,
        openingShape: 'arch',
        style: 'battlement',
        name: 'Mountain Gate',
      });
      bridge(X(150), Z(243), Z(290), 12);
    }
  } else if (frame.site === 'cliff') {
    const spur = [
      [95, 65],
      [125, 40],
      [165, 45],
      [202, 80],
      [193, 150],
      [183, 200],
      [168, 222],
      [115, 222],
      [95, 190],
      [90, 125],
    ];
    terrace(spur, floor, 0);
    terrace(
      [
        [96, 85],
        [130, 50],
        [180, 70],
        [194, 120],
        [190, 160],
        [100, 160],
      ],
      0,
      10
    );
    terrace(
      [
        [88, 65],
        [145, 48],
        [183, 73],
        [187, 115],
        [85, 115],
      ],
      10,
      20
    );
    curtain('West Cliff Curtain', [111, 205], [96, 135], 25);
    curtain('West High Curtain', [96, 135], [110, 65], 30);
    curtain('North Crown Curtain', [110, 65], [170, 65], 35);
    curtain('East Cliff Curtain', [180, 85], [181, 195], 30);
    retainingStair('Lower Cliff Stair', X(145), Z(160), 0, 10);
    retainingStair('Crown Cliff Stair', X(145), Z(115), 10, 10);
    add('wall', X(145), Z(205), {
      lengthFeet: 65,
      widthFeet: 10,
      heightFeet: 20,
      opening: true,
      openingWidthFeet: 12,
      openingHeightFeet: 12,
      openingShape: 'arch',
      style: 'battlement',
      name: 'Cliff Gate',
    });
    add('turret', X(119), Z(202), {
      diameterFeet: 30,
      heightFeet: 30,
      name: 'West Gate Spire',
      angleRadians: Math.PI,
    });
    add('turret', X(172), Z(199), {
      diameterFeet: 30,
      heightFeet: 40,
      name: 'East Cliff Bastion',
      angleRadians: Math.PI,
    });
    add('building', X(145), Z(82), {
      lengthFeet: grand ? 40 : 30,
      widthFeet: 30,
      heightFeet: choose([40, 50, 60]),
      baseFeet: 20,
      roof: 'hipped',
      name: 'Stormwatch High Keep',
    });
    add('turret', X(105), Z(82), {
      diameterFeet: 25,
      heightFeet: 30,
      baseFeet: 20,
      roof: 'conical',
      name: 'Crown Watchtower',
      angleRadians: -Math.PI / 2,
    });
    add('building', X(161), Z(137), {
      lengthFeet: grand ? 35 : 25,
      widthFeet: 25,
      heightFeet: 20,
      baseFeet: 10,
      roof: 'gable',
      name: 'Cliff Great Hall',
    });
    bridge(X(145), Z(210), Z(290));
  } else {
    const summit = grand ? 45 : 30;
    rockPeak(X(145), Z(48), 55 * scale, 45 * scale, 75);
    rockPeak(X(88), Z(82), 45 * scale, 55 * scale, 55);
    terrace(
      [
        [62, 85],
        [105, 50],
        [195, 50],
        [242, 95],
        [247, 225],
        [220, 274],
        [80, 270],
        [58, 210],
      ],
      floor,
      0
    );
    terrace(
      [
        [80, 80],
        [115, 40],
        [190, 45],
        [225, 85],
        [230, 185],
        [76, 185],
      ],
      0,
      15
    );
    terrace(
      [
        [92, 50],
        [130, 30],
        [190, 43],
        [220, 90],
        [218, 135],
        [85, 135],
      ],
      15,
      30
    );
    if (grand)
      terrace(
        [
          [112, 45],
          [150, 32],
          [192, 50],
          [195, 85],
          [100, 85],
        ],
        30,
        45
      );
    rockPeak(X(187), Z(48), 24 * scale, 19 * scale, 70);
    rockPeak(X(90), Z(145), 22 * scale, 26 * scale, 34);
    rockPeak(X(150), Z(35), 65 * scale, 25 * scale, 105);
    rockPeak(X(75), Z(45), 30 * scale, 35 * scale, 65);
    terrace(
      [
        [190, 155],
        [223, 155],
        [225, 195],
        [190, 195],
      ],
      0,
      15
    );
    retainingStair('Lower Bailey Ascent', X(125), Z(185), 0, 15);
    retainingStair('Upper Bailey Ascent', X(175), Z(135), 15, 15);
    if (grand) retainingStair('Summit Ascent', X(128), Z(85), 30, 15);
    curtain('West Lower Rampart', [80, 265], [66, 210], 20);
    curtain('East Lower Rampart', [220, 265], [238, 210], 20);
    add('wall', X(150), Z(265), {
      lengthFeet: Math.min(150, frame.width - 30),
      widthFeet: 10,
      heightFeet: 20,
      opening: true,
      openingWidthFeet: 15,
      openingHeightFeet: 14,
      openingShape: 'arch',
      style: 'battlement',
      name: 'Mountain Gate',
    });
    add('turret', X(95), Z(260), {
      diameterFeet: 30,
      heightFeet: 30,
      name: 'West Mountain Bastion',
      angleRadians: Math.PI,
    });
    add('turret', X(205), Z(260), {
      diameterFeet: 30,
      heightFeet: 40,
      name: 'East Mountain Bastion',
      angleRadians: Math.PI,
    });
    add('building', X(101), Z(222), {
      lengthFeet: 25,
      widthFeet: 25,
      heightFeet: 20,
      roof: 'gable',
      name: 'Lower Guardhouse',
    });
    add('building', X(105), Z(158), {
      lengthFeet: 30,
      widthFeet: 25,
      heightFeet: 20,
      baseFeet: 15,
      roof: 'gable',
      name: 'Mountain Barracks',
    });
    add('turret', X(207), Z(175), {
      diameterFeet: 30,
      heightFeet: 30,
      baseFeet: 15,
      roof: 'battlement',
      name: 'East Terrace Watch',
      angleRadians: Math.PI / 2,
    });
    if (grand)
      add('building', X(180), Z(110), {
        lengthFeet: 35,
        widthFeet: 30,
        heightFeet: 20,
        baseFeet: 30,
        roof: 'gable',
        name: 'Upper Great Hall',
      });
    add('building', X(153), Z(grand ? 62 : 65), {
      lengthFeet: grand ? 35 : 25,
      widthFeet: 25,
      heightFeet: choose([40, 50]),
      baseFeet: summit,
      roof: 'hipped',
      name: 'Mountain High Keep',
      windowSides: ['south', 'east', 'west'],
    });
    const hallX = X(180),
      hallZ = Z(111),
      hallDepth = grand ? 35 : 25;
    add('building', hallX, hallZ, {
      lengthFeet: grand ? 45 : 30,
      widthFeet: hallDepth,
      heightFeet: 25,
      roof: 'none',
      name: 'Stoneheart Great Hall',
      windowSides: [],
      building: {
        version: 3,
        levels: [{ id: 0, elevationFeet: 0, openings: [] }],
        nextLevelId: 1,
        stairs: false,
      },
    });
    passage(hallX, hallZ + hallDepth / 2 - 2, Z(222), 0, grand ? 16 : 12, 12);
    add('building', X(120), Z(65), {
      lengthFeet: 30,
      widthFeet: 25,
      heightFeet: grand ? 20 : 10,
      baseFeet: 15,
      roof: 'none',
      name: 'Mountain Vault',
      windowSides: [],
      building: {
        version: 3,
        levels: [{ id: 0, elevationFeet: 0, openings: [] }],
        nextLevelId: 1,
        stairs: false,
      },
    });
    passage(X(120), Z(65) + 10, Z(170), 15, 12, 12);
    bridge(X(150), Z(269), Z(290));
  }
  return {
    structures: structures.map((spec) => {
      const p = frame.point(spec.xFeet, spec.zFeet);
      return {
        ...spec,
        xFeet: p.x,
        zFeet: p.z,
        angleRadians: spec.angleRadians + (frame.quarter * Math.PI) / 2,
      };
    }),
    volumes: volumes.map((entry) => transformVolume(entry, frame)),
  };
}
