import { commitStorageChanges } from './storageChanges.js';

export const PLAY_LAYOUT_STORAGE_PREFIX = 'taverntable.character-layout.v1.';
export const PLAY_LAYOUT_MODES = ['combat', 'noncombat'];
export const PLAY_LAYOUT_SECTIONS = [
  'favorites',
  'action',
  'bonus',
  'reaction',
  'free',
  'utility',
  'items',
  'recent',
  'saves',
  'skills',
  'abilities',
];

// -- Validated layout data --
const emptyPage = () => ({ sectionOrder: [], cardOrder: {}, favorites: [] });
const emptyState = (id) => ({
  version: 1,
  characterId: id,
  pages: { combat: emptyPage(), noncombat: emptyPage() },
});
const record = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value));
const shape = (value, keys) =>
  record(value) &&
  Object.keys(value).length === keys.length &&
  keys.every((key) => Object.hasOwn(value, key));
const identifiers = (value) =>
  Array.isArray(value) &&
  value.length <= 10000 &&
  new Set(value).size === value.length &&
  value.every((id) => typeof id === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,199}$/.test(id));

export default class CharacterPlayLayout {
  constructor(library) {
    this.library = library;
    this.storage = library.storage;
  }

  // -- Persistence --
  key(id) {
    return `${PLAY_LAYOUT_STORAGE_PREFIX}${id}`;
  }

  page(id, mode) {
    if (!PLAY_LAYOUT_MODES.includes(mode)) throw new Error('Choose a supported play page');
    return this.snapshot(id).pages[mode];
  }

  savePage(id, mode, page) {
    if (!PLAY_LAYOUT_MODES.includes(mode)) throw new Error('Choose a supported play page');
    const state = this.snapshot(id);
    state.pages[mode] = page;
    this.validate(state, id);
    const text = JSON.stringify(state);
    if (text.length > 1000000) throw new Error('The saved play layout is too large');
    commitStorageChanges(this.storage, [[this.key(id), text]]);
  }

  resetPage(id, mode) {
    this.savePage(id, mode, emptyPage());
  }

  snapshot(id) {
    this.library.get(id);
    const raw = this.storage.getItem(this.key(id));
    if (raw !== null && raw.length > 1000000) throw new Error('The saved play layout is too large');
    const state = raw === null ? emptyState(id) : JSON.parse(raw);
    this.validate(state, id);
    return state;
  }

  rebind(id, snapshot = null, sourceId = id) {
    if (snapshot === null) return emptyState(id);
    this.validate(snapshot, sourceId);
    return { ...JSON.parse(JSON.stringify(snapshot)), characterId: id };
  }

  // -- Shape and ownership --
  validate(state, id) {
    if (
      !shape(state, ['version', 'characterId', 'pages']) ||
      state.version !== 1 ||
      state.characterId !== id ||
      !shape(state.pages, PLAY_LAYOUT_MODES)
    ) {
      throw new Error('The saved play layout has an invalid format or owner');
    }
    for (const page of Object.values(state.pages)) {
      if (
        !shape(page, ['sectionOrder', 'cardOrder', 'favorites']) ||
        !identifiers(page.sectionOrder) ||
        page.sectionOrder.some((section) => !PLAY_LAYOUT_SECTIONS.includes(section)) ||
        !identifiers(page.favorites) ||
        !record(page.cardOrder) ||
        Object.entries(page.cardOrder).some(
          ([section, ids]) => !PLAY_LAYOUT_SECTIONS.includes(section) || !identifiers(ids)
        )
      ) {
        throw new Error('The saved play layout contains invalid sections or card identifiers');
      }
    }
  }
}
