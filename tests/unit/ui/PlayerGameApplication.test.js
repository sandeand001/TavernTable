import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlayerGameApplication from '../../../src/ui/sessions/PlayerGameApplication.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { publicPlayerState } from '../../helpers/publicPlayerState.js';
import { TokenFacingGesture } from '../../../src/managers/interaction-manager/internals/facing.js';
import { InteractionManager } from '../../../src/managers/InteractionManager.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import GameManager from '../../../src/core/GameManager.js';
import { TerrainEngine } from '../../../src/terrain/TerrainEngine.js';
import { getSurfaceRoute } from '../../../src/terrain/SurfaceNavigation.js';
import { characterActionOptions } from '../../../src/entities/characters/combat/actions.js';
import { installHumanoidAssetFiles } from '../../helpers/humanoid-fixture.js';

function fixture() {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const { state, source, catalog, wizardId } = publicPlayerState();
  const gameManager = createCampaignBoard(source);
  const opened = [];
  const requests = [];
  const connection = {
    call: async (...args) => {
      requests.push(args);
      return state;
    },
    subscribe: () => () => {},
    close: () => {},
  };
  const app = new PlayerGameApplication({
    gameManager,
    connection,
    identity: { role: 'player' },
    catalog,
    initialState: state,
    openSheet: (id) => opened.push(id),
  });
  return { gameManager, state, app, requests, opened, wizardId };
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.sessionRole;
});

test('native nearby-door controls serialize the host mutation and reveal only its refreshed authorized snapshot', async () => {
  const { app, state, gameManager, requests } = fixture();
  state.doors = [
    { id: 'entry', name: 'Courtyard door', open: false, locked: false },
    { id: 'locked', name: 'Locked gate', open: false, locked: true },
  ];
  await app.start();
  const button = app.controls.root.querySelector('[data-player-door="entry"]');
  expect(button).not.toBeNull();
  expect(button.textContent).toContain('Open');
  expect(app.controls.root.querySelector('[data-player-door="locked"]').disabled).toBe(true);
  const fresh = JSON.parse(JSON.stringify(state));
  fresh.sceneRevision++;
  fresh.doors[0].open = true;
  fresh.publicScene.assetKey = 'opened-door-assets';
  let release;
  app.connection.call = async (operation, args) => {
    requests.push([operation, args]);
    if (operation === 'doorState')
      return new Promise((resolve) => {
        release = () =>
          resolve({
            revision: fresh.sceneRevision,
            door: { id: 'entry', open: true, locked: false },
          });
      });
    if (operation === 'playerState') return fresh;
    throw new Error(`Unexpected operation: ${operation}`);
  };
  button.click();
  const idle = app.commands.idle;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(requests).toEqual([
    [
      'doorState',
      [
        state.campaign.id,
        {
          doorId: 'entry',
          observerTokenId: state.observerTokenId,
          sceneRevision: state.sceneRevision,
          open: true,
        },
      ],
    ],
  ]);
  expect(app.commands.pending).toBe(true);
  expect(gameManager.threeSceneManager.scene.visible).toBe(false);
  expect(app.controls.root.querySelector('[data-player-door="entry"]').disabled).toBe(true);
  await expect(
    app.commands.move(state.observerTokenId, {
      mapId: app.mapId,
      gridX: 2,
      gridY: 1,
    })
  ).rejects.toThrow('current host command');
  release();
  await idle;
  expect(requests[1][0]).toBe('playerState');
  expect(app.state.sceneRevision).toBe(fresh.sceneRevision);
  expect(app.controls.root.querySelector('[data-player-door="entry"]').textContent).toContain(
    'Close'
  );
  expect(gameManager.threeSceneManager.scene.visible).toBe(true);
  await app.destroy();
});

test('native doors reject locked, unknown and uncertain requests without changing the observer or making a host call', async () => {
  const { app, state, requests, gameManager } = fixture();
  state.doors = [{ id: 'locked', name: 'Gate', open: false, locked: true }];
  await app.start();
  await expect(app.changeDoor('locked', true)).rejects.toThrow(/locked/i);
  await expect(app.changeDoor('unlisted', true)).rejects.toThrow(/nearby/i);
  state.doors[0].locked = false;
  app.commands.lastRequest = { command: { observerTokenId: state.observerTokenId } };
  app.commands.failure = new TypeError('Lost gameplay acknowledgement');
  app.controls.updateCommandState(app.commands);
  await expect(app.changeDoor('locked', true)).rejects.toThrow(/uncertain/i);
  expect(requests).toEqual([]);
  expect(app.observerId).toBe(state.observerTokenId);
  expect(gameManager.threeSceneManager.scene.visible).toBe(true);
  await app.destroy();
});

