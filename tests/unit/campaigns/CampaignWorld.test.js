import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import CombatSession from '../../../src/entities/characters/CombatSession.js';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { clearSegment } from '../../../src/rules/targeting/geometry.js';
import { boundsIntersectSolid } from '../../../src/terrain/ConvexGeometry.js';
import { executePlayerCommand } from '../../../src/campaigns/ServerGameplay.js';

function context() {
  localStorage.clear();
  return {
    ruleset: '2014',
    library: new CharacterLibrary({
      ruleset: '2014',
      storage: localStorage,
      catalog: classic.entries,
      classes: classic.classes,
    }),
  };
}

test('a legacy board becomes a named map without changing its creature physical position', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  expect(world.getMap('map-main')).toMatchObject({
    id: 'map-main',
    originFeet: { x: 0, y: 0, z: 0 },
    quarterTurns: 0,
    grid: { cols: 5, rows: 5, tileWorldSize: 1 },
  });

  expect(world.getCampaignPosition('token-1')).toEqual({ x: 7.5, y: 0, z: 7.5 });
  expect(world.save()).toMatchObject({
    version: 3,
    creatures: [{ id: 'token-1', mapId: 'map-main' }],
    view: { mapId: 'map-main', focusTokenId: null },
  });
});

test('connected-map checkpoints round-trip through the campaign scene format', () => {
  const validation = context();
  const saved = CampaignWorld.fromScene(sceneState(), validation).save();
  expect(decodeScene(encodeScene(saved, validation), validation)).toEqual(saved);
});

test('warm scene validation reuses static geometry but still checks each actor against current terrain', () => {
  const validation = context();
  const checkpoint = CampaignWorld.fromScene(sceneState(), validation).save();
  const terrain = checkpoint.maps[0].terrain;
  terrain.heights[1][2] = 0;
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'round-tower',
    bounds: { min: { x: 15, y: 0, z: 15 }, max: { x: 25, y: 20, z: 25 } },
    shape: { kind: 'cylinder', axis: 'y' },
  });
  terrain.geometry = geometry.save();
  const saved = encodeScene(checkpoint, validation);
  const actor = checkpoint.creatures[0];
  actor.gridX = 2;
  actor.pose.world.x = 2.5;
  const load = jest.spyOn(TerrainGeometry.prototype, 'load');
  try {
    expect(decodeScene(JSON.stringify(checkpoint), validation).creatures[0]).toEqual(actor);
    expect(load).not.toHaveBeenCalled();

    actor.pose.world.y = 1;
    expect(() => encodeScene(checkpoint, validation)).toThrow(/floor support/i);
    expect(load).not.toHaveBeenCalled();

    actor.pose.world.y = 0;
    terrain.heights[1][2] = 8;
    expect(() => encodeScene(checkpoint, validation)).toThrow(/floor support/i);
    expect(load).toHaveBeenCalledTimes(1);
    expect(decodeScene(saved, validation).creatures[0].pose.world.x).toBe(1.5);
  } finally {
    load.mockRestore();
  }
});

test('actor-only checkpoints retain map geometry and its revision while real terrain edits invalidate them', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  const geometry = world.getMapGeometry('map-main'),
    revision = world.mapRevision;
  const saved = world.save();
  saved.creatures[0].name = 'Updated creature';
  world.acceptCheckpoint(saved);
  expect(world.mapRevision).toBe(revision);
  expect(world.getMapGeometry('map-main')).toBe(geometry);
  saved.maps[0].terrain.heights[0][0] = 1;
  world.acceptCheckpoint(saved);
  expect(world.mapRevision).toBe(revision + 1);
  expect(world.getMapGeometry('map-main')).not.toBe(geometry);
});

test('moving an unchanged map invalidates geometry identities used by transformed collision and projection caches', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  const geometry = world.getMapGeometry('map-main');
  const saved = world.save();
  saved.maps[0].originFeet.y = 10;
  world.acceptCheckpoint(saved);
  expect(world.mapRevision).toBe(1);
  expect(world.getMapGeometry('map-main')).not.toBe(geometry);
});

