import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import CompendiumSidebar from '../../../src/ui/characters/CompendiumSidebar.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

globalThis.TextDecoder ??= TextDecoder;

test('real campaign sheets acknowledge creation, edits, equipment, recovery and layouts before showing success', async () => {
  const workspace = await CampaignWorkspace.load({
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await workspace.create({ name: 'Sheets', ruleset: '2014' });
  const services = await workspace.open(campaign.id);
  const token = { id: 'hero', type: 'knight', name: 'Original' };
  const gameManager = {
    placedTokens: [token],
    campaignContext: services,
    token3DAdapter: { setSelectedToken: jest.fn(), getSelectedToken: () => token },
  };
  const sidebar = new CompendiumSidebar({ gameManager, services }).attach(document.body);
  const sheets = new CharacterSheetWindow({ gameManager, characterServices: services }).attach();
  const button = (label) => sheets.root.querySelector(`[aria-label="${label}"]`);
  try {
    await sheets.open(token);
    expect(typeof token.characterSheetId).toBe('string');
    const id = token.characterSheetId;
    const name = sheets.heading;
    name.focus();
    name.textContent = 'Saved name';
    name.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
    );
    expect(services.library.get(id).name).toBe('Original');
    expect(sheets.root.querySelector('.sheet-save-status').textContent).toContain('Saving');
    await services.library.flush();
    await sheets.renameReady;
    expect(services.library.get(id).name).toBe('Saved name');

    await sidebar.open();
    const search = sidebar.root.querySelector('[aria-label="Search compendium"]');
    search.value = 'Chain Mail';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    sidebar.root.querySelector('[aria-label="Add and equip Chain Mail"]').click();
    await services.library.flush();
    expect(services.library.stats(id).armorClass).toBe(16);

    button('Damage hit points').click();
    const damage = sheets.root.querySelector('[aria-label="Damage amount"]');
    damage.value = '9';
    sheets.root
      .querySelector('[aria-label="Hit point adjustment"]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(services.library.get(id).hp.current).toBe(10);
    await services.library.flush();
    expect(services.library.get(id).hp.current).toBe(1);
    button('Long rest').click();
    sheets.root.querySelector('[data-rest-action="complete-long"]').click();
    expect(services.library.get(id).hp.current).toBe(1);
    await services.library.flush();
    expect(services.library.get(id).hp.current).toBe(10);

    sheets.root.querySelector('[data-sheet-section="combat"]').click();
    button('Customize play layout').click();
    button('Favorite Dash').click();
    await services.library.flush();
    expect(services.library.layouts.page(id, 'combat').favorites).toContain('dash');
    expect(
      sheets.root.querySelector('[data-play-section="favorites"] [data-action-id="dash"]')
    ).not.toBeNull();
  } finally {
    await services.library.flush();
    sheets.destroy();
    sidebar.destroy();
    workspace.close();
    document.body.replaceChildren();
  }
}, 30000);

test.each(['2014', '2024'])(
  'the %s information card acknowledges edits and restores all identity values after reopening',
  async (ruleset) => {
    const workspace = await CampaignWorkspace.load({
      fetch: fetchBundledResource,
      indexedDB: testIndexedDB(),
      crypto: webcrypto,
    });
    const campaign = await workspace.create({ name: 'Identity values', ruleset });
    const services = await workspace.open(campaign.id);
    const id = await services.library.create('Reader');
    const token = { id: 'hero', type: 'mannequin', name: 'Reader', characterSheetId: id };
    const gameManager = {
      placedTokens: [token],
      campaignContext: services,
      token3DAdapter: { setSelectedToken: jest.fn(), getSelectedToken: () => token },
    };
    const sheets = new CharacterSheetWindow({ gameManager, characterServices: services }).attach();
    try {
      await sheets.open(token);
      for (const [label, field, value] of [
        ['Character class', 'classId', 'wizard'],
        ['Level', 'level', '5'],
        ['Ancestry', 'ancestry', 'High Elf'],
        ['Background', 'background', 'Sage'],
        ['Alignment', 'alignment', 'Neutral good'],
      ]) {
        const input = sheets.root.querySelector(`[aria-label="${label}"]`);
        const previous = services.library.get(id)[field];
        input.value = value;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
        expect(services.library.get(id)[field]).toBe(previous);
        await services.library.flush();
        expect(services.library.get(id)[field]).toBe(field === 'level' ? Number(value) : value);
      }
      sheets.root.querySelector('[data-sheet-section="combat"]').click();
      expect(sheets.root.querySelector('[aria-label="Class"]').textContent).toBe('Wizard');
      expect(
        sheets.root.querySelector('[aria-label="Character class"]').closest('.sheet-section').hidden
      ).toBe(true);
      const reopened = await workspace.open(campaign.id);
      expect(reopened.library.get(id)).toMatchObject({
        classId: 'wizard',
        level: 5,
        ancestry: 'High Elf',
        background: 'Sage',
        alignment: 'Neutral good',
      });
    } finally {
      sheets.destroy();
      workspace.close();
      document.body.replaceChildren();
    }
  },
  30000
);

test('one plain-text title edits the name across all pages, updating linked labels and persisting without a prompt', async () => {
  const workspace = await CampaignWorkspace.load({
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await workspace.create({ name: 'Direct names', ruleset: '2024' });
  const services = await workspace.open(campaign.id);
  const id = await services.library.create('Original');
  const first = { id: 'hero', type: 'mannequin', name: 'Original', characterSheetId: id };
  const second = { id: 'copy', type: 'mannequin', name: 'Original', characterSheetId: id };
  const gameManager = {
    placedTokens: [first, second],
    campaignContext: services,
    token3DAdapter: { setSelectedToken: jest.fn(), getSelectedToken: () => first },
  };
  const sheets = new CharacterSheetWindow({ gameManager, characterServices: services }).attach();
  const prompt = jest.spyOn(window, 'prompt').mockImplementation(() => {
    throw new Error('Native prompts are unavailable in this host');
  });
  try {
    await sheets.open(second);
    await sheets.open(first);
    gameManager.characterServices.combat.startTurn(first);
    for (const section of ['core', 'combat', 'noncombat']) {
      sheets.root.querySelector(`[data-sheet-section="${section}"]`).click();
      const field = sheets.root.querySelector('[aria-label="Character name"]');
      expect(field).not.toBeNull();
      expect(field.getAttribute('contenteditable')).toBe('plaintext-only');
      expect(sheets.root.querySelectorAll('[aria-label="Character name"]')).toHaveLength(1);
      expect(
        sheets.characterContent.main.querySelector('[data-character-field="name"]')
      ).toBeNull();
      field.focus();
      field.textContent = `Sentinel ${section}`;
      gameManager.characterServices.combat.adjustEconomy(first, { actions: 1 });
      expect(sheets.root.querySelector('[aria-label="Character name"]')).toBe(field);
      expect(field.textContent).toBe(`Sentinel ${section}`);
      field.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
      await sheets.renameReady;
      await services.library.flush();
      expect(services.library.get(id).name).toBe(`Sentinel ${section}`);
      expect(first.name).toBe(`Sentinel ${section}`);
      expect(second.name).toBe(`Sentinel ${section}`);
      expect(sheets.tabs.get(first).button.textContent).toBe(`Sentinel ${section}`);
      expect(sheets.tabs.get(second).button.textContent).toBe(`Sentinel ${section}`);
    }
    const invalid = sheets.root.querySelector('[aria-label="Character name"]');
    invalid.focus();
    invalid.textContent = '   ';
    invalid.blur();
    await sheets.renameReady;
    await services.library.flush();
    expect(services.library.get(id).name).toBe('Sentinel noncombat');
    expect(sheets.root.querySelector('.sheet-save-status').classList.contains('sheet-error')).toBe(
      true
    );
    expect(prompt).not.toHaveBeenCalled();
    const reopened = await workspace.open(campaign.id);
    expect(reopened.library.get(id).name).toBe('Sentinel noncombat');
  } finally {
    prompt.mockRestore();
    sheets.destroy();
    workspace.close();
    document.body.replaceChildren();
  }
}, 30000);

test('a pending title rename remains bound to its original character, and a failed save changes no stored name', async () => {
  const workspace = await CampaignWorkspace.load({
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await workspace.create({ name: 'Title save boundaries', ruleset: '2014' });
  const services = await workspace.open(campaign.id);
  const firstId = await services.library.create('First');
  const secondId = await services.library.create('Second');
  const first = { id: 'first', type: 'mannequin', name: 'First', characterSheetId: firstId };
  const second = { id: 'second', type: 'knight', name: 'Second', characterSheetId: secondId };
  const gameManager = {
    placedTokens: [first, second],
    campaignContext: services,
    token3DAdapter: { setSelectedToken: jest.fn(), getSelectedToken: () => first },
  };
  const sheets = new CharacterSheetWindow({ gameManager, characterServices: services }).attach();
  try {
    await sheets.open(first);
    sheets.heading.focus();
    sheets.heading.textContent = 'First renamed';
    await sheets.open(second);
    await sheets.renameReady;
    expect(services.library.get(firstId).name).toBe('First renamed');
    expect(services.library.get(secondId).name).toBe('Second');
    expect(sheets.heading.textContent).toBe('Second');
    expect(sheets.tabs.get(first).button.textContent).toBe('First renamed');
    workspace.store.close();
    sheets.heading.focus();
    sheets.heading.textContent = 'Rejected rename';
    sheets.heading.blur();
    expect(await sheets.renameReady).toBe(false);
    expect(services.library.get(secondId).name).toBe('Second');
    expect(second.name).toBe('Second');
    expect(sheets.heading.textContent).toBe('Second');
    expect(sheets.root.querySelector('.sheet-save-status').classList.contains('sheet-error')).toBe(
      true
    );
    expect(sheets.root.querySelector('.sheet-save-status').textContent).toContain('closed');
  } finally {
    sheets.destroy();
    workspace.close();
    document.body.replaceChildren();
  }
}, 30000);

test('2024 short-rest UI spends Sorcerous Restoration only when its optional choice is selected', async () => {
  const workspace = await CampaignWorkspace.load({
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await workspace.create({ name: 'Focus recovery', ruleset: '2024' });
  const services = await workspace.open(campaign.id);
  const id = await services.library.create('Sorcerer');
  await services.library.edit(id, { classId: 'sorcerer', level: 5 });
  await services.library.rest.setResourceRemaining(id, 'sorcery-points', 0);
  const token = { id: 'hero', type: 'knight', characterSheetId: id };
  const gameManager = {
    placedTokens: [token],
    campaignContext: services,
    token3DAdapter: { setSelectedToken: jest.fn() },
  };
  const sheets = new CharacterSheetWindow({ gameManager, characterServices: services }).attach();
  try {
    await sheets.open(token);
    sheets.root.querySelector('[aria-label="Short rest"]').click();
    const choice = sheets.root.querySelector('[data-short-recovery="sorcerousRestoration"]');
    expect(choice).not.toBeNull();
    choice.checked = true;
    sheets.root.querySelector('[data-rest-action="complete-short"]').click();
    await services.library.flush();
    const resources = services.library.rest.status(id).resources;
    expect(resources.find((row) => row.id === 'sorcery-points').remaining).toBe(2);
    expect(resources.find((row) => row.id === 'sorcerous-restoration').remaining).toBe(0);
  } finally {
    await services.library.flush();
    sheets.destroy();
    workspace.close();
    document.body.replaceChildren();
  }
}, 30000);
