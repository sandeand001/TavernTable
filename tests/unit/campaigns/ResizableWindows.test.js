import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import {
  connectionFeatureBounds,
  connectionEntryDistance,
} from '../../../src/campaigns/CampaignConnections.js';
import { openingFrame } from '../../../src/campaigns/CampaignOpeningClimb.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';

function fixture(
  window = {
    id: 'tall',
    floor: 0,
    side: 'east',
    u: 0.5,
    widthFeet: 15,
    heightFeet: 35,
    sillFeet: 2,
  },
  kind = 'building',
  angleRadians = 0
) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library },
    engine = new TerrainEngine(25, 25);
  engine.placeStructure({
    id: 'house',
    kind,
    angleRadians,
    xFeet: 60,
    zFeet: 60,
    heightFeet: 40,
    lengthFeet: 40,
    widthFeet: 30,
    building: { autoWindows: false, windows: [window] },
  });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures = [];
  const assembled = reconcileBuildingScene(scene, context);
  return { engine, context, assembled, world: CampaignWorld.fromScene(assembled, context) };
}

test('one tall window has a separate clipped interaction on every reached storey without removing floor slabs', () => {
  const { world, assembled } = fixture();
  const windows = world.getConnections().filter((c) => c.kind === 'window');
  expect(windows).toHaveLength(4);
  expect(windows.map((c) => c.building.floor)).toEqual([0, 1, 2, 3]);
  expect(windows.every((c) => c.building.featureId === 'window-tall')).toBe(true);
  expect(new Set(windows.map((c) => c.id)).size).toBe(4);
  expect(
    windows.map((c) => connectionFeatureBounds(world, c)[0]).map((b) => [b.min.y, b.max.y])
  ).toEqual([
    [2, 9.5],
    [10, 19.5],
    [20, 29.5],
    [30, 37],
  ]);
  for (const map of assembled.maps.filter((m) => m.building))
    expect(world.getMapGeometry(map.id).findSupport(37.5, 15, { belowFeet: 0 }).heightFeet).toBe(0);
});

test.each([1, 2, 3])(
  'a tall-window exit on floor %i grips its actual slab edge and returns for five feet',
  (floor) => {
    const { world } = fixture();
    const window = world
      .getConnections()
      .find((c) => c.kind === 'window' && c.building.floor === floor);
    expect(window).toBeDefined();
    const end = window.ends[1];
    const point = { x: end.positionFeet.x / 5, y: 0, z: end.positionFeet.z / 5 };
    const out = world.planConnection(window.id, end.mapId, point);
    expect(out.costFeet).toBe(5);
    expect(out.targetPose.kind).toBe('grip');
    expect(out.targetPose.grip.mapId).toBe(end.mapId);
    expect(world.isSurfaceGripValid('map-main', out.targetWorld, out.targetPose.grip)).toBe(true);
    const back = world.planConnection(window.id, 'map-main', out.targetWorld, {
      surfaceGrip: out.targetPose.grip,
    });
    expect(back.costFeet).toBe(5);
    expect(back.targetMapId).toBe(end.mapId);
  }
);

test('a narrow window uses its wall direction rather than confusing width with wall depth', () => {
  const { world } = fixture({
    id: 'narrow',
    floor: 2,
    side: 'east',
    u: 0.5,
    widthFeet: 1.5,
    heightFeet: 6,
    sillFeet: 1,
  });
  const window = world.getConnections().find((c) => c.kind === 'window');
  expect(openingFrame(world, window).thin).toBe('x');
  const end = window.ends[1];
  expect(
    world.planConnection(window.id, end.mapId, {
      x: end.positionFeet.x / 5,
      y: 0,
      z: end.positionFeet.z / 5,
    }).costFeet
  ).toBe(5);
});

test.each([
  [0.5, 6],
  [5, 1],
])(
  'a %s by %s foot window is real geometry but rejects an ordinary creature for clearance',
  (widthFeet, heightFeet) => {
    const { world } = fixture({
      id: 'small',
      floor: 2,
      side: 'east',
      u: 0.5,
      widthFeet,
      heightFeet,
      sillFeet: 2,
    });
    const window = world.getConnections().find((c) => c.kind === 'window'),
      end = window.ends[1];
    expect(() =>
      world.planConnection(window.id, end.mapId, {
        x: end.positionFeet.x / 5,
        y: 0,
        z: end.positionFeet.z / 5,
      })
    ).toThrow(/clearance|too small/i);
  }
);

