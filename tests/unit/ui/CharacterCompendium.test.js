import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import snapshot from '../../../assets/data/srd2014.json';
import CompendiumSidebar from '../../../src/ui/characters/CompendiumSidebar.js';
import { getTokenMovementSettings } from '../../../src/entities/creatures/TokenMovement.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

let sheets;
let compendium;
let token;
let services;

beforeEach(async () => {
  localStorage.clear();
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  services = {
    catalog,
    library: new CharacterLibrary({
      ruleset: '2014',
      catalog: catalog.entries,
      classes: catalog.classes,
      storage: localStorage,
    }),
  };
  token = { id: 'hero-token', name: 'Aster', type: 'mannequin' };
  const gameManager = {
    placedTokens: [token],
    token3DAdapter: { setSelectedToken: jest.fn(), getSelectedToken: () => token },
  };
  compendium = new CompendiumSidebar({ gameManager, services }).attach(document.body);
  await compendium.open();
  sheets = new CharacterSheetWindow({
    gameManager,
    characterServices: services,
    onOpenCompendium: (id) => compendium.open(id),
  }).attach();
});

afterEach(() => {
  jest.restoreAllMocks();
  sheets.destroy();
  compendium.destroy();
  document.body.replaceChildren();
});

async function renameCharacter(value) {
  sheets.heading.focus();
  sheets.heading.textContent = value;
  sheets.heading.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );
  await sheets.renameReady;
}

test('renaming a shared saved character updates linked creatures, sheet headers and every tab', async () => {
  await sheets.open(token);
  const second = {
    id: 'other-token',
    type: 'knight',
    name: 'Knight 2',
    characterSheetId: token.characterSheetId,
  };
  sheets.gameManager.placedTokens.push(second);
  await sheets.open(second);
  await sheets.open(token);
  await renameCharacter('Rook');
  expect(services.library.get(token.characterSheetId).name).toBe('Rook');
  expect(token.name).toBe('Rook');
  expect(second.name).toBe('Rook');
  expect([...sheets.root.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent)).toEqual([
    'Rook',
    'Rook',
  ]);
  expect(sheets.heading.textContent).toBe('Rook');
});

test('searching and dropping a shield adds real inventory; equip and remove update the displayed AC', async () => {
  await sheets.open(token);
  const search = compendium.root.querySelector('[aria-label="Search compendium"]');
  expect(search).not.toBeNull();
  search.value = 'shield';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  expect(compendium.root.querySelector('[data-entry-id="item:shield"]')).not.toBeNull();
  sheets.root.querySelector('[data-sheet-section="equipment"]').click();
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', {
    value: {
      types: ['application/taverntable-compendium'],
      getData: (type) =>
        type === 'application/taverntable-compendium'
          ? JSON.stringify({ version: 2, ruleset: '2014', entryId: 'item:shield' })
          : '',
    },
  });
  sheets.root.querySelector('[data-drop-kind="inventory"]').dispatchEvent(drop);
  expect(sheets.root.querySelector('[aria-label="Armor class"]').textContent).toBe('10');
  sheets.root.querySelector('[aria-label="Equip Shield"]').click();
  expect(sheets.root.querySelector('[aria-label="Armor class"]').textContent).toBe('12');
  sheets.root.querySelector('[aria-label="Remove Shield"]').click();
  expect(sheets.root.querySelector('[aria-label="Armor class"]').textContent).toBe('10');
  expect(services.library.get(token.characterSheetId).equipment).toHaveLength(0);
});

