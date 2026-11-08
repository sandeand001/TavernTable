import { createStructure, structureBounds } from '../ConstructionBlueprints.js';
import {
  buildingDimensions,
  buildingLevels,
  buildingLevelHeight,
  buildingLocalToFeet,
  buildingStairs,
  structureDisplayName,
} from '../BuildingModel.js';
import { cellarConnectionFits } from '../CellarConnections.js';
import { getConstructionAppearance } from '../../config/biome/ConstructionPalettes.js';
import { createSeededRNG } from '../../utils/SeededRNG.js';

const EPSILON = 1e-6;

export function createCastleCellarLayout(
  keep,
  { biomeKey, seed, width, depth, heights, feetPerLevel, structures }
) {
  if (
    !keep?.building ||
    !['building', 'turret'].includes(keep.kind) ||
    !Array.isArray(heights) ||
    !Array.isArray(structures) ||
    !Number.isFinite(feetPerLevel) ||
    feetPerLevel < 0
  )
    throw new Error('Castle cellars require a keep and valid generated terrain');
  const size = buildingDimensions(keep),
    compact = Math.min(width, depth) < 180;
  const expansions = compact
    ? [[20, 10]]
    : [
        [40, 20],
        [30, 15],
        [20, 10],
      ];
  const exit = {
    x: -size.length / 2 + 5,
    z: keep.kind === 'turret' ? 0 : buildingStairs(keep).exit.z - size.width / 2,
  };
  for (const [extraLength, extraWidth] of expansions) {
    const lengthFeet = size.length + extraLength,
      widthFeet = size.width + extraWidth;
    const stairs = buildingStairs({ kind: 'cellar', lengthFeet, widthFeet });
    const stairPoints = [
      stairs.entry,
      stairs.exit,
      ...stairs.steps.flatMap((step) => [step.bounds.min, step.bounds.max]),
    ];
    for (const direction of [1, -1])
      for (const zOffset of [0, -5, 5, -extraWidth / 2, extraWidth / 2]) {
        const xOffset = (direction * extraLength) / 2,
          point = buildingLocalToFeet(keep, { x: xOffset, y: 0, z: zOffset });
        const access = {
          kind: 'stairs',
          structureId: keep.id,
          xFeet: exit.x - xOffset,
          zFeet: exit.z - zOffset,
        };
        const dx = lengthFeet / 2 + access.xFeet - stairs.exit.x,
          dz = widthFeet / 2 + access.zFeet - stairs.exit.z;
        if (
          stairPoints.some(
            (p) =>
              p.x + dx < 0.5 ||
              p.z + dz < 0.5 ||
              p.x + dx > lengthFeet - 0.5 ||
              p.z + dz > widthFeet - 0.5
          )
        )
          continue;
        const input = {
          kind: 'cellar',
          xFeet: point.x,
          zFeet: point.z,
          baseFeet: keep.baseFeet,
          angleRadians: keep.angleRadians,
          heightFeet: 20,
          lengthFeet,
          widthFeet,
          name: `${structureDisplayName(keep).slice(0, 72)} Cellars`,
          appearance: getConstructionAppearance(biomeKey, 2, seed % 4),
          building: {
            roof: 'none',
            autoWindows: false,
            stairs: true,
            access,
            cellarLayout: { version: 1, style: 'castle-dungeon', seed },
          },
        };
        const spec = createStructure({
          ...input,
          id: 'castle-cellar-preview',
          source: 'generated',
        });
        const bounds = structureBounds(spec);
        if (
          bounds.min.x < 5 - EPSILON ||
          bounds.min.z < 5 - EPSILON ||
          bounds.max.x > width - 5 + EPSILON ||
          bounds.max.z > depth - 5 + EPSILON ||
          !cellarConnectionFits(spec, keep) ||
          !isBuried(bounds, spec.baseFeet, heights, feetPerLevel) ||
          overlapsUndergroundStructure(bounds, spec, keep, structures)
        )
          continue;
        return input;
      }
  }
  throw new Error('The castle cellar and dungeon cannot fit safely beside the keep');
}

