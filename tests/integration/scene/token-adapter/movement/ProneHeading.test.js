import { CHARACTER_DEFINITIONS } from '../../../../../src/config/CharacterCatalog.js';
import {
  createHumanoidFixture,
  installHumanoidAssetFiles,
  humanoidBodyHeading,
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

function poseHeading(fixture, key, time) {
  const { adapter, token, data, mesh } = fixture;
  adapter._setAnimation(token, key, { force: true, immediate: true });
  data.actions[key].time = time;
  data.actions[key].paused = true;
  data.mixer.update(0);
  adapter._neutralizeRootMotion(token);
  mesh.updateMatrixWorld(true);
  return humanoidBodyHeading(fixture);
}

function angleBetween(a, b) {
  return (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;
}

test.each(CHARACTER_DEFINITIONS.map(({ id }) => id))(
  '%s keeps its body heading from collapse through prone and getting up',
  async (type) => {
    const fixture = await createHumanoidFixture({
      type,
      height: 0,
      animationKeys: ['idle', 'proneLanding', 'prone', 'standUp', 'crawl', 'crawlBackward'],
      warmupFrames: 2,
    });
    fixtures.push(fixture);
    for (const yaw of [0, Math.PI / 4, Math.PI / 2, (-3 * Math.PI) / 4]) {
      fixture.token.facingAngle = yaw;
      fixture.adapter._applyOrientationImmediate(fixture.token, yaw);
      const landing = poseHeading(fixture, 'proneLanding', fixture.data.clips.proneLanding);
      const prone = poseHeading(fixture, 'prone', 0);
      expect(angleBetween(landing, prone)).toBeLessThan(2);
      const held = poseHeading(fixture, 'prone', fixture.data.clips.prone / 2);
      expect(angleBetween(landing, held)).toBeLessThan(8);
      const gettingUp = poseHeading(fixture, 'standUp', 0);
      expect(angleBetween(prone, gettingUp)).toBeLessThan(10);
      expect(fixture.token.facingAngle).toBe(yaw);
      expect(fixture.token.world).toEqual({ x: 5.5, y: 0, z: 4.5 });
    }
  },
  30000
);
