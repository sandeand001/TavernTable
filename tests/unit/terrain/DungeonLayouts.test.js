import { getBiomeColorHex } from '../../../src/config/biome/BiomePalettes.js';
import { BIOME_FLORA_PROFILES } from '../../../src/config/terrain/FloraProfiles.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';
import {
  createDungeonLayout,
  chooseDifferentDungeonSeed,
} from '../../../src/terrain/generation/DungeonLayouts.js';
import { structureBounds } from '../../../src/terrain/ConstructionBlueprints.js';

test.each([
  [12, 12, 1, 7],
  [12, 12, 4, 42],
  [12, 12, 6, 13],
  [25, 25, 10, 7],
  [30, 20, 16, 42],
])(
  'a %i by %i Dungeon has exactly %i connected rooms and reaches every grid edge',
  (cols, rows, roomCount, seed) => {
    const layout = createDungeonLayout({ cols, rows, seed, roomCount });
    expect(layout.rooms).toHaveLength(roomCount);
    const engine = new TerrainEngine(cols, rows);
    engine.generateBiomeElevation('dungeon', { seed, dungeonRoomCount: roomCount });
    const bounds = engine.geometry.getStructures().map(structureBounds);
    expect(Math.min(...bounds.map(({ min }) => min.x))).toBe(0);
    expect(Math.min(...bounds.map(({ min }) => min.z))).toBe(0);
    expect(Math.max(...bounds.map(({ max }) => max.x))).toBe(cols * 5);
    expect(Math.max(...bounds.map(({ max }) => max.z))).toBe(rows * 5);
    const start = layout.corridors[0] || layout.rooms[0];
    const range = buildSurfaceRange({
      geometry: engine.geometry,
      start: {
        gridX: start.x0,
        gridY: Math.floor((start.z0 + start.z1 - 1) / 2),
        heightFeet: 0,
      },
      speedFeet: cols * rows * 5,
      bodyHeightFeet: 6,
    });
    for (const room of layout.rooms) {
      const x = Math.floor((room.x0 + room.x1 - 1) / 2);
      const y = Math.floor((room.z0 + room.z1 - 1) / 2);
      expect(getSurfaceRoute(range, x, y, { heightFeet: 0 })).not.toBeNull();
    }
    for (const [x, y] of [
      [0, 0],
      [cols - 1, 0],
      [0, rows - 1],
      [cols - 1, rows - 1],
    ])
      expect(getSurfaceRoute(range, x, y, { heightFeet: 0 })).not.toBeNull();
    expect(engine.generationRecipe.values.dungeonRoomCount).toBe(roomCount);
  }
);

test('Dungeon seeds vary actual room sizes and corridor topology while remaining repeatable', () => {
  const layouts = Array.from({ length: 16 }, (_, seed) =>
    createDungeonLayout({ cols: 25, rows: 25, seed, roomCount: 6 })
  );
  const fingerprint = ({ rooms, corridors }) => JSON.stringify({ rooms, corridors });
  expect(new Set(layouts.map(fingerprint)).size).toBeGreaterThanOrEqual(12);
  expect(new Set(layouts.map(({ corridorKind }) => corridorKind)).size).toBeGreaterThanOrEqual(2);
  expect(
    layouts.some(
      ({ rooms }) => new Set(rooms.map(({ x0, x1, z0, z1 }) => (x1 - x0) * (z1 - z0))).size > 1
    )
  ).toBe(true);
  expect(createDungeonLayout({ cols: 25, rows: 25, seed: 7, roomCount: 6 })).toEqual(layouts[7]);
});

test('single-room Dungeons can place their corridor on each side across seeds', () => {
  const kinds = new Set(
    Array.from(
      { length: 32 },
      (_, seed) => createDungeonLayout({ cols: 12, rows: 12, roomCount: 1, seed }).corridorKind
    )
  );
  expect(kinds.size).toBe(4);
});

test.each([
  [12, 12, 1],
  [12, 12, 6],
  [25, 25, 16],
])(
  'cycling a %i by %i Dungeon keeps %i rooms but changes real wall geometry',
  (cols, rows, roomCount) => {
    const first = createDungeonLayout({ cols, rows, roomCount, seed: 42 });
    const signature = (structures) =>
      JSON.stringify(
        structures
          .map(({ xFeet, zFeet, lengthFeet, angleRadians, opening, openingWidthFeet }) => [
            xFeet,
            zFeet,
            lengthFeet,
            angleRadians,
            opening,
            openingWidthFeet,
          ])
          .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
      );
    const nextSeed = chooseDifferentDungeonSeed({
      cols,
      rows,
      roomCount,
      currentSeed: 42,
      currentStructures: first.structures,
      random: () => 42 / 0x100000000,
    });
    const next = createDungeonLayout({ cols, rows, roomCount, seed: nextSeed });
    expect(next.rooms).toHaveLength(roomCount);
    expect(signature(next.structures)).not.toBe(signature(first.structures));
    expect(createDungeonLayout({ cols, rows, roomCount, seed: nextSeed })).toEqual(next);
  }
);

