import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';
import { captureCampaignScene, changeCampaignView } from '../../../src/campaigns/SceneWorld.js';
import {
  addPointerView,
  addPhysicalTerrain,
  clickFeature,
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
  completeConnectionTravel as travelCampaignConnection,
  settleConnectionTravel,
} from '../../helpers/connectedTravelBoard.js';
import {
  humanoidBounds,
  installHumanoidAssetFiles,
  stepHumanoid,
} from '../../helpers/humanoid-fixture.js';
import * as dice from '../../../src/systems/dice/dice.js';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import { getConnectionTravelOption } from '../../../src/campaigns/CampaignTravel.js';

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

async function fixture({
  withObserver = false,
  mapId = 'high-floor',
  position = { x: 0.5, y: 0, z: 2.5 },
} = {}) {
  const gm = await createConnectedTravelBoard({
    sceneFactory: createOpeningsTravelScene,
    mapId,
    position,
  });
  const actor = gm.placedTokens[0];
  const observer = withObserver ? gm.placedTokens[1] : null;
  for (const npc of [...gm.placedTokens].slice(1))
    if (npc !== observer) gm.tokenManager.removeToken(npc);
  delete gm.__threeTestDouble;
  const adapter = gm.token3DAdapter;
  for (const token of observer ? [actor, observer] : [actor]) {
    adapter.releaseTokenVisual(token);
    await adapter.onTokenAdded(token);
    await token.__threeMeshPromise;
  }
  if (observer)
    await adapter.restoreStablePlacement(observer, {
      gridX: 0,
      gridY: 3,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 0.5, y: 0, z: 3.5 } },
    });
  const library = gm.characterServices.library;
  await library.edit(actor.characterSheetId, { hp: { max: 40, current: 40 } });
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  return { gm, actor, adapter, library, session, observer };
}

