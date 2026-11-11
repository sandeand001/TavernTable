import { createStructure } from '../../../src/terrain/ConstructionBlueprints.js';
import {
  buildingWindows,
  buildingLevels,
  buildingLevelElevation,
  buildingWindowSections,
  buildingFeatureLimits,
  createWindowLayout,
} from '../../../src/terrain/BuildingModel.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { reconcileBuildingScene } from '../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../helpers/sceneState.js';

const hall = (seed = 42, style = 'fortress') =>
  createStructure({
    id: 'keep',
    kind: 'building',
    xFeet: 100,
    zFeet: 100,
    lengthFeet: 60,
    widthFeet: 45,
    heightFeet: 50,
    building: { windowLayout: createWindowLayout(style, ['north', 'east', 'south', 'west'], seed) },
  });

test('new seeded facade recipes vary actual dimensions, sills and positions, not just window counts', () => {
  const windows = buildingWindows(hall());
  expect(new Set(windows.map((w) => w.widthFeet)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(windows.map((w) => w.heightFeet)).size).toBeGreaterThanOrEqual(3);
  expect(new Set(windows.map((w) => w.sillFeet)).size).toBeGreaterThanOrEqual(2);
  const east = windows.filter((w) => w.side === 'east');
  expect(new Set(east.map((w) => w.u)).size).toBeGreaterThanOrEqual(2);
  expect(new Set(windows.map((w) => w.u)).size).toBeGreaterThanOrEqual(3);
  expect(windows.some((w) => w.heightFeet > 10)).toBe(true);
  expect(buildingWindows(hall(42))).toEqual(windows);
  expect(buildingWindows(hall(43))).not.toEqual(windows);
  for (const w of windows) {
    const limits = buildingFeatureLimits(hall(), 'window', w);
    expect(w.widthFeet).toBeLessThanOrEqual(limits.maxWidthFeet);
    expect(w.heightFeet).toBeLessThanOrEqual(limits.maxHeightFeet);
    expect(w.sillFeet).toBeGreaterThanOrEqual(limits.minSillFeet);
  }
});

test.each(['residential', 'civic', 'fortress'])(
  '%s compositions preserve sparse wall sections and avoid overlapping generated openings',
  (style) => {
    for (const seed of [1, 2, 7, 42]) {
      const spec = hall(seed, style),
        windows = buildingWindows(spec);
      for (const level of buildingLevels(spec, { includeDeck: false }))
        for (const side of ['north', 'east', 'south', 'west']) {
          const elevation = level.elevationFeet;
          const row = windows.filter(
            (w) =>
              w.side === side &&
              buildingLevelElevation(spec, w.floor) + w.sillFeet < elevation + 10 &&
              buildingLevelElevation(spec, w.floor) + w.sillFeet + w.heightFeet > elevation
          );
          expect(row.length).toBeLessThanOrEqual(2);
          const span = ['north', 'south'].includes(side) ? spec.lengthFeet : spec.widthFeet;
          expect(row.reduce((total, w) => total + w.widthFeet, 0)).toBeLessThanOrEqual(span * 0.5);
        }
      expect(windows.length).toBeLessThanOrEqual(40);
    }
  }
);

test('version-one spacing and pre-layout saved buildings keep exactly their old dimensions', () => {
  for (const windowLayout of [undefined, createWindowLayout('fortress')]) {
    const spec = createStructure({
      id: 'old',
      kind: 'building',
      xFeet: 100,
      zFeet: 100,
      lengthFeet: 60,
      widthFeet: 45,
      heightFeet: 30,
      building: { version: 2, ...(windowLayout ? { windowLayout } : {}) },
    });
    const before = buildingWindows(spec);
    expect(before.every((w) => w.widthFeet === 5 && w.heightFeet === 5 && w.sillFeet === 2)).toBe(
      true
    );
    const engine = new TerrainEngine(50, 50);
    engine.placeStructure(spec);
    const restored = new TerrainEngine(1, 1);
    restored.load(engine.save());
    expect(buildingWindows(restored.geometry.getStructures()[0])).toEqual(before);
  }
});

test('a generated tall hall window remains one editable feature with real per-floor connections and intact floor slabs', () => {
  const engine = new TerrainEngine(50, 50),
    spec = hall();
  engine.placeStructure(spec);
  const feature = buildingWindows(spec).find((w) => w.heightFeet > 10);
  expect(feature).toBeDefined();
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const context = { ruleset: '2014', library },
    scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 50, rows: 50, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures = [];
  const assembled = reconcileBuildingScene(scene, context),
    world = CampaignWorld.fromScene(assembled, context);
  const connections = world
    .getConnections()
    .filter((c) => c.building?.featureId === `window-${feature.id}`);
  expect(connections.length).toBe(buildingWindowSections(spec, feature).length);
  expect(connections.length).toBeGreaterThanOrEqual(2);
  const edited = {
    ...feature,
    widthFeet: feature.widthFeet + 1,
    heightFeet: feature.heightFeet - 1,
  };
  engine.resizeStructure(spec.id, { building: { ...spec.building, windows: [edited] } });
  expect(buildingWindows(engine.geometry.getStructures()[0])).toContainEqual(edited);
  expect(engine.geometry.getStructures()[0].building.levels).toEqual(spec.building.levels);
  engine.undo();
  expect(buildingWindows(engine.geometry.getStructures()[0])).toEqual(buildingWindows(spec));
});
