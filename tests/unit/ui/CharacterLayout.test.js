import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import snapshot from '../../../assets/data/srd2014.json';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

let sheets;
let token;
let library;

beforeEach(() => {
  localStorage.clear();
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  library = new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: catalog.entries,
    classes: catalog.classes,
  });
  token = { id: 'hero', type: 'knight', name: 'Hero' };
  const gameManager = {
    placedTokens: [token],
    token3DAdapter: {
      setSelectedToken: jest.fn(),
      getSelectedToken: () => token,
      refreshMovementRange: jest.fn(),
      isMovementInProgress: () => false,
    },
  };
  sheets = new CharacterSheetWindow({
    gameManager,
    characterServices: { catalog, library },
  }).attach();
});

afterEach(() => {
  sheets.destroy();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

const button = (label) => sheets.root.querySelector(`[aria-label="${label}"]`);
const customize = () => button('Customize play layout').click();
const transfer = () => {
  const data = new Map();
  return {
    types: [],
    effectAllowed: 'none',
    dropEffect: 'none',
    setData(type, value) {
      data.set(type, value);
      if (!this.types.includes(type)) this.types.push(type);
    },
    getData(type) {
      return data.get(type) || '';
    },
  };
};
const dragEvent = (node, type, data) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: data });
  node.dispatchEvent(event);
};
const drop = (handle, target) => {
  const data = transfer();
  dragEvent(handle, 'dragstart', data);
  dragEvent(target, 'dragover', data);
  dragEvent(target, 'drop', data);
  dragEvent(handle, 'dragend', data);
};

test('favoriting moves a card without duplicates, never spends while editing, and still hides spent uses', async () => {
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
  expect(button('Customize play layout')).not.toBeNull();
  customize();
  expect(button('Use Dash').disabled).toBe(true);
  button('Favorite Dash').click();
  expect(
    sheets.root.querySelector('[data-play-section="favorites"] [data-action-id="dash"]')
  ).not.toBeNull();
  expect(
    sheets.root.querySelector('[aria-label="Action options"] [data-action-id="dash"]')
  ).toBeNull();
  expect(sheets.root.querySelectorAll('[data-action-id="dash"]')).toHaveLength(1);
  button('Use Dash').click();
  const session = sheets.gameManager.characterServices.combat;
  expect(session.status(token).actions).toBe(1);
  customize();
  button('Use Dash').click();
  expect(session.status(token).actions).toBe(0);
  expect(button('Use Dash')).toBeNull();
  session.endTurn();
  session.startTurn(token);
  expect(
    sheets.root.querySelector('[data-play-section="favorites"] [data-action-id="dash"]')
  ).not.toBeNull();
  expect(library.layouts.page(token.characterSheetId, 'combat').favorites).toEqual(['dash']);
});

test('sections and cards reorder with keyboard controls while Non-combat keeps its own favorite checks', async () => {
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
  customize();
  expect(button('Move Bonus action section earlier')).not.toBeNull();
  button('Move Bonus action section earlier').click();
  button('Move Dodge earlier').click();
  button('Move Dodge earlier').click();
  expect(document.activeElement.closest('[data-play-card]')?.dataset.playCard).toBe('dodge');
  expect(document.activeElement.disabled).toBe(false);
  const sections = () =>
    Array.from(
      sheets.root.querySelectorAll('[data-play-section]'),
      (item) => item.dataset.playSection
    );
  const actions = () =>
    Array.from(
      sheets.root.querySelectorAll('[data-play-section="action"] [data-play-card]'),
      (item) => item.dataset.playCard
    );
  expect(sections().indexOf('bonus')).toBeLessThan(sections().indexOf('action'));
  expect(actions().slice(0, 2)).toEqual(['dodge', 'dash']);
  sheets.root.querySelector('[data-sheet-section="noncombat"]').click();
  expect(button('Customize play layout').getAttribute('aria-pressed')).toBe('false');
  customize();
  button('Favorite Stealth').click();
  expect(
    sheets.root.querySelector('[data-play-section="favorites"] [aria-label="Roll Stealth"]')
  ).not.toBeNull();
  expect(
    sheets.root.querySelector('[data-play-section="skills"] [aria-label="Roll Stealth"]')
  ).toBeNull();
  customize();
  const mode = sheets.root.querySelector('[aria-label="Character roll mode"]');
  mode.value = 'advantage';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  button('Roll Stealth').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(1);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  expect(sections().indexOf('bonus')).toBeLessThan(sections().indexOf('action'));
  expect(actions().slice(0, 2)).toEqual(['dodge', 'dash']);
  expect(library.layouts.page(token.characterSheetId, 'combat').favorites).toEqual([]);
  expect(library.layouts.page(token.characterSheetId, 'noncombat').favorites).toEqual([
    'roll:skill:stealth',
  ]);
});

