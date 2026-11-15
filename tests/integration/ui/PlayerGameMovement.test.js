import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlayerGameApplication from '../../../src/ui/sessions/PlayerGameApplication.js';
import { publicPlayerState } from '../../helpers/publicPlayerState.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';
import { sceneState } from '../../helpers/sceneState.js';
import {
  executePlayerCommand,
  playerCommandReceipt,
} from '../../../src/campaigns/ServerGameplay.js';

let restoreFiles;
beforeAll(() => {
  restoreFiles = installHumanoidAssetFiles();
});
afterAll(() => restoreFiles());

async function fixture({ cloud = false, coverWall = false } = {}) {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const { state, source, catalog } = publicPlayerState();
  if (coverWall) state.publicScene.assets.maps[0].terrain.heights[1][2] = 4;
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
    kind: cloud ? 'cloud-player' : undefined,
    phase: 'ready',
    readLiveState: () => JSON.parse(JSON.stringify(fetched)),
    acknowledgeState: jest.fn(),
    subscribe: (listener) => {
      notice = listener;
      return () => {};
    },
    close: () => {},
    call: jest.fn(async (operation, [, command]) => {
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
    }),
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
    connection,
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

test('a cloud player renders a live cosmetic action and its own receipt echo never restarts the native clip', async () => {
  const f = await fixture({ cloud: true });
  try {
    const token = f.gm.placedTokens[0];
    const model = token.__threeMesh;
    const before = JSON.parse(JSON.stringify(f.app.state));
    const state = JSON.parse(JSON.stringify(before));
    state.sceneRevision++;
    const commandId = '00000000-0000-4000-8000-000000000501';
    const actor = state.publicScene.actors[0];
    const visual = {
      commandId,
      tokenId: token.id,
      kind: 'emote',
      actionId: 'action-wave',
      animationKey: 'actionWave',
      sceneRevision: state.sceneRevision,
      charactersRevision: state.revision,
      placement: {
        mapId: actor.mapId,
        gridX: actor.gridX,
        gridY: actor.gridY,
        facingAngle: actor.facingAngle,
        pose: actor.pose,
      },
    };
    state.publicScene.updates = [visual];
    f.setFetched(state);
    f.notify({ type: 'state', state, generation: 2, reconcile: false });
    const data = f.gm.token3DAdapter._tokenAnimationData.get(token);
    for (let check = 0; check < 100 && data.current !== 'actionWave'; check++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(data.current).toBe('actionWave');
    f.tick(0.25);
    const time = data.actions.actionWave.time;
    const acknowledged = JSON.parse(JSON.stringify(state));
    acknowledged.publicScene.updates = [];
    const receipt = {
      version: 1,
      commandId,
      outcome: 'applied',
      applied: { sceneRevision: state.sceneRevision, charactersRevision: state.revision },
      receipt: {
        kind: 'emote',
        tokenId: token.id,
        actionId: 'action-wave',
        animationKey: 'actionWave',
      },
      state: acknowledged,
    };
    await f.app.receiveReceipt(receipt, {
      animate: true,
      command: { commandId, tokenId: token.id, observerTokenId: token.id, kind: 'emote' },
    });
    f.tick(0.1);
    expect(data.current).toBe('actionWave');
    expect(data.actions.actionWave.time).toBeGreaterThan(time);
    expect(token.__threeMesh).toBe(model);
    expect(token.world).toEqual(before.publicScene.actors[0].pose.world);
    expect(f.app.state.gameplay.ownedTokens[0].economy).toEqual(
      before.gameplay.ownedTokens[0].economy
    );
    expect(f.app.state.gameplay.ownedTokens[0].movement).toEqual(
      before.gameplay.ownedTokens[0].movement
    );
  } finally {
    await f.cleanup();
  }
});

test('a cloud player receipt echo cannot interrupt or restart an already streaming authoritative Cover', async () => {
  const f = await fixture({ cloud: true, coverWall: true });
  try {
    const token = f.gm.placedTokens[0];
    const before = JSON.parse(JSON.stringify(f.app.state));
    const actor = before.publicScene.actors[0];
    const scene = sceneState({ characterId: actor.characterId, name: actor.name });
    scene.creatures[0].id = actor.id;
    scene.selection = actor.id;
    scene.terrain = JSON.parse(JSON.stringify(before.publicScene.assets.maps[0].terrain));
    const accepted = await executePlayerCommand(
      scene,
      f.gm.characterServices.library,
      {
        kind: 'emote',
        tokenId: actor.id,
        payload: { actionId: 'action-cover' },
      },
      { ownedIds: [actor.characterId] }
    );
    const native = playerCommandReceipt(accepted, scene, f.gm.characterServices.library);
    const from = { ...native.from, mapId: actor.mapId };
    const placement = { ...native.placement, mapId: actor.mapId };
    const commandId = '00000000-0000-4000-8000-000000000502';
    const state = JSON.parse(JSON.stringify(before));
    state.sceneRevision++;
    Object.assign(state.publicScene.actors[0], {
      pose: placement.pose,
      facingAngle: placement.facingAngle,
    });
    state.publicScene.updates = [
      {
        commandId,
        tokenId: actor.id,
        kind: 'emote',
        actionId: 'action-cover',
        animationKey: native.animationKey,
        from,
        placement,
        sceneRevision: state.sceneRevision,
        charactersRevision: state.revision,
      },
    ];
    f.setFetched(state);
    f.notify({ type: 'state', state, generation: 2, reconcile: false });
    for (let check = 0; check < 100 && !f.gm.token3DAdapter.isMovementInProgress(token); check++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
    for (let frame = 0; frame < 60; frame++) f.tick(1 / 120);
    expect(token.world.x).toBeGreaterThan(from.pose.world.x);
    expect(token.world.x).toBeLessThan(placement.pose.world.x);
    const moving = { ...token.world };
    const acknowledged = JSON.parse(JSON.stringify(state));
    acknowledged.publicScene.updates = [];
    await f.app.receiveReceipt(
      {
        version: 1,
        commandId,
        outcome: 'applied',
        applied: { sceneRevision: state.sceneRevision, charactersRevision: state.revision },
        receipt: { ...native, from, placement },
        state: acknowledged,
      },
      {
        animate: true,
        command: { commandId, tokenId: actor.id, observerTokenId: actor.id, kind: 'emote' },
      }
    );
    expect(token.world).toEqual(moving);
    for (let frame = 0; frame < 3000 && f.gm.token3DAdapter.isMovementInProgress(token); frame++)
      f.tick(1 / 120);
    expect(token.world).toEqual(placement.pose.world);
    expect(token.facingAngle).toBe(placement.facingAngle);
    expect(f.app.state.gameplay.ownedTokens[0].movement).toEqual(
      before.gameplay.ownedTokens[0].movement
    );
    expect(f.app.state.gameplay.ownedTokens[0].economy).toEqual(
      before.gameplay.ownedTokens[0].economy
    );
  } finally {
    await f.cleanup();
  }
}, 30000);

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

test('a cloud player receiving its own route before the HTTP receipt animates exactly once and keeps one authoritative movement cost', async () => {
  const { app, gm, connection, state, tick, notify, cleanup } = await fixture({ cloud: true });
  const play = jest.spyOn(gm.token3DAdapter, 'playApprovedMovement');
  const originalCall = connection.call.getMockImplementation();
  connection.call.mockImplementation(async (operation, args) => {
    const result = await originalCall(operation, args);
    if (operation === 'playerCommand') {
      const { tokenId, kind, costFeet, budget, motion } = result.receipt;
      state.publicScene.updates = [
        {
          commandId: result.commandId,
          tokenId,
          kind,
          costFeet,
          budget,
          motion,
          sceneRevision: result.applied.sceneRevision,
          charactersRevision: result.applied.charactersRevision,
        },
      ];
      notify({ type: 'state', state, generation: 2, reconcile: false });
    }
    return result;
  });
  try {
    const token = gm.placedTokens[0];
    const model = token.__threeMesh;
    const moving = app.input.requestMove(token, { gridX: 2, gridY: 1 });
    for (let check = 0; check < 100 && !gm.token3DAdapter.isMovementInProgress(token); check++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
    tick(0.1);
    expect(token.world.x).toBeGreaterThan(1.5);
    expect(token.world.x).toBeLessThan(2.5);
    for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(token); frame++)
      tick(1 / 120);
    await moving;
    expect(play).toHaveBeenCalledTimes(1);
    expect(token.__threeMesh).toBe(model);
    expect(token.world.x).toBe(2.5);
    expect(app.input.movementBudget(token).spentFeet).toBe(5);
    expect(
      connection.call.mock.calls.filter(([operation]) => operation === 'playerCommand')
    ).toHaveLength(1);
    expect(
      connection.call.mock.calls.filter(([operation]) => operation === 'playerState')
    ).toHaveLength(0);
  } finally {
    play.mockRestore();
    await cleanup();
  }
});

test.each(['walk', 'run'])(
  'a cloud receiving player animates a streamed %s route without an HTTP scene refresh or another movement charge',
  async (pace) => {
    const { app, gm, connection, state, tick, notify, cleanup } = await fixture({ cloud: true });
    try {
      const token = gm.placedTokens[0];
      const model = token.__threeMesh;
      state.publicScene.actors[0].movement.mode = pace;
      state.publicScene.updates = [
        {
          commandId: `cloud-shared-${pace}-0001`,
          tokenId: token.id,
          kind: 'move',
          sceneRevision: state.sceneRevision,
          charactersRevision: state.revision,
          costFeet: 5,
          budget: { movementSpentFeet: 5, movementRemainingFeet: 25, movementAllowanceFeet: 30 },
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
                mapId: 'main',
                gridX: 2,
                gridY: 1,
                facingAngle: Math.PI / 2,
                pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
              },
            ],
          },
        },
      ];
      notify({ type: 'state', state, generation: 2, reconcile: false });
      for (let check = 0; check < 100 && !gm.token3DAdapter.isMovementInProgress(token); check++)
        await new Promise((resolve) => setTimeout(resolve, 0));
      expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(true);
      expect(token.world.x).toBe(1.5);
      tick(0.1);
      expect(token.world.x).toBeGreaterThan(1.5);
      expect(token.world.x).toBeLessThan(2.5);
      for (let frame = 0; frame < 600 && gm.token3DAdapter.isMovementInProgress(token); frame++)
        tick(1 / 120);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(token.__threeMesh).toBe(model);
      expect(token.world.x).toBe(2.5);
      expect(app.input.movementBudget(token).spentFeet).toBe(5);
      expect(gm.characterServices.combat).toBeNull();
      expect(
        connection.call.mock.calls.filter(([operation]) => operation === 'playerState')
      ).toHaveLength(0);
    } finally {
      await cleanup();
    }
  }
);

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