export function castleCellarFloorLabel(spec, floor) {
  if (spec.kind !== 'cellar' || !spec.building?.cellarLayout)
    throw new Error('Choose a castle cellar to label its underground floor');
  const levels = buildingLevels(spec),
    index = levels.findIndex((level) => level.id === floor);
  if (index < 0) throw new Error('The selected cellar level no longer exists');
  const depth = levels.length - 1 - index;
  return depth === 0 ? 'Storage cellar' : depth === 1 ? 'Dungeon' : `Dungeon ${depth}`;
}

export function createCastleCellarRooms(spec, floor, offsetX = 0, offsetZ = 0) {
  const label = castleCellarFloorLabel(spec, floor);
  if (label === 'Storage cellar') return [];
  const { length, width } = buildingDimensions(spec),
    corridorNorth = (width - 10) / 2,
    corridorSouth = (width + 10) / 2;
  const columns = Math.max(1, Math.min(3, Math.floor((length - 25) / 20))),
    span = (length - 26) / columns,
    heightFeet = Math.min(8, buildingLevelHeight(spec, floor) - 2);
  if (span < 12 || corridorNorth < 6)
    throw new Error('The dungeon needs room for a stair bay, corridor and usable chambers');
  const random = createSeededRNG(
    (spec.building.cellarLayout.seed ^ Math.imul(floor + 1, 0x9e3779b1)) >>> 0,
    313
  );
  const rooms = [];
  let serial = 0;
  const wall = (name, x, z, lengthFeet, angleRadians, opening = false) =>
    rooms.push(
      createStructure({
        id: `dungeon-wall-${floor}-${++serial}`,
        kind: 'wall',
        source: 'generated',
        name,
        xFeet: offsetX + x,
        zFeet: offsetZ + z,
        lengthFeet,
        widthFeet: 1,
        heightFeet,
        angleRadians,
        opening,
        ...(opening ? { openingWidthFeet: 10, openingHeightFeet: 7, openingShape: 'arch' } : {}),
        ...(spec.appearance ? { appearance: spec.appearance } : {}),
      })
    );
  for (const [row, edge, start, end] of [
    [0, corridorNorth, 1, corridorNorth],
    [1, corridorSouth, corridorSouth, width - 1],
  ])
    for (let column = 0; column < columns; column++) {
      const x = 25 + column * span,
        index = row * columns + column;
      const name =
        index === 0
          ? 'Guard chamber'
          : index === 1
            ? 'Holding cell'
            : `${['Dungeon cell', 'Storage vault', 'Old chamber'][Math.floor(random() * 3)]} ${index}`;
      wall(`${name} Doorway`, x + span / 2, edge, span, 0, true);
      if (column) wall(`${name} Partition`, x, (start + end) / 2, end - start, Math.PI / 2);
    }
  return rooms;
}

function isBuried(bounds, ceilingFeet, heights, feetPerLevel) {
  for (
    let z = Math.floor((bounds.min.z + EPSILON) / 5);
    z < Math.ceil((bounds.max.z - EPSILON) / 5);
    z++
  )
    for (
      let x = Math.floor((bounds.min.x + EPSILON) / 5);
      x < Math.ceil((bounds.max.x - EPSILON) / 5);
      x++
    )
      if (heights[z][x] * feetPerLevel + EPSILON < ceilingFeet) return false;
  return true;
}

function overlapsUndergroundStructure(bounds, cellar, keep, structures) {
  const bottom = cellar.baseFeet - cellar.heightFeet + 0.5,
    ceiling = cellar.baseFeet - 0.5;
  return structures.some((spec) => {
    if (spec.id === keep.id) return false;
    const other = structureBounds(spec);
    return (
      other.min.x < bounds.max.x - EPSILON &&
      other.max.x > bounds.min.x + EPSILON &&
      other.min.z < bounds.max.z - EPSILON &&
      other.max.z > bounds.min.z + EPSILON &&
      other.min.y < ceiling - EPSILON &&
      other.max.y > bottom + EPSILON
    );
  });
}
