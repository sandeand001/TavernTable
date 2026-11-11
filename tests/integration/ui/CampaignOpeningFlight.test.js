import * as three from 'three';
import CampaignTraversalPopup from '../../../src/ui/campaigns/CampaignTraversalPopup.js';
import {
  addPointerView,
  clickFeature,
  createConnectedTravelBoard,
  disposeConnectedTravelBoard,
} from '../../helpers/connectedTravelBoard.js';
import { installHumanoidAssetFiles, stepHumanoid } from '../../helpers/humanoid-fixture.js';
import CampaignStore from '../../../src/campaigns/CampaignStore.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import classic from '../../../assets/data/resources/srd-2014-5.1-seed.1.json';
import * as dice from '../../../src/systems/dice/dice.js';
import { createOpeningsTravelScene } from '../../../src/campaigns/examples/ConnectedOpeningsExample.js';
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

async function advanceUntil(gm, actor, complete) {
  const adapter = gm.token3DAdapter;
  for (let frame = 0; frame < 1200 && !complete(); frame++) {
    if (!gm.campaignViewBusy || gm.campaignFallSettling)
      stepHumanoid({ adapter, token: actor, mesh: adapter.getTokenVisual(actor) }, 1 / 60);
    gm.advanceFrame();
    await Promise.resolve();
    if (frame % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
  }
  gm.advanceFrame();
  expect(complete()).toBe(true);
}

async function finishMotion(gm, actor) {
  const adapter = gm.token3DAdapter;
  await advanceUntil(gm, actor, () => !adapter.isMovementInProgress(actor) && !gm.campaignViewBusy);
  expect(adapter.isMovementInProgress(actor)).toBe(false);
  expect(gm.campaignViewBusy).not.toBe(true);
}

test('a rejected wall-catch save keeps a valid source hold and retries damage plus the caught grip atomically', async () => {
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
    const campaign = await store.create({ name: 'Persistent gap catch', ruleset: '2014' });
    const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    gm = await createConnectedTravelBoard({ library, sceneFactory: createOpeningsTravelScene });
    const actor = gm.placedTokens[0];
    for (const npc of [...gm.placedTokens].slice(1)) gm.tokenManager.removeToken(npc);
    delete gm.__threeTestDouble;
    const adapter = gm.token3DAdapter;
    adapter.releaseTokenVisual(actor);
    await adapter.onTokenAdded(actor);
    await actor.__threeMeshPromise;
    await library.edit(actor.characterSheetId, { hp: { max: 40, current: 40 } });
    gm.terrainEngine.geometry.carve({
      id: 'persistent-catch-gap',
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
      facingAngle: 0,
      pose: { kind: 'grip', world, grip },
    });
    const session = gm.characterServices.combat;
    gm.campaignView.showMap('upper-floor');
    await adapter.setSelectedToken(actor);
    expect(gm.campaignView.focusTokenId).toBe(actor.id);
    const autosave = new CampaignAutosave({ gameManager: gm, library, combat: session });
    await autosave.start();
    session.startTurn(actor);
    await autosave.flush();
    const commit = jest
      .spyOn(store, 'commitCharacters')
      .mockRejectedValueOnce(new Error('Catch storage unavailable'));
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
    const retry = () =>
      [...document.querySelectorAll('[role="dialog"] button')].find(
        (button) => button.textContent === 'Retry fall resolution'
      );
    await advanceUntil(gm, actor, () => !!retry());
    expect(retry().closest('[role="dialog"]').textContent).toContain('Catch storage unavailable');
    const paused = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    const safe = decodeScene(paused.savedScene, { ruleset: '2014', library: paused });
    expect(safe.creatures[0].pose.kind).toBe('grip');
    expect(safe.creatures[0].pose.world.y).toBeGreaterThanOrEqual(3);
    expect(paused.get(actor.characterSheetId).hp.current).toBe(40);
    retry().click();
    await finishMotion(gm, actor);
    await autosave.flush();
    const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
    const saved = decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened });
    expect(saved.creatures[0].pose.kind).toBe('grip');
    expect(saved.creatures[0].pose.world.y).toBeCloseTo(1);
    expect(reopened.get(actor.characterSheetId)).toMatchObject({
      hp: { current: 36 },
      conditions: [],
      lastFall: { damage: 4, prone: false },
    });
    expect(session.status(actor).movement.spent).toBe(10);
    expect(diceSpy).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(2);
  } finally {
    if (gm) disposeConnectedTravelBoard(gm);
    store.close();
  }
}, 60000);

