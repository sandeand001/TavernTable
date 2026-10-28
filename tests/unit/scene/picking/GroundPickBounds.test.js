import * as three from 'three';
import { PickingService } from '../../../../src/scene/picking/PickingService.js';
import { TerrainMeshBuilder } from '../../../../src/scene/terrain/TerrainMeshBuilder.js';
import { Token3DAdapter } from '../../../../src/scene/Token3DAdapter.js';
import { GameErrors } from '../../../../src/utils/error/ErrorHandler.js';

const fixtures = [];

function fixture({ terrain = true, perspective = false, height = 0, tileSize = 1 } = {}) {
  const scene = new three.Scene();
  const camera = perspective
    ? new three.PerspectiveCamera(35, 1, 0.1, 1000)
    : new three.OrthographicCamera(
        -4 * tileSize,
        4 * tileSize,
        4 * tileSize,
        -4 * tileSize,
        0.1,
        1000
      );
  camera.up.set(0, 0, -1);
  camera.position.set(2 * tileSize, 16 * tileSize, 1.5 * tileSize);
  camera.lookAt(2 * tileSize, height * 0.5, 1.5 * tileSize);
  camera.updateMatrixWorld(true);
  const rect = { left: 50, top: 30, width: 200, height: 200 };
  const gm = {
    cols: 4,
    rows: 3,
    placedTokens: [],
    is3DModeActive: () => true,
    getTerrainHeight: () => height,
    spatial: {
      tileWorldSize: tileSize,
      elevationUnit: 0.5,
      worldToGrid: (x, z) => ({ gridX: Math.floor(x / tileSize), gridY: Math.floor(z / tileSize) }),
    },
    threeSceneManager: {
      three,
      scene,
      camera,
      canvas: { width: 400, height: 400, getBoundingClientRect: () => rect },
    },
  };
  let mesh = null;
  if (terrain) {
    mesh = new three.Mesh(
      new TerrainMeshBuilder({
        tileWorldSize: tileSize,
        elevationUnit: 0.5,
        forceAdvanced: true,
      }).build({ cols: 4, rows: 3, getHeight: gm.getTerrainHeight, three }),
      new three.MeshBasicMaterial({ side: three.DoubleSide })
    );
    mesh.name = 'TerrainMesh';
    scene.add(mesh);
    scene.updateMatrixWorld(true);
  }
  const picking = new PickingService({ gameManager: gm });
  const point = (x, z) => {
    const projected = new three.Vector3(x * tileSize, height * 0.5, z * tileSize).project(camera);
    return {
      x: rect.left + ((projected.x + 1) * rect.width) / 2,
      y: rect.top + ((1 - projected.y) * rect.height) / 2,
    };
  };
  const pick = (x, z) => {
    const pixel = point(x, z);
    return picking.pickGroundSync(pixel.x, pixel.y);
  };
  fixtures.push({ scene });
  return { gm, scene, camera, mesh, picking, point, pick, rect };
}