test('shared query maps cannot mutate canonical terrain and refresh after a replacement checkpoint', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  const previous = world.getMapSnapshot('map-main');
  expect(() => {
    previous.terrain.heights[0][0] = 9;
  }).toThrow(TypeError);
  const editable = world.getMap('map-main');
  editable.terrain.heights[0][0] = 7;
  expect(world.getMap('map-main').terrain.heights[0][0]).toBe(0);
  const changed = world.save();
  changed.maps[0].terrain.heights[0][0] = 1;
  changed.maps[0].originFeet.y = 5;
  world.acceptCheckpoint(changed);
  expect(previous.terrain.heights[0][0]).toBe(0);
  expect(world.getMapSnapshot('map-main')).toMatchObject({
    originFeet: { y: 5 },
    terrain: { heights: changed.maps[0].terrain.heights },
  });
});

test('query forks preserve fresh actors and independent geometry while changed maps invalidate compiled terrain', () => {
  const validation = context();
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  const world = CampaignWorld.fromScene(scene, validation);
  const origin = { x: 7.5, y: 0, z: 7.5 };
  const target = { x: 17.5, y: 0, z: 7.5 };
  expect(world.hasLineOfSight(origin, target)).toBe(true);
  const next = world.save();
  next.creatures[0].gridX = 2;
  next.creatures[0].pose.world.x = 2.5;
  const fork = world.forkQuery(next, validation);
  expect(fork.getCreature('token-1').pose.world.x).toBe(2.5);
  expect(world.getCreature('token-1').pose.world.x).toBe(1.5);
  fork.getMapGeometry('map-main').addSolid({
    id: 'fork-only-wall',
    bounds: { min: { x: 12, y: 0, z: 0 }, max: { x: 13, y: 15, z: 25 } },
  });
  expect(fork.hasLineOfSight(origin, target)).toBe(false);
  expect(world.hasLineOfSight(origin, target)).toBe(true);
  const clean = fork.forkQuery(fork.save(), validation);
  expect(clean.hasLineOfSight(origin, target)).toBe(true);
  expect(fork.hasLineOfSight(origin, target)).toBe(false);
  const changed = world.save();
  changed.maps[0].originFeet.y = 5;
  changed.maps[0].terrain.heights[0][0] = 1;
  const edited = world.forkQuery(changed, validation);
  expect(
    edited.findSupportBelow({ x: 2.5, y: 100, z: 2.5 }, { mapId: 'map-main' }).positionFeet.y
  ).toBeCloseTo(6.5);
  expect(
    world.findSupportBelow({ x: 2.5, y: 100, z: 2.5 }, { mapId: 'map-main' }).positionFeet.y
  ).toBe(0);
});

test('location obstacle snapshots resist caller mutation while edits and preview geometry keep fresh physical sight', () => {
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  const world = CampaignWorld.fromScene(scene, context());
  const origin = { x: 7.5, y: 0, z: 7.5 };
  const target = { x: 17.5, y: 0, z: 7.5 };
  const first = world.getObstacles({ mapId: 'map-main' });
  expect(() => {
    first[0].min.x = 999;
  }).toThrow(TypeError);
  first.push({
    min: { x: 12, y: 0, z: 0 },
    max: { x: 13, y: 15, z: 25 },
  });
  expect(world.hasLineOfSight(origin, target)).toBe(true);
  world.getMapGeometry('map-main').addSolid({
    id: 'later-wall',
    bounds: { min: { x: 12, y: 0, z: 0 }, max: { x: 13, y: 15, z: 25 } },
  });
  expect(world.hasLineOfSight(origin, target)).toBe(false);
  const preview = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  expect(world.hasLineOfSight(origin, target, { mapId: 'map-main', geometry: preview })).toBe(true);
  expect(world.hasLineOfSight(origin, target)).toBe(false);
});

