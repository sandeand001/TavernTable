import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { DEFAULT_LOCATION_ID } from '../../../src/campaigns/CampaignLocations.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { playerCreatureVisibility } from '../../../src/campaigns/CreatureVisibility.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import { targetingBoard } from '../../../src/coordinators/TargetingBoard.js';
import TargetingController from '../../../src/ui/characters/TargetingController.js';

let context;
beforeEach(() => {
  localStorage.clear();
  context = {
    ruleset: '2014',
    library: new CharacterLibrary({
      ruleset: '2014',
      storage: localStorage,
      catalog: classic.entries,
      classes: classic.classes,
    }),
  };
});

function worlds() {
  const world = CampaignWorld.fromScene(sceneState(), context);
  const map = world.getMap('map-main');
  map.terrain.heights = map.terrain.heights.map((row) => row.map(() => 0));
  world.addLocation({
    id: 'remote-location',
    name: 'Separate dungeon',
    map: { ...map, id: 'remote-map', name: 'Dungeon entrance' },
  });
  return world;
}

test('legacy connected maps remain one physical location without changing their serialized checkpoints', () => {
  const world = CampaignWorld.fromScene(sceneState(), context);
  const before = world.save();
  expect(world.getLocationId('map-main')).toBe(DEFAULT_LOCATION_ID);
  expect(world.listLocations()).toEqual([{ id: DEFAULT_LOCATION_ID, name: 'Main location' }]);
  expect(world.save()).toEqual(before);
  expect(world.save()).not.toHaveProperty('locations');
});

test('independent locations may overlap raw coordinates but keep their own obstruction and support geometry', () => {
  const world = worlds();
  const next = world.save();
  next.maps.find((map) => map.id === 'remote-map').terrain.heights = Array.from({ length: 5 }, () =>
    Array(5).fill(20)
  );
  world.acceptCheckpoint(next);
  expect(world.sharesLocation('map-main', 'remote-map')).toBe(false);
  expect(world.listLocationMaps('map-main').map((map) => map.id)).toEqual(['map-main']);
  expect(world.getObstacles({ mapId: 'map-main' }).some((solid) => solid.max.y >= 20)).toBe(false);
  expect(world.getObstacles({ mapId: 'remote-map' }).some((solid) => solid.max.y >= 20)).toBe(true);
  const above = { x: 7.5, y: 100, z: 7.5 };
  expect(world.findSupportBelow(above, { mapId: 'map-main' }).mapId).toBe('map-main');
  expect(world.findSupportBelow(above, { mapId: 'remote-map' }).mapId).toBe('remote-map');
  expect(
    world.hasLineOfSight(
      { x: 7.5, y: 0, z: 7.5 },
      { x: 8, y: 0, z: 8 },
      { mapId: 'map-main', targetMapId: 'remote-map', obstacles: [] }
    )
  ).toBe(false);
  expect(() => world.hasLineOfSight({ x: 1, y: 0, z: 1 }, { x: 2, y: 0, z: 2 })).toThrow('map');
});

test('ordinary connected areas added after location creation inherit the viewed location', () => {
  const world = worlds();
  const map = world.getMap('map-main');
  delete map.locationId;
  world.addMap({ ...map, id: 'connected-area', name: 'Connected area' });
  expect(world.getLocationId('connected-area')).toBe(DEFAULT_LOCATION_ID);
  expect(world.listLocationMaps('map-main').map((entry) => entry.id)).toEqual([
    'map-main',
    'connected-area',
  ]);
});

test('spatial spell visuals remain in their originating location even when their caster is absent', () => {
  const world = worlds();
  const controller = Object.create(TargetingController.prototype);
  controller.gameManager = { campaignWorld: world, campaignMapId: 'map-main', placedTokens: [] };
  controller.session = {
    effects: [
      { id: 'local-area', locationId: DEFAULT_LOCATION_ID },
      { id: 'remote-area', locationId: 'remote-location' },
      { id: 'remote-point', kind: 'point', locationId: 'remote-location' },
      { id: 'recipient-ring', kind: 'targets' },
    ],
  };
  expect(controller.visibleEffects().map((effect) => effect.id)).toEqual([
    'local-area',
    'recipient-ring',
  ]);
  controller.gameManager.campaignMapId = 'remote-map';
  expect(controller.visibleEffects().map((effect) => effect.id)).toEqual([
    'remote-area',
    'remote-point',
    'recipient-ring',
  ]);
});

