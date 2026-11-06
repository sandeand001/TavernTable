import { ALL_BIOMES } from '../../../src/config/biome/BiomeConstants.js';
import { getSettlementProfile } from '../../../src/config/biome/SettlementProfiles.js';
import { getConstructionPalette } from '../../../src/config/biome/ConstructionPalettes.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { structureBounds } from '../../../src/terrain/ConstructionBlueprints.js';
import { buildingLocalToFeet, buildingDimensions } from '../../../src/terrain/BuildingModel.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';
import { createInteriorCutaway } from '../../../src/scene/terrain/InteriorCutaway.js';
import { TerrainVolumeMeshBuilder } from '../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import { generateCampaignBiome } from '../../../src/campaigns/CampaignBiomeGeneration.js';
import { wallStairLayout } from '../../../src/terrain/WallStairs.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';
import * as three from 'three';

function fixture(key, seed = 42, cols = 60, rows = 60) {
  const engine = new TerrainEngine(cols, rows);
  engine.generateBiomeElevation(key, { seed });
  return engine;
}

function worldFor(engine) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library },
    scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: engine.cols, rows: engine.rows, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.terrain.biome = engine.biomeKey;
  scene.terrain.worldElevationUnit = 0.5;
  scene.creatures = [];
  return { context, scene: reconcileBuildingScene(scene, context) };
}

test.each(['cliffsideCastle', 'mountainCastle'])(
  '%s is a selectable site biome with its own supported defaults and terrain palette',
  (key) => {
    expect(ALL_BIOMES.some((b) => b.key === key)).toBe(true);
    expect(getSettlementProfile(key)).toMatchObject({ kind: 'castle', cols: 60, rows: 60 });
    expect(getConstructionPalette(key).rock).not.toBe(getConstructionPalette('castle').rock);
    const engine = fixture(key);
    expect(new Set(engine.save().heights.flat()).size).toBeGreaterThan(2);
    expect(engine.geometry.getStructures().length).toBeGreaterThanOrEqual(4);
  }
);

test.each(['cliffsideCastle', 'mountainCastle'])(
  '%s has a paid supported exterior route from its first ascent to the high keep',
  (key) => {
    const engine = fixture(key),
      specs = engine.geometry.getStructures();
    const stair = specs.find((s) => s.wallStairs);
    const start = buildingLocalToFeet(stair, wallStairLayout(stair).entry);
    const keep = specs.find((s) => s.name.endsWith('High Keep'));
    const goal = buildingLocalToFeet(keep, {
      x: 0,
      y: 0,
      z: buildingDimensions(keep).width / 2 + 5.5,
    });
    const range = buildSurfaceRange({
      geometry: engine.geometry,
      start: {
        gridX: Math.floor(start.x / 5),
        gridY: Math.floor(start.z / 5),
        xFeet: start.x,
        zFeet: start.z,
        heightFeet: start.y,
      },
      speedFeet: 1000,
    });
    const route = getSurfaceRoute(range, Math.floor(goal.x / 5), Math.floor(goal.z / 5), {
      heightFeet: goal.y,
    });
    expect(route).not.toBeNull();
    expect(route.at(-1).cost).toBeGreaterThan(goal.y - start.y);
  },
  60000
);

test.each(['cliffsideCastle', 'mountainCastle'])(
  '%s uses negative ravines, arched approach bridges and architecture at multiple physical heights',
  (key) => {
    const engine = fixture(key),
      snapshot = engine.save(),
      specs = engine.geometry.getStructures();
    const negative = snapshot.heights.flat().filter((h) => h < 0).length;
    expect(negative).toBeGreaterThan(engine.cols * engine.rows * 0.5);
    expect(
      new Set(specs.filter((s) => s.building).map((s) => s.baseFeet)).size
    ).toBeGreaterThanOrEqual(3);
    expect(Math.max(...specs.map((s) => s.baseFeet))).toBeGreaterThanOrEqual(
      key === 'mountainCastle' ? 45 : 20
    );
    const bridges = snapshot.geometry.volumes.filter((v) => v.layerId === 'bridge');
    expect(bridges.length).toBeGreaterThan(0);
    expect(
      snapshot.geometry.volumes.some(
        (v) => v.layerId === 'bridge-arch' && v.operation === 'subtract'
      )
    ).toBe(true);
    for (const spec of specs.filter((s) => s.wallStairs))
      for (const local of wallStairLayout(spec).path) {
        const point = buildingLocalToFeet(spec, local);
        const support = engine.geometry.findSupport(point.x, point.z, {
          belowFeet: point.y + 1e-5,
          clearanceFeet: 5,
        });
        expect({
          name: spec.name,
          point,
          supported: !!support && Math.abs(support.heightFeet - point.y) < 1e-4,
        }).toEqual({ name: spec.name, point, supported: true });
      }
  },
  60000
);

