import { getConstructionAppearance } from '../../config/biome/ConstructionPalettes.js';
import { DUNGEON_ROOM_COUNT } from '../../config/biome/BiomeConstants.js';
import { createStructure } from '../ConstructionBlueprints.js';
import { createSeededRNG, hash32 } from '../../utils/SeededRNG.js';

const MIN_ROOM_CELLS = DUNGEON_ROOM_COUNT.minimumSide;
const CORRIDOR_CELLS = DUNGEON_ROOM_COUNT.corridorWidth;
const ROOM_NAMES = ['Guard', 'Holding Cell', 'Storage', 'Vault', 'Crypt', 'Old Chamber'];

const rectangle = (x0, z0, x1, z1) => ({ x0, z0, x1, z1 });
const roomCapacity = ({ x0, z0, x1, z1 }) =>
  Math.floor((x1 - x0) / MIN_ROOM_CELLS) * Math.floor((z1 - z0) / MIN_ROOM_CELLS);

function chooseCorridors(cols, rows, roomCount, random) {
  const choices = new Map();
  let maximum = 0;
  const consider = (kind, wings, corridors, swap) => {
    const capacity = wings.reduce((total, wing) => total + roomCapacity(wing), 0);
    maximum = Math.max(maximum, capacity);
    if (roomCount < wings.length || roomCount > capacity) return;
    const current = choices.get(kind) || { seen: 0, selected: null };
    current.seen++;
    if (Math.floor(random() * current.seen) === 0)
      current.selected = { kind, wings, corridors, swap };
    choices.set(kind, current);
  };
  for (const swap of [false, true]) {
    const width = swap ? rows : cols;
    const depth = swap ? cols : rows;
    for (let split = MIN_ROOM_CELLS; split <= width - CORRIDOR_CELLS - MIN_ROOM_CELLS; split++) {
      const after = split + CORRIDOR_CELLS;
      const main = rectangle(split, 0, after, depth);
      const left = rectangle(0, 0, split, depth);
      const right = rectangle(after, 0, width, depth);
      consider('straight', [left, right], [main], swap);
      for (let bend = MIN_ROOM_CELLS; bend <= depth - CORRIDOR_CELLS - MIN_ROOM_CELLS; bend++) {
        const below = bend + CORRIDOR_CELLS;
        const leftTop = rectangle(0, 0, split, bend);
        const leftBottom = rectangle(0, below, split, depth);
        const rightTop = rectangle(after, 0, width, bend);
        const rightBottom = rectangle(after, below, width, depth);
        const leftBranch = rectangle(0, bend, split, below);
        const rightBranch = rectangle(after, bend, width, below);
        consider('tee-left', [leftTop, leftBottom, right], [main, leftBranch], swap);
        consider('tee-right', [left, rightTop, rightBottom], [main, rightBranch], swap);
        consider(
          'cross',
          [leftTop, leftBottom, rightTop, rightBottom],
          [main, leftBranch, rightBranch],
          swap
        );
      }
    }
  }
  if (!choices.size)
    throw new RangeError(
      `This grid fits at most ${maximum} rooms; choose a larger grid or fewer rooms.`
    );
  const options = [...choices.values()].map(({ selected }) => selected);
  const selected = options[Math.floor(random() * options.length)];
  const orient = (area) =>
    selected.swap ? rectangle(area.z0, area.x0, area.z1, area.x1) : { ...area };
  return {
    kind: selected.kind,
    wings: selected.wings.map(orient),
    corridors: selected.corridors.map(orient),
  };
}

function divisions(start, end) {
  const count = Math.floor((end - start) / MIN_ROOM_CELLS);
  return Array.from(
    { length: count + 1 },
    (_, index) => start + Math.floor(((end - start) * index) / count)
  );
}