test('a failed door mutation stays fail-closed until a fresh authorized snapshot restores gameplay', async () => {
  const { app, state, gameManager } = fixture();
  state.doors = [{ id: 'entry', name: 'Door', open: false, locked: false }];
  await app.start();
  app.connection.call = async (operation) => {
    if (operation === 'doorState') throw new TypeError('Door acknowledgement was lost');
    return state;
  };
  await expect(app.changeDoor('entry', true)).rejects.toThrow('acknowledgement was lost');
  expect(gameManager.threeSceneManager.scene.visible).toBe(false);
  expect(app.commands.availability('move', state.observerTokenId)).toMatchObject({
    allowed: false,
    code: 'player-state-unavailable',
  });
  expect(app.controls.root.querySelector('[data-player-door="entry"]').disabled).toBe(true);
  await app.refresh();
  expect(gameManager.threeSceneManager.scene.visible).toBe(true);
  expect(app.commands.availability('move', state.observerTokenId).allowed).toBe(true);
  expect(app.controls.root.querySelector('[data-player-door="entry"]').disabled).toBe(false);
  await app.destroy();
});

test('bursts of authorized revision notices coalesce into one read and one fresh follow-up without concurrent hydration', async () => {
  const { app, state, gameManager } = fixture();
  let notify;
  app.connection.subscribe = (listener) => {
    notify = listener;
    return () => {};
  };
  await app.start();
  const reads = [];
  app.connection.call = () => new Promise((resolve) => reads.push(resolve));
  const refreshing = app.refresh();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let index = 0; index < 20; index++)
    notify({
      type: 'campaign',
      campaignId: state.campaign.id,
      kind: 'playerCommand',
      version: 1,
      sceneRevision: state.sceneRevision + 1,
      charactersRevision: state.revision,
    });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reads).toHaveLength(1);
  reads[0](state);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reads).toHaveLength(2);
  const fresh = JSON.parse(JSON.stringify(state));
  fresh.sceneRevision++;
  fresh.publicScene.assets = null;
  fresh.publicScene.actors[0].gridX = 2;
  fresh.publicScene.actors[0].pose.world.x = 2.5;
  reads[1](fresh);
  await refreshing;
  expect(reads).toHaveLength(2);
  expect(gameManager.placedTokens[0].world.x).toBe(2.5);
  expect(app.state.sceneRevision).toBe(fresh.sceneRevision);
  await app.destroy();
});

test('a changed authorized map scope applies the host destination without replaying motion in the replacement terrain', async () => {
  const { app, state, gameManager } = fixture();
  await app.start();
  const next = JSON.parse(JSON.stringify(state));
  next.sceneRevision++;
  next.publicScene.assetKey = 'changed-room-assets';
  const motion = {
    kind: 'walk',
    completed: true,
    from: {
      mapId: state.publicScene.presentation.mapId,
      gridX: 1,
      gridY: 1,
      facingAngle: 0,
      pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
    },
    route: [
      {
        mapId: state.publicScene.presentation.mapId,
        gridX: 2,
        gridY: 1,
        facingAngle: 0,
        pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
      },
    ],
  };
  Object.assign(next.publicScene.actors[0], motion.route[0]);
  const play = jest
    .spyOn(gameManager.token3DAdapter, 'playApprovedMovement')
    .mockResolvedValue({ completed: true });
  await app.receiveReceipt(
    {
      state: next,
      applied: { sceneRevision: next.sceneRevision, charactersRevision: next.revision },
      receipt: { kind: 'move', tokenId: state.observerTokenId, motion },
    },
    {
      animate: true,
      command: {
        kind: 'move',
        tokenId: state.observerTokenId,
        observerTokenId: state.observerTokenId,
        sceneRevision: state.sceneRevision,
      },
    }
  );
  expect(play).not.toHaveBeenCalled();
  expect(gameManager.placedTokens[0].world).toEqual({ x: 2.5, y: 0, z: 1.5 });
  expect(gameManager.threeSceneManager.scene.visible).toBe(true);
  await app.destroy();
});

test('the normal shared d20 button sends an owned host roll intent and never rolls a local face while awaiting acknowledgement', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('roll');
  state.gameplay.ownedTokens[0].availability.roll = { allowed: true, code: 'allowed' };
  await app.start();
  const sent = [];
  let release;
  app.connection.call = async (...args) => {
    sent.push(args);
    return new Promise((_resolve, reject) => {
      release = () => reject(new TypeError('Connection closed after page shutdown'));
    });
  };
  const actor = gameManager.placedTokens[0];
  const origin = { ...actor.world };
  document.querySelector('[data-sides="20"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sent).toHaveLength(1);
  expect(sent[0][0]).toBe('playerCommand');
  expect(sent[0][1][1]).toMatchObject({
    version: 1,
    observerTokenId: 'canonical-scout',
    tokenId: 'canonical-scout',
    kind: 'roll',
    payload: { expression: '1d20', mode: 'normal' },
  });
  expect(sent[0][1][1].payload).not.toHaveProperty('value');
  expect(document.querySelector('[data-dice-result]').textContent).toMatch(/host/i);
  expect(actor.world).toEqual(origin);
  await app.destroy();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gameManager.placedTokens).toEqual([]);
});

