import * as three from 'three';
import { Token3DAdapter } from '../../../../src/scene/Token3DAdapter.js';

const fixtures = [];

function fixture(dx = 1, dz = 0, yaw = 0, tileSize = 1) {
  const mesh = new three.Group();
  mesh.userData.__tt3DToken = true;
  mesh.userData.__ttBillboard = false;
  mesh.rotation.set(0.13, yaw, -0.07);
  mesh.scale.set(1.2, 0.8, 1.1);
  const spatial = {
    tileWorldSize: tileSize,
    elevationUnit: 0.3,
    gridToWorld: (x, y, height) => ({
      x: 10 + x * tileSize,
      y: height * 0.3,
      z: 20 + y * tileSize,
    }),
  };
  const low = { gridX: 2, gridY: 2, height: 0 };
  const high = { gridX: 2 + dx, gridY: 2 + dz, height: 24 };
  const center = spatial.gridToWorld(2.5, 2.5, 0);
  const token = {
    id: 'wall-selection',
    world: { x: center.x + dx * tileSize * 0.34, y: 3, z: center.z + dz * tileSize * 0.34 },
    __threeMesh: mesh,
  };
  mesh.position.set(token.world.x, token.world.y, token.world.z);
  const adapter = new Token3DAdapter({ spatial, placedTokens: [token] });
  adapter._threePromise = Promise.resolve(three);
  adapter._selectedToken = token;
  const state = {
    token,
    mesh,
    phase: 'climb-hold',
    wallMotion: { face: { low, high }, stage: 'surface', holding: true },
    selectionIndicatorSuppressed: false,
  };
  adapter._movementStates.set(token, state);
  const normal = new three.Vector3(-dx, 0, -dz);
  const plane = spatial.gridToWorld(
    (low.gridX + high.gridX + 1) / 2,
    (low.gridY + high.gridY + 1) / 2,
    0
  );
  const result = { adapter, token, mesh, state, normal, plane, spatial };
  fixtures.push(result);
  return result;
}

function ringPose(token) {
  const ring = token.__ttSelectionIndicator;
  ring.updateWorldMatrix(true, false);
  return {
    center: ring.getWorldPosition(new three.Vector3()),
    normal: new three.Vector3(0, 0, 1).applyNormalMatrix(
      new three.Matrix3().getNormalMatrix(ring.matrixWorld)
    ),
  };
}

afterEach(() => {
  for (const { adapter, token, mesh } of fixtures) {
    adapter._discardSelectionIndicator(token);
    mesh.traverse((child) => {
      if (child.isMesh) {
        child.geometry.dispose();
        child.material.dispose();
      }
    });
  }
  fixtures.length = 0;
});

