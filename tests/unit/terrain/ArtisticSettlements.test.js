import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import {
  getSettlementProfile,
  getBiomeStructureBudget,
} from '../../../src/config/biome/SettlementProfiles.js';
import { structureBounds } from '../../../src/terrain/ConstructionBlueprints.js';
import { generateCampaignBiome } from '../../../src/campaigns/CampaignBiomeGeneration.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';
import { openTraversalDoors } from '../../helpers/openTraversalDoors.js';
import { buildingLocalToFeet } from '../../../src/terrain/BuildingModel.js';

function generate(
  key,
  cols = getSettlementProfile(key).cols,
  rows = getSettlementProfile(key).rows,
  seed = 42
) {
  const engine = new TerrainEngine(cols, rows);
  engine.generateBiomeElevation(key, { seed });
  return engine;
}

test('a village has a green, winding lanes, named landmarks and irregular mixed cottages rather than two rows', () => {
  const engine = generate('town'),
    specs = engine.geometry.getStructures(),
    volumes = engine.geometry.save().volumes;
  expect(specs.length).toBeGreaterThanOrEqual(8);
  expect(specs.some((s) => s.name.endsWith('Inn'))).toBe(true);
  expect(specs.some((s) => s.name === 'Village Bellhouse')).toBe(true);
  expect(new Set(specs.map((s) => s.xFeet)).size).toBeGreaterThanOrEqual(6);
  expect(new Set(specs.map((s) => s.zFeet)).size).toBeGreaterThanOrEqual(6);
  expect(new Set(specs.map((s) => s.appearance.wallColor)).size).toBeGreaterThanOrEqual(4);
  expect(volumes.some((v) => v.layerId === 'garden')).toBe(true);
  expect(volumes.some((v) => v.layerId === 'street' && v.shape?.kind === 'prism')).toBe(true);
  expect(volumes.some((v) => v.layerId === 'garden-fence')).toBe(true);
});

test('the generated village appearance survives save and reopen without changing topology', () => {
  const engine = generate('town', undefined, undefined, 91);
  const buildings = engine.geometry.getStructures().filter((spec) => spec.kind === 'building');
  expect(buildings.length).toBeGreaterThan(1);
  expect(
    buildings.every((spec) => spec.appearance.facadeModelKey === 'source-medieval-wall-door')
  ).toBe(true);
  const restored = new TerrainEngine(1, 1);
  restored.load(engine.save());
  expect(restored.geometry.save()).toEqual(engine.geometry.save());
});

test('a city has dense multi-storey districts, a civic skyline, paved streets and an actual six-stall market', () => {
  const engine = generate('city'),
    specs = engine.geometry.getStructures(),
    volumes = engine.geometry.save().volumes;
  expect(specs.length).toBeGreaterThanOrEqual(20);
  expect(specs.filter((s) => s.heightFeet >= 30).length).toBeGreaterThanOrEqual(5);
  expect(specs.some((s) => s.name === 'Mercantile Hall')).toBe(true);
  expect(specs.some((s) => s.name === 'Westgate Bell Tower')).toBe(true);
  expect(new Set(specs.map((s) => s.appearance.wallColor)).size).toBeGreaterThanOrEqual(5);
  const materials = new Set(specs.map((s) => s.appearance.wallMaterial));
  expect(materials.has('brick')).toBe(true);
  expect(materials.has('stone')).toBe(true);
  expect(materials.has('plaster')).toBe(true);
  expect(volumes.filter((v) => v.layerId === 'market' && v.bounds.min.y === 7.1)).toHaveLength(6);
  for (const [xs, zs] of [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ])
    expect(
      specs.filter((s) => (s.xFeet - 112.5) * xs > 0 && (s.zFeet - 112.5) * zs > 0).length
    ).toBeGreaterThanOrEqual(3);
});

test('a default-size fortress is a grand layered estate with a tall keep, bastions, a raised gatehouse and a wide real arch', () => {
  const engine = generate('castle'),
    specs = engine.geometry.getStructures();
  const keep = specs.find((s) => s.name.endsWith('High Keep'));
  expect(keep.heightFeet).toBeGreaterThanOrEqual(40);
  expect(keep.lengthFeet).toBeGreaterThanOrEqual(40);
  expect(keep.widthFeet).toBeGreaterThanOrEqual(30);
  expect(specs.filter((s) => s.kind === 'turret').length).toBeGreaterThanOrEqual(4);
  const walls = specs.filter((s) => s.kind === 'wall' && s.style === 'battlement');
  expect(walls).toHaveLength(4);
  expect(walls.every((s) => s.heightFeet >= 15 && s.lengthFeet >= 120)).toBe(true);
  expect(walls.filter((s) => s.wallStairs).length).toBeGreaterThanOrEqual(1);
  expect(specs.find((s) => s.name === 'Royal Gate')).toMatchObject({
    openingShape: 'arch',
  });
  const gate = specs.find((s) => s.name === 'Royal Gate');
  expect(gate.openingWidthFeet).toBeGreaterThanOrEqual(10);
  expect(gate.openingHeightFeet).toBeGreaterThanOrEqual(10);
  const gatehouse = specs.find((s) => s.name.endsWith('Keep Gatehouse'));
  const gatehouseArch = specs.find((s) => s.name.endsWith('Gatehouse Arch'));
  expect(gatehouse.baseFeet).toBe(gatehouseArch.heightFeet);
  expect(engine.getHeightAt(Math.floor(gatehouse.xFeet / 5), Math.floor(gatehouse.zFeet / 5))).toBe(
    0
  );
  expect(new Set(specs.map((s) => s.appearance.wallColor)).size).toBeGreaterThanOrEqual(3);
});

