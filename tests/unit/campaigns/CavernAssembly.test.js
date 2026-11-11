import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { createCavernInterior } from '../../../src/terrain/generation/CavernInteriors.js';
import { reconcileCavernScene, addCavernArea } from '../../../src/campaigns/CavernAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { sceneState } from '../../helpers/sceneState.js';

const copy = (value) => JSON.parse(JSON.stringify(value));

function fixture(key = 'cavern', seed = 42, cols = 25, rows = 25) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library },
    engine = new TerrainEngine(cols, rows);
  engine.configureGeometryScale(1.5);
  engine.generateBiomeElevation(key, { seed });
  const scene = sceneState();
  scene.version = 2;
  scene.creatures = [];
  scene.grid = { cols, rows, tileWorldSize: 1 };
  Object.assign(scene.terrain, {
    heights: engine.save().heights,
    biome: key,
    seed,
    cavern: engine.cavern,
    geometry: engine.geometry.save(),
    worldElevationUnit: 0.3,
  });
  return { scene: reconcileCavernScene(scene, context, { regenerate: true }), context };
}

function assertConnections(scene, context) {
  const world = CampaignWorld.fromScene(scene, context);
  for (const connection of scene.connections)
    for (const end of connection.ends) {
      const unit = world.getMap(end.mapId).grid.tileWorldSize / 5;
      expect(
        world.planConnection(connection.id, end.mapId, {
          x: end.positionFeet.x * unit,
          y: end.positionFeet.y * unit,
          z: end.positionFeet.z * unit,
        }).costFeet
      ).toBeCloseTo(5);
    }
}

test.each(['cavern', 'fungalGrove', 'crystalFields', 'crystalSpires', 'eldritchRift'])(
  '%s connects elevation-based chambers with native paid passages and no procedural formations',
  (key) => {
    const { scene, context } = fixture(key);
    expect(scene.maps).toHaveLength(3);
    expect(scene.connections).toHaveLength(2);
    expect(
      scene.maps.every(
        (map) =>
          map.base === 'ground' &&
          map.terrain.cavern.version === 5 &&
          (map.terrain.geometry?.volumes || []).length === 0 &&
          (map.terrain.geometry?.structures || []).length === 0
      )
    ).toBe(true);
    expect(
      scene.connections.every((connection) => connection.feature.terrainCells.length === 1)
    ).toBe(true);
    assertConnections(scene, context);
    expect(decodeScene(encodeScene(scene, context), context)).toEqual(copy(scene));
    expect(copy(reconcileCavernScene(scene, context, { regenerate: true }))).toEqual(copy(scene));
  }
);

test('regenerating an unedited prototype cavern removes formations from its automatic side areas too', () => {
  const { scene, context } = fixture();
  for (const map of scene.maps) {
    const previous = createCavernInterior({
      biomeKey: map.terrain.biome,
      ...map.terrain.cavern,
      recipeVersion: 4,
      cols: map.grid.cols,
      rows: map.grid.rows,
      feetPerLevel: (map.terrain.worldElevationUnit * 5) / map.grid.tileWorldSize,
    });
    Object.assign(map.terrain, {
      heights: previous.heights,
      geometry: previous.geometry,
      cavern: previous.cavern,
    });
  }
  expect(scene.maps.some((map) => map.terrain.geometry.volumes.length > 0)).toBe(true);
  const root = scene.maps[0];
  const next = createCavernInterior({
    biomeKey: root.terrain.biome,
    ...root.terrain.cavern,
    cols: root.grid.cols,
    rows: root.grid.rows,
  });
  Object.assign(root.terrain, {
    heights: next.heights,
    geometry: next.geometry,
    cavern: next.cavern,
  });
  const regenerated = reconcileCavernScene(scene, context, { regenerate: true });
  expect(regenerated.maps).toHaveLength(3);
  expect(regenerated.maps.every((map) => map.terrain.cavern.version === 5)).toBe(true);
  expect(regenerated.maps.every((map) => (map.terrain.geometry?.volumes || []).length === 0)).toBe(
    true
  );
  assertConnections(regenerated, context);
});

test.each([
  [5, 5, 1],
  [12, 20, 7],
  [60, 50, 42],
  [25, 25, 123],
])(
  '%s by %s cavern seed %s retains supported crossings on its actual elevation floors',
  (cols, rows, seed) => {
    const { scene, context } = fixture('cavern', seed, cols, rows);
    assertConnections(scene, context);
  }
);

test('a manually added winding tunnel is a separate elevation map and does not move actors', () => {
  const { scene, context } = fixture();
  const next = addCavernArea(scene, context, 'map-main', {
    side: 'south',
    kind: 'tunnel',
    name: 'Lower tunnel',
    id: 'manual-tunnel',
  });
  expect(scene.maps).toHaveLength(3);
  expect(next.maps).toHaveLength(4);
  expect(next.creatures).toEqual(scene.creatures);
  const tunnel = next.maps.find((map) => map.id === 'manual-tunnel');
  expect(tunnel.base).toBe('ground');
  expect(tunnel.terrain.geometry).toBeUndefined();
  expect(tunnel.terrain.cavern.kind).toBe('tunnel');
  assertConnections(next, context);
  expect(() => addCavernArea(next, context, 'manual-tunnel', { side: 'north' })).toThrow(
    /already/i
  );
});

test('same-seed generation preserves edited chambers, and replacing them fails explicitly', () => {
  const { scene, context } = fixture();
  const child = scene.maps.find((map) => map.cavern.parentMapId === 'map-main');
  child.name = 'Authored room';
  expect(
    reconcileCavernScene(scene, context, { regenerate: true }).maps.find(
      (map) => map.id === child.id
    ).name
  ).toBe(child.name);
  const candidate = copy(scene),
    root = candidate.maps.find((map) => map.id === 'map-main');
  const next = createCavernInterior({ biomeKey: 'cavern', seed: 7, cols: 25, rows: 25 });
  root.terrain.heights = next.heights;
  root.terrain.cavern = next.cavern;
  expect(() => reconcileCavernScene(candidate, context, { regenerate: true })).toThrow(/edited/i);
});
