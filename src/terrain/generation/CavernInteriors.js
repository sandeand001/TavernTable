import { CAVERN_BIOME_KEYS } from '../../config/biome/BiomeConstants.js';
import { TERRAIN_CONFIG } from '../../config/terrain/TerrainConstants.js';
import { createSeededRNG } from '../../utils/SeededRNG.js';
import { createStructure, structureVolumes } from '../ConstructionBlueprints.js';
import { getConstructionAppearance } from '../../config/biome/ConstructionPalettes.js';

export const CAVERN_SIDES = ['north', 'east', 'south', 'west'];
export const CAVERN_FLOOR_LEVEL = -8;
export const CAVERN_FLOOR_MAX_LEVEL = -5;

// -- Saved recipes --

export function normalizeCavernRecipe(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['version', 'kind', 'seed', 'exits'].includes(key)) ||
    ![1, 2, 3, 4, 5].includes(value.version) ||
    !['main', 'chamber', 'tunnel'].includes(value.kind) ||
    !Number.isInteger(value.seed) ||
    value.seed < 0 ||
    value.seed > 0xffffffff ||
    !Array.isArray(value.exits) ||
    value.exits.length > 4 ||
    new Set(value.exits).size !== value.exits.length ||
    value.exits.some((side) => !CAVERN_SIDES.includes(side))
  )
    throw new Error('The saved cavern interior recipe is invalid');
  return { version: value.version, kind: value.kind, seed: value.seed, exits: [...value.exits] };
}

export function oppositeCavernSide(side) {
  if (!CAVERN_SIDES.includes(side)) throw new Error('Choose a valid cavern entrance side');
  return CAVERN_SIDES[(CAVERN_SIDES.indexOf(side) + 2) % 4];
}

// -- Elevation sculpting --

export function createCavernInterior({
  biomeKey,
  seed,
  cols,
  rows,
  kind = 'main',
  exits = ['north', 'east'],
  feetPerLevel = 1.5,
  recipeVersion = 5,
}) {
  if (
    !CAVERN_BIOME_KEYS.includes(biomeKey) ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 5 ||
    rows < 5
  )
    throw new Error('Cavern interiors need an underground biome and at least a 5-square map');
  const cavern = normalizeCavernRecipe({ version: recipeVersion, kind, seed, exits });
  const candidates = [];
  const random = createSeededRNG((Math.imul(seed, 0x9e3779b1) ^ 0x48d1a52b) >>> 0, 347);
  const rooms = [
    [0.5, 0.5, 0.36, 0.34],
    [0.28, 0.31, 0.26, 0.23],
    [0.72, 0.32, 0.23, 0.26],
    [0.68, 0.72, 0.27, 0.23],
    [0.29, 0.7, 0.24, 0.26],
  ].map(([x, z, rx, rz], index) => ({
    x: index ? x + (random() - 0.5) * 0.06 : x,
    z: index ? z + (random() - 0.5) * 0.06 : z,
    rx: rx * (0.93 + random() * 0.14),
    rz: rz * (0.93 + random() * 0.14),
  }));
  let heights = Array.from({ length: rows }, (_, z) =>
    Array.from({ length: cols }, (_, x) => {
      const px = (x + 0.5) / cols,
        pz = (z + 0.5) / rows;
      let distance;
      if (kind === 'tunnel') {
        const horizontal = cols >= rows;
        const along = horizontal ? px : pz,
          across = horizontal ? pz : px;
        const center = 0.5 + Math.sin(along * 7 + seed) * 0.12;
        distance = Math.abs(across - center) / (0.21 + Math.sin(along * 11 + seed) * 0.035);
      } else {
        distance = Math.min(
          ...rooms.map((room) => Math.hypot((px - room.x) / room.rx, (pz - room.z) / room.rz))
        );
        distance += Math.sin(x * 0.57 + z * 0.31 + seed) * 0.045;
      }
      const floor =
        CAVERN_FLOOR_LEVEL +
        Math.round(Math.sin(x * 0.19 + seed) * Math.cos(z * 0.17 - seed) * 0.7);
      const ridge = 8 + Math.round(Math.sin(x * 0.37 + seed) + Math.cos(z * 0.29 - seed));
      const level =
        x === 0 || z === 0 || x === cols - 1 || z === rows - 1
          ? ridge
          : distance <= 1
            ? floor
            : distance < 1.12
              ? -2 + Math.round((distance - 1) * 70)
              : ridge;
      return Math.max(TERRAIN_CONFIG.MIN_HEIGHT, Math.min(TERRAIN_CONFIG.MAX_HEIGHT, level));
    })
  );
  if (kind !== 'tunnel' && recipeVersion < 5) {
    const positions = [
      [0.31, 0.34],
      [0.72, recipeVersion === 2 ? 0.4 : 0.3],
      [0.43, 0.73],
      [0.7, 0.7],
    ];
    const count = Math.min(positions.length, Math.max(1, Math.floor(Math.min(cols, rows) / 8)));
    for (let i = 0; i < count; i++) {
      const cx = Math.floor(cols * (positions[i][0] + (random() - 0.5) * 0.06)),
        cz = Math.floor(rows * (positions[i][1] + (random() - 0.5) * 0.06));
      if (heights[cz][cx] > CAVERN_FLOOR_MAX_LEVEL) continue;
      const radius = Math.min(3.5, Math.max(1.4, Math.min(cols, rows) / 10)),
        peak = 5 + Math.floor(random() * 5);
      if (recipeVersion >= 3) {
        candidates.push({ cx, cz, peak });
        continue;
      }
      for (
        let z = Math.max(1, Math.floor(cz - radius));
        z < Math.min(rows - 1, cz + radius + 1);
        z++
      )
        for (
          let x = Math.max(1, Math.floor(cx - radius));
          x < Math.min(cols - 1, cx + radius + 1);
          x++
        ) {
          const distance = Math.hypot((x - cx) / radius, (z - cz) / (radius * 0.8));
          if (distance >= 1) continue;
          heights[z][x] = Math.max(
            heights[z][x],
            Math.round(
              CAVERN_FLOOR_LEVEL + (peak - CAVERN_FLOOR_LEVEL) * Math.pow(1 - distance, 0.55)
            )
          );
        }
    }
  }
  for (
    let z = Math.max(1, Math.floor(rows / 2) - 1);
    z <= Math.min(rows - 2, Math.floor(rows / 2) + 1);
    z++
  )
    for (
      let x = Math.max(1, Math.floor(cols / 2) - 1);
      x <= Math.min(cols - 2, Math.floor(cols / 2) + 1);
      x++
    )
      heights[z][x] = CAVERN_FLOOR_LEVEL;
  for (const side of exits) heights = sculptCavernPassage(heights, side);
  const reserved = new Set(
    exits.flatMap((side) => cavernPassageCells(side, cols, rows).map(({ x, z }) => `${x}:${z}`))
  );
  const formationsRandom = createSeededRNG(seed, 839);
  const structures = candidates
    .filter(({ cx, cz }) => {
      for (let z = Math.max(0, cz - 2); z <= Math.min(rows - 1, cz + 2); z++)
        for (let x = Math.max(0, cx - 2); x <= Math.min(cols - 1, cx + 2); x++)
          if (reserved.has(`${x}:${z}`)) return false;
      return heights[cz][cx] <= CAVERN_FLOOR_MAX_LEVEL;
    })
    .map(({ cx, cz, peak }, index) => {
      const heightFeet = Math.min(
        60,
        Math.max(
          18,
          (peak - heights[cz][cx]) *
            feetPerLevel *
            (recipeVersion >= 4 ? 0.85 + formationsRandom() * 0.4 : 1)
        )
      );
      return createStructure({
        id: `generated-${biomeKey}-${seed}-stalagmite-${index + 1}`,
        name: `Cavern Stalagmite ${index + 1}`,
        kind: 'stalagmite',
        source: 'generated',
        xFeet: (cx + 0.5) * 5,
        zFeet: (cz + 0.5) * 5,
        baseFeet: heights[cz][cx] * feetPerLevel,
        heightFeet,
        diameterFeet:
          recipeVersion >= 4
            ? Math.round(heightFeet * (0.18 + formationsRandom() * 0.06) * 2) / 2
            : 15,
        rockProfileVersion: recipeVersion >= 4 ? 2 : 1,
        appearance: getConstructionAppearance(
          biomeKey,
          recipeVersion >= 4 ? index + 2 : 2,
          seed % 4
        ),
      });
    });
  return {
    heights,
    cavern,
    geometry: structures.length
      ? { version: 3, structures, volumes: structures.flatMap(structureVolumes) }
      : { version: 1, volumes: [] },
  };
}

