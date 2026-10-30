import CompendiumSidebar from '../../../src/ui/characters/CompendiumSidebar.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import snapshot from '../../../assets/data/srd2014.json';

let sidebar;
let services;
let token;
let gameManager;

beforeEach(() => {
  localStorage.clear();
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  services = {
    catalog,
    library: new CharacterLibrary({
      ruleset: '2014',
      storage: globalThis.localStorage,
      catalog: catalog.entries,
      classes: catalog.classes,
    }),
  };
  token = { id: 'hero', type: 'knight', name: 'Aster' };
  gameManager = {
    placedTokens: [token],
    token3DAdapter: { getSelectedToken: () => token },
  };
  sidebar = new CompendiumSidebar({ gameManager, services }).attach(document.body);
});

afterEach(() => {
  sidebar?.destroy();
  document.body.replaceChildren();
});

test('the independent compendium can add to the selected creature without opening a sheet', async () => {
  await sidebar.open();
  const search = sidebar.root.querySelector('[aria-label="Search compendium"]');
  search.value = 'shield';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  sidebar.root.querySelector('[aria-label="Add Shield"]').click();
  expect(document.querySelector('.character-sheet-window')).toBeNull();
  const saved = services.library.get(token.characterSheetId);
  expect(saved.name).toBe('Aster');
  expect(saved.equipment).toEqual([
    expect.objectContaining({ entryId: 'item:shield', equipped: false }),
  ]);
  expect(sidebar.root.querySelector('[aria-label="Compendium status"]').textContent).toContain(
    'Shield'
  );
  expect(sidebar.root.querySelector('[aria-label="Compendium status"]').textContent).toContain(
    'Aster'
  );
});

test('the default destination names the saved character as well as its creature', async () => {
  token.characterSheetId = services.library.create('Mira');
  await sidebar.open();
  const destination = sidebar.root.querySelector('[aria-label="Compendium destination"]');
  expect(destination.selectedOptions[0].textContent).toContain('Aster');
  expect(destination.selectedOptions[0].textContent).toContain('Mira');
});

test('browsing needs no selection, and the picker can add to a saved character without a token link', async () => {
  gameManager.token3DAdapter.getSelectedToken = () => null;
  const id = services.library.create('Mira');
  await sidebar.open();
  const search = sidebar.root.querySelector('[aria-label="Search compendium"]');
  search.value = 'shield';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(sidebar.root.querySelector('[aria-label="Add Shield"]').disabled).toBe(true);
  expect(sidebar.root.querySelector('[aria-label="Details Shield"]').disabled).toBe(false);
  const destination = sidebar.root.querySelector('[aria-label="Compendium destination"]');
  destination.value = id;
  destination.dispatchEvent(new Event('change', { bubbles: true }));
  sidebar.root.querySelector('[aria-label="Add Shield"]').click();
  expect(services.library.get(id).equipment[0].entryId).toBe('item:shield');
  expect(token.characterSheetId).toBeUndefined();
});
