import * as three from 'three';
import CampaignWorld from '../../../../src/campaigns/CampaignWorld.js';
import {
  captureCampaignScene,
  changeCampaignView,
  restoreCampaignScene,
} from '../../../../src/campaigns/SceneWorld.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import { TerrainGeometry } from '../../../../src/terrain/TerrainGeometry.js';
import { createCampaignBoard } from '../../../helpers/campaignBoard.js';
import { sceneState } from '../../../helpers/sceneState.js';
import { TerrainMeshBuilder } from '../../../../src/scene/terrain/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../../../src/scene/terrain/TerrainRebuilder.js';
import MapProjectionTerrain from '../../../../src/scene/token-adapter/MapProjectionTerrain.js';

async function fixture({ interiorOwnsShell = false, stories = 1, quarterTurns = 0 } = {}) {
  localStorage.clear();
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const scene = sceneState();
  scene.terrain.heights = scene.terrain.heights.map((row) => row.map(() => 0));
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  for (const [id, min, max] of [
    ['west', [5, 0, 5], [6, stories * 10, 20]],
    ['east', [19, 0, 5], [20, stories * 10, 20]],
    ['north', [5, 0, 5], [20, stories * 10, 6]],
    ['south', [5, 0, 19], [20, stories * 10, 20]],
    ['roof', [5, stories * 10 - 0.5, 5], [20, stories * 10, 20]],
  ]) {
    geometry.addSolid({
      id,
      layerId: id === 'roof' ? 'roof' : 'ground',
      bounds: {
        min: { x: min[0], y: min[1], z: min[2] },
        max: { x: max[0], y: max[1], z: max[2] },
      },
    });
  }
  geometry.carve({
    id: 'window',
    bounds: { min: { x: 4.5, y: 2, z: 8 }, max: { x: 6.5, y: 7, z: 12 } },
  });
  geometry.carve({
    id: 'door',
    bounds: { min: { x: 4.5, y: 0, z: 15 }, max: { x: 6.5, y: 7, z: 18 } },
  });
  scene.terrain.geometry = geometry.save();
  scene.version = 2;
  const world = CampaignWorld.fromScene(scene, { ruleset: '2014', library });
  world.addMap({
    id: 'inside',
    name: 'Interior',
    base: 'floor',
    originFeet: [
      { x: 5, y: 0, z: 5 },
      { x: 30, y: 0, z: 5 },
      { x: 30, y: 0, z: 30 },
      { x: 5, y: 0, z: 30 },
    ][quarterTurns],
    quarterTurns,
    grid: { cols: 5, rows: 5, tileWorldSize: 2 },
    terrain: {
      ...sceneState().terrain,
      heights: Array.from({ length: 5 }, () => Array(5).fill(0)),
    },
  });
  if (stories > 1)
    world.addMap({
      ...world.getMap('inside'),
      id: 'upstairs',
      name: 'Upper floor',
      originFeet: { ...world.getMap('inside').originFeet, y: 10 },
    });
  const saved = world.save();
  if (interiorOwnsShell) {
    saved.maps.find((map) => map.id === 'inside').terrain.geometry = {
      ...geometry.save(),
      volumes: geometry.save().volumes.map((volume) => ({
        ...volume,
        bounds: {
          min: {
            x: Math.max(0, volume.bounds.min.x - 5),
            y: volume.bounds.min.y,
            z: Math.max(0, volume.bounds.min.z - 5),
          },
          max: {
            x: volume.bounds.max.x - 5,
            y: volume.bounds.max.y,
            z: volume.bounds.max.z - 5,
          },
        },
      })),
    };
    delete saved.maps.find((map) => map.id === 'map-main').terrain.geometry;
  }
  const gm = createCampaignBoard(library);
  await restoreCampaignScene(gm, saved, library, gm.characterServices.combat);
  return gm;
}

