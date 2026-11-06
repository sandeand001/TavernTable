import * as three from 'three';
import {
  addPhysicalTerrain,
  addPointerView,
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';
import { createCurvedStructuresScene } from '../../../src/campaigns/examples/CurvedStructuresExample.js';
import { captureCampaignScene } from '../../../src/campaigns/SceneWorld.js';
import { encodeScene, decodeScene } from '../../../src/campaigns/CampaignScene.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function realBoard(options = {}) {
  const gm = await createConnectedTravelBoard({
    sceneFactory: createCurvedStructuresScene,
    ...options,
  });
  try {
    const actor = gm.placedTokens[0];
    for (const npc of [...gm.placedTokens].slice(1)) gm.tokenManager.removeToken(npc);
    delete gm.__threeTestDouble;
    gm.token3DAdapter.releaseTokenVisual(actor);
    await gm.token3DAdapter.onTokenAdded(actor);
    await actor.__threeMeshPromise;
    return gm;
  } catch (error) {
    disposeConnectedTravelBoard(gm);
    throw error;
  }
}

async function finishMotion(gm, actor, observe = () => {}) {
  const adapter = gm.token3DAdapter;
  for (
    let frame = 0;
    frame < 2400 && (adapter.isMovementInProgress(actor) || gm.campaignViewBusy);
    frame++
  ) {
    stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    await observe();
    gm.advanceFrame();
    await Promise.resolve();
    if (frame % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  gm.advanceFrame();
  expect(adapter.isMovementInProgress(actor)).toBe(false);
  expect(gm.campaignViewBusy).not.toBe(true);
}

test('a real animated creature walks through the curved tunnel, pays normal movement and reopens on the same cave floor', async () => {
  let gm;
  let reopened;
  try {
    gm = await realBoard();
    const actor = gm.placedTokens[0];
    const library = gm.characterServices.library;
    const combat = gm.characterServices.combat;
    combat.startTurn(actor);
    const result = gm.token3DAdapter.requestMoveToGrid(actor, 6, 9);
    expect(result.cost).toBe(30);
    await finishMotion(gm, actor);
    expect(actor.world).toEqual({ x: 6.5, y: 0, z: 9.5 });
    expect(combat.status(actor).movement.spent).toBe(30);
    const placement = gm.token3DAdapter.getStablePlacement(actor);
    expect(placement.pose).toMatchObject({ kind: 'ground', surfaceId: expect.any(String) });
    const saved = await captureCampaignScene(gm, library, { combat });
    expect(saved.maps[0].terrain.geometry.version).toBe(2);
    const decoded = decodeScene(encodeScene(saved, { ruleset: '2014', library }), {
      ruleset: '2014',
      library,
    });
    disposeConnectedTravelBoard(gm);
    gm = null;
    reopened = await createConnectedTravelBoard({ library, scene: decoded });
    const restored = reopened.placedTokens[0];
    expect(restored.world).toEqual({ x: 6.5, y: 0, z: 9.5 });
    expect(reopened.token3DAdapter.getStablePlacement(restored).pose.surfaceId).toBe(
      placement.pose.surfaceId
    );
    expect(reopened.characterServices.combat.status(restored).movement.spent).toBe(30);
  } finally {
    if (gm) disposeConnectedTravelBoard(gm);
    if (reopened) disposeConnectedTravelBoard(reopened);
  }
}, 60000);

test('a multi-step real animated route keeps safe checkpoints but writes the scene only once after the action completes', async () => {
  const store = new CampaignStore({
    indexedDB: testIndexedDB(),
    packs: [{ id: 'srd-2014', ruleset: '2014', version: '5.1', core: true }],
  });
  const catalog = {
    ...classic,
    entries: classic.entries.map((entry) => ({ ...entry, sourcePack: 'srd-2014' })),
    enabledEntryIds: classic.entries.map((entry) => entry.id),
  };
  let gm;
  try {
    const campaign = await store.create({ name: 'Completed curved actions', ruleset: '2014' });
    const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    gm = await realBoard({ library });
    const actor = gm.placedTokens[0];
    const adapter = gm.token3DAdapter;
    const combat = gm.characterServices.combat;
    const autosave = new CampaignAutosave({ gameManager: gm, library, combat });
    await autosave.start();
    const enqueues = jest.spyOn(library, 'saveScene');
    const writes = jest.spyOn(store, 'commitScene');
    combat.startTurn(actor);
    expect(adapter.requestMoveToGrid(actor, 6, 9).cost).toBe(30);
    let previous = 15.5;
    let checkpoints = 0;
    await finishMotion(gm, actor, async () => {
      if (!adapter.isMovementInProgress(actor)) return;
      const stable = adapter.getStablePlacement(actor);
      if (stable.pose.world.z === previous) return;
      previous = stable.pose.world.z;
      checkpoints++;
      await new Promise((resolve) => setTimeout(resolve, 350));
      expect(enqueues).not.toHaveBeenCalled();
      expect(writes).not.toHaveBeenCalled();
      expect(autosave.status).toMatchObject({
        state: 'saving',
        text: expect.stringMatching(/action.*finish/i),
      });
    });
    expect(checkpoints).toBeGreaterThanOrEqual(4);
    await autosave.flush();
    expect(writes).toHaveBeenCalledTimes(1);
    expect(actor.world).toEqual({ x: 6.5, y: 0, z: 9.5 });
    const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    const saved = decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened });
    expect(saved.creatures[0].pose.world).toEqual(actor.world);
    expect(saved.combat.states[0].movementSpent).toBe(30);
    expect(autosave.status.state).toBe('saved');
  } finally {
    if (gm) disposeConnectedTravelBoard(gm);
    store.close();
  }
}, 60000);

