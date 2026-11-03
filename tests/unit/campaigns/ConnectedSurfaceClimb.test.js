import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';
import {
  openingSurfaceGrip,
  planSurfaceClimb,
  isSurfaceGripValid,
} from '../../../src/campaigns/CampaignSurfaceClimb.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const characters = ['Flyer', 'Climber', 'Observer'].map((name) =>
    library.get(library.create(name))
  );
  const world = CampaignWorld.fromScene(
    createOpeningsTravelScene({ ruleset: '2014', characters }),
    { ruleset: '2014', library }
  );
  const position = { x: 10.8, y: 3.4, z: 6.5 };
  const grip = openingSurfaceGrip(world, 'map-main', position, 'high-window');
  return { world, position, grip };
}

test('a saved wall grip is physical and independent of a window reference', () => {
  const { world, position, grip } = fixture();
  const creature = { mapId: 'map-main', pose: { kind: 'grip', world: position, grip } };
  expect(isSurfaceGripValid(world.save().maps, creature, (id) => world.getMapGeometry(id))).toBe(
    true
  );
  creature.pose.grip.pointFeet.y += 1;
  expect(isSurfaceGripValid(world.save().maps, creature, (id) => world.getMapGeometry(id))).toBe(
    false
  );
});

test('a physical grip survives removal of the window connection while its supporting wall remains', () => {
  const { world, position, grip } = fixture();
  const saved = world.save();
  const actor = saved.creatures[0];
  actor.mapId = 'map-main';
  actor.gridX = 10;
  actor.gridY = 6;
  actor.pose = { kind: 'grip', world: position, grip };
  saved.connections = saved.connections.filter((connection) => connection.id !== 'high-window');
  world.acceptCheckpoint(saved);
  expect(world.getCreature(actor.id).pose.kind).toBe('grip');
});

test('physical grips preserve map scale and rotation instead of treating render units as feet', () => {
  const { world } = fixture();
  const saved = world.save();
  const outside = saved.maps.find((map) => map.id === 'map-main');
  outside.grid.tileWorldSize = 2;
  outside.quarterTurns = 1;
  for (const actor of saved.creatures.filter((entry) => entry.mapId === outside.id))
    for (const axis of ['x', 'y', 'z']) actor.pose.world[axis] *= 2;
  world.acceptCheckpoint(saved);
  const position = { x: 21.6, y: 6.8, z: 13 };
  const grip = openingSurfaceGrip(world, outside.id, position, 'high-window');
  expect(grip.normal).toEqual({ x: -1, y: 0, z: 0 });
  expect(
    isSurfaceGripValid(
      world.save().maps,
      {
        mapId: outside.id,
        pose: { kind: 'grip', world: position, grip },
      },
      (id) => world.getMapGeometry(id)
    )
  ).toBe(true);
});

test('a wall click moves to a paid physical hold without requiring a window action', () => {
  const { world, position, grip } = fixture();
  const plan = planSurfaceClimb(
    world,
    'map-main',
    position,
    grip,
    {
      point: { x: 10.9, y: 3.8, z: 6.5 },
      normal: { x: -1, y: 0, z: 0 },
    },
    { allowanceFeet: 30 }
  );
  expect(plan.targetWorld.y).toBeCloseTo(2.8);
  expect(plan.costFeet).toBe(10);
  expect(plan.points.at(-1).pose.kind).toBe('grip');
  expect(plan.gapFalls).toEqual([]);
});

test('vertical descent identifies real window gaps and the first valid wall catch below each gap', () => {
  const { world, position, grip } = fixture();
  const plan = planSurfaceClimb(
    world,
    'map-main',
    position,
    grip,
    {
      point: { x: 10.8, y: 0, z: 6.5 },
      normal: { x: 0, y: 1, z: 0 },
    },
    { allowanceFeet: 30 }
  );
  expect(plan.gapFalls).toHaveLength(1);
  expect(plan.gapFalls[0]).toBeCloseTo(5, 3);
  expect(plan.points.find((point) => point.kind === 'catch').world.y).toBeCloseTo(1.4);
  expect(plan.points.at(-1).pose.kind).toBe('ground');
  expect(plan.targetWorld.y).toBe(0);
  expect(plan.costFeet).toBe(20);
});

test('a partial climb stops on the wall at its allowance rather than teleporting to the end', () => {
  const { world, position, grip } = fixture();
  const plan = planSurfaceClimb(
    world,
    'map-main',
    position,
    grip,
    {
      point: { x: 10.9, y: 3.8, z: 6.5 },
      normal: { x: -1, y: 0, z: 0 },
    },
    { allowanceFeet: 5 }
  );
  expect(plan.costFeet).toBe(5);
  expect(plan.targetWorld.y).toBeCloseTo(2.9);
  expect(plan.points.at(-1).pose.kind).toBe('grip');
});

test('a floor click cannot teleport a held creature through a wall onto a different map', () => {
  const { world, position, grip } = fixture();
  expect(() =>
    planSurfaceClimb(
      world,
      'map-main',
      position,
      grip,
      {
        point: { x: 11.5, y: 2, z: 6.5 },
        normal: { x: 0, y: 1, z: 0 },
      },
      { allowanceFeet: 30 }
    )
  ).toThrow(/opening|beside this wall/i);
});