test('the interactive player application keeps the shared game UI and opens owned sheets without creating an unplaced world actor', async () => {
  const { gameManager, app, state, opened, wizardId } = fixture();
  await app.start(state);
  expect(gameManager.characterServices.sessionRole).toBe('player');
  expect(gameManager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
  expect(document.querySelectorAll('[data-dice]')).toHaveLength(6);
  document.querySelector(`[data-assigned-character="${wizardId}"]`).click();
  expect(opened).toEqual([wizardId]);
  expect(document.querySelector('[aria-label="Active character"]').value).toBe('canonical-scout');
  expect(gameManager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
  await app.destroy();
});

test('the native owned sheet ends only its advertised active turn and preserves actor, camera and focused draft references', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('turn.end');
  state.gameplay.ownedTokens[0].availability['turn.end'] = { allowed: true, code: 'allowed' };
  await app.start();
  const token = gameManager.placedTokens[0];
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(token);
  sheet.root.querySelector('[data-sheet-section="combat"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const end = sheet.root.querySelector('[data-sheet-action="turn-end"]');
  expect(end).not.toBeNull();
  expect(end.disabled).toBe(false);
  expect(sheet.root.querySelector('[data-sheet-action="turn-start"]')).toBeNull();
  const draft = sheet.root.querySelector(
    '[data-sheet-identity-value][data-character-field="ancestry"]'
  );
  draft.focus();
  draft.value = 'Uncommitted draft';
  const camera = gameManager.threeSceneManager.snapshotView();
  const sent = [];
  app.connection.call = async (operation, [, command]) => {
    sent.push({ operation, command });
    const accepted = JSON.parse(JSON.stringify(state));
    accepted.sceneRevision++;
    accepted.publicScene.assets = null;
    accepted.gameplay.turn.tokenId = null;
    accepted.gameplay.ownedTokens[0].availability['turn.end'] = {
      allowed: false,
      code: 'not-your-turn',
    };
    return {
      version: 1,
      commandId: command.commandId,
      outcome: 'applied',
      applied: { sceneRevision: accepted.sceneRevision, charactersRevision: accepted.revision },
      receipt: { kind: 'turn.end', tokenId: token.id },
      state: accepted,
    };
  };
  end.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    operation: 'playerCommand',
    command: { kind: 'turn.end', tokenId: token.id, payload: {} },
  });
  expect(gameManager.placedTokens[0]).toBe(token);
  expect(gameManager.threeSceneManager.snapshotView()).toBe(camera);
  expect(
    sheet.root.querySelector('[data-sheet-identity-value][data-character-field="ancestry"]')
  ).toBe(draft);
  expect(draft.value).toBe('Uncommitted draft');
  expect(sheet.root.querySelector('[data-sheet-action="turn-end"]').disabled).toBe(true);
  sheet.destroy();
  await app.destroy();
});

test('native player ability checks send the selected host roll mode and show a denial without a client-side roll or budget change', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('roll');
  state.gameplay.ownedTokens[0].availability.roll = { allowed: true, code: 'allowed' };
  await app.start();
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(gameManager.placedTokens[0]);
  sheet.root.querySelector('[data-sheet-section="noncombat"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  sheet.root.querySelector('[data-roll-mode="advantage"]').click();
  const button = sheet.root.querySelector('[data-sheet-action="roll"][data-roll-kind="ability"]');
  expect(button.disabled).toBe(false);
  const sent = [];
  app.connection.call = async (_operation, [, command]) => {
    sent.push(command);
    throw Object.assign(new Error('The host denied this check'), { status: 422, code: 'blocked' });
  };
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    kind: 'roll',
    tokenId: 'canonical-scout',
    payload: { mode: 'advantage', expression: expect.stringMatching(/^1d20/) },
  });
  expect(sent[0].payload).not.toHaveProperty('value');
  expect(sheet.root.textContent).toContain('The host denied this check');
  expect(app.input.movementBudget(gameManager.placedTokens[0]).remainingFeet).toBe(30);
  expect(gameManager.characterServices.combat).toBeNull();
  sheet.destroy();
  await app.destroy();
});

test('native player action cards spend no local resources and reconcile the exact host action budget', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('action.use');
  state.gameplay.ownedTokens[0].availability['action.use'] = { allowed: true, code: 'allowed' };
  state.gameplay.ownedTokens[0].availableActions = [
    characterActionOptions(app.sheets.library, {
      characterSheetId: state.publicScene.actors[0].characterId,
    }).find((action) => action.id === 'dash'),
  ];
  await app.start();
  const token = gameManager.placedTokens[0];
  const origin = { ...token.world };
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(token);
  sheet.root.querySelector('[data-sheet-section="combat"]').click();
  const button = sheet.root.querySelector(
    '[data-sheet-action="use-action"][data-action-id="dash"]'
  );
  expect(button.disabled).toBe(false);
  const sent = [];
  app.connection.call = async (_operation, [, command]) => {
    sent.push(command);
    const accepted = JSON.parse(JSON.stringify(state));
    accepted.sceneRevision++;
    accepted.publicScene.assets = null;
    const own = accepted.gameplay.ownedTokens[0];
    own.availableActions = [];
    own.economy.actions = 0;
    own.movement = { spentFeet: 0, remainingFeet: 60, allowanceFeet: 60 };
    return {
      version: 1,
      commandId: command.commandId,
      outcome: 'applied',
      applied: { sceneRevision: accepted.sceneRevision, charactersRevision: accepted.revision },
      receipt: {
        kind: 'action.use',
        tokenId: token.id,
        actionId: 'dash',
        cost: 'action',
        budget: { movementSpentFeet: 0, movementRemainingFeet: 60, movementAllowanceFeet: 60 },
      },
      state: accepted,
    };
  };
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    kind: 'action.use',
    payload: { actionId: 'dash', choice: {} },
  });
  expect(sent[0].payload).not.toHaveProperty('costFeet');
  expect(token.world).toEqual(origin);
  expect(app.input.movementBudget(token).remainingFeet).toBe(60);
  expect(
    sheet.root.querySelector('[data-sheet-action="use-action"][data-action-id="dash"]').disabled
  ).toBe(true);
  expect(gameManager.characterServices.combat).toBeNull();
  sheet.destroy();
  await app.destroy();
});

