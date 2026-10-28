import {
  AnimationClip,
  AnimationMixer,
  Bone,
  Group,
  QuaternionKeyframeTrack,
  Vector3,
  VectorKeyframeTrack,
} from 'three';
import { Token3DAdapter } from '../../../../../src/scene/Token3DAdapter.js';

function createRig() {
  const mesh = new Group();
  const parent = new Group();
  parent.scale.setScalar(0.01);
  parent.rotation.y = Math.PI / 2;
  const hips = new Bone();
  hips.name = 'Hips';
  hips.position.set(0, 100, 0);
  parent.add(hips);
  mesh.add(parent);
  const token = { world: { x: 0, y: 0, z: 0 }, __threeMesh: mesh };
  const adapter = new Token3DAdapter({ spatial: { tileWorldSize: 1 } });
  adapter._registerRootBones(token, mesh);
  return { adapter, token, mesh, parent, hips };
}

describe('Mannequin root motion with a real Three.js hierarchy', () => {
  test('transforms displacement through the scaled, rotated bone parent', () => {
    const { adapter, token, mesh, hips } = createRig();
    hips.position.z += 100;

    const { offsetWorld } = adapter._extractRootMotionOffset({ token, mesh });

    expect(offsetWorld.x).toBeCloseTo(1);
    expect(offsetWorld.y).toBeCloseTo(0);
    expect(offsetWorld.z).toBeCloseTo(0);
  });

  test('supports nested transforms and excludes parent translation', () => {
    const { adapter, token, mesh, parent, hips } = createRig();
    mesh.position.set(30, -7, 12);
    mesh.rotation.set(0.2, -0.6, 0.1);
    parent.position.set(20, 50, -40);
    parent.scale.set(0.01, 0.02, 0.03);
    parent.rotation.set(-0.3, 0.4, 0.2);
    const baseWorld = hips.getWorldPosition(new Vector3());
    hips.position.add(new Vector3(10, 20, 30));
    const expected = hips.getWorldPosition(new Vector3()).sub(baseWorld);

    const { offsetWorld } = adapter._extractRootMotionOffset({ token, mesh });

    expect(offsetWorld.x).toBeCloseTo(expected.x);
    expect(offsetWorld.y).toBeCloseTo(expected.y);
    expect(offsetWorld.z).toBeCloseTo(expected.z);
  });

  test.each(['walk', 'climb-recover'])(
    'preserves authored hip height and rotation in %s',
    (phase) => {
      const { adapter, token, mesh, hips } = createRig();
      adapter._movementStates.set(token, { token, mesh, phase });
      hips.position.set(10, 50, 20);
      hips.rotation.x = 0.4;
      const poseRotation = hips.quaternion.clone();

      adapter._neutralizeRootMotion(token);

      expect(hips.position.toArray()).toEqual([0, 50, 0]);
      expect(hips.quaternion.equals(poseRotation)).toBe(true);
    }
  );

  test('a fall loop cannot expose the outgoing walk root translation', () => {
    const { adapter, token, mesh, hips } = createRig();
    adapter._movementStates.set(token, { token, mesh, phase: 'fall', fallMode: 'loop' });
    hips.position.z = 100;

    adapter._neutralizeRootMotion(token);

    expect(hips.position.z).toBe(0);
  });

  test('landing blends retain only the incoming action planar root motion', () => {
    const { adapter, token, mesh, hips } = createRig();
    const mixer = new AnimationMixer(mesh);
    const walk = mixer.clipAction(
      new AnimationClip('walk', 1, [
        new VectorKeyframeTrack('Hips.position', [0, 1], [0, 100, 0, 0, 100, 200]),
      ])
    );
    const landing = mixer.clipAction(
      new AnimationClip('roll', 1, [
        new VectorKeyframeTrack('Hips.position', [0, 1], [0, 100, 0, 0, 100, 30]),
      ])
    );
    walk.play();
    mixer.update(0.5);
    walk.fadeOut(0.2);
    landing.fadeIn(0.2).play();
    mixer.update(0.1);
    adapter._tokenAnimationData.set(token, { actions: { fallToRoll: landing } });
    adapter._movementStates.set(token, {
      token,
      mesh,
      phase: 'fall',
      fallMode: 'landing',
      fallLandingKey: 'fallToRoll',
    });

    adapter._neutralizeRootMotion(token);

    expect(hips.position.z).toBeCloseTo(30 * landing.time * landing.getEffectiveWeight());
    expect(hips.position.z).toBeGreaterThan(0);
  });

  test('recovery keeps toes above the ledge without moving the canonical support point', () => {
    const { adapter, token, mesh, hips } = createRig();
    const toe = new Bone();
    toe.name = 'mixamorigLeftToeBase';
    toe.position.y = -102;
    hips.add(toe);
    adapter._registerRootBones(token, mesh);
    const state = {
      token,
      mesh,
      phase: 'climb-recover',
      climbRecoverStartWorld: { x: 0, y: 0, z: 0 },
    };
    adapter._movementStates.set(token, state);

    adapter._neutralizeRootMotion(token);

    expect(toe.getWorldPosition(new Vector3()).y).toBeGreaterThanOrEqual(-1e-6);
    expect(token.world.y).toBe(0);
    expect(mesh.position.y).toBeCloseTo(0.02);

    state.phase = 'walk';
    adapter._neutralizeRootMotion(token);
    expect(mesh.position.y).toBe(0);
  });

  test('transferring planar landing motion does not reset the vertical or rotational pose', () => {
    const { adapter, token, mesh, hips } = createRig();
    const state = { token, mesh, phase: 'fall' };
    adapter._movementStates.set(token, state);
    hips.position.set(0, 50, 100);
    hips.rotation.x = 0.4;
    const before = hips.getWorldPosition(new Vector3());
    const poseRotation = hips.quaternion.clone();

    adapter._transferRootMotionToWorld(state, { x: 1, y: 0, z: 0 });

    const after = hips.getWorldPosition(new Vector3());
    expect(after.distanceTo(before)).toBeLessThan(1e-6);
    expect(hips.position.y).toBe(50);
    expect(hips.quaternion.equals(poseRotation)).toBe(true);
    expect(token.world.x).toBeCloseTo(1);
    expect(token.world.y).toBeCloseTo(0);
    expect(token.world.z).toBeCloseTo(0);
  });

  test('rebases climbing locomotion without modifying cached clips or crouch poses', () => {
    const { adapter, token } = createRig();
    const climb = new AnimationClip('climb', 2, [
      new VectorKeyframeTrack('Hips.position', [0, 2], [0, 100, 0, 0, 300, 40]),
      new QuaternionKeyframeTrack('Hips.quaternion', [0, 2], [0, 0, 0, 1, 0, 0, 0, 1]),
    ]);
    const climbWall = new AnimationClip('climbWall', 2, [
      new VectorKeyframeTrack('Hips.position', [0, 2], [0, 100, 0, 0, 220, 0]),
    ]);
    const climbRecover = new AnimationClip('climbRecover', 0.6, [
      new VectorKeyframeTrack('Hips.position', [0, 0.6], [0, 50, 3, 0, 100, 30]),
    ]);

    const prepared = adapter._prepareClimbRootMotion(token, { climb, climbWall, climbRecover });

    expect(Array.from(prepared.climb.tracks[0].values)).toEqual([0, 100, 0, 0, 50, 3]);
    expect(Array.from(prepared.climbWall.tracks[0].values)).toEqual([0, 100, 0, 0, 100, 0]);
    expect(prepared.rootMotion.climbTransferLocal).toEqual({ x: 0, y: 250, z: 37 });
    expect(prepared.rootMotion.wall.displacementLocal.y).toBe(120);
    expect(prepared.climb.duration).toBe(2);
    expect(prepared.climbRecover).toBe(climbRecover);
    expect(Array.from(prepared.climb.tracks[1].values)).toEqual(Array.from(climb.tracks[1].values));
    expect(Array.from(climb.tracks[0].values)).toEqual([0, 100, 0, 0, 300, 40]);
    expect(Array.from(climbWall.tracks[0].values)).toEqual([0, 100, 0, 0, 220, 0]);
  });

  test('rebases the authored descent to the same wall anchor while retaining its downward curve', () => {
    const { adapter, token } = createRig();
    const climbWall = new AnimationClip('up', 2, [
      new VectorKeyframeTrack('Hips.position', [0, 2], [0, 100, 0, 0, 220, 0]),
    ]);
    const climbWallDown = new AnimationClip('down', 2, [
      new VectorKeyframeTrack('Hips.position', [0, 1, 2], [0, 227, 0, 0, 180, 0, 0, 101, 0]),
    ]);
    const prepared = adapter._prepareClimbRootMotion(token, { climbWall, climbWallDown });
    expect(prepared.climbWallDown).not.toBe(climbWallDown);
    expect(Array.from(prepared.climbWallDown.tracks[0].values)).toEqual([
      0, 100, 0, 0, 100, 0, 0, 100, 0,
    ]);
    expect(prepared.rootMotion.wallDown.displacementLocal.y).toBe(-126);
    expect(prepared.rootMotion.wallDown.interpolant.evaluate(1)[1]).toBe(180);
    expect(Array.from(climbWallDown.tracks[0].values)).toEqual([0, 227, 0, 0, 180, 0, 0, 101, 0]);
  });

  test('derives a static ledge hang from the mantle entry pose, not a mid-crouch frame', () => {
    const { adapter, token } = createRig();
    const climb = new AnimationClip('mantle', 2, [
      new VectorKeyframeTrack('Hips.position', [0, 2], [0, 100, 0, 0, 300, 40]),
      new QuaternionKeyframeTrack('Hips.quaternion', [0, 2], [0, 0, 0, 1, 0, 0.6, 0, 0.8]),
    ]);
    const prepared = adapter._prepareClimbRootMotion(token, { climb });
    expect(prepared.ledgeHang.duration).toBeCloseTo(1 / 30);
    for (const track of prepared.ledgeHang.tracks) {
      expect(track.times).toHaveLength(2);
      expect(track.times[0]).toBe(0);
      expect(track.times[1]).toBeCloseTo(1 / 30);
      const size = track.getValueSize();
      expect(Array.from(track.values.slice(0, size))).toEqual(Array.from(track.values.slice(size)));
    }
    expect(prepared.ledgeHang.tracks[0].values[1]).toBe(100);
    expect(climb.duration).toBe(2);
    expect(climb.tracks[0].values[4]).toBe(300);
  });

  test.each(['climb', 'climbWall'])(
    'retains the outgoing ledge-grip offset while blending into %s',
    (key) => {
      const { adapter, token, mesh, hips } = createRig();
      const mixer = new AnimationMixer(mesh);
      const ledgeHang = mixer.clipAction(
        new AnimationClip('hang', 1, [
          new VectorKeyframeTrack('Hips.position', [0, 1], [30, 100, 10, 30, 100, 10]),
        ])
      );
      const next = mixer.clipAction(
        new AnimationClip(key, 1, [
          new VectorKeyframeTrack('Hips.position', [0, 1], [20, 100, 0, 20, 100, 0]),
        ])
      );
      ledgeHang.setEffectiveWeight(0.75).play();
      ledgeHang.paused = true;
      next.setEffectiveWeight(0.25).play();
      next.time = 0.5;
      mixer.update(0);
      adapter._tokenAnimationData.set(token, { actions: { ledgeHang, [key]: next }, current: key });
      adapter._movementStates.set(token, {
        token,
        mesh,
        phase: 'climb-surface',
        wallMotion: { clip: key },
      });
      adapter._neutralizeRootMotion(token);
      expect(hips.position.x).toBeCloseTo(key === 'climb' ? 27.5 : 22.5);
      expect(hips.position.z).toBeCloseTo(7.5);
    }
  );

  test.each([
    ['flat landing', 3.5, false, true],
    ['another cliff', 3.5, true, false],
    ['board boundary', 10.5, false, false],
  ])('checks authored roll clearance for %s', (_, landingX, hasCliff, expected) => {
    const { adapter, token } = createRig();
    Object.assign(adapter.gameManager, {
      cols: 12,
      rows: 8,
      getTerrainHeight: (x) => (hasCliff && x >= 4 ? -8 : 0),
    });
    adapter.gameManager.spatial.elevationUnit = 0.3;
    const clip = new AnimationClip('roll', 1, [
      new VectorKeyframeTrack('Hips.position', [0, 1], [0, 100, 0, 0, 100, 150]),
    ]);
    const state = { token, activeStep: { targetWorld: { x: landingX, y: 0, z: 4.5 } } };
    const data = { actions: { fallToRoll: { getClip: () => clip } } };

    expect(adapter._hasLandingRollClearance(state, data)).toBe(expected);
  });

  test('continuing after a climb does not restart an already-playing walk cycle', () => {
    const { adapter, token, mesh } = createRig();
    const mixer = new AnimationMixer(mesh);
    const walk = mixer.clipAction(
      new AnimationClip('walk', 1, [
        new VectorKeyframeTrack('Hips.position', [0, 1], [0, 100, 0, 0, 100, 200]),
      ])
    );
    walk.play();
    mixer.update(0.5);
    adapter._tokenAnimationData.set(token, {
      actions: { walk },
      current: 'walk',
      profile: { walkSpeed: 1 },
    });
    const state = adapter._ensureMovementState(token);
    state.forwardKeys.add('ArrowUp');

    adapter._startMovementPhase(state, 1);

    expect(walk.time).toBeCloseTo(0.5);
  });

  test('plans the wall portion from physical rig travel rather than terrain-level count', () => {
    const { adapter, token } = createRig();
    const rootInfo = adapter._rootBones.get(token)[0];
    const plan = adapter._planClimbWallSegments(
      { token },
      {
        heightDelta: 4,
        elevationUnit: 0.5,
        footWorld: { x: 0, y: 0, z: 0 },
        edgeWorld: { x: 0, y: 2, z: 0 },
      },
      {
        actions: { climbWall: { getClip: () => ({ duration: 2 }) } },
        rootMotion: {
          rootInfo,
          climbTransferLocal: { x: 0, y: 100, z: 0 },
          wall: { displacementLocal: { x: 0, y: 60, z: 0 } },
        },
      }
    );

    expect(plan.finalStartWorld.y).toBeCloseTo(1);
    expect(plan.referenceHeight).toBeCloseTo(0.6);
    expect(plan.segments).toHaveLength(2);
  });

  test('samples the current pose before advancing the movement controller', () => {
    const callbacks = [];
    const adapter = new Token3DAdapter({
      is3DModeActive: () => true,
      placedTokens: [],
      threeSceneManager: {
        scene: new Group(),
        addAnimationCallback: (callback) => callbacks.push(callback),
      },
    });
    adapter.attach();
    const order = [];
    adapter._animationMixers.set({}, { update: () => order.push('pose') });
    adapter._updateForwardMovements = () => order.push('movement');
    adapter._neutralizeRootMotion = () => order.push('neutralize');
    adapter._lastFrameTime = 0;
    const clock = jest.spyOn(performance, 'now').mockReturnValue(20);
    try {
      callbacks[0]();
      expect(order).toEqual(['pose', 'movement', 'neutralize']);
    } finally {
      clock.mockRestore();
    }
  });
});
