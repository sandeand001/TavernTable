import fs from 'node:fs';
import path from 'node:path';
import SavedCharacterRoster, {
  SAVED_CHARACTER_DRAG_MIME,
} from '../../../src/ui/characters/SavedCharacterRoster.js';
import { SavedCharacterSheets } from '../../../src/ui/sessions/PlayerCharacterSheets.js';
import { GameErrors } from '../../../src/utils/error/ErrorHandler.js';

jest.mock('../../../src/ui/sessions/PlayerCharacterSheets.js', () => ({
  SavedCharacterSheets: jest.fn(),
}));
jest.mock('../../../src/ui/components/CharacterSheetWindow.js', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    attach: jest.fn().mockReturnThis(),
    open: jest.fn(async () => {}),
    closeTab: jest.fn(),
    destroy: jest.fn(),
  })),
}));
jest.mock('../../../src/ui/characters/characterServices.js', () => ({
  notifyCharacterChanged: jest.fn((gameManager, characterId, entryKind = null, origin = null) =>
    globalThis.window.dispatchEvent(
      new CustomEvent('taverntable:characterChanged', {
        detail: { gameManager, characterId, entryKind, origin },
      })
    )
  ),
}));
jest.mock('../../../src/utils/error/ErrorHandler.js', () => ({
  GameErrors: { input: jest.fn() },
}));

let records;
let library;
let gm;
let roster;
let onOpenPlaced;
let savedSheets;
let unsubscribe;

const settle = async () => {
  for (let step = 0; step < 25; step++) await Promise.resolve();
};

beforeEach(() => {
  jest.clearAllMocks();
  records = new Map([
    [
      'hero',
      {
        id: 'hero',
        name: 'Saved hero',
        classId: 'fighter',
        level: 3,
        hp: { current: 4 },
      },
    ],
    [
      'npc',
      {
        id: 'npc',
        name: 'Saved NPC',
        classId: '',
        level: 1,
        hp: { current: 7 },
      },
    ],
  ]);
  library = {
    campaign: { id: 'campaign', name: 'Table', ruleset: '2024' },
    store: { identity: { role: 'dm' } },
    sourceCatalog: { version: 1, ruleset: '2024', entries: [], classes: [] },
    revision: 1,
    sceneRevision: 1,
    savedScene: '{}',
    classes: new Map([['fighter', { name: 'Fighter' }]]),
    list: () =>
      [...records.values()].map(({ id, name, classId, level }) => ({ id, name, classId, level })),
    get: (id) => {
      const character = records.get(id);
      if (!character) throw new Error('Character missing');
      return { ...character, hp: { ...character.hp } };
    },
    create: jest.fn(async (name, options) => {
      records.set('new-character', {
        id: 'new-character',
        name,
        classId: '',
        level: 1,
        hp: { current: 10 },
        ...options,
      });
      return 'new-character';
    }),
    edit: jest.fn(async (id, updates) => records.set(id, { ...records.get(id), ...updates })),
    import: jest.fn(async () => {
      records.set('imported-character', {
        id: 'imported-character',
        name: 'Imported hero',
        classId: '',
        level: 1,
        hp: { current: 8 },
      });
      return 'imported-character';
    }),
    engine: {
      storage: {
        snapshot: () =>
          [...records].map(([id, value]) => ({
            key: `taverntable.character.v1.${id}`,
            value: JSON.stringify(value),
          })),
      },
    },
  };
  unsubscribe = jest.fn();
  gm = {
    characterServices: { library },
    placedTokens: [{ id: 'npc-token', characterSheetId: 'npc', name: 'Saved NPC', type: 'mutant' }],
    tokenManager: {
      selectedSavedCharacterId: null,
      getSelectedTokenType: () => 'knight',
      selectSavedCharacter: jest.fn((id) => {
        gm.tokenManager.selectedSavedCharacterId = id;
        window.dispatchEvent(
          new CustomEvent('taverntable:tokenTypeChanged', { detail: { gameManager: gm } })
        );
      }),
      cancelSavedCharacterPlacement: jest.fn(() => {
        gm.tokenManager.selectedSavedCharacterId = null;
        window.dispatchEvent(
          new CustomEvent('taverntable:tokenTypeChanged', { detail: { gameManager: gm } })
        );
      }),
    },
    token3DAdapter: { setSelectedToken: jest.fn(async () => {}) },
    sceneAutosave: {
      ready: true,
      subscribe: (callback) => {
        callback();
        return unsubscribe;
      },
    },
  };
  onOpenPlaced = jest.fn(async () => true);
  savedSheets = { open: jest.fn(async () => true), refresh: jest.fn(), destroy: jest.fn() };
  SavedCharacterSheets.mockImplementation(() => savedSheets);
  roster = new SavedCharacterRoster({ gameManager: gm, services: { library }, onOpenPlaced });
  roster.attach(document.body);
});

