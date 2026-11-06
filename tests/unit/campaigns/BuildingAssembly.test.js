import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import {
  captureBuildingContext,
  reconcileBuildingScene,
} from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { buildingLevels } from '../../../src/terrain/BuildingModel.js';

function fixture(roof = 'gable', kind = 'building') {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library };
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({
    id: 'house',
    kind,
    xFeet: 60,
    zFeet: 60,
    heightFeet: 30,
    lengthFeet: 30,
    widthFeet: 25,
    building: { roof },
  });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures = [];
  return { engine, scene, context };
}

test('a thirty-foot building owns three physically aligned connected floor grids at zero, ten and twenty feet', () => {
  const { scene, context } = fixture();
  const assembled = reconcileBuildingScene(scene, context);
  const floors = assembled.maps.filter((map) => map.building);
  expect(floors).toHaveLength(3);
  expect(floors.map((map) => map.originFeet.y)).toEqual([0, 10, 20]);
  const world = CampaignWorld.fromScene(assembled, context);
  expect(world.findSupportBelow({ x: 70, y: 15, z: 67.5 }).positionFeet.y).toBe(10);
  expect(world.findSupportBelow({ x: 70, y: 25, z: 67.5 }).positionFeet.y).toBe(20);
  const stairs = world.getConnections().filter((connection) => connection.kind === 'stairs');
  expect(stairs).toHaveLength(2);
  for (const connection of stairs) {
    const end = connection.ends[0];
    const map = world.getMap(end.mapId);
    const p = end.positionFeet;
    const plan = world.planConnection(connection.id, end.mapId, {
      x: (p.x * map.grid.tileWorldSize) / 5,
      y: (p.y * map.grid.tileWorldSize) / 5,
      z: (p.z * map.grid.tileWorldSize) / 5,
    });
    expect(plan.costFeet).toBeGreaterThan(10);
    expect(plan.targetMapId).toBe(connection.ends[1].mapId);
  }
  const windows = world.getConnections().filter((connection) => connection.kind === 'window');
  expect(windows.length).toBeGreaterThanOrEqual(9);
  expect(new Set(windows.map((connection) => connection.ends[1].mapId)).size).toBe(3);
  expect(decodeScene(encodeScene(assembled, context), context)).toEqual(assembled);
});

test.each(['flat', 'gable', 'hipped', 'conical', 'domed', 'none'])(
  '%s roofs are physical geometry above storeys, not an extra floor',
  (roof) => {
    const { scene, context } = fixture(roof);
    const assembled = reconcileBuildingScene(scene, context);
    const world = CampaignWorld.fromScene(assembled, context);
    expect(assembled.maps.filter((map) => map.building)).toHaveLength(3);
    const support = world.findSupportBelow(
      roof === 'none' ? { x: 70, y: 50, z: 67.5 } : { x: 60, y: 50, z: 60 }
    );
    expect(support.positionFeet.y).toBeCloseTo(roof === 'none' ? 20 : roof === 'flat' ? 30 : 35);
  }
);

test('wall-attached balconies add a real supported platform, railing and door to the selected upper floor', () => {
  const { engine, scene, context } = fixture();
  const spec = engine.geometry.getStructures()[0];
  engine.resizeStructure('house', {
    building: {
      ...spec.building,
      balconies: [
        { id: 'balcony-1', floor: 1, side: 'south', u: 0.5, widthFeet: 10, depthFeet: 5 },
      ],
    },
  });
  scene.terrain.geometry = engine.geometry.save();
  const assembled = reconcileBuildingScene(scene, context);
  const world = CampaignWorld.fromScene(assembled, context);
  const balcony = assembled.connections.find(
    (connection) => connection.building?.kind === 'balcony'
  );
  expect(balcony.kind).toBe('door');
  const outside = balcony.ends.find((end) => end.mapId === 'map-main');
  expect(
    world.findSupportBelow({ x: outside.positionFeet.x, y: 11, z: outside.positionFeet.z })
      .positionFeet.y
  ).toBe(10);
  const floor = assembled.maps.find((map) => map.id === balcony.ends[1].mapId);
  expect(floor.building.floor).toBe(1);
});