test('cycling does not count a doorway-only change as a different room layout', () => {
  const options = { cols: 12, rows: 12, roomCount: 6 };
  const current = createDungeonLayout({ ...options, seed: 0 });
  const doorOnly = createDungeonLayout({ ...options, seed: 2 });
  const wallLines = (layout) =>
    layout.structures
      .map(({ xFeet, zFeet, lengthFeet, widthFeet, angleRadians }) =>
        JSON.stringify([xFeet, zFeet, lengthFeet, widthFeet, angleRadians])
      )
      .sort();
  expect(wallLines(doorOnly)).toEqual(wallLines(current));
  const seed = chooseDifferentDungeonSeed({
    ...options,
    currentSeed: 0,
    currentStructures: current.structures,
    random: () => 2 / 0x100000000,
  });
  expect(wallLines(createDungeonLayout({ ...options, seed }))).not.toEqual(wallLines(current));
});

test.each([
  [12, 12, 6],
  [18, 14, 8],
  [25, 25, 16],
])(
  'several %i by %i Dungeon seeds cover the board and keep every room reachable',
  (cols, rows, roomCount) => {
    for (const seed of [0, 2, 7, 42]) {
      const layout = createDungeonLayout({ cols, rows, roomCount, seed });
      const cells = new Uint8Array(cols * rows);
      for (const area of [...layout.rooms, ...layout.corridors])
        for (let z = area.z0; z < area.z1; z++)
          for (let x = area.x0; x < area.x1; x++) cells[z * cols + x]++;
      expect([...cells].every((count) => count === 1)).toBe(true);
      const engine = new TerrainEngine(cols, rows);
      engine.generateBiomeElevation('dungeon', { seed, dungeonRoomCount: roomCount });
      const corridor = layout.corridors[0];
      const range = buildSurfaceRange({
        geometry: engine.geometry,
        start: {
          gridX: corridor.x0,
          gridY: Math.floor((corridor.z0 + corridor.z1 - 1) / 2),
          heightFeet: 0,
        },
        speedFeet: cols * rows * 5,
        bodyHeightFeet: 6,
      });
      for (const { gridX, gridY } of layout.placements)
        expect(getSurfaceRoute(range, gridX, gridY, { heightFeet: 0 })).not.toBeNull();
    }
  }
);

test('an impossible Dungeon room count fails without modifying the current board', () => {
  const engine = new TerrainEngine(12, 12);
  const before = engine.save();
  expect(() => engine.planBiomeGeneration('dungeon', { seed: 42, dungeonRoomCount: 16 })).toThrow(
    /rooms.*(?:larger grid|fewer rooms)/i
  );
  expect(engine.save()).toEqual(before);
  expect(() => engine.planBiomeGeneration('dungeon', { dungeonRoomCount: 0 })).toThrow(
    /room count/i
  );
});

test.each([
  [12, 12, 42],
  [25, 25, 42],
  [30, 20, 7],
])('Dungeon builds connected masonry rooms on a %i by %i board, seed %i', (cols, rows, seed) => {
  const engine = new TerrainEngine(cols, rows);
  engine.generateBiomeElevation('dungeon', { seed });
  const saved = engine.save();
  const walls = engine.geometry.getStructures();
  const doorways = walls.filter((wall) => wall.name.endsWith('Room Doorway'));
  expect(doorways.length).toBeGreaterThanOrEqual(4);
  expect(walls.every((wall) => wall.kind === 'wall' && wall.source === 'generated')).toBe(true);
  expect(walls.every((wall) => wall.appearance.wallMaterial === 'stone')).toBe(true);
  expect(walls.every((wall) => wall.appearance.facadeModelKey === 'source-dungeon-wall')).toBe(
    true
  );
  expect(new Set(saved.heights.flat())).toEqual(new Set([0]));
  expect(engine.cavern).toBeNull();

  const range = buildSurfaceRange({
    geometry: engine.geometry,
    start: { gridX: Math.floor(cols / 2), gridY: Math.floor(rows / 2), heightFeet: 0 },
    speedFeet: (cols + rows) * 10,
    bodyHeightFeet: 6,
  });
  for (const doorway of doorways) {
    expect(doorway.opening).toBe(true);
    expect(doorway.openingWidthFeet).toBeGreaterThanOrEqual(7.5);
    for (const direction of [-1, 1]) {
      const x = doorway.xFeet - direction * Math.sin(doorway.angleRadians) * 7.5;
      const z = doorway.zFeet + direction * Math.cos(doorway.angleRadians) * 7.5;
      expect(
        getSurfaceRoute(range, Math.floor(x / 5), Math.floor(z / 5), { heightFeet: 0 })
      ).not.toBeNull();
    }
  }

  const reopened = new TerrainEngine(1, 1);
  reopened.load(saved);
  expect(reopened.save()).toEqual(saved);
  engine.generateBiomeElevation('dungeon', { seed });
  expect(engine.save()).toEqual(saved);
});