test('a native player attack opens the native target overlay and submits only visible target allocation intent', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('action.use');
  state.gameplay.ownedTokens[0].availability['action.use'] = { allowed: true, code: 'allowed' };
  state.gameplay.ownedTokens[0].availableActions = [
    characterActionOptions(app.sheets.library, {
      characterSheetId: state.publicScene.actors[0].characterId,
    }).find(({ id }) => id === 'attack:unarmed'),
  ];
  state.publicScene.actors.push({
    ...state.publicScene.actors[0],
    id: 'visible-guard',
    name: 'Visible guard',
    owned: false,
    characterId: null,
    type: 'knight',
    gridX: 2,
    pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
  });
  await app.start();
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(gameManager.placedTokens[0]);
  sheet.root.querySelector('[data-sheet-section="combat"]').click();
  const sent = [];
  app.connection.call = async (_operation, [, command]) => {
    sent.push(command);
    throw Object.assign(new Error('Host rejected the action without spending resources'), {
      status: 422,
      code: 'blocked',
    });
  };
  sheet.root.querySelector('[data-action-id="attack:unarmed"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const target = document.querySelector('[data-target-token="visible-guard"]');
  expect(target).not.toBeNull();
  target.click();
  document.querySelector('[data-target-action="confirm"]').click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({
    kind: 'action.use',
    tokenId: 'canonical-scout',
    payload: {
      actionId: 'attack:unarmed',
      targeting: { targets: [{ tokenId: 'visible-guard', count: 1 }] },
    },
  });
  expect(sent[0].payload.targeting).not.toHaveProperty('willingConfirmed');
  expect(sheet.root.textContent).toContain('Host rejected the action without spending resources');
  expect(app.input.movementBudget(gameManager.placedTokens[0]).spentFeet).toBe(0);
  expect(gameManager.placedTokens[1].characterSheetId).toBeUndefined();
  sheet.destroy();
  await app.destroy();
});

test('an expired host gameplay session clears native actors and sheets instead of leaving actionable stale player data', async () => {
  const { app, gameManager } = fixture();
  await app.start();
  const token = gameManager.placedTokens[0];
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(token);
  app.connection.call = async () => {
    throw Object.assign(new Error('Player session expired'), { status: 401 });
  };
  await expect(app.input.requestMove(token, { gridX: 2, gridY: 1 })).rejects.toThrow('expired');
  expect(gameManager.placedTokens).toEqual([]);
  expect(gameManager.threeSceneManager.scene.visible).toBe(false);
  expect(sheet.root.hidden).toBe(true);
  expect(document.querySelector('[aria-label="Active character"]').disabled).toBe(true);
  expect(document.querySelector('[data-sides="20"]').disabled).toBe(true);
  expect(app.state.profile.role).toBe('player');
  sheet.destroy();
  await app.destroy();
});

test('native player rotation submits facing intent and changes the visual only after a validated host acknowledgement', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('facing');
  state.gameplay.ownedTokens[0].availability.facing = { allowed: true, code: 'allowed' };
  await app.start();
  const token = gameManager.placedTokens[0];
  const gesture = new TokenFacingGesture(new InteractionManager(gameManager));
  expect(gesture.canFace(token)).toBe(true);
  const sent = [];
  let release;
  app.connection.call = async (_operation, [, command]) => {
    sent.push(command);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  const rotated = gameManager.tokenManager.rotateToken(token, Math.PI / 4);
  expect(token.facingAngle).toBe(0);
  expect(sent[0]).toMatchObject({
    kind: 'facing',
    tokenId: token.id,
    payload: { angle: Math.PI / 4 },
  });
  const accepted = JSON.parse(JSON.stringify(state));
  accepted.sceneRevision++;
  accepted.publicScene.assets = null;
  accepted.publicScene.actors[0].facingAngle = Math.PI / 4;
  release({
    version: 1,
    commandId: sent[0].commandId,
    outcome: 'applied',
    applied: { sceneRevision: accepted.sceneRevision, charactersRevision: accepted.revision },
    receipt: { kind: 'facing', tokenId: token.id, facingAngle: Math.PI / 4 },
    state: accepted,
  });
  await rotated;
  expect(gameManager.placedTokens[0]).toBe(token);
  expect(token.facingAngle).toBe(Math.PI / 4);
  expect(app.input.movementBudget(token).spentFeet).toBe(0);
  await app.destroy();
});

