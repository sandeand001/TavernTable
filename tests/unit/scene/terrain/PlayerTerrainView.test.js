import * as three from 'three';
import CampaignWorld from '../../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { TerrainGeometry } from '../../../../src/terrain/TerrainGeometry.js';
import { buildPlayerTerrainView } from '../../../../src/scene/terrain/PlayerTerrainView.js';
import {
  visiblePlayerMapIds,
  physicalSightObstacles,
} from '../../../../src/campaigns/CreatureVisibility.js';
import MapProjectionTerrain from '../../../../src/scene/token-adapter/MapProjectionTerrain.js';
import { TerrainVolumeMeshBuilder } from '../../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';
import { GRID_CONFIG } from '../../../../src/config/GameConstants.js';
import { CAVERN_BIOME_KEYS } from '../../../../src/config/biome/BiomeConstants.js';
import { getMapTerrainAppearance } from '../../../../src/scene/terrain/TerrainMaterialFactory.js';
import {
  cavernRockColor,
  getCavernSurfaceColor,
} from '../../../../src/terrain/generation/CavernInteriors.js';
import { sceneState } from '../../../helpers/sceneState.js';

test('Dungeon terrain uses constructed paving without changing authored material styles', () => {
  const map = {
    id: 'dungeon',
    grid: { tileWorldSize: 1 },
    terrain: { biome: 'dungeon', worldElevationUnit: 0.3 },
  };
  const appearance = getMapTerrainAppearance({ getMap: () => map }, map);
  expect(appearance.getStyle(0, 0, 0, { id: 'terrain' })).toBe(7);
  expect(appearance.getStyle(0, 0, 0, { id: 'authored-wall', materialStyle: 'timber' })).toBe(3);
});

test.each(CAVERN_BIOME_KEYS)(
  'shared terrain appearance preserves %s cavern coloring and authored materials',
  (biome) => {
    const map = {
      id: 'cavern',
      grid: { tileWorldSize: 1 },
      terrain: { biome, cavern: { version: 2 }, worldElevationUnit: 0.3 },
    };
    const appearance = getMapTerrainAppearance({ getMap: () => map }, map);
    expect(appearance.getColor(7, 11, 3, { id: 'terrain' })).toBe(
      getCavernSurfaceColor(7, 11, 3, { materialColor: cavernRockColor(biome) })
    );
    expect(
      appearance.getColor(7, 11, 3, {
        id: 'authored-wall',
        layerId: 'ground',
        materialColor: 0x123456,
      })
    ).toBe(0x123456);
  }
);

function fixture({ roof = false } = {}) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const base = sceneState();
  const flat = { ...base.terrain, heights: Array.from({ length: 5 }, () => Array(5).fill(0)) };
  const outside = new TerrainGeometry({
    widthFeet: 50,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  outside.addSolid({
    id: 'wall',
    materialStyle: 'stone',
    bounds: { min: { x: 24, y: 0, z: 0 }, max: { x: 26, y: 10, z: 25 } },
  });
  outside.carve({
    id: 'door',
    bounds: { min: { x: 23.5, y: 0, z: 10 }, max: { x: 26.5, y: 8, z: 15 } },
  });
  if (roof)
    outside.addSolid({
      id: 'castle-roof',
      layerId: 'roof',
      materialStyle: 'slate',
      materialColor: 0xaa4455,
      bounds: { min: { x: 24, y: 10, z: 4 }, max: { x: 32, y: 12, z: 12 } },
    });
  const room = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    terrainThicknessFeet: 0.5,
    getTerrainHeightFeet: () => 0,
  });
  room.addSolid({
    id: 'unseen-stairs',
    materialStyle: 'timber',
    materialColor: 0x19ed45,
    bounds: { min: { x: 5, y: 0, z: 10 }, max: { x: 10, y: 3, z: 15 } },
  });
  room.addSolid({
    id: 'unseen-wall',
    materialStyle: 'stone',
    materialColor: 0x5522cc,
    bounds: { min: { x: 15, y: 0, z: 0 }, max: { x: 16, y: 8, z: 25 } },
  });
  const observer = {
    ...base.creatures[0],
    mapId: 'current',
    gridX: 2,
    gridY: 2,
    pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 2.5 } },
  };
  const scene = {
    version: 3,
    ruleset: '2014',
    maps: [
      {
        id: 'outside',
        name: 'Outside',
        base: 'ground',
        grid: { ...base.grid, cols: 10 },
        originFeet: { x: 0, y: 0, z: 0 },
        quarterTurns: 0,
        terrain: {
          ...flat,
          heights: Array.from({ length: 5 }, () => Array(10).fill(0)),
          geometry: outside.save(),
        },
      },
      {
        id: 'current',
        name: 'Current room',
        base: 'floor',
        grid: base.grid,
        originFeet: { x: 0, y: 0, z: 0 },
        quarterTurns: 0,
        terrain: flat,
      },
      {
        id: 'unseen',
        name: 'Unseen room',
        base: 'floor',
        grid: base.grid,
        originFeet: { x: 25, y: 0, z: 0 },
        quarterTurns: 0,
        terrain: { ...flat, geometry: room.save() },
      },
    ],
    creatures: [observer],
    tokenCounters: base.tokenCounters,
    combat: base.combat,
    rollLog: [],
    view: { mapId: 'current', focusTokenId: null, camera: base.camera },
    connections: [
      {
        id: 'room-door',
        name: 'Room door',
        kind: 'door',
        feature: { mapId: 'outside', volumeIds: ['door'] },
        ends: [
          { mapId: 'current', positionFeet: { x: 22.5, y: 0, z: 12.5 } },
          { mapId: 'unseen', positionFeet: { x: 2.5, y: 0, z: 12.5 } },
        ],
        pathFeet: [],
      },
    ],
  };
  const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
  const map = world.getMap('current');
  return { world, map, observer };
}

