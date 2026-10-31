import { CHARACTER_DEFINITIONS } from '../../../../src/config/CharacterCatalog.js';
import {
  createHumanoidFixture,
  finishHumanoid,
  humanoidBounds,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../../helpers/humanoid-fixture.js';

let restoreFiles;
const fixtures = [];
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterEach(() => {
  for (const f of fixtures.splice(0)) f.adapter.disposeMovementRange();
});
afterAll(() => restoreFiles());
async function fixture(type, height) {
  const f = await createHumanoidFixture({ type, height });
  fixtures.push(f);
  return f;
}

describe.each(CHARACTER_DEFINITIONS.map(({ id }) => id))('%s natural manual motion', (type) => {
  test('removing the supporting cover wall releases the held crouch', async () => {
    const f = await fixture(type, 24);
    await f.adapter.playTokenAction(f.token, 'action-cover');
    finishHumanoid(f);
    f.gm.getTerrainHeight = () => 0;
    for (let frame = 0; frame < 40; frame++) stepHumanoid(f);
    expect(f.data.current).toBe('idle');
    expect(f.adapter._getManualAnimationState(f.token)).toBeNull();
  });

  test('Dodge visibly travels outward and walks back without changing its logical position', async () => {
    const f = await fixture(type, 0);
    const world = { ...f.token.world };
    const root = f.adapter._rootBones.get(f.token)[0].bone;
    const before = root.matrixWorld.clone();
    await f.adapter.playTokenAction(f.token, 'action-dodge');
    let distance = 0;
    finishHumanoid(f, () => {
      f.mesh.updateMatrixWorld(true);
      distance = Math.max(
        distance,
        Math.hypot(
          root.matrixWorld.elements[12] - before.elements[12],
          root.matrixWorld.elements[14] - before.elements[14]
        )
      );
      expect(f.token.world).toEqual(world);
    });
    expect(distance).toBeGreaterThan(0.5);
    expect(f.data.current).toBe('idle');
    expect(f.token.world).toEqual(world);
    expect(
      Math.hypot(
        root.matrixWorld.elements[12] - before.elements[12],
        root.matrixWorld.elements[14] - before.elements[14]
      )
    ).toBeLessThan(0.02);
  });

  test('Cover rejects a scene with no adjacent wall', async () => {
    const f = await fixture(type, 0);
    expect(f.adapter.getManualActionAvailability(f.token, 'action-cover').allowed).toBe(false);
    await expect(f.adapter.playTokenAction(f.token, 'action-cover')).rejects.toThrow(
      /adjacent wall/
    );
    expect(f.data.current).toBe('idle');
  });

  test('Cover smoothly aligns the crouched body with a valid wall and preserves its cell', async () => {
    const f = await fixture(type, 24);
    await f.adapter.playTokenAction(f.token, 'action-cover');
    finishHumanoid(f);
    expect(f.data.current).toBe('actionCoverHold');
    expect([f.token.gridX, f.token.gridY]).toEqual([5, 4]);
    expect(f.token.world.y).toBe(0);
    const bounds = humanoidBounds(f);
    expect(bounds.max.x).toBeCloseTo(5.98, 2);
    expect(Math.abs(bounds.min.y)).toBeLessThan(0.03);
    expect(Math.abs(f.token.facingAngle)).toBeCloseTo(Math.PI);
    const held = { ...f.token.world };
    for (let frame = 0; frame < 60; frame++) stepHumanoid(f);
    expect(f.token.world).toEqual(held);
    f.adapter.releaseManualActionForFacing(f.token);
    for (let frame = 0; frame < 40; frame++) stepHumanoid(f);
    expect(f.data.current).toBe('idle');
    expect(f.token.world).toEqual(held);
  });
});
