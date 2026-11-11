import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { createStructure, structureBounds } from '../../../src/terrain/ConstructionBlueprints.js';
import { buildingDimensions, buildingLevels } from '../../../src/terrain/BuildingModel.js';
import { cellarConnectionFits } from '../../../src/terrain/CellarConnections.js';
import { buildSurfaceRange, getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';
import {
  reconcileBuildingScene,
  captureBuildingContext,
} from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';
import { openTraversalDoors } from '../../helpers/openTraversalDoors.js';

const castleBiomes = ['castle', 'ruinedCastle', 'cliffsideCastle', 'mountainCastle'];
const copy = (value) => JSON.parse(JSON.stringify(value));

function generate(key, size = 60, seed = 42) {
  const engine = new TerrainEngine(size, size);
  engine.configureGeometryScale(1.5);
  engine.generateBiomeElevation(key, { seed });
  return engine;
}

function assemble(engine) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library },
    scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: engine.cols, rows: engine.rows, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.terrain.biome = engine.biomeKey;
  scene.terrain.seed = engine.biomeSeed;
  scene.terrain.worldElevationUnit = 0.3;
  scene.creatures = [];
  const saved = reconcileBuildingScene(scene, context);
  return { scene: saved, context, world: CampaignWorld.fromScene(saved, context) };
}

function connectionRoute(world, connection, end) {
  openTraversalDoors(world);
  const scale = world.getMap(end.mapId).grid.tileWorldSize / 5;
  return world.planConnection(connection.id, end.mapId, {
    x: end.positionFeet.x * scale,
    y: end.positionFeet.y * scale,
    z: end.positionFeet.z * scale,
  });
}

test.each(castleBiomes)(
  '%s generates a native connected cellar and a deeper dungeon extending beyond the keep',
  (key) => {
    const engine = generate(key),
      structures = engine.geometry.getStructures(),
      cellars = structures.filter((spec) => spec.kind === 'cellar');
    expect(cellars).toHaveLength(1);
    const cellar = cellars[0],
      keep = structures.find((spec) => spec.id === cellar.building.access.structureId);
    expect(keep).toBeDefined();
    expect(cellar.source).toBe('generated');
    expect(cellar.heightFeet).toBe(20);
    expect(cellar.baseFeet).toBe(keep.baseFeet);
    expect(cellar.lengthFeet).toBeGreaterThan(buildingDimensions(keep).length);
    expect(cellar.widthFeet).toBeGreaterThan(buildingDimensions(keep).width);
    expect(cellar.building.access.kind).toBe('stairs');
    expect(cellar.building.stairs).toBe(true);
    expect(cellarConnectionFits(cellar, keep)).toBe(true);
    expect(cellar.building.cellarLayout).toEqual({
      version: 1,
      style: 'castle-dungeon',
      seed: 42,
    });
    expect(buildingLevels(cellar).map((level) => level.elevationFeet)).toEqual([-20, -10]);
    const bounds = structureBounds(cellar);
    expect(bounds.min.x).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(bounds.min.z).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(bounds.max.x).toBeLessThanOrEqual(295 + 1e-6);
    expect(bounds.max.z).toBeLessThanOrEqual(295 + 1e-6);
  }
);

test.each(castleBiomes)(
  '%s creates accessible storage and multi-room dungeon maps with paid stairs and real doorways',
  (key) => {
    const engine = generate(key),
      cellar = engine.geometry.getStructures().find((spec) => spec.kind === 'cellar');
    expect(cellar).toBeDefined();
    const { scene, context, world } = assemble(engine),
      maps = scene.maps.filter((map) => map.building?.structureId === cellar.id),
      dungeon = maps.find((map) => map.building.floor === 1),
      storage = maps.find((map) => map.building.floor === 0);
    expect(maps).toHaveLength(2);
    expect(storage.name).toMatch(/storage/i);
    expect(dungeon.name).toMatch(/dungeon/i);
    const doors = dungeon.terrain.geometry.structures.filter((spec) => spec.opening);
    expect(doors.length).toBeGreaterThanOrEqual(4);
    const stairs = scene.connections.filter(
      (connection) => connection.building?.structureId === cellar.id
    );
    expect(stairs).toHaveLength(2);
    for (const connection of stairs)
      for (const end of connection.ends) {
        const route = connectionRoute(world, connection, end);
        expect(route.costFeet).toBeGreaterThan(0);
        expect(route.targetMapId).not.toBe(end.mapId);
      }
    const internal = stairs.find((connection) => connection.building.kind === 'stairs'),
      entry = internal.ends.find((end) => end.mapId === dungeon.id);
    const range = buildSurfaceRange({
      geometry: world.getMapGeometry(dungeon.id),
      start: {
        gridX: Math.floor(entry.positionFeet.x / 5),
        gridY: Math.floor(entry.positionFeet.z / 5),
        xFeet: entry.positionFeet.x,
        zFeet: entry.positionFeet.z,
        heightFeet: 0,
      },
      speedFeet: 1000,
    });
    for (const door of doors) {
      const z =
        door.zFeet + (door.zFeet < dungeon.building.offsetZ + cellar.widthFeet / 2 ? -5 : 5);
      expect(
        getSurfaceRoute(range, Math.floor(door.xFeet / 5), Math.floor(z / 5), {
          heightFeet: 0,
        })
      ).not.toBeNull();
    }
    expect(decodeScene(encodeScene(scene, context), context)).toEqual(copy(scene));
    expect(copy(reconcileBuildingScene(scene, context))).toEqual(copy(scene));
  },
  60000
);