function visible(fixture) {
  const { world, observer } = fixture;
  const obstacles = physicalSightObstacles(world, observer.mapId);
  return buildPlayerTerrainView({
    ...fixture,
    three,
    obstacles,
    visibleMapIds: visiblePlayerMapIds(
      world,
      { mapId: observer.mapId, world: observer.pose.world },
      { obstacles }
    ),
  });
}

function hasColor(geometry, hex) {
  const expected = new three.Color(hex);
  const colors = geometry.getAttribute('color');
  for (let index = 0; index < colors.count; index++)
    if (
      Math.abs(colors.getX(index) - expected.r) < 1e-6 &&
      Math.abs(colors.getY(index) - expected.g) < 1e-6 &&
      Math.abs(colors.getZ(index) - expected.b) < 1e-6
    )
      return true;
  return false;
}

function hasRoofSurface(geometry, roof) {
  const positions = geometry.getAttribute('position');
  const { min, max } = roof.bounds;
  for (let index = 0; index < positions.count; index++) {
    const point = {
      x: positions.getX(index) * 5,
      y: positions.getY(index) * 5,
      z: positions.getZ(index) * 5,
    };
    if (
      point.x >= min.x - 1e-4 &&
      point.x <= max.x + 1e-4 &&
      point.z >= min.z - 1e-4 &&
      point.z <= max.z + 1e-4 &&
      point.y >= max.y - 0.2
    )
      return true;
  }
  return false;
}

test('a closed door omits unknown-room floors, walls and stairs from the player geometry itself', () => {
  const board = fixture();
  const closed = visible(board);
  try {
    expect(hasColor(closed, 0x19ed45)).toBe(false);
    expect(hasColor(closed, 0x5522cc)).toBe(false);
    const positions = closed.getAttribute('position');
    for (let index = 0; index < positions.count; index++)
      expect(positions.getX(index)).toBeLessThanOrEqual(5.03);
  } finally {
    closed.dispose();
  }
  board.world.setDoorState('room-door', { open: true });
  const opened = visible(board);
  try {
    const colors = opened.getAttribute('color');
    const stairs = new three.Color(0x19ed45);
    expect(Array.from(colors.array).some((value) => Math.abs(value - stairs.g) < 1e-6)).toBe(true);
    const positions = opened.getAttribute('position');
    expect(Array.from(positions.array).every(Number.isFinite)).toBe(true);
  } finally {
    opened.dispose();
  }
  board.world.setDoorState('room-door', { open: false });
  const closedAgain = visible(board);
  try {
    expect(hasColor(closedAgain, 0x19ed45)).toBe(false);
    expect(hasColor(closedAgain, 0x5522cc)).toBe(false);
  } finally {
    closedAgain.dispose();
  }
});

test('an exterior player view retains a visible castle roof', () => {
  const roof = visible(fixture({ roof: true }));
  try {
    expect(hasColor(roof, 0xaa4455)).toBe(true);
  } finally {
    roof.dispose();
  }
});

