import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { decodeScene, encodeScene } from '../../../src/campaigns/CampaignScene.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { sceneState } from '../../helpers/sceneState.js';
import { visiblePlayerMapIds } from '../../../src/campaigns/CreatureVisibility.js';
import { nearbyDoors } from '../../../src/campaigns/CampaignDoors.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  scene.creatures[0].gridX = 0;
  scene.creatures[0].gridY = 2;
  scene.creatures[0].pose.world = { x: 0.5, y: 0, z: 2.5 };
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'wall',
    bounds: { min: { x: 5, y: 0, z: 5 }, max: { x: 6, y: 10, z: 20 } },
  });
  geometry.carve({
    id: 'doorway',
    bounds: { min: { x: 4.5, y: 0, z: 10 }, max: { x: 6.5, y: 7, z: 15 } },
  });
  scene.version = 2;
  scene.terrain.geometry = geometry.save();
  const context = { ruleset: '2014', library };
  const world = CampaignWorld.fromScene(scene, context);
  world.addMap({
    id: 'inside',
    name: 'Inn interior',
    originFeet: { x: 5, y: 0, z: 5 },
    quarterTurns: 0,
    base: 'floor',
    grid: scene.grid,
    terrain: { ...sceneState().terrain, heights: scene.terrain.heights },
  });
  const door = {
    id: 'inn-door',
    name: 'Inn doorway',
    kind: 'door',
    open: true,
    feature: { mapId: 'map-main', volumeIds: ['doorway'] },
    ends: [
      { mapId: 'map-main', positionFeet: { x: 2.5, y: 0, z: 12.5 } },
      { mapId: 'inside', positionFeet: { x: 2.5, y: 0, z: 7.5 } },
    ],
    pathFeet: [],
  };
  return { world, door, context };
}

test('doors default to closed and block both sight and physical travel', () => {
  const { world, door } = fixture();
  delete door.open;
  world.addConnection(door);
  expect(world.hasLineOfSight({ x: 2.5, y: 0, z: 12.5 }, { x: 7.5, y: 0, z: 12.5 })).toBe(false);
  expect(() => world.planConnection('inn-door', 'map-main', { x: 0.5, y: 0, z: 2.5 })).toThrow(
    /closed/i
  );
});

test('opening, closing and locking a door updates physical sight and survives reopening', () => {
  const { world, door, context } = fixture();
  world.addConnection({ ...door, open: false });
  const sight = () => world.hasLineOfSight({ x: 2.5, y: 0, z: 12.5 }, { x: 7.5, y: 0, z: 12.5 });
  world.setDoorState(door.id, { open: true });
  expect(sight()).toBe(true);
  expect(world.planConnection(door.id, 'map-main', { x: 0.5, y: 0, z: 2.5 }).costFeet).toBe(5);
  world.setDoorState(door.id, { open: false, locked: true });
  expect(sight()).toBe(false);
  expect(() => world.setDoorState(door.id, { open: true })).toThrow(/locked/i);
  const reopened = CampaignWorld.fromScene(
    decodeScene(encodeScene(world.save(), context), context),
    context
  );
  expect(reopened.getConnections()[0]).toMatchObject({ open: false, locked: true });
  reopened.setDoorState(door.id, { locked: false });
  reopened.setDoorState(door.id, { open: true });
  expect(reopened.getConnections()[0]).toMatchObject({ open: true, locked: false });
});

test('terrain surface sight targets the surface itself rather than imaginary creature heights', () => {
  const { world, door } = fixture();
  world.addConnection(door);
  const floorBehindWall = { x: 7.5, y: 0, z: 17.5 };
  expect(world.hasSurfaceLineOfSight({ x: 2.5, y: 0, z: 12.5 }, floorBehindWall)).toBe(false);
  expect(world.hasSurfaceLineOfSight({ x: 2.5, y: 0, z: 12.5 }, { x: 7.5, y: 0, z: 12.5 })).toBe(
    true
  );
});

