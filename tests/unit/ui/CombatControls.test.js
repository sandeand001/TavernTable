import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import { getTokenMovementSettings } from '../../../src/entities/creatures/TokenMovement.js';
import { characterActionOptions } from '../../../src/entities/characters/combat/actions.js';
import data from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

let sheets, library, token, gm;
const button = (label) => sheets.root.querySelector(`[aria-label="${label}"]`);
const combatView = () => sheets.root.querySelector('[aria-label="Combat play"]');
const openCombat = async (classId = 'wizard') => {
  await sheets.open(token);
  library.edit(token.characterSheetId, { classId, level: 5, abilities: { intelligence: 16 } });
  await sheets.open(token);
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  button('Start turn').click();
};
const addSpell = (id) => {
  const owned = library.add(token.characterSheetId, id);
  library.prepare(token.characterSheetId, owned, true);
  return owned;
};

beforeEach(() => {
  localStorage.clear();
  const catalog = new CompendiumCatalog({ ...data, version: 1 });
  library = new CharacterLibrary({
    ruleset: '2024',
    storage: localStorage,
    catalog: catalog.entries,
    classes: catalog.classes,
  });
  token = {
    id: 'caster',
    type: 'mannequin',
    name: 'Caster',
    allegiance: 'friendly',
    creatureType: 'humanoid',
    creatureSize: 'medium',
  };
  gm = {
    placedTokens: [token],
    token3DAdapter: {
      setSelectedToken: jest.fn(),
      getSelectedToken: () => token,
      refreshMovementRange: jest.fn(),
      applyMovementStyle: jest.fn(),
      isMovementInProgress: () => false,
    },
  };
  sheets = new CharacterSheetWindow({
    gameManager: gm,
    characterServices: { library, catalog },
  }).attach();
});

