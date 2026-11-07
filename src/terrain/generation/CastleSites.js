import { createSeededRNG } from '../../utils/SeededRNG.js';
import { getSettlementProfile } from '../../config/biome/SettlementProfiles.js';
import { TERRAIN_CONFIG } from '../../config/terrain/TerrainConstants.js';
import {
  getConstructionAppearance,
  getConstructionPalette,
} from '../../config/biome/ConstructionPalettes.js';
import { createWindowLayout, BUILDING_SIDES } from '../BuildingModel.js';
import { wallStairLayout } from '../WallStairs.js';

const snap = (value) => Math.round(value / 5) * 5;

function siteFrame(key, seed, width, depth) {
  const site = getSettlementProfile(key)?.site;
  if (!['cliff', 'mountain'].includes(site))
    throw new Error('Choose a supported terrain castle site');
  const random = createSeededRNG((Math.imul(seed, 0x27d4eb2d) ^ 0xb5297a4d) >>> 0, 251);
  const quarter = Math.floor(random() * 4),
    w = quarter % 2 ? depth : width,
    d = quarter % 2 ? width : depth,
    scale = Math.min(w, d) / 300;
  return {
    site,
    seed,
    width: w,
    depth: d,
    quarter,
    random,
    scale,
    compact: Math.min(w, d) < 180,
    x: (value) => snap(w / 2 + (value - 150) * scale),
    z: (value) => snap(d / 2 + (value - 150) * scale),
    size: (value, minimum = 15) => Math.max(minimum, snap(value * scale)),
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

function siteHeight(frame, x, z) {
  const { x: X, z: Z, seed, compact } = frame,
    p = frame.design(x, z);
  if (frame.site === 'cliff') {
    if (p.z >= 278 + Math.sin(p.x * 0.035 + seed) * 4) return compact ? 8 : 6;
    const edge = compact ? 260 : 245,
      east = edge + Math.sin(p.z * 0.041 + seed) * 5,
      south = edge + Math.sin(p.x * 0.038 + seed) * 5,
      west = 40 + Math.sin(p.z * 0.037 + seed) * 8;
    if (p.x <= east && p.z <= south && (p.x >= west || p.z < 135)) {
      if (compact) return 8;
      if (p.x < 60 || p.z < 35)
        return Math.min(10, 8 + Math.round(Math.sin(p.x * 0.035 + p.z * 0.025 + seed)));
      if (z < Z(135) - 4) return 10;
      if (z < Z(180) - 4) return 8;
      return 6;
    }
    return -10 + (p.x > east + 18 && p.z < 200 ? 1 : 0);
  }

  const ridgeX = 153 + Math.sin(p.z * 0.018 + seed) * 9;
  const distance = Math.hypot((p.x - ridgeX) / 147, (p.z - 25) / 235);
  const mass = Math.max(0, 1 - distance);
  let level = Math.round(
    -10 + 20 * Math.pow(mass, 0.8) + Math.sin(p.x * 0.08 + p.z * 0.035 + seed) * mass * 0.6
  );
  const keepSpine =
    compact &&
    x >= X(185) - frame.size(65, 25) / 2 &&
    x <= X(185) + frame.size(65, 25) / 2 &&
    z < Z(110) + frame.size(45, 20) / 2 - 5;
  if (x >= X(60) && x <= X(255) && z >= Z(compact ? 60 : 110) && z < Z(255) && !keepSpine)
    level = z < Z(180) - 4 ? -6 : -8;
  if (z >= Z(255)) level = -8;
  return Math.max(TERRAIN_CONFIG.MIN_HEIGHT, Math.min(TERRAIN_CONFIG.MAX_HEIGHT, level));
}

export function generateCastleSiteHeights(key, rows, cols, { seed = 42 } = {}) {
  const frame = siteFrame(key, seed, cols * 5, rows * 5);
  return Array.from({ length: rows }, (_, z) =>
    Array.from({ length: cols }, (_, x) => {
      const local = frame.local(x * 5 + 2.5, z * 5 + 2.5);
      return siteHeight(frame, local.x, local.z);
    })
  );
}

function transformVolume(volume, frame) {
  const { min, max } = volume.bounds;
  const corners = [
    frame.point(min.x, min.z),
    frame.point(max.x, max.z),
    frame.point(max.x, min.z),
    frame.point(min.x, max.z),
  ];
  return {
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
    ...(volume.shape
      ? {
          shape: {
            ...volume.shape,
            center: {
              ...frame.point(volume.shape.center.x, volume.shape.center.z),
              y: volume.shape.center.y,
            },
            yawRadians: (volume.shape.yawRadians ?? 0) + (frame.quarter * Math.PI) / 2,
          },
        }
      : {}),
  };
}

export function createCastleSiteLayout({ biomeKey, seed, width, depth, feetPerLevel = 2.5 }) {
  if (Math.min(width, depth) < 100)
    throw new RangeError('Terrain-integrated castles need at least a 20 x 20 square map');
  if (!Number.isFinite(feetPerLevel) || feetPerLevel <= 0)
    throw new Error('Terrain-integrated castles require a positive terrain elevation scale');
  const frame = siteFrame(biomeKey, seed, width, depth),
    { x: X, z: Z, size, compact } = frame,
    palette = getConstructionPalette(biomeKey),
    structures = [],
    volumes = [];
  const low = (frame.site === 'cliff' ? (compact ? 8 : 6) : -8) * feetPerLevel,
    middle = (frame.site === 'cliff' ? 8 : -6) * feetPerLevel,
    high = (frame.site === 'cliff' ? (compact ? 8 : 10) : -6) * feetPerLevel;
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
      baseFeet: low,
      angleRadians: angle,
      lengthFeet: size(30),
      widthFeet: size(25),
      diameterFeet: size(30),
      heightFeet: 30,
      appearance: getConstructionAppearance(biomeKey, structures.length, seed % 4),
      ...extra,
      ...(['building', 'turret'].includes(kind)
        ? {
            building: {
              roof: extra.roof ?? 'battlement',
              ...(extra.building ?? {}),
              windowLayout: createWindowLayout(
                'fortress',
                sides,
                (seed ^ Math.imul(structures.length + 1, 0x9e3779b1)) >>> 0
              ),
            },
          }
        : {}),
    };
    for (const key of ['roof', 'windowSides']) delete spec[key];
    structures.push(spec);
    return spec;
  };
  const wall = (name, a, b, base, top, opening = false, offsetZ = 0, offsetX = 0) => {
    const p = { x: X(a[0]), z: Z(a[1]) },
      q = { x: X(b[0]), z: Z(b[1]) };
    return add('wall', (p.x + q.x) / 2 + offsetX, (p.z + q.z) / 2 + offsetZ, {
      lengthFeet: Math.hypot(q.x - p.x, q.z - p.z),
      widthFeet: 8,
      heightFeet: top - base,
      baseFeet: base,
      angleRadians: Math.atan2(q.z - p.z, q.x - p.x),
      opening,
      openingWidthFeet: compact ? 7.5 : 12,
      openingHeightFeet: compact ? 8 : 12,
      openingShape: 'arch',
      style: 'battlement',
      name,
    });
  };
  const towerAt = (name, x, z, base, height, angle, diameterFeet) =>
    add('turret', x, z, {
      baseFeet: base,
      heightFeet: height,
      diameterFeet,
      angleRadians: angle,
      name,
      ...(diameterFeet < 25
        ? {
            building: {
              version: 3,
              levels: [{ id: 0, elevationFeet: 0, openings: [] }],
              nextLevelId: 1,
              stairs: false,
            },
          }
        : {}),
    });
  const tower = (name, x, z, base, height, angle = 0, diameter = 30) =>
    towerAt(name, X(x), Z(z), base, height, angle, size(diameter, compact ? 15 : 25));
  const keepTower = (name, keep, side, height) => {
    const diameter = size(25, 25),
      edge = keep.xFeet + (side * keep.lengthFeet) / 2,
      x = edge + side * (diameter / 2 + 2.5),
      z = keep.zFeet + keep.widthFeet / 2 - diameter / 2,
      mountain = frame.site === 'mountain';
    const spec = towerAt(name, x, z, keep.baseFeet, height, 0, diameter);
    add('wall', edge + side * 1.25, z, {
      lengthFeet: 5,
      widthFeet: 8,
      heightFeet: keep.heightFeet,
      baseFeet: keep.baseFeet,
      style: 'battlement',
      name: `${name} Join`,
    });
    if (mountain) passage(x, z + diameter / 2 - 2, Z(130), keep.baseFeet);
    return spec;
  };
  const stair = (name, x, z, base, top) =>
    add('wall', X(x), Z(z), {
      lengthFeet: top - base > 10 ? 60 : Math.ceil((top - base) / 1.25) * 5 + 10,
      widthFeet: 8,
      heightFeet: top - base,
      baseFeet: base,
      style: 'battlement',
      wallStairs: true,
      wallStairVersion: 2,
      wallStairLayout: 'auto',
      wallStairSide: 'far',
      wallStairOffsetFeet: 2.5,
      wallStairExit: 'terrace',
      name,
    });
  const volume = (layer, min, max, operation, role, shape) => {
    if (min.x < 0 || min.z < 0 || max.x > frame.width || max.z > frame.depth)
      throw new Error('A terrain castle volume extends beyond its generated site');
    volumes.push({
      id: `site-${biomeKey}-${seed}-${volumes.length + 1}`,
      layerId: layer,
      source: 'generated',
      operation,
      bounds: { min, max },
      materialRole: role,
      materialStyle: role === 'paving' ? 'paving' : 'stone',
      materialColor: role === 'paving' ? palette.paving : palette.masonry,
      ...(shape ? { shape } : {}),
    });
  };
  const clearStairGround = (spec) => {
    const layout = wallStairLayout(spec),
      corners = layout.steps.flatMap((step) => [step.bounds.min, step.bounds.max]);
    volume(
      'excavation',
      {
        x: spec.xFeet + Math.min(...corners.map((p) => p.x), layout.entry.x - 3) - 1,
        y: spec.baseFeet,
        z: spec.zFeet + Math.min(...corners.map((p) => p.z), layout.entry.z - 3) - 1,
      },
      {
        x: spec.xFeet + Math.max(...corners.map((p) => p.x), layout.entry.x + 3) + 1,
        y: spec.baseFeet + spec.heightFeet + 6,
        z: spec.zFeet + Math.max(...corners.map((p) => p.z), layout.entry.z + 3) + 1,
      },
      'subtract',
      'masonry'
    );
  };
  const passage = (x, start, end, base, wide = 12, height = 12) => {
    volume(
      'excavation',
      { x: x - wide / 2, y: base, z: start },
      { x: x + wide / 2, y: base + height, z: end },
      'subtract',
      'masonry',
      {
        kind: 'cylinder',
        axis: 'z',
        center: { x, y: base, z: (start + end) / 2 },
        radii: { x: wide / 2, y: height, z: (end - start) / 2 },
      }
    );
    volume(
      'approach',
      { x: x - wide / 2, y: base - 0.12, z: start },
      { x: x + wide / 2, y: base, z: end },
      'add',
      'paving'
    );
  };
  const bridge = (x, start, end, top) => {
    const halfWidth = compact ? 5 : 7,
      bottom = -11 * feetPerLevel,
      count = Math.max(1, Math.floor((end - start) / 25)),
      pitch = (end - start) / count;
    volume(
      'bridge',
      { x: x - halfWidth, y: bottom, z: start },
      { x: x + halfWidth, y: top, z: end },
      'add',
      'masonry'
    );
    for (let i = 0; i < count; i++) {
      const z = start + (i + 0.5) * pitch,
        span = pitch - 5;
      volume(
        'bridge-arch',
        { x: x - halfWidth - 0.1, y: bottom - 0.1, z: z - span / 2 },
        { x: x + halfWidth + 0.1, y: top - 5, z: z + span / 2 },
        'subtract',
        'masonry',
        {
          kind: 'cylinder',
          axis: 'x',
          center: { x, y: bottom, z },
          radii: { x: halfWidth + 0.1, y: top - bottom - 5, z: span / 2 },
        }
      );
    }
    for (const sign of [-1, 1])
      volume(
        'bridge-parapet',
        { x: x + sign * (halfWidth - 0.5) - 0.5, y: top, z: start },
        { x: x + sign * (halfWidth - 0.5) + 0.5, y: top + 2.5, z: end },
        'add',
        'masonry'
      );
  };

  if (frame.site === 'cliff') {
    const rampartTop = Math.max(low + 25, high + 15),
      sideOffset = compact ? 0 : 8;
    const gate = wall('Cliff Gate', [80, 220], [220, 220], low, rampartTop, true, 8);
    wall('West Cliff Curtain', [80, 60], [80, 220], low, rampartTop, false, 0, -sideOffset);
    wall('East Cliff Curtain', [220, 60], [220, 220], low, rampartTop, false, 0, sideOffset);
    wall('North Crown Curtain', [80, 60], [220, 60], high, rampartTop, false, -8);
    tower('West Gate Bastion', 80, 220, low, 40, compact ? -Math.PI / 2 : Math.PI);
    tower('East Gate Bastion', 220, 220, low, 40, compact ? Math.PI / 2 : Math.PI);
    tower('Northwest Crown Tower', 80, 60, high, 40, compact ? -Math.PI / 2 : 0);
    tower('Northeast Crown Tower', 220, 60, high, 30, compact ? Math.PI / 2 : 0);
    if (!compact) {
      const diameter = size(25, 25),
        offset = diameter / 2 + 7.5;
      towerAt('West Gate Spire', gate.xFeet - offset, Z(220), low, 30, Math.PI, diameter);
      towerAt('East Gate Spire', gate.xFeet + offset, Z(220), low, 40, Math.PI, diameter);
    }
    const keep = add('building', X(150), Z(95), {
      lengthFeet: size(60, 25),
      widthFeet: size(45, 20),
      heightFeet: compact ? 30 : 40,
      baseFeet: high,
      name: compact ? 'Cliff High Keep' : 'Stormwatch High Keep',
    });
    if (!compact) {
      keepTower('West Keep Tower', keep, -1, 50);
      keepTower('East Keep Tower', keep, 1, 40);
      add('building', X(165), Z(150), {
        lengthFeet: size(45, 30),
        widthFeet: size(30, 20),
        heightFeet: 20,
        baseFeet: middle,
        roof: 'gable',
        name: 'Cliff Great Hall',
      });
      add('building', X(90), Z(165), {
        lengthFeet: size(25, 20),
        widthFeet: size(25, 20),
        heightFeet: 20,
        baseFeet: middle,
        angleRadians: -Math.PI / 2,
        roof: 'gable',
        name: 'Bailey Chapel',
      });
      stair('Lower Cliff Stair', 150, 180, low, middle);
      stair('Crown Cliff Stair', 115, 135, middle, high);
    }
    bridge(X(150), Z(224), Z(286), low);
  } else {
    const rear = compact ? 70 : 145,
      rampartTop = Math.max(low + 25, high + 15),
      sideOffset = 8;
    const gate = wall('Mountain Gate', [75, 240], [235, 240], low, rampartTop, true, 8);
    wall('West Mountain Curtain', [75, rear], [75, 240], low, rampartTop, false, 0, -sideOffset);
    wall('East Mountain Curtain', [235, rear], [235, 240], low, rampartTop, false, 0, sideOffset);
    wall('Stoneheart Inner Gate', [75, rear], [235, rear], high, rampartTop, true, -8);
    tower('West Mountain Bastion', 75, 240, low, 30, Math.PI);
    tower('East Mountain Bastion', 235, 240, low, 40, Math.PI);
    tower('West Shoulder Tower', 75, rear, high, 30);
    tower('East Shoulder Tower', 235, rear, high, 30);
    if (!compact) {
      const diameter = size(25, 25),
        offset = diameter / 2 + 7.5;
      towerAt('West Gate Tower', gate.xFeet - offset, Z(240), low, 30, Math.PI, diameter);
      towerAt('East Gate Tower', gate.xFeet + offset, Z(240), low, 30, Math.PI, diameter);
    }
    const keep = add('building', X(compact ? 185 : 155), Z(compact ? 110 : 95), {
      lengthFeet: size(65, 25),
      widthFeet: size(45, 20),
      heightFeet: 30,
      baseFeet: high,
      windowSides: ['south', 'east', 'west'],
      name: 'Mountain High Keep',
    });
    if (!compact) {
      keepTower('West Mountain Keep Tower', keep, -1, 40);
      keepTower('East Mountain Keep Tower', keep, 1, 30);
      const hallX = X(100),
        hallZ = Z(50),
        hallDepth = size(35, 20),
        hallBase = low - 5;
      add('building', hallX, hallZ, {
        lengthFeet: size(40, 20),
        widthFeet: hallDepth,
        heightFeet: 20,
        baseFeet: hallBase,
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
      const descent = stair('Stoneheart Hall Descent', 100, 195, hallBase, low);
      descent.xFeet = hallX + descent.lengthFeet / 2;
      passage(hallX, hallZ + hallDepth / 2 - 2, descent.zFeet + 10, hallBase, 16, 8);
      clearStairGround(descent);
      add('building', X(200), Z(195), {
        lengthFeet: size(35, 25),
        widthFeet: size(25, 20),
        heightFeet: 20,
        baseFeet: low,
        roof: 'gable',
        name: 'Lower Bailey Barracks',
      });
    }
    stair('Stoneheart Bailey Ascent', compact ? 160 : 150, 180, low, high);
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