test('resizing preserves manual interior edits and floor identities instead of recreating an empty interior', () => {
  const { engine, scene, context } = fixture();
  const assembled = reconcileBuildingScene(scene, context);
  const floor = assembled.maps.find((map) => map.building?.floor === 1);
  floor.terrain.heights[4][4] = 1;
  engine.resizeStructure('house', { lengthFeet: 35 });
  assembled.maps[0].terrain.geometry = engine.geometry.save();
  const next = reconcileBuildingScene(assembled, context);
  const restored = next.maps.find((map) => map.id === floor.id);
  expect(restored).toBeDefined();
  expect(restored.terrain.heights.flat()).toContain(1);
  expect(next.maps.filter((map) => map.building)).toHaveLength(3);
});

test('stretching reframes a saved interior camera even when the building has no creatures', () => {
  const { engine, scene, context } = fixture();
  const assembled = reconcileBuildingScene(scene, context),
    floor = assembled.maps.find((map) => map.building?.floor === 1);
  const camera = { ...assembled.view.camera, target: { x: 5.5, y: 1, z: 4.5 } };
  assembled.view.cameras = [{ mapId: floor.id, camera }];
  const before = CampaignWorld.fromScene(assembled, context).toCampaignPosition(
    floor.id,
    camera.target
  );
  engine.resizeStructure('house', { lengthFeet: 35 });
  assembled.maps[0].terrain.geometry = engine.geometry.save();
  const next = reconcileBuildingScene(assembled, context),
    saved = next.view.cameras.find((entry) => entry.mapId === floor.id);
  expect(
    CampaignWorld.fromScene(next, context).toCampaignPosition(floor.id, saved.camera.target)
  ).toEqual(before);
});

test('compound floor restoration also restores its saved camera without applying the frame shift twice', () => {
  const { engine, scene, context } = fixture();
  const assembled = reconcileBuildingScene(scene, context),
    floor = assembled.maps.find((map) => map.building?.floor === 2);
  const cameras = [
    { mapId: floor.id, camera: { ...assembled.view.camera, target: { x: 4, y: 1, z: 4 } } },
  ];
  assembled.view.cameras = cameras;
  const archive = captureBuildingContext(assembled, 'map-main');
  engine.resizeStructure('house', { heightFeet: 10 });
  assembled.maps[0].terrain.geometry = engine.geometry.save();
  const removed = reconcileBuildingScene(assembled, context);
  expect(removed.view.cameras).toEqual([]);
  engine.undo();
  removed.maps[0].terrain.geometry = engine.geometry.save();
  const restored = reconcileBuildingScene(removed, context, {
    ownerMapId: 'map-main',
    restoreContext: archive,
  });
  expect(restored.view.cameras).toEqual(cameras);
});

test.each(['building', 'turret'])(
  '%s windows use real upper-floor five-foot climb crossings',
  (kind) => {
    const { scene, context } = fixture(kind === 'turret' ? 'conical' : 'gable', kind);
    const assembled = reconcileBuildingScene(scene, context),
      world = CampaignWorld.fromScene(assembled, context);
    const window = assembled.connections.find(
      (connection) => connection.kind === 'window' && connection.building.floor === 2
    );
    const inside = window.ends[1],
      map = world.getMap(inside.mapId),
      scale = map.grid.tileWorldSize / 5;
    const out = world.planConnection(window.id, inside.mapId, {
      x: inside.positionFeet.x * scale,
      y: 0,
      z: inside.positionFeet.z * scale,
    });
    expect(out.costFeet).toBe(5);
    expect(['grip', 'ledge']).toContain(out.targetPose.kind);
    const back = world.planConnection(
      window.id,
      'map-main',
      out.targetWorld,
      out.targetPose.kind === 'grip'
        ? { surfaceGrip: out.targetPose.grip }
        : { openingHold: window.id }
    );
    expect(back.costFeet).toBe(5);
    expect(back.targetMapId).toBe(inside.mapId);
  }
);

