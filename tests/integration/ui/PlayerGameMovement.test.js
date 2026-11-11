import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlayerGameApplication from '../../../src/ui/sessions/PlayerGameApplication.js';
import { publicPlayerState } from '../../helpers/publicPlayerState.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture() {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const { state, source, catalog } = publicPlayerState();
  const gm = createCampaignBoard(source);
  delete gm.__threeTestDouble;
  let milliseconds = 0;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => milliseconds);
  gm.token3DAdapter.attach();
  const accepted = JSON.parse(JSON.stringify(state));
  accepted.sceneRevision++;
  accepted.publicScene.assets = null;
  accepted.publicScene.actors[0].gridX = 2;
  accepted.publicScene.actors[0].pose.world.x = 2.5;
  accepted.publicScene.actors[0].facingAngle = Math.PI / 2;
  accepted.gameplay.ownedTokens[0].movement = {
    spentFeet: 5,
    remainingFeet: 25,
    allowanceFeet: 30,
  };
  const from = {
    mapId: 'main',
    gridX: 1,
    gridY: 1,
    facingAngle: 0,
    pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
  };
  const placement = {
    mapId: 'main',
    gridX: 2,
    gridY: 1,
    facingAngle: Math.PI / 2,
    pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
  };
  let notice;
  let fetched = accepted;
  const connection = {
    subscribe: (listener) => {
      notice = listener;
      return () => {};
    },
    close: () => {},
    call: async (operation, [, command]) => {
      if (operation === 'playerState') return fetched;
      expect(operation).toBe('playerCommand');
      return {
        version: 1,
        commandId: command.commandId,
        outcome: 'applied',
        applied: { sceneRevision: 2, charactersRevision: 1 },
        receipt: {
          kind: 'move',
          tokenId: 'canonical-scout',
          costFeet: 5,
          budget: { movementSpentFeet: 5, movementRemainingFeet: 25, movementAllowanceFeet: 30 },
          placement,
          route: [placement],
          motion: { kind: 'walk', completed: true, from, route: [placement] },
        },
        state: accepted,
      };
    },
  };
  const app = new PlayerGameApplication({
    gameManager: gm,
    connection,
    identity: { role: 'player' },
    catalog,
    initialState: state,
  });
  await app.start();
  gm.advanceFrame();
  return {
    app,
    gm,
    state: accepted,
    notify: (event) => notice(event),
    setFetched: (state) => {
      fetched = state;
    },
    tick: (seconds) => {
      milliseconds += seconds * 1000;
      gm.advanceFrame();
    },
    cleanup: async () => {
      await app.destroy();
      clock.mockRestore();
      document.body.replaceChildren();
      delete document.body.dataset.sessionRole;
    },
  };
}

test('accepted player movement interpolates the actual animated sprite and displays only the host-approved budget', async () => {
  const { app, gm, tick, cleanup } = await fixture();
  const token = gm.placedTokens[0];
  const model = token.__threeMesh;
  let skinned = false;
  model.traverse((object) => {
    if (object.isSkinnedMesh) skinned = true;
  });
  expect(skinned).toBe(true);
  const moving = app.input.requestMove(token, { gridX: 2, gridY: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
  expect(token.world.x).toBe(1.5);
  tick(0.1);
  expect(token.world.x).toBeGreaterThan(1.5);
  expect(token.world.x).toBeLessThan(2.5);
  for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(token); frame++) {
    tick(1 / 120);
  }
  await moving;
  expect(token.__threeMesh).toBe(model);
  expect(token.world).toEqual({ x: 2.5, y: 0, z: 1.5 });
  expect(app.input.movementAllowance(token)).toBe(25);
  expect(gm.characterServices.combat).toBeNull();
  await cleanup();
});

test.each(['walk', 'run'])(
  'multiplayer regression: a receiving player animates a shared %s route instead of teleporting',
  async (pace) => {
    const { app, gm, state, tick, notify, cleanup } = await fixture();
    try {
      const token = gm.placedTokens[0];
      const model = token.__threeMesh;
      const actor = state.publicScene.actors[0];
      actor.movement.mode = pace;
      state.publicScene.updates = [
        {
          commandId: `shared-${pace}-0001`,
          tokenId: actor.id,
          kind: 'move',
          sceneRevision: state.sceneRevision,
          charactersRevision: state.revision,
          costFeet: 5,
          budget: {
            movementSpentFeet: 5,
            movementRemainingFeet: 25,
            movementAllowanceFeet: 30,
          },
          motion: {
            kind: 'walk',
            completed: true,
            from: {
              mapId: 'main',
              gridX: 1,
              gridY: 1,
              facingAngle: 0,
              pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
            },
            route: [
              {
                mapId: actor.mapId,
                gridX: actor.gridX,
                gridY: actor.gridY,
                facingAngle: actor.facingAngle,
                pose: actor.pose,
              },
            ],
          },
        },
      ];
      notify({
        type: 'campaign',
        version: 1,
        campaignId: state.campaign.id,
        kind: 'playerCommand',
        sceneRevision: state.sceneRevision,
        charactersRevision: state.revision,
      });
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
      expect(token.world.x).toBe(1.5);
      tick(0.1);
      expect(token.world.x).toBeGreaterThan(1.5);
      expect(token.world.x).toBeLessThan(2.5);
      for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(token); frame++)
        tick(1 / 120);
      await app.refresh();
      expect(token.__threeMesh).toBe(model);
      expect(token.world.x).toBe(2.5);
      expect(app.input.movementBudget(token).spentFeet).toBe(5);
    } finally {
      await cleanup();
    }
  }
);

