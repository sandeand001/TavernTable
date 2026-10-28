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