test.each([
  ['successful save', false],
  ['retry after a rejected landing save', true],
])(
  'dropping through an upper-floor hole commits damage and the actual lower-map landing together: %s',
  async (_label, failFirstSave) => {
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
      const campaign = await store.create({ name: 'Physical cross-floor fall', ruleset: '2014' });
      const library = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
      gm = await createConnectedTravelBoard({
        library,
        mapId: 'upper-floor',
        position: { x: 6.5, y: 0, z: 4.5 },
      });
      const actor = gm.placedTokens[0];
      for (const npc of [...gm.placedTokens].slice(1)) gm.tokenManager.removeToken(npc);
      delete gm.__threeTestDouble;
      const adapter = gm.token3DAdapter;
      adapter.releaseTokenVisual(actor);
      await adapter.onTokenAdded(actor);
      await actor.__threeMeshPromise;
      await library.edit(actor.characterSheetId, {
        hp: { max: 40, current: 40 },
        fallTraits: { flySpeed: 60 },
      });
      await adapter.restoreStablePlacement(actor, {
        gridX: 6,
        gridY: 8,
        facingAngle: 0,
        pose: { kind: 'flight', world: { x: 6.5, y: 0.4, z: 8.5 } },
      });
      const session = gm.characterServices.combat;
      const autosave = new CampaignAutosave({ gameManager: gm, library, combat: session });
      await autosave.start();
      session.startTurn(actor);
      const turn = session.turn;
      await autosave.flush();
      const commit = failFirstSave
        ? jest
            .spyOn(store, 'commitCharacters')
            .mockRejectedValueOnce(new Error('Landing storage full'))
        : null;
      await adapter.applyFlightCommand(actor, 'drop');
      if (failFirstSave) {
        const retryButton = () =>
          [...document.querySelectorAll('[role="dialog"] button')].find(
            (button) => button.textContent === 'Retry fall resolution'
          );
        await advanceUntil(gm, actor, () => !!retryButton());
        expect(retryButton().closest('[role="dialog"]').textContent).toContain(
          'Landing storage full'
        );
        expect(actor.mapId).toBe('upper-floor');
        expect(library.get(actor.characterSheetId).hp.current).toBe(40);
        const paused = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
        const checkpoint = decodeScene(paused.savedScene, { ruleset: '2014', library: paused });
        expect(checkpoint.creatures[0]).toMatchObject({
          mapId: 'upper-floor',
          pose: { kind: 'flight', world: { y: 0.4 } },
        });
        expect(paused.get(actor.characterSheetId).hp.current).toBe(40);
        retryButton().click();
      }
      await finishMotion(gm, actor);
      if (commit) expect(commit).toHaveBeenCalledTimes(2);
      expect(diceSpy).toHaveBeenCalledTimes(1);
      expect(actor.mapId).toBe('ground-floor');
      expect(actor.world).toEqual({ x: 6.5, y: 0, z: 8.5 });
      expect(gm.campaignMapId).toBe('ground-floor');
      expect(session.turn).toBe(turn);
      expect(session.status(actor).movement.spent).toBe(0);
      expect(library.get(actor.characterSheetId)).toMatchObject({
        hp: { current: 36 },
        conditions: ['prone'],
        lastFall: { distanceFeet: 12, damage: 4 },
      });
      await autosave.flush();
      const reopened = await CampaignCharacters.open({ store, campaignId: campaign.id, catalog });
      const saved = decodeScene(reopened.savedScene, { ruleset: '2014', library: reopened });
      expect(saved.creatures[0].mapId).toBe('ground-floor');
      expect(saved.creatures[0].pose.kind).toBe('ground');
      expect(saved.view.mapId).toBe('ground-floor');
      expect(saved.view.focusTokenId).toBe(actor.id);
      expect(reopened.get(actor.characterSheetId).hp.current).toBe(36);
      expect(session.history(actor)).toHaveLength(1);
    } finally {
      if (gm) disposeConnectedTravelBoard(gm);
      store.close();
    }
  },
  60000
);