test.each([
  ...castleBiomes.flatMap((key) => [
    [key, 20, 1],
    [key, 40, 7],
    [key, 50, 42],
  ]),
  ['castle', 12, 1],
  ['ruinedCastle', 12, 7],
])(
  '%s on %s squares with seed %s keeps its cellar underground and within the map',
  (key, size, seed) => {
    const engine = generate(key, size, seed),
      cellar = engine.geometry.getStructures().find((spec) => spec.kind === 'cellar');
    expect(cellar).toBeDefined();
    const bounds = structureBounds(cellar),
      heights = engine.save().heights;
    for (
      let z = Math.floor((bounds.min.z + 1e-6) / 5);
      z < Math.ceil((bounds.max.z - 1e-6) / 5);
      z++
    )
      for (
        let x = Math.floor((bounds.min.x + 1e-6) / 5);
        x < Math.ceil((bounds.max.x - 1e-6) / 5);
        x++
      )
        expect(heights[z][x] * 1.5 + 1e-6).toBeGreaterThanOrEqual(cellar.baseFeet);
    expect(bounds.min.x).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(bounds.min.z).toBeGreaterThanOrEqual(5 - 1e-6);
    expect(bounds.max.x).toBeLessThanOrEqual(size * 5 - 5 + 1e-6);
    expect(bounds.max.z).toBeLessThanOrEqual(size * 5 - 5 + 1e-6);
  }
);

test.each([
  ['castle', 50, 42],
  ['castle', 60, 4],
  ['ruinedCastle', 50, 42],
  ['cliffsideCastle', 20, 42],
  ['mountainCastle', 20, 42],
])(
  '%s on %s squares with seed %s keeps its original entrances and stairs usable beside the cellar hatch',
  (key, size, seed) => {
    const { world } = assemble(generate(key, size, seed));
    for (const connection of world
      .getConnections()
      .filter(
        (entry) =>
          entry.kind === 'opening' || ['entry', 'stairs', 'access'].includes(entry.building?.kind)
      ))
      for (const end of connection.ends)
        expect(connectionRoute(world, connection, end).costFeet).toBeGreaterThan(0);
  },
  60000
);

test('native cellar layout recipes are validated and ordinary manually authored cellars stay empty', () => {
  const spec = {
    id: 'cellar',
    kind: 'cellar',
    xFeet: 60,
    zFeet: 60,
    heightFeet: 20,
    lengthFeet: 60,
    widthFeet: 50,
  };
  const recipe = { version: 1, style: 'castle-dungeon', seed: 42 };
  expect(
    createStructure({ ...spec, building: { cellarLayout: recipe } }).building.cellarLayout
  ).toEqual(recipe);
  expect(() =>
    createStructure({ ...spec, kind: 'building', building: { cellarLayout: recipe } })
  ).toThrow(/cellar/i);
  expect(() =>
    createStructure({
      ...spec,
      building: { cellarLayout: { ...recipe, seed: -1 } },
    })
  ).toThrow(/cellar/i);
  const engine = new TerrainEngine(30, 30);
  engine.configureGeometryScale(1.5);
  engine.placeStructure(spec);
  const { scene } = assemble(engine);
  for (const map of scene.maps.filter((entry) => entry.building))
    expect(map.terrain.geometry.structures || []).toEqual([]);
});

test('same-seed generation preserves edited dungeon rooms and replacing them fails explicitly', () => {
  const engine = generate('castle'),
    cellar = engine.geometry.getStructures().find((spec) => spec.kind === 'cellar');
  expect(cellar).toBeDefined();
  const { scene, context } = assemble(engine),
    dungeon = scene.maps.find(
      (map) => map.building?.structureId === cellar.id && map.building.floor === 1
    );
  const interior = new TerrainEngine(dungeon.grid.cols, dungeon.grid.rows);
  interior.configureGeometryScale(1.5);
  interior.load({ ...interior.save(), ...copy(dungeon.terrain) });
  const wall = interior.geometry.getStructures()[0];
  interior.resizeStructure(wall.id, { heightFeet: 9 });
  dungeon.terrain.geometry = interior.geometry.save();
  const original = copy(scene);
  engine.generateBiomeElevation('castle', { seed: 42 });
  const sameSeed = copy(scene),
    sameOwner = sameSeed.maps.find((map) => map.id === dungeon.building.ownerMapId);
  sameOwner.terrain.geometry = engine.geometry.save();
  sameOwner.terrain.heights = engine.save().heights;
  const repeated = reconcileBuildingScene(sameSeed, context);
  expect(repeated.maps.find((map) => map.id === dungeon.id).terrain.geometry).toEqual(
    dungeon.terrain.geometry
  );
  engine.generateBiomeElevation('castle', { seed: 7 });
  const candidate = copy(scene),
    owner = candidate.maps.find((map) => map.id === dungeon.building.ownerMapId);
  owner.terrain.geometry = engine.geometry.save();
  owner.terrain.heights = engine.save().heights;
  const buildingContext = captureBuildingContext(scene, owner.id);
  buildingContext.protectAuthoredCellars = true;
  buildingContext.connections = [];
  expect(() =>
    reconcileBuildingScene(candidate, context, {
      ownerMapId: owner.id,
      restoreContext: buildingContext,
    })
  ).toThrow(/edited.*cellar|manual.*dungeon/i);
  expect(copy(scene)).toEqual(original);
});