test('window crossings show the destination view first and animate out and back in without partial saves', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  const turn = session.turn;
  try {
    const outward = [];
    let checkedCapture = false;
    await travelCampaignConnection(gm, actor, 'high-window', {}, async () => {
      const state = adapter._movementStates.get(actor);
      if (!state?.openingCrossing) return;
      const toes = adapter._rootBones.get(actor)[0].footBones;
      const footY = Math.min(...toes.map((bone) => bone.getWorldPosition(new three.Vector3()).y));
      expect(Math.abs(footY - actor.world.y)).toBeLessThan(gm.spatial.tileWorldSize * 0.15);
      outward.push({
        map: gm.campaignMapId,
        world: { ...actor.world },
        clip: adapter._tokenAnimationData.get(actor).current,
      });
      if (!checkedCapture) {
        checkedCapture = true;
        await expect(captureCampaignScene(gm, library)).rejects.toThrow(/map view.*changing/i);
      }
    });
    expect(outward.length).toBeGreaterThan(20);
    expect(outward.every((sample) => sample.map === 'map-main')).toBe(true);
    expect(new Set(outward.map((sample) => sample.clip))).toEqual(
      new Set(['recoverShort', 'climbShort', 'ledgeHang'])
    );
    expect(Math.max(...outward.map((sample) => sample.world.y))).toBeGreaterThan(4.3);
    expect(outward.some((sample) => sample.world.y > 3.4 && sample.world.y < 4)).toBe(true);
    expect(actor.world.y).toBeCloseTo(3.4);
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(session.status(actor).movement.spent).toBe(5);
    const inward = [];
    await travelCampaignConnection(gm, actor, 'high-window', {}, () => {
      if (adapter._movementStates.get(actor)?.openingCrossing)
        inward.push({
          map: gm.campaignMapId,
          world: { ...actor.world },
          clip: adapter._tokenAnimationData.get(actor).current,
        });
    });
    expect(inward.length).toBeGreaterThan(20);
    expect(inward.every((sample) => sample.map === 'high-floor')).toBe(true);
    expect(inward.some((sample) => sample.clip === 'climbShort')).toBe(true);
    expect(inward.some((sample) => sample.clip === 'recoverShort')).toBe(true);
    expect(inward.some((sample) => sample.world.y < 0)).toBe(true);
    expect(actor.world).toEqual({ x: 0.5, y: 0, z: 2.5 });
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(session.turn).toBe(turn);
    expect(session.status(actor).movement.spent).toBe(10);
    expect(library.get(actor.characterSheetId).hp.current).toBe(40);
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('ground');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a failed window animation restores the source pose and refunds its crossing cost', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  const data = adapter._tokenAnimationData.get(actor);
  const clip = data.actions.climbShort;
  try {
    delete data.actions.climbShort;
    await expect(travelCampaignConnection(gm, actor, 'high-window')).rejects.toThrow(
      /window climbing animations/i
    );
    expect(actor.mapId).toBe('high-floor');
    expect(actor.world).toEqual({ x: 0.5, y: 0, z: 2.5 });
    expect(gm.campaignMapId).toBe('high-floor');
    expect(gm.campaignViewBusy).toBe(false);
    expect(gm.campaignTraversalAnimating).toBe(false);
    expect(session.moves.size).toBe(0);
    expect(session.status(actor).movement.spent).toBe(0);
    expect(adapter._tokenAnimationData.get(actor).current).toBe('idle');
    expect((await captureCampaignScene(gm, library)).creatures[0].mapId).toBe('high-floor');
    data.actions.climbShort = clip;
    await travelCampaignConnection(gm, actor, 'high-window');
    expect(actor.mapId).toBe('map-main');
    expect(session.status(actor).movement.spent).toBe(5);
  } finally {
    data.actions.climbShort = clip;
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a failed save after the window animation rolls back the view, pose and movement and can retry', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  gm.sceneAutosave = {
    ready: true,
    changed: jest.fn(),
    getRollLog: () => [],
    dispose: () => {},
    flush: jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('Window storage full'))
      .mockResolvedValue(undefined),
  };
  try {
    await expect(travelCampaignConnection(gm, actor, 'high-window')).rejects.toThrow(
      'Window storage full'
    );
    expect(actor.mapId).toBe('high-floor');
    expect(actor.world).toEqual({ x: 0.5, y: 0, z: 2.5 });
    expect(gm.campaignMapId).toBe('high-floor');
    expect(gm.campaignViewBusy).toBe(false);
    expect(gm.campaignMapFailure).toBeUndefined();
    expect(session.moves.size).toBe(0);
    expect(session.status(actor).movement.spent).toBe(0);
    expect(adapter._tokenAnimationData.get(actor).current).toBe('idle');
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('ground');
    await travelCampaignConnection(gm, actor, 'high-window');
    expect(actor.mapId).toBe('map-main');
    expect(session.status(actor).movement.spent).toBe(5);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('window clicks only offer crossing; a ground click offers animated Climb down or Drop', async () => {
  const { gm, actor, adapter, session } = await fixture();
  const canvas = addPointerView(gm, new three.Vector3(0.1, 1, 2.9), new three.Vector3(4, 4, 4));
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  let disposeTerrain, groundCanvas;
  try {
    clickFeature(canvas);
    expect(popup.confirm.textContent).toBe('Exit (5 ft)');
    popup.confirm.click();
    await settleConnectionTravel(gm, actor, popup.ready);
    expect(actor.mapId).toBe('map-main');
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(popup.root.hidden).toBe(true);
    disposeTerrain = addPhysicalTerrain(gm);
    groundCanvas = addPointerView(gm, new three.Vector3(10.8, 0, 6.5), new three.Vector3(5, 6, 9));
    clickFeature(groundCanvas);
    expect(popup.root.hidden).toBe(false);
    const down = popup.confirm;
    const drop = popup.root.querySelector('[data-travel-action="drop"]');
    expect(down.disabled).toBe(false);
    expect(drop.disabled).toBe(false);
    expect(drop.textContent).toBe('Drop (0 ft)');
    down.click();
    await popup.ready;
    expect(adapter.isMovementInProgress(actor)).toBe(true);
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(session.status(actor).movement.remaining).toBe(5);
    expect(adapter.isWallAttached(actor)).toBe(false);
    expect(actor.world.y).toBe(0);
  } finally {
    popup.dispose();
    canvas.remove();
    groundCanvas?.remove();
    disposeTerrain?.();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a creature can mantle from a real wall grip onto a clicked supported roof', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    const world = { x: 10.8, y: 5, z: 5.4 };
    const grip = gm.campaignWorld.openingSurfaceGrip('map-main', world, 'high-window', {
      mapId: 'map-main',
      geometry: gm.terrainEngine.geometry,
    });
    await adapter.restoreStablePlacement(actor, {
      gridX: 10,
      gridY: 5,
      facingAngle: actor.facingAngle,
      pose: { kind: 'grip', world, grip },
    });
    session.endTurn();
    session.startTurn(actor);
    const request = adapter.requestClimbToSurface(actor, {
      kind: 'floor',
      point: { x: 11.5, y: 6, z: 5.4 },
      normal: { x: 0, y: 1, z: 0 },
    });
    expect(request?.cost).toBe(15);
    const clips = new Set();
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      clips.add(adapter._tokenAnimationData.get(actor).current);
      await Promise.resolve();
    }
    expect(clips.has('climb')).toBe(true);
    expect(actor.world).toEqual({ x: 11.5, y: 6, z: 5.4 });
    expect(adapter.isWallAttached(actor)).toBe(false);
    expect(session.status(actor).movement.spent).toBe(15);
    expect((await captureCampaignScene(gm, library)).creatures[0].pose).toMatchObject({
      kind: 'ground',
      surfaceId: 'roof',
    });
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('empty interiors retain physical floors in exterior views without needing a visible creature', async () => {
  const gm = await createConnectedTravelBoard({ sceneFactory: createOpeningsTravelScene });
  try {
    for (const token of [...gm.placedTokens]) gm.tokenManager.removeToken(token);
    await gm.token3DAdapter.syncMapProjections();
    const floors = gm.threeSceneManager.scene.getObjectByName('MapPhysicalFloors');
    expect(floors.visible).toBe(true);
    expect(floors.children).toHaveLength(3);
    gm.threeSceneManager.scene.updateMatrixWorld(true);
    const ray = new three.Raycaster(new three.Vector3(12.5, 5, 6.5), new three.Vector3(0, -1, 0));
    expect(ray.intersectObject(floors, true).some((hit) => Math.abs(hit.point.y - 4) < 1e-5)).toBe(
      true
    );
  } finally {
    disposeConnectedTravelBoard(gm);
  }
});

test.each([10.5, 7.5])(
  'a real wall click from the ground at x=%s approaches and animates a partial climb using the same movement ledger',
  async (x) => {
    const { gm, actor, adapter, session, library } = await fixture({
      mapId: 'map-main',
      position: { x, y: 0, z: 5.4 },
    });
    const disposeTerrain = addPhysicalTerrain(gm);
    const canvas = addPointerView(gm, new three.Vector3(11, 3.8, 5.4), new three.Vector3(5, 6, 8));
    try {
      await adapter.setSelectedToken(actor);
      new InteractionManager(gm).handleLeftClick({ button: 0, clientX: 400, clientY: 300 });
      for (let tick = 0; tick < 12; tick++) await Promise.resolve();
      expect(adapter.isMovementInProgress(actor)).toBe(true);
      const clips = new Set();
      for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
        stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
        gm.advanceFrame();
        clips.add(adapter._tokenAnimationData.get(actor).current);
        await Promise.resolve();
      }
      expect(clips.has('walk')).toBe(true);
      expect(clips.has('climbWall')).toBe(true);
      expect(actor.world.y).toBeGreaterThan(0);
      expect(actor.world.y).toBeLessThan(2.8);
      expect(adapter.isMovementInProgress(actor)).toBe(false);
      expect(session.status(actor).movement.spent).toBe(30);
      expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('grip');
    } finally {
      disposeTerrain();
      canvas.remove();
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('a new wall destination redirects at a paid safe hold instead of requiring a return to the original window', async () => {
  const { gm, actor, adapter, session } = await fixture();
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    adapter.requestMoveToSurface(actor, {
      point: { x: 11, y: 3.8, z: 6.5 },
      normal: { x: -1, y: 0, z: 0 },
    });
    for (let frame = 0; frame < 12; frame++)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    expect(
      adapter.requestMoveToSurface(actor, {
        point: { x: 11, y: 4, z: 6.5 },
        normal: { x: -1, y: 0, z: 0 },
      })?.queued
    ).toBe(true);
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(actor.world.y).toBeCloseTo(3);
    expect(session.status(actor).movement.spent).toBe(10);
    expect(adapter.isWallAttached(actor)).toBe(true);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('an independent wall hold can enter a nearby window without going back to ground', async () => {
  const { gm, actor, adapter, session } = await fixture();
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    expect(
      adapter.requestMoveToSurface(actor, {
        point: { x: 11, y: 4.4, z: 6.9 },
        normal: { x: -1, y: 0, z: 0 },
      })?.cost
    ).toBe(5);
    for (let frame = 0; frame < 1800 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(actor.openingHold).toBeUndefined();
    expect(getConnectionTravelOption(gm, actor, 'high-window')).toMatchObject({
      allowed: true,
      actionLabel: 'Climb in',
      costFeet: 5,
    });
    await travelCampaignConnection(gm, actor, 'high-window');
    expect(actor.mapId).toBe('high-floor');
    expect(adapter.isWallAttached(actor)).toBe(false);
    expect(session.status(actor).movement.spent).toBe(10);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a creature with flying speed can take flight directly from a physical hold', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  try {
    await library.edit(actor.characterSheetId, { fallTraits: { flySpeed: 60 } });
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    expect(adapter.getFlightCommandAvailability(actor, 'takeoff').allowed).toBe(true);
    await adapter.applyFlightCommand(actor, 'takeoff');
    for (let frame = 0; frame < 1800 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(actor.flightActive).toBe(true);
    expect(actor.world.y).toBeCloseTo(4.4);
    expect(adapter.isWallAttached(actor)).toBe(false);
    expect(session.status(actor).movement.spent).toBe(5);
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('flight');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a ten-foot gap catch applies real damage but leaves the creature attached instead of Prone', async () => {
  const { gm, actor, adapter, library, session } = await fixture();
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    gm.terrainEngine.geometry.carve({
      id: 'catch-proof-gap',
      bounds: { min: { x: 54.5, y: 10, z: 26 }, max: { x: 56.5, y: 20, z: 27.5 } },
    });
    const world = { x: 10.8, y: 4, z: 5.4 };
    const grip = gm.campaignWorld.openingSurfaceGrip('map-main', world, 'high-window', {
      mapId: 'map-main',
      geometry: gm.terrainEngine.geometry,
    });
    await adapter.restoreStablePlacement(actor, {
      gridX: 10,
      gridY: 5,
      facingAngle: actor.facingAngle,
      pose: { kind: 'grip', world, grip },
    });
    session.endTurn();
    session.startTurn(actor);
    expect(
      adapter.requestClimbToSurface(
        actor,
        {
          point: { x: 11, y: 2, z: 5.4 },
          normal: { x: -1, y: 0, z: 0 },
        },
        { confirmGapDrops: true }
      )?.cost
    ).toBe(10);
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(actor.world.y).toBeCloseTo(1);
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 36 },
      conditions: [],
      lastFall: { damage: 4, prone: false, dice: 1 },
    });
    expect(session.status(actor).movement.spent).toBe(10);
    expect(diceSpy).toHaveBeenCalledTimes(1);
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('grip');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a complete ground descent charges exactly the rounded climb cost before its final free drop', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    const turn = session.turn;
    expect(
      adapter.requestClimbToSurface(
        actor,
        {
          point: { x: 10.8, y: 0, z: 6.5 },
          normal: { x: 0, y: 1, z: 0 },
        },
        { confirmGapDrops: true }
      )?.cost
    ).toBe(20);
    for (
      let frame = 0;
      frame < 3600 &&
      (adapter.isMovementInProgress(actor) || adapter._landingMovementRedirects?.has(actor));
      frame++
    ) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(actor.world.y).toBe(0);
    expect(adapter.isWallAttached(actor)).toBe(false);
    expect(session.status(actor).movement.spent).toBe(20);
    expect(session.turn).toBe(turn);
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 40 },
      conditions: [],
    });
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('ground');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a failed climbing frame restores its safe hold and releases movement and saving readiness', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    adapter.requestMoveToSurface(actor, {
      point: { x: 11, y: 3.8, z: 6.5 },
      normal: { x: -1, y: 0, z: 0 },
    });
    const advance = jest.spyOn(adapter, '_advanceSurfaceClimb').mockImplementationOnce(() => {
      throw new Error('Climbing animation failed');
    });
    stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    advance.mockRestore();
    expect(actor.world.y).toBeCloseTo(3.4);
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(session.moves.size).toBe(0);
    expect(session.status(actor).movement.spent).toBe(0);
    expect(gm.campaignViewBusy).not.toBe(true);
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('ledge');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a partial window approach animates instead of relocating the climber to its next hold', async () => {
  const { gm, actor, adapter, session, library } = await fixture({
    mapId: 'map-main',
    position: { x: 10.5, y: 0, z: 5.4 },
  });
  try {
    const result = await travelCampaignConnection(gm, actor, 'high-window');
    expect(result.movementStarted).toBe(true);
    expect(adapter.isMovementInProgress(actor)).toBe(true);
    expect(actor.world.y).toBe(0);
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(actor.world.y).toBeGreaterThan(0);
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(session.status(actor).movement.spent).toBe(30);
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('grip');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a view staying inside sees the same held creature gripping the exterior sill in interior coordinates', async () => {
  const { gm, actor, adapter, library, observer } = await fixture({ withObserver: true });
  try {
    gm.campaignView.focus(observer.id);
    await adapter.setSelectedToken(observer);
    await travelCampaignConnection(gm, actor, 'high-window');
    expect(gm.campaignMapId).toBe('high-floor');
    expect(actor.mapId).toBe('map-main');
    expect(adapter.isTokenProjectionVisible(actor)).toBe(true);
    const skins = [];
    adapter.getTokenVisual(actor).traverse((node) => {
      if (node.isSkinnedMesh) skins.push(node);
    });
    const hands = skins[0].skeleton.bones.filter((bone) => /(LeftHand|RightHand)$/.test(bone.name));
    const gripY = () =>
      hands.reduce((total, bone) => total + bone.getWorldPosition(new three.Vector3()).y, 0) /
      hands.length;
    expect(gripY()).toBeCloseTo(0.4, 2);
    await captureCampaignScene(gm, library);
    for (let frame = 0; frame < 12; frame++)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    await adapter.syncMapProjections();
    expect(gripY()).toBeCloseTo(0.4, 2);
    expect(actor.world.y).toBeCloseTo(3.4);
    expect(adapter.isWallAttached(actor)).toBe(true);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test.each([
  ['available flying speed does not cancel deliberate release', false],
  ['active Feather Fall prevents damage and Prone', true],
])(
  'Let go animates the real fall without extra movement: %s',
  async (_label, featherFall) => {
    const { gm, actor, adapter, library, session } = await fixture();
    try {
      await library.edit(actor.characterSheetId, { fallTraits: { flySpeed: 60, featherFall } });
      await travelCampaignConnection(gm, actor, 'high-window');
      const remaining = session.status(actor).movement.remaining;
      const turn = session.turn;
      await travelCampaignConnection(gm, actor, 'high-window', { action: 'drop' });
      expect(adapter.isMovementInProgress(actor)).toBe(true);
      expect(actor.world.y).toBeGreaterThan(0);
      for (let frame = 0; frame < 6000 && adapter.isMovementInProgress(actor); frame++) {
        stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
        gm.advanceFrame();
        await Promise.resolve();
      }
      expect(adapter.isMovementInProgress(actor)).toBe(false);
      expect(actor.world.y).toBe(0);
      expect(actor.openingHold).toBeUndefined();
      expect(library.get(actor.characterSheetId)).toMatchObject({
        hp: { current: featherFall ? 40 : 36 },
        conditions: featherFall ? [] : ['prone'],
        lastFall: { distanceFeet: 17, damage: featherFall ? 0 : 4, dice: 1 },
        fallTraits: { flySpeed: 60, featherFall: false },
      });
      expect(diceSpy).toHaveBeenCalledTimes(featherFall ? 0 : 1);
      expect(session.status(actor).movement.remaining).toBe(remaining);
      expect(session.turn).toBe(turn);
      const saved = await captureCampaignScene(gm, library);
      expect(saved.creatures[0].pose.kind).toBe('ground');
    } finally {
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('climbing down preserves a partial hold and completes on a later turn without rebuilding the map', async () => {
  const { gm, actor, adapter, library, session } = await fixture();
  const character = library.get(actor.characterSheetId);
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    const geometry = gm.terrainEngine.geometry;
    await travelCampaignConnection(gm, actor, 'high-window', { action: 'down' });
    expect(actor.mapId).toBe('map-main');
    expect(actor.world.y).toBeCloseTo(1.5);
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(session.status(actor).movement.remaining).toBe(0);
    expect(gm.terrainEngine.geometry).toBe(geometry);
    session.endTurn();
    session.startTurn(actor);
    await travelCampaignConnection(gm, actor, 'high-window', { action: 'down' });
    expect(actor.world.y).toBe(0);
    expect(adapter.isWallAttached(actor)).toBe(false);
    adapter.resyncHeights();
    for (let frame = 0; frame < 12; frame++)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    const skins = [];
    adapter.getTokenVisual(actor).traverse((node) => {
      if (node.isSkinnedMesh) skins.push(node);
    });
    expect(humanoidBounds({ skins }).min.y).toBeCloseTo(0, 1);
    expect(session.status(actor).movement.remaining).toBe(10);
    expect(library.get(actor.characterSheetId)).toEqual(character);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a live high-window climb ends in a persistent animated hold without falling or refreshing the turn', async () => {
  const { gm, actor, adapter, library, session } = await fixture();
  const turn = session.turn;
  const character = library.get(actor.characterSheetId);
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    const held = { ...actor.world };
    adapter.resyncHeights();
    expect(actor.world).toEqual(held);
    const skins = [];
    adapter.getTokenVisual(actor).traverse((node) => {
      if (node.isSkinnedMesh) skins.push(node);
    });
    for (let frame = 0; frame < 12; frame++)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    const hands = skins[0].skeleton.bones.filter((bone) => /(LeftHand|RightHand)$/.test(bone.name));
    const gripY =
      hands.reduce((total, bone) => total + bone.getWorldPosition(new three.Vector3()).y, 0) /
      hands.length;
    expect(gripY).toBeCloseTo(actor.world.y + gm.spatial.tileWorldSize, 2);
    expect(humanoidBounds({ skins }).min.y).toBeLessThan(actor.world.y + 0.1);
    expect(humanoidBounds({ skins }).min.y).toBeGreaterThan(actor.world.y - 0.5);
    expect(actor.mapId).toBe('map-main');
    expect(actor.world.y).toBeCloseTo(3.4);
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(session.status(actor).movement.remaining).toBe(25);
    expect(session.turn).toBe(turn);
    expect(library.get(actor.characterSheetId)).toEqual(character);
    const saved = await captureCampaignScene(gm, library);
    expect(saved.creatures[0].pose.kind).toBe('ledge');
    expect(saved.creatures[0].pose.openingId).toBe('high-window');
    await changeCampaignView(gm, { mapId: 'high-floor' });
    await changeCampaignView(gm, { focusTokenId: actor.id });
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(actor.world.y).toBeCloseTo(3.4);
    expect(session.status(actor).movement.remaining).toBe(25);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a wall destination animates a held creature through intermediate positions and saves an independent grip', async () => {
  const { gm, actor, adapter, library, session } = await fixture();
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    const request = adapter.requestMoveToSurface(actor, {
      kind: 'wall',
      point: { x: 11, y: 3.8, z: 6.5 },
      normal: { x: -1, y: 0, z: 0 },
    });
    expect(request?.cost).toBe(10);
    expect(actor.world.y).toBeCloseTo(3.4);
    expect(adapter.isMovementInProgress(actor)).toBe(true);
    for (let frame = 0; frame < 12; frame++)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    const down = adapter._tokenAnimationData.get(actor).actions.climbWallDown;
    expect(down.time).toBeGreaterThan(0);
    const cycleFrames = Math.ceil(down.getClip().duration * 60);
    for (let frame = 0; frame < cycleFrames && actor.world.y >= 3.4 - 1e-5; frame++)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    expect(actor.world.y).toBeLessThan(3.4);
    expect(actor.world.y).toBeGreaterThan(2.8);
    expect(adapter._tokenAnimationData.get(actor).current).toBe('climbWallDown');
    for (let frame = 0; frame < 1800 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(actor.world.y).toBeCloseTo(2.8);
    expect(session.status(actor).movement.spent).toBe(10);
    const saved = await captureCampaignScene(gm, library);
    expect(saved.creatures[0].pose.kind).toBe('grip');
    await changeCampaignView(gm, { mapId: 'high-floor' });
    await changeCampaignView(gm, { focusTokenId: actor.id });
    expect(actor.world.y).toBeCloseTo(2.8);
    expect(adapter.isWallAttached(actor)).toBe(true);
    const offered = getConnectionTravelOption(gm, actor, 'high-window');
    expect(offered).toMatchObject({ allowed: true, costFeet: 15 });
    const towardsWindow = await travelCampaignConnection(gm, actor, 'high-window');
    expect(towardsWindow.costFeet).toBe(offered.costFeet);
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(session.status(actor).movement.spent).toBe(25);
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a native solid-wall click selects the clicked handhold rather than an unsupported grip five feet above it', async () => {
  const { gm, actor, adapter, session, library } = await fixture();
  let canvas, disposeTerrain, popup;
  try {
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    disposeTerrain = addPhysicalTerrain(gm);
    canvas = addPointerView(gm, new three.Vector3(11, 3.8, 8), new three.Vector3(5, 6, 9));
    const manager = new InteractionManager(gm);
    manager.setupMouseDown();
    popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
    expect(clickFeature(canvas).defaultPrevented).toBe(false);
    canvas.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        button: 0,
        clientX: 400,
        clientY: 300,
      })
    );
    for (let tick = 0; tick < 12; tick++) await Promise.resolve();
    expect(adapter.isMovementInProgress(actor)).toBe(true);
    expect(popup.root.hidden).toBe(true);
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      await Promise.resolve();
    }
    expect(actor.world.y).toBeCloseTo(2.8);
    expect(actor.world.z).toBeCloseTo(8);
    expect(session.status(actor).movement.spent).toBe(25);
    expect(adapter.isWallAttached(actor)).toBe(true);
    const saved = await captureCampaignScene(gm, library);
    expect(saved.creatures[0].pose.grip.pointFeet.y).toBeCloseTo(19);
  } finally {
    popup?.dispose();
    disposeTerrain?.();
    canvas?.remove();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test.each([
  ['up', 1, 3, 'climbWall'],
  ['down', 3.4, 1.4, 'climbWallDown'],
])(
  'the authored %s climbing cycle stays continuous across paid safe waypoints',
  async (_direction, startY, targetY, clip) => {
    const { gm, actor, adapter, session } = await fixture();
    try {
      await travelCampaignConnection(gm, actor, 'high-window');
      const world = { x: 10.8, y: startY, z: 5.4 };
      const grip = gm.campaignWorld.openingSurfaceGrip('map-main', world, 'high-window', {
        mapId: 'map-main',
        geometry: gm.terrainEngine.geometry,
      });
      await adapter.restoreStablePlacement(actor, {
        gridX: 10,
        gridY: 5,
        facingAngle: actor.facingAngle,
        pose: { kind: 'grip', world, grip },
      });
      session.endTurn();
      session.startTurn(actor);
      expect(
        adapter.requestMoveToSurface(actor, {
          point: { x: 11, y: targetY + 1, z: 5.4 },
          normal: { x: -1, y: 0, z: 0 },
        })?.cost
      ).toBe(20);
      const action = adapter._tokenAnimationData.get(actor).actions[clip];
      const duration = action.getClip().duration;
      const hands = new Map();
      adapter._rootBones.get(actor)[0].bone.traverse((bone) => {
        if (bone.isBone && /(LeftHand|RightHand)$/.test(bone.name) && !hands.has(bone.name))
          hands.set(bone.name, bone);
      });
      const positions = () =>
        [...hands.values()].map((bone) => bone.getWorldPosition(new three.Vector3()));
      let previousHands = positions(),
        largestBoundaryHandStep = 0;
      let previousTime = action.time,
        boundaries = 0,
        largestAdvance = 0;
      for (let frame = 0; frame < 3600 && adapter.isMovementInProgress(actor); frame++) {
        const before = adapter._movementRoutes.get(actor)?.index;
        stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
        gm.advanceFrame();
        await Promise.resolve();
        const advance = (action.time - previousTime + duration) % duration;
        largestAdvance = Math.max(largestAdvance, advance);
        const currentHands = positions();
        if (adapter._movementRoutes.get(actor)?.index > before) {
          boundaries++;
          largestBoundaryHandStep = Math.max(
            largestBoundaryHandStep,
            ...currentHands.map((position, index) => position.distanceTo(previousHands[index]))
          );
        }
        previousHands = currentHands;
        previousTime = action.time;
      }
      expect(boundaries).toBeGreaterThanOrEqual(3);
      expect(largestAdvance).toBeLessThanOrEqual(1 / 60 + 1e-5);
      expect(largestBoundaryHandStep).toBeLessThan(gm.spatial.tileWorldSize * 0.08);
      expect(actor.world.y).toBeCloseTo(targetY);
      expect(session.status(actor).movement.spent).toBe(20);
      const heldTime = action.time,
        heldHands = positions();
      session.endTurn();
      session.startTurn(actor);
      const continuationY = targetY + (_direction === 'up' ? 0.5 : -0.5);
      expect(
        adapter.requestMoveToSurface(actor, {
          point: { x: 11, y: continuationY + 1, z: 5.4 },
          normal: { x: -1, y: 0, z: 0 },
        })?.cost
      ).toBe(5);
      expect(action.time).toBeCloseTo(heldTime, 8);
      positions().forEach((position, index) =>
        expect(position.distanceTo(heldHands[index])).toBeLessThan(1e-6)
      );
      for (let frame = 0; frame < 1800 && adapter.isMovementInProgress(actor); frame++) {
        stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
        gm.advanceFrame();
        await Promise.resolve();
      }
      expect(actor.world.y).toBeCloseTo(continuationY);
      expect(session.status(actor).movement.spent).toBe(5);
      const pausedTime = action.time;
      expect(
        adapter.requestMoveToSurface(actor, {
          point: { x: 11, y: continuationY + 1, z: actor.world.z + 0.001 },
          normal: { x: -1, y: 0, z: 0 },
        })?.cost
      ).toBe(5);
      expect(adapter._tokenAnimationData.get(actor).current).toBe(clip);
      expect(action.time).toBeCloseTo(pausedTime, 8);
      for (let frame = 0; frame < 60 && adapter.isMovementInProgress(actor); frame++) {
        stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
        gm.advanceFrame();
        await Promise.resolve();
      }
      expect(adapter.isMovementInProgress(actor)).toBe(false);
      expect(session.status(actor).movement.spent).toBe(10);
    } finally {
      disposeConnectedTravelBoard(gm);
    }
  },
  60000
);

test('a confirmed vertical gap descent falls only across the real opening and re-grabs the wall below', async () => {
  const { gm, actor, adapter, library, session } = await fixture();
  try {
    const beginFall = jest.spyOn(gm.characterServices.falling, 'begin');
    await travelCampaignConnection(gm, actor, 'high-window');
    session.endTurn();
    session.startTurn(actor);
    const surface = { point: { x: 10.8, y: 2.4, z: 6.5 }, normal: { x: -1, y: 0, z: 0 } };
    expect(adapter.requestMoveToSurface(actor, surface)).toBeNull();
    expect(actor.world.y).toBeCloseTo(3.4);
    expect(adapter.requestClimbToSurface(actor, surface, { confirmGapDrops: true })?.cost).toBe(10);
    const phases = new Set();
    let sawIntermediateFall = false;
    for (let frame = 0; frame < 3000 && adapter.isMovementInProgress(actor); frame++) {
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
      gm.advanceFrame();
      const phase = adapter._movementStates.get(actor)?.phase;
      phases.add(phase);
      if (phase === 'fall' && actor.world.y < 2.4 && actor.world.y > 1.4)
        sawIntermediateFall = true;
      await Promise.resolve();
    }
    expect(sawIntermediateFall).toBe(true);
    expect(phases.has('surface-climb')).toBe(true);
    expect(actor.world.y).toBeCloseTo(1.4);
    expect(adapter.isMovementInProgress(actor)).toBe(false);
    expect(adapter.isWallAttached(actor)).toBe(true);
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 40 },
      conditions: [],
      lastFall: { damage: 0, prone: false },
    });
    expect(beginFall).toHaveBeenCalledTimes(1);
    expect(beginFall.mock.calls[0][1]).toBeCloseTo(5, 3);
    expect(library.get(actor.characterSheetId).lastFall.distanceFeet).toBeCloseTo(5, 3);
    expect(session.status(actor).movement.spent).toBe(10);
    expect((await captureCampaignScene(gm, library)).creatures[0].pose.kind).toBe('grip');
  } finally {
    disposeConnectedTravelBoard(gm);
  }
}, 60000);
import * as three from 'three';
import CampaignTraversalPopup from '../../../src/ui/campaigns/CampaignTraversalPopup.js';
