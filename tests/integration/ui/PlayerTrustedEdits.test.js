import { readFileSync } from 'node:fs';
import path from 'node:path';
import { preparePlayerApplication } from '../../../src/ui/sessions/PlayerApplication.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { createPlayerAuthorityTable } from '../../helpers/playerAuthority.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { playerGameplayState } from '../../../src/campaigns/ServerGameplay.js';

test('the real player sheet undoes only its server-owned last action receipt without a local combat authority', async () => {
  const table = await createPlayerAuthorityTable();
  let app;
  let sheet;
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
    await app.input.useAction(token, 'dash');
    expect(app.state.gameplay.ownedTokens[0].canUndo).toBe(true);
    sheet = new CharacterSheetWindow({ gameManager }).attach();
    await sheet.open(token);
    sheet.root.querySelector('[data-sheet-section="combat"]').click();
    const undo = sheet.root.querySelector('[data-sheet-action="use-undo"]');
    expect(undo).not.toBeNull();
    expect(undo.disabled).toBe(false);
    undo.click();
    for (
      let attempt = 0;
      attempt < 100 && app.state.gameplay.ownedTokens[0].economy.actions !== 1;
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 0));
    await app.commands.idle;
    const returned = app.state.gameplay.ownedTokens[0];
    expect(returned.economy.actions).toBe(1);
    expect(returned.movement).toEqual({ spentFeet: 0, remainingFeet: 30, allowanceFeet: 30 });
    expect(returned.canUndo).toBe(false);
    expect(sheet.root.querySelector('[data-sheet-action="use-undo"]')).toBeNull();
    const canonical = await table.dm.connection.call('readCharacters', [table.campaign.id]);
    const stored = playerGameplayState(
      JSON.parse(canonical.scene),
      gameManager.characterServices.library,
      [table.characterId]
    ).ownedTokens[0];
    expect(stored.economy.actions).toBe(1);
    expect(stored.movement.allowanceFeet).toBe(30);
    expect(gameManager.characterServices.combat).toBeNull();
    expect(
      table.calls
        .filter((call) => call.operation === 'playerCommand')
        .map((call) => call.args[1].kind)
    ).toEqual(['action.use', 'action.undo']);
  } finally {
    sheet?.destroy();
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('the real player Stand Up control charges half maximum Speed once without spending an action', async () => {
  const table = await createPlayerAuthorityTable({ characterUpdates: { conditions: ['prone'] } });
  let app;
  let sheet;
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
    sheet = new CharacterSheetWindow({ gameManager }).attach();
    await sheet.open(token);
    const stand = sheet.root.querySelector('[data-sheet-action="stand-up"]');
    expect(stand).not.toBeNull();
    expect(stand.disabled).toBe(false);
    expect(stand.textContent).toContain('(15 ft)');
    stand.click();
    for (
      let attempt = 0;
      attempt < 100 && app.sheets.library.get(table.characterId).conditions.includes('prone');
      attempt++
    )
      await new Promise((resolve) => setTimeout(resolve, 0));
    await app.commands.idle;
    await app.refresh();
    expect(app.sheets.library.get(table.characterId).conditions).not.toContain('prone');
    const own = app.state.gameplay.ownedTokens[0];
    expect(own.economy.actions).toBe(1);
    expect(own.movement).toEqual({ spentFeet: 15, remainingFeet: 15, allowanceFeet: 30 });
    expect(app.commands.availability('stand', token.id)).toMatchObject({
      allowed: false,
      code: 'stand-unavailable',
      costFeet: 15,
    });
    await expect(app.input.stand(token)).rejects.toMatchObject({ code: 'stand-unavailable' });
    expect(table.calls.filter((call) => call.operation === 'playerCommand')).toHaveLength(1);
    expect(table.calls.some((call) => call.operation === 'playerCommit')).toBe(false);
    expect(sheet.root.querySelector('[data-sheet-action="stand-up"]')).toBeNull();
  } finally {
    sheet?.destroy();
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);

test('the real host retains trusted native self HP, speed and spell-resource edits without accepting any player scene save', async () => {
  const table = await createPlayerAuthorityTable({
    characterUpdates: { classId: 'wizard', level: 5 },
    spells: ['spell:fly'],
  });
  let app;
  let sheet;
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
    sheet = new CharacterSheetWindow({ gameManager }).attach();
    await sheet.open(token);
    sheet.root.querySelector('[aria-label="Edit hit points"]').click();
    for (const [key, value] of Object.entries({ current: 12, max: 20, temp: 4 }))
      sheet.root.querySelector(`[data-health-value="${key}"]`).value = value;
    sheet.root
      .querySelector('[aria-label="Hit point adjustment"]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await app.sheets.library.flush();
    await app.refresh();
    expect(app.sheets.library.get(table.characterId).hp).toEqual({ current: 12, max: 20, temp: 4 });
    const speed = sheet.root.querySelector('[data-character-field="speed"]');
    expect(speed.disabled).toBe(false);
    speed.value = '45';
    speed.dispatchEvent(new Event('change', { bubbles: true }));
    await app.sheets.library.flush();
    await app.refresh();
    expect(app.sheets.library.get(table.characterId).speed).toBe(45);
    sheet.root.querySelector('[data-sheet-section="spells"]').click();
    const slots = sheet.root.querySelector('[data-used-slot="3"]');
    expect(slots.disabled).toBe(false);
    slots.value = '1';
    slots.dispatchEvent(new Event('change', { bubbles: true }));
    await app.sheets.library.flush();
    await app.refresh();
    expect(app.sheets.library.stats(table.characterId).spellSlots[2].used).toBe(1);
    const writes = table.calls.filter(({ operation }) => operation === 'playerCommit');
    expect(writes).toHaveLength(3);
    for (const write of writes) expect(write.args[1]).not.toHaveProperty('scene');
    expect(gameManager.placedTokens[0]).toBe(token);
    expect(token.world).toEqual({ x: 1.5, y: 0, z: 1.5 });
    expect(gameManager.characterServices.combat).toBeNull();
  } finally {
    sheet?.destroy();
    if (app) await app.destroy();
    await table.close();
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
}, 30000);