function partitionWing(wing, count, random) {
  const xs = divisions(wing.x0, wing.x1);
  const zs = divisions(wing.z0, wing.z1);
  const rooms = [];
  const divide = (x0, z0, x1, z1, needed) => {
    if (needed === 1) {
      rooms.push(rectangle(xs[x0], zs[z0], xs[x1], zs[z1]));
      return;
    }
    let best = null;
    const consider = (axis, cut, capacityA, capacityB, areaA, areaB) => {
      const minimum = Math.max(1, needed - capacityB);
      const maximum = Math.min(needed - 1, capacityA);
      for (let first = minimum; first <= maximum; first++) {
        const balance = Math.abs(Math.log(areaA / first / (areaB / (needed - first))));
        const score = balance * 0.6 + random();
        if (!best || score < best.score) best = { axis, cut, first, score };
      }
    };
    for (let cut = x0 + 1; cut < x1; cut++)
      consider(
        'x',
        cut,
        (cut - x0) * (z1 - z0),
        (x1 - cut) * (z1 - z0),
        (xs[cut] - xs[x0]) * (zs[z1] - zs[z0]),
        (xs[x1] - xs[cut]) * (zs[z1] - zs[z0])
      );
    for (let cut = z0 + 1; cut < z1; cut++)
      consider(
        'z',
        cut,
        (x1 - x0) * (cut - z0),
        (x1 - x0) * (z1 - cut),
        (xs[x1] - xs[x0]) * (zs[cut] - zs[z0]),
        (xs[x1] - xs[x0]) * (zs[z1] - zs[cut])
      );
    if (!best) throw new Error('The Dungeon rooms could not be partitioned on this grid');
    if (best.axis === 'x') {
      divide(x0, z0, best.cut, z1, best.first);
      divide(best.cut, z0, x1, z1, needed - best.first);
    } else {
      divide(x0, z0, x1, best.cut, best.first);
      divide(x0, best.cut, x1, z1, needed - best.first);
    }
  };
  divide(0, 0, xs.length - 1, zs.length - 1, count);
  return rooms;
}

function allocateRooms(wings, total, random) {
  const counts = wings.map(() => 1);
  for (let remaining = total - wings.length; remaining > 0; remaining--) {
    let selected = -1;
    let score = -Infinity;
    for (let index = 0; index < wings.length; index++) {
      if (counts[index] >= roomCapacity(wings[index])) continue;
      const wing = wings[index];
      const area = (wing.x1 - wing.x0) * (wing.z1 - wing.z0);
      const candidate = (area / (counts[index] + 1)) * (0.7 + random() * 0.6);
      if (candidate > score) {
        selected = index;
        score = candidate;
      }
    }
    if (selected < 0) throw new Error('The Dungeon room allocation exceeds its grid capacity');
    counts[selected]++;
  }
  return wings.flatMap((wing, index) => partitionWing(wing, counts[index], random));
}

function sharedBoundary(a, b) {
  if (a.x1 === b.x0 || b.x1 === a.x0) {
    const start = Math.max(a.z0, b.z0);
    const end = Math.min(a.z1, b.z1);
    if (start < end) return { axis: 'vertical', position: a.x1 === b.x0 ? a.x1 : b.x1, start, end };
  }
  if (a.z1 === b.z0 || b.z1 === a.z0) {
    const start = Math.max(a.x0, b.x0);
    const end = Math.min(a.x1, b.x1);
    if (start < end)
      return { axis: 'horizontal', position: a.z1 === b.z0 ? a.z1 : b.z1, start, end };
  }
  return null;
}

function singleRoomPlan(cols, rows, seed) {
  const side = hash32(`dungeon-single:${seed}`) % 4;
  if (side === 0)
    return {
      kind: 'single-west',
      wings: [rectangle(CORRIDOR_CELLS, 0, cols, rows)],
      corridors: [rectangle(0, 0, CORRIDOR_CELLS, rows)],
    };
  if (side === 1)
    return {
      kind: 'single-east',
      wings: [rectangle(0, 0, cols - CORRIDOR_CELLS, rows)],
      corridors: [rectangle(cols - CORRIDOR_CELLS, 0, cols, rows)],
    };
  if (side === 2)
    return {
      kind: 'single-north',
      wings: [rectangle(0, CORRIDOR_CELLS, cols, rows)],
      corridors: [rectangle(0, 0, cols, CORRIDOR_CELLS)],
    };
  return {
    kind: 'single-south',
    wings: [rectangle(0, 0, cols, rows - CORRIDOR_CELLS)],
    corridors: [rectangle(0, rows - CORRIDOR_CELLS, cols, rows)],
  };
}