test('castle curtain walls meet at square bastion corners and turret entrances face inward', () => {
  const engine = generate('castle'),
    specs = engine.geometry.getStructures(),
    walls = specs.filter((spec) => spec.kind === 'wall' && spec.style === 'battlement'),
    bastions = specs.filter((spec) => spec.name.endsWith('Bastion'));
  expect(bastions).toHaveLength(4);
  const endpoints = walls.flatMap((wall) => {
    const dx = (Math.cos(wall.angleRadians) * wall.lengthFeet) / 2,
      dz = (Math.sin(wall.angleRadians) * wall.lengthFeet) / 2;
    return [
      { x: wall.xFeet - dx, z: wall.zFeet - dz },
      { x: wall.xFeet + dx, z: wall.zFeet + dz },
    ];
  });
  for (const side of walls.filter((wall) => /West Curtain|East Curtain/.test(wall.name)))
    expect(Math.abs(Math.sin(side.angleRadians))).toBeCloseTo(1, 6);
  for (const bastion of bastions) {
    expect(
      Math.min(
        ...endpoints.map((point) => Math.hypot(point.x - bastion.xFeet, point.z - bastion.zFeet))
      )
    ).toBeLessThanOrEqual(
      bastion.diameterFeet / 2 + Math.max(...walls.map((wall) => wall.widthFeet)) / 2 - 2.5
    );
    const doorway = buildingLocalToFeet(bastion, {
      x: 0,
      y: 0,
      z: bastion.diameterFeet / 2,
    });
    const inward =
      (doorway.x - bastion.xFeet) * (engine.cols * 2.5 - bastion.xFeet) +
      (doorway.z - bastion.zFeet) * (engine.rows * 2.5 - bastion.zFeet);
    expect(inward).toBeGreaterThan(0);
  }
});

test.each(['town', 'city', 'castle', 'ruinedTown', 'ruinedUrban', 'ruinedCastle'])(
  '%s respects its artistic structure, volume and floor budgets and repeats without accumulating site props',
  (key) => {
    const engine = generate(key),
      before = engine.save(),
      budget = getBiomeStructureBudget(key);
    expect(engine.geometry.getStructures().length).toBeLessThanOrEqual(budget.structures);
    expect(engine.geometry.save().volumes.length).toBeLessThanOrEqual(budget.volumes);
    engine.generateBiomeElevation(key, { seed: 42 });
    expect(engine.save()).toEqual(before);
    for (const spec of engine.geometry.getStructures()) {
      const bounds = structureBounds(spec);
      expect(bounds.min.x).toBeGreaterThanOrEqual(0);
      expect(bounds.min.z).toBeGreaterThanOrEqual(0);
      expect(bounds.max.x).toBeLessThanOrEqual(engine.cols * 5);
      expect(bounds.max.z).toBeLessThanOrEqual(engine.rows * 5);
    }
  }
);

test.each(['town', 'city', 'castle'])(
  '%s expands only an untouched empty default canvas',
  (key) => {
    const engine = new TerrainEngine(25, 25);
    engine.setBiome(key, { generateIfFlat: false, seed: 42 });
    const gm = {
      terrainEngine: engine,
      placedTokens: [],
      spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
      resizeGrid: jest.fn((cols, rows) => engine.resize(cols, rows)),
    };
    return generateCampaignBiome(gm).then(() => {
      const profile = getSettlementProfile(key);
      expect(gm.resizeGrid).toHaveBeenCalledWith(profile.cols, profile.rows, true);
      expect(engine.cols).toBe(profile.cols);
      expect(engine.rows).toBe(profile.rows);
    });
  }
);

test('a reviewed biome variant and footprint replace the current selection during generation', async () => {
  const engine = new TerrainEngine(25, 25);
  engine.setBiome('town', { generateIfFlat: false, seed: 42 });
  const gm = {
    terrainEngine: engine,
    placedTokens: [],
    spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
    resizeGrid: jest.fn((cols, rows) => engine.resize(cols, rows)),
  };
  await generateCampaignBiome(gm, {
    biomeKey: 'castle',
    canvasScale: 1.4,
    densityMultiplier: 0.55,
  });
  expect(engine.biomeKey).toBe('castle');
  expect(engine.cols).toBe(70);
  expect(engine.rows).toBe(70);
  expect(engine.treeDensityMultiplier).toBe(0.55);
  expect(engine.generationRecipe).toEqual({
    version: 1,
    biomeKey: 'castle',
    values: {
      canvasScale: 1.4,
      densityMultiplier: 0.55,
    },
  });
  const restored = new TerrainEngine(1, 1);
  restored.load(engine.save());
  expect(restored.generationRecipe).toEqual(engine.generationRecipe);
});