test('a player move on a curved board reuses compiled collision cells from the current query world', async () => {
  const validation = context();
  const scene = sceneState({
    characterId: validation.library.create('Scout'),
    name: 'Scout',
  });
  scene.version = 2;
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'round-tower',
    bounds: { min: { x: 15, y: 0, z: 15 }, max: { x: 25, y: 20, z: 25 } },
    shape: { kind: 'cylinder', axis: 'y' },
  });
  scene.terrain.geometry = geometry.save();
  const previous = CampaignWorld.fromScene(scene, validation);
  const cells = previous.getMapGeometry('map-main').getSolidCells();
  const world = previous.forkQuery(scene, validation);
  const read = jest.spyOn(TerrainGeometry.prototype, 'getSolidCells');
  try {
    const outcome = await executePlayerCommand(
      scene,
      validation.library,
      {
        kind: 'move',
        tokenId: 'token-1',
        payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
      },
      { world }
    );
    expect(outcome.scene.creatures[0].pose.world.x).toBe(2.5);
    expect(read).toHaveBeenCalled();
    expect(read.mock.results.every(({ value }) => value === cells)).toBe(true);
  } finally {
    read.mockRestore();
  }
});

function floorMap(id, originFeet, quarterTurns = 0) {
  const scene = sceneState();
  return {
    id,
    name: id,
    originFeet,
    quarterTurns,
    base: 'floor',
    grid: { ...scene.grid, tileWorldSize: 2 },
    terrain: {
      ...scene.terrain,
      heights: scene.terrain.heights.map((row) => row.map(() => 0)),
    },
  };
}

test('physical sight preserves floor, ceiling and boundary hits when rejecting vertically irrelevant solids', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  const obstacles = [
    { min: { x: 0, y: -1000000, z: 0 }, max: { x: 25, y: 0, z: 25 } },
    { min: { x: 0, y: 10, z: 0 }, max: { x: 25, y: 10.5, z: 25 } },
    { min: { x: 12, y: 0, z: 0 }, max: { x: 13, y: 8, z: 25 } },
  ];
  const sight = { mapId: 'map-main', obstacles };
  for (const [observerY, target, visible] of [
    [0, { x: 7.5, y: 4, z: 2.5 }, true],
    [0, { x: 17.5, y: 4, z: 2.5 }, false],
    [10, { x: 17.5, y: 14, z: 2.5 }, true],
    [0, { x: 2.5, y: 14, z: 2.5 }, false],
    [0, { x: 2.5, y: 10, z: 2.5 }, true],
    [10, { x: 2.5, y: 10.5, z: 2.5 }, true],
    [10, { x: 2.5, y: 4, z: 2.5 }, false],
    [4, { x: 17.5, y: 8, z: 2.5 }, false],
    [4 + 1e-8, { x: 17.5, y: 8 + 1e-8, z: 2.5 }, true],
    [-5, { x: 2.5, y: 4, z: 2.5 }, false],
  ])
    expect(world.hasSurfaceLineOfSight({ x: 2.5, y: observerY, z: 2.5 }, target, sight)).toBe(
      visible
    );
  expect(world.hasLineOfSight({ x: 2.5, y: 0, z: 2.5 }, { x: 2.5, y: 10, z: 2.5 }, sight)).toBe(
    false
  );
  expect(world.hasLineOfSight({ x: 2.5, y: 10, z: 2.5 }, { x: 17.5, y: 10, z: 2.5 }, sight)).toBe(
    true
  );
});

test('campaign sight retains its conservative observer-on-wall boundary rule', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  const map = floorMap('wall', { x: 100, y: 0, z: 100 });
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
    terrainThicknessFeet: 0.5,
  });
  geometry.addSolid({
    id: 'wall',
    bounds: { min: { x: 5, y: 0, z: 5 }, max: { x: 6, y: 10, z: 20 } },
  });
  map.terrain.geometry = geometry.save();
  world.addMap(map);
  expect(world.hasLineOfSight({ x: 105, y: 0, z: 110 }, { x: 103, y: 0, z: 110 })).toBe(false);
  expect(world.hasLineOfSight({ x: 104.9, y: 0, z: 110 }, { x: 103, y: 0, z: 110 })).toBe(true);
});

