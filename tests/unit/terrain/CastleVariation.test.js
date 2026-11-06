import { createSettlementLayout } from '../../../src/terrain/generation/SettlementLayouts.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { structureBounds } from '../../../src/terrain/ConstructionBlueprints.js';
import {
  buildingDimensions,
  buildingLevels,
  buildingLocalToFeet,
} from '../../../src/terrain/BuildingModel.js';
import { wallStairLayout } from '../../../src/terrain/WallStairs.js';
import { getBiomeStructureBudget } from '../../../src/config/biome/SettlementProfiles.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';

const layout = (seed) =>
  createSettlementLayout({ biomeKey: 'castle', seed, width: 250, depth: 250 });
const signature = (result) =>
  JSON.stringify(
    result.structures.map((spec) => ({
      kind: spec.kind,
      x: spec.xFeet,
      z: spec.zFeet,
      angle: spec.angleRadians,
      length: spec.lengthFeet,
      width: spec.widthFeet,
      diameter: spec.diameterFeet,
      height: spec.heightFeet,
      base: spec.baseFeet,
      roof: spec.building?.roof,
      stairs: spec.wallStairs,
      wallHeight: spec.openingHeightFeet,
    }))
  );

test('sixteen castle seeds vary real structure dimensions, heights, wall shapes and building/tower counts', () => {
  const seeds = Array.from({ length: 16 }, (_, index) => index + 1),
    layouts = seeds.map(layout);
  expect(new Set(layouts.map(signature)).size).toBeGreaterThanOrEqual(12);
  const keeps = layouts.map((result) =>
    result.structures.find((spec) => spec.name.endsWith('High Keep'))
  );
  expect(new Set(keeps.map((spec) => spec.lengthFeet)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(keeps.map((spec) => spec.heightFeet)).size).toBeGreaterThanOrEqual(3);
  expect(
    new Set(
      layouts.map((result) => result.structures.filter((spec) => spec.kind === 'turret').length)
    ).size
  ).toBeGreaterThanOrEqual(3);
  expect(
    new Set(
      layouts.map((result) => result.structures.filter((spec) => spec.kind === 'building').length)
    ).size
  ).toBeGreaterThanOrEqual(3);
  expect(
    new Set(
      layouts.flatMap((result) =>
        result.structures.filter((spec) => spec.kind === 'wall').map((spec) => spec.heightFeet)
      )
    ).size
  ).toBeGreaterThanOrEqual(3);
  expect(
    layouts.some((result) =>
      result.structures.some(
        (spec) =>
          spec.kind === 'wall' &&
          Math.abs(
            spec.angleRadians / (Math.PI / 2) - Math.round(spec.angleRadians / (Math.PI / 2))
          ) > 0.01
      )
    )
  ).toBe(true);
  for (const seed of seeds) expect(signature(layout(seed))).toBe(signature(layout(seed)));
});

test.each([
  [50, 50, 1],
  [50, 50, 2],
  [50, 50, 3],
  [50, 50, 4],
  [50, 50, 7],
  [50, 50, 13],
  [50, 50, 42],
  [20, 20, 3],
  [30, 25, 4],
  [15, 12, 5],
  [80, 60, 6],
])(
  'castle %i by %i seed %i stays bounded and its doors and wall stairs have actual support',
  (cols, rows, seed) => {
    const engine = new TerrainEngine(cols, rows);
    engine.generateBiomeElevation('castle', { seed });
    const structures = engine.geometry.getStructures(),
      budget = getBiomeStructureBudget('castle');
    expect(structures.length).toBeGreaterThan(0);
    expect(structures.length).toBeLessThanOrEqual(budget.structures);
    expect(engine.geometry.save().volumes.length).toBeLessThanOrEqual(budget.volumes);
    expect(
      structures.reduce(
        (total, spec) => total + (spec.building ? buildingLevels(spec).length : 0),
        0
      )
    ).toBeLessThanOrEqual(budget.floorMaps);
    for (const spec of structures) {
      const bounds = structureBounds(spec);
      expect(bounds.min.x).toBeGreaterThanOrEqual(2.5 - 1e-6);
      expect(bounds.min.z).toBeGreaterThanOrEqual(2.5 - 1e-6);
      expect(bounds.max.x).toBeLessThanOrEqual(cols * 5 - 2.5 + 1e-6);
      expect(bounds.max.z).toBeLessThanOrEqual(rows * 5 - 2.5 + 1e-6);
      const points = spec.wallStairs
        ? wallStairLayout(spec).path
        : spec.building
          ? [{ x: 0, y: 0, z: buildingDimensions(spec).width / 2 + 2.5 }]
          : [];
      for (const local of points) {
        const point = buildingLocalToFeet(spec, local);
        const support = engine.geometry.findSupport(point.x, point.z, {
          belowFeet: point.y + 1e-5,
          clearanceFeet: 5,
        });
        expect({ name: spec.name, point, support: support?.heightFeet }).toMatchObject({
          support: expect.closeTo(point.y, 4),
        });
        expect(
          engine.geometry.isSpaceClear({
            min: { x: point.x - 0.49, y: point.y + 1e-5, z: point.z - 0.49 },
            max: { x: point.x + 0.49, y: point.y + 5 - 1e-5, z: point.z + 0.49 },
          })
        ).toBe(true);
      }
    }
  },
  60000
);

test('repeating a locked castle seed and reopening retain geometry, automatic windows and floor recipes exactly', () => {
  const engine = new TerrainEngine(50, 50);
  engine.generateBiomeElevation('castle', { seed: 7 });
  const before = engine.save();
  engine.generateBiomeElevation('castle', { seed: 7 });
  expect(engine.save()).toEqual(before);
  const reopened = new TerrainEngine(1, 1);
  reopened.load(before);
  expect(reopened.save()).toEqual(before);
});

test.each([3, 4, 13])(
  'complex castle seed %i has usable connected entrances and every retained staircase',
  (seed) => {
    localStorage.clear();
    const engine = new TerrainEngine(50, 50);
    engine.generateBiomeElevation('castle', { seed });
    const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
    const context = { ruleset: '2014', library },
      scene = sceneState();
    scene.version = 2;
    scene.grid = { cols: 50, rows: 50, tileWorldSize: 1 };
    scene.terrain.heights = engine.save().heights;
    scene.terrain.geometry = engine.geometry.save();
    scene.creatures = [];
    const assembled = reconcileBuildingScene(scene, context),
      world = CampaignWorld.fromScene(assembled, context);
    expect(assembled.maps.length).toBeLessThanOrEqual(65);
    for (const connection of world
      .getConnections()
      .filter((c) => ['entry', 'stairs'].includes(c.building?.kind))) {
      const end = connection.ends[0],
        map = world.getMap(end.mapId),
        scale = map.grid.tileWorldSize / 5;
      const plan = world.planConnection(connection.id, end.mapId, {
        x: end.positionFeet.x * scale,
        y: end.positionFeet.y * scale,
        z: end.positionFeet.z * scale,
      });
      expect(plan.costFeet).toBe(connection.kind === 'stairs' ? 35 : 5);
    }
  },
  60000
);