test.each(['cliffsideCastle', 'mountainCastle'])(
  '%s expands a fresh default canvas and rejects undersized explicit sites atomically',
  async (key) => {
    const engine = new TerrainEngine(25, 25);
    engine.setBiome(key, { generateIfFlat: false, seed: 42 });
    const gm = {
      terrainEngine: engine,
      placedTokens: [],
      spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
      resizeGrid: (cols, rows) => engine.resize(cols, rows),
    };
    await generateCampaignBiome(gm, { seed: 42 });
    expect([engine.cols, engine.rows]).toEqual([60, 60]);
    const small = new TerrainEngine(12, 12),
      before = small.save();
    expect(() => small.generateBiomeElevation(key, { seed: 42 })).toThrow(/at least a 20 x 20/);
    expect(small.save()).toEqual(before);
  }
);

test.each([1, 7, 42])(
  'cliffside castle seed %i stands on a physical plateau with at least a twenty-foot drop and a supported gate',
  (seed) => {
    const engine = fixture('cliffsideCastle', seed),
      heights = engine.save().heights.flat();
    expect((Math.max(...heights) - Math.min(...heights)) * 2.5).toBeGreaterThanOrEqual(20);
    const gate = engine.geometry.getStructures().find((s) => s.kind === 'wall' && s.opening);
    expect(gate).toBeDefined();
    for (let distance = -6; distance <= 6; distance += 2) {
      const point = buildingLocalToFeet(gate, { x: 0, y: 0, z: distance });
      expect(
        engine.geometry.findSupport(point.x, point.z, {
          belowFeet: point.y + 1e-5,
          clearanceFeet: 6,
        })?.heightFeet
      ).toBeCloseTo(point.y);
      expect(
        engine.geometry.isSpaceClear({
          min: { x: point.x - 2.49, y: point.y + 1e-4, z: point.z - 2.49 },
          max: { x: point.x + 2.49, y: point.y + 6, z: point.z + 2.49 },
        })
      ).toBe(true);
    }
    const lowIndex = heights.indexOf(Math.min(...heights));
    const point = {
      x: (lowIndex % engine.cols) * 5 + 2.5,
      y: 0,
      z: Math.floor(lowIndex / engine.cols) * 5 + 2.5,
    };
    const support = engine.geometry.findSupport(point.x, point.z, { belowFeet: 0 });
    expect(support.heightFeet).toBeLessThanOrEqual(-20);
  }
);