test('native player movement settings remain unchanged until the host accepts the selected pace', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('movement.settings');
  state.gameplay.ownedTokens[0].availability['movement.settings'] = {
    allowed: true,
    code: 'allowed',
  };
  await app.start();
  const token = gameManager.placedTokens[0];
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(token);
  const button = sheet.root.querySelector('[data-sheet-action="movement-mode"][data-mode="run"]');
  expect(button.disabled).toBe(false);
  let release;
  const sent = [];
  app.connection.call = async (_operation, [, command]) => {
    sent.push(command);
    return new Promise((resolve) => {
      release = resolve;
    });
  };
  button.click();
  await Promise.resolve();
  expect(token.movementSettings.mode).toBe('walk');
  expect(sent[0]).toMatchObject({ kind: 'movement.settings', payload: { mode: 'run' } });
  const accepted = JSON.parse(JSON.stringify(state));
  accepted.sceneRevision++;
  accepted.publicScene.assets = null;
  accepted.publicScene.actors[0].movement.mode = 'run';
  release({
    version: 1,
    commandId: sent[0].commandId,
    outcome: 'applied',
    applied: { sceneRevision: accepted.sceneRevision, charactersRevision: accepted.revision },
    receipt: {
      kind: 'movement.settings',
      tokenId: token.id,
      movement: { mode: 'run', type: 'default' },
    },
    state: accepted,
  });
  await app.commands.idle;
  expect(token.movementSettings.mode).toBe('run');
  expect(app.input.movementBudget(token).spentFeet).toBe(0);
  sheet.destroy();
  await app.destroy();
});

test('native player Stand Up uses the host capability and reconciles its exact cost without changing HP or locally spending movement', async () => {
  const { app, state, gameManager } = fixture();
  state.gameplay.commands.push('stand');
  state.gameplay.ownedTokens[0].availability.stand = {
    allowed: true,
    code: 'allowed',
    costFeet: 15,
  };
  state.publicScene.actors[0].flags.prone = true;
  const record = state.records.find(
    ({ key }) => key === `taverntable.character.v1.${state.publicScene.actors[0].characterId}`
  );
  record.value = JSON.stringify({ ...JSON.parse(record.value), conditions: ['prone'] });
  state.revision++;
  state.sceneRevision++;
  await app.start();
  const token = gameManager.placedTokens[0];
  const hp = { ...app.sheets.library.get(token.characterSheetId).hp };
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(token);
  const stand = sheet.root.querySelector('[data-sheet-action="stand-up"]');
  expect(stand.disabled).toBe(false);
  app.connection.call = async (_operation, [, command]) => {
    expect(command).toMatchObject({ kind: 'stand', tokenId: token.id, payload: {} });
    const accepted = JSON.parse(JSON.stringify(state));
    accepted.sceneRevision++;
    accepted.revision++;
    accepted.publicScene.assets = null;
    accepted.publicScene.actors[0].flags.prone = false;
    accepted.gameplay.ownedTokens[0].movement = {
      spentFeet: 15,
      remainingFeet: 15,
      allowanceFeet: 30,
    };
    const saved = accepted.records.find(({ key }) => key === record.key);
    saved.value = JSON.stringify({ ...JSON.parse(saved.value), conditions: [] });
    return {
      version: 1,
      commandId: command.commandId,
      outcome: 'applied',
      applied: { sceneRevision: accepted.sceneRevision, charactersRevision: accepted.revision },
      receipt: {
        kind: 'stand',
        tokenId: token.id,
        costFeet: 15,
        budget: { movementSpentFeet: 15, movementRemainingFeet: 15, movementAllowanceFeet: 30 },
      },
      state: accepted,
    };
  };
  stand.click();
  await app.commands.idle;
  expect(app.input.movementBudget(token).spentFeet).toBe(15);
  expect(app.sheets.library.get(token.characterSheetId).conditions).toEqual([]);
  expect(app.sheets.library.get(token.characterSheetId).hp).toEqual(hp);
  sheet.destroy();
  await app.destroy();
});

test('native player flight commands send host intent and reconcile the saved airborne pose without local takeoff or spending', async () => {
  const { app, state, gameManager } = fixture();
  const restoreFiles = installHumanoidAssetFiles();
  delete gameManager.__threeTestDouble;
  state.gameplay.commands.push('flight.takeoff');
  state.gameplay.ownedTokens[0].availability['flight.takeoff'] = {
    allowed: true,
    code: 'allowed',
    costFeet: 5,
  };
  try {
    await app.start();
    const token = gameManager.placedTokens[0];
    expect(app.input.radialAvailability(token)['take-flight'].allowed).toBe(true);
    app.connection.call = async (_operation, [, command]) => {
      expect(command).toMatchObject({ kind: 'flight.takeoff', payload: {} });
      expect(token.world.y).toBe(0);
      const accepted = JSON.parse(JSON.stringify(state));
      accepted.sceneRevision++;
      accepted.publicScene.assets = null;
      accepted.publicScene.actors[0].pose = { kind: 'flight', world: { x: 1.5, y: 1, z: 1.5 } };
      accepted.publicScene.actors[0].flags.flightActive = true;
      accepted.gameplay.ownedTokens[0].movement = {
        spentFeet: 5,
        remainingFeet: 25,
        allowanceFeet: 30,
      };
      return {
        version: 1,
        commandId: command.commandId,
        outcome: 'applied',
        applied: { sceneRevision: accepted.sceneRevision, charactersRevision: accepted.revision },
        receipt: {
          kind: 'flight.takeoff',
          tokenId: token.id,
          costFeet: 5,
          budget: { movementSpentFeet: 5, movementRemainingFeet: 25, movementAllowanceFeet: 30 },
        },
        state: accepted,
      };
    };
    await GameManager.prototype.applyTokenCommand.call(gameManager, token, 'take-flight');
    expect(token.world.y).toBe(1);
    expect(token.flightActive).toBe(true);
    expect(app.input.movementBudget(token).spentFeet).toBe(5);
  } finally {
    await app.destroy();
    restoreFiles();
  }
}, 30000);