test('multiplayer regression: a player renders another visible creature moving without gaining control or spending their own movement', async () => {
  const { app, gm, tick, notify, setFetched, cleanup } = await fixture();
  try {
    const initial = JSON.parse(JSON.stringify(app.state));
    initial.publicScene.actors.push({
      ...initial.publicScene.actors[0],
      id: 'visible-companion',
      name: 'Visible companion',
      characterId: null,
      owned: false,
      gridX: 3,
      pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
    });
    await app.showState(initial);
    const own = gm.placedTokens.find(({ owned }) => owned);
    const remote = gm.placedTokens.find(({ id }) => id === 'visible-companion');
    const model = remote.__threeMesh;
    const camera = gm.threeSceneManager.snapshotView();
    const updated = JSON.parse(JSON.stringify(initial));
    updated.sceneRevision++;
    const actor = updated.publicScene.actors[1];
    actor.gridX = 2;
    actor.pose.world.x = 2.5;
    actor.movement.mode = 'run';
    updated.publicScene.updates = [
      {
        commandId: 'remote-companion-0001',
        tokenId: actor.id,
        kind: 'move',
        sceneRevision: updated.sceneRevision,
        charactersRevision: updated.revision,
        motion: {
          kind: 'walk',
          completed: true,
          from: {
            mapId: 'main',
            gridX: 3,
            gridY: 1,
            facingAngle: 0,
            pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
          },
          route: [
            {
              mapId: actor.mapId,
              gridX: actor.gridX,
              gridY: actor.gridY,
              facingAngle: actor.facingAngle,
              pose: actor.pose,
            },
          ],
        },
      },
    ];
    setFetched(updated);
    notify({
      type: 'campaign',
      version: 1,
      campaignId: updated.campaign.id,
      kind: 'commitScene',
      hasPresentations: true,
      sceneRevision: updated.sceneRevision,
      charactersRevision: updated.revision,
    });
    for (let check = 0; check < 100 && !gm.token3DAdapter.isMovementInProgress(remote); check++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gm.token3DAdapter.isMovementInProgress(remote)).toBe(true);
    expect(remote.world.x).toBe(3.5);
    tick(0.05);
    expect(remote.world.x).toBeGreaterThan(2.5);
    expect(remote.world.x).toBeLessThan(3.5);
    for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(remote); frame++)
      tick(1 / 120);
    await app.refresh();
    expect(remote.__threeMesh).toBe(model);
    expect(remote.world.x).toBe(2.5);
    expect(own.world.x).toBe(1.5);
    expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
    expect(app.input.movementBudget(own).spentFeet).toBe(0);
    await expect(app.input.requestMove(remote, { gridX: 3, gridY: 1 })).rejects.toMatchObject({
      code: 'active-assigned-character-required',
    });
  } finally {
    await cleanup();
  }
});

test('a live refetch during acknowledged walking reconciles at its completed checkpoint without snapping the sprite or resetting the camera', async () => {
  const { app, gm, tick, cleanup } = await fixture();
  const token = gm.placedTokens[0];
  const camera = { ...gm.threeSceneManager.snapshotView(), zoom: 1.7 };
  gm.threeSceneManager.restoreView(camera);
  const moving = app.input.requestMove(token, { gridX: 2, gridY: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  tick(0.1);
  const beforeRefresh = { ...token.world };
  const refreshed = app.refresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(token.world).toEqual(beforeRefresh);
  for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(token); frame++)
    tick(1 / 120);
  await moving;
  await refreshed;
  expect(token.world).toEqual({ x: 2.5, y: 0, z: 1.5 });
  expect(gm.threeSceneManager.snapshotView()).toEqual(camera);
  expect(app.input.movementAllowance(token)).toBe(25);
  await cleanup();
});

test('a newer authorized scene notice replaces old visual walking rather than replaying its obsolete destination', async () => {
  const { app, gm, tick, cleanup, state, notify, setFetched } = await fixture();
  const token = gm.placedTokens[0];
  const camera = gm.threeSceneManager.snapshotView();
  const moving = app.input.requestMove(token, { gridX: 2, gridY: 1 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  tick(0.1);
  const newer = JSON.parse(JSON.stringify(state));
  newer.sceneRevision++;
  newer.publicScene.actors[0].gridX = 4;
  newer.publicScene.actors[0].pose.world.x = 4.5;
  newer.gameplay.ownedTokens[0].movement = { spentFeet: 10, remainingFeet: 20, allowanceFeet: 30 };
  setFetched(newer);
  notify({
    type: 'campaign',
    version: 1,
    campaignId: state.campaign.id,
    kind: 'playerCommand',
    sceneRevision: newer.sceneRevision,
    charactersRevision: newer.revision,
  });
  expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(false);
  await moving;
  await app.refresh();
  expect(gm.placedTokens[0]).toBe(token);
  expect(token.world.x).toBe(4.5);
  expect(gm.threeSceneManager.snapshotView()).toBe(camera);
  expect(app.input.movementBudget(token).spentFeet).toBe(10);
  await cleanup();
});