test('a partially approached staircase can finish from its real tread without returning to the foot', () => {
  const { scene, context } = fixture();
  const assembled = reconcileBuildingScene(scene, context),
    world = CampaignWorld.fromScene(assembled, context);
  const stairs = assembled.connections.find((connection) => connection.kind === 'stairs');
  const map = world.getMap(stairs.ends[0].mapId),
    ref = map.building,
    unit = map.grid.tileWorldSize / 5;
  const plan = world.planConnection(stairs.id, map.id, {
    x: (ref.offsetX + 7.5) * unit,
    y: 2.5 * unit,
    z: (ref.offsetZ + 7.5) * unit,
  });
  expect(plan.costFeet).toBeLessThanOrEqual(30 + 1e-6);
  expect(plan.targetMapId).toBe(stairs.ends[1].mapId);
});

test.each(['town', 'city', 'castle', 'ruinedTown', 'ruinedUrban', 'ruinedCastle'])(
  '%s generation produces complete bounded assemblies with usable entrances and stairs',
  (biome) => {
    const { engine, scene, context } = fixture();
    engine.removeStructure('house');
    engine.generateBiomeElevation(biome, { seed: 42 });
    scene.terrain.heights = engine.save().heights;
    scene.terrain.geometry = engine.geometry.save();
    const assembled = reconcileBuildingScene(scene, context),
      world = CampaignWorld.fromScene(assembled, context);
    const buildings = engine.geometry.getStructures().filter((spec) => spec.building);
    expect(buildings.length).toBeGreaterThan(0);
    expect(assembled.maps.length).toBe(
      1 + buildings.reduce((count, spec) => count + buildingLevels(spec).length, 0)
    );

    expect(assembled.maps.length).toBeLessThanOrEqual(17);
    expect(assembled.connections.length).toBeLessThan(200);
    for (const map of assembled.maps.filter((entry) => entry.building)) {
      expect(map.grid.cols).toBeGreaterThanOrEqual(5);
      expect(map.grid.rows).toBeGreaterThanOrEqual(5);
      if (map.building.widthFeet === 15)
        expect(world.getMapGeometry(map.id).getSolidSpansAt(24, 24)).toEqual([]);
    }
    for (const connection of assembled.connections.filter((c) =>
      ['entry', 'stairs'].includes(c.building?.kind)
    )) {
      const end = connection.ends[0],
        map = world.getMap(end.mapId),
        scale = map.grid.tileWorldSize / 5;
      let plan;
      try {
        plan = world.planConnection(connection.id, end.mapId, {
          x: end.positionFeet.x * scale,
          y: end.positionFeet.y * scale,
          z: end.positionFeet.z * scale,
        });
      } catch (error) {
        error.message = `${connection.building.structureId} (${connection.building.kind}): ${error.message}`;
        throw error;
      }
      expect(plan.costFeet).toBe(connection.kind === 'stairs' ? 35 : 5);
    }
  }
);

test.each(['forestTemperate', 'desertHot', 'grassland'])(
  'intact and broken %s landmarks retain usable connected building entrances on their actual terrain',
  (biomeKey) => {
    const found = new Set();
    for (let seed = 1; seed <= 32 && found.size < 2; seed++) {
      const { engine, scene, context } = fixture();
      engine.removeStructure('house');
      engine.generateBiomeElevation(biomeKey, { seed });
      const buildings = engine.geometry.getStructures().filter((spec) => spec.building);
      if (!buildings.length) continue;
      scene.terrain.heights = engine.save().heights;
      scene.terrain.geometry = engine.geometry.save();
      const assembled = reconcileBuildingScene(scene, context),
        world = CampaignWorld.fromScene(assembled, context);
      for (const spec of buildings) {
        found.add(spec.ruined);
        const entry = world
          .getConnections()
          .find(
            (connection) =>
              connection.building?.structureId === spec.id && connection.building.kind === 'entry'
          );
        const end = entry.ends[0],
          map = world.getMap(end.mapId),
          scale = map.grid.tileWorldSize / 5;
        const plan = world.planConnection(entry.id, end.mapId, {
          x: end.positionFeet.x * scale,
          y: end.positionFeet.y * scale,
          z: end.positionFeet.z * scale,
        });
        expect(plan.costFeet).toBe(5);
      }
    }
    expect(found).toEqual(new Set([false, true]));
  }
);