afterEach(() => {
  roster.destroy();
  document.body.replaceChildren();
});

test('the actual page places the saved roster immediately below the token palette section', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  const page = new DOMParser().parseFromString(html, 'text/html');
  const palette = page.getElementById('creature-content').closest('.section');
  expect(palette.nextElementSibling.id).toBe('saved-character-roster');
});

test('the DM sees all saved records, can search them, and placed characters offer focus rather than another placement', () => {
  expect(roster.list.querySelectorAll('[data-roster-character]')).toHaveLength(2);
  expect(roster.list.textContent).toContain('Saved hero');
  expect(roster.list.textContent).toContain('Saved NPC');
  expect(
    roster.list.querySelector('[data-roster-character="hero"] [data-roster-action="place"]')
  ).not.toBeNull();
  expect(
    roster.list.querySelector('[data-roster-character="npc"] [data-roster-action="focus"]')
  ).not.toBeNull();
  roster.search.value = 'hero';
  roster.search.dispatchEvent(new Event('input'));
  expect(roster.list.querySelectorAll('[data-roster-character]')).toHaveLength(1);
  expect(
    () =>
      new SavedCharacterRoster({
        gameManager: gm,
        services: { library, sessionRole: 'player' },
        onOpenPlaced,
      })
  ).toThrow('DM');
});

test('opening an unplaced record uses the shared saved-sheet adapter and does not create a canonical token or character', async () => {
  const before = [...gm.placedTokens];
  await roster.open('hero');
  expect(SavedCharacterSheets).toHaveBeenCalledWith(expect.objectContaining({ library }));
  expect(savedSheets.open).toHaveBeenCalledWith('hero');
  expect(gm.placedTokens).toEqual(before);
  expect(library.create).not.toHaveBeenCalled();
});

test('opening or focusing an existing sprite uses its existing canonical sheet', async () => {
  roster.list.querySelector('[data-roster-character="npc"] [data-roster-action="focus"]').click();
  await settle();
  expect(onOpenPlaced).toHaveBeenCalledWith(gm.placedTokens[0]);
  expect(SavedCharacterSheets).not.toHaveBeenCalled();
  expect(gm.placedTokens).toHaveLength(1);
  expect(library.create).not.toHaveBeenCalled();
});

test('Place arms the saved identity, clears movement selection, and Escape cancels it', async () => {
  const appearance = roster.list.querySelector('[data-character-appearance="hero"]');
  appearance.value = 'knight';
  appearance.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  roster.list.querySelector('[data-roster-character="hero"] [data-roster-action="place"]').click();
  await settle();
  expect(gm.tokenManager.selectSavedCharacter).toHaveBeenCalledWith('hero', 'knight');
  expect(gm.token3DAdapter.setSelectedToken).toHaveBeenCalledWith(null);
  expect(
    roster.list
      .querySelector('[data-roster-character="hero"] [data-roster-action="place"]')
      .getAttribute('aria-pressed')
  ).toBe('true');
  expect(roster.status.textContent).toContain('supported floor');
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(gm.tokenManager.cancelSavedCharacterPlacement).toHaveBeenCalled();
  expect(roster.status.textContent).toContain('canceled');
});

test('appearance choices are placement-only and never change the saved record or schema', async () => {
  const before = library.get('hero');
  const appearance = roster.list.querySelector('[data-character-appearance="hero"]');
  appearance.value = 'female-archer';
  appearance.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(library.edit).not.toHaveBeenCalled();
  expect(library.get('hero')).toEqual(before);
  roster.list.querySelector('[data-roster-character="hero"] [data-roster-action="place"]').click();
  await settle();
  expect(gm.tokenManager.selectSavedCharacter).toHaveBeenCalledWith('hero', 'female-archer');
  expect(roster.list.querySelector('[data-character-appearance="npc"]').disabled).toBe(true);
});

