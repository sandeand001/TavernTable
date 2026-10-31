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

const history = () => sheets.root.querySelector('aside[aria-label="Recent action rolls"]');
const labels = () =>
  Array.from(history().querySelectorAll('[data-history-entry] > strong'), (row) => row.textContent);

test('a separate history rail stays outside customizable sections and switches between All and This turn', async () => {
  await sheets.open(token);
  expect(history()).not.toBeNull();
  expect(history().closest('.sheet-editor-primary')).toBeNull();
  const session = sheets.gameManager.characterServices.combat;
  session.startTurn(token);
  session.useAction(token, 'dash');
  session.endTurn();
  session.startTurn(token);
  session.useAction(token, 'dodge');
  expect(labels()).toEqual(['Dodge', 'Dash']);
  history().querySelector('[data-history-filter="turn"]').click();
  expect(labels()).toEqual(['Dodge']);
  history().querySelector('[data-history-filter="all"]').click();
  expect(labels()).toEqual(['Dodge', 'Dash']);
  const legacyLayout = {
    sectionOrder: ['recent', 'skills', 'action'],
    cardOrder: {},
    favorites: [],
  };
  library.layouts.savePage(token.characterSheetId, 'combat', legacyLayout);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  expect(sheets.root.querySelector('[data-play-section="recent"]')).toBeNull();
  expect(library.layouts.page(token.characterSheetId, 'combat')).toEqual(legacyLayout);
  sheets.root.querySelector('[data-sheet-section="noncombat"]').click();
  expect(labels()).toEqual(['Dodge', 'Dash']);
});