test('Dungeon does not generate cave terrain or surface vegetation when structures are disabled', () => {
  const engine = new TerrainEngine(12, 12);
  engine.generateBiomeElevation('dungeon', { seed: 1, structures: false });
  expect(engine.geometry.getStructures()).toEqual([]);
  expect(engine.geometry.save().volumes).toEqual([]);
  expect(new Set(engine.save().heights.flat())).toEqual(new Set([0]));
  expect(BIOME_FLORA_PROFILES.find((profile) => profile.re.test('dungeon')).density).toBe(0);
  expect(getBiomeColorHex('dungeon', 0, 7, 9)).not.toBe(getBiomeColorHex('grassland', 0, 7, 9));
});

test.each([
  [12, 12, 42],
  [25, 25, 7],
  [30, 20, 42],
])('Dungeon plans supported room lights on a %i by %i board', (cols, rows, seed) => {
  const engine = new TerrainEngine(cols, rows);
  const plan = engine.planBiomeGeneration('dungeon', { seed, densityMultiplier: 0 });
  const torches = plan.placements.filter(({ modelKey }) => modelKey === 'source-dungeon-torch');
  expect(torches.length).toBeGreaterThanOrEqual(4);
  expect(new Set(torches.map(({ gridX, gridY }) => `${gridX}:${gridY}`)).size).toBe(torches.length);
  expect(engine.planBiomeGeneration('dungeon', { seed, densityMultiplier: 0 }).placements).toEqual(
    plan.placements
  );
  engine.generateBiomeElevation('dungeon', { seed, densityMultiplier: 0 });
  const range = buildSurfaceRange({
    geometry: engine.geometry,
    start: { gridX: Math.floor(cols / 2), gridY: Math.floor(rows / 2), heightFeet: 0 },
    speedFeet: (cols + rows) * 10,
    bodyHeightFeet: 6,
  });
  for (const torch of torches)
    expect(getSurfaceRoute(range, torch.gridX, torch.gridY, { heightFeet: 0 })).not.toBeNull();
  expect(engine.planBiomeGeneration('dungeon', { seed, structures: false }).placements).toEqual([]);
});

test('a Dungeon cannot partially overwrite an authored obstruction or generate on an undersized map', () => {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({
    id: 'authored-wall',
    kind: 'wall',
    xFeet: 25,
    zFeet: 55,
    lengthFeet: 10,
    widthFeet: 1,
  });
  const before = engine.save();
  expect(() => engine.generateBiomeElevation('dungeon', { seed: 42 })).toThrow(/authored|manual/i);
  expect(engine.save()).toEqual(before);

  const small = new TerrainEngine(10, 10);
  const original = small.save();
  expect(() => small.generateBiomeElevation('dungeon', { seed: 42 })).toThrow(/12/);
  expect(small.save()).toEqual(original);
});

test('Dungeon regeneration preserves compatible authored structures and replaces only generated walls', () => {
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({
    id: 'authored-wall',
    kind: 'wall',
    xFeet: 20,
    zFeet: 20,
    lengthFeet: 10,
    widthFeet: 1,
  });
  const manual = engine.geometry.getStructures()[0];
  engine.generateBiomeElevation('dungeon', { seed: 42 });
  expect(engine.geometry.getStructures()).toContainEqual(manual);
  engine.generateBiomeElevation('dungeon', { seed: 42, structures: false });
  expect(engine.geometry.getStructures()).toEqual([manual]);
});

test('the Dungeon generation budget does not count protected authored volumes', () => {
  const engine = new TerrainEngine(25, 25);
  for (let index = 0; index < 221; index++) {
    engine.geometry.addSolid({
      id: `authored-volume-${index}`,
      bounds: {
        min: { x: 10, y: 0, z: 10 },
        max: { x: 11, y: 1, z: 11 },
      },
    });
  }
  engine.generateBiomeElevation('dungeon', { seed: 42 });
  expect(
    engine.geometry.save().volumes.filter(({ id }) => id.startsWith('authored-volume-'))
  ).toHaveLength(221);
  expect(engine.geometry.getStructures().some(({ source }) => source === 'generated')).toBe(true);
});
