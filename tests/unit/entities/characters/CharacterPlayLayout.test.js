import { CharacterLibrary } from '../../../../src/entities/characters/CharacterLibrary.js';
import snapshot from '../../../../assets/data/srd2014.json';

const createLibrary = () =>
  new CharacterLibrary({
    ruleset: '2014',
    storage: globalThis.localStorage,
    catalog: snapshot.entries,
    classes: snapshot.classes,
  });

beforeEach(() => localStorage.clear());
afterEach(() => jest.restoreAllMocks());

test('play layouts persist independently for each character and page without changing primary records', () => {
  const library = createLibrary();
  const hero = library.create('Hero');
  const other = library.create('Other');
  const page = {
    sectionOrder: ['favorites', 'bonus', 'action'],
    cardOrder: { action: ['hide', 'dash'] },
    favorites: ['dash', 'roll:skill:stealth'],
  };
  library.layouts.savePage(hero, 'combat', page);
  const restored = createLibrary();
  expect(restored.layouts.page(hero, 'combat')).toEqual(page);
  expect(restored.layouts.page(hero, 'noncombat')).toEqual({
    sectionOrder: [],
    cardOrder: {},
    favorites: [],
  });
  expect(restored.layouts.page(other, 'combat').favorites).toEqual([]);
  expect(JSON.parse(localStorage.getItem(`taverntable.character.v1.${hero}`))).not.toHaveProperty(
    'layout'
  );
});

test('portable backups preserve layouts, legacy backups start with defaults, and deletion removes the companion', () => {
  const library = createLibrary();
  const id = library.create('Hero');
  library.layouts.savePage(id, 'combat', {
    sectionOrder: ['saves', 'favorites', 'action'],
    cardOrder: { action: ['hide', 'dash'] },
    favorites: ['dash'],
  });
  const backup = JSON.parse(library.export(id));
  expect(backup.version).toBe(4);
  const copy = library.import(JSON.stringify(backup));
  expect(library.layouts.snapshot(copy).characterId).toBe(copy);
  expect(library.layouts.page(copy, 'combat')).toEqual(library.layouts.page(id, 'combat'));
  delete backup.layout;
  backup.version = 3;
  const legacy = library.import(JSON.stringify(backup));
  expect(library.layouts.page(legacy, 'combat').favorites).toEqual([]);
  library.delete(copy);
  expect(localStorage.getItem(library.layouts.key(copy))).toBeNull();
});

test('invalid preferences fail explicitly without replacing a saved layout', () => {
  const library = createLibrary();
  const id = library.create('Hero');
  const page = { sectionOrder: ['action'], cardOrder: {}, favorites: ['dash'] };
  library.layouts.savePage(id, 'combat', page);
  for (const invalid of [
    { ...page, sectionOrder: ['unknown-panel'] },
    { ...page, favorites: ['dash', 'dash'] },
    { ...page, cardOrder: { action: ['<script>'] } },
  ]) {
    expect(() => library.layouts.savePage(id, 'combat', invalid)).toThrow('invalid');
    expect(library.layouts.page(id, 'combat')).toEqual(page);
  }
  const key = library.layouts.key(id);
  localStorage.setItem(key, '{invalid');
  expect(() => library.layouts.snapshot(id)).toThrow();
  expect(localStorage.getItem(key)).toBe('{invalid');
});

test('a failed layout import rolls back every character companion instead of leaving a partial copy', () => {
  const library = createLibrary();
  const id = library.create('Hero');
  const backup = library.export(id);
  const before = Object.keys(localStorage).sort();
  const original = Storage.prototype.setItem;
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
    if (key.startsWith('taverntable.character-layout.v1.')) throw new Error('Storage quota');
    return original.call(this, key, value);
  });
  expect(() => library.import(backup)).toThrow('previous data was restored');
  expect(Object.keys(localStorage).sort()).toEqual(before);
  expect(library.list()).toHaveLength(1);
});
