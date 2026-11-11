import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import { campaignRecordCharacterId } from '../../../src/campaigns/CampaignCharacters.js';
import PlayerCharacterSheets from '../../../src/ui/sessions/PlayerCharacterSheets.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

globalThis.TextDecoder ??= TextDecoder;

test('a returning player opens and edits an assigned saved sheet without creating a character or gaining gameplay controls', async () => {
  const workspace = await CampaignWorkspace.load({
    storage: 'browser',
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  let player;
  try {
    const campaign = await workspace.create({ name: 'Assigned sheets', ruleset: '2024' });
    const services = await workspace.open(campaign.id);
    const hero = await services.library.create('Returning hero');
    const npc = await services.library.create('Private NPC');
    await services.library.edit(npc, { notes: 'DM SECRET NOTES' });
    const state = await workspace.store.readCharacters(campaign.id);
    state.records = state.records.filter((row) => campaignRecordCharacterId(row.key) === hero);
    let revision = state.revision;
    const connection = {
      call: jest.fn(async (operation) => {
        if (operation !== 'playerCommit') throw new Error('Unexpected player operation');
        return { revision: ++revision };
      }),
    };
    player = new PlayerCharacterSheets({
      connection,
      state,
      catalog: services.library.sourceCatalog,
    });
    await player.open(hero);
    expect(connection.call).not.toHaveBeenCalled();
    expect(player.library.list().map((entry) => entry.id)).toEqual([hero]);
    expect(player.sheets.root.textContent).not.toContain('DM SECRET NOTES');
    expect(player.sheets.root.querySelector('[data-sheet-action="new"]').disabled).toBe(true);
    expect(player.sheets.root.querySelector('[data-sheet-section="combat"]').disabled).toBe(true);
    const notesButton = player.sheets.root.querySelector('[data-sheet-section="notes"]');
    notesButton.click();
    const notes = player.sheets.root.querySelector('[data-character-field="notes"]');
    notes.value = 'My persistent notes';
    notes.dispatchEvent(new Event('change', { bubbles: true }));
    await player.library.flush();
    expect(player.library.get(hero).notes).toBe('My persistent notes');
    expect(connection.call).toHaveBeenCalledWith('playerCommit', [
      campaign.id,
      expect.objectContaining({ records: expect.any(Array) }),
    ]);
    expect(connection.call.mock.calls[0][1][1]).not.toHaveProperty('scene');
    await expect(player.open(npc)).rejects.toThrow('not assigned');
    player.refresh({ ...state, revision: player.library.revision, records: [] });
    expect(player.library.list()).toEqual([]);
    expect(player.manager.placedTokens).toEqual([]);
    await expect(player.open(hero)).rejects.toThrow('not assigned');
  } finally {
    player?.destroy();
    workspace.close();
    document.body.replaceChildren();
  }
}, 30000);