test('drag handles move sections and cards, including pinning and unpinning, without using actions', async () => {
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
  customize();
  expect(button('Drag Dodge')).not.toBeNull();
  drop(button('Drag Dodge'), sheets.root.querySelector('[data-play-card="dash"]'));
  expect(library.layouts.page(token.characterSheetId, 'combat').cardOrder.action[0]).toBe('dodge');
  drop(
    button('Drag Bonus action section'),
    sheets.root.querySelector('[data-play-section="action"]')
  );
  const order = library.layouts.page(token.characterSheetId, 'combat').sectionOrder;
  expect(order.indexOf('bonus')).toBeLessThan(order.indexOf('action'));
  drop(button('Drag Dodge'), sheets.root.querySelector('[data-play-section="favorites"]'));
  expect(library.layouts.page(token.characterSheetId, 'combat').favorites).toEqual(['dodge']);
  expect(sheets.root.querySelectorAll('[data-play-card="dodge"]')).toHaveLength(1);
  drop(button('Drag Dodge'), sheets.root.querySelector('[data-play-card="dash"]'));
  expect(library.layouts.page(token.characterSheetId, 'combat').favorites).toEqual([]);
  expect(
    sheets.root.querySelector('[data-play-section="action"] [data-play-card="dodge"]')
  ).not.toBeNull();
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(1);
});

test('reset confirms before clearing only the current page and never changes character resources', async () => {
  await sheets.open(token);
  const id = token.characterSheetId;
  library.layouts.savePage(id, 'noncombat', {
    sectionOrder: ['skills'],
    cardOrder: {},
    favorites: ['roll:skill:stealth'],
  });
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
  customize();
  button('Favorite Dash').click();
  const character = library.get(id);
  expect(button('Reset this page layout')).not.toBeNull();
  jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
  button('Reset this page layout').click();
  expect(library.layouts.page(id, 'combat').favorites).toEqual(['dash']);
  button('Reset this page layout').click();
  expect(library.layouts.page(id, 'combat')).toEqual({
    sectionOrder: [],
    cardOrder: {},
    favorites: [],
  });
  expect(library.layouts.page(id, 'noncombat').favorites).toEqual(['roll:skill:stealth']);
  expect(library.get(id)).toEqual(character);
  expect(sheets.gameManager.characterServices.combat.status(token)).toMatchObject({
    actions: 1,
    bonusActions: 1,
    reactions: 1,
    movement: { remaining: 30 },
  });
});

test('foreign-category and stale-page drops report errors without changing a layout or action cost', async () => {
  const errors = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
  customize();
  drop(button('Drag Dash'), sheets.root.querySelector('[data-play-section="bonus"]'));
  expect(errors).toHaveBeenCalledTimes(1);
  expect(library.layouts.page(token.characterSheetId, 'combat').favorites).toEqual([]);
  const data = transfer();
  dragEvent(button('Drag Dash'), 'dragstart', data);
  sheets.root.querySelector('[data-sheet-section="noncombat"]').click();
  customize();
  dragEvent(sheets.root.querySelector('[data-play-section="utility"]'), 'drop', data);
  expect(errors).toHaveBeenCalledTimes(2);
  expect(library.layouts.page(token.characterSheetId, 'noncombat')).toEqual({
    sectionOrder: [],
    cardOrder: {},
    favorites: [],
  });
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(1);
});

test('saved-character switching and external preference updates preserve separate layouts and turn costs', async () => {
  await sheets.open(token);
  const hero = token.characterSheetId;
  const other = library.create('Other');
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
  customize();
  button('Favorite Dash').click();
  const choose = (id) => {
    const select = button('Saved characters');
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  choose(other);
  expect(button('Customize play layout').getAttribute('aria-pressed')).toBe('false');
  customize();
  button('Favorite Hide').click();
  library.layouts.savePage(other, 'combat', {
    sectionOrder: [],
    cardOrder: {},
    favorites: ['dodge'],
  });
  window.dispatchEvent(new StorageEvent('storage', { key: library.layouts.key(other) }));
  expect(
    sheets.root.querySelector('[data-play-section="favorites"] [data-play-card="dodge"]')
  ).not.toBeNull();
  choose(hero);
  expect(
    sheets.root.querySelector('[data-play-section="favorites"] [data-play-card="dash"]')
  ).not.toBeNull();
  expect(library.layouts.page(other, 'combat').favorites).toEqual(['dodge']);
  expect(library.layouts.page(hero, 'combat').favorites).toEqual(['dash']);
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(1);
});

test('a failed preference save reports the error and does not pretend a card was pinned', async () => {
  const errors = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
  customize();
  const original = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key === library.layouts.key(token.characterSheetId)) throw new Error('Storage quota');
    return original.call(this, key, value);
  });
  button('Favorite Dash').click();
  expect(errors).toHaveBeenCalled();
  expect(library.layouts.page(token.characterSheetId, 'combat').favorites).toEqual([]);
  expect(button('Favorite Dash')).not.toBeNull();
  expect(button('Unfavorite Dash')).toBeNull();
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(1);
});