test('unentered rooms are hidden until an open doorway provides sight, and closing hides them again', () => {
  const { world, door } = fixture();
  world.addConnection({ ...door, open: false });
  const observer = { mapId: 'map-main', world: { x: 0.5, y: 0, z: 2.5 } };
  expect(visiblePlayerMapIds(world, observer).has('inside')).toBe(false);
  world.setDoorState(door.id, { open: true });
  expect(visiblePlayerMapIds(world, observer).has('inside')).toBe(true);
  world.setDoorState(door.id, { open: false });
  expect(visiblePlayerMapIds(world, observer).has('inside')).toBe(false);
  expect(
    visiblePlayerMapIds(world, { mapId: 'inside', world: { x: 0.5, y: 0, z: 1.5 } }).has('inside')
  ).toBe(true);
});

test('door interaction requires an unobstructed reach of at most five physical feet', () => {
  const { world, door } = fixture();
  world.addConnection({ ...door, open: false });
  const observer = (x, z = 2.5) => ({ mapId: 'map-main', world: { x, y: 0, z } });
  expect(nearbyDoors(world, observer(0.1)).map(({ id }) => id)).toEqual([door.id]);
  expect(nearbyDoors(world, observer(0.07))).toEqual([]);
  expect(nearbyDoors(world, observer(0.5, 3.5))).toEqual([]);
});

test('a saved doorway plans five feet of real travel in both directions without moving a creature', () => {
  const { world, door, context } = fixture();
  const before = world.getCreature('token-1');
  world.addConnection(door);
  const outward = world.planConnection('inn-door', 'map-main', before.pose.world);
  expect(outward.targetMapId).toBe('inside');
  expect(outward.targetWorld).toEqual({ x: 0.5, y: 0, z: 1.5 });
  expect(outward.costFeet).toBe(5);
  const inward = world.planConnection('inn-door', 'inside', outward.targetWorld);
  expect(inward.targetMapId).toBe('map-main');
  expect(inward.targetWorld).toEqual(before.pose.world);
  expect(inward.costFeet).toBe(5);
  expect(world.getCreature('token-1')).toEqual(before);
  const reopened = CampaignWorld.fromScene(
    decodeScene(encodeScene(world.save(), context), context),
    context
  );
  expect(reopened.getConnections('inside')).toEqual([door]);
});

test('a doorway cannot bridge unsupported space between its supported endpoints', () => {
  const { world, door } = fixture();
  world.addConnection(door);
  const scene = world.save();
  scene.maps[0].terrain.geometry.volumes.push({
    id: 'floor-gap',
    layerId: 'ground',
    operation: 'subtract',
    bounds: { min: { x: 4, y: -1, z: 10 }, max: { x: 6, y: 1, z: 15 } },
  });

  world.acceptCheckpoint(scene);
  expect(() => world.planConnection('inn-door', 'map-main', { x: 0.5, y: 0, z: 2.5 })).toThrow(
    /unsupported/i
  );
});

test.each([
  [0, true],
  [2, false],
])(
  'a destination creature at map-local height %s blocks only the same physical floor',
  (y, blocked) => {
    const { world, door } = fixture();
    world.addConnection(door);
    const plan = () =>
      world.planConnection(
        'inn-door',
        'map-main',
        { x: 0.5, y: 0, z: 2.5 },
        {
          occupants: [{ mapId: 'inside', world: { x: 0.5, y, z: 1.5 } }],
        }
      );
    if (blocked) expect(plan).toThrow(/another creature/i);
    else expect(plan().costFeet).toBe(5);
  }
);

test('flight through a doorway preserves physical altitude and plans an airborne destination', () => {
  const { world, door } = fixture();
  world.addConnection(door);
  const plan = world.planConnection(
    'inn-door',
    'map-main',
    { x: 0.5, y: 0.4, z: 2.5 },
    {
      travelMode: 'fly',
    }
  );
  expect(plan.targetMapId).toBe('inside');
  expect(plan.targetWorld).toEqual({ x: 0.5, y: 0.4, z: 1.5 });
  expect(plan.targetPose).toEqual({ kind: 'flight', world: plan.targetWorld });
  expect(plan.costFeet).toBe(5);
  expect(plan.travelMode).toBe('fly');
});

test('a connection cannot refer to a missing opening or staircase geometry feature', () => {
  const { world, door } = fixture();
  expect(() =>
    world.addConnection({
      ...door,
      feature: { mapId: 'map-main', volumeIds: ['missing-opening'] },
    })
  ).toThrow(/connections/i);
});
