import { CHARACTER_DEFINITIONS } from '../../../../../src/config/CharacterCatalog.js';
import { CharacterLibrary } from '../../../../../src/entities/characters/CharacterLibrary.js';
import { linkTokenCharacter } from '../../../../../src/entities/creatures/TokenMovement.js';
import { connectCharacterServices } from '../../../../../src/ui/characters/characterServices.js';
import { rollDiceExpression } from '../../../../../src/systems/dice/dice.js';
import {
  createHumanoidFixture,
  humanoidBounds,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../../../helpers/humanoid-fixture.js';

jest.mock('../../../../../src/systems/dice/dice.js', () => ({
  rollDiceExpression: jest.fn(),
}));

let restoreFiles;
let fixtures;

beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
beforeEach(() => {
  localStorage.clear();
  fixtures = [];
  rollDiceExpression.mockImplementation(async ({ expression }) => ({
    expression,
    total: 7,
    text: '2d6 [3, 4] = 7',
  }));
});
afterEach(() => {
  for (const fixture of fixtures) {
    fixture.gm.characterServices.falling.dispose();
    fixture.adapter.disposeMovementRange();
  }
});
afterAll(() => restoreFiles());

async function fixture(type) {
  const context = await createHumanoidFixture({
    type,
    height: 0,
    warmupFrames: 0,
    animationKeys: [
      'idle',
      'walk',
      'run',
      'hover',
      'fly',
      'fall',
      'fallLoop',
      'proneLanding',
      'prone',
      'standUp',
    ],
  });
  const library = new CharacterLibrary({ ruleset: '2014', catalog: [], storage: localStorage });
  const id = library.create(`${type} flyer`);
  library.edit(id, { hp: { current: 20, max: 20 }, fallTraits: { flySpeed: 60 } });
  linkTokenCharacter(context.token, library, id);
  connectCharacterServices(context.gm, { library, catalog: { ruleset: '2014' } });
  context.gm.characterServices.combat.startTurn(context.token);
  fixtures.push(context);
  return context;
}

async function settle(context) {
  for (
    let frame = 0;
    frame < 12000 && context.adapter.isMovementInProgress(context.token);
    frame++
  ) {
    stepHumanoid(context);
    await Promise.resolve();
  }
  expect(context.adapter.isMovementInProgress(context.token)).toBe(false);
  for (let frame = 0; frame < 40; frame++) stepHumanoid(context);
}

test.each(CHARACTER_DEFINITIONS.map(({ id }) => [id]))(
  '%s retargets both flight clips, holds paid altitude and crossfades between hover and travel',
  async (type) => {
    const context = await fixture(type);
    const { adapter, token, data } = context;
    expect(data.actions.hover).toBeUndefined();
    expect(data.actions.fly).toBeUndefined();
    await adapter.applyFlightCommand(token, 'takeoff');
    await settle(context);
    expect(token.world.y).toBeCloseTo(1, 8);
    expect(data.current).toBe('hover');
    expect(data.actions.hover).not.toBe(data.actions.fly);
    expect(data.actions.hover.getClip()).not.toBe(data.actions.fly.getClip());
    expect(data.actions.hover.getEffectiveWeight()).toBeCloseTo(1, 5);
    for (let frame = 0; frame < 240; frame++) stepHumanoid(context);
    expect(token.world.y).toBeCloseTo(1, 8);
    for (const { bone, basePosition } of adapter._rootBones.get(token)) {
      expect(bone.position.distanceTo(basePosition)).toBeLessThan(1e-7);
    }
    expect(adapter.requestMoveToGrid(token, 7, 4).cost).toBe(10);
    for (let frame = 0; frame < 12; frame++) stepHumanoid(context);
    expect(data.current).toBe('fly');
    expect(data.actions.hover.getEffectiveWeight()).toBeGreaterThan(0);
    expect(data.actions.hover.getEffectiveWeight()).toBeLessThan(1);
    expect(data.actions.fly.getEffectiveWeight()).toBeGreaterThan(0);
    expect(data.actions.fly.getEffectiveWeight()).toBeLessThan(1);
    await settle(context);
    expect(token.world).toEqual({ x: 7.5, y: 1, z: 4.5 });
    expect(data.current).toBe('hover');
    expect(data.actions.hover.getEffectiveWeight()).toBeCloseTo(1, 5);
    expect(data.actions.fly.getEffectiveWeight()).toBeCloseTo(0, 5);
    expect(context.gm.characterServices.combat.status(token).movement.spent).toBe(15);
    expect(adapter.getStablePlacement(token).pose.kind).toBe('flight');
  },
  30000
);

test.each(CHARACTER_DEFINITIONS.slice(0, 2).map(({ id }) => [id]))(
  '%s completes an actual animated Drop with grounded Prone, damage and no added movement cost',
  async (type) => {
    const context = await fixture(type);
    const { adapter, token, gm, data } = context;
    await adapter.applyFlightCommand(token, 'takeoff');
    await settle(context);
    await adapter.applyFlightCommand(token, 'raise', 20);
    await settle(context);
    await adapter.applyFlightCommand(token, 'drop');
    await settle(context);
    expect(token.world.y).toBe(0);
    expect(token.flightActive).toBeUndefined();
    expect(data.current).toBe('prone');
    expect(Math.abs(humanoidBounds(context).min.y)).toBeLessThan(0.015);
    expect(gm.characterServices.library.get(token.characterSheetId)).toMatchObject({
      hp: { current: 13 },
      conditions: ['prone'],
      fallTraits: { flySpeed: 60 },
    });
    expect(gm.characterServices.combat.status(token).movement.spent).toBe(25);
  },
  30000
);
