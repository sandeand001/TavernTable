import { readFileSync } from 'node:fs';
import path from 'node:path';
import { preparePlayerApplication } from '../../../src/ui/sessions/PlayerApplication.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { createPlayerAuthorityTable } from '../../helpers/playerAuthority.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';

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