test('opening an owned world sheet cannot rebind the canonical actor to a different saved record through the native library selector', async () => {
  const { app, gameManager, wizardId } = fixture();
  await app.start();
  const token = gameManager.placedTokens[0];
  const original = token.characterSheetId;
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(token);
  const select = sheet.characterContent.librarySelect;
  expect(select.disabled).toBe(true);
  select.value = wizardId;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await Promise.resolve();
  expect(token.characterSheetId).toBe(original);
  expect(app.state.observerTokenId).toBe(token.id);
  expect(gameManager.placedTokens).toHaveLength(1);
  sheet.destroy();
  await app.destroy();
});

test('direct native token registration cannot create phantom actors or canonical counters in the public player world', async () => {
  const { app, gameManager } = fixture();
  await app.start();
  const actor = gameManager.placedTokens[0];
  const nextId = gameManager.tokenManager._nextTokenId;
  const counters = [...gameManager.tokenManager._tokenTypeCounts];
  const creature = gameManager.tokenManager.createCreatureByType('knight');
  expect(() => gameManager.tokenManager.addTokenToCollection(creature, 2, 2, 'knight')).toThrow(
    /host|grant|authorized/i
  );
  expect(gameManager.placedTokens).toEqual([actor]);
  expect(gameManager.tokenManager._nextTokenId).toBe(nextId);
  expect([...gameManager.tokenManager._tokenTypeCounts]).toEqual(counters);
  await app.destroy();
});

test.each(['beginForwardMovement', 'beginBackwardMovement', 'beginRotation'])(
  'native %s cannot start a local rules/timing controller for a public player actor',
  async (method) => {
    const { app, gameManager } = fixture();
    await app.start();
    const token = gameManager.placedTokens[0];
    const placement = { ...token.world };
    expect(() => gameManager.token3DAdapter[method](token)).toThrow(/host|completed|intent/i);
    expect(token.world).toEqual(placement);
    expect(app.input.movementBudget(token).spentFeet).toBe(0);
    await app.destroy();
  }
);

test('an older authorized response cannot rewind saved character records or the rendered actor', async () => {
  const { gameManager, app, state } = fixture();
  await app.start();
  const newer = JSON.parse(JSON.stringify(state));
  const characterId = newer.publicScene.actors[0].characterId;
  const record = newer.records.find(({ key }) => key === `taverntable.character.v1.${characterId}`);
  record.value = JSON.stringify({ ...JSON.parse(record.value), name: 'Ranger' });
  newer.revision++;
  newer.sceneRevision++;
  newer.publicScene.assets = null;
  newer.publicScene.actors[0].name = 'Ranger';
  newer.publicScene.actors[0].gridX = 2;
  newer.publicScene.actors[0].pose.world.x = 2.5;
  await app.showState(newer);
  expect(await app.showState(state)).toEqual({ applied: false, reason: 'stale-snapshot' });
  expect(app.sheets.library.get(characterId).name).toBe('Ranger');
  expect(document.querySelector(`[data-assigned-character="${characterId}"]`).textContent).toBe(
    'Ranger'
  );
  expect(gameManager.placedTokens[0].world.x).toBe(2.5);
  await app.destroy();
});

test('switching the active character clears old sightings and ignores a late response for a superseded observer', async () => {
  const { gameManager, app, state, wizardId } = fixture();
  state.observers.push({
    id: 'canonical-wizard',
    name: 'Wizard',
    characterId: wizardId,
    mapId: 'main',
  });
  await app.start();
  const responses = [];
  app.connection.call = () => new Promise((resolve) => responses.push(resolve));
  const oldRequest = app.chooseObserver('canonical-wizard');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gameManager.placedTokens).toEqual([]);
  const currentRequest = app.chooseObserver('canonical-scout');
  await new Promise((resolve) => setTimeout(resolve, 0));
  responses[1](state);
  await currentRequest;
  const wizardState = JSON.parse(JSON.stringify(state));
  wizardState.observerTokenId = 'canonical-wizard';
  wizardState.publicScene.presentation.focusTokenId = 'canonical-wizard';
  Object.assign(wizardState.publicScene.actors[0], {
    id: 'canonical-wizard',
    characterId: wizardId,
    name: 'Wizard',
  });
  responses[0](wizardState);
  expect(await oldRequest).toEqual({ applied: false, reason: 'superseded-selection' });
  expect(app.state.observerTokenId).toBe('canonical-scout');
  expect(gameManager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
  await app.destroy();
});