test('adding a compendium spell creates a prepared/casting workflow with live DC and slot values', async () => {
  await sheets.open(token);
  const change = (label, value) => {
    const element = sheets.root.querySelector(`[aria-label="${label}"]`);
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  change('Character class', 'wizard');
  change('Level', '5');
  change('Intelligence score', '16');
  const search = compendium.root.querySelector('[aria-label="Search compendium"]');
  search.value = 'fireball';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  compendium.root
    .querySelector('[data-entry-id="spell:fireball"] [aria-label="Add Fireball"]')
    .click();
  expect(sheets.root.querySelector('[aria-label="Spell save DC"]').textContent).toBe('14');
  sheets.root.querySelector('[aria-label="Prepare Fireball"]').click();
  sheets.root.querySelector('[data-sheet-action="cast"]').click();
  expect(sheets.root.querySelector('[aria-label="Used level 3 spell slots"]').value).toBe('1');
  expect(services.library.stats(token.characterSheetId).spellSlots[2].remaining).toBe(1);
  expect(sheets.root.textContent).toContain('8d6');
});

test('a sheet check reports progress and rolls its displayed modifier through the shared dice system', async () => {
  await sheets.open(token);
  const score = sheets.root.querySelector('[aria-label="Strength score"]');
  score.value = '16';
  score.dispatchEvent(new Event('change', { bubbles: true }));
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  sheets.root.querySelector('[aria-label="Roll Strength check"]').click();
  expect(sheets.root.querySelector('[aria-label="Character roll result"]').textContent).toContain(
    'Rolling'
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const result = sheets.root.querySelector('[aria-label="Character roll result"]').textContent;
  expect(result).toContain('1d20+3');
  expect(result).toContain('= 14');
});

test('a cast concentration spell can be ended without restoring or consuming another slot', async () => {
  await sheets.open(token);
  const change = (label, value) => {
    const element = sheets.root.querySelector(`[aria-label="${label}"]`);
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  };
  change('Character class', 'wizard');
  change('Level', '5');
  const search = compendium.root.querySelector('[aria-label="Search compendium"]');
  search.value = 'fly';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  compendium.root.querySelector('[data-entry-id="spell:fly"] [aria-label="Add Fly"]').click();
  sheets.root.querySelector('[aria-label="Prepare Fly"]').click();
  sheets.root.querySelector('[data-sheet-action="cast"]').click();
  expect(sheets.root.textContent).toContain('Concentrating on Fly');
  sheets.root.querySelector('[data-sheet-action="end-concentration"]').click();
  expect(services.library.get(token.characterSheetId).concentration).toBe('');
  expect(services.library.stats(token.characterSheetId).spellSlots[2].used).toBe(1);
});

test("loading a saved character shares its speed while retaining each token's movement style", async () => {
  await sheets.open(token);
  await renameCharacter('Mira');
  const speed = sheets.root.querySelector('[aria-label="Character speed (feet)"]');
  speed.value = '45';
  speed.dispatchEvent(new Event('change', { bubbles: true }));
  sheets.root.querySelector('[aria-label="Run movement"]').click();
  const original = token.characterSheetId;
  const second = { id: 'second-token', type: 'knight', name: 'Knight' };
  sheets.gameManager.placedTokens.push(second);
  await sheets.open(second);
  expect(second.characterSheetId).not.toBe(original);
  sheets.settingsButton.click();
  const saved = sheets.root.querySelector('[aria-label="Saved characters"]');
  saved.value = original;
  saved.dispatchEvent(new Event('change', { bubbles: true }));
  expect(second.characterSheetId).toBe(original);
  expect(sheets.heading.textContent).toBe('Mira');
  expect(sheets.root.querySelector('[aria-label="Character speed (feet)"]').value).toBe('45');
  expect(getTokenMovementSettings(second)).toEqual({ speed: 45, mode: 'walk', type: 'default' });
  expect(getTokenMovementSettings(token).mode).toBe('run');
  expect(services.library.get(original).name).toBe('Mira');
});

test('compendium details are immediately visible and closing them restores the current search', async () => {
  await sheets.open(token);
  const search = compendium.root.querySelector('[aria-label="Search compendium"]');
  search.value = 'fireball';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  compendium.root.querySelector('[aria-label="Details Fireball"]').click();
  expect(compendium.root.querySelector('[aria-label="Compendium entry details"]').hidden).toBe(
    false
  );
  expect(compendium.root.querySelector('.sheet-compendium-results').hidden).toBe(true);
  compendium.root.querySelector('[aria-label="Close compendium details"]').click();
  expect(compendium.root.querySelector('.sheet-compendium-results').hidden).toBe(false);
  expect(search.value).toBe('fireball');
});

test('the compendium stays outside the sheet and equipment Details opens its sidebar mechanics', async () => {
  await sheets.open(token);
  expect(sheets.root.querySelector('[aria-label="Search compendium"]')).toBeNull();
  const search = compendium.root.querySelector('[aria-label="Search compendium"]');
  search.value = 'shield';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  compendium.root.querySelector('[aria-label="Add and equip Shield"]').click();
  expect(sheets.root.querySelector('[aria-label="Armor class"]').textContent).toBe('12');
  sheets.root.querySelector('[data-sheet-action="details"][data-entry-id="item:shield"]').click();
  await Promise.resolve();
  const details = compendium.root.querySelector('[aria-label="Compendium entry details"]');
  expect(details.hidden).toBe(false);
  expect(details.textContent).toContain('+2 AC');
});

test('Core owns editable speed while Walk/Run and style remain available on the play pages', async () => {
  sheets.gameManager.token3DAdapter.applyMovementStyle = jest.fn();
  sheets.gameManager.token3DAdapter.refreshMovementRange = jest.fn();
  await sheets.open(token);
  expect(sheets.root.querySelector('[data-movement-speed]')).toBeNull();
  const movement = sheets.root.querySelector('[role="group"][aria-label="Movement controls"]');
  expect(movement).not.toBeNull();
  const speed = sheets.root.querySelector('[aria-label="Character speed (feet)"]');
  const core = speed.closest('.sheet-section');
  expect(core).not.toBeNull();
  expect(core.hidden).toBe(false);
  expect(movement.querySelector('[data-character-field="speed"]')).toBeNull();
  speed.value = '20';
  speed.dispatchEvent(new Event('change', { bubbles: true }));
  sheets.root.querySelector('[aria-label="Run movement"]').click();
  const style = sheets.root.querySelector('[aria-label="Movement type"]');
  style.value = 'drunk';
  style.dispatchEvent(new Event('change', { bubbles: true }));
  expect(services.library.get(token.characterSheetId).speed).toBe(20);
  expect(getTokenMovementSettings(token)).toEqual({ speed: 20, mode: 'run', type: 'drunk' });
  expect(sheets.root.querySelectorAll('[data-character-field="speed"]')).toHaveLength(1);
  expect(sheets.gameManager.token3DAdapter.applyMovementStyle).toHaveBeenLastCalledWith(token);
  expect(sheets.gameManager.token3DAdapter.refreshMovementRange).toHaveBeenCalled();
  for (const section of ['combat', 'noncombat']) {
    sheets.root.querySelector(`[data-sheet-section="${section}"]`).click();
    expect(
      sheets.root.querySelector('[data-character-field="speed"]').closest('.sheet-section').hidden
    ).toBe(true);
    expect(
      sheets.root.querySelector('[aria-label="Run movement"]').getAttribute('aria-pressed')
    ).toBe('true');
    expect(sheets.root.querySelector('[aria-label="Movement type"]').value).toBe('drunk');
  }
  sheets.root.querySelector('[data-sheet-section="core"]').click();
  expect(sheets.root.querySelector('[data-character-field="speed"]').value).toBe('20');
});

test('editing a character updates the independent compendium destination immediately', async () => {
  await sheets.open(token);
  await renameCharacter('Mira');
  const destination = compendium.root.querySelector('[aria-label="Compendium destination"]');
  expect(destination.selectedOptions[0].textContent).toContain('Mira');
  expect(
    Array.from(destination.options).some((option) => option.textContent.startsWith('Mira'))
  ).toBe(true);
});

test('the health bar supports compact editing, temporary-HP damage and capped healing', async () => {
  await sheets.open(token);
  expect(sheets.root.querySelector('[data-character-field="hp.current"]')).toBeNull();
  const bar = sheets.root.querySelector('[role="progressbar"][aria-label="Hit points"]');
  expect(bar).not.toBeNull();
  sheets.root.querySelector('[aria-label="Edit hit points"]').click();
  for (const [label, value] of [
    ['Maximum hit points', '30'],
    ['Current hit points', '20'],
    ['Temporary hit points', '5'],
  ]) {
    sheets.root.querySelector(`input[aria-label="${label}"]`).value = value;
  }
  sheets.root.querySelector('[aria-label="Apply HP change"]').click();
  expect(bar.getAttribute('aria-valuenow')).toBe('20');
  expect(bar.getAttribute('aria-valuemax')).toBe('30');
  expect(parseFloat(sheets.root.querySelector('.sheet-health-fill').style.width)).toBeCloseTo(
    200 / 3
  );
  expect(sheets.root.querySelector('[aria-label="Hit point total"]').textContent).toBe('20 / 30');
  expect(sheets.root.querySelector('[aria-label="Temporary HP bonus"]').textContent).toContain('5');
  sheets.root.querySelector('[aria-label="Damage hit points"]').click();
  sheets.root.querySelector('[aria-label="Damage amount"]').value = '8';
  sheets.root.querySelector('[aria-label="Apply HP change"]').click();
  expect(services.library.get(token.characterSheetId).hp).toEqual({
    max: 30,
    current: 17,
    temp: 0,
  });
  expect(bar.getAttribute('aria-valuenow')).toBe('17');
  sheets.root.querySelector('[aria-label="Heal hit points"]').click();
  sheets.root.querySelector('[aria-label="Healing amount"]').value = '100';
  sheets.root.querySelector('[aria-label="Apply HP change"]').click();
  expect(services.library.get(token.characterSheetId).hp.current).toBe(30);
  expect(sheets.root.querySelector('.sheet-health-fill').style.width).toBe('100%');
  expect(sheets.root.querySelector('[aria-label="Hit point adjustment"]').hidden).toBe(true);
});

test('unfinished health edits retain their controls and invalid amounts do not change saved HP', async () => {
  await sheets.open(token);
  sheets.root.querySelector('[aria-label="Damage hit points"]').click();
  const amount = sheets.root.querySelector('[aria-label="Damage amount"]');
  amount.focus();
  amount.value = '4';
  sheets.root.querySelector('[aria-label="Run movement"]').click();
  expect(document.activeElement.getAttribute('aria-label')).toBe('Damage amount');
  expect(amount.value).toBe('4');
  const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  amount.value = '-1';
  sheets.root.querySelector('[aria-label="Apply HP change"]').click();
  expect(error).toHaveBeenCalled();
  expect(services.library.get(token.characterSheetId).hp.current).toBe(10);
  expect(sheets.root.querySelector('[aria-label="Hit point adjustment"]').hidden).toBe(false);
  expect(amount.value).toBe('-1');
  amount.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(sheets.root.querySelector('[aria-label="Hit point adjustment"]').hidden).toBe(true);
});

test('a zero maximum HP renders an empty finite bar rather than NaN', async () => {
  await sheets.open(token);
  sheets.root.querySelector('[aria-label="Edit hit points"]').click();
  for (const label of ['Current hit points', 'Maximum hit points', 'Temporary hit points']) {
    sheets.root.querySelector(`input[aria-label="${label}"]`).value = '0';
  }
  sheets.root.querySelector('[aria-label="Apply HP change"]').click();
  expect(sheets.root.querySelector('[aria-label="Hit point total"]').textContent).toBe('0 / 0');
  expect(sheets.root.querySelector('.sheet-health-fill').style.width).toBe('0%');
});

test('prominent rest controls recover class uses and spend one shared-dice Hit Die at a time', async () => {
  await sheets.open(token);
  const id = token.characterSheetId;
  services.library.edit(id, {
    classId: 'fighter',
    level: 5,
    abilities: { constitution: 14 },
    hp: { max: 30, current: 28, temp: 3 },
  });
  services.library.rest.setResourceRemaining(id, 'second-wind', 0);
  await sheets.open(token);
  const health = sheets.root.querySelector('[data-sheet-island="health"]');
  expect(health.querySelector('[aria-label="Short rest"]')).not.toBeNull();
  expect(health.querySelector('[aria-label="Long rest"]')).not.toBeNull();
  expect(sheets.root.querySelectorAll('[aria-label="Long rest"]')).toHaveLength(1);
  health.querySelector('[aria-label="Short rest"]').click();
  health.querySelector('[data-rest-action="complete-short"]').click();
  expect(
    services.library.rest.status(id).resources.find((resource) => resource.id === 'second-wind')
      .remaining
  ).toBe(1);
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  health.querySelector('[data-rest-action="hit-die"]').click();
  expect(health.querySelector('[aria-label="Rest status"]').textContent).toContain('Rolling');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(services.library.get(id).hp).toEqual({ max: 30, current: 30, temp: 3 });
  expect(services.library.rest.status(id).hitDice.remaining).toBe(4);
  health.querySelector('[aria-label="Long rest"]').click();
  health.querySelector('[data-rest-action="complete-long"]').click();
  expect(services.library.rest.status(id).hitDice.remaining).toBe(5);
  expect(services.library.get(id).hp.temp).toBe(0);
});

test('a Wizard can choose Arcane Recovery slots after resting rather than automatically regaining every slot', async () => {
  await sheets.open(token);
  const id = token.characterSheetId;
  services.library.edit(id, {
    classId: 'wizard',
    level: 7,
    slotsUsed: [2, 0, 1, 1, 0, 0, 0, 0, 0],
  });
  await sheets.open(token);
  sheets.root.querySelector('[aria-label="Short rest"]').click();
  sheets.root.querySelector('[data-rest-action="complete-short"]').click();
  expect(services.library.get(id).slotsUsed[3]).toBe(1);
  const recovery = sheets.root.querySelector('[data-rest-action="arcane"]');
  expect(recovery).not.toBeNull();
  recovery.click();
  sheets.root.querySelector('[aria-label="Recover level 1 slots"]').value = '1';
  sheets.root.querySelector('[aria-label="Recover level 3 slots"]').value = '1';
  sheets.root.querySelector('[data-rest-arcane-apply]').click();
  expect(services.library.get(id).slotsUsed).toEqual([1, 0, 0, 1, 0, 0, 0, 0, 0]);
  expect(
    services.library.rest.status(id).resources.find((resource) => resource.id === 'arcane-recovery')
      .remaining
  ).toBe(0);
  expect(sheets.root.querySelector('[data-rest-action="arcane"]').disabled).toBe(true);
});

test('switching creatures during a pending Hit Die roll cannot heal or spend dice on either character', async () => {
  const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  await sheets.open(token);
  const first = token.characterSheetId;
  services.library.edit(first, { level: 5, hp: { max: 30, current: 10 } });
  await sheets.open(token);
  sheets.root.querySelector('[aria-label="Short rest"]').click();
  sheets.root.querySelector('[data-rest-action="complete-short"]').click();
  sheets.root.querySelector('[data-rest-action="hit-die"]').click();
  const second = { id: 'second-rest-token', type: 'knight', name: 'Other creature' };
  sheets.gameManager.placedTokens.push(second);
  await sheets.open(second);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(services.library.get(first).hp.current).toBe(10);
  expect(services.library.rest.status(first).hitDice.remaining).toBe(5);
  expect(services.library.get(second.characterSheetId).hp.current).toBe(10);
  expect(services.library.rest.status(second.characterSheetId).hitDice.remaining).toBe(1);
  expect(error).toHaveBeenCalled();
});

test('resource counters are manually adjustable and daily uses reset only after confirming a new game day', async () => {
  await sheets.open(token);
  const id = token.characterSheetId;
  services.library.edit(id, { classId: 'wizard', level: 7 });
  await sheets.open(token);
  sheets.root.querySelector('[data-rest-action="resources"]').click();
  const remaining = sheets.root.querySelector('[aria-label="Remaining Arcane Recovery"]');
  remaining.value = '0';
  remaining.dispatchEvent(new Event('change', { bubbles: true }));
  expect(
    services.library.rest.status(id).resources.find((resource) => resource.id === 'arcane-recovery')
      .remaining
  ).toBe(0);
  const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);
  sheets.root.querySelector('[data-rest-action="daily"]').click();
  expect(
    services.library.rest.status(id).resources.find((resource) => resource.id === 'arcane-recovery')
      .remaining
  ).toBe(0);
  confirm.mockReturnValue(true);
  sheets.root.querySelector('[data-rest-action="daily"]').click();
  expect(
    services.library.rest.status(id).resources.find((resource) => resource.id === 'arcane-recovery')
      .remaining
  ).toBe(1);
});

test('saving an edited field preserves its focus instead of dumping keyboard users onto the map', async () => {
  await sheets.open(token);
  const name = sheets.root.querySelector('[aria-label="Ancestry"]');
  name.focus();
  name.value = 'Mira';
  name.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.activeElement.getAttribute('aria-label')).toBe('Ancestry');
  expect(document.activeElement.value).toBe('Mira');
});