test('creating a character saves a record and opens its sheet without placing a sprite', async () => {
  const count = gm.placedTokens.length;
  roster.root.querySelector('[aria-label="New saved character name"]').value = 'New hero';
  roster.root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(library.create).toHaveBeenCalledWith('New hero');
  expect(roster.list.querySelector('[data-character-appearance="new-character"]').value).toBe('');
  expect(
    roster.list.querySelector(
      '[data-roster-character="new-character"] [data-roster-action="place"]'
    ).disabled
  ).toBe(true);
  expect(savedSheets.open).toHaveBeenCalledWith('new-character');
  expect(gm.placedTokens).toHaveLength(count);
  expect(roster.list.textContent).toContain('New hero');
});

test('importing a character opens its separate saved record without replacing an actor or choosing a player viewpoint', async () => {
  const actors = [...gm.placedTokens];
  const text = '{"format":"taverntable-character","version":5}';
  Object.defineProperty(roster.importFile, 'files', {
    value: [{ size: text.length, text: async () => text }],
  });
  roster.importFile.dispatchEvent(new Event('change'));
  await settle();
  expect(library.import).toHaveBeenCalledWith(text);
  expect(savedSheets.open).toHaveBeenCalledWith('imported-character');
  expect(gm.placedTokens).toEqual(actors);
  expect(gm.token3DAdapter.setSelectedToken).not.toHaveBeenCalled();
  expect(library.create).not.toHaveBeenCalled();
  expect(roster.status.textContent).toContain('separate saved record');
  expect(roster.list.querySelector('[data-character-appearance="imported-character"]').value).toBe(
    ''
  );
  expect(
    roster.list.querySelector(
      '[data-roster-character="imported-character"] [data-roster-action="place"]'
    ).disabled
  ).toBe(true);
});

test('oversized character imports report an error before reading or importing any record', async () => {
  const text = jest.fn();
  Object.defineProperty(roster.importFile, 'files', {
    value: [{ size: 4000001, text }],
  });
  roster.importFile.dispatchEvent(new Event('change'));
  await settle();
  expect(text).not.toHaveBeenCalled();
  expect(library.import).not.toHaveBeenCalled();
  expect(roster.status.textContent).toContain('smaller than 4 MB');
  expect(GameErrors.input).toHaveBeenCalled();
});

test('removing a linked sprite remembers its appearance for this workspace without mutating the character', async () => {
  const npc = library.get('npc');
  const token = gm.placedTokens.pop();
  window.dispatchEvent(
    new CustomEvent('taverntable:tokenRemoved', { detail: { gameManager: gm, token } })
  );
  await settle();
  expect(library.edit).not.toHaveBeenCalled();
  expect(library.get('npc')).toEqual(npc);
  expect(roster.list.querySelector('[data-character-appearance="npc"]').value).toBe('mutant');
  expect(
    roster.list.querySelector('[data-roster-character="npc"] [data-roster-action="place"]')
  ).not.toBeNull();
});