test.each([1, 7, 42])(
  'mountain castle seed %i has excavated hall ceilings and readable aligned interior wall cutaways',
  (seed) => {
    const engine = fixture('mountainCastle', seed),
      specs = engine.geometry.getStructures();
    const hall = specs.find((s) => s.name === 'Stoneheart Great Hall');
    expect(hall).toBeDefined();
    expect(hall.building.roof).toBe('none');
    const centre = engine.geometry.findSupport(hall.xFeet, hall.zFeet, {
      belowFeet: hall.baseFeet + 1e-5,
      clearanceFeet: 10,
    });
    expect(centre).toMatchObject({ heightFeet: hall.baseFeet });
    expect(centre.ceilingFeet).toBeGreaterThanOrEqual(hall.baseFeet + 20);
    expect(centre.ceilingFeet).toBeLessThanOrEqual(hall.baseFeet + hall.heightFeet + 0.01);
    const roof = engine.geometry.findSupport(hall.xFeet, hall.zFeet, { belowFeet: 200 });
    expect(roof.heightFeet).toBeGreaterThanOrEqual(hall.baseFeet + hall.heightFeet + 5);
    const { scene, context } = worldFor(engine),
      world = CampaignWorld.fromScene(scene, context);
    const map = scene.maps.find(
      (m) => m.building?.structureId === hall.id && m.building.floor === 0
    );
    const interior = new TerrainEngine(map.grid.cols, map.grid.rows);
    interior.configureGeometryBase(0.5);
    interior.load({
      heights: map.terrain.heights,
      geometry: map.terrain.geometry,
      biomeKey: map.terrain.biome,
      biomeSeed: 42,
    });
    const gm = {
      campaignWorld: world,
      campaignMapId: map.id,
      cols: map.grid.cols,
      rows: map.grid.rows,
      terrainEngine: interior,
      spatial: { tileWorldSize: 1, elevationUnit: 0.5 },
    };
    const cutaway = createInteriorCutaway(gm),
      owner = world.getMap('map-main'),
      geometry = world.getMapGeometry(owner.id);
    const mesh = new TerrainVolumeMeshBuilder().build({
      geometry: cutaway.query(geometry, owner, geometry.getPartition()),
      three,
      worldUnitsPerFoot: 1,
    });
    try {
      mesh.computeBoundingBox();
      expect(mesh.getAttribute('position').count).toBeGreaterThan(0);
      expect(mesh.boundingBox.max.y).toBeLessThanOrEqual(hall.baseFeet + hall.heightFeet);
    } finally {
      mesh.dispose();
    }
  },
  60000
);

test.each([
  ['cliffsideCastle', 1, 60, 60],
  ['cliffsideCastle', 7, 40, 50],
  ['cliffsideCastle', 42, 20, 20],
  ['mountainCastle', 1, 60, 60],
  ['mountainCastle', 7, 50, 40],
  ['mountainCastle', 42, 20, 20],
])(
  '%s seed %i on %i by %i tiles keeps all foundations, entrances and owned floors usable',
  (key, seed, cols, rows) => {
    const engine = fixture(key, seed, cols, rows),
      specs = engine.geometry.getStructures();
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      const bounds = structureBounds(spec);
      expect(bounds.min.x).toBeGreaterThanOrEqual(0);
      expect(bounds.min.z).toBeGreaterThanOrEqual(0);
      expect(bounds.max.x).toBeLessThanOrEqual(cols * 5);
      expect(bounds.max.z).toBeLessThanOrEqual(rows * 5);
      if (!spec.building) continue;
      const point = buildingLocalToFeet(spec, {
        x: 0,
        y: 0,
        z: buildingDimensions(spec).width / 2 + 2.5,
      });
      expect(
        engine.geometry.findSupport(point.x, point.z, {
          belowFeet: point.y + 1e-4,
          clearanceFeet: 5,
        })?.heightFeet
      ).toBeCloseTo(point.y);
    }
    const { scene, context } = worldFor(engine),
      world = CampaignWorld.fromScene(scene, context);
    for (const entry of world
      .getConnections()
      .filter((c) => ['entry', 'stairs'].includes(c.building?.kind))) {
      const end = entry.ends[0],
        map = world.getMap(end.mapId),
        scale = map.grid.tileWorldSize / 5;
      let plan;
      try {
        plan = world.planConnection(entry.id, end.mapId, {
          x: end.positionFeet.x * scale,
          y: end.positionFeet.y * scale,
          z: end.positionFeet.z * scale,
        });
      } catch (error) {
        const spec = specs.find((s) => s.id === entry.building.structureId);
        error.message = `${spec.name} ${entry.building.kind} floor ${entry.building.floor}: ${error.message}`;
        throw error;
      }
      expect(plan.costFeet).toBeGreaterThan(0);
    }
    const before = engine.save();
    engine.generateBiomeElevation(key, { seed });
    expect(engine.save()).toEqual(before);
    const reopened = new TerrainEngine(1, 1);
    reopened.load(before);
    expect(reopened.save()).toEqual(before);
  },
  60000
);