test('unadvertised facing cannot mutate the player creature locally, while ordinary creature selection remains available', async () => {
  const { app, gameManager } = fixture();
  await app.start();
  const token = gameManager.placedTokens[0];
  const before = token.facingAngle;
  const gesture = new TokenFacingGesture(new InteractionManager(gameManager));
  expect(gesture.canFace(token)).toBe(false);
  expect(() => gameManager.tokenManager.rotateToken(token, Math.PI / 4)).toThrow('host-authorized');
  expect(token.facingAngle).toBe(before);
  expect(gameManager.token3DAdapter.getSelectedToken()).toBe(token);
  await app.destroy();
});

test('a placed owned character keeps normal sheet sections and camera focus without becoming a DM or changing observers', async () => {
  const { app, gameManager } = fixture();
  await app.start();
  const token = gameManager.placedTokens[0];
  gameManager.threeSceneManager.setCameraTarget = (x, z, y) =>
    gameManager.threeSceneManager.restoreView({
      ...gameManager.threeSceneManager.snapshotView(),
      target: { x, y, z },
    });
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(token);
  expect(sheet.root.querySelector('main').textContent).not.toContain('could not be displayed');
  expect(sheet.root.querySelector('[data-sheet-section="combat"]').disabled).toBe(false);
  expect(sheet.root.querySelector('[data-sheet-section="noncombat"]').disabled).toBe(false);
  expect(sheet.root.textContent).not.toContain('could not be displayed');
  expect(gameManager.threeSceneManager.snapshotView().target).toEqual(token.world);
  expect(app.state.observerTokenId).toBe('canonical-scout');
  expect(gameManager.characterServices.sessionRole).toBe('player');
  expect(gameManager.sceneAutosave).toBeUndefined();
  sheet.destroy();
  await app.destroy();
});

