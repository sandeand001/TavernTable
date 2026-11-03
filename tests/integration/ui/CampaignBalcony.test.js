import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';
import {
  addPointerView,
  addPhysicalTerrain,
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';
import * as dice from '../../../src/systems/dice/dice.js';
import * as three from 'three';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());
const realRoll = dice.rollDiceExpression;
let diceSpy;
beforeEach(() => {
  diceSpy = jest
    .spyOn(dice, 'rollDiceExpression')
    .mockImplementation((request) => realRoll(request, { random: () => 0.5 }));
});
afterEach(() => diceSpy.mockRestore());

async function fixture() {
  const gm = await createConnectedTravelBoard({ sceneFactory: createOpeningsTravelScene });
  const actor = gm.placedTokens[0];
  for (const npc of [...gm.placedTokens].slice(1)) gm.tokenManager.removeToken(npc);
  delete gm.__threeTestDouble;
  const adapter = gm.token3DAdapter;
  adapter.releaseTokenVisual(actor);
  await adapter.onTokenAdded(actor);
  await actor.__threeMeshPromise;
  const library = gm.characterServices.library;
  await library.edit(actor.characterSheetId, {
    hp: { max: 40, current: 40 },
    fallTraits: { flySpeed: 60 },
  });
  return { gm, actor, adapter, library, session: gm.characterServices.combat };
}

async function finishMotion({ gm, actor, adapter }) {
  for (let frame = 0; frame < 1200 && adapter.isMovementInProgress(actor); frame++) {
    stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    gm.advanceFrame();
    await Promise.resolve();
  }
  expect(adapter.isMovementInProgress(actor)).toBe(false);
}

test.each([
  ['ordinary ground', { x: 8.5, y: 0, z: 10.5 }, 10],
  ['balcony slab', { x: 9.5, y: 2, z: 10.5 }, 5],
])(
  'a native surface click flies over %s without changing altitude',
  async (_label, target, cost) => {
    const context = await fixture();
    const { gm, actor, adapter, session } = context;
    const disposeTerrain = addPhysicalTerrain(gm);
    const canvas = addPointerView(
      gm,
      new three.Vector3(target.x, target.y, target.z),
      new three.Vector3(5, 9, 14)
    );
    try {
      await adapter.restoreStablePlacement(actor, {
        gridX: 10,
        gridY: 10,
        facingAngle: 0,
        pose: { kind: 'flight', world: { x: 10.5, y: 3.4, z: 10.5 } },
      });
      await adapter.setSelectedToken(actor);
      session.startTurn(actor);
      const manager = new InteractionManager(gm);
      const targetPick = await manager._resolvePointerTarget({ clientX: 400, clientY: 300 });
      expect(targetPick.wallSurface?.normal.y).toBeGreaterThan(0.9);
      manager.handleLeftClick({ button: 0, clientX: 400, clientY: 300 });
      for (let tick = 0; tick < 12; tick++) await Promise.resolve();
      expect(adapter.isMovementInProgress(actor)).toBe(true);
      await finishMotion(context);
      expect(actor.world).toEqual({ x: target.x, y: 3.4, z: target.z });
      expect(actor.flightActive).toBe(true);
      expect(session.status(actor).movement.spent).toBe(cost);
    } finally {
      disposeTerrain();
      canvas.remove();
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('walking through the unrailed balcony edge falls to exterior ground and applies normal damage', async () => {
  const context = await fixture();
  const { gm, actor, adapter, library, session } = context;
  try {
    await library.edit(actor.characterSheetId, { fallTraits: { flySpeed: 0 } });
    await adapter.restoreStablePlacement(actor, {
      gridX: 10,
      gridY: 10,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 10.5, y: 2, z: 10.5 }, surfaceId: 'balcony' },
    });
    session.startTurn(actor);
    const request = adapter.requestMoveToGrid(actor, 8, 10);
    expect(request?.cost).toBe(10);
    await finishMotion(context);
    expect(actor.mapId).toBe('map-main');
    expect(actor.world).toEqual({ x: 8.5, y: 0, z: 10.5 });
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 36 },
      conditions: ['prone'],
      lastFall: { distanceFeet: 10, damage: 4 },
    });
    expect(session.status(actor).movement.spent).toBe(10);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a flyer can safely drop onto the real balcony rather than falling through it to exterior ground', async () => {
  const context = await fixture();
  const { gm, actor, adapter, library, session } = context;
  try {
    await adapter.restoreStablePlacement(actor, {
      gridX: 10,
      gridY: 10,
      facingAngle: 0,
      pose: { kind: 'flight', world: { x: 10.5, y: 2.4, z: 10.5 } },
    });
    session.startTurn(actor);
    expect(adapter.getFlightStatus(actor).heightFeet).toBeCloseTo(2);
    await adapter.applyFlightCommand(actor, 'drop');
    await finishMotion(context);
    expect(actor.world.y).toBe(2);
    expect(actor.flightActive).not.toBe(true);
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 40 },
      conditions: [],
      lastFall: { damage: 0 },
    });
    expect(adapter.getStablePlacement(actor).pose.surfaceId).toBe('balcony');
    expect(session.status(actor).movement.spent).toBe(0);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a clicked balcony can be reached by animated wall climbing across turns without clipping through its railing', async () => {
  const context = await fixture();
  const { gm, actor, adapter, library, session } = context;
  try {
    await library.edit(actor.characterSheetId, { fallTraits: { flySpeed: 0 } });
    await adapter.restoreStablePlacement(actor, {
      gridX: 10,
      gridY: 9,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 10.5, y: 0, z: 9.4 } },
    });
    const target = {
      kind: 'floor',
      surfaceId: 'balcony',
      point: { x: 10.5, y: 2, z: 10.5 },
      normal: { x: 0, y: 1, z: 0 },
    };
    session.startTurn(actor);
    expect(adapter.requestMoveToSurface(actor, target)?.cost).toBe(30);
    await finishMotion(context);
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(session.status(actor).movement.spent).toBe(30);
    expect(actor.world.y).toBeCloseTo(2.5);
    expect(actor.world.z).toBeCloseTo(9.4);
    session.endTurn();
    session.startTurn(actor);
    expect(adapter.requestMoveToSurface(actor, target)?.cost).toBe(15);
    await finishMotion(context);
    expect(actor.world.y).toBe(2);
    expect(actor.gridX).toBe(10);
    expect(actor.gridY).toBe(10);
    expect(adapter.isWallAttached(actor)).toBe(false);
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 40 },
      conditions: [],
    });
    expect(session.status(actor).movement.spent).toBe(15);
    expect(adapter.getStablePlacement(actor).pose.surfaceId).toBe('balcony');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);
