import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';
import { connectionFlightEntry } from '../../../src/campaigns/CampaignConnections.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const characters = ['Sky Scout', 'Window Climber', 'Ground Observer'].map((name) =>
    library.get(library.create(name))
  );
  return CampaignWorld.fromScene(createOpeningsTravelScene({ ruleset: '2014', characters }), {
    ruleset: '2014',
    library,
  });
}

test('a climbable opening must reference one actual carved aperture rather than unrelated solids', () => {
  const world = fixture();
  const saved = world.save();
  saved.connections
    .find((connection) => connection.id === 'high-window')
    .feature.volumeIds.push('roof');
  expect(() => world.acceptCheckpoint(saved)).toThrow(/connections/i);
});

test('a normal top-floor window crossing costs five feet in either direction without charging the mantle arc', () => {
  const world = fixture();
  const outward = world.planConnection('high-window', 'high-floor', { x: 0.5, y: 0, z: 2.5 });
  expect(outward.costFeet).toBe(5);
  const inward = world.planConnection('high-window', 'map-main', outward.targetWorld, {
    openingHold: 'high-window',
  });
  expect(inward.costFeet).toBe(5);
  expect(outward.openingCrossing.direction).toBe('out');
  expect(inward.openingCrossing.direction).toBe('in');
});

test('a hold at the sill need not move to the window centre before entering', () => {
  const world = fixture();
  const plan = world.planConnection(
    'high-window',
    'map-main',
    { x: 10.8, y: 3.4, z: 5.9 },
    {
      openingHold: 'high-window',
    }
  );
  expect(plan.targetMapId).toBe('high-floor');
  expect(plan.costFeet).toBe(5);
});

test('climbing the last foot to the sill is charged separately from the five-foot crossing', () => {
  const world = fixture();
  const plan = world.planConnection(
    'high-window',
    'map-main',
    { x: 10.8, y: 3.2, z: 6.5 },
    {
      openingHold: 'high-window',
      allowanceFeet: 10,
    }
  );
  expect(plan.targetMapId).toBe('high-floor');
  expect(plan.costFeet).toBe(10);
});

test('an unsupported bare wall opening uses the same safe exterior hold as a window', () => {
  const world = fixture();
  const plan = world.planConnection('high-wall-opening', 'high-floor', { x: 7.5, y: 0, z: 5.5 });
  expect(plan.targetMapId).toBe('map-main');
  expect(plan.targetPose.kind).toBe('ledge');
  expect(plan.targetWorld.x).toBeCloseTo(19.2);
  expect(plan.targetWorld.y).toBe(3);
  expect(plan.costFeet).toBe(5);
});

test('flight into the balcony doorway clears the real platform instead of landing under the lintel', () => {
  const world = fixture();
  const connection = world.getConnections().find((entry) => entry.id === 'balcony-door');
  const entry = connectionFlightEntry(world, connection, 'map-main', { x: 8.5, y: 1, z: 10.5 });
  expect(entry.y).toBeCloseTo(2.4);
  const plan = world.planConnection('balcony-door', 'map-main', entry, { travelMode: 'fly' });
  expect(plan.targetMapId).toBe('upper-floor');
  expect(plan.targetWorld.y).toBeCloseTo(0.4);
  expect(plan.targetPose.kind).toBe('flight');
});

test('a high exterior climb can make paid progress into safe holds across multiple turns', () => {
  const world = fixture();
  const first = world.planConnection(
    'high-window',
    'map-main',
    { x: 10.5, y: 0, z: 5.4 },
    {
      allowanceFeet: 30,
    }
  );
  expect(first.targetPose.kind).toBe('ledge');
  expect(first.targetWorld.y).toBeCloseTo(2.85);
  expect(first.costFeet).toBe(30);
  expect(first.actionLabel).toBe('Climb toward window');
  const second = world.planConnection('high-window', 'map-main', first.targetWorld, {
    openingHold: 'high-window',
    allowanceFeet: 20,
  });
  expect(second.targetPose.kind).toBe('ledge');
  expect(second.targetWorld.y).toBeCloseTo(3.4);
  expect(second.targetWorld.z).toBe(6.5);
  expect(second.costFeet).toBe(20);
  const third = world.planConnection('high-window', 'map-main', second.targetWorld, {
    openingHold: 'high-window',
    allowanceFeet: 30,
  });
  expect(third.targetMapId).toBe('high-floor');
  expect(third.targetPose.kind).toBe('ground');
  expect(third.costFeet).toBe(5);
});

test('a ground-level window can be climbed into and back out onto supported ground', () => {
  const world = fixture();
  const inward = world.planConnection(
    'ground-window',
    'map-main',
    { x: 10.5, y: 0, z: 6.5 },
    {
      allowanceFeet: 30,
    }
  );
  expect(inward.targetMapId).toBe('ground-floor');
  expect(inward.targetPose.kind).toBe('ground');
  expect(inward.costFeet).toBe(5);
  const outward = world.planConnection('ground-window', 'ground-floor', inward.targetWorld);
  expect(outward.targetMapId).toBe('map-main');
  expect(outward.targetPose.kind).toBe('ground');
  expect(outward.costFeet).toBe(5);
});