test('player play sections show the native action cards and authoritative movement without exposing DM turn corrections', async () => {
  const { app, gameManager, state } = fixture();
  state.gameplay.ownedTokens[0].movement = { spentFeet: 25, remainingFeet: 5 };
  await app.start();
  const sheet = new CharacterSheetWindow({ gameManager }).attach();
  await sheet.open(gameManager.placedTokens[0]);
  sheet.root.querySelector('[data-sheet-section="combat"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheet.root.querySelector('[aria-label="Combat play"]')).not.toBeNull();
  expect(sheet.root.querySelector('[aria-label="Movement remaining"]').textContent).toBe('5');
  expect(sheet.root.querySelector('[aria-label="DM remaining movement"]')).toBeNull();
  const action = sheet.root.querySelector('[data-sheet-action="use-action"]');
  expect(action).not.toBeNull();
  expect(action.disabled).toBe(true);
  sheet.root.querySelector('[data-sheet-section="noncombat"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheet.root.querySelector('[aria-label="Non-combat play"]')).not.toBeNull();
  expect(sheet.root.querySelectorAll('.sheet-play-roll-card').length).toBeGreaterThan(20);
  expect(gameManager.characterServices.combat).toBeNull();
  sheet.destroy();
  await app.destroy();
});

test('a revoked observer recovers only through a fresh authorized default, not a borrowed local viewpoint', async () => {
  const { app, gameManager, state, wizardId } = fixture();
  state.observers.push({
    id: 'canonical-wizard',
    name: 'Wizard',
    characterId: wizardId,
    mapId: 'main',
  });
  await app.start();
  const calls = [];
  app.connection.call = async (_operation, [options]) => {
    calls.push(options);
    if (Object.hasOwn(options, 'observerTokenId'))
      throw Object.assign(new Error('Observer unavailable'), { status: 403 });
    return { ...state, observers: [state.observers[0]] };
  };
  await app.chooseObserver('canonical-wizard');
  expect(calls).toEqual([
    { observerTokenId: 'canonical-wizard', presentationVersion: 1 },
    { observerTokenId: 'canonical-wizard', presentationVersion: 1 },
    { presentationVersion: 1 },
  ]);
  expect(app.state.observerTokenId).toBe('canonical-scout');
  expect(document.querySelector('[aria-label="Active character"]').options).toHaveLength(1);
  expect(gameManager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
  await app.destroy();
});

test('an invalid observer projection fails visibly and clears old sightings before any unauthorized actor can render', async () => {
  const { app, gameManager, state } = fixture();
  await app.start();
  const invalid = JSON.parse(JSON.stringify(state));
  invalid.sceneRevision++;
  invalid.observerTokenId = 'not-an-assigned-observer';
  invalid.publicScene.presentation.focusTokenId = invalid.observerTokenId;
  await expect(app.showState(invalid)).rejects.toThrow('observer');
  expect(gameManager.placedTokens).toEqual([]);
  expect(gameManager.threeSceneManager.scene.visible).toBe(false);
  await app.destroy();
});

test('expired player access closes sheets and clears the map instead of leaving an interactive cached scene', async () => {
  const { app, gameManager } = fixture();
  let notice;
  app.connection.subscribe = (listener) => {
    notice = listener;
    return () => {};
  };
  await app.start();
  app.connection.call = async () => {
    throw Object.assign(new Error('Player access expired'), { status: 401 });
  };
  notice({ type: 'campaign', campaignId: 'campaign' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(gameManager.placedTokens).toEqual([]);
  expect(gameManager.threeSceneManager.scene.visible).toBe(false);
  expect(document.querySelector('[aria-label="Active character"]').disabled).toBe(true);
  expect(document.querySelector('[aria-label="Player session status"]').textContent).toContain(
    'expired'
  );
  expect(document.getElementById('saved-character-roster').textContent).toContain('Reconnect');
  await expect(app.showSheet(app.state.publicScene.actors[0].characterId)).rejects.toThrow('ended');
  await app.destroy();
});

test('overlapping accepted snapshots keep the newest command revisions and budget as well as the rendered pose', async () => {
  const { app, gameManager, state } = fixture();
  await app.start();
  const second = JSON.parse(JSON.stringify(state));
  second.sceneRevision = 2;
  second.publicScene.assets = null;
  second.publicScene.actors[0].gridX = 2;
  second.publicScene.actors[0].pose.world.x = 2.5;
  const latest = JSON.parse(JSON.stringify(second));
  latest.sceneRevision = 3;
  latest.publicScene.actors[0].gridX = 3;
  latest.publicScene.actors[0].pose.world.x = 3.5;
  latest.gameplay.ownedTokens[0].movement = { spentFeet: 20, remainingFeet: 10 };
  await Promise.all([app.showState(second), app.showState(latest)]);
  expect(app.state.sceneRevision).toBe(3);
  expect(gameManager.placedTokens[0].world.x).toBe(3.5);
  expect(app.input.movementAllowance(gameManager.placedTokens[0])).toBe(10);
  await app.destroy();
});

test('player creature actions are host-gated instead of falling back to local pose or condition changes', async () => {
  const { app, gameManager } = fixture();
  await app.start();
  const token = gameManager.placedTokens[0];
  const manager = new GameManager({ cols: 5, rows: 5 });
  manager.characterServices = gameManager.characterServices;
  manager.playerInput = app.input;
  await expect(manager.applyTokenCommand(token, 'take-flight')).rejects.toThrow('host-authorized');
  expect(token.conditions).toEqual([]);
  const availability = app.input.radialAvailability(token);
  expect(availability['character-sheet'].allowed).toBe(true);
  expect(availability['take-flight'].allowed).toBe(false);
  await app.destroy();
});

test('layered-floor movement previews use the exact host budget, not the owned sheet speed', async () => {
  const { app, gameManager, state } = fixture();
  const terrain = new TerrainEngine(5, 5);
  terrain.addVolume({
    id: 'platform',
    layerId: 'platform',
    bounds: { min: { x: 15, y: 0, z: 15 }, max: { x: 25, y: 5, z: 25 } },
  });
  state.publicScene.assets.maps[0].terrain.geometry = terrain.geometry.save();
  state.gameplay.ownedTokens[0].movement = { spentFeet: 25, remainingFeet: 5 };
  await app.start();
  const range = gameManager.token3DAdapter.getTokenMovementRange(gameManager.placedTokens[0]);
  expect(getSurfaceRoute(range, 2, 1, { heightFeet: 0 })).not.toBeNull();
  expect(getSurfaceRoute(range, 3, 1, { heightFeet: 0 })).toBeNull();
  await app.destroy();
});

test('a DM relocation follows the same active character into its new area without borrowing another observer', async () => {
  const { app, gameManager, state } = fixture();
  await app.start();
  const moved = JSON.parse(JSON.stringify(state));
  moved.sceneRevision++;
  const upper = JSON.parse(JSON.stringify(moved.publicScene.assets.maps[0]));
  upper.id = 'upper';
  upper.name = 'Upper floor';
  upper.originFeet.y = 10;
  moved.publicScene.assets.maps.push(upper);
  moved.publicScene.assetKey = 'two-map-assets';
  moved.maps.push({ id: 'upper', name: 'Upper floor' });
  moved.observers[0].mapId = 'upper';
  moved.publicScene.actors[0].mapId = 'upper';
  const calls = [];
  app.connection.call = async (_operation, [options]) => {
    calls.push(options);
    return {
      ...moved,
      publicScene: {
        ...moved.publicScene,
        presentation: {
          ...moved.publicScene.presentation,
          mapId: Object.hasOwn(options, 'mapId') ? 'main' : 'upper',
        },
      },
    };
  };
  await app.refresh();
  expect(calls.at(-1)).toEqual({ observerTokenId: 'canonical-scout', presentationVersion: 1 });
  expect(app.state.observerTokenId).toBe('canonical-scout');
  expect(gameManager.campaignMapId).toBe('upper');
  expect(document.querySelector('[aria-label="Location area"]').value).toBe('upper');
  await app.destroy();
});