test('a flyer lands on the actual curved roof, walks over its crown and can take off again', async () => {
  let gm;
  let removeTerrain;
  let canvas;
  try {
    gm = await realBoard({ position: { x: 19.5, y: 0, z: 11.5 } });
    const actor = gm.placedTokens[0];
    const adapter = gm.token3DAdapter;
    await gm.characterServices.library.edit(actor.characterSheetId, {
      hp: { current: 20, max: 20 },
      fallTraits: { flySpeed: 60 },
    });
    await adapter.applyFlightCommand(actor, 'takeoff');
    await finishMotion(gm, actor);
    await adapter.applyFlightCommand(actor, 'raise', 15);
    await finishMotion(gm, actor);
    expect(adapter.requestMoveToGrid(actor, 19, 6).cost).toBe(25);
    await finishMotion(gm, actor);
    await adapter.applyFlightCommand(actor, 'drop');
    await finishMotion(gm, actor);
    const landed = actor.world.y;
    expect(landed).toBeGreaterThan(2.8);
    expect(landed).toBeLessThan(3);
    expect(adapter.getStablePlacement(actor).pose.kind).toBe('ground');
    expect(gm.characterServices.combat.freeMovementAllowance(actor)).toBeGreaterThanOrEqual(5);
    expect(adapter.getFlightCommandAvailability(actor, 'takeoff')).toMatchObject({ allowed: true });
    expect(adapter.getTokenSurfaceRange(actor).tiles.size).toBeGreaterThan(1);
    removeTerrain = addPhysicalTerrain(gm);
    const height = gm.terrainEngine.geometry.findSupport(93, 28, { belowFeet: 20 }).heightFeet / 5;
    canvas = addPointerView(
      gm,
      new three.Vector3(18.6, height, 5.6),
      new three.Vector3(18.6, 10, 5.7)
    );
    const picked = gm.pickingService.pickGroundSync(400, 300, canvas);
    expect(picked.surface.surfaceId).toBe('curved-dome-roof');
    expect(adapter.requestMoveToSurface(actor, picked.surface).cost).toBe(5);
    let peak = landed;
    await finishMotion(gm, actor, () => {
      peak = Math.max(peak, actor.world.y);
      const support = gm.terrainEngine.geometry.findSupport(actor.world.x * 5, actor.world.z * 5, {
        belowFeet: 20,
      });
      expect(actor.world.y).toBeCloseTo(support.heightFeet / 5, 5);
    });
    expect(peak).toBeGreaterThan(landed + 0.02);
    const grounded = actor.world.y;
    await adapter.applyFlightCommand(actor, 'takeoff');
    await finishMotion(gm, actor);
    expect(actor.world.y).toBeCloseTo(grounded + 1);
    expect(adapter.getStablePlacement(actor).pose.kind).toBe('flight');
    expect(gm.characterServices.library.get(actor.characterSheetId).hp.current).toBe(20);
  } finally {
    removeTerrain?.();
    canvas?.remove();
    if (gm) disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('real flight moves normally inside a dome but cannot raise through its hidden curved ceiling', async () => {
  let gm;
  try {
    gm = await realBoard({ position: { x: 19.5, y: 0, z: 6.5 } });
    const actor = gm.placedTokens[0];
    const adapter = gm.token3DAdapter;
    const library = gm.characterServices.library;
    await library.edit(actor.characterSheetId, {
      hp: { current: 20, max: 20 },
      fallTraits: { flySpeed: 60 },
    });
    gm.characterServices.combat.startTurn(actor);
    gm.terrainEngine.setVisibleLayers(['ground', 'dome']);
    await adapter.applyFlightCommand(actor, 'takeoff');
    await finishMotion(gm, actor);
    expect(actor.world.y).toBeCloseTo(1);
    await expect(adapter.applyFlightCommand(actor, 'raise', 5)).rejects.toThrow(/clearance/);
    expect(gm.characterServices.combat.status(actor).movement.spent).toBe(5);
    expect(adapter.requestMoveToGrid(actor, 18, 5).cost).toBe(5);
    await finishMotion(gm, actor);
    expect(actor.world).toEqual({ x: 18.5, y: 1, z: 5.5 });
    expect(adapter.requestMoveToGrid(actor, 15, 2)).toBeNull();
    await adapter.applyFlightCommand(actor, 'drop');
    await finishMotion(gm, actor);
    expect(actor.world.y).toBe(0);
    expect(adapter.getStablePlacement(actor).pose.kind).toBe('ground');
    expect(gm.characterServices.combat.status(actor).movement.spent).toBe(10);
    expect(library.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 20 },
      conditions: [],
    });
  } finally {
    if (gm) disposeConnectedTravelBoard(gm);
  }
}, 60000);