test('a flying character aligns with a doorway and confirms Fly through without landing', async () => {
  const gm = await createConnectedTravelBoard();
  const actor = gm.placedTokens[0];
  for (const npc of [...gm.placedTokens].slice(1)) gm.tokenManager.removeToken(npc);
  delete gm.__threeTestDouble;
  const adapter = gm.token3DAdapter;
  adapter.releaseTokenVisual(actor);
  await adapter.onTokenAdded(actor);
  await actor.__threeMeshPromise;
  await gm.characterServices.library.edit(actor.characterSheetId, { fallTraits: { flySpeed: 60 } });
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  const turn = session.turn;
  await adapter.applyFlightCommand(actor, 'takeoff');
  await finishMotion(gm, actor);
  const canvas = addPointerView(
    gm,
    new three.Vector3(11.1, 1.2, 10.9),
    new three.Vector3(5, 4, 11.5)
  );
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    expect(session.status(actor).movement.remaining).toBe(55);
    clickFeature(canvas);
    expect(adapter.isMovementInProgress(actor)).toBe(true);
    await finishMotion(gm, actor);
    await popup.ready;
    expect(actor.world.y).toBeCloseTo(0.4);
    expect(session.status(actor).movement.remaining).toBeCloseTo(52);
    expect(popup.root.hidden).toBe(false);
    expect(popup.confirm.textContent).toBe('Fly through (5 ft)');
    popup.confirm.click();
    await popup.ready;
    expect(actor.mapId).toBe('ground-floor');
    expect(actor.flightActive).toBe(true);
    expect(actor.world.y).toBeCloseTo(0.4);
    expect(session.status(actor).movement.remaining).toBeCloseTo(47);
    expect(session.turn).toBe(turn);
    expect(gm.token3DAdapter.getSelectedToken()).toBe(actor);
  } finally {
    popup.dispose();
    canvas.remove();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);

test('a sprite-selected flyer follows a window crossing without character-sheet focus', async () => {
  const gm = await createConnectedTravelBoard({ sceneFactory: createOpeningsTravelScene });
  const actor = gm.placedTokens[0];
  for (const npc of [...gm.placedTokens].slice(1)) gm.tokenManager.removeToken(npc);
  delete gm.__threeTestDouble;
  const adapter = gm.token3DAdapter;
  adapter.releaseTokenVisual(actor);
  await adapter.onTokenAdded(actor);
  await actor.__threeMeshPromise;
  await gm.characterServices.library.edit(actor.characterSheetId, { fallTraits: { flySpeed: 60 } });
  gm.campaignView.showMap('map-main');
  await adapter.setSelectedToken(null);
  new InteractionManager(gm)._selectTokenEntry(actor);
  for (let tick = 0; tick < 12; tick++) await Promise.resolve();
  const session = gm.characterServices.combat;
  session.startTurn(actor);
  const turn = session.turn;
  await adapter.applyFlightCommand(actor, 'takeoff');
  await finishMotion(gm, actor);
  const canvas = addPointerView(gm, new three.Vector3(11.1, 2.8, 6.5), new three.Vector3(5, 5, 7));
  const popup = new CampaignTraversalPopup({ gameManager: gm }).attach();
  try {
    expect(adapter.getSelectedToken()).toBe(actor);
    expect(gm.campaignView.focusTokenId).toBe(actor.id);
    clickFeature(canvas);
    await finishMotion(gm, actor);
    await popup.ready;
    expect(popup.confirm.textContent).toBe('Fly through (5 ft)');
    const spent = session.status(actor).movement.spent;
    popup.confirm.click();
    await popup.ready;
    expect(actor.mapId).toBe('upper-floor');
    expect(gm.campaignMapId).toBe('upper-floor');
    expect(gm.campaignView.focusTokenId).toBe(actor.id);
    expect(adapter.getSelectedToken()).toBe(actor);
    expect(actor.flightActive).toBe(true);
    expect(actor.world.y).toBeCloseTo(0.4);
    expect(session.status(actor).movement.spent).toBe(spent + 5);
    expect(session.turn).toBe(turn);
  } finally {
    popup.dispose();
    canvas.remove();
    disposeConnectedTravelBoard(gm);
  }
}, 60000);
