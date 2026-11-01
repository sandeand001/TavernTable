import * as three from 'three';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';
import { TerrainMeshBuilder } from '../../../src/scene/terrain/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../../src/scene/terrain/TerrainRebuilder.js';
import { PickingService } from '../../../src/scene/picking/PickingService.js';

test('adding a volume through the terrain owner rebuilds a real playable bridge mesh', () => {
  const world = createTerrainWorld(10, 10, null);
  const gm = world.gm;
  gm.threeSceneManager.scene = new three.Scene();
  gm.threeSceneManager.three = three;
  const rebuilder = new TerrainRebuilder({
    gameManager: gm,
    builder: new TerrainMeshBuilder({ hardEdges: true }),
    debounceMs: 0,
  });
  gm.terrainRebuilder = rebuilder;
  gm.notifyTerrainHeightsChanged = () => rebuilder.rebuild({ three });
  try {
    world.engine.addVolume({
      id: 'bridge',
      layerId: 'bridge',
      bounds: { min: { x: 10, y: 9, z: 10 }, max: { x: 30, y: 10, z: 20 } },
    });
    const mesh = gm.threeSceneManager.scene.getObjectByName('TerrainMesh');
    mesh.updateMatrixWorld(true);
    const ray = new three.Raycaster(new three.Vector3(3, 5, 3), new three.Vector3(0, -1, 0));
    expect(ray.intersectObject(mesh)[0].point.y).toBeCloseTo(2);
    world.engine.setVisibleLayers(['ground']);
    mesh.updateMatrixWorld(true);
    expect(ray.intersectObject(mesh)[0].point.y).toBeCloseTo(0);
    expect(world.engine.geometry.findSupport(15, 15, { belowFeet: 20 }).heightFeet).toBe(10);
  } finally {
    world.dispose();
  }
});

test('real screen picking identifies the clicked floor instead of collapsing it onto the earth below', () => {
  const world = createTerrainWorld(10, 10, null);
  const gm = world.gm;
  const canvas = gm.threeSceneManager.canvas;
  canvas.width = 400;
  canvas.height = 400;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  gm.threeSceneManager.scene = new three.Scene();
  gm.threeSceneManager.three = three;
  const camera = new three.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(3, 8, 3);
  camera.up.set(0, 0, -1);
  camera.lookAt(3, 0, 3);
  camera.updateMatrixWorld(true);
  gm.threeSceneManager.camera = camera;
  const rebuilder = new TerrainRebuilder({
    gameManager: gm,
    builder: new TerrainMeshBuilder({ hardEdges: true }),
    debounceMs: 0,
  });
  gm.terrainRebuilder = rebuilder;
  gm.notifyTerrainHeightsChanged = () => rebuilder.rebuild({ three });
  try {
    world.engine.addVolume({
      id: 'bridge',
      layerId: 'bridge',
      bounds: { min: { x: 10, y: 9, z: 10 }, max: { x: 30, y: 10, z: 20 } },
    });
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const pick = new PickingService({ gameManager: gm }).pickGroundSync(200, 200, canvas);
    expect(pick.surface).toMatchObject({
      kind: 'floor',
      surfaceId: 'bridge',
      point: { y: 2 },
      normal: { y: 1 },
    });
  } finally {
    world.dispose();
  }
});
