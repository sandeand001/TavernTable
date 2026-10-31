import { edition } from '../../rules/editions.js';
import { RESOURCE_KINDS } from '../../resources/ResourceSchema.js';

export class CompendiumCatalog {
  constructor(data) {
    if (data?.version !== 1 || !Array.isArray(data.entries) || !Array.isArray(data.classes)) {
      throw new Error('Unsupported or invalid compendium format');
    }
    Object.defineProperty(this, 'ruleset', { value: edition(data.ruleset).id, enumerable: true });
    this.entries = data.entries.slice();
    this.classes = data.classes.slice();
    this.packs = data.packs?.slice() || [];
    this.enabledEntryIds = new Set(data.enabledEntryIds ?? data.entries.map((entry) => entry.id));
    this.provenance = data.provenance;
    this._byId = new Map();
    this._searchText = new Map();
    for (const entry of this.entries) {
      if (
        typeof entry.id !== 'string' ||
        typeof entry.name !== 'string' ||
        !RESOURCE_KINDS.includes(entry.kind) ||
        (entry.ruleset !== undefined && entry.ruleset !== this.ruleset) ||
        this._byId.has(entry.id)
      ) {
        throw new Error('The compendium contains an invalid or duplicate entry');
      }
      this._byId.set(entry.id, entry);
      this._searchText.set(
        entry.id,
        [
          entry.name,
          entry.category,
          entry.school,
          ...(entry.classes || []),
          ...(entry.description || []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
      );
    }
  }

  search(query, { kind = 'all' } = {}) {
    if (typeof query !== 'string' || !['all', ...RESOURCE_KINDS].includes(kind)) {
      throw new Error('Invalid compendium search');
    }
    const text = query.trim().toLowerCase();
    const terms = text.split(/\s+/).filter(Boolean);
    const rank = (entry) => {
      const name = entry.name.toLowerCase();
      return name === text ? 0 : terms.every((term) => name.includes(term)) ? 1 : 2;
    };
    return this.entries
      .filter(
        (entry) =>
          this.enabledEntryIds.has(entry.id) &&
          (kind === 'all' || entry.kind === kind) &&
          terms.every((term) => this._searchText.get(entry.id).includes(term))
      )
      .sort(
        (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
      );
  }

  get(id) {
    const entry = this._byId.get(id);
    if (!entry) throw new Error('The compendium entry was not found in this campaign');
    return entry;
  }

  canAdd(id) {
    const entry = this._byId.get(id);
    return this.enabledEntryIds.has(id) && ['item', 'spell'].includes(entry?.kind);
  }
}