test.each(['another-character', 'active-character'])(
  'an update to %s storage cannot discard an in-progress field edit',
  async (kind) => {
    await sheets.open(token);
    const name = sheets.root.querySelector('[aria-label="Character name"]');
    name.focus();
    name.textContent = 'Unsaved draft';
    const id =
      kind === 'active-character'
        ? token.characterSheetId
        : services.library.create('Other character');
    if (kind === 'active-character') services.library.edit(id, { name: 'External edit' });
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: `taverntable.character.v1.${id}`,
        newValue: 'updated',
      })
    );
    expect(sheets.heading.textContent).toBe('Unsaved draft');
    expect(document.activeElement.getAttribute('aria-label')).toBe('Character name');
  }
);

test('export provides copyable character JSON as well as a browser download', async () => {
  const previousCreate = URL.createObjectURL;
  const previousRevoke = URL.revokeObjectURL;
  URL.createObjectURL = jest.fn(() => 'blob:character-backup');
  URL.revokeObjectURL = jest.fn();
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  try {
    await sheets.open(token);
    sheets.settingsButton.click();
    sheets.root.querySelector('[data-sheet-action="export"]').click();
    const backup = sheets.root.querySelector('[aria-label="Character JSON backup"]');
    expect(backup).not.toBeNull();
    expect(backup.closest('section').hidden).toBe(false);
    expect(backup.readOnly).toBe(true);
    expect(JSON.parse(backup.value)).toMatchObject({
      format: 'taverntable-character',
      version: 4,
      character: { id: token.characterSheetId, name: 'Aster' },
    });
    sheets.root.querySelector('[data-sheet-action="close-backup"]').click();
    expect(backup.closest('section').hidden).toBe(true);
    expect(document.activeElement.textContent).toBe('Export JSON');
  } finally {
    await new Promise((resolve) => setTimeout(resolve, 0));
    URL.createObjectURL = previousCreate;
    URL.revokeObjectURL = previousRevoke;
  }
});
