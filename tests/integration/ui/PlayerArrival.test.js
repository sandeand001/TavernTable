import { readFileSync } from 'node:fs';
import path from 'node:path';
import { preparePlayerApplication } from '../../../src/ui/sessions/PlayerApplication.js';
import { createPlayerAuthorityTable } from '../../helpers/playerAuthority.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import CampaignSharingPanel from '../../../src/ui/campaigns/CampaignSharingPanel.js';

test('a real DM arrival grant previews native authorized terrain without creating an observer, sprite or movement budget', async () => {
  const table = await createPlayerAuthorityTable({ placed: false, activeTurn: false });
  let app;
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
    const grant = await table.dm.connection.call('grantPlacement', [
      table.campaign.id,
      table.playerId,
      table.characterId,
      { mapId: 'map-main', gridX: 1, gridY: 1 },
    ]);
    await app.refresh();
    await app.chooseArrivalGrant(grant.id);
    expect(gameManager.threeSceneManager.scene.visible).toBe(true);
    expect(gameManager.campaignMapId).toBe('map-main');
    expect(gameManager.placedTokens).toEqual([]);
    expect(app.state.observerTokenId).toBeNull();
    expect(app.state.publicScene.actors).toEqual([]);
    expect(app.state.gameplay.ownedTokens).toEqual([]);
    expect(app.sheets.library.list()).toHaveLength(1);
    expect(table.calls.at(-1).args[0]).toMatchObject({
      placementGrantId: grant.id,
      presentationVersion: 1,
    });
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('the assigned roster reaches grant preview, explicit Next sprite placement and safe retrieval without writing appearance preferences', async () => {
  const table = await createPlayerAuthorityTable({
    placed: false,
    activeTurn: false,
    characterUpdates: { hp: { current: 12, max: 20, temp: 4 }, speed: 45 },
  });
  let app;
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
    await table.dm.connection.call('grantPlacement', [
      table.campaign.id,
      table.playerId,
      table.characterId,
      { mapId: 'map-main', gridX: 2, gridY: 2 },
    ]);
    await app.refresh();
    const selector = document.querySelector(`[data-player-appearance="${table.characterId}"]`);
    expect(selector).not.toBeNull();
    expect(selector.value).toBe('');
    expect(document.querySelector(`[data-player-place="${table.characterId}"]`).disabled).toBe(
      true
    );
    selector.value = 'female-archer';
    selector.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector(`[data-player-arrival="${table.characterId}"]`).click();
    for (let wait = 0; app.state.view?.mode !== 'placement-preview' && wait < 100; wait++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const place = document.querySelector(`[data-player-place="${table.characterId}"]`);
    expect(place.disabled).toBe(false);
    place.click();
    await app.commands.idle;
    expect(gameManager.placedTokens).toHaveLength(1);
    expect(gameManager.placedTokens[0].type).toBe('female-archer');
    document.querySelector(`[data-player-retrieve="${table.characterId}"]`).click();
    await app.commands.idle;
    expect(gameManager.placedTokens).toEqual([]);
    expect(app.sheets.library.get(table.characterId)).toMatchObject({
      hp: { current: 12, max: 20, temp: 4 },
      speed: 45,
    });
    expect(document.querySelector(`[data-player-appearance="${table.characterId}"]`).value).toBe(
      'female-archer'
    );
    expect(table.calls.filter(({ operation }) => operation === 'playerCommit')).toEqual([]);
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('the real DM sharing UI issues an explicit arrival grant rather than requiring hidden API calls', async () => {
  const table = await createPlayerAuthorityTable({ placed: false, activeTurn: false });
  let panel;
  try {
    panel = new CampaignSharingPanel({
      workspace: {
        store: {
          identity: table.dm.identity,
          sessionCall: (operation, args) => table.dm.connection.call(operation, args),
          readCharacters: (id) => table.dm.connection.call('readCharacters', [id]),
        },
      },
      campaignId: table.campaign.id,
    });
    await panel.open();
    const form = panel.root.querySelector(`[data-arrival-character="${table.characterId}"]`);
    expect(form).not.toBeNull();
    form.querySelector('[data-arrival-map]').value = 'map-main';
    form.querySelector('[data-arrival-x]').value = '2';
    form.querySelector('[data-arrival-y]').value = '1';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    for (let wait = 0; panel.busy && wait < 100; wait++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    expect(panel.status.textContent).toMatch(/granted/i);
    const state = await table.connection.call('playerState', [{ presentationVersion: 1 }]);
    expect(state.placementGrants).toEqual([
      expect.objectContaining({
        characterId: table.characterId,
        mapId: 'map-main',
        gridX: 2,
        gridY: 1,
      }),
    ]);
    expect(panel.root.textContent).not.toContain('read-only');
  } finally {
    panel?.destroy();
    await table.close();
    document.body.replaceChildren();
  }
}, 30000);

test('arrival placement uses a real canonical sprite choice and preserves the saved character instead of manufacturing an observer', async () => {
  const table = await createPlayerAuthorityTable({
    placed: false,
    activeTurn: false,
    characterUpdates: { hp: { current: 12, max: 20, temp: 4 }, speed: 45 },
  });
  let app;
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
    const grant = await table.dm.connection.call('grantPlacement', [
      table.campaign.id,
      table.playerId,
      table.characterId,
      { mapId: 'map-main', gridX: 2, gridY: 2 },
    ]);
    await app.refresh();
    await app.chooseArrivalGrant(grant.id);
    const result = await app.commands.place(table.characterId, {
      appearance: 'female-archer',
      grantId: grant.id,
    });
    const token = gameManager.placedTokens[0];
    expect(token.id).toBe(result.receipt.tokenId);
    expect(token.id).not.toMatch(/^assigned-sheet-/);
    expect(token.characterSheetId).toBe(table.characterId);
    expect(token.type).toBe('female-archer');
    expect(token.world).toEqual({ x: 2.5, y: 0, z: 2.5 });
    expect(app.state.observerTokenId).toBe(token.id);
    expect(app.sheets.library.get(table.characterId)).toMatchObject({
      hp: { current: 12, max: 20, temp: 4 },
      speed: 45,
    });
    await app.refresh();
    expect(table.calls.at(-1).args[0]).not.toHaveProperty('placementGrantId');
    expect(gameManager.placedTokens).toHaveLength(1);
  } finally {
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);
