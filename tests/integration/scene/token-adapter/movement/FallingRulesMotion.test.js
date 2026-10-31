import { CHARACTER_DEFINITIONS } from '../../../../../src/config/CharacterCatalog.js';
import { CharacterLibrary } from '../../../../../src/entities/characters/CharacterLibrary.js';
import {
  linkTokenCharacter,
  setTokenMovementSettings,
} from '../../../../../src/entities/creatures/TokenMovement.js';
import { connectCharacterServices } from '../../../../../src/ui/characters/characterServices.js';
import data from '../../../../../assets/data/srd2014.json';
import { GameErrors } from '../../../../../src/utils/error/ErrorHandler.js';
import * as dice from '../../../../../src/systems/dice/dice.js';
import {
  createHumanoidFixture,
  humanoidBounds,
  humanoidBodyHeading,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../../../helpers/humanoid-fixture.js';

let restoreFiles;
let diceSpy;
let diceValue;
const realRoll = dice.rollDiceExpression;
const errorSpies = [];
const fixtures = [];
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
beforeEach(() => {
  localStorage.clear();
  diceValue = 0.5;
  diceSpy = jest
    .spyOn(dice, 'rollDiceExpression')
    .mockImplementation((request) => realRoll(request, { random: () => diceValue }));
});
afterEach(() => {
  for (const f of fixtures.splice(0)) {
    f.services?.falling.dispose();
    f.adapter.disposeMovementRange();
  }
  diceSpy.mockRestore();
  for (const spy of errorSpies.splice(0)) spy.mockRestore();
  document.body.replaceChildren();
});
afterAll(() => restoreFiles());

async function setup(type = 'mannequin', levels = 9) {
  const f = await createHumanoidFixture({ type, height: 0, elevationUnit: 0.3 });
  fixtures.push(f);
  f.gm.getTerrainHeight = (x) => (x <= 4 ? levels : 0);
  f.token.gridX = 3;
  f.token.gridY = 3;
  f.adapter._syncTokenAndMeshWorld(
    { token: f.token, mesh: f.mesh },
    { x: 3.5, y: levels * 0.3, z: 3.5 }
  );
  f.mesh.updateMatrixWorld(true);
  f.library = new CharacterLibrary({
    ruleset: '2014',
    storage: localStorage,
    catalog: data.entries,
    classes: data.classes,
  });
  const id = f.library.create(type);
  f.library.edit(id, { hp: { max: 100, current: 100 }, speed: 30 });
  linkTokenCharacter(f.token, f.library, id);
  f.services = connectCharacterServices(f.gm, {
    library: f.library,
    catalog: { ruleset: '2014', classes: data.classes },
  });
  setTokenMovementSettings(f.token, { mode: 'run' });
  return f;
}

async function until(f, predicate, observe = () => {}, limit = 2400) {
  for (let frame = 0; frame < limit && !predicate(); frame++) {
    stepHumanoid(f, 1 / 30);
    await Promise.resolve();
    observe();
  }
  expect(predicate()).toBe(true);
}

async function finish(f, observe = () => {}) {
  await until(f, () => !f.adapter.isMovementInProgress(f.token), observe);
  for (let frame = 0; frame < 20; frame++) stepHumanoid(f, 1 / 30);
}

test.each(CHARACTER_DEFINITIONS.map(({ id }) => id))(
  '%s: a real ledge fall commits HP at impact, stops the route, holds Prone and gets up for half movement',
  async (type) => {
    const f = await setup(type);
    const idleHeight = humanoidBounds(f).getSize(new f.gm.threeSceneManager.three.Vector3()).y;
    f.services.combat.startTurn(f.token);
    const request = f.adapter.requestMoveToGrid(f.token, 9, 3);
    expect(request.cost).toBe(30);
    let committedBeforeAnimationEnd = false;
    let landingHeading = null;
    await finish(f, () => {
      if (f.library.get(f.token.characterSheetId).hp.current < 100) {
        expect(f.token.world.y).toBeCloseTo(0, 6);
        const action = f.data.actions.proneLanding;
        if (f.data.current === 'proneLanding' && action.time < action.getClip().duration - 0.05)
          committedBeforeAnimationEnd = true;
        if (f.data.current === 'proneLanding' && action.time >= action.getClip().duration - 0.1)
          landingHeading = humanoidBodyHeading(f);
      }
    });
    expect(committedBeforeAnimationEnd).toBe(true);
    expect(f.token.world).toEqual({ x: 5.5, y: 0, z: 3.5 });
    expect(f.library.get(f.token.characterSheetId)).toMatchObject({
      hp: { current: 96 },
      conditions: ['prone'],
      lastFall: { dice: 1, damage: 4 },
    });
    expect(f.library.get(f.token.characterSheetId).lastFall.distanceFeet).toBeCloseTo(13.5, 8);
    expect(f.data.current).toBe('prone');
    expect(landingHeading).not.toBeNull();
    expect(landingHeading.angleTo(humanoidBodyHeading(f))).toBeLessThan(Math.PI / 18);
    expect(f.token.facingAngle).toBeCloseTo(0);
    const proneBounds = humanoidBounds(f);
    expect(proneBounds.min.y).toBeCloseTo(0, 2);
    expect(proneBounds.max.y).toBeLessThan(idleHeight * 0.65);
    for (let frame = 0; frame < 90; frame++) stepHumanoid(f, 1 / 30);
    expect(f.data.current).toBe('prone');
    expect(f.services.combat.status(f.token)).toMatchObject({
      movement: { spent: 10, remaining: 20 },
      actions: 1,
      bonusActions: 1,
      reactions: 1,
    });
    const placement = f.adapter.getStablePlacement(f.token);
    const combat = f.services.combat.snapshot();
    await f.adapter.restoreStablePlacement(f.token, placement);
    f.services.combat.restore(combat, [f.token]);
    expect(f.data.current).toBe('prone');
    await f.services.falling.stand(f.token);
    expect(f.data.current).toBe('standUp');
    await finish(f);
    expect(f.data.current).toBe('idle');
    expect(f.token.world).toEqual({ x: 5.5, y: 0, z: 3.5 });
    expect(f.services.combat.status(f.token)).toMatchObject({
      movement: { spent: 25, remaining: 5 },
      actions: 1,
      bonusActions: 1,
      reactions: 1,
    });
    expect(f.library.get(f.token.characterSheetId).conditions).not.toContain('prone');
  },
  30000
);

test('Slow Fall pauses at the ledge, doubles airborne animation time and softens landing even with damage left', async () => {
  diceValue = 0.99;
  const f = await setup('mannequin', 28);
  f.library.edit(f.token.characterSheetId, { classId: 'monk', level: 4 });
  f.services.combat.startTurn(f.token);
  f.adapter.requestMoveToGrid(f.token, 9, 3);
  await until(f, () => !!document.querySelector('[role="dialog"]'));
  const held = { ...f.token.world };
  for (let frame = 0; frame < 90; frame++) stepHumanoid(f, 1 / 30);
  expect(f.token.world).toEqual(held);
  expect(f.library.get(f.token.characterSheetId).hp.current).toBe(100);
  [...document.querySelectorAll('[role="dialog"] button')]
    .find((button) => button.textContent === 'Use Slow Fall (reaction)')
    .click();
  await until(f, () => f.adapter._movementStates.get(f.token)?.phase === 'fall');
  const state = f.adapter._movementStates.get(f.token);
  expect(state.fallTrajectory.duration).toBeCloseTo(2 * Math.sqrt((2 * 42) / 32.174), 4);
  expect(f.data.actions.fallLoop.getEffectiveTimeScale()).toBeLessThan(
    f.data.profile.fallLoopTimeScale
  );
  let soft = false;
  await finish(f, () => {
    if (f.data.current === 'proneLanding') {
      expect(f.data.actions.proneLanding.getEffectiveTimeScale()).toBeCloseTo(0.7);
      soft = true;
    }
  });
  expect(soft).toBe(true);
  expect(f.library.get(f.token.characterSheetId)).toMatchObject({
    hp: { current: 96 },
    conditions: ['prone'],
    lastFall: { rawDamage: 24, reduction: 20, damage: 4 },
  });
  expect(f.services.combat.status(f.token)).toMatchObject({
    actions: 1,
    bonusActions: 1,
    reactions: 0,
  });
}, 30000);

test('a crawling creature falling again never gets a free upright landing or stand', async () => {
  const inputErrors = jest.spyOn(GameErrors, 'input');
  const stateErrors = jest.spyOn(GameErrors, 'gameState');
  errorSpies.push(inputErrors, stateErrors);
  const f = await setup();
  f.library.edit(f.token.characterSheetId, { conditions: ['prone'] });
  f.adapter.syncProneState(f.token);
  f.services.combat.startTurn(f.token);
  expect(f.adapter.requestMoveToGrid(f.token, 6, 3).cost).toBe(30);
  await finish(f, () => {
    expect(f.data.current).not.toBe('proneLanding');
    expect(f.library.get(f.token.characterSheetId).conditions).toContain('prone');
  });
  expect(
    [...inputErrors.mock.calls, ...stateErrors.mock.calls].map(([error]) => error.message)
  ).toEqual([]);
  expect(f.token.world).toEqual({ x: 5.5, y: 0, z: 3.5 });
  expect(f.data.current).toBe('prone');
  expect(f.services.combat.status(f.token).movement.spent).toBe(20);
}, 30000);
