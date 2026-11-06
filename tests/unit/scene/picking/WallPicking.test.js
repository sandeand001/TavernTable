import * as three from 'three';
import { PickingService } from '../../../../src/scene/picking/PickingService.js';
import { Token3DAdapter } from '../../../../src/scene/Token3DAdapter.js';
import { TerrainMeshBuilder } from '../../../../src/scene/terrain/TerrainMeshBuilder.js';

describe('Actual terrain-face wall picking', () => {
  let scene;
  let gm;
  let camera;
  let picking;

  beforeEach(() => {
    scene = new three.Scene();
    const terrain = new three.Mesh(new three.BoxGeometry(1, 10, 1), new three.MeshBasicMaterial());
    terrain.name = 'TerrainMesh';
    terrain.position.set(1.5, 5, 0.5);
    scene.add(terrain);
    camera = new three.PerspectiveCamera(35, 1, 0.1, 100);
    camera.position.set(-10, 4, 0.5);
    camera.lookAt(1, 4, 0.5);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    gm = {
      cols: 2,
      rows: 1,
      placedTokens: [],
      is3DModeActive: () => true,
      getTerrainHeight: (x) => (x === 1 ? 10 : 0),
      spatial: {
        tileWorldSize: 1,
        elevationUnit: 1,
        worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
      },
      threeSceneManager: {
        three,
        scene,
        camera,
        canvas: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 200, height: 200 }) },
      },
    };
    picking = new PickingService({ gameManager: gm });
  });

  afterEach(() => {
    scene.traverse((object) => {
      if (object.isMesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
  });

  test('preserves the real hit height and outward normal separately from legacy grid inset', () => {
    const hit = picking.pickGroundSync(100, 100);
    expect(hit.surface).toMatchObject({
      kind: 'wall',
      point: { x: 1, y: 4 },
      normal: { x: -1, y: 0, z: 0 },
    });
    expect(hit.surface.point.z).toBeCloseTo(0.5);
    expect(hit.world.x).toBeCloseTo(1.1);
    expect(hit.grid).toEqual({ gx: 1, gy: 0 });
    camera.position.y = 6;
    camera.lookAt(1, 6, 0.5);
    camera.updateMatrixWorld(true);
    expect(picking.pickGroundSync(100, 100).surface.point.y).toBeCloseTo(6);
    expect(hit.surface.point.y).toBe(4);
  });

  test('an oversized invisible creature collider does not block a reachable wall click', () => {
    const mesh = new three.Group();
    mesh.position.set(0.84, 4, 0.5);
    const body = new three.Mesh(
      new three.BoxGeometry(0.2, 0.9, 0.2),
      new three.MeshBasicMaterial()
    );
    body.position.y = 0.45;
    mesh.add(body);
    scene.add(mesh);
    const token = { id: 'hanging', __threeMesh: mesh };
    gm.placedTokens.push(token);
    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter._attachSelectionCollider(mesh, three);
    camera.position.y = 5.2;
    camera.lookAt(1, 5.2, 0.5);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    const ray = new three.Raycaster();
    ray.setFromCamera(new three.Vector2(0, 0), camera);
    expect(adapter.pickTokenByRay(ray).token).toBe(token);
    const hit = picking.pickGroundSync(100, 100);
    expect(hit.surface.point.y).toBeCloseTo(5.2);
    expect(hit.token).toBeNull();
  });

  test('animated model setup discards stale skin bounds before precise picking without rebuilding them on every click', async () => {
    const geometry = new three.BoxGeometry(40, 180, 40);
    geometry.translate(0, 90, 0);
    const vertices = geometry.attributes.position.count;
    const weights = new Float32Array(vertices * 4);
    for (let vertex = 0; vertex < vertices; vertex++) weights[vertex * 4] = 1;
    geometry.setAttribute(
      'skinIndex',
      new three.Uint16BufferAttribute(new Uint16Array(vertices * 4), 4)
    );
    geometry.setAttribute('skinWeight', new three.Float32BufferAttribute(weights, 4));
    const body = new three.SkinnedMesh(geometry, new three.MeshBasicMaterial());
    const hips = new three.Bone();
    hips.name = 'mixamorigHips';
    body.add(hips);
    body.bind(new three.Skeleton([hips]));
    const clone = new three.Group();
    clone.add(body);
    clone.scale.setScalar(0.005);
    const token = {
      id: 'animated',
      type: 'mannequin',
      gridX: 0,
      gridY: 0,
      world: { x: 0.84, y: 0, z: 0.5 },
      facingAngle: 0,
    };
    gm.placedTokens.push(token);
    const adapter = new Token3DAdapter(gm);
    gm.token3DAdapter = adapter;
    adapter._threePromise = Promise.resolve(three);
    jest.spyOn(adapter, '_loadModelTemplate').mockResolvedValue({ template: clone });
    jest.spyOn(adapter, '_cloneTemplate').mockResolvedValue(clone);
    jest.spyOn(adapter, '_refreshVisualState').mockResolvedValue(undefined);
    jest.spyOn(adapter, '_setupAnimationSet').mockImplementation(async () => {
      scene.updateMatrixWorld(true);
      body.boundingBox = new three.Box3(
        new three.Vector3(-0.2, 0, -0.2),
        new three.Vector3(0.2, 0.9, 0.2)
      );
      body.boundingSphere = new three.Sphere(new three.Vector3(0, 0.5, 0), 0.53);
    });
    expect(await adapter._create3DToken(token, scene, { path: 'fixture.fbx' })).not.toBeNull();
    const computeSphere = jest.spyOn(body, 'computeBoundingSphere');
    camera.position.y = 0.45;
    camera.lookAt(1, 0.45, 0.5);
    camera.updateMatrixWorld(true);
    scene.updateMatrixWorld(true);
    const ray = new three.Raycaster();
    ray.setFromCamera(new three.Vector2(0, 0), camera);
    expect(adapter.pickTokenByRay(ray, { precise: true })?.token.id).toBe(token.id);
    expect(picking.pickGroundSync(100, 100).token?.id).toBe(token.id);
    expect(adapter.pickTokenByRay(ray, { precise: true })?.token.id).toBe(token.id);
    expect(computeSphere).toHaveBeenCalledTimes(1);
  });

  test('production heightfield walls resolve the high side even when triangle winding faces inward', () => {
    const mesh = scene.getObjectByName('TerrainMesh');
    mesh.geometry.dispose();
    mesh.geometry = new TerrainMeshBuilder({
      tileWorldSize: 1,
      elevationUnit: 1,
      forceAdvanced: true,
    }).build({ cols: 2, rows: 1, getHeight: gm.getTerrainHeight, three });
    mesh.position.set(0, 0, 0);
    mesh.material.side = three.DoubleSide;
    scene.updateMatrixWorld(true);
    const hit = picking.pickGroundSync(100, 100);
    expect(hit.surface.normal.x).toBe(-1);
    expect(hit.surface.point.y).toBeCloseTo(4);
    expect(hit.grid).toEqual({ gx: 1, gy: 0 });
  });
});
