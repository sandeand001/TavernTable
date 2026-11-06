import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { structureBounds } from '../../../src/terrain/ConstructionBlueprints.js';
import { buildingLocalToFeet } from '../../../src/terrain/BuildingModel.js';
import { wallStairLayout } from '../../../src/terrain/WallStairs.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';
import { ALL_BIOMES } from '../../../src/config/biome/BiomeConstants.js';
import { getBiomeColorHex } from '../../../src/config/biome/BiomePalettes.js';
import { getBiomeColor3DHex } from '../../../src/config/biome/BiomePalettes3D.js';
import { getConstructionPalette } from '../../../src/config/biome/ConstructionPalettes.js';
import { BIOME_FLORA_PROFILES } from '../../../src/config/terrain/FloraProfiles.js';
import { getBiomeStructureBudget } from '../../../src/config/biome/SettlementProfiles.js';

const SETTLEMENTS = ['town', 'city', 'castle', 'ruinedTown', 'ruinedUrban', 'ruinedCastle'];
const generate = (biomeKey, rows = 25, cols = 25, seed = 42) => {
  const engine = new TerrainEngine(cols, rows);
  engine.generateBiomeElevation(biomeKey, { seed });
  return engine;
};

function expectWalkable(geometry, x, z, y) {
  const radius = 2.49;
  expect({
    x,
    z,
    y,
    clear: geometry.isSpaceClear({
      min: { x: x - radius, y: y + 1e-4, z: z - radius },
      max: { x: x + radius, y: y + 6 - 1e-4, z: z + radius },
    }),
  }).toEqual({ x, z, y, clear: true });
  const support = geometry.findSupport(x, z, { belowFeet: y + 1e-4, clearanceFeet: 6 });
  expect({ x, z, height: support?.heightFeet }).toEqual({ x, z, height: expect.closeTo(y) });
}

function expectConnectedCaves(engine) {
  const structures = engine.geometry.getStructures();
  const caves = structures.filter((spec) => spec.kind === 'cave');
  const tunnels = structures.filter((spec) => spec.kind === 'tunnel');
  expect(caves.length).toBeGreaterThanOrEqual(3);
  expect(tunnels.length).toBeGreaterThanOrEqual(3);
  expect(new Set(structures.map((spec) => spec.baseFeet)).size).toBe(1);
  for (const spec of caves) expectWalkable(engine.geometry, spec.xFeet, spec.zFeet, spec.baseFeet);
  for (const spec of tunnels) {
    const count = Math.ceil(spec.lengthFeet / 2.5);
    for (let i = 0; i <= count; i++) {
      const along = -spec.lengthFeet / 2 + (i * spec.lengthFeet) / count;
      expectWalkable(
        engine.geometry,
        spec.xFeet + along * Math.cos(spec.angleRadians),
        spec.zFeet + along * Math.sin(spec.angleRadians),
        spec.baseFeet
      );
    }
  }
}

test.each(['ruinedTown', 'ruinedCastle'])(
  '%s is a real menu biome with its own terrain, masonry and sparse overgrowth',
  (key) => {
    expect(ALL_BIOMES.some((biome) => biome.key === key)).toBe(true);
    expect(getBiomeColorHex(key, 0, 7, 9)).not.toBe(getBiomeColorHex('grassland', 0, 7, 9));
    expect(getBiomeColor3DHex(key, 0, 7, 9)).not.toBe(getBiomeColor3DHex('grassland', 0, 7, 9));
    expect(getConstructionPalette(key).masonry).not.toBe(getConstructionPalette('town').masonry);
    const flora = BIOME_FLORA_PROFILES.find((profile) => profile.re.test(key));
    expect(flora?.density).toBeGreaterThan(0);
    expect(flora?.density).toBeLessThanOrEqual(0.04);
  }
);

test.each(SETTLEMENTS)(
  '%s keeps level foundations and streets even when structures are disabled',
  (key) => {
    const engine = new TerrainEngine(15, 20);
    engine.setStructureGeneration(false);
    engine.generateBiomeElevation(key, { seed: 42 });
    expect(engine.geometry.getStructures()).toEqual([]);
    expect(new Set(engine.save().heights.flat())).toEqual(new Set([0]));
  }
);

