import { readFileSync } from 'node:fs';
import path from 'node:path';
import { preparePlayerApplication } from '../../../src/ui/sessions/PlayerApplication.js';
import {
  validatePlayerState,
  validatePlayerCommandResult,
} from '../../../src/campaigns/PlayerPublicProtocol.js';
import { validatePlayerCommand } from '../../../src/campaigns/PlayerCommandProtocol.js';
import PlayerCommandAdapter from '../../../src/ui/sessions/PlayerCommandAdapter.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { createPlayerAuthorityTable } from '../../helpers/playerAuthority.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';
import CampaignCharacters from '../../../src/campaigns/CampaignCharacters.js';
import CampaignAutosave from '../../../src/campaigns/CampaignAutosave.js';
import { decodeScene } from '../../../src/campaigns/CampaignScene.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import { connectCharacterServices } from '../../../src/ui/characters/characterServices.js';
import { attachHostSessionUpdates } from '../../../src/ui/sessions/HostSessionUpdates.js';
import { disposeConnectedTravelBoard } from '../../helpers/connectedTravelBoard.js';

test('the shared player entry requests the actual versioned authority projection and renders only assigned native actors', async () => {
  const table = await createPlayerAuthorityTable();
  let app;
  try {
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gameManager = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    expect(table.calls[0]).toEqual({
      operation: 'playerState',
      args: [{ presentationVersion: 1 }],
    });
    expect(validatePlayerState(app.state)).toBe(app.state);
    expect(gameManager.placedTokens.map(({ id }) => id)).toEqual(['token-1']);
    expect(gameManager.placedTokens[0].characterSheetId).toBe(table.characterId);
    expect(gameManager.characterServices.library.list()).toHaveLength(1);
    expect(JSON.stringify(app.state)).not.toContain('PRIVATE AUTHORITY FIXTURE NOTES');
    expect(gameManager.sceneAutosave).toBeUndefined();
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('a player-first completed move survives a stale DM scene-save attempt without an extra cost or pose overwrite', async () => {
  const table = await createPlayerAuthorityTable();
  try {
    const before = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const state = await table.connection.call('playerState', [{ presentationVersion: 1 }]);
    const adapter = new PlayerCommandAdapter({
      connection: table.connection,
      getState: () => state,
    });
    await adapter.move('token-1', { mapId: 'map-main', gridX: 2, gridY: 1 });
    const stale = JSON.parse(before.scene);
    stale.creatures[0].gridX = 3;
    stale.creatures[0].pose.world.x = 3.5;
    await expect(
      table.dm.connection.call('commitScene', [
        table.campaign.id,
        {
          ruleset: '2024',
          revision: before.sceneRevision,
          charactersRevision: before.revision,
          scene: JSON.stringify(stale),
        },
      ])
    ).rejects.toMatchObject({
      status: 409,
    });
    const current = await table.connection.call('playerState', [{ presentationVersion: 1 }]);
    expect(current.publicScene.actors[0].pose.world.x).toBe(2.5);
    expect(current.gameplay.ownedTokens[0].movement).toMatchObject({
      spentFeet: 5,
      remainingFeet: 25,
    });
  } finally {
    await table.close();
  }
}, 30000);

test('multiplayer regression: DM freeplay reaches real player input, sprite animation and fresh host budgets end to end', async () => {
  const table = await createPlayerAuthorityTable();
  const restoreFiles = installHumanoidAssetFiles();
  let milliseconds = 0;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => milliseconds);
  let app;
  try {
    const saved = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const scene = JSON.parse(saved.scene);
    scene.combat = { ...scene.combat, active: false, activeTokenId: null, states: [] };
    await table.dm.connection.call('commitScene', [
      table.campaign.id,
      {
        ruleset: '2024',
        revision: saved.sceneRevision,
        charactersRevision: saved.revision,
        scene: JSON.stringify(scene),
      },
    ]);
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gameManager = createCampaignBoard(null);
    delete gameManager.__threeTestDouble;
    gameManager.token3DAdapter.attach();
    app = await preparePlayerApplication({
      gameManager,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    gameManager.advanceFrame();
    const token = gameManager.placedTokens[0];
    const model = token.__threeMesh;
    expect(app.state.gameplay.turn).toBeNull();
    expect(app.input.movementAllowance(token)).toBe(30);
    for (const gridX of [2, 3]) {
      const moving = app.input.requestMove(token, { gridX, gridY: 1 });
      for (
        let check = 0;
        check < 100 && !gameManager.token3DAdapter.isMovementInProgress(token);
        check++
      )
        await new Promise((resolve) => setTimeout(resolve, 0));
      expect(gameManager.token3DAdapter.isMovementInProgress(token)).toBe(true);
      const origin = token.world.x;
      milliseconds += 100;
      gameManager.advanceFrame();
      expect(token.world.x).toBeGreaterThan(origin);
      expect(token.world.x).toBeLessThan(gridX + 0.5);
      for (
        let frame = 0;
        frame < 600 && gameManager.token3DAdapter.isMovementInProgress(token);
        frame++
      ) {
        milliseconds += 1000 / 120;
        gameManager.advanceFrame();
      }
      await moving;
      expect(token.__threeMesh).toBe(model);
      expect(token.world.x).toBe(gridX + 0.5);
      expect(app.input.movementBudget(token)).toEqual({
        spentFeet: 0,
        remainingFeet: 30,
        allowanceFeet: 30,
      });
    }
    const committed = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const canonical = JSON.parse(committed.scene);
    expect(canonical.creatures.find(({ id }) => id === token.id).gridX).toBe(3);
    expect(canonical.combat.active).toBe(false);
  } finally {
    if (app) await app.destroy();
    clock.mockRestore();
    restoreFiles();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('private restore fields in a real player projection are rejected before changing native actors or assigned records', async () => {
  const table = await createPlayerAuthorityTable();
  let app;
  try {
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gameManager = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const invalid = JSON.parse(JSON.stringify(app.state));
    invalid.publicScene.combat = { activeTokenId: 'private-hidden-token' };
    invalid.sceneRevision++;
    await expect(app.showState(invalid)).rejects.toThrow(/public|private/i);
    expect(gameManager.placedTokens).toEqual([]);
    expect(app.sheets.library.list()).toHaveLength(1);
    expect(app.state.sceneRevision).toBeLessThan(invalid.sceneRevision);
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test("multiplayer regression: native DM and player animate each other's real saved moves without echo saves or costs", async () => {
  const table = await createPlayerAuthorityTable({ liveUpdates: true });
  const restoreFiles = installHumanoidAssetFiles();
  let milliseconds = 0;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => milliseconds);
  let gameManager;
  let playerApp;
  let disposeUpdates;
  const parent = document.createElement('section');
  document.body.append(parent);
  try {
    const state = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const store = {
      identity: table.dm.identity,
      storageInfo: { kind: 'host' },
      readCharacters: (id) => table.dm.connection.call('readCharacters', [id]),
      commitCharacters: (id, changes) =>
        table.dm.connection.call('commitCharacters', [id, changes]),
      commitScene: (id, changes) => table.dm.connection.call('commitScene', [id, changes]),
      subscribeChanges: (listener) => table.dm.connection.subscribe(listener),
    };
    const library = new CampaignCharacters({ ...state, store, catalog: table.catalog });
    gameManager = createCampaignBoard(library);
    delete gameManager.__threeTestDouble;
    gameManager.characterServices = null;
    connectCharacterServices(gameManager, {
      library,
      catalog: new CompendiumCatalog(table.catalog),
    });
    gameManager.token3DAdapter.attach();
    const autosave = new CampaignAutosave({
      gameManager,
      library,
      combat: gameManager.characterServices.combat,
    });
    await autosave.start(decodeScene(state.scene, { ruleset: library.ruleset, library }));
    gameManager.advanceFrame();
    const token = gameManager.placedTokens[0];
    const model = token.__threeMesh;
    const camera = gameManager.threeSceneManager.snapshotView();
    disposeUpdates = attachHostSessionUpdates({
      gameManager,
      services: {
        campaign: library.campaign,
        library,
        autosave,
        workspace: { store },
      },
      parent,
    });
    for (let check = 0; check < 100 && !parent.textContent.includes('up to date'); check++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).toMatch(/up to date/);
    const playerState = await table.connection.call('playerState', [{ presentationVersion: 1 }]);
    const commands = new PlayerCommandAdapter({
      connection: table.connection,
      getState: () => playerState,
    });
    const moved = await commands.move('token-1', { mapId: 'map-main', gridX: 2, gridY: 1 });
    for (
      let check = 0;
      check < 100 && !gameManager.token3DAdapter.isMovementInProgress(token);
      check++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).not.toMatch(/conflict|reopen|invalid/i);
    expect(gameManager.token3DAdapter.isMovementInProgress(token)).toBe(true);
    expect(token.world.x).toBe(1.5);
    milliseconds += 100;
    gameManager.advanceFrame();
    expect(token.world.x).toBeGreaterThan(1.5);
    expect(token.world.x).toBeLessThan(2.5);
    for (
      let frame = 0;
      frame < 600 && gameManager.token3DAdapter.isMovementInProgress(token);
      frame++
    ) {
      milliseconds += 1000 / 120;
      gameManager.advanceFrame();
    }
    for (let check = 0; check < 100 && !parent.textContent.includes('up to date'); check++)
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(parent.textContent).toMatch(/up to date/);
    expect(token.__threeMesh).toBe(model);
    expect(token.world.x).toBe(2.5);
    expect(gameManager.threeSceneManager.snapshotView()).toEqual(camera);
    expect(autosave.dirty).toBe(false);
    const current = await store.readCharacters(table.campaign.id);
    expect(current.sceneRevision).toBe(moved.applied.sceneRevision);
    expect(JSON.parse(current.scene).creatures[0].pose.world.x).toBe(2.5);
    expect(gameManager.characterServices.combat.status(token).movement).toMatchObject({
      spent: 5,
      remaining: 25,
    });
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const playerManager = createCampaignBoard(null);
    delete playerManager.__threeTestDouble;
    playerManager.token3DAdapter.attach();
    playerApp = await preparePlayerApplication({
      gameManager: playerManager,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await playerApp.start();
    playerManager.advanceFrame();
    const playerToken = playerManager.placedTokens[0];
    const playerModel = playerToken.__threeMesh;
    const playerCamera = playerManager.threeSceneManager.snapshotView();
    expect(gameManager.token3DAdapter.requestMoveToGrid(token, 3, 1)).not.toBeNull();
    for (
      let frame = 0;
      frame < 600 && gameManager.token3DAdapter.isMovementInProgress(token);
      frame++
    ) {
      milliseconds += 1000 / 120;
      gameManager.advanceFrame();
      playerManager.advanceFrame();
      await Promise.resolve();
    }
    expect(token.world.x).toBe(3.5);
    await autosave.flush();
    for (
      let check = 0;
      check < 100 && !playerManager.token3DAdapter.isMovementInProgress(playerToken);
      check++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    expect(playerManager.token3DAdapter.isMovementInProgress(playerToken)).toBe(true);
    expect(playerToken.world.x).toBe(2.5);
    milliseconds += 100;
    playerManager.advanceFrame();
    expect(playerToken.world.x).toBeGreaterThan(2.5);
    expect(playerToken.world.x).toBeLessThan(3.5);
    for (
      let frame = 0;
      frame < 600 && playerManager.token3DAdapter.isMovementInProgress(playerToken);
      frame++
    ) {
      milliseconds += 1000 / 120;
      playerManager.advanceFrame();
    }
    await playerApp.refresh();
    expect(playerToken.__threeMesh).toBe(playerModel);
    expect(playerToken.world.x).toBe(3.5);
    expect(playerManager.threeSceneManager.snapshotView()).toEqual(playerCamera);
    expect(playerApp.input.movementBudget(playerToken)).toEqual({
      spentFeet: 10,
      remainingFeet: 20,
      allowanceFeet: 30,
    });
    const afterDM = await store.readCharacters(table.campaign.id);
    expect(afterDM.sceneRevision).toBe(playerApp.state.sceneRevision);
    expect(afterDM.sceneRevision).toBe(moved.applied.sceneRevision + 1);
    expect(autosave.dirty).toBe(false);
  } finally {
    try {
      if (playerApp) await playerApp.destroy();
      disposeUpdates?.();
      if (gameManager) disposeConnectedTravelBoard(gameManager);
    } finally {
      table.connection.close();
      table.dm.connection.close();
      clock.mockRestore();
      restoreFiles();
      parent.remove();
      document.body.replaceChildren();
      delete document.body.dataset.sessionRole;
      await table.close();
    }
  }
}, 30000);

test('a real validated intent cannot consume a receipt with an unauthorized FROM or mismatched approved route', async () => {
  const table = await createPlayerAuthorityTable();
  try {
    const state = await table.connection.call('playerState', [{ presentationVersion: 1 }]);
    let applied = false;
    const adapter = new PlayerCommandAdapter({
      getState: () => state,
      connection: {
        call: async (operation, [campaignId, command]) => {
          expect(validatePlayerCommand(command)).toBe(command);
          const result = await table.connection.call(operation, [campaignId, command]);
          expect(
            validatePlayerCommandResult(result, { cachedAssets: state.publicScene.assets })
          ).toBe(result);
          result.receipt.motion.from.mapId = 'private-unauthorized-map';
          return result;
        },
      },
      onReceipt: () => {
        applied = true;
      },
    });
    await expect(
      adapter.move('token-1', { mapId: 'map-main', gridX: 2, gridY: 1 })
    ).rejects.toThrow();
    expect(applied).toBe(false);
    expect(state.publicScene.actors[0].pose.world.x).toBe(1.5);
  } finally {
    await table.close();
  }
}, 30000);

test('a DM-first canonical commit rejects the stale player intent and refreshes its actual pose without replacing the native actor or camera', async () => {
  const table = await createPlayerAuthorityTable();
  let app;
  try {
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gameManager = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const actor = gameManager.placedTokens[0];
    const camera = gameManager.threeSceneManager.snapshotView();
    const saved = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const scene = JSON.parse(saved.scene);
    scene.creatures[0].gridX = 3;
    scene.creatures[0].pose.world.x = 3.5;
    await table.dm.connection.call('commitScene', [
      table.campaign.id,
      {
        ruleset: '2024',
        revision: saved.sceneRevision,
        charactersRevision: saved.revision,
        scene: JSON.stringify(scene),
      },
    ]);
    await expect(app.input.requestMove(actor, { gridX: 2, gridY: 1 })).rejects.toMatchObject({
      status: 409,
      code: 'stale-revision',
    });
    expect(gameManager.placedTokens[0]).toBe(actor);
    expect(actor.world.x).toBe(3.5);
    expect(gameManager.threeSceneManager.snapshotView()).toBe(camera);
    expect(app.input.movementBudget(actor).spentFeet).toBe(0);
    expect(app.state.sceneRevision).toBeGreaterThan(saved.sceneRevision);
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);