test('a generated castle retains its gabled roof in the exterior player projection', () => {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const engine = new TerrainEngine(60, 60);
  engine.configureGeometryScale(1.5);
  engine.generateBiomeElevation('cliffsideCastle', { seed: 42 });
  const saved = engine.save();
  const roofs = engine.geometry
    .getSolidCells()
    .filter(
      (cell) =>
        cell.layerId === 'roof' &&
        cell.materialColor !== undefined &&
        cell.bounds.max.y - cell.bounds.min.y > 0.1
    );
  const roof = roofs[0];
  expect(roof).toBeDefined();
  const x = 227.5;
  const z = 37.5;
  const cellX = Math.floor(x / 5);
  const cellZ = Math.floor(z / 5);
  const support = engine.geometry.findSupport(x, z, { belowFeet: 1000, clearanceFeet: 5 });
  expect(support).toBeDefined();
  const base = sceneState();
  const observer = {
    ...base.creatures[0],
    mapId: 'map-main',
    gridX: cellX,
    gridY: cellZ,
    pose: { kind: 'ground', world: { x: x / 5, y: support.heightFeet / 5, z: z / 5 } },
  };
  const map = {
    id: 'map-main',
    name: 'Generated cliffside castle',
    base: 'ground',
    grid: { cols: 60, rows: 60, tileWorldSize: 1 },
    originFeet: { x: 0, y: 0, z: 0 },
    quarterTurns: 0,
    terrain: {
      ...base.terrain,
      heights: saved.heights,
      geometry: saved.geometry,
      biome: 'cliffsideCastle',
      seed: 42,
    },
  };
  const scene = {
    version: 3,
    ruleset: '2014',
    maps: [map],
    creatures: [observer],
    tokenCounters: base.tokenCounters,
    combat: base.combat,
    rollLog: [],
    view: { mapId: map.id, focusTokenId: observer.id, camera: base.camera },
    connections: [],
  };
  const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
  const authored = new TerrainVolumeMeshBuilder().build({
    geometry: world.getMapGeometry(map.id),
    three,
    worldUnitsPerFoot: map.grid.tileWorldSize / 5,
    ...getMapTerrainAppearance(world, world.getMap(map.id)),
  });
  expect(hasRoofSurface(authored, roof)).toBe(true);
  authored.dispose();
  const geometry = buildPlayerTerrainView({
    world,
    map: world.getMap(map.id),
    observer,
    visibleMapIds: new Set([map.id]),
    obstacles: physicalSightObstacles(world, observer.mapId),
    three,
  });
  try {
    expect(hasRoofSurface(geometry, roof)).toBe(true);
  } finally {
    geometry.dispose();
  }
}, 60000);

test('the DM can browse unseen room geometry without opening its door or moving a creature', () => {
  const { world, map } = fixture();
  const gm = {
    campaignWorld: world,
    campaignMapId: map.id,
    cols: 5,
    rows: 5,
    spatial: { tileWorldSize: 1, elevationUnit: 0.3 },
    terrainEngine: {
      geometry: world.getMapGeometry(map.id),
      getHeightAt: () => 0,
      onChanged: () => () => {},
    },
    threeSceneManager: { three, scene: new three.Scene() },
  };
  const projection = new MapProjectionTerrain(gm);
  try {
    const before = world.save();
    projection.update(null, []);
    expect(projection.sources.get('unseen').mesh.visible).toBe(true);
    expect(world.save()).toEqual(before);
  } finally {
    projection.dispose();
  }
});

test('outside views render one correctly colored indoor support surface, not overlapping grass and floor', () => {
  const board = fixture();
  const geometry = visible({ ...board, map: board.world.getMap('outside') });
  const mesh = new three.Mesh(geometry, new three.MeshBasicMaterial({ side: three.DoubleSide }));
  try {
    const hits = new three.Raycaster(
      new three.Vector3(2.31, 2, 2.27),
      new three.Vector3(0, -1, 0)
    ).intersectObject(mesh);
    expect(hits.filter((hit) => Math.abs(hit.point.y) < 1e-5).length).toBe(1);
    const expected = new three.Color(GRID_CONFIG.TILE_COLOR);
    const colors = geometry.getAttribute('color');
    const index = hits[0].face.a;
    expect(colors.getX(index)).toBeCloseTo(expected.r);
    expect(colors.getY(index)).toBeCloseTo(expected.g);
    expect(colors.getZ(index)).toBeCloseTo(expected.b);
  } finally {
    geometry.dispose();
    mesh.material.dispose();
  }
});
