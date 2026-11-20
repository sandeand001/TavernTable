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
import { gameplayRuntime, playerGameplayState } from '../../../src/campaigns/ServerGameplay.js';
import RadialMenu from '../../../src/ui/components/RadialMenu.js';
import CampaignWorld from '../../../src/campaigns/CampaignWorld.js';
import { TerrainGeometry } from '../../../src/terrain/TerrainGeometry.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import { connectCharacterServices } from '../../../src/ui/characters/characterServices.js';
import { attachHostSessionUpdates } from '../../../src/ui/sessions/HostSessionUpdates.js';
import { disposeConnectedTravelBoard } from '../../helpers/connectedTravelBoard.js';

const WAIT_TIMEOUT_MS = 10000;

async function waitForCondition(condition, message) {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

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

test('nine overlapping player commands commit independent intents without waiting for other animations', async () => {
  const table = await createPlayerAuthorityTable({ activeTurn: false, playerCount: 9 });
  try {
    const before = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const states = await Promise.all(
      table.players.map(({ connection }) =>
        connection.call('playerState', [{ presentationVersion: 1 }])
      )
    );
    const acknowledgementMs = [];
    const outcomes = await Promise.allSettled(
      table.players.map(async ({ connection, tokenId }, index) => {
        const startedAt = performance.now();
        const receipt = await new PlayerCommandAdapter({
          connection,
          getState: () => states[index],
        }).move(tokenId, { mapId: 'map-main', gridX: index + 1, gridY: 2 });
        acknowledgementMs.push(performance.now() - startedAt);
        return receipt;
      })
    );
    expect(
      outcomes.map((result) => (result.status === 'fulfilled' ? 'applied' : result.reason.code))
    ).toEqual(Array(table.players.length).fill('applied'));
    const orderedAcknowledgements = acknowledgementMs.sort((left, right) => left - right);
    expect(
      orderedAcknowledgements[Math.max(0, Math.ceil(orderedAcknowledgements.length * 0.95) - 1)]
    ).toBeLessThanOrEqual(2000);
    const committed = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const scene = JSON.parse(committed.scene);
    expect(committed.sceneRevision).toBe(before.sceneRevision + table.players.length);
    for (let index = 0; index < table.players.length; index++)
      expect(scene.creatures.find(({ id }) => id === `token-${index + 1}`)).toMatchObject({
        gridY: 2,
        pose: { kind: 'ground', world: { x: index + 1.5, z: 2.5 } },
      });
  } finally {
    await table.close();
  }
}, 30000);

test('an overlapping command that changed the same assigned actor remains a stale conflict', async () => {
  const table = await createPlayerAuthorityTable({ activeTurn: false });
  try {
    const state = await table.connection.call('playerState', [{ presentationVersion: 1 }]);
    const outcomes = await Promise.allSettled(
      [2, 3].map((gridX) =>
        new PlayerCommandAdapter({
          connection: table.connection,
          getState: () => state,
        }).move('token-1', { mapId: 'map-main', gridX, gridY: 1 })
      )
    );
    expect(outcomes.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find(({ status }) => status === 'rejected');
    expect(rejected.reason).toMatchObject({ status: 409, code: 'stale-revision' });
    const committed = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    expect(committed.sceneRevision).toBe(state.sceneRevision + 1);
  } finally {
    await table.close();
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
      await waitForCondition(
        () => gameManager.token3DAdapter.isMovementInProgress(token),
        'The accepted player movement did not start'
      );
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

test('real player action controls spend an offered Dash once and display the canonical action and movement budget', async () => {
  const table = await createPlayerAuthorityTable();
  let app;
  try {
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gm = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager: gm,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const token = gm.placedTokens[0];
    expect(app.input.availableActions(token).some((action) => action.id === 'dash')).toBe(true);
    const accepted = await app.input.useAction(token, 'dash');
    expect(accepted.outcome).toBe('applied');
    const own = app.state.gameplay.ownedTokens.find((actor) => actor.tokenId === token.id);
    expect(own.economy.actions).toBe(0);
    expect(own.movement).toEqual({ spentFeet: 0, remainingFeet: 60, allowanceFeet: 60 });
    expect(app.input.availableActions(token).some((action) => action.id === 'dash')).toBe(false);
    const committed = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const stored = playerGameplayState(JSON.parse(committed.scene), gm.characterServices.library, [
      table.characterId,
    ]).ownedTokens.find((actor) => actor.tokenId === token.id);
    expect(stored.economy.actions).toBe(0);
    expect(stored.movement).toEqual({ spentFeet: 0, remainingFeet: 60, allowanceFeet: 60 });
    expect(table.calls.filter((call) => call.operation === 'playerCommand')).toHaveLength(1);
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('real player facing and movement preferences remain available between turns without altering base Speed or budgets', async () => {
  const table = await createPlayerAuthorityTable();
  let app;
  try {
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gm = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager: gm,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const token = gm.placedTokens[0];
    await app.input.endTurn(token);
    expect(app.commands.availability('move', token.id).allowed).toBe(false);
    const before = JSON.parse(JSON.stringify(app.state.gameplay.ownedTokens[0]));
    const records = (await table.dm.connection.call('readCharacters', [table.campaign.id])).records;
    await app.input.requestFacing(token, Math.PI / 2);
    await app.input.setMovementSettings(token, { mode: 'run', type: 'drunk' });
    const actor = app.state.publicScene.actors.find((actor) => actor.id === token.id);
    expect(actor.facingAngle).toBe(Math.PI / 2);
    expect(actor.movement).toEqual({ mode: 'run', type: 'drunk' });
    const own = app.state.gameplay.ownedTokens.find((actor) => actor.tokenId === token.id);
    expect(own.economy).toEqual(before.economy);
    expect(own.movement).toEqual(before.movement);
    expect(app.sheets.library.get(table.characterId).speed).toBe(30);
    const saved = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    expect(saved.records).toEqual(records);
    expect(JSON.parse(saved.scene).creatures.find((actor) => actor.id === token.id)).toMatchObject({
      facingAngle: Math.PI / 2,
      movement: { mode: 'run', type: 'drunk' },
    });
    expect(
      table.calls
        .filter((call) => call.operation === 'playerCommand')
        .map((call) => call.args[1].kind)
    ).toEqual(['turn.end', 'facing', 'movement.settings']);
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('real player flight radial honors a scene-granted Fly speed, affordable elevation and no-cost off-turn Drop', async () => {
  const table = await createPlayerAuthorityTable({
    characterUpdates: { classId: 'wizard', level: 5 },
    spells: ['spell:fly'],
  });
  const restoreFiles = installHumanoidAssetFiles();
  let milliseconds = 0;
  const clock = jest.spyOn(performance, 'now').mockImplementation(() => milliseconds);
  let app;
  let menu;
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(true);
  try {
    const saved = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const library = new CampaignCharacters({ ...saved, catalog: table.catalog });
    const spellId = library.get(table.characterId).spells[0].id;
    await table.connection.call('playerCommand', [
      table.campaign.id,
      {
        version: 1,
        commandId: crypto.randomUUID(),
        sceneRevision: saved.sceneRevision,
        charactersRevision: saved.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind: 'action.use',
        payload: {
          actionId: `spell:${spellId}`,
          choice: { slotLevel: 3 },
          targeting: { targets: [{ tokenId: 'token-1', count: 1 }], willingConfirmed: true },
        },
      },
    ]);
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gm = createCampaignBoard(null);
    delete gm.__threeTestDouble;
    gm.token3DAdapter.attach();
    app = await preparePlayerApplication({
      gameManager: gm,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const token = gm.placedTokens[0];
    expect(app.sheets.library.get(table.characterId).fallTraits.flySpeed).toBe(0);
    const model = token.__threeMesh;
    menu = new RadialMenu().attach();
    let submitted;
    menu.onAction(({ actionId }) => {
      submitted = app.input.applyRadial(token, actionId).then(
        (receipt) => ({ receipt }),
        (error) => ({ error })
      );
    });
    const show = () => {
      submitted = null;
      menu.setActionAvailability(app.input.radialAvailability(token));
      menu.show({ token, screenX: 400, screenY: 300 });
    };
    const finish = async () => {
      expect(submitted).not.toBeNull();
      let animated = false;
      const deadline = Date.now() + WAIT_TIMEOUT_MS;
      while (app.commands.pending && Date.now() < deadline) {
        const beforeY = token.world.y;
        milliseconds += 1000 / 60;
        gm.advanceFrame(1 / 60);
        if (token.world.y !== beforeY && gm.token3DAdapter.isMovementInProgress(token))
          animated = true;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      expect(app.commands.pending).toBe(false);
      const outcome = await submitted;
      if (outcome.error) throw outcome.error;
      expect(outcome.receipt.outcome).toBe('applied');
      expect(animated).toBe(true);
      expect(token.__threeMesh).toBe(model);
    };
    show();
    const takeoff = menu.root.querySelector('path[data-action-id="take-flight"]');
    expect(takeoff).not.toBeNull();
    expect(takeoff.getAttribute('aria-disabled')).not.toBe('true');
    takeoff.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await finish();
    expect(app.state.gameplay.ownedTokens[0].movement).toEqual({
      spentFeet: 5,
      remainingFeet: 55,
      allowanceFeet: 60,
    });
    for (const kind of ['raise', 'lower']) {
      show();
      menu.root
        .querySelector(`path[data-action-id="flight-${kind}"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      menu.root
        .querySelector(`path[data-sub-action-id="flight-${kind}-20"]`)
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await finish();
    }
    expect(app.state.gameplay.ownedTokens[0].movement).toEqual({
      spentFeet: 45,
      remainingFeet: 15,
      allowanceFeet: 60,
    });
    show();
    menu.root
      .querySelector('path[data-action-id="flight-raise"]')
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(
      menu.root
        .querySelector('path[data-sub-action-id="flight-raise-20"]')
        .getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      menu.root
        .querySelector('path[data-sub-action-id="flight-raise-15"]')
        .getAttribute('aria-disabled')
    ).not.toBe('true');
    await app.input.endTurn(token);
    const beforeDrop = structuredClone(app.state.gameplay.ownedTokens[0].economy);
    show();
    expect(
      menu.root.querySelector('path[data-action-id="flight-raise"]').getAttribute('aria-disabled')
    ).toBe('true');
    const drop = menu.root.querySelector('path[data-action-id="flight-drop"]');
    expect(drop.getAttribute('aria-disabled')).not.toBe('true');
    drop.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await finish();
    expect(app.state.publicScene.actors.find((actor) => actor.id === token.id).pose).toMatchObject({
      kind: 'ground',
      world: { y: 0 },
    });
    expect(app.state.gameplay.ownedTokens[0].movement.spentFeet).toBe(45);
    expect(app.state.gameplay.ownedTokens[0].economy).toEqual(beforeDrop);
    expect(app.sheets.library.get(table.characterId).concentration).toBe(spellId);
    show();
    expect(
      menu.root.querySelector('path[data-action-id="take-flight"]').getAttribute('aria-disabled')
    ).toBe('true');
    expect(
      table.calls
        .filter((call) => call.operation === 'playerCommand')
        .map((call) => call.args[1].kind)
    ).toEqual([
      'action.use',
      'flight.takeoff',
      'flight.raise',
      'flight.lower',
      'turn.end',
      'flight.drop',
    ]);
  } finally {
    menu?.hide();
    menu?.root.remove();
    confirm.mockRestore();
    if (app) await app.destroy();
    clock.mockRestore();
    restoreFiles();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('real player dice buttons work between turns and display the server-recorded result without spending budgets', async () => {
  const table = await createPlayerAuthorityTable();
  let app;
  try {
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gm = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager: gm,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const token = gm.placedTokens[0];
    await app.input.endTurn(token);
    const before = structuredClone(app.state.gameplay.ownedTokens[0]);
    const dice = document.querySelector('[data-dice][data-sides="6"]');
    expect(dice.disabled).toBe(false);
    document.querySelector('[data-dice-count]').value = '1';
    dice.click();
    await app.commands.idle;
    const own = app.state.gameplay.ownedTokens[0];
    expect(own.economy).toEqual(before.economy);
    expect(own.movement).toEqual(before.movement);
    const saved = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const native = gameplayRuntime(JSON.parse(saved.scene), gm.characterServices.library);
    const history = native.combat.history(native.actors.find((actor) => actor.id === token.id));
    expect(history).toHaveLength(1);
    expect(history[0].expression).toBe('1d6');
    expect(history[0].rollResult.total).toBeGreaterThanOrEqual(1);
    expect(history[0].rollResult.total).toBeLessThanOrEqual(6);
    expect(app.controls.diceResult.textContent).toBe(history[0].rollText);
    expect(
      table.calls
        .filter((call) => call.operation === 'playerCommand')
        .map((call) => call.args[1].kind)
    ).toEqual(['turn.end', 'roll']);
    expect(gm.characterServices.combat).toBeNull();
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test.each([
  { mode: 'crawling at the entrance', prone: true, startX: 4, spent: 10, commands: ['traverse'] },
  {
    mode: 'walking up before entering',
    prone: false,
    startX: 2,
    spent: 15,
    commands: ['move', 'traverse'],
  },
  {
    mode: 'dismissing the offer during approach',
    prone: false,
    startX: 2,
    spent: 10,
    commands: ['move'],
    cancel: true,
  },
  {
    mode: 'flying through a non-five-foot opening elevation',
    prone: false,
    flying: true,
    startX: 2,
    spent: 19,
    commands: ['move', 'traverse'],
  },
  {
    mode: 'using only the last flying feet without crossing',
    prone: false,
    flying: true,
    exhausted: true,
    startX: 2,
    spent: 60,
    commands: ['move'],
  },
])(
  'the real player traversal popup uses native costs and server authority for $mode',
  async ({ prone, startX, spent, commands, cancel = false, flying = false, exhausted = false }) => {
    const table = await createPlayerAuthorityTable({
      characterUpdates: {
        conditions: prone ? ['prone'] : [],
        ...(flying ? { fallTraits: { flySpeed: 60, hover: true } } : {}),
      },
    });
    const restoreFiles = installHumanoidAssetFiles();
    let milliseconds = 0;
    const clock = jest.spyOn(performance, 'now').mockImplementation(() => milliseconds);
    let app;
    try {
      const saved = await table.dm.connection.call('readCharacters', [table.campaign.id]);
      const library = new CampaignCharacters({ ...saved, catalog: table.catalog });
      const geometry = new TerrainGeometry({
        widthFeet: 25,
        depthFeet: 25,
        getTerrainHeightFeet: () => 0,
      });
      geometry.addSolid({
        id: 'door-wall',
        bounds: { min: { x: 24, y: 0, z: 0 }, max: { x: 25, y: 10, z: 25 } },
      });
      geometry.carve({
        id: 'door-cut',
        bounds: { min: { x: 24, y: 0, z: 10 }, max: { x: 25, y: 6, z: 15 } },
      });
      const scene = JSON.parse(saved.scene);
      scene.version = 2;
      scene.terrain.geometry = geometry.save();
      Object.assign(scene.creatures[0], {
        gridX: startX,
        gridY: 2,
        pose: {
          kind: flying ? 'flight' : 'ground',
          world: { x: startX + 0.5, y: flying ? 1 : 0, z: 2.5 },
        },
      });
      if (exhausted) {
        const native = gameplayRuntime(scene, library);
        const actor = native.actors.find((actor) => actor.id === 'token-1');
        const ticket = native.combat.beginConnectionMovement(actor, 58, 'fly');
        native.combat.finishMovement(ticket, 58);
        scene.combat = native.combat.snapshot();
      }
      const world = CampaignWorld.fromScene(scene, { ruleset: '2024', library });
      world.addMap({
        id: 'inside',
        name: 'Inside',
        originFeet: { x: 25, y: 0, z: 0 },
        quarterTurns: 0,
        base: 'ground',
        grid: scene.grid,
        terrain: { ...scene.terrain, geometry: { version: 1, volumes: [] } },
      });
      world.addConnection({
        id: 'doorway',
        name: 'Doorway',
        kind: 'door',
        open: true,
        ends: [
          { mapId: 'map-main', positionFeet: { x: 22.5, y: 0, z: 12.5 } },
          { mapId: 'inside', positionFeet: { x: 2.5, y: 0, z: 12.5 } },
        ],
        feature: { mapId: 'map-main', volumeIds: ['door-cut'] },
        pathFeet: [],
      });
      await table.dm.connection.call('commitScene', [
        table.campaign.id,
        {
          ruleset: '2024',
          revision: saved.sceneRevision,
          charactersRevision: saved.revision,
          scene: JSON.stringify(world.save()),
        },
      ]);
      const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
      document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
      const gm = createCampaignBoard(null);
      delete gm.__threeTestDouble;
      gm.token3DAdapter.attach();
      app = await preparePlayerApplication({
        gameManager: gm,
        connection: table.connection,
        identity: { role: 'player' },
        resources: { catalog: async () => table.catalog, close() {} },
      });
      await app.start();
      const token = gm.placedTokens[0];
      const popup = app.traversalPopup;
      expect(popup).toBeDefined();
      popup.open('doorway', {}, token);
      if (cancel)
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      let approachSettled = false;
      const approaching = popup.ready.then((value) => {
        approachSettled = true;
        return value;
      });
      const approachDeadline = Date.now() + WAIT_TIMEOUT_MS;
      while (!approachSettled && Date.now() < approachDeadline) {
        milliseconds += 1000 / 60;
        gm.advanceFrame(1 / 60);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!approachSettled) throw new Error('The traversal approach did not settle');
      const offered = await approaching;
      if (cancel || exhausted) {
        expect(offered).toBe(false);
        expect(popup.root.hidden).toBe(true);
        expect(token.mapId).toBe('map-main');
        expect(token.world.x).toBe(exhausted ? 2.5 : 4.5);
        expect(token.world.y).toBeCloseTo(exhausted ? 0.6 : 0, 6);
        expect(token.world.z).toBe(2.5);
        expect(app.state.gameplay.ownedTokens[0].movement.spentFeet).toBe(spent);
        expect(
          table.calls
            .filter((call) => call.operation === 'playerCommand')
            .map((call) => call.args[1].kind)
        ).toEqual(commands);
        return;
      }
      expect(popup.root.hidden).toBe(false);
      expect(popup.confirm.disabled).toBe(false);
      expect(popup.confirm.textContent).toContain(`(${prone || flying ? 10 : 5} ft)`);
      expect(popup.root.querySelector('[data-door-action="lock"]')).toBeNull();
      popup.confirm.click();
      let crossingSettled = false;
      const crossing = popup.ready.then((value) => {
        crossingSettled = true;
        return value;
      });
      const crossingDeadline = Date.now() + WAIT_TIMEOUT_MS;
      while (!crossingSettled && Date.now() < crossingDeadline) {
        milliseconds += 1000 / 60;
        gm.advanceFrame(1 / 60);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      if (!crossingSettled) throw new Error('The traversal crossing did not settle');
      expect(await crossing).toMatchObject({ outcome: 'applied' });
      expect(popup.root.hidden).toBe(true);
      expect(app.state.publicScene.actors.find((actor) => actor.id === token.id)).toMatchObject({
        mapId: 'inside',
        gridX: 0,
        gridY: 2,
      });
      expect(app.state.gameplay.ownedTokens[0].movement).toEqual({
        spentFeet: spent,
        remainingFeet: (flying ? 60 : 30) - spent,
        allowanceFeet: flying ? 60 : 30,
      });
      if (flying) {
        expect(token.flightActive).toBe(true);
        expect(token.world.y).toBeCloseTo(0.2, 6);
      }
      expect(app.state.gameplay.ownedTokens[0].economy.actions).toBe(1);
      expect(app.sheets.library.get(table.characterId).conditions.includes('prone')).toBe(prone);
      expect(
        table.calls
          .filter((call) => call.operation === 'playerCommand')
          .map((call) => call.args[1].kind)
      ).toEqual(commands);
      expect(
        table.calls.some((call) => ['commitScene', 'playerCommit'].includes(call.operation))
      ).toBe(false);
      expect(gm.characterServices.combat).toBeNull();
    } finally {
      if (app) await app.destroy();
      clock.mockRestore();
      restoreFiles();
      await table.close();
      document.body.replaceChildren();
      delete document.body.dataset.sessionRole;
    }
  },
  30000
);

test('real player radial cosmetics use authoritative availability and replay the exact accepted variant without rule costs', async () => {
  const table = await createPlayerAuthorityTable({ activeTurn: false });
  const restoreFiles = installHumanoidAssetFiles();
  let app;
  try {
    const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
    document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
    const gm = createCampaignBoard(null);
    delete gm.__threeTestDouble;
    gm.token3DAdapter.attach();
    app = await preparePlayerApplication({
      gameManager: gm,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    gm.advanceFrame();
    const token = gm.placedTokens[0];
    const model = token.__threeMesh;
    const position = { ...token.world };
    const before = structuredClone(app.state.gameplay.ownedTokens[0]);
    await app.input.applyRadial(token, 'action-wave');
    const data = gm.token3DAdapter._tokenAnimationData.get(token);
    expect(data.current).toBe('actionWave');
    await app.input.applyRadial(token, 'emote-idle');
    const request = table.calls.filter((call) => call.operation === 'playerCommand').at(-1).args[1];
    expect(request.payload.animationKey).toMatch(/^idle(?:Variant[2-5])?$/);
    expect(data.current).toBe(request.payload.animationKey);
    expect(token.__threeMesh).toBe(model);
    expect(token.world).toEqual(position);
    expect(app.state.gameplay.ownedTokens[0].economy).toEqual(before.economy);
    expect(app.state.gameplay.ownedTokens[0].movement).toEqual(before.movement);
  } finally {
    if (app) await app.destroy();
    restoreFiles();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test.each(['private restore fields', 'invalid flight-control visibility'])(
  '%s in a real player projection are rejected before changing native actors or assigned records',
  async (flaw) => {
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
      const popup = app.traversalPopup;
      const invalid = JSON.parse(JSON.stringify(app.state));
      if (flaw === 'private restore fields')
        invalid.publicScene.combat = { activeTokenId: 'private-hidden-token' };
      else invalid.gameplay.ownedTokens[0].availability['flight.takeoff'].visible = 'yes';
      invalid.sceneRevision++;
      await expect(app.showState(invalid)).rejects.toThrow(/public|private/i);
      expect(gameManager.placedTokens).toEqual([]);
      expect(popup.root.isConnected).toBe(false);
      expect(app.traversalPopup).toBeNull();
      expect(app.sheets.library.list()).toHaveLength(1);
      expect(app.state.sceneRevision).toBeLessThan(invalid.sceneRevision);
    } finally {
      if (app) await app.destroy();
      await table.close();
      document.body.replaceChildren();
      delete document.body.dataset.sessionRole;
    }
  },
  30000
);

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
    await waitForCondition(
      () => parent.textContent.includes('up to date'),
      'The DM session did not become current before the player command'
    );
    expect(parent.textContent).toMatch(/up to date/);
    const playerState = await table.connection.call('playerState', [{ presentationVersion: 1 }]);
    const commands = new PlayerCommandAdapter({
      connection: table.connection,
      getState: () => playerState,
    });
    const moved = await commands.move('token-1', { mapId: 'map-main', gridX: 2, gridY: 1 });
    await waitForCondition(
      () => gameManager.token3DAdapter.isMovementInProgress(token),
      'The DM did not receive the player movement presentation'
    );
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
    await waitForCondition(
      () => parent.textContent.includes('up to date'),
      'The DM did not acknowledge the player movement checkpoint'
    );
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
    await waitForCondition(
      () => playerManager.token3DAdapter.isMovementInProgress(playerToken),
      'The player did not receive the DM movement presentation'
    );
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