export function cavernPassageCells(side, cols, rows) {
  if (
    !CAVERN_SIDES.includes(side) ||
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 5 ||
    rows < 5
  )
    throw new Error('Choose a valid cavern passage side and map dimensions');
  const cx = Math.floor(cols / 2),
    cz = Math.floor(rows / 2);
  const half = Math.min(1, Math.floor((Math.min(cols, rows) - 3) / 4));
  const cells = [];
  for (let z = 0; z < rows; z++)
    for (let x = 0; x < cols; x++)
      if (
        {
          north: Math.abs(x - cx) <= half && z <= cz + 1,
          east: Math.abs(z - cz) <= half && x >= cx - 1,
          south: Math.abs(x - cx) <= half && z >= cz - 1,
          west: Math.abs(z - cz) <= half && x <= cx + 1,
        }[side]
      )
        cells.push({ x, z });
  return cells;
}

export function sculptCavernPassage(heights, side) {
  const result = heights.map((row) => [...row]);
  for (const { x, z } of cavernPassageCells(side, result[0].length, result.length))
    result[z][x] = CAVERN_FLOOR_LEVEL;
  return result;
}

export function cavernEndpoint(side, width, depth) {
  if (!CAVERN_SIDES.includes(side)) throw new Error('Choose a valid cavern entrance side');
  const [x, z] = {
    north: [width / 2, 2.5],
    east: [width - 2.5, depth / 2],
    south: [width / 2, depth - 2.5],
    west: [2.5, depth / 2],
  }[side];
  return { x, y: 0, z };
}

// -- Rock palette --

export function cavernRockColor(key) {
  const color = {
    cavern: 0x716b60,
    fungalGrove: 0x62705b,
    crystalFields: 0x657187,
    crystalSpires: 0x626c87,
    eldritchRift: 0x725e79,
  }[key];
  if (color === undefined) throw new Error('Choose an underground biome for cavern rock');
  return color;
}

export function getCavernSurfaceColor(x, z, y, span) {
  const base = span.materialColor ?? 0x716b60;
  const shade =
    0.87 + Math.sin(x * 0.23 + z * 0.31) * 0.055 + Math.sin(y * 0.41 + z * 0.17 - x * 0.13) * 0.055;
  const channel = (shift) => Math.min(255, Math.round(((base >> shift) & 255) * shade));
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}
