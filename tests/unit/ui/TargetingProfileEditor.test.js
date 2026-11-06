import TargetingProfileEditor from '../../../src/ui/characters/TargetingProfileEditor.js';
import { CharacterLibrary } from '../../../src/entities/characters/CharacterLibrary.js';
import { characterActionOptions } from '../../../src/entities/characters/combat/actions.js';
import data from '../../../assets/data/resources/srd-2024-5.2.1-seed.1.json';

let library, token, editor, changed;
const action = (id) => characterActionOptions(library, token).find((entry) => entry.id === id);
const field = (name) => editor.root.querySelector('form').elements.namedItem(name);

beforeEach(() => {
  localStorage.clear();
  library = new CharacterLibrary({
    ruleset: '2024',
    storage: localStorage,
    catalog: data.entries,
    classes: data.classes,
  });
  token = { id: 'caster', characterSheetId: library.create('Caster') };
  library.edit(token.characterSheetId, { classId: 'wizard', level: 5 });
  changed = jest.fn();
  editor = new TargetingProfileEditor({ library, onChanged: changed });
});

afterEach(() => {
  editor.dispose();
  document.body.replaceChildren();
});

test('manual spells can acquire a static point profile, persisted separately from the character', async () => {
  const owned = library.add(token.characterSheetId, 'spell:dancing-lights');
  library.prepare(token.characterSheetId, owned, true);
  const id = `spell:${owned}`;
  expect(action(id).targeting.kind).toBe('manual');
  const result = editor.open(token, action(id));
  field('kind').value = 'point';
  field('rangeFeet').value = '30';
  field('minRangeFeet').value = '10';
  await editor.save();
  expect(await result).toBe(true);
  expect(action(id).targeting).toMatchObject({ kind: 'point', rangeFeet: 30, minRangeFeet: 10 });
  expect(changed).toHaveBeenCalledWith(token.characterSheetId);
  const copy = library.import(library.export(token.characterSheetId));
  expect(library.actions.snapshot(copy).targetingOverrides[id]).toMatchObject({
    kind: 'point',
    minRangeFeet: 10,
  });
  expect(library.get(token.characterSheetId)).not.toHaveProperty('targetingOverrides');
});

test('editing a weapon mode retains its other modes; reset restores reviewed distances', async () => {
  const owned = library.add(token.characterSheetId, 'item:dagger');
  library.equip(token.characterSheetId, owned, true);
  const id = `attack:${owned}`;
  const result = editor.open(token, action(id));
  field('attackMode').value = 'thrown';
  field('attackMode').dispatchEvent(new Event('change', { bubbles: true }));
  expect(field('normalRange').value).toBe('20');
  field('normalRange').value = '30';
  field('rangeFeet').value = '120';
  field('ignoreCloseRangeDisadvantage').checked = true;
  await editor.save();
  expect(await result).toBe(true);
  expect(action(id).targeting.modes).toEqual([
    { id: 'melee', normal: 5, long: 5 },
    { id: 'thrown', normal: 30, long: 120 },
  ]);
  expect(action(id).targeting.ignoreCloseRangeDisadvantage).toBe(true);
  const reset = editor.open(token, action(id));
  await editor.save(true);
  expect(await reset).toBe(true);
  expect(action(id).targeting.modes[1]).toEqual({ id: 'thrown', normal: 20, long: 60 });
});

test('editing Fly keeps its automatic grant, willingness requirement and creature duration', async () => {
  const owned = library.add(token.characterSheetId, 'spell:fly');
  library.prepare(token.characterSheetId, owned, true);
  const id = `spell:${owned}`;
  const result = editor.open(token, action(id));
  expect([...field('kind').options].map((option) => option.value)).toEqual(['tokens']);
  expect(field('requiresWilling').checked).toBe(true);
  expect(field('requiresWilling').disabled).toBe(true);
  field('lingerTurns').value = '2';
  await editor.save();
  expect(await result).toBe(true);
  expect(action(id).targeting).toMatchObject({
    kind: 'tokens',
    requiresWilling: true,
    lingerTurns: 2,
    flightGrant: { flySpeed: 60, hover: true, magicalSupport: true },
  });
});

test('changing an area into token targeting converts its duration into a recipient reminder', async () => {
  const owned = library.add(token.characterSheetId, 'spell:grease');
  library.prepare(token.characterSheetId, owned, true);
  const id = `spell:${owned}`;
  const result = editor.open(token, action(id));
  field('kind').value = 'tokens';
  await editor.save();
  expect(await result).toBe(true);
  expect(action(id).targeting).toMatchObject({
    kind: 'tokens',
    shape: null,
    sizeFeet: 0,
    lingerTurns: 10,
    durationTarget: 'targets',
    allowExclusions: false,
  });
});

test('closing the editor without saving leaves the companion untouched', async () => {
  const result = editor.open(token, action('attack:unarmed'));
  field('rangeFeet').value = '100';
  editor.close(false);
  expect(await result).toBe(false);
  expect(library.actions.snapshot(token.characterSheetId).targetingOverrides).toBeUndefined();
});
