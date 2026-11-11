import { readFileSync } from 'node:fs';
import path from 'node:path';
import PlayerTargetingController from '../../../src/ui/sessions/PlayerTargetingController.js';
import { preparePlayerApplication } from '../../../src/ui/sessions/PlayerApplication.js';
import { createPlayerAuthorityTable } from '../../helpers/playerAuthority.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';

test('the real projected Fly action selects visible canonical targets without guessing foreign tags or requesting willingness consent', async () => {
  const table = await createPlayerAuthorityTable({
    characterUpdates: { classId: 'wizard', level: 5 },
    spells: ['spell:fly'],
    visibleNPC: true,
  });
  let app;
  let picker;
  try {
    const root = path.resolve(__dirname, '..', '..', '..');
    document.body.innerHTML = new DOMParser().parseFromString(
      readFileSync(path.join(root, 'index.html'), 'utf8'),
      'text/html'
    ).body.innerHTML;
    const gameManager = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const own = gameManager.placedTokens.find(({ id }) => id === 'token-1');
    const foreign = gameManager.placedTokens.find(({ id }) => id === 'token-2');
    expect(foreign).not.toHaveProperty('characterSheetId');
    expect(foreign).not.toHaveProperty('allegiance');
    const action = app.state.gameplay.ownedTokens[0].availableActions.find(
      (entry) => entry.targeting?.requiresWilling
    );
    expect(action).toBeDefined();
    picker = new PlayerTargetingController({ gameManager, getState: () => app.state });
    const choosing = picker.choose(own, action, { slotLevel: 3 });
    expect(document.querySelector('[data-target-willing]')).toBeNull();
    document.querySelector('[data-target-token="token-2"]').click();
    document.querySelector('[data-target-action="confirm"]').click();
    const intent = await choosing;
    expect(intent).toMatchObject({
      choice: { slotLevel: 3 },
      targeting: { targets: [{ tokenId: 'token-2', count: 1 }] },
    });
    expect(intent.targeting).not.toHaveProperty('willingConfirmed');
    expect(app.input.movementBudget(own).spentFeet).toBe(0);
    expect(own.id).toBe('token-1');
    expect(app.state.observerTokenId).toBe('token-1');
    expect(
      gameManager.threeSceneManager.scene.getObjectByName('TargetingAndSpellAreas')
    ).toBeTruthy();
  } finally {
    picker?.destroy();
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('the native player area picker converts an authorized map-local destination to campaign targeting coordinates without local action costs', async () => {
  const table = await createPlayerAuthorityTable({
    characterUpdates: { classId: 'wizard', level: 5 },
    spells: ['spell:fireball'],
  });
  let app;
  let picker;
  try {
    const root = path.resolve(__dirname, '..', '..', '..');
    document.body.innerHTML = new DOMParser().parseFromString(
      readFileSync(path.join(root, 'index.html'), 'utf8'),
      'text/html'
    ).body.innerHTML;
    const gameManager = createCampaignBoard(null);
    app = await preparePlayerApplication({
      gameManager,
      connection: table.connection,
      identity: { role: 'player' },
      resources: { catalog: async () => table.catalog, close() {} },
    });
    await app.start();
    const token = gameManager.placedTokens[0];
    const action = app.state.gameplay.ownedTokens[0].availableActions.find(
      (entry) => entry.targeting?.kind === 'area'
    );
    expect(action).toBeDefined();
    picker = new PlayerTargetingController({ gameManager, getState: () => app.state });
    const choosing = picker.choose(token, action, { slotLevel: 3 });
    picker.placeOrigin('map-main', { x: 2.5, y: 0, z: 1.5 });
    document.querySelector('[data-target-action="confirm"]').click();
    const intent = await choosing;
    expect(intent.targeting.origin).toEqual({ x: 12.5, y: 0, z: 7.5 });
    expect(intent.choice).toEqual({ slotLevel: 3 });
    expect(intent.targeting).not.toHaveProperty('willingConfirmed');
    expect(app.input.movementBudget(token).spentFeet).toBe(0);
    expect(
      gameManager.threeSceneManager.scene.getObjectByName('TargetingAndSpellAreas').children.length
    ).toBeGreaterThan(0);
  } finally {
    picker?.destroy();
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);
