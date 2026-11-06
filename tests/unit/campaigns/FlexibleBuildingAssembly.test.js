import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import {
  changeBuildingLevelHeight,
  removeBuildingLevel,
  explicitBuilding,
} from '../../../src/terrain/BuildingModel.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { sceneState } from '../../helpers/sceneState.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library },
    engine = new TerrainEngine(30, 30),
    scene = sceneState();
  scene.version = 2;
  scene.creatures = [];
  scene.grid = { cols: 30, rows: 30, tileWorldSize: 1 };
  const assemble = () => {
    scene.terrain.heights = engine.save().heights;
    scene.terrain.geometry = engine.geometry.save();
    const saved = reconcileBuildingScene(scene, context);
    return { scene: saved, world: CampaignWorld.fromScene(saved, context) };
  };
  const place = (extra = {}) =>
    engine.placeStructure({
      id: 'hall',
      kind: 'building',
      xFeet: 60,
      zFeet: 60,
      heightFeet: 30,
      lengthFeet: 40,
      widthFeet: 30,
      ...extra,
    });
  return { engine, context, assemble, place };
}

function route(world, connection) {
  const end = connection.ends[0],
    scale = world.getMap(end.mapId).grid.tileWorldSize / 5;
  return world.planConnection(connection.id, end.mapId, {
    x: end.positionFeet.x * scale,
    y: end.positionFeet.y * scale,
    z: end.positionFeet.z * scale,
  });
}

test('a twenty-foot throne room moves upper slabs, windows, balconies and the roof together', () => {
  const { engine, place, assemble } = fixture();
  place({
    building: {
      balconies: [{ id: 'deck', floor: 1, side: 'south', u: 0.5, widthFeet: 10, depthFeet: 5 }],
    },
  });
  const next = changeBuildingLevelHeight(engine.geometry.getStructures()[0], 0, 20);
  engine.resizeStructure('hall', { heightFeet: next.heightFeet, building: next.building });
  const { scene, world } = assemble();
  expect(scene.maps.filter((map) => map.building).map((map) => map.originFeet.y)).toEqual([
    0, 20, 30,
  ]);
  expect(world.findSupportBelow({ x: 70, y: 19, z: 70 }).positionFeet.y).toBe(0);
  expect(world.findSupportBelow({ x: 70, y: 29, z: 70 }).positionFeet.y).toBe(20);
  expect(world.findSupportBelow({ x: 60, y: 70, z: 60 }).positionFeet.y).toBe(45);
  const balcony = scene.connections.find((c) => c.building?.kind === 'balcony');
  expect(balcony.ends[0].positionFeet.y).toBe(20);
  const stairs = scene.connections.find((c) => c.kind === 'stairs');
  expect(route(world, stairs).targetMapId).toBe(stairs.ends[1].mapId);
  expect(route(world, stairs).costFeet).toBeGreaterThan(35);
});

test('removing the middle floor leaves a twenty-foot void and a real supported staircase to the retained upper level', () => {
  const { engine, place, assemble } = fixture();
  place();
  const next = removeBuildingLevel(engine.geometry.getStructures()[0], 1);
  engine.resizeStructure('hall', { building: next.building });
  const { scene, world } = assemble();
  expect(scene.maps.filter((map) => map.building).map((map) => map.building.floor)).toEqual([0, 2]);
  expect(world.findSupportBelow({ x: 70, y: 19, z: 70 }).positionFeet.y).toBe(0);
  const stairs = scene.connections.find((c) => c.kind === 'stairs');
  expect(route(world, stairs).targetMapId).toBe(stairs.ends[1].mapId);
});

test('rectangular cutouts remove only their own slab and do not erase the next floor or floor below', () => {
  const { engine, place, assemble, context } = fixture();
  place({ building: { stairs: false } });
  const spec = engine.geometry.getStructures()[0],
    building = explicitBuilding(spec);
  building.levels[1].openings.push({
    id: 'atrium',
    xFeet: 20,
    zFeet: 10,
    lengthFeet: 10,
    widthFeet: 10,
  });
  engine.resizeStructure('hall', { building });
  const { scene, world } = assemble();
  expect(world.findSupportBelow({ x: 65, y: 15, z: 60 }).positionFeet.y).toBe(0);
  expect(world.findSupportBelow({ x: 75, y: 15, z: 70 }).positionFeet.y).toBe(10);
  expect(world.findSupportBelow({ x: 65, y: 25, z: 60 }).positionFeet.y).toBe(20);
  expect(decodeScene(encodeScene(scene, context), context)).toEqual(scene);
});

test('a castle turret has an aligned walkable roof-deck map connected by real stairs', () => {
  const { place, assemble } = fixture();
  place({ kind: 'turret', heightFeet: 20, diameterFeet: 30 });
  const { scene, world } = assemble();
  const deck = scene.maps.find((map) => map.building?.floor === 100);
  expect(deck.originFeet.y).toBe(20);
  const stairs = scene.connections.find((c) => c.ends[1].mapId === deck.id);
  expect(route(world, stairs).targetMapId).toBe(deck.id);
  expect(world.findSupportBelow({ x: 65, y: 21, z: 67.5 }).positionFeet.y).toBe(20);
});

test.each(['none', 'stairs', 'ladder'])(
  'an oversized independent cellar supports optional %s access to the building above',
  (kind) => {
    const { engine, place, assemble, context } = fixture();
    place({ building: { stairs: false } });
    engine.placeStructure({
      id: 'cellar',
      kind: 'cellar',
      xFeet: 70,
      zFeet: 70,
      heightFeet: 20,
      lengthFeet: 60,
      widthFeet: 60,
      building: {
        access: {
          kind,
          structureId: kind === 'none' ? null : 'hall',
          xFeet: kind === 'stairs' ? -12.5 : 0,
          zFeet: kind === 'stairs' ? -7.5 : 0,
        },
      },
    });
    const { scene, world } = assemble();
    const maps = scene.maps.filter((map) => map.building?.structureId === 'cellar');
    expect(maps.map((map) => map.originFeet.y)).toEqual([-20, -10]);
    expect(world.findSupportBelow({ x: 90, y: -1, z: 90 }).positionFeet.y).toBe(-10);
    const access = scene.connections.find((c) => c.building?.kind === 'access');
    if (kind === 'none') expect(access).toBeUndefined();
    else {
      expect(access.kind).toBe(kind);
      expect(world.getMap(access.ends[1].mapId).building.structureId).toBe('hall');
      expect(route(world, access).targetMapId).toBe(access.ends[1].mapId);
      expect(route(world, access).costFeet).toBeGreaterThanOrEqual(20);
    }
    expect(decodeScene(encodeScene(scene, context), context)).toEqual(scene);
  }
);

test('a ground-floor cutout opens the physical surface cap into an unlinked cellar below', () => {
  const { engine, place, assemble } = fixture();
  place({ building: { stairs: false } });
  const spec = engine.geometry.getStructures()[0],
    building = explicitBuilding(spec);
  building.levels[0].openings.push({
    id: 'hatch',
    xFeet: 20,
    zFeet: 10,
    lengthFeet: 10,
    widthFeet: 10,
  });
  engine.resizeStructure('hall', { building });
  engine.placeStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 60,
    widthFeet: 50,
    heightFeet: 20,
  });
  const { world } = assemble();
  expect(world.findSupportBelow({ x: 65, y: 1, z: 60 }).positionFeet.y).toBe(-10);
  expect(world.findSupportBelow({ x: 75, y: 1, z: 70 }).positionFeet.y).toBe(0);
});
