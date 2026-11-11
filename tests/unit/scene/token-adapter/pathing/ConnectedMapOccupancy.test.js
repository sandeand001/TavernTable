import CampaignWorld from '../../../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../../../src/entities/characters/CharacterLibrary.js';
import { Token3DAdapter } from '../../../../../src/scene/Token3DAdapter.js';
import { TerrainEngine } from '../../../../../src/terrain/TerrainEngine.js';
import { TokenManager } from '../../../../../src/managers/TokenManager.js';
import { ErrorHandler } from '../../../../../src/utils/error/ErrorHandler.js';
import { sceneState } from '../../../../helpers/sceneState.js';

function fixture() {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const engine = new TerrainEngine(10, 10);
  engine.addVolume({
    id: 'distant-step',
    bounds: { min: { x: 40, y: 0, z: 40 }, max: { x: 45, y: 1.5, z: 45 } },
  });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 10, rows: 10, tileWorldSize: 1 };
  scene.terrain.heights = Array.from({ length: 10 }, () => Array(10).fill(0));
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures[0].gridX = 4;
  scene.creatures[0].gridY = 7;
  scene.creatures[0].pose.world = { x: 4.5, y: 0, z: 7.5 };
  const validation = { ruleset: '2014', library };
  let world = CampaignWorld.fromScene(scene, validation);
  const terrain = { ...scene.terrain };
  delete terrain.geometry;
  world.addMap({
    id: 'inside',
    name: 'Interior',
    originFeet: { x: 55, y: 0, z: 20 },
    quarterTurns: 0,
    base: 'floor',
    grid: { cols: 8, rows: 10, tileWorldSize: 1 },
    terrain: { ...terrain, heights: Array.from({ length: 10 }, () => Array(8).fill(0)) },
  });
  const saved = world.save();
  for (const [number, gridY] of [
    [2, 2],
    [3, 7],
  ]) {
    saved.creatures.push({
      ...saved.creatures[0],
      id: `token-${number}`,
      instanceNumber: number,
      name: `Interior ${number}`,
      mapId: 'inside',
      gridX: 1,
      gridY,
      pose: { kind: 'ground', world: { x: 1.5, y: 0, z: gridY + 0.5 } },
    });
  }
  saved.tokenCounters.nextId = 3;
  saved.tokenCounters.types[0][1] = 3;
  world = CampaignWorld.fromScene(saved, validation);
  const tokens = saved.creatures.map((creature) => ({
    ...creature,
    world: { ...creature.pose.world },
    movementSettings: { speed: 30, mode: 'walk', type: 'default' },
  }));
  const gm = {
    cols: 10,
    rows: 10,
    placedTokens: tokens,
    campaignWorld: world,
    campaignMapId: 'map-main',
    terrainEngine: engine,
    getTerrainHeight: (x, y) => engine.getHeightAt(x, y),
    characterServices: { library },
    spatial: {
      tileWorldSize: 1,
      elevationUnit: 0.3,
      gridToWorld: (x, z, height = 0) => ({ x, y: height * 0.3, z }),
      worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
    },
  };
  gm.token3DAdapter = new Token3DAdapter(gm);
  return { gm, adapter: gm.token3DAdapter, actor: tokens[0] };
}

const reachable = (range, x, y) =>
  [...range.tiles.values()].some((cell) => cell.gridX === x && cell.gridY === y);

test('interior creatures do not reserve their untransformed coordinates on the exterior surface range', () => {
  const { adapter, actor } = fixture();
  try {
    const range = adapter.getTokenMovementRange(actor);
    expect(range.layered).toBe(true);
    expect(reachable(range, 1, 2)).toBe(true);
    expect(reachable(range, 1, 7)).toBe(true);
  } finally {
    adapter.disposeMovementRange();
  }
});