function hits(root, position, direction) {
  root.updateMatrixWorld(true);
  return new three.Raycaster(
    new three.Vector3(...position),
    new three.Vector3(...direction)
  ).intersectObject(root, true);
}

function terrainMesh(gm) {
  return new TerrainRebuilder({
    gameManager: gm,
    builder: new TerrainMeshBuilder({
      tileWorldSize: gm.spatial.tileWorldSize,
      elevationUnit: gm.spatial.elevationUnit,
    }),
  }).rebuild({ three });
}

function dispose(gm) {
  for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
  gm.token3DAdapter.disposeMapProjectionTerrain();
  gm.token3DAdapter.disposeMovementRange();
}

test('an interior doorway shows the actual exterior ground without needing an exterior creature', async () => {
  const gm = await fixture();
  let terrain;
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    terrain = new MapProjectionTerrain(gm);
    terrain.update({ id: 'viewer', mapId: 'inside', world: { x: 1, y: 0, z: 4.6 } }, []);
    expect(terrain.root.visible).toBe(true);
    const ground = hits(terrain.root, [-1, 5, 4.6], [0, -1, 0]);
    expect(ground.length).toBeGreaterThan(0);
    expect(ground[0].point.y).toBeCloseTo(0);
  } finally {
    terrain?.dispose();
    dispose(gm);
  }
});

test('an interior view shows physical walls, window and door openings without its ceiling or duplicated structures', async () => {
  const gm = await fixture();
  const physical = gm.campaignWorld.getMap('map-main').terrain.geometry;
  const actor = gm.placedTokens[0];
  const position = { ...actor.world };
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    const walls = gm.threeSceneManager.scene.getObjectByName('MapInteriorWalls');
    expect(walls).toBeDefined();
    expect(walls.visible).toBe(true);
    expect(hits(walls, [1, 1.6, 0.6], [-1, 0, 0]).length).toBeGreaterThan(0);
    expect(hits(walls, [1, 1.6, 2], [-1, 0, 0])).toEqual([]);
    expect(hits(walls, [1, 0.4, 4.6], [-1, 0, 0])).toEqual([]);
    expect(hits(walls, [1, 3.2, 4.6], [-1, 0, 0]).length).toBeGreaterThan(0);
    expect(hits(walls, [3, 8, 3], [0, -1, 0])).toEqual([]);
    expect(
      gm.campaignWorld.hasLineOfSight({ x: 12.5, y: 0, z: 12.5 }, { x: 12.5, y: 12, z: 12.5 })
    ).toBe(false);
    expect(gm.campaignWorld.getMap('map-main').terrain.geometry).toEqual(physical);
    expect(gm.terrainEngine.geometry.hasVolumes).toBe(false);
    expect(gm.placedTokens).toEqual([actor]);
    expect(actor.world).toEqual(position);
    expect(gm.campaignView.focusTokenId).toBeNull();
  } finally {
    dispose(gm);
  }
});

test('interior-owned geometry also renders without its ceiling while keeping its real floor and physics', async () => {
  const gm = await fixture({ interiorOwnsShell: true });
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    const physical = gm.terrainEngine.geometry.save();
    const mesh = terrainMesh(gm);
    const downward = hits(mesh, [3, 8, 3], [0, -1, 0]);
    expect(downward.length).toBeGreaterThan(0);
    expect(downward[0].point.y).toBeCloseTo(0);
    expect(hits(mesh, [1, 1.6, 0.6], [-1, 0, 0]).length).toBeGreaterThan(0);
    expect(hits(mesh, [1, 1.6, 2], [-1, 0, 0])).toEqual([]);
    expect(gm.terrainEngine.geometry.save()).toEqual(physical);
    expect(gm.terrainEngine.geometry.getSolidSpansAt(7.5, 7.5).at(-1).top).toBe(10);
  } finally {
    dispose(gm);
  }
});