function dungeonWallSignature(structures) {
  // Merge wall segments and ignore openings so a doorway-only change is not a new layout.
  const walls = structures
    .filter((spec) => spec.kind === 'wall' && spec.id.startsWith('generated-dungeon-'))
    .map((spec) => {
      const horizontal = spec.angleRadians === 0;
      const center = horizontal ? spec.xFeet : spec.zFeet;
      return {
        angle: spec.angleRadians,
        position: horizontal ? spec.zFeet : spec.xFeet,
        width: spec.widthFeet,
        start: center - spec.lengthFeet / 2,
        end: center + spec.lengthFeet / 2,
      };
    })
    .sort(
      (a, b) =>
        a.angle - b.angle ||
        a.position - b.position ||
        a.width - b.width ||
        a.start - b.start ||
        a.end - b.end
    );
  const lines = [];
  for (const wall of walls) {
    const previous = lines.at(-1);
    if (
      previous &&
      previous.angle === wall.angle &&
      previous.position === wall.position &&
      previous.width === wall.width &&
      wall.start <= previous.end + 1e-6
    )
      previous.end = Math.max(previous.end, wall.end);
    else lines.push({ ...wall });
  }
  return JSON.stringify(lines);
}

export function chooseDifferentDungeonSeed({
  cols,
  rows,
  roomCount,
  currentSeed,
  currentStructures,
  random = Math.random,
}) {
  if (
    !Number.isInteger(currentSeed) ||
    currentSeed < 0 ||
    currentSeed > 0xffffffff ||
    !Array.isArray(currentStructures) ||
    typeof random !== 'function'
  )
    throw new Error('Cycling Dungeon layouts requires the current seed and structures');
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1)
    throw new Error('A random Dungeon seed could not be selected');
  const initial = Math.floor(value * 0x100000000) >>> 0;
  const previous = dungeonWallSignature(currentStructures);
  for (let attempt = 0; attempt < 32; attempt++) {
    const seed = (initial + Math.imul(attempt, 0x9e3779b9)) >>> 0;
    if (seed === currentSeed) continue;
    const candidate = createDungeonLayout({ cols, rows, seed, roomCount });
    if (dungeonWallSignature(candidate.structures) !== previous) return seed;
  }
  throw new Error('Could not find a different Dungeon layout; try another grid or room count');
}