test('curved campaign obstacles keep their actual half-spaces across rotated, differently scaled maps', () => {
  const validation = context();
  const world = CampaignWorld.fromScene(sceneState(), validation);
  const map = floorMap('dome', { x: 100, y: 10, z: 100 }, 1);
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    terrainThicknessFeet: 0.5,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'shell',
    layerId: 'roof',
    bounds: { min: { x: 2.5, y: 0, z: 2.5 }, max: { x: 22.5, y: 10, z: 22.5 } },
    shape: {
      kind: 'ellipsoid',
      center: { x: 12.5, y: 0, z: 12.5 },
      radii: { x: 10, y: 10, z: 10 },
    },
  });
  geometry.carve({
    id: 'room',
    bounds: { min: { x: 4.5, y: 0, z: 4.5 }, max: { x: 20.5, y: 8, z: 20.5 } },
    shape: {
      kind: 'ellipsoid',
      center: { x: 12.5, y: 0, z: 12.5 },
      radii: { x: 8, y: 8, z: 8 },
    },
  });
  map.terrain.geometry = geometry.save();
  world.addMap(map);
  const obstacles = world.getObstacles();
  expect(
    obstacles.some((solid) =>
      solid.planes?.some(
        ({ normal }) =>
          [normal.x, normal.y, normal.z].filter((value) => Math.abs(value) > 0.01).length > 1
      )
    )
  ).toBe(true);
  const physical = (x, y, z) =>
    world.toCampaignPosition('dome', {
      x: x * 0.4,
      y: y * 0.4,
      z: z * 0.4,
    });
  for (const [x, z] of [
    [3, 3],
    [6, 8],
    [9, 5],
    [12.5, 12.5],
    [17, 18],
    [21, 12.5],
  ]) {
    const top = geometry.getSurfacesAt(x, z).at(-1).heightFeet;
    expect(clearSegment(physical(x, 30, z), physical(x, top + 0.1, z), obstacles)).toBe(true);
    expect(clearSegment(physical(x, 30, z), physical(x, top - 0.1, z), obstacles)).toBe(false);
  }
  const room = world.toCampaignBounds('dome', {
    min: { x: 4.5, y: 0.01, z: 4.5 },
    max: { x: 5.5, y: 2, z: 5.5 },
  });
  expect(obstacles.some((solid) => boundsIntersectSolid(room, solid))).toBe(false);
  const roof = world.toCampaignBounds('dome', {
    min: { x: 4.5, y: 3.3, z: 4.5 },
    max: { x: 5.5, y: 3.8, z: 5.5 },
  });
  expect(obstacles.some((solid) => boundsIntersectSolid(roof, solid))).toBe(true);
  expect(decodeScene(encodeScene(world.save(), validation), validation)).toEqual(world.save());
});

test('a rotated floor with a different rendering scale projects one creature into another grid', () => {
  const validation = context();
  let world = CampaignWorld.fromScene(sceneState(), validation);
  world.addMap(floorMap('upper', { x: 100, y: 10, z: 40 }, 1));
  const saved = world.save();
  saved.creatures.push({
    ...saved.creatures[0],
    id: 'token-2',
    instanceNumber: 2,
    name: 'Upstairs',
    mapId: 'upper',
    pose: { kind: 'ground', world: { x: 3, y: 0, z: 3 } },
  });
  saved.tokenCounters.nextId = 2;
  saved.tokenCounters.types[0][1] = 2;
  world = CampaignWorld.fromScene(saved, validation);
  expect(world.getCampaignPosition('token-2')).toEqual({ x: 92.5, y: 10, z: 47.5 });
  expect(world.projectCreature('token-2', 'map-main')).toMatchObject({
    id: 'token-2',
    sourceMapId: 'upper',
    projection: true,
    world: { x: 18.5, y: 2, z: 9.5 },
    facingAngle: -Math.PI / 2,
  });
  expect(world.projectCreature('token-2', 'upper').world).toEqual({ x: 3, y: 0, z: 3 });
  expect(world.save().creatures.map((creature) => creature.id)).toEqual(['token-1', 'token-2']);
});

