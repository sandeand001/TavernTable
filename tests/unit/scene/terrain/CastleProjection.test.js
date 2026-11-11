import * as three from 'three';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import CampaignWorld from '../../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { createTwoFloorTravelScene } from '../../../../src/campaigns/examples/ConnectedTravelExample.js';
import { reconcileBuildingScene } from '../../../../src/campaigns/BuildingAssembly.js';
import MapProjectionTerrain from '../../../../src/scene/token-adapter/MapProjectionTerrain.js';
import { TerrainVolumeMeshBuilder } from '../../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';

test('a full castle projection reuses native curved surfaces without adding solid fragments', () => {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const engine = new TerrainEngine(60, 60);
  engine.generateBiomeElevation('castle', { seed: 42 });
  const base = createTwoFloorTravelScene({
    ruleset: '2014',
    characters: ['A', 'B', 'C'].map((name) => ({ id: name, name })),
  });
  const scene = {
    ...base,
    creatures: [],
    connections: [],
    tokenCounters: { nextId: 0, types: [] },
    view: { ...base.view, focusTokenId: null },
    maps: [
      {
        ...base.maps[0],
        grid: { cols: 60, rows: 60, tileWorldSize: 1 },
        terrain: {
          ...base.maps[0].terrain,
          heights: engine.save().heights,
          geometry: engine.geometry.save(),
          biome: 'castle',
        },
      },
    ],
  };
  const world = CampaignWorld.fromScene(
    reconcileBuildingScene(scene, { ruleset: '2014', library }),
    { ruleset: '2014', library }
  );
  const map = world.getMap(world.listMaps().find(({ id }) => id !== 'map-main').id);
  const reference = world.getMapGeometry('map-main');
  const native = new TerrainVolumeMeshBuilder().build({
    geometry: reference,
    three,
    worldUnitsPerFoot: 1,
  });
  const projection = new MapProjectionTerrain({
    campaignWorld: world,
    campaignMapId: map.id,
    spatial: { tileWorldSize: 1 },
    terrainEngine: { geometry: world.getMapGeometry(map.id), onChanged: () => () => {} },
    threeSceneManager: { three, scene: new three.Scene() },
  });
  try {
    const actual = projection._source('map-main').full.getAttribute('position');
    const expected = native.getAttribute('position');
    expect(actual.count).toBe(expected.count);
    expect(actual.array.every((value, index) => value === expected.array[index])).toBe(true);
  } finally {
    native.dispose();
    projection.dispose();
  }
}, 30000);