test.each([false, true])(
  'a newer authorized scene notice replaces obsolete walking without replay (cloud %s)',
  async (cloud) => {
    const { app, gm, connection, tick, cleanup, state, notify, setFetched } = await fixture({
      cloud,
    });
    try {
      const token = gm.placedTokens[0];
      const camera = gm.threeSceneManager.snapshotView();
      const moving = app.input.requestMove(token, { gridX: 2, gridY: 1 });
      await new Promise((resolve) => setTimeout(resolve, 0));
      tick(0.1);
      const newer = JSON.parse(JSON.stringify(state));
      newer.sceneRevision++;
      newer.publicScene.actors[0].gridX = 4;
      newer.publicScene.actors[0].pose.world.x = 4.5;
      newer.gameplay.ownedTokens[0].movement = {
        spentFeet: 10,
        remainingFeet: 20,
        allowanceFeet: 30,
      };
      setFetched(newer);
      notify(
        cloud
          ? { type: 'state', state: newer, generation: 3, reconcile: true }
          : {
              type: 'campaign',
              version: 1,
              campaignId: state.campaign.id,
              kind: 'playerCommand',
              sceneRevision: newer.sceneRevision,
              charactersRevision: newer.revision,
            }
      );
      expect(gm.token3DAdapter.isMovementInProgress(token)).toBe(false);
      await moving;
      if (cloud) {
        for (let check = 0; check < 100 && token.world.x !== 4.5; check++)
          await new Promise((resolve) => setTimeout(resolve, 0));
        expect(
          connection.call.mock.calls.filter(([operation]) => operation === 'playerState')
        ).toHaveLength(0);
      } else await app.refresh();
      expect(gm.placedTokens[0]).toBe(token);
      expect(token.world.x).toBe(4.5);
      expect(gm.threeSceneManager.snapshotView()).toBe(camera);
      expect(app.input.movementBudget(token).spentFeet).toBe(10);
    } finally {
      await cleanup();
    }
  }
);