test('save errors remain visible and lifecycle cleanup releases subscriptions', async () => {
  library.create.mockRejectedValueOnce(new Error('Host unavailable'));
  roster.root.querySelector('[aria-label="New saved character name"]').value = 'New hero';
  roster.root
    .querySelector('form')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await settle();
  expect(roster.status.textContent).toContain('Host unavailable');
  expect(GameErrors.input).toHaveBeenCalled();
  roster.destroy();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('dragging a saved record uses only the dedicated character MIME with its explicit appearance', async () => {
  const appearance = roster.list.querySelector('[data-character-appearance="hero"]');
  appearance.value = 'knight';
  appearance.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  const payloads = new Map();
  const event = new Event('dragstart', { bubbles: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { setData: (type, value) => payloads.set(type, value) },
  });
  roster.list
    .querySelector('[data-roster-character="hero"] [data-roster-action="place"]')
    .dispatchEvent(event);
  expect([...payloads.keys()]).toEqual([SAVED_CHARACTER_DRAG_MIME]);
  expect(JSON.parse(payloads.get(SAVED_CHARACTER_DRAG_MIME))).toEqual({
    characterId: 'hero',
    appearance: 'knight',
  });
});

test('unknown unplaced records require an explicit sprite choice without inferring one from the palette or portrait', async () => {
  const before = library.get('hero');
  const place = roster.list.querySelector(
    '[data-roster-character="hero"] [data-roster-action="place"]'
  );
  expect(roster.list.querySelector('[data-character-appearance="hero"]').value).toBe('');
  expect(place.disabled).toBe(true);
  expect(place.draggable).toBe(false);
  place.click();
  const event = new Event('dragstart', { bubbles: true });
  const setData = jest.fn();
  Object.defineProperty(event, 'dataTransfer', { value: { setData } });
  place.dispatchEvent(event);
  expect(setData).not.toHaveBeenCalled();
  expect(gm.tokenManager.selectSavedCharacter).not.toHaveBeenCalled();
  const appearance = roster.list.querySelector('[data-character-appearance="hero"]');
  appearance.value = 'female-archer';
  appearance.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  expect(
    roster.list.querySelector('[data-roster-character="hero"] [data-roster-action="place"]')
      .disabled
  ).toBe(false);
  expect(library.get('hero')).toEqual(before);
  expect(library.edit).not.toHaveBeenCalled();
});

test('unplaced next-sprite choices do not survive a fresh roster while an existing sprite keeps its actual model', async () => {
  records.get('hero').portraitImage = 'data:image/png;base64,iVBORw0KGgo=';
  const before = library.get('hero');
  const appearance = roster.list.querySelector('[data-character-appearance="hero"]');
  appearance.value = 'knight';
  appearance.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  roster.destroy();
  roster = new SavedCharacterRoster({ gameManager: gm, services: { library }, onOpenPlaced });
  roster.attach(document.body);
  expect(roster.list.querySelector('[data-character-appearance="hero"]').value).toBe('');
  expect(
    roster.list.querySelector('[data-roster-character="hero"] [data-roster-action="place"]')
      .disabled
  ).toBe(true);
  expect(roster.list.querySelector('[data-character-appearance="npc"]').value).toBe('mutant');
  expect(gm.placedTokens[0].type).toBe('mutant');
  expect(library.get('hero')).toEqual(before);
  expect(library.edit).not.toHaveBeenCalled();
});

test('the real shared saved-sheet adapter reuses the actual library without world selection or notification recursion', async () => {
  const { SavedCharacterSheets: SharedSheets } = jest.requireActual(
    '../../../src/ui/sessions/PlayerCharacterSheets.js'
  );
  const onChanged = jest.fn((id) => {
    if (id)
      window.dispatchEvent(
        new CustomEvent('taverntable:characterChanged', {
          detail: { gameManager: gm, characterId: id, origin: adapter },
        })
      );
  });
  const actors = [...gm.placedTokens];
  const adapter = new SharedSheets({ library, gameManager: gm, onChanged });
  roster.savedSheets = adapter;
  expect(adapter.library).toBe(library);
  expect(adapter.manager).not.toBe(gm);
  expect(adapter.services).toMatchObject({ sessionRole: 'dm', sheetContext: 'library' });
  expect(adapter.manager.placedTokens.map((token) => token.characterSheetId)).toEqual(['hero']);
  await adapter.open('hero');
  expect(adapter.selected.characterSheetId).toBe('hero');
  expect(gm.placedTokens).toEqual(actors);
  expect(gm.token3DAdapter.setSelectedToken).not.toHaveBeenCalled();
  expect(library.create).not.toHaveBeenCalled();
  adapter.refresh();
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenLastCalledWith();
  onChanged.mockClear();
  window.dispatchEvent(
    new CustomEvent('taverntable:characterChanged', {
      detail: { gameManager: adapter.manager, characterId: 'hero' },
    })
  );
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(onChanged).toHaveBeenCalledWith('hero');
  const refresh = jest.spyOn(adapter, 'refresh');
  window.dispatchEvent(
    new CustomEvent('taverntable:characterChanged', {
      detail: { gameManager: gm, characterId: 'hero' },
    })
  );
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(library.create).not.toHaveBeenCalled();
  expect(gm.token3DAdapter.setSelectedToken).not.toHaveBeenCalled();
  const presentation = adapter.selected;
  gm.placedTokens.push({ id: 'hero-token', characterSheetId: 'hero', type: 'knight' });
  window.dispatchEvent(
    new CustomEvent('taverntable:campaignViewStateChanged', { detail: { gameManager: gm } })
  );
  expect(adapter.manager.placedTokens).toHaveLength(0);
  expect(adapter.sheets.closeTab).toHaveBeenCalledWith(presentation);
  expect(adapter.selected).toBeNull();
  expect(library.edit).not.toHaveBeenCalled();
});
