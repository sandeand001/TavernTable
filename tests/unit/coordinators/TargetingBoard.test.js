import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Matrix4,
  Vector3,
  Quaternion,
} from 'three';
import { targetingBoard, targetingPositions } from '../../../src/coordinators/TargetingBoard.js';
import { PlaceableMeshPool } from '../../../src/scene/terrain/PlaceableMeshPool.js';
import { clearSegment } from '../../../src/rules/targeting/geometry.js';

const makeBoard = () => ({
  placedTokens: [
    { id: 'a', name: 'A', world: { x: 1.5, y: 0, z: 1.5 }, facingAngle: Math.PI / 2 },
    {
      id: 'b',
      name: 'B',
      world: { x: 3.5, y: 0, z: 1.5 },
      allegiance: 'hostile',
      creatureType: 'undead',
      creatureSize: 'large',
    },
  ],
  cols: 8,
  rows: 8,
  getTerrainHeight: () => 0,
  spatial: {
    tileWorldSize: 1,
    elevationUnit: 1,
    gridToWorld: (x, z, y = 0) => ({ x, y, z }),
    worldToGrid: (x, z) => ({ gridX: Math.floor(x), gridY: Math.floor(z) }),
  },
});

test('target facts retain facing, biological tags and size, with backwards-compatible defaults', () => {
  const snapshot = targetingBoard(makeBoard());
  expect(snapshot.tokens[0]).toMatchObject({
    allegiance: 'neutral',
    creatureType: 'humanoid',
    creatureSize: 'medium',
    facingAngle: Math.PI / 2,
  });
  expect(snapshot.tokens[1]).toMatchObject({
    allegiance: 'hostile',
    creatureType: 'undead',
    creatureSize: 'large',
  });
  expect(snapshot.inside({ x: -1, y: 0, z: 2 })).toBe(false);
  expect(snapshot.inside({ x: 3, y: 0, z: 2 })).toBe(true);
});

test('raised terrain blocks a ground-level shot but not one above the obstruction', () => {
  const gm = makeBoard();
  gm.getTerrainHeight = (x, z) => (x === 2 && z === 1 ? 2 : 0);
  let snapshot = targetingBoard(gm);
  expect(snapshot.clearPath(snapshot.tokens[0], snapshot.tokens[1])).toBe(false);
  gm.placedTokens.forEach((token) => {
    token.world.y = 3;
  });
  snapshot = targetingBoard(gm);
  expect(snapshot.clearPath(snapshot.tokens[0], snapshot.tokens[1])).toBe(true);
});

test('effects-only positions do not query terrain when stable world positions exist', () => {
  const gm = makeBoard();
  gm.getTerrainHeight = jest.fn(() => {
    throw new Error('Unexpected terrain scan');
  });
  expect(targetingPositions(gm).tokens).toHaveLength(2);
  expect(gm.getTerrainHeight).not.toHaveBeenCalled();
});

test('ground projections are requested only for effect recipients and never replace targeting altitude', () => {
  const gm = makeBoard();
  gm.placedTokens[0].world.y = 6;
  gm.token3DAdapter = {
    getTokenGroundPosition: jest.fn((token) => ({ ...token.world, y: 1.25 })),
  };
  const positions = targetingPositions(gm, ['a']);
  expect(positions.tokens[0]).toMatchObject({
    world: { x: 1.5, y: 6, z: 1.5 },
    groundWorld: { x: 1.5, y: 1.25, z: 1.5 },
  });
  expect(positions.tokens[1].groundWorld).toBeUndefined();
  expect(gm.token3DAdapter.getTokenGroundPosition).toHaveBeenCalledTimes(1);
  expect(gm.token3DAdapter.getTokenGroundPosition).toHaveBeenCalledWith(gm.placedTokens[0]);
  expect(targetingBoard(gm, ['a']).tokens[0]).toMatchObject(positions.tokens[0]);
  expect(gm.placedTokens[0].world.y).toBe(6);
});

test('invalid flight-ring ground projections report an error rather than rendering at flight altitude', () => {
  const gm = makeBoard();
  expect(() => targetingPositions(gm, ['a'])).toThrow('ground projection');
  gm.token3DAdapter = { getTokenGroundPosition: () => ({ x: 1, y: NaN, z: 1 }) };
  expect(() => targetingPositions(gm, ['a'])).toThrow('ground projection');
});

test('instanced structure cover uses actual rotation, scale and parent-world transforms, excluding plants', async () => {
  const gm = makeBoard();
  gm.is3DModeActive = () => true;
  gm.threeSceneManager = { scene: new Scene() };
  const model = new Mesh(new BoxGeometry(2, 2, 2), new MeshStandardMaterial());
  gm.modelAssetCache = { getModel: async () => model };
  const pool = new PlaceableMeshPool({ gameManager: gm });
  try {
    const handle = await pool.addPlaceable({
      type: 'structure',
      modelKey: 'fixture-wall',
      gridX: 4,
      gridY: 2,
    });
    await pool.addPlaceable({ type: 'plant', modelKey: 'fixture-tree', gridX: 0, gridY: 0 });
    const mesh = pool._groups.get(handle.key).instancedMesh;
    mesh.setMatrixAt(
      handle.index,
      new Matrix4().compose(
        new Vector3(4.5, 1, 2.5),
        new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 4),
        new Vector3(1, 1, 1)
      )
    );
    mesh.position.x = 1;
    const bounds = pool.targetingCoverBounds();
    expect(bounds).toHaveLength(1);
    expect(bounds[0].min.x).toBeCloseTo(5.5 - Math.SQRT2);
    expect(bounds[0].max.x).toBeCloseTo(5.5 + Math.SQRT2);
    expect(bounds[0].min.y).toBeCloseTo(0);
    expect(bounds[0].max.y).toBeCloseTo(2);
    expect(clearSegment({ x: 0, y: 1, z: 2.5 }, { x: 8, y: 1, z: 2.5 }, bounds)).toBe(false);
    pool.removePlaceable({ __meshPoolHandle: handle });
    expect(pool.targetingCoverBounds()).toEqual([]);
  } finally {
    pool.dispose();
    model.geometry.dispose();
    model.material.dispose();
  }
});