test('sight and projection never reveal creatures in an overlapping unrelated location', () => {
  const world = worlds();
  const scene = world.save();
  scene.creatures.push({
    ...scene.creatures[0],
    id: 'token-2',
    name: 'Remote creature',
    mapId: 'remote-map',
    instanceNumber: 2,
  });
  scene.tokenCounters.nextId = 2;
  scene.tokenCounters.types[0][1] = 2;
  world.acceptCheckpoint(scene);
  expect(world.visibleProjections('token-1', 'map-main')).toEqual([]);
  expect(() => world.projectCreature('token-2', 'map-main')).toThrow('location');
  expect(() => world.transferCreature('token-1', 'remote-map')).toThrow('location');
  const visible = playerCreatureVisibility({
    world,
    creatures: scene.creatures,
    ownedIds: [null],
    publishedIds: ['map-main', 'remote-map'],
    observerTokenId: 'token-1',
  });
  expect(visible.visible.map((token) => token.id)).toEqual(['token-1']);
  const gm = {
    campaignWorld: world,
    campaignMapId: 'map-main',
    spatial: { tileWorldSize: 1 },
    placedTokens: scene.creatures.map((token) => ({ ...token, world: token.pose.world })),
  };
  expect(targetingBoard(gm).tokens.map((token) => token.id)).toEqual(['token-1']);
});

test('locations and internal-map membership round-trip and reject invalid references or physical links between worlds', () => {
  const world = worlds();
  const saved = world.save();
  expect(decodeScene(encodeScene(saved, context), context)).toEqual(saved);
  const unknown = JSON.parse(JSON.stringify(saved));
  unknown.maps[0].locationId = 'missing';
  expect(() => encodeScene(unknown, context)).toThrow('location');
  const duplicate = JSON.parse(JSON.stringify(saved));
  duplicate.locations.push(duplicate.locations[0]);
  expect(() => encodeScene(duplicate, context)).toThrow('location');
  const cross = JSON.parse(JSON.stringify(saved));
  cross.connections = [
    {
      id: 'invalid-link',
      kind: 'doorway',
      ends: [
        { mapId: 'map-main', positionFeet: { x: 7.5, y: 0, z: 7.5 } },
        { mapId: 'remote-map', positionFeet: { x: 7.5, y: 0, z: 7.5 } },
      ],
    },
  ];
  expect(() => encodeScene(cross, context)).toThrow();
});

test('logical cavern passages join independent maps without merging physical locations', () => {
  const world = worlds();
  const passage = {
    version: 1,
    id: 'passage-1',
    kind: 'chamber',
    ends: [
      { mapId: 'map-main', side: 'east' },
      { mapId: 'remote-map', side: 'west' },
    ],
  };
  const revision = world.mapRevision;
  world.addLogicalPassage(passage);
  expect(world.getLogicalPassages('map-main')).toEqual([passage]);
  expect(world.getLogicalPassages('remote-map')).toEqual([passage]);
  expect(world.getConnections()).toEqual([]);
  expect(world.sharesLocation('map-main', 'remote-map')).toBe(false);
  expect(world.mapRevision).toBe(revision + 1);
  const saved = world.save();
  expect(decodeScene(encodeScene(saved, context), context)).toEqual(saved);
});

test('logical passages reject missing maps, reused entrances and same-location links atomically', () => {
  const world = worlds();
  const passage = {
    version: 1,
    id: 'passage-1',
    kind: 'chamber',
    ends: [
      { mapId: 'map-main', side: 'east' },
      { mapId: 'remote-map', side: 'west' },
    ],
  };
  world.addLogicalPassage(passage);
  const before = world.save();
  expect(() =>
    world.addLogicalPassage({
      ...passage,
      id: 'passage-2',
      ends: [
        { mapId: 'map-main', side: 'north' },
        { mapId: 'missing', side: 'south' },
      ],
    })
  ).toThrow(/passage/i);
  expect(() =>
    world.addLogicalPassage({
      ...passage,
      id: 'passage-2',
      ends: [
        { mapId: 'map-main', side: 'east' },
        { mapId: 'remote-map', side: 'north' },
      ],
    })
  ).toThrow(/passage/i);
  const local = world.getMap('map-main');
  world.addMap({ ...local, id: 'another-local', name: 'Another local area' });
  const withLocalMap = world.save();
  expect(() =>
    world.addLogicalPassage({
      ...passage,
      id: 'passage-2',
      ends: [
        { mapId: 'map-main', side: 'north' },
        { mapId: 'another-local', side: 'south' },
      ],
    })
  ).toThrow(/passage|location/i);
  expect(world.save()).toEqual(withLocalMap);
  expect(before.logicalPassages).toEqual([passage]);
});