test('attacks, free checks and follow-up damage all enter history without duplicate uses or extra costs', async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  await sheets.open(token);
  const sword = library.add(token.characterSheetId, 'item:longsword');
  library.equip(token.characterSheetId, sword, true);
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  const mode = sheets.root.querySelector('[aria-label="Character roll mode"]');
  mode.value = 'advantage';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  sheets.root.querySelector(`[data-action-id="attack:${sword}"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toEqual(['Longsword attack: 13']);
  sheets.root.querySelector('[aria-label="Roll Stealth"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toHaveLength(2);
  expect(labels()[0]).toContain('Stealth');
  history().querySelector('[data-sheet-action="recent-roll"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toHaveLength(3);
  expect(labels()[0]).toContain('Longsword damage');
  expect(sheets.gameManager.characterServices.combat.status(token)).toMatchObject({
    actions: 0,
    bonusActions: 1,
    reactions: 1,
  });
});

test('older follow-up rolls stay usable in All history after newer uses and End Combat', async () => {
  jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  await sheets.open(token);
  const sword = library.add(token.characterSheetId, 'item:longsword');
  library.equip(token.characterSheetId, sword, true);
  const signal = library.actions.upsert(token.characterSheetId, { name: 'Signal', cost: 'free' });
  const session = sheets.gameManager.characterServices.combat;
  const use = session.useAction(token, `attack:${sword}`);
  for (let index = 0; index < 12; index++) session.useAction(token, `custom:${signal}`);
  session.endCombat();
  expect(labels()).toHaveLength(13);
  const before = library.get(token.characterSheetId);
  history().querySelector(`[data-sequence="${use.sequence}"][data-part="0"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toHaveLength(14);
  expect(labels()[0]).toContain('Longsword damage');
  expect(library.get(token.characterSheetId)).toEqual(before);
});

test('short-rest Hit Dice appear as free-play healing rolls without changing rest mechanics', async () => {
  const dice = await import('../../../src/systems/dice/dice.js');
  jest.spyOn(dice, 'rollDiceExpression').mockResolvedValue({
    cancelled: false,
    text: 'Hit Die = 6',
    values: [6],
    total: 6,
  });
  await sheets.open(token);
  library.edit(token.characterSheetId, {
    classId: 'fighter',
    level: 5,
    hp: { max: 30, current: 2 },
  });
  await sheets.open(token);
  sheets.root.querySelector('[aria-label="Short rest"]').click();
  sheets.root.querySelector('[data-rest-action="complete-short"]').click();
  sheets.root.querySelector('[data-rest-action="hit-die"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toHaveLength(1);
  expect(labels()[0]).toContain('Hit Die');
  expect(history().textContent).toContain('Free play');
  expect(library.get(token.characterSheetId).hp.current).toBe(8);
  expect(library.rest.status(token.characterSheetId).hitDice.spent).toBe(1);
});

test('a late check stays with its original character and turn after selecting another profile', async () => {
  const dice = await import('../../../src/systems/dice/dice.js');
  let finishRoll;
  jest.spyOn(dice, 'rollDiceExpression').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRoll = resolve;
      })
  );
  await sheets.open(token);
  const originalId = token.characterSheetId;
  const otherId = library.create('Other');
  const other = { id: 'other', type: 'knight', characterSheetId: otherId };
  sheets.gameManager.placedTokens.push(other);
  await sheets.open(token);
  const session = sheets.gameManager.characterServices.combat;
  session.startTurn(token);
  sheets.root.querySelector('[aria-label="Roll Strength check"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  session.endTurn();
  session.startTurn(other);
  const choose = (id) => {
    const select = sheets.root.querySelector('[aria-label="Saved characters"]');
    select.value = id;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  choose(otherId);
  finishRoll({ cancelled: false, text: 'Strength = 14', total: 14 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toEqual([]);
  choose(originalId);
  expect(labels()[0]).toContain('Strength check');
  history().querySelector('[data-history-filter="turn"]').click();
  expect(labels()).toEqual([]);
  history().querySelector('[data-history-filter="all"]').click();
  expect(labels()).toHaveLength(1);
  expect(session.status(other).actions).toBe(1);
});

test('new history refreshes beside a focused Core draft without discarding the field or focus', async () => {
  await sheets.open(token);
  const name = sheets.root.querySelector('[aria-label="Character name"]');
  name.focus();
  name.textContent = 'Uncommitted draft';
  const session = sheets.gameManager.characterServices.combat;
  const scope = session.captureRoll(token);
  session.recordRoll(scope, { label: 'Wisdom save', expression: '1d20', rollText: 'Wisdom = 12' });
  expect(labels()).toEqual(['Wisdom save']);
  expect(name.textContent).toBe('Uncommitted draft');
  expect(document.activeElement).toBe(name);
  history().querySelector('[data-history-filter="turn"]').click();
  expect(history().textContent).toContain('No combat turn is active');
});

test('a completed attack whose use became stale is logged as a roll, not a paid use or another character result', async () => {
  jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const dice = await import('../../../src/systems/dice/dice.js');
  let finishRoll;
  jest.spyOn(dice, 'rollDiceExpression').mockImplementation(
    () =>
      new Promise((resolve) => {
        finishRoll = resolve;
      })
  );
  await sheets.open(token);
  const id = token.characterSheetId;
  const sword = library.add(id, 'item:longsword');
  library.equip(id, sword, true);
  const otherId = library.create('Other');
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  sheets.root.querySelector(`[data-action-id="attack:${sword}"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const choose = (characterId) => {
    const select = sheets.root.querySelector('[aria-label="Saved characters"]');
    select.value = characterId;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };
  choose(otherId);
  finishRoll({ cancelled: false, text: 'Longsword attack = 14', total: 14 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toEqual([]);
  choose(id);
  const session = sheets.gameManager.characterServices.combat;
  expect(session.history(token)).toEqual([
    expect.objectContaining({ type: 'roll', rollText: 'Longsword attack = 14' }),
  ]);
  expect(labels()[0]).toContain('use not committed');
  expect(session.status(token).actions).toBe(1);
});

test('history omits character names even after a rename, while shared dice labels keep their actor', async () => {
  const dice = await import('../../../src/systems/dice/dice.js');
  let finishRoll;
  let requestedLabel;
  jest.spyOn(dice, 'rollDiceExpression').mockImplementation((request) => {
    requestedLabel = request.label;
    return new Promise((resolve) => {
      finishRoll = resolve;
    });
  });
  await sheets.open(token);
  library.edit(token.characterSheetId, { name: 'Ari: North' });
  await sheets.open(token);
  sheets.root.querySelector('[aria-label="Roll Strength check"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  library.edit(token.characterSheetId, { name: 'Renamed' });
  await sheets.open(token);
  finishRoll({ cancelled: false, text: `${requestedLabel}: 1d20 [12] = 12`, total: 12 });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toEqual(['Strength check']);
  expect(history().querySelector('.sheet-history-owner')).toBeNull();
  expect(history().textContent).not.toContain('Ari: North');
  expect(history().textContent).not.toContain('Renamed');
  expect(history().textContent).toContain('1d20 [12] = 12');
  expect(requestedLabel).toBe('Ari: North: Strength check');
  expect(sheets.gameManager.characterServices.combat.history(token)[0].rollText).toContain(
    'Ari: North'
  );
});

test('paid-use results omit the actor name captured before a rename without changing their cost', async () => {
  await sheets.open(token);
  const sword = library.add(token.characterSheetId, 'item:longsword');
  library.equip(token.characterSheetId, sword, true);
  const session = sheets.gameManager.characterServices.combat;
  session.startTurn(token);
  const ticket = session.prepareAction(token, `attack:${sword}`);
  library.edit(token.characterSheetId, { name: 'Renamed' });
  session.commitAction(ticket, 'Hero: Longsword attack: 1d20 [12] = 14');
  expect(labels()).toEqual(['Longsword']);
  expect(history().textContent).not.toContain('Hero:');
  expect(history().textContent).not.toContain('Renamed');
  expect(history().textContent).toContain('Longsword attack: 1d20 [12] = 14');
  expect(session.status(token).actions).toBe(0);
});

test('sheet history shows attack and damage totals on one line with details only on the total tooltip', async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.85);
  await sheets.open(token);
  library.edit(token.characterSheetId, { abilities: { strength: 16 } });
  const sword = library.add(token.characterSheetId, 'item:longsword');
  library.equip(token.characterSheetId, sword, true);
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  const mode = sheets.root.querySelector('[aria-label="Character roll mode"]');
  mode.value = 'advantage';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  sheets.root.querySelector(`[data-action-id="attack:${sword}"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toEqual(['Longsword attack: 23']);
  const total = history().querySelector('.roll-total');
  expect(total.title).toContain('1d20+5');
  expect(total.title).toContain('keep 18');
  expect(total.title).toContain('Advantage');
  expect(history().querySelector('[data-history-entry] > p')).toBeNull();
  expect(history().textContent).not.toContain('Hero:');
  history().querySelector('[data-sheet-action="recent-roll"][data-part="0"]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()[0]).toBe('Longsword damage (Slashing): 10');
  expect(history().querySelector('.roll-total').title).toContain('1d8+3');
  expect(sheets.gameManager.characterServices.combat.status(token).actions).toBe(0);
});

test('compact weapon results retain their opportunity-attack context and reaction cost', async () => {
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  await sheets.open(token);
  const sword = library.add(token.characterSheetId, 'item:longsword');
  library.equip(token.characterSheetId, sword, true);
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  const mode = sheets.root.querySelector('[aria-label="Character roll mode"]');
  mode.value = 'advantage';
  mode.dispatchEvent(new Event('change', { bubbles: true }));
  sheets.root.querySelector('[aria-label="Start turn"]').click();
  sheets.root.querySelector('[aria-label="End turn"]').click();
  sheets.root.querySelector(`[aria-label="Use Opportunity attack: Longsword"]`).click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(labels()).toEqual(['Opportunity attack: Longsword: 13']);
  expect(sheets.gameManager.characterServices.combat.status(token).reactions).toBe(0);
});