export function createDungeonLayout({
  cols,
  rows,
  seed,
  roomCount = DUNGEON_ROOM_COUNT.default,
  usedIds = [],
}) {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < DUNGEON_ROOM_COUNT.minimumGrid ||
    rows < DUNGEON_ROOM_COUNT.minimumGrid
  )
    throw new RangeError('A Dungeon layout needs a board of at least 12 by 12 squares');
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff)
    throw new RangeError('A Dungeon layout needs an unsigned 32-bit seed');
  if (
    !Number.isInteger(roomCount) ||
    roomCount < DUNGEON_ROOM_COUNT.min ||
    roomCount > DUNGEON_ROOM_COUNT.max
  )
    throw new RangeError('Dungeon room count must be between one and sixteen');
  const random = createSeededRNG(seed, 419);
  const plan =
    roomCount === 1
      ? singleRoomPlan(cols, rows, seed)
      : chooseCorridors(cols, rows, roomCount, random);
  const rooms = allocateRooms(plan.wings, roomCount, random);
  const corridors = plan.corridors;
  const units = [
    ...rooms.map((area, index) => ({ ...area, kind: 'room', index })),
    ...corridors.map((area, index) => ({ ...area, kind: 'corridor', index })),
  ];
  const parents = units.map((_, index) => index);
  const find = (index) => {
    while (parents[index] !== index) {
      parents[index] = parents[parents[index]];
      index = parents[index];
    }
    return index;
  };
  const join = (a, b) => {
    const first = find(a);
    const second = find(b);
    if (first === second) return false;
    parents[second] = first;
    return true;
  };
  const boundaries = [];
  for (let a = 0; a < units.length; a++)
    for (let b = a + 1; b < units.length; b++) {
      const boundary = sharedBoundary(units[a], units[b]);
      if (!boundary) continue;
      if (units[a].kind === 'corridor' && units[b].kind === 'corridor') {
        join(a, b);
        continue;
      }
      if (boundary.end - boundary.start < MIN_ROOM_CELLS)
        throw new Error('The Dungeon layout contains an entrance too narrow for a room');
      boundaries.push({ ...boundary, a, b, opening: false });
    }
  const shuffled = [...boundaries];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }
  for (const boundary of shuffled) if (join(boundary.a, boundary.b)) boundary.opening = true;
  if (units.some((_, index) => find(index) !== find(0)))
    throw new Error('The Dungeon rooms cannot be connected on this grid');
  for (const boundary of shuffled) if (!boundary.opening && random() < 0.2) boundary.opening = true;

  const used = new Set(usedIds);
  const structures = [];
  let serial = 0;
  const wall = (name, x1, z1, x2, z2, opening = false) => {
    let id;
    do {
      id = `generated-dungeon-${seed}-${++serial}`;
    } while (used.has(id));
    used.add(id);
    const lengthFeet = Math.hypot(x2 - x1, z2 - z1);
    structures.push(
      createStructure({
        id,
        kind: 'wall',
        source: 'generated',
        name,
        xFeet: (x1 + x2) / 2,
        zFeet: (z1 + z2) / 2,
        lengthFeet,
        widthFeet: 2,
        heightFeet: 10,
        angleRadians: Math.atan2(z2 - z1, x2 - x1),
        opening,
        ...(opening
          ? {
              openingWidthFeet: lengthFeet >= 12 ? 10 : Math.min(7.5, lengthFeet - 2),
              openingHeightFeet: 8,
            }
          : {}),
        appearance: {
          ...getConstructionAppearance('dungeon', serial),
          facadeModelKey: 'source-dungeon-wall',
        },
      })
    );
  };
  const width = cols * 5;
  const depth = rows * 5;
  for (const unit of units) {
    const open = (side) =>
      unit.kind === 'corridor' &&
      (side === 'West' || side === 'East'
        ? unit.z1 - unit.z0 === CORRIDOR_CELLS
        : unit.x1 - unit.x0 === CORRIDOR_CELLS);
    if (unit.x0 === 0)
      wall(
        `Dungeon West ${open('West') ? 'Entrance' : 'Wall'}`,
        1,
        Math.max(1, unit.z0 * 5),
        1,
        Math.min(depth - 1, unit.z1 * 5),
        open('West')
      );
    if (unit.x1 === cols)
      wall(
        `Dungeon East ${open('East') ? 'Entrance' : 'Wall'}`,
        width - 1,
        Math.max(1, unit.z0 * 5),
        width - 1,
        Math.min(depth - 1, unit.z1 * 5),
        open('East')
      );
    if (unit.z0 === 0)
      wall(
        `Dungeon North ${open('North') ? 'Entrance' : 'Wall'}`,
        Math.max(1, unit.x0 * 5),
        1,
        Math.min(width - 1, unit.x1 * 5),
        1,
        open('North')
      );
    if (unit.z1 === rows)
      wall(
        `Dungeon South ${open('South') ? 'Entrance' : 'Wall'}`,
        Math.max(1, unit.x0 * 5),
        depth - 1,
        Math.min(width - 1, unit.x1 * 5),
        depth - 1,
        open('South')
      );
  }
  for (const boundary of boundaries) {
    const room = units[boundary.a].kind === 'room' ? units[boundary.a] : units[boundary.b];
    const label = `${ROOM_NAMES[room.index % ROOM_NAMES.length]} ${Math.floor(room.index / ROOM_NAMES.length) + 1}`;
    const name = boundary.opening ? `${label} Room Doorway` : 'Dungeon Room Partition';
    const start = boundary.start * 5;
    const end = boundary.end * 5;
    const position = boundary.position * 5;
    if (boundary.axis === 'vertical') wall(name, position, start, position, end, boundary.opening);
    else wall(name, start, position, end, position, boundary.opening);
  }
  const placements = rooms.map((room) => ({
    generatedBiome: true,
    biomeKey: 'dungeon',
    biomeSeed: seed,
    type: 'plant',
    variantKey: 'source-dungeon-torch',
    modelKey: 'source-dungeon-torch',
    placeableId: 'source-dungeon-torch',
    gridX: room.x0 + 1,
    gridY: room.z0,
  }));
  return { structures, placements, rooms, corridors, corridorKind: plan.kind };
}