test('letting go plans a zero-movement physical fall to the real surface below the window', () => {
  const world = fixture();
  const outward = world.planConnection('high-window', 'high-floor', { x: 0.5, y: 0, z: 2.5 });
  const drop = world.planConnection('high-window', 'map-main', outward.targetWorld, {
    openingHold: 'high-window',
    action: 'drop',
    allowanceFeet: 0,
  });
  expect(drop.actionLabel).toBe('Let go');
  expect(drop.costFeet).toBe(0);
  expect(drop.fall.distanceFeet).toBeCloseTo(17);
  expect(drop.targetMapId).toBe('map-main');
  expect(drop.targetWorld.x).toBeCloseTo(outward.targetWorld.x);
  expect(drop.targetWorld.y).toBe(0);
  expect(drop.targetWorld.z).toBe(outward.targetWorld.z);
});

test('climbing down a high window uses the remaining budget and keeps a safe hold between turns', () => {
  const world = fixture();
  const outward = world.planConnection('high-window', 'high-floor', { x: 0.5, y: 0, z: 2.5 });
  const first = world.planConnection('high-window', 'map-main', outward.targetWorld, {
    openingHold: 'high-window',
    action: 'down',
    allowanceFeet: 30,
  });
  expect(first.targetMapId).toBe('map-main');
  expect(first.targetPose.kind).toBe('ledge');
  expect(first.targetWorld.y).toBeCloseTo(1.5);
  expect(first.targetWorld.z).toBeCloseTo(5.4);
  expect(first.costFeet).toBe(30);
  const second = world.planConnection('high-window', 'map-main', first.targetWorld, {
    openingHold: 'high-window',
    action: 'down',
    allowanceFeet: 30,
  });
  expect(second.targetPose.kind).toBe('ground');
  expect(second.targetWorld.y).toBe(0);
  expect(second.costFeet).toBe(20);
});

test('a held climber can climb back through the same window without falling or losing elevation', () => {
  const world = fixture();
  const outward = world.planConnection('high-window', 'high-floor', { x: 0.5, y: 0, z: 2.5 });
  const inward = world.planConnection('high-window', 'map-main', outward.targetWorld, {
    openingHold: 'high-window',
    allowanceFeet: 30,
  });
  expect(inward.targetMapId).toBe('high-floor');
  expect(inward.targetWorld).toEqual({ x: 0.5, y: 0, z: 2.5 });
  expect(inward.targetPose.kind).toBe('ground');
  expect(inward.costFeet).toBe(5);
  expect(inward.actionLabel).toBe('Climb in');
});

test('a window hold is a saved physical attachment and cannot reference a missing opening', () => {
  const world = fixture();
  const plan = world.planConnection('high-window', 'high-floor', { x: 0.5, y: 0, z: 2.5 });
  const saved = world.save();
  const actor = saved.creatures[1];
  actor.mapId = plan.targetMapId;
  actor.gridX = Math.floor(plan.targetWorld.x);
  actor.gridY = Math.floor(plan.targetWorld.z);
  actor.pose = plan.targetPose;
  world.acceptCheckpoint(saved);
  expect(world.getCreature(actor.id).pose.kind).toBe('ledge');
  const invalid = world.save();
  invalid.creatures[1].pose.openingId = 'missing-window';
  expect(() => world.acceptCheckpoint(invalid)).toThrow(/ledge|opening/i);
});

test('climbing out of an unsupported high window ends in a paid exterior hold rather than a fall', () => {
  const world = fixture();
  const plan = world.planConnection(
    'high-window',
    'high-floor',
    { x: 0.5, y: 0, z: 2.5 },
    {
      travelMode: 'ground',
      allowanceFeet: 30,
    }
  );
  expect(plan.targetMapId).toBe('map-main');
  expect(plan.targetWorld.x).toBeCloseTo(10.8);
  expect(plan.targetWorld.y).toBeCloseTo(3.4);
  expect(plan.targetWorld.z).toBe(6.5);
  expect(plan.targetPose.kind).toBe('ledge');
  expect(plan.targetPose.openingId).toBe('high-window');
  expect(plan.costFeet).toBe(5);
  expect(plan.actionLabel).toBe('Climb out');
});

test('flight crosses a high window at its actual elevation in both directions', () => {
  const world = fixture();
  const inward = world.planConnection(
    'high-window',
    'map-main',
    { x: 10.5, y: 4.4, z: 6.5 },
    {
      travelMode: 'fly',
    }
  );
  expect(inward.targetMapId).toBe('high-floor');
  expect(inward.targetWorld.x).toBe(0.5);
  expect(inward.targetWorld.y).toBeCloseTo(0.4);
  expect(inward.targetWorld.z).toBe(2.5);
  expect(inward.costFeet).toBe(5);
  const outward = world.planConnection('high-window', 'high-floor', inward.targetWorld, {
    travelMode: 'fly',
  });
  expect(outward.targetMapId).toBe('map-main');
  expect(outward.targetWorld.x).toBe(10.5);
  expect(outward.targetWorld.y).toBeCloseTo(4.4);
  expect(outward.targetWorld.z).toBe(6.5);
  expect(outward.costFeet).toBe(5);
});

test('the opening proof provides real balcony support, three window heights and a wall arch', () => {
  const world = fixture();
  const balcony = world.findSupportBelow({ x: 52.5, y: 15, z: 52.5 }, { mapId: 'map-main' });
  expect(balcony.mapId).toBe('map-main');
  expect(balcony.positionFeet.y).toBe(10);
  expect(world.getMap('high-floor').originFeet.y).toBe(20);
  expect(world.getConnections().filter((connection) => connection.kind === 'window')).toHaveLength(
    4
  );
  const arch = world.planConnection('open-arch', 'map-main', { x: 15.5, y: 0, z: 3.5 });
  expect(arch.targetMapId).toBe('ground-floor');
  expect(arch.costFeet).toBe(5);
});