test.each(['custom', 'occupied', 'manual', 'no-structures'])(
  '%s maps are never automatically resized',
  async (mode) => {
    const engine = new TerrainEngine(mode === 'custom' ? 30 : 25, 25);
    engine.setBiome('city', { generateIfFlat: false, seed: 42 });
    if (mode === 'manual')
      engine.placeStructure({ id: 'manual', kind: 'dome', xFeet: 15, zFeet: 15, diameterFeet: 20 });
    const gm = {
      terrainEngine: engine,
      placedTokens: mode === 'occupied' ? [{ id: 'creature' }] : [],
      resizeGrid: jest.fn(),
      spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
    };
    await generateCampaignBiome(gm, { structures: mode !== 'no-structures' });
    expect(gm.resizeGrid).not.toHaveBeenCalled();
  }
);

test('failed default enlargement restores the exact previous terrain instead of saving a half-generated larger map', async () => {
  const engine = new TerrainEngine(25, 25);
  engine.setBiome('city', { generateIfFlat: false, seed: 42 });
  const before = engine.save();
  const gm = {
    terrainEngine: engine,
    placedTokens: [],
    spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
    resizeGrid: (cols, rows) => engine.resize(cols, rows),
  };
  const stop = engine.validateGeometryEdits(() => {
    throw new Error('Blocked generation');
  });
  try {
    await expect(generateCampaignBiome(gm)).rejects.toThrow('Blocked generation');
    expect(engine.save()).toEqual(before);
  } finally {
    stop();
  }
});

test.each(['city', 'castle'])(
  '%s named buildings still own real aligned floors with usable entrances',
  (key) => {
    const engine = generate(key);
    localStorage.clear();
    const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
    const context = { ruleset: '2014', library },
      scene = sceneState();
    scene.version = 2;
    scene.grid = { cols: engine.cols, rows: engine.rows, tileWorldSize: 1 };
    scene.terrain.heights = engine.save().heights;
    scene.terrain.geometry = engine.geometry.save();
    scene.creatures = [];
    const assembled = reconcileBuildingScene(scene, context),
      world = openTraversalDoors(CampaignWorld.fromScene(assembled, context));
    expect(assembled.maps.length).toBeLessThanOrEqual(128);
    for (const entry of world.getConnections().filter((c) => c.building?.kind === 'entry')) {
      const end = entry.ends[0],
        map = world.getMap(end.mapId),
        unit = map.grid.tileWorldSize / 5;
      const plan = world.planConnection(entry.id, end.mapId, {
        x: end.positionFeet.x * unit,
        y: end.positionFeet.y * unit,
        z: end.positionFeet.z * unit,
      });
      expect(plan.costFeet).toBe(5);
    }
    expect(
      assembled.maps.some((m) =>
        m.name.startsWith(
          key === 'city' ? 'Mercantile Hall' : engine.geometry.getStructures()[0].name
        )
      )
    ).toBe(true);
  },
  60000
);

test('collapsed upper-floor sections leave every compact ruined-keep stair attachment supported', () => {
  const engine = generate('ruinedCastle', 25, 25),
    library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library },
    scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures = [];
  const world = CampaignWorld.fromScene(reconcileBuildingScene(scene, context), context);
  const keep = engine.geometry.getStructures()[0];
  const staircases = world
    .getConnections()
    .filter((c) => c.building?.kind === 'stairs' && c.building.structureId === keep.id);
  for (const stairs of staircases) {
    const end = stairs.ends[0],
      map = world.getMap(end.mapId),
      unit = map.grid.tileWorldSize / 5;
    const plan = world.planConnection(stairs.id, end.mapId, {
      x: end.positionFeet.x * unit,
      y: end.positionFeet.y * unit,
      z: end.positionFeet.z * unit,
    });
    expect(plan.costFeet).toBeGreaterThanOrEqual(35);
  }
});

test('an automatically sized unedited settlement can grow for the next biome, but manual edits stop automatic resizing', async () => {
  const engine = new TerrainEngine(25, 25),
    gm = {
      terrainEngine: engine,
      placedTokens: [],
      spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
      resizeGrid: jest.fn((cols, rows) => engine.resize(cols, rows)),
    };
  for (const key of ['town', 'city']) {
    engine.setBiome(key, { generateIfFlat: false, seed: 42 });
    await generateCampaignBiome(gm);
    expect(engine.cols).toBe(getSettlementProfile(key).cols);
  }
  engine.placeStructure({ id: 'manual', kind: 'dome', xFeet: 15, zFeet: 15, diameterFeet: 20 });
  const before = gm.resizeGrid.mock.calls.length;
  engine.setBiome('castle', { generateIfFlat: false, seed: 42 });
  await generateCampaignBiome(gm);
  expect(gm.resizeGrid.mock.calls.length).toBe(before);
  expect(engine.cols).toBe(45);
  expect(engine.geometry.getStructures().some((s) => s.id === 'manual')).toBe(true);
}, 60000);
