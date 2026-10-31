import CharacterSheetWindow from '../../../src/ui/components/CharacterSheetWindow.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { CompendiumCatalog } from '../../../src/entities/characters/CompendiumCatalog.js';
import snapshot from '../../../assets/data/srd2014.json';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

let sheets;
let token;
let library;
let gameManager;
const control = (label) => sheets.root.querySelector(`[aria-label="${label}"]`);
const change = (label, value) => {
  const field = control(label);
  field.value = value;
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(async () => {
  localStorage.clear();
  const catalog = new CompendiumCatalog({ ...snapshot, ruleset: '2014' });
  library = new CharacterLibrary({
    catalog: catalog.entries,
    classes: catalog.classes,
    ruleset: '2014',
    storage: localStorage,
  });
  const id = library.create('Rook');
  library.edit(id, { level: 5, ancestry: 'Elf', background: 'Sage', alignment: 'Neutral' });
  token = { id: 'hero', type: 'mannequin', name: 'Rook', characterSheetId: id };
  gameManager = {
    placedTokens: [token],
    token3DAdapter: { setSelectedToken: jest.fn(), getSelectedToken: () => token },
  };
  sheets = new CharacterSheetWindow({
    gameManager,
    characterServices: { library, catalog },
  }).attach();
  await sheets.open(token);
});

afterEach(() => {
  sheets.destroy();
  jest.restoreAllMocks();
  document.body.replaceChildren();
});

test.each(['core', 'combat', 'noncombat', 'equipment', 'spells', 'notes'])(
  '%s uses one information card, a compact initiative widget and three primary stats',
  (section) => {
    sheets.root.querySelector(`[data-sheet-section="${section}"]`).click();
    const card = control('Character information');
    expect(card).not.toBeNull();
    expect(card.querySelector('[aria-label="Class"]').textContent).toBe('Fighter');
    expect(card.querySelector('select')).toBeNull();
    for (const [label, value] of [
      ['Level', '5'],
      ['Ancestry', 'Elf'],
      ['Background', 'Sage'],
      ['Alignment', 'Neutral'],
    ]) {
      expect(card.querySelector(`[aria-label="${label}"]`).value).toBe(value);
      expect(
        card.querySelector(`[aria-label="${label}"]`).hasAttribute('data-sheet-identity-value')
      ).toBe(true);
    }
    const primary = sheets.root.querySelector('.sheet-summary');
    expect(
      [...primary.querySelectorAll('output')].map((e) => e.getAttribute('aria-label'))
    ).toEqual(['Armor class', 'Proficiency bonus', 'Passive perception']);
    expect(control('Initiative').closest('.sheet-initiative')).not.toBeNull();
    expect(control('Initiative').closest('.sheet-summary')).toBeNull();
    expect(control('Roll Initiative').dataset.rollKind).toBe('initiative');
    const classSection = control('Character class').closest('.sheet-section');
    expect(classSection.hidden).toBe(section !== 'core');
    expect(classSection.textContent).toMatch(/temporary/i);
    expect(classSection.textContent).toMatch(/character builder/i);
  }
);

test('the temporary Core selector updates the display and existing class calculations', () => {
  change('Character class', 'wizard');
  expect(control('Character information').querySelector('[aria-label="Class"]').textContent).toBe(
    'Wizard'
  );
  expect(library.get(token.characterSheetId).classId).toBe('wizard');
  expect(library.stats(token.characterSheetId).spellSlots[2].max).toBe(2);
});

test('inline identity drafts survive combat updates and commit through the usual character storage', () => {
  sheets.root.querySelector('[data-sheet-section="combat"]').click();
  const ancestry = control('Ancestry');
  ancestry.focus();
  ancestry.value = 'High Elf';
  ancestry.dispatchEvent(new Event('input', { bubbles: true }));
  gameManager.characterServices.combat.startTurn(token);
  expect(control('Ancestry')).toBe(ancestry);
  expect(ancestry.value).toBe('High Elf');
  expect(document.activeElement).toBe(ancestry);
  ancestry.dispatchEvent(new Event('change', { bubbles: true }));
  expect(library.get(token.characterSheetId).ancestry).toBe('High Elf');
  change('Level', '6');
  change('Background', 'Scholar');
  change('Alignment', 'Chaotic good');
  expect(library.get(token.characterSheetId)).toMatchObject({
    level: 6,
    ancestry: 'High Elf',
    background: 'Scholar',
    alignment: 'Chaotic good',
  });
});

test('Escape restores the saved inline value without saving its draft', () => {
  const alignment = control('Alignment');
  const edit = jest.spyOn(library, 'edit');
  alignment.focus();
  alignment.value = 'Discard this';
  alignment.dispatchEvent(new Event('input', { bubbles: true }));
  const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
  alignment.dispatchEvent(escape);
  expect(escape.defaultPrevented).toBe(true);
  expect(alignment.value).toBe('Neutral');
  expect(library.get(token.characterSheetId).alignment).toBe('Neutral');
  expect(edit).not.toHaveBeenCalled();
});

test.each(['0', '21', ''])(
  'an invalid inline level %p is reported without changing the saved level',
  (value) => {
    const error = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
    change('Level', value);
    expect(error).toHaveBeenCalled();
    expect(library.get(token.characterSheetId).level).toBe(5);
    expect(control('Level').value).toBe('5');
    expect(sheets.characterContent.status.classList.contains('sheet-error')).toBe(true);
  }
);

test('the compact initiative button rolls the same derived modifier without spending an action', async () => {
  change('Dexterity score', '16');
  expect(control('Initiative').textContent).toBe('+3');
  jest.spyOn(Math, 'random').mockReturnValue(0.5);
  control('Roll Initiative').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(control('Character roll result').textContent).toContain('1d20+3');
  expect(control('Character roll result').textContent).toContain('= 14');
});