test('only views following a transferred creature change maps, without refreshing its turn', () => {
  const validation = context();
  const characterId = validation.library.create('Alice');
  const token = { id: 'token-1', characterSheetId: characterId };
  const combat = new CombatSession({ library: validation.library });
  combat.startTurn(token);
  combat.adjustMovement(token, 20);
  const scene = sceneState({ characterId, name: 'Alice' });
  scene.combat = combat.snapshot();
  const world = CampaignWorld.fromScene(scene, validation);
  world.addMap(floorMap('inside', { x: 0, y: 0, z: 0 }));
  const alice = world.createView({ focusTokenId: token.id });
  const outside = world.createView({ mapId: 'map-main' });
  const savedCharacter = validation.library.export(characterId);
  const savedCombat = world.save().combat;
  const position = world.getCampaignPosition(token.id);
  world.transferCreature(token.id, 'inside');
  expect(alice.mapId).toBe('inside');
  expect(outside.mapId).toBe('map-main');
  expect(world.getCampaignPosition(token.id)).toEqual(position);
  expect(world.getCreature(token.id)).toMatchObject({
    id: token.id,
    characterId,
    mapId: 'inside',
    pose: { world: { x: 3, y: 0, z: 3 } },
  });
  expect(world.save().combat).toEqual(savedCombat);
  expect(validation.library.export(characterId)).toEqual(savedCharacter);
  expect(world.save().creatures).toHaveLength(1);
});

test('changing a map reference cannot teleport a grounded creature onto another floor', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  world.addMap(floorMap('upper', { x: 0, y: 10, z: 0 }));
  const before = world.save();
  expect(() => world.transferCreature('token-1', 'upper')).toThrow(/floor support/i);
  expect(world.save()).toEqual(before);
});

test('a connected checkpoint cannot stand on phantom support beneath a floor opening', () => {
  const validation = context();
  const world = CampaignWorld.fromScene(sceneState(), validation);
  const map = floorMap('inside', { x: 0, y: 10, z: 0 });
  const floor = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
    terrainThicknessFeet: 0.5,
  });
  floor.carve({
    id: 'opening',
    bounds: { min: { x: 5, y: -1, z: 5 }, max: { x: 10, y: 1, z: 10 } },
  });
  map.terrain.geometry = floor.save();
  world.addMap(map);
  const saved = world.save();
  saved.creatures[0].mapId = 'inside';
  saved.creatures[0].pose.world = { x: 3, y: -0.4, z: 3 };
  expect(() => decodeScene(JSON.stringify(saved), validation)).toThrow(/floor support/i);
});

test('legacy spell areas migrate to physical feet exactly once without changing their size', () => {
  const validation = context();
  const characterId = validation.library.create('Caster');
  const scene = sceneState({ characterId, name: 'Caster' });
  scene.combat.effects = [
    {
      version: 1,
      id: 'effect-1',
      casterTokenId: 'token-1',
      characterId,
      label: 'Cloud',
      sourceId: 'spell:fog-cloud',
      remainingTurns: 10,
      expiry: 'start',
      createdTurn: 0,
      lastTickTurn: 0,
      concentrationSpellId: null,
      followCaster: false,
      exclusions: [],
      area: {
        shape: 'sphere',
        origin: { x: 2, y: 1, z: 3 },
        direction: { x: 1, y: 0, z: 0 },
        size: 4,
        width: 1,
        height: 1,
      },
    },
  ];
  const world = CampaignWorld.fromScene(scene, validation);
  expect(world.save().combat.effects[0].area).toEqual({
    shape: 'sphere',
    origin: { x: 10, y: 5, z: 15 },
    direction: { x: 1, y: 0, z: 0 },
    size: 20,
    width: 5,
    height: 5,
  });
  expect(CampaignWorld.fromScene(world.save(), validation).save()).toEqual(world.save());
  expect(scene.combat.effects[0].area.size).toBe(4);
});

