import { createStructure, structureBounds, structureVolumes } from '../ConstructionBlueprints.js';
import { createSeededRNG } from '../../utils/SeededRNG.js';
import { SETTLEMENT_BIOME_KEYS } from '../../config/biome/BiomeConstants.js';
import {
  getBiomeStructureBudget,
  getSettlementProfile,
} from '../../config/biome/SettlementProfiles.js';
import { getConstructionAppearance } from '../../config/biome/ConstructionPalettes.js';
import { buildingLevels, createWindowLayout } from '../BuildingModel.js';
import { createSettlementLayout } from './SettlementLayouts.js';
import { createCastleSiteLayout } from './CastleSites.js';

const LANDMARK_BIOMES = new Set([
  'grassland',
  'hills',
  'forestTemperate',
  'forestConifer',
  'deadForest',
  'desertHot',
  'desertCold',
  'sandDunes',
  'oasis',
  'savanna',
  'steppe',
  'orchard',
  'thornscrub',
  'tundra',
  'coast',
]);
const CAVE_BIOMES = new Set([
  'hills',
  'mountain',
  'alpine',
  'cedarHighlands',
  'cavern',
  'fungalGrove',
  'crystalFields',
  'volcanic',
]);
const intersects = (a, b) =>
  a.min.x < b.max.x + 2.5 &&
  a.max.x > b.min.x - 2.5 &&
  a.min.z < b.max.z + 2.5 &&
  a.max.z > b.min.z - 2.5;
const snap = (value) => Math.round(value / 2.5) * 2.5;

function houseProfile(ruined, heightFeet, roof, balcony = false, windowSeed = 0) {
  if (ruined) {
    const levels = Array.from({ length: heightFeet / 10 }, (_, id) => ({
      id,
      elevationFeet: id * 10,
      openings: id ? [{ id: 'collapse', xFeet: 0, zFeet: 0, lengthFeet: 10, widthFeet: 10 }] : [],
    }));
    return {
      version: 3,
      roof: 'none',
      levels,
      nextLevelId: levels.length,
      windowLayout: createWindowLayout('residential', undefined, windowSeed),
    };
  }
  return {
    roof,
    windowLayout: createWindowLayout('residential', undefined, windowSeed),
    balconies: balcony
      ? [{ id: 'front', floor: 1, side: 'south', u: 0.5, widthFeet: 10, depthFeet: 5 }]
      : [],
  };
}

