import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import { campaignRecordCharacterId } from '../../../src/campaigns/CampaignCharacters.js';
import CloudAssignedCharacterSheets from '../../../src/ui/sessions/CloudAssignedCharacterSheets.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

globalThis.TextDecoder ??= TextDecoder;

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('Assigned cloud sheets did not reach the expected state');
}

test('joined sheets use short scoped cloud saves without opening a world or displaying private saved characters', async () => {
  const seed = await CampaignWorkspace.load({
    storage: 'browser',
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  let panel;
  try {
    const campaign = await seed.create({ name: 'Cloud assigned UI', ruleset: '2024' });
    const services = await seed.open(campaign.id);
    const hero = await services.library.create('Own cloud hero');
    const npc = await services.library.create('PRIVATE CLOUD NPC');
    const original = await seed.store.readCharacters(campaign.id);
    let revision = original.revision;
    const access = {
      version: 1,
      uid: 'assigned-player',
      campaignId: campaign.id,
      role: 'member',
      seatId: '11111111-1111-4111-8111-111111111111',
      accessGeneration: 1,
    };
    const state = {
      ...original,
      version: 1,
      access,
      characterIds: [hero],
      scene: null,
      records: original.records.filter((row) => campaignRecordCharacterId(row.key) === hero),
    };
    const identities = new Set();
    const store = {
      connection: {
        account: {
          subscribe(listener) {
            identities.add(listener);
            listener({ uid: access.uid, emailVerified: true });
            return () => identities.delete(listener);
          },
        },
      },
      uid: access.uid,
      storageInfo: { kind: 'cloud' },
      pending: null,
      saveState: { phase: 'idle', error: null },
      getParticipantAccess: jest.fn(async () => ({
        version: 1,
        access,
        characterIds: [hero],
        campaign: {
          id: campaign.id,
          name: campaign.name,
          ruleset: campaign.ruleset,
          coreVersion: campaign.coreVersion,
        },
      })),
      readAssignedCharacters: jest.fn(async () => state),
      commitAssignedCharacters: jest.fn(async () => ({ revision: ++revision })),
      subscribeSave: jest.fn((listener) => {
        listener({ phase: 'idle', error: null });
        return () => {};
      }),
      retryPending: jest.fn(),
      getLiveSession: jest.fn(() => {
        throw new Error('No live-game request is permitted');
      }),
      readCharacters: jest.fn(() => {
        throw new Error('No owner snapshot is permitted');
      }),
      commitScene: jest.fn(() => {
        throw new Error('No world command is permitted');
      }),
    };
    panel = new CloudAssignedCharacterSheets({
      workspace: { store, resources: seed.resources },
      campaignId: campaign.id,
    });
    await panel.open();
    expect(store.readAssignedCharacters).toHaveBeenCalledWith(campaign.id, access);
    expect(panel.root.textContent).not.toContain('PRIVATE CLOUD NPC');
    const open = panel.root.querySelector('[data-assigned-character]');
    expect(open.textContent).toContain('Own cloud hero');
    open.click();
    await until(() =>
      document.querySelector('.character-sheet-window [data-sheet-section="notes"]')
    );
    const sheet = document.querySelector('.character-sheet-window');
    expect(sheet.textContent).not.toContain('PRIVATE CLOUD NPC');
    expect(sheet.querySelector('[data-sheet-action="new"]').disabled).toBe(true);
    expect(sheet.querySelector('[data-sheet-section="combat"]').disabled).toBe(true);
    sheet.querySelector('[data-sheet-section="notes"]').click();
    const notes = sheet.querySelector('[data-character-field="notes"]');
    notes.value = 'Online between-game notes';
    notes.dispatchEvent(new Event('change', { bubbles: true }));
    await panel.sheets.library.flush();
    expect(store.commitAssignedCharacters).toHaveBeenCalledWith(
      campaign.id,
      expect.objectContaining({ records: expect.any(Array) }),
      access
    );
    const change = store.commitAssignedCharacters.mock.calls[0][1];
    expect(change).not.toHaveProperty('scene');
    expect(change.records.every((row) => campaignRecordCharacterId(row.key) === hero)).toBe(true);
    expect(change.records.some((row) => campaignRecordCharacterId(row.key) === npc)).toBe(false);
    expect(store.getLiveSession).not.toHaveBeenCalled();
    expect(store.readCharacters).not.toHaveBeenCalled();
    expect(store.commitScene).not.toHaveBeenCalled();
    for (const listener of identities) listener({ uid: 'another-account', emailVerified: true });
    expect(document.querySelector('.character-sheet-window')).toBeNull();
    expect(panel.root.querySelector('[data-assigned-character]')).toBeNull();
    await panel.destroy();
    expect(document.querySelector('.character-sheet-window')).toBeNull();
  } finally {
    await panel?.destroy();
    seed.close();
    document.body.replaceChildren();
  }
}, 30000);
