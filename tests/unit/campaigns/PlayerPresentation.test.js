import { playerRenderAssets } from '../../../src/campaigns/PlayerPresentation.js';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { createStructure, structureVolumes } from '../../../src/terrain/ConstructionBlueprints.js';
import { sceneState } from '../../helpers/sceneState.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { validatePlayerAssets } from '../../../src/campaigns/PlayerPublicProtocol.js';

function fixture() {
  const maps = new Map(
    ['outside', 'room'].map((id) => [
      id,
      {
        id,
        name: id === 'room' ? 'UNENTERED ROOM' : 'Courtyard',
        locationId: 'site',
        originFeet: { x: 0, y: 0, z: 0 },
        quarterTurns: 0,
        base: id === 'room' ? 'floor' : 'ground',
        grid: { cols: 5, rows: 5, tileWorldSize: 1 },
        terrain: {
          ...sceneState().terrain,
          heights: Array.from({ length: 5 }, () => Array(5).fill(0)),
        },
      },
    ])
  );
  const geometries = new Map(
    [...maps].map(([id, map]) => [
      id,
      new TerrainGeometry({
        widthFeet: 25,
        depthFeet: 25,
        terrainThicknessFeet: map.base === 'floor' ? 0.5 : null,
        getTerrainHeightFeet: () => 0,
      }),
    ])
  );
  const world = {
    getLocationId: () => 'site',
    listLocationMaps: () => [...maps.values()].map(({ id, name }) => ({ id, name })),
    listLocations: () => [{ id: 'site', name: 'Site' }],
    getMap: (id) => maps.get(id),
    getMapGeometry: (id) => geometries.get(id),
    getConnections: () => [],
  };
  return { world, maps, geometries };
}

test('public assets exclude rooms outside the active observer visibility set', () => {
  const { world } = fixture();
  const assets = playerRenderAssets(world, 'outside', { visibleMapIds: new Set(['outside']) });
  expect(assets.maps.map(({ id }) => id)).toEqual(['outside']);
  expect(JSON.stringify(assets)).not.toContain('UNENTERED ROOM');
});

test('public geometry retains physical support without exposing construction authoring records', () => {
  const { world, maps, geometries } = fixture();
  const spec = createStructure({
    id: 'wall',
    kind: 'wall',
    name: 'PRIVATE CONSTRUCTION NOTES',
    xFeet: 12.5,
    zFeet: 12.5,
    heightFeet: 10,
    lengthFeet: 20,
    widthFeet: 2,
  });
  const saved = { version: 3, structures: [spec], volumes: structureVolumes(spec) };
  maps.get('outside').terrain.geometry = saved;
  geometries.get('outside').load(saved);
  const assets = playerRenderAssets(world, 'outside', { visibleMapIds: new Set(['outside']) });
  const snapshot = assets.maps[0].terrain.geometry;
  expect(snapshot.structures).toBeUndefined();
  expect(snapshot.volumes.every((volume) => volume.structureId === undefined)).toBe(true);
  expect(JSON.stringify(assets)).not.toContain('PRIVATE CONSTRUCTION NOTES');
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.load(snapshot);
  expect(geometry.findSupport(12.5, 12.5, { belowFeet: 100 }).heightFeet).toBeCloseTo(10);
});

test('managed floors expose derived render context and physical door leaves without private building records', () => {
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const engine = new TerrainEngine(10, 10);
  engine.placeStructure({
    id: 'inn',
    kind: 'building',
    xFeet: 25,
    zFeet: 25,
    lengthFeet: 20,
    widthFeet: 20,
  });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 10, rows: 10, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures = [];
  const world = CampaignWorld.fromScene(
    reconcileBuildingScene(scene, { ruleset: '2014', library }),
    { ruleset: '2014', library }
  );
  const floor = world.save().maps.find((map) => map.building);
  const assets = playerRenderAssets(world, floor.id, {
    visibleMapIds: new Set([floor.id, floor.building.ownerMapId]),
  });
  expect(() => validatePlayerAssets(assets)).not.toThrow();
  const publicFloor = assets.maps.find(({ id }) => id === floor.id);
  expect(publicFloor.building).toBeUndefined();
  expect(publicFloor.floorContext).toEqual({
    ownerMapId: floor.building.ownerMapId,
    ceilingFeet: expect.any(Number),
    terrainThicknessFeet: 0.5,
    floorAppearance: null,
  });
  expect(assets.maps.every((map) => !map.terrain.geometry.structures)).toBe(true);
  const outside = playerRenderAssets(world, floor.building.ownerMapId);
  expect(() => validatePlayerAssets(outside)).not.toThrow();
  expect(outside.maps).toHaveLength(1);
  expect(outside.connections).toEqual([]);
  expect(outside.doorPanels.length).toBeGreaterThan(0);
  expect(
    outside.doorPanels.every((door) => door.mapIds.every((id) => id === floor.building.ownerMapId))
  ).toBe(true);
  expect(
    outside.doorPanels
      .flatMap((door) => door.cells)
      .every((cell) => !cell.structureId && !cell.name)
  ).toBe(true);
});