test('a logical passage plans paid travel between independent entrance cells', () => {
  const world = worlds();
  const scene = world.save();
  for (const map of scene.maps)
    map.terrain.heights = map.terrain.heights.map((row) => row.map(() => 0));
  world.acceptCheckpoint(scene);
  world.addLogicalPassage({
    version: 1,
    id: 'passage-1',
    kind: 'chamber',
    ends: [
      { mapId: 'map-main', side: 'east' },
      { mapId: 'remote-map', side: 'west' },
    ],
  });
  const before = world.save();
  expect(world.planLogicalPassage('passage-1', 'map-main', { x: 4.5, y: 0, z: 2.5 })).toMatchObject(
    {
      targetMapId: 'remote-map',
      targetWorld: { x: 0.5, y: 0, z: 2.5 },
      costFeet: 5,
    }
  );
  expect(
    world.planLogicalPassage('passage-1', 'remote-map', { x: 0.5, y: 0, z: 2.5 })
  ).toMatchObject({
    targetMapId: 'map-main',
    targetWorld: { x: 4.5, y: 0, z: 2.5 },
    costFeet: 5,
  });
  expect(world.planLogicalPassage('passage-1', 'map-main', { x: 3.5, y: 0, z: 2.5 }).costFeet).toBe(
    10
  );
  expect(() => world.planLogicalPassage('passage-1', 'map-main', { x: 2.5, y: 0, z: 2.5 })).toThrow(
    /within 5 feet/i
  );
  expect(world.save()).toEqual(before);
});

test('a logical passage refuses an occupied or physically blocked landing', () => {
  const world = worlds();
  const scene = world.save();
  for (const map of scene.maps)
    map.terrain.heights = map.terrain.heights.map((row) => row.map(() => 0));
  world.acceptCheckpoint(scene);
  world.addLogicalPassage({
    version: 1,
    id: 'passage-1',
    kind: 'chamber',
    ends: [
      { mapId: 'map-main', side: 'east' },
      { mapId: 'remote-map', side: 'west' },
    ],
  });
  const from = { x: 4.5, y: 0, z: 2.5 };
  expect(() =>
    world.planLogicalPassage('passage-1', 'map-main', from, {
      occupants: [{ mapId: 'remote-map', world: { x: 0.5, y: 0, z: 2.5 } }],
    })
  ).toThrow(/creature|occupied/i);
  const blocked = world.save();
  blocked.maps.find((map) => map.id === 'remote-map').terrain.geometry = {
    version: 1,
    volumes: [
      {
        id: 'landing-wall',
        layerId: 'ground',
        operation: 'add',
        bounds: { min: { x: 0, y: 0, z: 10 }, max: { x: 5, y: 10, z: 15 } },
      },
    ],
  };
  world.acceptCheckpoint(blocked);
  expect(() => world.planLogicalPassage('passage-1', 'map-main', from)).toThrow(
    /blocked|clear|landing|support/i
  );
});

test('flying through a logical passage retains altitude relative to the destination floor', () => {
  const world = worlds();
  const scene = world.save();
  for (const map of scene.maps)
    map.terrain.heights = map.terrain.heights.map((row) => row.map(() => 0));
  scene.maps.find((map) => map.id === 'remote-map').terrain.heights[2][0] = 2;
  world.acceptCheckpoint(scene);
  world.addLogicalPassage({
    version: 1,
    id: 'passage-1',
    kind: 'chamber',
    ends: [
      { mapId: 'map-main', side: 'east' },
      { mapId: 'remote-map', side: 'west' },
    ],
  });
  const plan = world.planLogicalPassage(
    'passage-1',
    'map-main',
    { x: 4.5, y: 0.6, z: 2.5 },
    { travelMode: 'fly' }
  );
  expect(plan.targetWorld).toEqual({ x: 0.5, y: 1.2, z: 2.5 });
  expect(plan.targetPose.kind).toBe('flight');
  expect(plan.costFeet).toBe(5);
});