test('stretching away from an exterior slab grip reframes the contact owner without moving the creature', () => {
  const { world, assembled, engine, context } = fixture();
  const window = world.getConnections().find((c) => c.kind === 'window' && c.building.floor === 2),
    end = window.ends[1];
  const out = world.planConnection(window.id, end.mapId, {
    x: end.positionFeet.x / 5,
    y: 0,
    z: end.positionFeet.z / 5,
  });
  const actor = {
    ...sceneState().creatures[0],
    mapId: 'map-main',
    pose: out.targetPose,
    gridX: Math.floor(out.targetWorld.x),
    gridY: Math.floor(out.targetWorld.z),
  };
  assembled.creatures = [actor];
  const original = CampaignWorld.fromScene(assembled, context).getCampaignPosition(actor.id);
  engine.resizeStructure('house', { lengthFeet: 45, xFeet: 57.5 });
  assembled.maps[0].terrain.geometry = engine.geometry.save();
  const resized = reconcileBuildingScene(assembled, context);
  const next = CampaignWorld.fromScene(resized, context),
    saved = resized.creatures[0];
  expect(next.getCampaignPosition(actor.id)).toEqual(original);
  expect(next.isSurfaceGripValid(saved.mapId, saved.pose.world, saved.pose.grip)).toBe(true);
});

test('a wide window crosses at the nearby clear portion instead of charging a walk back to its centre', () => {
  const { world } = fixture();
  const window = world.getConnections().find((c) => c.kind === 'window' && c.building.floor === 3),
    end = window.ends[1];
  const point = { x: end.positionFeet.x / 5, y: 0, z: (end.positionFeet.z + 6.5) / 5 };
  expect(connectionEntryDistance(world, window, end.mapId, point)).toBeCloseTo(0);
  const out = world.planConnection(window.id, end.mapId, point);
  expect(out.costFeet).toBe(5);
  expect(out.targetWorld.z).toBeCloseTo(66.5 / 5);
  const back = world.planConnection(window.id, 'map-main', out.targetWorld, {
    surfaceGrip: out.targetPose.grip,
  });
  expect(back.costFeet).toBe(5);
  expect(back.targetWorld.z).toBeCloseTo(point.z);
});

test('flying through a wide window retains the actor’s clear lateral position and altitude', () => {
  const { world } = fixture();
  const window = world.getConnections().find((c) => c.kind === 'window' && c.building.floor === 3),
    end = window.ends[1];
  const point = { x: end.positionFeet.x / 5, y: 0.4, z: (end.positionFeet.z + 6.5) / 5 };
  const plan = world.planConnection(window.id, end.mapId, point, { travelMode: 'fly' });
  expect(plan.costFeet).toBe(5);
  expect(plan.targetWorld).toMatchObject({ y: 6.4, z: 66.5 / 5 });
});

test.each(['drop', 'down'])(
  'a small opening still permits %s from a valid physical hold',
  (action) => {
    const { world } = fixture({
      id: 'small',
      floor: 2,
      side: 'east',
      u: 0.5,
      widthFeet: 0.5,
      heightFeet: 1,
      sillFeet: 2,
    });
    const connection = world.getConnections().find((c) => c.kind === 'window');
    const position = world.toMapPosition('map-main', openingFrame(world, connection).grip);
    const grip = world.openingSurfaceGrip('map-main', position, connection.id);
    const plan = world.planConnection(connection.id, 'map-main', position, {
      action,
      surfaceGrip: grip,
    });
    expect(plan.targetMapId).toBe('map-main');
    expect(plan.targetWorld.y).toBe(0);
    expect(plan.costFeet).toBe(action === 'drop' ? 0 : 40);
  }
);

test.each(['north', 'east', 'south', 'west'])(
  'a wide %s window on a rotated round base retains a usable centre and floor-edge hold',
  (side) => {
    const { world } = fixture(
      { id: 'round-wide', floor: 1, side, u: 0.5, widthFeet: 20, heightFeet: 15, sillFeet: 2 },
      'turret',
      Math.PI / 2
    );

    const connection = world
        .getConnections()
        .find((c) => c.kind === 'window' && c.building.floor === 2),
      end = connection.ends[1];
    const out = world.planConnection(connection.id, end.mapId, {
      x: end.positionFeet.x / 5,
      y: 0,
      z: end.positionFeet.z / 5,
    });
    expect(out.costFeet).toBe(5);
    expect(out.targetPose.kind).toBe('grip');
    const back = world.planConnection(connection.id, 'map-main', out.targetWorld, {
      surfaceGrip: out.targetPose.grip,
    });
    expect(back.costFeet).toBe(5);
    expect(back.targetMapId).toBe(end.mapId);
  }
);