export function generateBiomeStructures({
  biomeKey,
  seed,
  heights,
  previousHeights,
  geometry,
  feetPerLevel,
  enabled = true,
}) {
  const rows = heights.length,
    cols = heights[0].length;
  const width = cols * 5,
    depth = rows * 5;
  const budget = getBiomeStructureBudget(biomeKey),
    settlement = getSettlementProfile(biomeKey);
  const preserved = (geometry.structures || []).filter((spec) => spec.source === 'manual');
  const protectedVolumes = geometry.volumes.filter((volume) =>
    volume.structureId
      ? preserved.some((spec) => spec.id === volume.structureId)
      : volume.source !== 'generated'
  );
  const protectedBounds = protectedVolumes
    .filter((v) => v.operation === 'add')
    .map((v) => v.bounds);
  const next = heights.map((row) => [...row]);
  const cellsIn = (bounds) => {
    const result = [];
    for (
      let z = Math.max(0, Math.floor(bounds.min.z / 5));
      z < Math.min(rows, Math.ceil(bounds.max.z / 5));
      z++
    )
      for (
        let x = Math.max(0, Math.floor(bounds.min.x / 5));
        x < Math.min(cols, Math.ceil(bounds.max.x / 5));
        x++
      )
        result.push([x, z]);
    return result;
  };
  for (const bounds of protectedBounds)
    for (const [x, z] of cellsIn(bounds)) next[z][x] = previousHeights[z][x];
  const structures = [];
  const siteVolumes = [];
  let floorMaps = 0;
  const occupied = [];
  const random = createSeededRNG((Math.imul(seed, 0x85ebca6b) ^ 0xc2b2ae35) >>> 0, 157);
  const used = new Set(preserved.map((spec) => spec.id));
  let serial = 0;
  const propose = (kind, x, z, extra = {}) => {
    const gx = Math.max(0, Math.min(cols - 1, Math.floor(x / 5)));
    const gz = Math.max(0, Math.min(rows - 1, Math.floor(z / 5)));
    const level =
      extra.baseFeet !== undefined
        ? feetPerLevel > 0
          ? extra.baseFeet / feetPerLevel
          : 0
        : SETTLEMENT_BIOME_KEYS.includes(biomeKey)
          ? 0
          : next[gz][gx];
    let id;
    do {
      id = `generated-${biomeKey}-${seed}-${settlement?.site ? 'ridge-' : ''}${++serial}`;
    } while (used.has(id));
    const spec = createStructure({
      id,
      kind,
      xFeet: x,
      zFeet: z,
      baseFeet: level * feetPerLevel,
      source: 'generated',
      ...(['building', 'turret', 'wall'].includes(kind)
        ? { appearance: getConstructionAppearance(biomeKey, serial) }
        : {}),
      ...extra,
    });
    const bounds = structureBounds(spec);
    return { spec, bounds };
  };
  const fits = ({ spec, bounds }, overlap) => {
    const margin = spec.building ? 5 : 2.5;
    return (
      bounds.min.x >= margin - 1e-6 &&
      bounds.min.z >= margin - 1e-6 &&
      bounds.max.x <= width - margin + 1e-6 &&
      bounds.max.z <= depth - margin + 1e-6 &&
      !protectedBounds.some((other) => intersects(bounds, other)) &&
      (overlap || !occupied.some((other) => intersects(bounds, other)))
    );
  };
  const append = (proposals, { overlap = false, ground = 'flat' } = {}) => {
    const addedFloors = proposals.reduce(
      (sum, p) => sum + (p.spec.building ? buildingLevels(p.spec).length : 0),
      0
    );
    if (
      structures.length + proposals.length > budget.structures ||
      floorMaps + addedFloors > budget.floorMaps ||
      !proposals.every((p) => fits(p, overlap))
    )
      return false;
    for (const { spec, bounds } of proposals) {
      const level = feetPerLevel > 0 ? spec.baseFeet / feetPerLevel : 0;
      if (ground !== 'keep')
        for (const [x, z] of cellsIn(bounds))
          next[z][x] = ground === 'raise' ? Math.max(next[z][x], level) : level;
      structures.push(spec);
      occupied.push(bounds);
      used.add(spec.id);
    }
    floorMaps += addedFloors;
    return true;
  };
  const frame = (angle, limit = Infinity) => {
    const cosine = Math.cos(angle),
      sine = Math.sin(angle),
      turned = Math.abs(sine) > 0.5;
    return {
      width: Math.min(turned ? depth : width, limit),
      depth: Math.min(turned ? width : depth, limit),
      point: (x, z) => ({
        x: snap(width / 2 + x * cosine - z * sine),
        z: snap(depth / 2 + x * sine + z * cosine),
      }),
    };
  };
  const settlements = () => {
    const layout = (settlement.site ? createCastleSiteLayout : createSettlementLayout)({
      biomeKey,
      seed,
      width,
      depth,
      feetPerLevel,
    });
    for (const input of layout.structures) {
      const { kind, xFeet, zFeet, ...extra } = input;
      const proposal = propose(kind, xFeet, zFeet, extra);
      append([proposal], {
        overlap: settlement.kind !== 'town',
        ground: proposal.spec.baseFeet > 0 ? 'keep' : 'flat',
      });
    }
    for (const volume of layout.volumes)
      if (!protectedBounds.some((other) => intersects(volume.bounds, other)))
        siteVolumes.push(volume);
  };
  const caves = () => {
    const angle = (Math.floor(random() * 4) * Math.PI) / 2,
      layout = frame(angle, 100);
    const diameterFeet = Math.min(
      30,
      Math.max(20, Math.round(Math.min(layout.width, layout.depth) / 15) * 5)
    );
    const first = {
      x: snap(layout.width * 0.3) - layout.width / 2,
      z: snap(layout.depth * 0.3) - layout.depth / 2,
    };
    const second = { x: snap(layout.width * 0.7) - layout.width / 2, z: first.z };
    const third = { x: second.x, z: snap(layout.depth * 0.7) - layout.depth / 2 };
    const mouth = { x: first.x, z: -layout.depth / 2 + 5 };
    const landing = layout.point(mouth.x, mouth.z - 2.5);
    const level = next[Math.floor(landing.z / 5)][Math.floor(landing.x / 5)];
    const baseFeet = level * feetPerLevel,
      proposals = [];
    const add = (kind, point, extra) => {
      const p = layout.point(point.x, point.z);
      proposals.push(
        propose(kind, p.x, p.z, {
          baseFeet,
          ...extra,
          angleRadians: angle + (extra.angleRadians || 0),
        })
      );
    };
    add('cave', first, { diameterFeet, heightFeet: 15, angleRadians: Math.PI });
    add('cave', second, { diameterFeet: Math.max(20, diameterFeet - 5), heightFeet: 15 });
    add('cave', third, { diameterFeet, heightFeet: 15, angleRadians: Math.PI });
    for (const [a, b] of [
      [first, second],
      [second, third],
      [mouth, first],
    ])
      add(
        'tunnel',
        { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 },
        {
          lengthFeet: Math.hypot(b.x - a.x, b.z - a.z),
          widthFeet: 15,
          heightFeet: 10,
          angleRadians: Math.atan2(b.z - a.z, b.x - a.x),
        }
      );
    const corners = [
      layout.point(mouth.x - 7.5, mouth.z - 5),
      layout.point(mouth.x + 7.5, mouth.z),
    ];
    const pad = {
      min: { x: Math.min(...corners.map((p) => p.x)), z: Math.min(...corners.map((p) => p.z)) },
      max: { x: Math.max(...corners.map((p) => p.x)), z: Math.max(...corners.map((p) => p.z)) },
    };
    if (
      !protectedBounds.some((bounds) => intersects(pad, bounds)) &&
      append(proposals, { overlap: true, ground: 'raise' })
    )
      for (const [x, z] of cellsIn(pad)) next[z][x] = level;
  };
  const landmark = () => {
    const roll = random();
    if (roll >= 0.42) return;
    const ruined = biomeKey === 'deadForest' || roll < 0.26;
    const fortified = ruined && width >= 100 && depth >= 100 && random() < 0.35;
    const angle = (Math.floor(random() * 4) * Math.PI) / 2;
    const roof = /desert|Dunes|oasis|savanna|steppe|thornscrub/i.test(biomeKey) ? 'flat' : 'gable';
    for (let attempt = 0; attempt < 12; attempt++) {
      const x = snap(15 + random() * (width - 30)),
        z = snap(15 + random() * (depth - 30));
      const proposals = fortified
        ? [
            propose('wall', x, z, {
              lengthFeet: 35,
              widthFeet: 10,
              heightFeet: 10,
              style: 'battlement',
              ruined: true,
              angleRadians: angle,
            }),
            propose('turret', x + 25 * Math.cos(angle), z + 25 * Math.sin(angle), {
              diameterFeet: 30,
              heightFeet: 20,
              ruined: true,
              angleRadians: angle,
              building: { removedWindows: ['f0-west-0', 'f1-west-0'] },
            }),
          ]
        : [
            propose('building', x, z, {
              lengthFeet: 25,
              widthFeet: 20,
              heightFeet: 10,
              ruined,
              angleRadians: angle,
              building: houseProfile(ruined, 10, roof, false, seed),
            }),
          ];
      if (!proposals.every((p) => fits(p, true))) continue;
      // Preserve the water-adjacent planting band beyond the structure exclusion margin.
      if (
        ['oasis', 'coast'].includes(biomeKey) &&
        proposals.some(({ bounds }) =>
          cellsIn({
            min: { x: bounds.min.x - 7.5, z: bounds.min.z - 7.5 },
            max: { x: bounds.max.x + 7.5, z: bounds.max.z + 7.5 },
          }).some(([cx, cz]) => next[cz][cx] <= 0)
        )
      )
        continue;
      const levels = proposals.flatMap(({ bounds }) =>
        cellsIn(bounds).map(([cx, cz]) => next[cz][cx])
      );
      const low = Math.min(...levels),
        high = Math.max(...levels);
      if (low < 0 || (high - low) * feetPerLevel > 5) continue;
      const baseFeet = Math.round((low + high) / 2) * feetPerLevel;
      const based = proposals.map(({ spec }) => {
        const moved = { ...spec, baseFeet };
        return { spec: moved, bounds: structureBounds(moved) };
      });
      if (append(based, { overlap: true })) return;
    }
  };
  if (enabled && width >= 60 && depth >= 60) {
    if (settlement) settlements();
    else if (CAVE_BIOMES.has(biomeKey)) caves();
    else if (LANDMARK_BIOMES.has(biomeKey)) landmark();
    else if (biomeKey === 'graveyard')
      append([
        propose('dome', width * 0.5, depth * 0.5, {
          diameterFeet: 25,
          heightFeet: 10,
          ruined: true,
        }),
      ]);
  }
  const generated = [...siteVolumes, ...structures.flatMap(structureVolumes)];
  // Joined cave shells are a union of solids minus a union of rooms and bores.
  if (structures.some((spec) => spec.kind === 'cave'))
    generated.sort(
      (a, b) => Number(a.operation === 'subtract') - Number(b.operation === 'subtract')
    );
  if (generated.length > budget.volumes)
    throw new Error('Generated structures exceed the map geometry budget');
  return {
    heights: next,
    geometry: {
      version: 3,
      structures: [...preserved, ...structures],
      volumes: [...protectedVolumes, ...generated],
    },
  };
}
