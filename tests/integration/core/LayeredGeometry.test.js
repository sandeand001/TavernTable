import * as three from 'three';
import { createTerrainWorld } from '../../helpers/terrainWorld.js';
import { TerrainMeshBuilder } from '../../../src/scene/terrain/TerrainMeshBuilder.js';
import { TerrainRebuilder } from '../../../src/scene/terrain/TerrainRebuilder.js';
import { PickingService } from '../../../src/scene/picking/PickingService.js';
import { createCurvedExamples } from '../../../src/terrain/CurvedExamples.js';
import {
  CONSTRUCTION_MATERIALS,
  getConstructionAppearance,
} from '../../../src/config/biome/ConstructionPalettes.js';

test.each([true, false])(
  'terrain swaps only a complete village kit (roof available: %s)',
  async (loaded) => {
    const world = createTerrainWorld(10, 10, null);
    const gm = world.gm;
    gm.threeSceneManager.scene = new three.Scene();
    gm.threeSceneManager.three = three;
    const createFacade = () => {
      const facade = new three.Group();
      const mesh = new three.Mesh(
        new three.BoxGeometry(8, 10, 1),
        new three.MeshBasicMaterial({ name: 'MI_Plaster' })
      );
      mesh.position.y = 5;
      facade.add(mesh);
      return facade;
    };
    const cachedFacade = createFacade();
    let finishRoof;
    const roofLoad = new Promise((resolve) => (finishRoof = resolve));
    gm.modelAssetCache = {
      getModel: async (key) =>
        key === 'source-medieval-roof' ? roofLoad : cachedFacade.clone(true),
    };
    const rebuilder = new TerrainRebuilder({
      gameManager: gm,
      builder: new TerrainMeshBuilder({ hardEdges: true }),
      debounceMs: 0,
    });
    world.engine.placeStructure({
      id: 'town-house',
      kind: 'building',
      xFeet: 25,
      zFeet: 25,
      lengthFeet: 25,
      widthFeet: 20,
      heightFeet: 10,
      appearance: {
        ...getConstructionAppearance('town'),
        facadeModelKey: 'source-medieval-wall-door',
      },
    });
    const shell = world.engine.geometry.save();
    try {
      const mesh = rebuilder.rebuild({ three });
      const drawsOldRoof = () =>
        mesh.geometry
          .getAttribute('constructionMaterial')
          .array.includes(CONSTRUCTION_MATERIALS.tiles);
      expect(mesh.getObjectByName('ConstructionAssets')).toBeUndefined();
      expect(drawsOldRoof()).toBe(true);
      finishRoof(loaded ? cachedFacade.clone(true) : null);
      await new Promise((resolve) => setTimeout(resolve, 0));
      const attached = mesh.getObjectByName('ConstructionAssets');
      expect(
        Boolean(attached?.getObjectByName('ConstructionAsset:town-house:source-medieval-roof'))
      ).toBe(loaded);
      expect(drawsOldRoof()).toBe(!loaded);
      expect(world.engine.geometry.save()).toEqual(shell);
    } finally {
      world.dispose();
    }
  }
);

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

test('the real terrain rebuild and screen picker follow a curved dome and its visual cutaway', () => {
  const world = createTerrainWorld(25, 25, null);
  const gm = world.gm;
  const canvas = gm.threeSceneManager.canvas;
  canvas.width = 400;
  canvas.height = 400;
  canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 400, height: 400 });
  gm.threeSceneManager.scene = new three.Scene();
  gm.threeSceneManager.three = three;
  const camera = new three.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(19.5, 15, 6.5);
  camera.up.set(0, 0, -1);
  camera.lookAt(19.5, 0, 6.5);
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
    world.engine.addVolumes(createCurvedExamples({ widthFeet: 125, depthFeet: 125 }));
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const picker = new PickingService({ gameManager: gm });
    const roof = picker.pickGroundSync(200, 200, canvas);
    const support = world.engine.geometry.findSupport(97.5, 32.5, { belowFeet: 30 });
    expect(roof.surface.kind).toBe('floor');
    expect(roof.surface.point.y).toBeCloseTo(support.heightFeet / 5, 5);
    world.engine.setVisibleLayers(['ground', 'cave', 'dome', 'castle']);
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const floor = picker.pickGroundSync(200, 200, canvas);
    expect(floor.surface).toMatchObject({ kind: 'floor', point: { y: 0 } });
    expect(world.engine.geometry.findSupport(97.5, 32.5, { belowFeet: 30 })).toEqual(support);
  } finally {
    world.dispose();
  }
});