afterEach(() => {
  for (const { scene } of fixtures) {
    scene.traverse((object) => {
      if (object.isMesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    });
  }
  fixtures.length = 0;
});

describe('Visible board picking bounds', () => {
  test.each([
    [-0.2, 1.5],
    [4.2, 1.5],
    [2, -0.2],
    [2, 3.2],
  ])('a visible-terrain miss at (%s,%s) does not clamp to an edge tile', (x, z) => {
    expect(fixture().pick(x, z)).toBeNull();
  });

  test.each([
    [-0.2, 1.5],
    [4.2, 1.5],
    [2, -0.2],
    [2, 3.2],
  ])('the terrain-unavailable plane fallback is also bounded at (%s,%s)', (x, z) => {
    expect(fixture({ terrain: false }).pick(x, z)).toBeNull();
  });

  test.each([
    [-0.2, 1.5],
    [4.2, 1.5],
    [2, -0.2],
    [2, 3.2],
  ])('elevated perspective terrain rejects background at (%s,%s)', (x, z) => {
    expect(fixture({ perspective: true, height: 4 }).pick(x, z)).toBeNull();
  });

  test('a mesh hole is a miss even when the infinite plane would hit a valid grid cell', () => {
    const { mesh, pick } = fixture();
    mesh.geometry.setDrawRange(0, 6);
    expect(pick(2.5, 1.5)).toBeNull();
  });

  test.each([0.5, 1, 2])('valid edge tiles remain clickable at tile size %s', (tileSize) => {
    const { pick } = fixture({ tileSize });
    expect(pick(0.001, 1.5).grid).toEqual({ gx: 0, gy: 1 });
    expect(pick(3.999, 1.5).grid).toEqual({ gx: 3, gy: 1 });
    expect(pick(2.5, 0.001).grid).toEqual({ gx: 2, gy: 0 });
    expect(pick(2.5, 2.999).grid).toEqual({ gx: 2, gy: 2 });
  });

  test('exact visible outer edges still resolve to their adjacent board tile', () => {
    const { pick } = fixture();
    expect(pick(4, 1.5).grid).toEqual({ gx: 3, gy: 1 });
    expect(pick(2.5, 3).grid).toEqual({ gx: 2, gy: 2 });
  });

  test('valid fallback points work when the terrain mesh has not been created', () => {
    expect(fixture({ terrain: false }).pick(2.5, 1.5).grid).toEqual({ gx: 2, gy: 1 });
  });

  test('missing board dimensions cannot create an unbounded fallback target', () => {
    const { gm, pick } = fixture({ terrain: false });
    delete gm.cols;
    expect(pick(2.5, 1.5)).toBeNull();
  });

  test('pointer coordinates outside the map canvas cannot produce a board destination', () => {
    const { picking, rect } = fixture();
    expect(picking.pickGroundSync(rect.left - 1, rect.top + 100)).toBeNull();
    expect(picking.pickGroundSync(rect.left + rect.width + 1, rect.top + 100)).toBeNull();
  });

  function addEdgeCreature(gm, scene, geometry) {
    const mesh = new three.Group();
    mesh.position.set(0.15, 0, 1.5);
    const body = new three.Mesh(geometry, new three.MeshBasicMaterial());
    body.position.y = 0.9;
    mesh.add(body);
    scene.add(mesh);
    const token = {
      id: 'edge-creature',
      gridX: 0,
      gridY: 1,
      world: { x: 0.15, y: 0, z: 1.5 },
      __threeMesh: mesh,
    };
    gm.placedTokens.push(token);
    gm.token3DAdapter = new Token3DAdapter(gm);
    gm.token3DAdapter._attachSelectionCollider(mesh, three);
    scene.updateMatrixWorld(true);
    return token;
  }

  test('a real creature body overhanging the board remains selectable', () => {
    const { gm, scene, pick } = fixture();
    const token = addEdgeCreature(gm, scene, new three.SphereGeometry(0.6, 16, 12));
    const result = pick(-0.15, 1.5);
    expect(result.token).toBe(token);
    expect(result.grid).toEqual({ gx: 0, gy: 1 });
    expect(result.tokenHitPoint.x).toBeCloseTo(-0.15);
  });

  test('an invisible creature collider outside the board is not a visible hit', () => {
    const { gm, scene, pick } = fixture();
    addEdgeCreature(gm, scene, new three.BoxGeometry(0.1, 0.9, 0.1));
    expect(pick(-0.15, 1.5)).toBeNull();
  });

  test('a broken coordinate mapper reports failure instead of producing a fallback tile', () => {
    const { gm, pick } = fixture();
    const error = new Error('Broken grid mapping');
    gm.spatial.worldToGrid = () => {
      throw error;
    };
    const report = jest.spyOn(GameErrors, 'input').mockImplementation(() => {});
    try {
      expect(pick(2.5, 1.5)).toBeNull();
      expect(report).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          component: 'PickingService',
          operation: 'pickGroundSync',
        })
      );
    } finally {
      report.mockRestore();
    }
  });
});