test.each(
  ['town', 'city', 'ruinedTown', 'ruinedUrban'].flatMap((key) => [
    [key, 25, 20],
    [key, 20, 25],
  ])
)(
  '%s on %i by %i tiles leaves connected circulation around its landmarks and clear door attachments',
  (key, rows, cols) => {
    const engine = generate(key, rows, cols),
      width = cols * 5,
      depth = rows * 5;
    const range = buildSurfaceRange({
      geometry: engine.geometry,
      start: { gridX: 0, gridY: 0, heightFeet: 0 },
      speedFeet: (width + depth) * 2,
      bodyHeightFeet: 6,
    });
    expect(getSurfaceRoute(range, cols - 1, rows - 1, { heightFeet: 0 })).not.toBeNull();
    const buildings = engine.geometry.getStructures();
    expect(buildings.length).toBeGreaterThanOrEqual(2);
    for (const spec of buildings) {
      expect(spec.building).toBeDefined();
      const span = spec.kind === 'turret' ? spec.diameterFeet : spec.widthFeet;
      const approach = buildingLocalToFeet(spec, { x: 0, y: 0, z: span / 2 + 2.5 });
      expectWalkable(engine.geometry, approach.x, approach.z, 0);
    }
  }
);

test('a city is denser than a town and reseeding changes the layout, not just generated IDs', () => {
  const town = generate('town'),
    city = generate('city');
  expect(city.geometry.getStructures().length).toBeGreaterThan(
    town.geometry.getStructures().length
  );
  const positions = (engine) =>
    engine.geometry
      .getStructures()
      .map(({ xFeet, zFeet, lengthFeet, widthFeet, heightFeet, building }) => [
        xFeet,
        zFeet,
        lengthFeet,
        widthFeet,
        heightFeet,
        building.roof,
      ]);
  expect(positions(generate('city', 25, 25, 41))).not.toEqual(positions(city));
});

test.each([
  ['town', 'ruinedTown'],
  ['city', 'ruinedUrban'],
])(
  '%s and %s share a seeded street plan, while ruins have real broken walls, roofs and upper floors',
  (intactKey, ruinedKey) => {
    const intact = generate(intactKey),
      ruined = generate(ruinedKey);
    const footprint = (engine) =>
      engine.geometry.getStructures().map((spec) => ({
        x: spec.xFeet,
        z: spec.zFeet,
        length: spec.lengthFeet,
        width: spec.widthFeet,
        angle: spec.angleRadians,
      }));
    expect(footprint(ruined)).toEqual(footprint(intact));
    const structures = ruined.geometry.getStructures();
    expect(structures.every((spec) => spec.ruined)).toBe(true);
    expect(structures.some((spec) => spec.building.roof === 'none')).toBe(true);
    expect(
      structures.some((spec) => spec.building.levels?.some((level) => level.openings.length > 0))
    ).toBe(true);
    for (const spec of structures) {
      const volumes = ruined.geometry
        .save()
        .volumes.filter((volume) => volume.structureId === spec.id);
      expect(
        volumes.some((volume) => volume.id.endsWith('-breach') && volume.operation === 'subtract')
      ).toBe(true);
    }
  }
);