afterEach(() => {
  sheets.destroy();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

test('Search and Study do not duplicate the combat skill-check section or disappear from the rules ledger', async () => {
  await openCombat();
  expect(combatView().querySelector('[data-action-id^="search-"]')).toBeNull();
  expect(combatView().querySelector('[data-action-id^="study-"]')).toBeNull();
  expect(
    combatView().querySelector('[data-play-section="skills"] [aria-label="Roll Perception"]')
  ).not.toBeNull();
  expect(
    combatView().querySelector('[data-play-section="skills"] [aria-label="Roll Arcana"]')
  ).not.toBeNull();
  expect(combatView().querySelector('[data-action-id="hide"]')).not.toBeNull();
  expect(
    characterActionOptions(library, token).find((action) => action.id === 'study-arcana').cost
  ).toBe('action');
});

test('a wizard sees a bonus-action section below Action even when no bonus action is available', async () => {
  await openCombat();
  const sections = [...combatView().querySelectorAll('[data-play-section]')].map(
    (section) => section.dataset.playSection
  );
  expect(sections.indexOf('bonus')).toBe(sections.indexOf('action') + 1);
  expect(combatView().querySelector('[data-play-section="bonus"]').textContent).toContain(
    'No available bonus-action options'
  );
  expect(button('Bonus actions remaining').textContent).toBe('1');
});

test('combat choices separate attacks, spells and other actions within their original action costs', async () => {
  await openCombat();
  const dagger = library.add(token.characterSheetId, 'item:dagger', { equip: true });
  const bolt = addSpell('spell:fire-bolt'),
    missile = addSpell('spell:magic-missile'),
    misty = addSpell('spell:misty-step'),
    shield = addSpell('spell:shield');
  await sheets.open(token);
  const group = (section, category) =>
    combatView().querySelector(
      `[data-play-section="${section}"] [data-play-category="${category}"]`
    );
  const contains = (section, category, id) =>
    group(section, category).querySelector(`[data-play-card="${id}"]`);
  expect(
    [...combatView().querySelectorAll('[data-play-section="action"] [data-play-category]')].map(
      (category) => category.querySelector('h5').textContent
    )
  ).toEqual(['Attacks', 'Spells', 'Other actions']);
  for (const id of [`attack:${dagger}`, 'attack:unarmed', 'grapple', 'shove'])
    expect(contains('action', 'attacks', id)).not.toBeNull();
  for (const id of [`spell:${bolt}`, `spell:${missile}`])
    expect(contains('action', 'spells', id)).not.toBeNull();
  expect(contains('action', 'actions', 'dash')).not.toBeNull();
  expect(contains('action', 'actions', 'hide')).not.toBeNull();
  expect(contains('bonus', 'spells', `spell:${misty}`)).not.toBeNull();
  expect(contains('reaction', 'spells', `spell:${shield}`)).not.toBeNull();
  expect(contains('reaction', 'attacks', `opportunity:${dagger}`)).not.toBeNull();
  expect(contains('reaction', 'actions', 'reaction:manual')).not.toBeNull();
  expect(gm.characterServices.combat.status(token)).toMatchObject({
    actions: 1,
    bonusActions: 1,
    reactions: 1,
  });
  expect(library.get(token.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
  expect(combatView().querySelectorAll(`[data-play-card="spell:${bolt}"]`)).toHaveLength(1);
  sheets.root.querySelector('[data-sheet-section="noncombat"]').click();
  expect(
    sheets.root.querySelector('[aria-label="Non-combat play"] [data-play-category]')
  ).toBeNull();
});

test('empty combat categories are omitted and spent actions still disappear', async () => {
  await openCombat('fighter');
  expect(combatView().querySelector('[data-play-category="spells"]')).toBeNull();
  button('Use Dash').click();
  await Promise.resolve();
  expect(button('Use Dash')).toBeNull();
  expect(combatView().querySelector('[data-play-section="action"]')).toBeNull();
  expect(combatView().querySelector('[data-play-section="reaction"]')).not.toBeNull();
  expect(gm.characterServices.combat.status(token).actions).toBe(0);
});

test('a rogue’s real bonus actions remain available and spending one does not spend the Action', async () => {
  await openCombat('rogue');
  const bonus = combatView().querySelector('[data-play-section="bonus"]');
  const dash = bonus.querySelector(
    '[data-sheet-action="use-action"][data-action-id="ability:cunning-dash"]'
  );
  expect(dash).not.toBeNull();
  dash.click();
  await Promise.resolve();
  const session = gm.characterServices.combat;
  expect(session.status(token)).toMatchObject({ actions: 1, bonusActions: 0 });
  expect(combatView().querySelector('[data-play-section="bonus"]').textContent).toContain(
    'Bonus action spent'
  );
});

test('only an unreviewed spell gets a compact targeting gear; weapon and reviewed-spell cards have no setup buttons', async () => {
  await openCombat();
  const bolt = addSpell('spell:fire-bolt'),
    misty = addSpell('spell:dancing-lights');
  const dagger = library.add(token.characterSheetId, 'item:dagger', { equip: true });
  await sheets.open(token);
  const configure = jest.fn(async () => false);
  sheets.characterContent.services.targeting = {
    configure,
    cancelFor: jest.fn(),
    beginQuery: jest.fn(),
  };
  const card = (id) => combatView().querySelector(`[data-play-card="${id}"]`);
  expect(
    card(`spell:${bolt}`).querySelector('[data-sheet-action="configure-targeting"]')
  ).toBeNull();
  expect(
    card(`attack:${dagger}`).querySelector('[data-sheet-action="configure-targeting"]')
  ).toBeNull();
  const gear = card(`spell:${misty}`).querySelector('[data-sheet-action="configure-targeting"]');
  expect(gear.classList.contains('sheet-targeting-config')).toBe(true);
  expect(gear.getAttribute('aria-label')).toBe('Configure targeting for Dancing Lights');
  expect(gear.textContent.trim()).not.toContain('Configure targets');
  gear.click();
  await Promise.resolve();
  expect(configure).toHaveBeenCalledWith(token, expect.objectContaining({ id: `spell:${misty}` }));
});

test('Fly cards describe automatic flight rather than instructing users to apply its effect manually', async () => {
  await openCombat();
  const fly = addSpell('spell:fly');
  await sheets.open(token);
  const cast = combatView().querySelector(`[data-action-id="spell:${fly}"]`);
  expect(cast.getAttribute('title')).toContain('automatically grants');
  expect(cast.getAttribute('title')).not.toContain('mechanical effects manually');
});

test('spell cards defer slot level selection to the targeting popup while cantrips explain that they use no slot', async () => {
  await openCombat();
  const missile = addSpell('spell:magic-missile'),
    bolt = addSpell('spell:fire-bolt');
  await sheets.open(token);
  const missileCard = combatView().querySelector(`[data-play-card="spell:${missile}"]`);
  expect(missileCard.querySelector('[data-play-slot]')).toBeNull();
  expect(missileCard.textContent).not.toContain('Cast using');
  expect(missileCard.textContent).toContain('Level 1 spell');
  expect(library.get(token.characterSheetId).slotsUsed.every((used) => used === 0)).toBe(true);
  expect(combatView().querySelector(`[data-play-card="spell:${bolt}"]`).textContent).toContain(
    'Cantrip (no spell slot)'
  );
  sheets.root.querySelector('[data-sheet-section="spells"]').click();
  expect(sheets.root.querySelector('[data-slot-choice]')).toBeNull();
});

test('an exhausted last-used damage-preview level does not block opening Cast when another slot level remains', async () => {
  await openCombat();
  const owned = addSpell('spell:magic-missile');
  sheets.characterContent.slotLevels.set(owned, 3);
  library.setSlotUsed(token.characterSheetId, 3, 2);
  sheets.root.querySelector('[data-sheet-section="spells"]').click();
  expect(
    sheets.root.querySelector(`[data-sheet-action="cast"][data-instance-id="${owned}"]`).disabled
  ).toBe(false);
  expect(sheets.characterContent.slotLevels.get(owned)).toBe(3);
});

test('creature targeting tags live only in Core, not the shared play header', async () => {
  await openCombat();
  for (const label of [
    'Creature allegiance',
    'Targeting creature type',
    'Targeting creature size',
  ]) {
    expect(button(label).closest('.sheet-section').hidden).toBe(true);
  }
  sheets.root.querySelector('[data-sheet-section="core"]').click();
  for (const label of [
    'Creature allegiance',
    'Targeting creature type',
    'Targeting creature size',
  ]) {
    expect(button(label).closest('.sheet-section').hidden).toBe(false);
  }
});

test('Style and Roll use persistent pressed buttons across play pages without spending action or movement', async () => {
  await openCombat();
  expect(sheets.root.querySelector('select[aria-label="Movement type"]')).toBeNull();
  expect(sheets.root.querySelector('select[aria-label="Character roll mode"]')).toBeNull();
  button('Drunk movement style').click();
  button('Advantage rolls').click();
  expect(getTokenMovementSettings(token).type).toBe('drunk');
  expect(sheets.characterContent.rollMode).toBe('advantage');
  expect(button('Drunk movement style').getAttribute('aria-pressed')).toBe('true');
  expect(button('Advantage rolls').getAttribute('aria-pressed')).toBe('true');
  sheets.root.querySelector('[data-sheet-section="noncombat"]').click();
  expect(button('Drunk movement style').getAttribute('aria-pressed')).toBe('true');
  expect(button('Advantage rolls').getAttribute('aria-pressed')).toBe('true');
  const session = gm.characterServices.combat;
  expect(session.status(token)).toMatchObject({
    actions: 1,
    bonusActions: 1,
    movement: { spent: 0 },
  });
});
