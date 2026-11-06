import * as three from 'three';
import { TerrainEngine } from '../../../../src/terrain/TerrainEngine.js';
import { reconcileBuildingScene } from '../../../../src/campaigns/BuildingAssembly.js';
import CampaignWorld from '../../../../src/campaigns/CampaignWorld.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { sceneState } from '../../../helpers/sceneState.js';
import { createInteriorCutaway } from '../../../../src/scene/terrain/InteriorCutaway.js';
import { TerrainVolumeMeshBuilder } from '../../../../src/scene/terrain/TerrainVolumeMeshBuilder.js';

function fixture(roof = 'gable', roomHeight = 10, floorId = 1) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const engine = new TerrainEngine(25, 25);
  engine.placeStructure({
    id: 'house',
    kind: 'building',
    xFeet: 60,
    zFeet: 60,
    lengthFeet: 30,
    widthFeet: 30,
    building: { roof },
  });
  const depth = roomHeight + 10;
  engine.placeStructure({
    id: 'cellar',
    kind: 'cellar',
    xFeet: 60,
    zFeet: 60,
    heightFeet: depth,
    lengthFeet: 50,
    widthFeet: 40,
    building: {
      version: 3,
      levels: [
        { id: 0, elevationFeet: -10, openings: [] },
        { id: 1, elevationFeet: -depth, openings: [] },
      ],
    },
  });
  const scene = sceneState();
  scene.version = 2;
  scene.grid = { cols: 25, rows: 25, tileWorldSize: 1 };
  scene.terrain.heights = engine.save().heights;
  scene.terrain.geometry = engine.geometry.save();
  scene.creatures = [];
  const world = CampaignWorld.fromScene(
    reconcileBuildingScene(scene, { ruleset: '2014', library }),
    {
      ruleset: '2014',
      library,
    }
  );
  const lowest = world
    .save()
    .maps.find((map) => map.building?.structureId === 'cellar' && map.building.floor === floorId);
  const active = new TerrainEngine(lowest.grid.cols, lowest.grid.rows);
  active.configureGeometryBase(0.5);
  active.load({ heights: lowest.terrain.heights, geometry: lowest.terrain.geometry });
  const gm = {
    cols: lowest.grid.cols,
    rows: lowest.grid.rows,
    campaignMapId: lowest.id,
    campaignWorld: world,
    terrainEngine: active,
    spatial: { tileWorldSize: 1, elevationUnit: 0.3 },
  };
  return { gm, world, lowest, depth };
}

test('the upper cellar cutaway also keeps its walls joined to the floor without exposing the surface ceiling', () => {
  const { gm, world } = fixture('gable', 10, 0),
    owner = world.getMap('map-main');
  const geometry = world.getMapGeometry(owner.id);
  const mesh = new TerrainVolumeMeshBuilder().build({
    geometry: createInteriorCutaway(gm).query(geometry, owner, geometry.getPartition()),
    three,
    worldUnitsPerFoot: 1,
  });
  try {
    mesh.computeBoundingBox();
    expect(mesh.boundingBox.min.y).toBe(-10);
    expect(mesh.boundingBox.max.y).toBe(-0.5);
  } finally {
    mesh.dispose();
  }
});

test.each([
  ['gable', 10],
  ['gable', 20],
  ['hipped', 10],
  ['flat', 10],
  ['none', 10],
])(
  'the bottom cellar wall meets its floor for a %s exterior and a %i-foot room',
  (roof, roomHeight) => {
    const { gm, world, lowest, depth } = fixture(roof, roomHeight);
    const owner = world.getMap('map-main'),
      geometry = world.getMapGeometry(owner.id);
    const saved = world.save(),
      cutaway = createInteriorCutaway(gm);
    const query = cutaway.query(geometry, owner, geometry.getPartition());
    if (geometry.hasCurves) {
      const cells = query.getSolidCells();
      expect(Math.min(...cells.map((cell) => cell.bounds.min.y))).toBe(-depth);
    }
    const mesh = new TerrainVolumeMeshBuilder().build({
      geometry: query,
      three,
      worldUnitsPerFoot: 1,
    });
    try {
      mesh.computeBoundingBox();
      expect(mesh.getAttribute('position').count).toBeGreaterThan(0);
      expect(mesh.boundingBox.min.y).toBeCloseTo(lowest.originFeet.y, 6);
      expect(mesh.boundingBox.min.y).toBe(-depth);
      expect(mesh.boundingBox.max.y).toBeCloseTo(-10.5, 6);
      const material = new three.MeshBasicMaterial({ side: three.DoubleSide });
      const visual = new three.Mesh(mesh, material);
      visual.updateMatrixWorld(true);
      try {
        for (const [x, z] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ]) {
          const ray = new three.Raycaster(
            new three.Vector3(60, -depth + 0.05, 60),
            new three.Vector3(x, 0, z)
          );
          expect(ray.intersectObject(visual).length).toBeGreaterThan(0);
        }
      } finally {
        material.dispose();
      }
      expect(world.save()).toEqual(saved);
    } finally {
      mesh.dispose();
    }
  }
);