describe('Selection ring support-surface alignment', () => {
  test.each([
    [1, 0, 0, 1],
    [-1, 0, 0, 1],
    [0, 1, 0, 1],
    [0, -1, 0, 1],
    [1, 0, 0.73, 2],
    [-1, 0, 0.73, 2],
    [0, 1, 0.73, 0.5],
    [0, -1, 0.73, 0.5],
  ])(
    'lies flat on wall (%s,%s) through yaw %s and tile scale %s',
    async (dx, dz, yaw, tileSize) => {
      const { adapter, token, normal, plane } = fixture(dx, dz, yaw, tileSize);
      await adapter._showSelectionIndicator(token);
      const pose = ringPose(token);
      expect(pose.normal.distanceTo(normal)).toBeLessThan(1e-6);
      expect(pose.center.y).toBeCloseTo(token.world.y);
      const ring = token.__ttSelectionIndicator;
      const positions = ring.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) {
        const point = new three.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(ring.matrixWorld);
        expect(point.sub(new three.Vector3(plane.x, 0, plane.z)).dot(normal)).toBeCloseTo(0.02, 6);
      }
      expect(ring.visible).toBe(true);
    }
  );

  test('tracks changing wall height without changing cinematic visibility rules', async () => {
    const { adapter, token, state, normal } = fixture();
    await adapter._showSelectionIndicator(token);
    state.phase = 'climb-surface';
    state.wallMotion.holding = false;
    adapter._setSelectionIndicatorSuppressed(state, true);
    adapter._syncTokenAndMeshWorld(state, { ...token.world, y: 4.25 });
    expect(ringPose(token).center.y).toBeCloseTo(4.25);
    expect(ringPose(token).normal.distanceTo(normal)).toBeLessThan(1e-6);
    expect(token.__ttSelectionIndicator.visible).toBe(false);
  });

  test.each(['approach', 'exit', 'release'])(
    'restores a horizontal ring during %s',
    async (stage) => {
      const { adapter, token, mesh, state } = fixture();
      mesh.rotation.set(0, 0.6, 0);
      mesh.scale.set(1, 1, 1);
      await adapter._showSelectionIndicator(token);
      state.phase = 'climb-surface';
      state.wallMotion.stage = stage;
      state.wallMotion.holding = false;
      await adapter._showSelectionIndicator(token);
      const pose = ringPose(token);
      expect(pose.normal.distanceTo(new three.Vector3(0, 1, 0))).toBeLessThan(1e-6);
      expect(pose.center.x).toBeCloseTo(token.world.x);
      expect(pose.center.z).toBeCloseTo(token.world.z);
      expect(pose.center.y).toBeCloseTo(token.world.y + 0.02);
    }
  );

  test('landing clears the wall transform and preserves manual-height compensation', async () => {
    const { adapter, token, mesh, state } = fixture();
    mesh.rotation.set(0, 0.6, 0);
    mesh.scale.set(1, 1, 1);
    await adapter._showSelectionIndicator(token);
    state.wallMotion = null;
    state.phase = 'idle';
    mesh.userData.__ttManualVerticalOffset = 0.9;
    mesh.position.y += 0.9;
    await adapter._showSelectionIndicator(token);
    const pose = ringPose(token);
    expect(pose.normal.distanceTo(new three.Vector3(0, 1, 0))).toBeLessThan(1e-6);
    expect(pose.center.y).toBeCloseTo(token.world.y + 0.02);
    expect(pose.center.x).toBeCloseTo(token.world.x);
  });

  test('manual height changes cannot lift an attached ring away from its wall anchor', async () => {
    const { adapter, token, mesh } = fixture();
    await adapter._showSelectionIndicator(token);
    const before = ringPose(token).center;
    mesh.userData.__ttManualVerticalOffset = 0.9;
    mesh.position.y += 0.9;
    adapter._updateSelectionIndicatorTransform(token);
    expect(ringPose(token).center.distanceTo(before)).toBeLessThan(1e-6);
  });

  test('centers a wall ring behind visible body geometry, not the logical tile or invisible collider', async () => {
    const { adapter, token, mesh, plane, normal } = fixture();
    const body = new three.Mesh(
      new three.BoxGeometry(0.4, 0.8, 0.2),
      new three.MeshBasicMaterial()
    );
    body.position.set(0.06, 0.5, 0.12);
    mesh.add(body);
    const collider = new three.Mesh(
      new three.BoxGeometry(5, 10, 5),
      new three.MeshBasicMaterial({ opacity: 0, transparent: true })
    );
    collider.position.y = 5;
    mesh.add(collider);
    mesh.userData.__ttSelectionCollider = collider;
    await adapter._showSelectionIndicator(token);
    mesh.updateWorldMatrix(true, true);
    const center = new three.Box3().setFromObject(body, true).getCenter(new three.Vector3());
    const pose = ringPose(token);
    expect(pose.center.y).toBeCloseTo(center.y);
    expect(pose.center.z).toBeCloseTo(center.z);
    expect(pose.center.x).toBeCloseTo(plane.x + normal.x * 0.02);
    body.position.y += 0.3;
    adapter._updateSelectionIndicatorTransform(token);
    mesh.updateWorldMatrix(true, true);
    const moved = new three.Box3().setFromObject(body, true).getCenter(new three.Vector3());
    expect(ringPose(token).center.y).toBeCloseTo(moved.y);
  });

  test('caches frozen skinned bounds and refreshes the center after a pose changes', async () => {
    const { adapter, token, mesh } = fixture();
    const geometry = new three.BoxGeometry(0.4, 0.8, 0.2);
    const count = geometry.attributes.position.count;
    const weights = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) weights[i * 4] = 1;
    geometry.setAttribute(
      'skinIndex',
      new three.Uint16BufferAttribute(new Uint16Array(count * 4), 4)
    );
    geometry.setAttribute('skinWeight', new three.Float32BufferAttribute(weights, 4));
    const body = new three.SkinnedMesh(geometry, new three.MeshBasicMaterial());
    const bone = new three.Bone();
    bone.name = 'Hips';
    body.add(bone);
    body.position.y = 0.5;
    mesh.add(body);
    body.bind(new three.Skeleton([bone]));
    const vertices = jest.spyOn(body, 'getVertexPosition');
    await adapter._showSelectionIndicator(token);
    const before = ringPose(token).center.y;
    expect(vertices).toHaveBeenCalledTimes(count);
    for (let i = 0; i < 20; i++) adapter._updateSelectionIndicatorTransform(token);
    expect(vertices).toHaveBeenCalledTimes(count);
    bone.position.y += 0.3;
    adapter._updateSelectionIndicatorTransform(token);
    expect(vertices).toHaveBeenCalledTimes(count * 2);
    expect(ringPose(token).center.y).toBeGreaterThan(before + 0.1);
  });

  test.each(['suppressed', 'deselected'])(
    'late marker creation respects a now-%s token',
    async (reason) => {
      const { adapter, token, state } = fixture();
      let resolve;
      adapter._threePromise = new Promise((complete) => {
        resolve = complete;
      });
      const showing = adapter._showSelectionIndicator(token);
      if (reason === 'suppressed') state.selectionIndicatorSuppressed = true;
      else adapter._selectedToken = null;
      resolve(three);
      await showing;
      expect(token.__ttSelectionIndicator.visible).toBe(false);
    }
  );

  test('concurrent selection updates create only one owned ring', async () => {
    const { adapter, token, mesh } = fixture();
    let resolve;
    adapter._threePromise = new Promise((complete) => {
      resolve = complete;
    });
    const first = adapter._showSelectionIndicator(token);
    const second = adapter._showSelectionIndicator(token);
    resolve(three);
    await Promise.all([first, second]);
    expect(mesh.children.filter((child) => child.name === 'TokenSelectionIndicator')).toHaveLength(
      1
    );
    expect(token.__ttSelectionIndicator.visible).toBe(true);
  });

  test('removal while loading cannot leave an orphaned ring on the old mesh', async () => {
    const { adapter, token, mesh } = fixture();
    let resolve;
    adapter._threePromise = new Promise((complete) => {
      resolve = complete;
    });
    const showing = adapter._showSelectionIndicator(token);
    delete token.__threeMesh;
    adapter._selectedToken = null;
    resolve(three);
    await showing;
    expect(token.__ttSelectionIndicator).toBeUndefined();
    expect(mesh.children).toHaveLength(0);
  });
});