test('a floor view only displays its own story and does not inherit lower-floor openings', async () => {
  const gm = await fixture({ stories: 2 });
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    const walls = gm.threeSceneManager.scene.getObjectByName('MapInteriorWalls');
    let bounds = new three.Box3().setFromObject(walls);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(3.8);
    expect(hits(walls, [1, 1.6, 2], [-1, 0, 0])).toEqual([]);
    await changeCampaignView(gm, { mapId: 'upstairs' });
    bounds = new three.Box3().setFromObject(walls);
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(3.8);
    expect(hits(walls, [1, 1.6, 2], [-1, 0, 0]).length).toBeGreaterThan(0);
    expect(hits(walls, [3, 8, 3], [0, -1, 0])).toEqual([]);
  } finally {
    dispose(gm);
  }
});

test('a higher floor that only touches the map boundary does not truncate this room walls', async () => {
  const gm = await fixture({ stories: 2 });
  const scene = gm.campaignWorld.save();
  scene.maps.find((map) => map.id === 'upstairs').originFeet.x = 30;
  gm.campaignWorld.acceptCheckpoint(scene);
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    const walls = gm.threeSceneManager.scene.getObjectByName('MapInteriorWalls');
    expect(new three.Box3().setFromObject(walls).max.y).toBeCloseTo(7.8);
  } finally {
    dispose(gm);
  }
});

test('interior walls and openings follow the viewed map rotation and render scale', async () => {
  const gm = await fixture({ quarterTurns: 1 });
  try {
    await changeCampaignView(gm, { mapId: 'inside' });
    const walls = gm.threeSceneManager.scene.getObjectByName('MapInteriorWalls');
    expect(hits(walls, [0.6, 1.6, 9], [0, 0, 1]).length).toBeGreaterThan(0);
    expect(hits(walls, [2, 1.6, 9], [0, 0, 1])).toEqual([]);
    expect(hits(walls, [4.6, 0.4, 9], [0, 0, 1])).toEqual([]);
    expect(hits(walls, [4.6, 3.2, 9], [0, 0, 1]).length).toBeGreaterThan(0);
    expect(hits(walls, [3, 8, 7], [0, -1, 0])).toEqual([]);
  } finally {
    dispose(gm);
  }
});

test('returning to the exterior hides the interior overlay and retains the exterior roof', async () => {
  const gm = await fixture();
  try {
    expect(hits(terrainMesh(gm), [2.5, 8, 2.5], [0, -1, 0])[0].point.y).toBeCloseTo(2);
    await changeCampaignView(gm, { mapId: 'inside' });
    terrainMesh(gm);
    const walls = gm.threeSceneManager.scene.getObjectByName('MapInteriorWalls');
    expect(walls.visible).toBe(true);
    await changeCampaignView(gm, { mapId: 'map-main' });
    expect(walls.visible).toBe(false);
    expect(hits(terrainMesh(gm), [2.5, 8, 2.5], [0, -1, 0])[0].point.y).toBeCloseTo(2);
  } finally {
    dispose(gm);
  }
});

test('reopening an empty unfocused interior restores its walls without adding scene geometry or actors', async () => {
  const gm = await fixture();
  try {
    gm.tokenManager.removeToken(gm.placedTokens[0]);
    const scene = await captureCampaignScene(gm, gm.characterServices.library);
    scene.view.mapId = 'inside';
    await restoreCampaignScene(
      gm,
      scene,
      gm.characterServices.library,
      gm.characterServices.combat
    );
    const walls = gm.threeSceneManager.scene.getObjectByName('MapInteriorWalls');
    expect(walls.visible).toBe(true);
    expect(gm.placedTokens).toEqual([]);
    expect(gm.campaignView.focusTokenId).toBeNull();
    const meshCount = walls.children.length;
    await gm.token3DAdapter.syncMapProjections();
    await gm.token3DAdapter.syncMapProjections();
    expect(walls.children).toHaveLength(meshCount);
    expect((await captureCampaignScene(gm, gm.characterServices.library)).maps).toEqual(scene.maps);
  } finally {
    dispose(gm);
  }
});
