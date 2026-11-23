import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import {
  CAVERN_SIDES,
  createCavernInterior,
  oppositeCavernSide,
} from '../../../src/terrain/generation/CavernInteriors.js';
import { reconcileCavernScene, addCavernArea } from '../../../src/campaigns/CavernAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { sceneState } from '../../helpers/sceneState.js';
import {
  addLogicalCavernArea,
  createLogicalCavernNetwork,
} from '../../../src/campaigns/CampaignLogicalPassages.js';

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
    expect(scene.maps).toHaveLength(scene.maps[0].terrain.cavern.exits.length + 1);
    expect(scene.connections).toHaveLength(scene.maps[0].terrain.cavern.exits.length);
    expect(
      scene.maps.every(
        (map) =>
          map.base === 'ground' &&
          map.terrain.cavern.version === 7 &&
          (map.terrain.geometry?.volumes || []).length === 0 &&
          (map.terrain.geometry?.structures || []).length === 0
      )
    ).toBe(true);
    expect(
      scene.connections.every((connection) => connection.feature.terrainCells.length === 1)
    ).toBe(true);
    const root = scene.maps[0];
    expect(root.terrain.heights).toEqual(
      createCavernInterior({
        biomeKey: key,
        ...root.terrain.cavern,
        cols: root.grid.cols,
        rows: root.grid.rows,
        recipeVersion: root.terrain.cavern.version,
      }).heights
    );
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
  expect(regenerated.maps.every((map) => map.terrain.cavern.version === 7)).toBe(true);
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
  const side = CAVERN_SIDES.find(
    (candidate) => !scene.maps[0].terrain.cavern.exits.includes(candidate)
  );
  const next = addCavernArea(scene, context, 'map-main', {
    side,
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
  expect(() =>
    addCavernArea(next, context, 'manual-tunnel', { side: oppositeCavernSide(side) })
  ).toThrow(/already/i);
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

test('upgrading a cavern preserves connected version-six chambers and their passages', () => {
  const { scene, context } = fixture();
  for (const map of scene.maps) {
    const previous = createCavernInterior({
      biomeKey: map.terrain.biome,
      ...map.terrain.cavern,
      cols: map.grid.cols,
      rows: map.grid.rows,
      recipeVersion: 6,
    });
    Object.assign(map.terrain, { heights: previous.heights, cavern: previous.cavern });
  }
  const root = scene.maps[0];
  const upgraded = createCavernInterior({
    biomeKey: root.terrain.biome,
    ...root.terrain.cavern,
    cols: root.grid.cols,
    rows: root.grid.rows,
  });
  Object.assign(root.terrain, { heights: upgraded.heights, cavern: upgraded.cavern });
  const originalChambers = copy(scene.maps.slice(1));
  const originalConnections = copy(scene.connections);
  const result = reconcileCavernScene(scene, context, {
    regenerate: true,
    preserveAreas: true,
    preserveAreaSeeds: true,
  });
  expect(result.maps.slice(1)).toEqual(originalChambers);
  expect(result.connections).toEqual(originalConnections);
  assertConnections(result, context);
  expect(reconcileCavernScene(result, context, { regenerate: true })).toEqual(result);
});

test('adding a physical area to a version-six cavern keeps its recipe version', () => {
  const { scene, context } = fixture();
  for (const map of scene.maps) {
    const previous = createCavernInterior({
      biomeKey: map.terrain.biome,
      ...map.terrain.cavern,
      cols: map.grid.cols,
      rows: map.grid.rows,
      recipeVersion: 6,
    });
    Object.assign(map.terrain, { heights: previous.heights, cavern: previous.cavern });
  }
  const side = CAVERN_SIDES.find(
    (candidate) => !scene.maps[0].terrain.cavern.exits.includes(candidate)
  );
  const next = addCavernArea(scene, context, 'map-main', { side, id: 'legacy-chamber' });
  expect(next.maps.find(({ id }) => id === 'legacy-chamber').terrain.cavern.version).toBe(6);
  expect(reconcileCavernScene(next, context, { regenerate: true })).toEqual(next);
  assertConnections(next, context);
});

test.each(['cavern', 'fungalGrove', 'crystalFields', 'crystalSpires', 'eldritchRift'])(
  '%s creates independent blank chambers without moving or changing the starting map',
  (key) => {
    const { scene, context } = fixture(key);
    scene.maps = [scene.maps[0]];
    scene.connections = [];
    const before = copy(scene);
    const planned = createLogicalCavernNetwork(scene, {
      mapId: 'map-main',
      totalChambers: 4,
    });
    expect(scene).toEqual(before);
    expect(planned.maps).toHaveLength(4);
    expect(planned.maps[0].terrain).toEqual(before.maps[0].terrain);
    expect(planned.logicalPassages).toHaveLength(3);
    const world = CampaignWorld.fromScene(planned, context);
    const created = planned.maps.filter((map) => map.id !== 'map-main');
    expect(new Set(created.map((map) => map.locationId)).size).toBe(3);
    for (const map of created) {
      expect(world.sharesLocation('map-main', map.id)).toBe(false);
      expect(map.terrain.biome).toBeNull();
      expect(map.terrain.heights.flat().every((height) => height === 0)).toBe(true);
      expect(map.terrain.placeables).toEqual([]);
      expect(map.terrain.geometry).toBeUndefined();
    }
    expect(decodeScene(encodeScene(planned, context), context)).toEqual(planned);
  }
);

test('selected outside entrances can share one blank outside map with distinct endpoints', () => {
  const { scene, context } = fixture();
  scene.maps = [scene.maps[0]];
  scene.connections = [];
  const sides = scene.maps[0].terrain.cavern.exits;
  const planned = createLogicalCavernNetwork(scene, {
    mapId: 'map-main',
    totalChambers: 1,
    outsideSides: sides,
    outsideMode: 'shared',
  });
  const outside = planned.maps.find((map) => map.id !== 'map-main');
  expect(planned.maps).toHaveLength(2);
  expect(planned.logicalPassages).toHaveLength(sides.length);
  expect(
    new Set(
      planned.logicalPassages.map(
        (passage) => passage.ends.find((end) => end.mapId === outside.id).side
      )
    ).size
  ).toBe(sides.length);
  expect(outside.terrain.biome).toBeNull();
  expect(() => CampaignWorld.fromScene(planned, context)).not.toThrow();
});

test('outside entrances can lead to separate blank maps and are not recreated on regeneration', () => {
  const { scene, context } = fixture();
  scene.maps = [scene.maps[0]];
  scene.connections = [];
  const sides = scene.maps[0].terrain.cavern.exits;
  const options = {
    mapId: 'map-main',
    totalChambers: 1,
    outsideSides: sides,
    outsideMode: 'separate',
  };
  const planned = createLogicalCavernNetwork(scene, options);
  expect(planned.maps).toHaveLength(1 + sides.length);
  expect(
    new Set(
      planned.logicalPassages.map(
        (passage) => passage.ends.find((end) => end.mapId !== 'map-main').mapId
      )
    ).size
  ).toBe(sides.length);
  expect(createLogicalCavernNetwork(planned, options)).toEqual(planned);
  expect(() => encodeScene(planned, context)).not.toThrow();
});

test('an unused entrance can later add a blank chamber without regenerating the source', () => {
  const { scene, context } = fixture();
  scene.maps = [scene.maps[0]];
  scene.connections = [];
  const before = copy(scene);
  const side = scene.maps[0].terrain.cavern.exits[0];
  const planned = addLogicalCavernArea(scene, { mapId: 'map-main', side, kind: 'chamber' });
  expect(scene).toEqual(before);
  expect(planned.maps).toHaveLength(2);
  expect(planned.maps[0].terrain).toEqual(before.maps[0].terrain);
  expect(planned.maps[1].terrain.biome).toBeNull();
  expect(planned.logicalPassages[0]).toMatchObject({
    kind: 'chamber',
    ends: [{ mapId: 'map-main', side }, { mapId: planned.maps[1].id }],
  });
  expect(() => encodeScene(planned, context)).not.toThrow();
});

test('a later outside entrance can reuse an existing outside map without reusing its endpoint', () => {
  const { scene, context } = fixture();
  scene.maps = [scene.maps[0]];
  scene.connections = [];
  const [first, second] = scene.maps[0].terrain.cavern.exits;
  const created = addLogicalCavernArea(scene, { mapId: 'map-main', side: first, kind: 'outside' });
  const outside = created.maps.find((map) => map.id !== 'map-main');
  const shared = addLogicalCavernArea(created, {
    mapId: 'map-main',
    side: second,
    kind: 'outside',
    outsideMapId: outside.id,
  });
  expect(shared.maps).toHaveLength(2);
  expect(shared.maps.find((map) => map.id === outside.id)).toEqual(outside);
  expect(new Set(shared.logicalPassages.map((passage) => passage.ends[1].side)).size).toBe(2);
  expect(() => encodeScene(shared, context)).not.toThrow();
});

test('chamber counts cannot discard linked maps, and insufficient entrances leave the scene untouched', () => {
  const { scene } = fixture();
  scene.maps = [scene.maps[0]];
  scene.connections = [];
  const planned = createLogicalCavernNetwork(scene, { mapId: 'map-main', totalChambers: 3 });
  const before = copy(planned);
  expect(() =>
    createLogicalCavernNetwork(planned, { mapId: 'map-main', totalChambers: 2 })
  ).toThrow(/already|preserv|linked/i);
  const occupied = copy(scene);
  occupied.maps[0].terrain.cavern.exits = [];
  expect(() =>
    createLogicalCavernNetwork(occupied, { mapId: 'map-main', totalChambers: 2 })
  ).toThrow(/entrance|passage/i);
  expect(planned).toEqual(before);
  const bothOutside = copy(scene);
  expect(() =>
    createLogicalCavernNetwork(bothOutside, {
      mapId: 'map-main',
      totalChambers: 2,
      outsideSides: bothOutside.maps[0].terrain.cavern.exits,
      outsideMode: 'shared',
    })
  ).toThrow(/entrance|passage/i);
  expect(bothOutside).toEqual(scene);
});
