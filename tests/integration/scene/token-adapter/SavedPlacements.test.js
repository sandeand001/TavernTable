import {
  setTokenMovementSettings,
  linkTokenCharacter,
} from '../../../../src/entities/creatures/TokenMovement.js';
import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import CombatSession from '../../../../src/entities/characters/CombatSession.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  handPositions,
  installHumanoidAssetFiles,
  stepHumanoid,
  wallSurface,
} from '../../../helpers/humanoid-fixture.js';

let restoreFiles;
const animations = ['idle', 'walk', 'climb', 'climbWall', 'climbWallDown', 'climbRecover'];
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

test.each([
  [false, 4, 'climbWall'],
  [true, 4, 'climbWallDown'],
  [true, 7, 'ledgeHang'],
])(
  'a stable wall/ledge pose roundtrips from high=%s to %s (%s)',
  async (high, target, clip) => {
    const first = await createHumanoidFixture({
      height: 24,
      high,
      warmupFrames: 0,
      animationKeys: animations,
    });
    const second = await createHumanoidFixture({
      height: 24,
      warmupFrames: 0,
      animationKeys: animations,
    });
    try {
      setTokenMovementSettings(first.token, { speed: 50 });
      expect(first.adapter.requestMoveToSurface(first.token, wallSurface(target))).toBeTruthy();
      finishHumanoid(first);
      const saved = first.adapter.getStablePlacement(first.token);
      expect(saved.pose.kind).toBe('wall');
      expect(saved.pose.wall.clip).toBe(clip);
      const hands = handPositions(first);
      await second.adapter.restoreStablePlacement(second.token, saved);
      expect(second.token.world).toEqual(first.token.world);
      expect(second.adapter.isWallAttached(second.token)).toBe(true);
      expect(second.adapter.isMovementInProgress(second.token)).toBe(false);
      expect(
        handPositions(second).every((hand, index) => hand.distanceTo(hands[index]) < 0.00001)
      ).toBe(true);
      setTokenMovementSettings(second.token, { speed: 50 });
      expect(second.adapter.requestMoveToSurface(second.token, wallSurface(5))).toBeTruthy();
      finishHumanoid(second);
      expect(second.token.world.y).toBeCloseTo(5);
    } finally {
      first.adapter.disposeMovementRange();
      second.adapter.disposeMovementRange();
    }
  },
  30000
);

test('closing during a ground route uses its most recent completed safe step, not the live tween', async () => {
  const fixture = await createHumanoidFixture({
    height: 0,
    warmupFrames: 0,
    animationKeys: animations,
  });
  try {
    localStorage.clear();
    const library = new CharacterLibrary({ catalog: [], ruleset: '2014', storage: localStorage });
    linkTokenCharacter(fixture.token, library, library.create('Moving fighter'));
    const combat = new CombatSession({ library });
    fixture.gm.characterServices = { library, combat };
    combat.startTurn(fixture.token);
    const before = fixture.adapter.getStablePlacement(fixture.token);
    fixture.adapter.requestMoveToGrid(fixture.token, 9, 4);
    let checkpoint = null;
    for (
      let frame = 0;
      frame < 1000 && fixture.adapter.isMovementInProgress(fixture.token);
      frame++
    ) {
      stepHumanoid(fixture);
      const saved = fixture.adapter.getStablePlacement(fixture.token);
      if (
        saved.pose.world.x > before.pose.world.x + 0.9 &&
        fixture.adapter.isMovementInProgress(fixture.token)
      ) {
        checkpoint = saved;
        break;
      }
    }
    expect(checkpoint).not.toBeNull();
    stepHumanoid(fixture);
    expect(fixture.adapter.getStablePlacement(fixture.token)).toEqual(checkpoint);
    expect(fixture.token.world.x).toBeGreaterThan(checkpoint.pose.world.x);
    const snapshot = combat.snapshot({
      movementCosts: fixture.adapter.getCheckpointMovementCosts(),
    });
    const reopened = new CombatSession({ library });
    const restoredToken = { ...fixture.token, world: checkpoint.pose.world };
    reopened.restore(snapshot, [restoredToken]);
    const completedCost = (checkpoint.pose.world.x - before.pose.world.x) * 5;
    expect(reopened.status(restoredToken).movement.spent).toBeCloseTo(completedCost, 6);
    expect(reopened.status(restoredToken).movement.remaining).toBeCloseTo(30 - completedCost, 6);
    expect(reopened.status(restoredToken).busy).toBe(false);
  } finally {
    fixture.adapter.disposeMovementRange();
  }
}, 30000);