test.each([
  [0, false],
  [10, true],
])('surface occupancy uses translated positions and floor elevation (%s ft)', (height, clear) => {
  const { gm, adapter, actor } = fixture();
  const saved = gm.campaignWorld.save();
  saved.maps.find((map) => map.id === 'inside').originFeet = { x: 10, y: height, z: 0 };
  gm.campaignWorld.acceptCheckpoint(saved);
  try {
    const range = adapter.getTokenMovementRange(actor);
    expect(reachable(range, 1, 2)).toBe(true);
    expect(reachable(range, 1, 7)).toBe(true);
    expect(reachable(range, 3, 2)).toBe(clear);
    expect(reachable(range, 3, 7)).toBe(clear);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('ordinary heightfield movement does not inherit foreign local occupancy', () => {
  const { gm, adapter, actor } = fixture();
  gm.terrainEngine.load({ heights: Array.from({ length: 10 }, () => Array(10).fill(0)) });
  try {
    const range = adapter.getTokenMovementRange(actor);
    expect(range.layered).not.toBe(true);
    expect(reachable(range, 1, 2)).toBe(true);
    expect(reachable(range, 1, 7)).toBe(true);
  } finally {
    adapter.disposeMovementRange();
  }
});

test.each(['surface', 'heightfield', 'flight'])(
  '%s movement ignores overlapping terrain and creatures in an independent location',
  (mode) => {
    const { gm, adapter, actor } = fixture();
    const saved = gm.campaignWorld.save();
    saved.locations = [
      { id: 'outside-location', name: 'Outside' },
      { id: 'other-location', name: 'Elsewhere' },
    ];
    for (const map of saved.maps) {
      map.locationId = map.id === 'map-main' ? 'outside-location' : 'other-location';
      if (map.id === 'inside') map.originFeet = { x: 0, y: 0, z: 0 };
    }
    gm.campaignWorld.acceptCheckpoint(saved);
    if (mode === 'heightfield')
      gm.terrainEngine.load({ heights: Array.from({ length: 10 }, () => Array(10).fill(0)) });
    if (mode === 'flight') {
      actor.flightActive = true;
      actor.fallTraits = { flySpeed: 60 };
      for (const token of gm.placedTokens) token.world.y = 1;
    }
    try {
      const range = adapter.getTokenMovementRange(actor);
      expect(reachable(range, 1, 2)).toBe(true);
      expect(reachable(range, 1, 7)).toBe(true);
    } finally {
      adapter.disposeMovementRange();
    }
  }
);

test('flight collision uses translated physical positions and heights across grids', () => {
  const { gm, adapter, actor } = fixture();
  actor.flightActive = true;
  actor.fallTraits = { flySpeed: 60 };
  for (const token of gm.placedTokens) token.world.y = 1;
  try {
    let range = adapter.getTokenMovementRange(actor);
    expect(range.travelMode).toBe('fly');
    expect(reachable(range, 1, 2)).toBe(true);
    expect(reachable(range, 1, 7)).toBe(true);
    const saved = gm.campaignWorld.save();
    const inside = saved.maps.find((map) => map.id === 'inside');
    inside.originFeet = { x: 10, y: 0, z: 0 };
    gm.campaignWorld.acceptCheckpoint(saved);
    range = adapter.getTokenMovementRange(actor);
    expect(reachable(range, 3, 2)).toBe(false);
    expect(reachable(range, 1, 2)).toBe(true);
    inside.originFeet.y = 10;
    gm.campaignWorld.acceptCheckpoint(saved);
    range = adapter.getTokenMovementRange(actor);
    expect(reachable(range, 3, 2)).toBe(false);
    inside.originFeet.y = 15;
    gm.campaignWorld.acceptCheckpoint(saved);
    range = adapter.getTokenMovementRange(actor);
    expect(reachable(range, 3, 2)).toBe(true);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('local placement and selection lookups cannot find a creature on another grid by its local coordinates', () => {
  const { gm, adapter, actor } = fixture();
  const manager = new TokenManager(gm);
  manager.placedTokens = gm.placedTokens;
  try {
    expect(manager.findExistingTokenAt(1, 2)).toBeUndefined();
    expect(manager.findExistingTokenAt(1, 7)).toBeUndefined();
    expect(manager.findExistingTokenAt(4, 7)).toBe(actor);
  } finally {
    adapter.disposeMovementRange();
  }
});

test('bounds checks on a smaller viewed map ignore other grids but still report invalid local positions', () => {
  const { gm, adapter, actor } = fixture();
  gm.campaignMapId = 'inside';
  const local = gm.placedTokens[1];
  const manager = new TokenManager(gm);
  manager.placedTokens = [actor, local];
  const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  try {
    manager.validateTokenPositions(5, 5);
    expect(error).not.toHaveBeenCalled();
    local.gridX = 6;
    manager.validateTokenPositions(5, 5);
    expect(error).toHaveBeenCalledTimes(1);
  } finally {
    error.mockRestore();
    adapter.disposeMovementRange();
  }
});

test('off-map flight information uses the creature map scale and elevation controls require focusing its map', () => {
  const { gm, adapter, actor } = fixture();
  actor.flightActive = true;
  actor.fallTraits = { flySpeed: 60 };
  actor.world.y = 2;
  gm.campaignMapId = 'inside';
  gm.spatial.tileWorldSize = 2;
  try {
    expect(adapter.getFlightStatus(actor).heightFeet).toBe(10);
    expect(adapter.getFlightCommandAvailability(actor, 'raise', 5)).toMatchObject({
      allowed: false,
      reason: expect.stringMatching(/focus.*map/i),
    });
  } finally {
    adapter.disposeMovementRange();
  }
});