test.each([20, 25])(
  'a %i-tile fortress has a clear gate and courtyard, inward-facing tower entrances and supported access to its connected wall walk',
  (size) => {
    const engine = generate('castle', size, size),
      structures = engine.geometry.getStructures();
    const walls = structures.filter((spec) => spec.kind === 'wall');
    expect(walls).toHaveLength(4);
    const gate = walls.find((spec) => spec.opening);
    const centre = { x: size * 2.5, z: size * 2.5 };
    const distance = Math.hypot(gate.xFeet - centre.x, gate.zFeet - centre.z);
    for (let along = -7.5; along <= 7.5; along += 2.5)
      expectWalkable(
        engine.geometry,
        gate.xFeet + ((gate.xFeet - centre.x) / distance) * along,
        gate.zFeet + ((gate.zFeet - centre.z) / distance) * along,
        0
      );
    for (const tower of structures.filter((spec) => spec.kind === 'turret')) {
      const approach = buildingLocalToFeet(tower, { x: 0, y: 0, z: tower.diameterFeet / 2 + 5.5 });
      expect(Math.hypot(approach.x - centre.x, approach.z - centre.z)).toBeLessThan(
        Math.hypot(tower.xFeet - centre.x, tower.zFeet - centre.z)
      );
      expectWalkable(engine.geometry, approach.x, approach.z, 0);
    }
    const stairWall = walls.find((spec) => spec.wallStairs);
    expect(stairWall).toBeDefined();
    const layout = wallStairLayout(stairWall);
    expect(stairWall.wallStairVersion).toBe(2);
    expect(layout.steps.every((step) => step.bounds.min.y === 0)).toBe(true);
    for (const point of layout.path) {
      const p = buildingLocalToFeet(stairWall, point);
      expectWalkable(engine.geometry, p.x, p.z, p.y);
    }
    const entry = buildingLocalToFeet(stairWall, layout.entry);
    const exit = buildingLocalToFeet(stairWall, layout.exit);
    expect(Math.hypot(entry.x - centre.x, entry.z - centre.z)).toBeLessThan(
      Math.hypot(stairWall.xFeet - centre.x, stairWall.zFeet - centre.z)
    );
    const range = buildSurfaceRange({
      geometry: engine.geometry,
      start: {
        gridX: Math.floor(entry.x / 5),
        gridY: Math.floor(entry.z / 5),
        xFeet: entry.x,
        zFeet: entry.z,
        heightFeet: 0,
      },
      speedFeet: 300,
    });
    expect(
      getSurfaceRoute(range, Math.floor(exit.x / 5), Math.floor(exit.z / 5), {
        heightFeet: stairWall.heightFeet,
      })
    ).not.toBeNull();
  },
  30000
);

test.each(['cavern', 'mountain', 'fungalGrove'])(
  '%s generates joined chambers and tunnels with one floor and full creature clearance at their seams',
  (key) => expectConnectedCaves(generate(key, 20, 20)),
  30000
);

test('editing a generated chamber preserves the ordered passage cuts through neighbouring shells, including undo and reopening', () => {
  const engine = generate('cavern', 20, 20);
  const chamber = engine.geometry.getStructures().filter((spec) => spec.kind === 'cave')[1];
  expect(chamber).toBeDefined();
  const before = engine.save();
  engine.resizeStructure(chamber.id, { heightFeet: chamber.heightFeet + 5 });
  expectConnectedCaves(engine);
  expect(engine.geometry.getStructures().find((spec) => spec.id === chamber.id).source).toBe(
    'manual'
  );
  engine.undo();
  expect(engine.save()).toEqual(before);
  engine.redo();
  const reopened = new TerrainEngine(1, 1);
  reopened.load(engine.save());
  expectConnectedCaves(reopened);
}, 30000);

test.each(SETTLEMENTS)(
  '%s scales down or caps detail on large maps without exceeding the geometry budget',
  (key) => {
    for (const [rows, cols] of [
      [12, 12],
      [12, 15],
      [20, 20],
      [25, 25],
      [60, 80],
    ]) {
      const engine = generate(key, rows, cols);
      const structures = engine.geometry.getStructures();
      const budget = getBiomeStructureBudget(key);
      expect(structures.length).toBeGreaterThan(0);
      expect(structures.length).toBeLessThanOrEqual(budget.structures);
      expect(engine.geometry.save().volumes.length).toBeLessThanOrEqual(budget.volumes);
      for (const spec of structures) {
        const bounds = structureBounds(spec);
        expect(bounds.min.x).toBeGreaterThanOrEqual(2.5 - 1e-6);
        expect(bounds.min.z).toBeGreaterThanOrEqual(2.5 - 1e-6);
        expect(bounds.max.x).toBeLessThanOrEqual(cols * 5 - 2.5 + 1e-6);
        expect(bounds.max.z).toBeLessThanOrEqual(rows * 5 - 2.5 + 1e-6);
      }
    }
  }
);
