import * as three from 'three';
import {
  createHumanoidFixture,
  installHumanoidAssetFiles,
} from '../../../../helpers/humanoid-fixture.js';

let restoreFiles;
const fixtures = [];
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.adapter.disposeMovementRange();
});
afterAll(() => restoreFiles());

async function fixture() {
  const f = await createHumanoidFixture({
    height: 0,
    warmupFrames: 2,
    animationKeys: ['idle', 'fallLoop', 'proneLanding', 'prone', 'standUp'],
  });
  fixtures.push(f);
  return f;
}

function pose(f, key, time) {
  f.data.mixer.stopAllAction();
  f.adapter._setAnimation(f.token, key, { force: true, immediate: true });
  f.data.actions[key].time = time;
  f.data.actions[key].paused = true;
  f.data.mixer.update(0);
  f.adapter._neutralizeRootMotion(f.token);
  f.mesh.updateMatrixWorld(true);
}

function joints(f) {
  const skeleton = f.skins[0].skeleton;
  const origin = new three.Vector3(f.token.world.x, f.token.world.y, f.token.world.z);
  return ['Hips', 'Spine2', 'Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'].map((name) =>
    skeleton.getBoneByName(`mixamorig${name}`).getWorldPosition(new three.Vector3()).sub(origin)
  );
}

function transition(f, from, to, start) {
  let previous = joints(f);
  let peak = 0;
  let minimumWeight = 1;
  start();
  for (let frame = 0; frame < 61; frame++) {
    if (frame > 0) f.data.mixer.update(1 / 120);
    f.adapter._neutralizeRootMotion(f.token);
    f.mesh.updateMatrixWorld(true);
    const current = joints(f);
    peak = Math.max(peak, ...current.map((point, index) => point.distanceTo(previous[index])));
    previous = current;
    minimumWeight = Math.min(
      minimumWeight,
      f.data.actions[from].getEffectiveWeight() + f.data.actions[to].getEffectiveWeight()
    );
  }
  return { peak, minimumWeight };
}

test('falling to impact uses a balanced blend without changing the landing position', async () => {
  const f = await fixture();
  pose(f, 'fallLoop', 0.25);
  const state = f.adapter._ensureMovementState(f.token);
  Object.assign(state, {
    phase: 'fall',
    fallMode: 'loop',
    fallLandingKey: 'proneLanding',
    fallLandingDuration: f.data.clips.proneLanding,
    fallSpeed: 1,
    stepFinalized: true,
    activeStep: { targetWorld: { ...f.token.world }, heightDrop: 3 },
    fallTrajectory: { elapsed: 1, duration: 1, contactTime: 0, landingStarted: false },
  });
  const metrics = transition(f, 'fallLoop', 'proneLanding', () =>
    f.adapter._transitionFallToLanding(state)
  );
  expect(metrics.minimumWeight).toBeGreaterThan(0.995);
  expect(f.token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
});

test('collapse to lying keeps full pose weight and avoids a bind-pose pop', async () => {
  const f = await fixture();
  pose(f, 'proneLanding', f.data.clips.proneLanding);
  f.token.conditions = ['prone'];
  const state = f.adapter._ensureMovementState(f.token);
  const metrics = transition(f, 'proneLanding', 'prone', () =>
    f.adapter._finalizePostFallState(state)
  );
  expect(metrics.minimumWeight).toBeGreaterThan(0.995);
  expect(metrics.peak).toBeLessThan(0.02);
});

test('lying to getting up has a gentle start without moving the logical token', async () => {
  const f = await fixture();
  pose(f, 'prone', 0.8);
  const metrics = transition(f, 'prone', 'standUp', () => f.adapter.playStandUp(f.token));
  expect(metrics.minimumWeight).toBeGreaterThan(0.995);
  expect(metrics.peak).toBeLessThan(0.02);
  expect(f.token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
});

test('getting up to idle releases the grounding correction without a vertical snap', async () => {
  const f = await fixture();
  f.adapter.playStandUp(f.token);
  pose(f, 'standUp', f.data.clips.standUp);
  const state = f.adapter._movementStates.get(f.token);
  const metrics = transition(f, 'standUp', 'idle', () => f.adapter._advanceStandUp(state, 0));
  expect(metrics.minimumWeight).toBeGreaterThan(0.995);
  expect(metrics.peak).toBeLessThan(0.02);
  expect(f.token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
});

test('refreshing an already-prone creature does not restart the held animation', async () => {
  const f = await fixture();
  pose(f, 'prone', 0.8);
  f.token.conditions = ['prone'];
  f.adapter.syncProneState(f.token);
  expect(f.data.actions.prone.time).toBeCloseTo(0.8);
});