test.each([
  [
    'a missing map',
    (scene) => {
      scene.creatures[0].mapId = 'missing';
    },
  ],
  [
    'duplicate maps',
    (scene) => {
      scene.maps.push(scene.maps[0]);
    },
  ],
  [
    'duplicate creatures',
    (scene) => {
      scene.creatures.push(scene.creatures[0]);
    },
  ],
  [
    'an invalid rotation',
    (scene) => {
      scene.maps[0].quarterTurns = 0.5;
    },
  ],
  [
    'a grid/world position mismatch',
    (scene) => {
      scene.creatures[0].pose.world.x = 2.5;
    },
  ],
  [
    'a world position outside its grid',
    (scene) => {
      scene.creatures[0].pose.world.z = -1;
    },
  ],
])('connected checkpoints reject %s instead of silently resetting data', (label, corrupt) => {
  const validation = context();
  const saved = CampaignWorld.fromScene(sceneState(), validation).save();
  corrupt(saved);
  expect(() => decodeScene(JSON.stringify(saved), validation)).toThrow();
});

test('participant cameras and explicit map focus remain independent and remember each grid view', () => {
  const world = CampaignWorld.fromScene(sceneState(), context());
  world.addMap(floorMap('inside', { x: 0, y: 0, z: 0 }));
  const alice = world.createView({ focusTokenId: 'token-1' });
  const dm = world.createView({ focusTokenId: 'token-1' });
  const original = dm.camera;
  alice.setCamera({ ...original, yaw: 1.2, zoom: 2 });
  expect(dm.camera).toEqual(original);
  alice.showMap('inside');
  expect(alice.focusTokenId).toBeNull();
  alice.setCamera({ ...original, yaw: 2.4 });
  alice.focus('token-1');
  expect(alice.mapId).toBe('map-main');
  expect(alice.camera.yaw).toBe(1.2);
  expect(dm.camera).toEqual(original);
  expect(world.getCreature('token-1').mapId).toBe('map-main');
  const before = alice.camera;
  expect(() => alice.setCamera({ ...before, zoom: 0 })).toThrow(/camera/i);
  expect(alice.camera).toEqual(before);
});

test('a map cannot silently omit its constructed placeable cover from physical queries', () => {
  const validation = context();
  const saved = CampaignWorld.fromScene(sceneState(), validation).save();
  saved.maps[0].terrain.placeables.push({
    type: 'structure',
    gridX: 2,
    gridY: 1,
    persistedScale: { x: 1, y: 1, z: 1 },
  });
  expect(() => decodeScene(JSON.stringify(saved), validation)).toThrow(/structure cover/i);
});

test('campaign sight queries use physical geometry without depending on the targeting implementation', () => {
  const validation = context();
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  const world = CampaignWorld.fromScene(scene, validation);
  const map = floorMap('inside', { x: 10, y: 0, z: 0 });
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
    terrainThicknessFeet: 0.5,
  });
  geometry.addSolid({
    id: 'wall',
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 10, z: 25 } },
  });
  map.terrain.geometry = geometry.save();
  world.addMap(map);
  const start = { x: 7.5, y: 0, z: 7.5 };
  const end = { x: 17.5, y: 0, z: 7.5 };
  expect(world.hasLineOfSight(start, end)).toBe(false);
  geometry.carve({
    id: 'window',
    bounds: { min: { x: 0, y: 2, z: 5 }, max: { x: 1, y: 6, z: 10 } },
  });
  const saved = world.save();
  saved.maps.find((entry) => entry.id === 'inside').terrain.geometry = geometry.save();
  world.acceptCheckpoint(saved);
  expect(world.hasLineOfSight(start, end)).toBe(true);
  expect(world.hasLineOfSight(end, start)).toBe(true);
});

test.each(['missing-map', 'invalid-camera', 'duplicate-map'])(
  'saved camera history rejects %s without resetting the campaign',
  (invalid) => {
    const validation = context();
    const world = CampaignWorld.fromScene(sceneState(), validation);
    world.addMap(floorMap('other-map', { x: 25, y: 0, z: 0 }));
    const saved = world.save();
    saved.view.cameras = [
      { mapId: 'map-main', camera: JSON.parse(JSON.stringify(saved.view.camera)) },
    ];
    if (invalid === 'missing-map') saved.view.cameras[0].mapId = 'missing';
    if (invalid === 'invalid-camera') saved.view.cameras[0].camera.zoom = 0;
    if (invalid === 'duplicate-map') saved.view.cameras.push(saved.view.cameras[0]);
    expect(() => decodeScene(JSON.stringify(saved), validation)).toThrow(/camera/i);
  }
);
