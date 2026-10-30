import { RESOURCE_KINDS } from '../../resources/ResourceSchema.js';

export const COMPENDIUM_DRAG_TYPE = 'application/taverntable-compendium';
const KIND_LABELS = {
  item: 'Items & equipment',
  spell: 'Spells',
  monster: 'Creatures',
  species: 'Species / ancestry',
  background: 'Backgrounds',
  feat: 'Feats',
  class: 'Classes',
  subclass: 'Subclasses',
  feature: 'Features',
  condition: 'Conditions',
  rule: 'Rules & skills',
  property: 'Weapon properties / Mastery',
};

export function readCompendiumDrag(text, catalog) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Invalid compendium drag data; start a new drag', { cause: error });
  }
  if (data?.version !== 2 || typeof data.entryId !== 'string') {
    throw new Error('Unsupported compendium drag data; start a new drag');
  }
  if (data.ruleset !== catalog.ruleset)
    throw new Error('This content drag belongs to another campaign ruleset');
  const entry = catalog.get(data.entryId);
  if (data.sourcePack !== entry.sourcePack || data.sourceVersion !== entry.sourceVersion) {
    throw new Error('This content drag belongs to another pinned source version');
  }
  if (!catalog.canAdd(entry.id))
    throw new Error('Enable this source and choose an item or spell before adding content');
  return entry.id;
}

const automationLabel = (entry) => {
  if (entry.kind === 'spell') return 'Casting values/slots automatic; spell effects manual';
  if (entry.kind !== 'item') return 'Reference only; character choices and effects are manual';
  if (entry.automation === 'equipment') return 'Automatic AC / weapon calculations when equipped';
  if (entry.automation === 'effects') return 'Automatic listed stat effects when equipped/attuned';
  return 'Reference item: inventory only; other effects manual';
};

export default class CompendiumPanel {
  constructor({ catalog, onAdd, onError }) {
    this.catalog = catalog;
    this.onAdd = onAdd;
    this.onError = onError;
    this.limit = 40;
    this.addEnabled = true;
    this.root = document.createElement('aside');
    this.root.className = 'sheet-compendium';
    this.root.setAttribute('aria-label', `${catalog.ruleset} campaign compendium`);
    this.root.innerHTML = `
      <header><h4>Compendium</h4><span class="sheet-source-badge">${catalog.ruleset} rules</span></header>
      <label class="sheet-search-label">Search
        <input type="search" aria-label="Search compendium" placeholder="Items, spells, creatures, rules...">
      </label>
      <label class="sheet-search-label">Show
        <select aria-label="Compendium category">
          <option value="all">Everything</option>
          ${RESOURCE_KINDS.map((kind) => `<option value="${kind}">${KIND_LABELS[kind]}</option>`).join('')}
        </select>
      </label>
      <p class="sheet-compendium-count" role="status"></p>
      <div class="sheet-compendium-results"></div>
      <button type="button" class="sheet-more-results">Show more</button>
      <section class="sheet-compendium-detail" hidden aria-label="Compendium entry details"></section>
      <footer>Only enabled, compatible sources appear in search. Automation is limited to marked mechanics.
        Not the complete paid rulebooks.
        <a href="assets/data/resources/NOTICES.txt" target="_blank" rel="noopener">Sources &amp; licenses</a>
      </footer>`;
    this.searchInput = this.root.querySelector('input');
    this.filter = this.root.querySelector('select');
    this.count = this.root.querySelector('[role="status"]');
    this.results = this.root.querySelector('.sheet-compendium-results');
    this.more = this.root.querySelector('.sheet-more-results');
    this.detail = this.root.querySelector('.sheet-compendium-detail');
    for (const [element, event] of [
      [this.searchInput, 'input'],
      [this.filter, 'change'],
    ]) {
      element.addEventListener(event, () => {
        this.limit = 40;
        this.render();
      });
    }
    this.more.addEventListener('click', () => {
      this.limit += 40;
      this.render();
    });
    this.render();
  }

  setAddEnabled(enabled) {
    this.addEnabled = enabled;
    for (const button of this.root.querySelectorAll('[data-compendium-add]')) {
      button.disabled = !enabled;
    }
  }

  render() {
    this.detail.hidden = true;
    this.results.hidden = false;
    const matches = this.catalog.search(this.searchInput.value, { kind: this.filter.value });
    const shown = matches.slice(0, this.limit);
    this.count.textContent = `${matches.length} results${shown.length < matches.length ? `; showing ${shown.length}. Narrow the search or show more.` : ''}`;
    this.results.replaceChildren(...shown.map((entry) => this._row(entry)));
    this.more.hidden = shown.length === matches.length;
  }

  _row(entry) {
    const row = document.createElement('article');
    row.className = 'sheet-compendium-entry';
    row.dataset.entryId = entry.id;
    row.draggable = this.catalog.canAdd(entry.id);
    const title = document.createElement('h5');
    title.textContent = entry.name;
    const meta = document.createElement('p');
    meta.textContent =
      entry.kind === 'spell'
        ? `${entry.level === 0 ? 'Cantrip' : `Level ${entry.level}`} · ${entry.school}`
        : `${entry.category}${entry.rarity ? ` · ${entry.rarity}` : ''}`;
    const automation = document.createElement('small');
    automation.textContent = automationLabel(entry);
    automation.className =
      entry.automation === 'reference' ? 'sheet-reference' : 'sheet-automation';
    const actions = document.createElement('div');
    actions.className = 'sheet-entry-actions';
    const buttons = [
      ...(this.catalog.canAdd(entry.id) ? [['Add', () => this.onAdd(entry.id, false)]] : []),
      ['Details', () => this.show(entry.id)],
    ];
    for (const [label, action] of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('aria-label', `${label} ${entry.name}`);
      if (label === 'Add') {
        button.dataset.compendiumAdd = '';
        button.disabled = !this.addEnabled;
      }
      button.addEventListener('click', action);
      actions.append(button);
    }
    if (entry.kind === 'item' && entry.equipmentType !== 'gear' && this.catalog.canAdd(entry.id)) {
      const equip = document.createElement('button');
      equip.type = 'button';
      equip.textContent = 'Add & equip';
      equip.setAttribute('aria-label', `Add and equip ${entry.name}`);
      equip.dataset.compendiumAdd = '';
      equip.disabled = !this.addEnabled;
      equip.addEventListener('click', () => this.onAdd(entry.id, true));
      actions.append(equip);
    }
    row.addEventListener('dragstart', (event) => {
      if (!this.catalog.canAdd(entry.id)) {
        event.preventDefault();
        this.onError(new Error('This entry is reference-only or its source is disabled'));
        return;
      }
      if (!event.dataTransfer) {
        this.onError(new Error('Drag data is unavailable. Use the Add button instead.'));
        return;
      }
      event.dataTransfer.setData(
        COMPENDIUM_DRAG_TYPE,
        JSON.stringify({
          version: 2,
          ruleset: this.catalog.ruleset,
          entryId: entry.id,
          sourcePack: entry.sourcePack,
          sourceVersion: entry.sourceVersion,
        })
      );
      event.dataTransfer.setData('text/plain', entry.name);
      event.dataTransfer.effectAllowed = 'copy';
    });
    row.append(title, meta, automation, actions);
    return row;
  }

  show(id) {
    const entry = this.catalog.entries.find((candidate) => candidate.id === id);
    if (!entry) throw new Error('The compendium entry was not found');
    const heading = document.createElement('h4');
    heading.textContent = entry.name;
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close details';
    close.setAttribute('aria-label', 'Close compendium details');
    close.addEventListener('click', () => this.render());
    const summary = document.createElement('p');
    summary.textContent =
      entry.kind === 'spell'
        ? `${entry.castingTime}; ${entry.range}; ${entry.duration}${entry.concentration ? '; concentration' : ''}${entry.ritual ? '; ritual' : ''}. Components: ${entry.components}${entry.material ? ` (${entry.material})` : ''}.`
        : entry.kind === 'item'
          ? `${entry.category}${entry.cost ? `; ${entry.cost}` : ''}${Number.isFinite(entry.weight) ? `; ${entry.weight} lb` : '; weight not listed'}.`
          : entry.category;
    const coverage = document.createElement('p');
    coverage.className = 'sheet-reference';
    coverage.textContent = automationLabel(entry);
    const paragraphs = [...entry.description, ...(entry.automationNotes || [])].map((text) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'sheet-reference-text';
      paragraph.textContent = text;
      return paragraph;
    });
    if (entry.armor) {
      const armor = document.createElement('p');
      const value = entry.armor.base;
      const rules = [
        entry.equipmentType === 'shield'
          ? `+${value} AC while equipped`
          : `AC ${value}; ${entry.armor.dexterity ? 'add Dexterity modifier' : 'no Dexterity modifier'}`,
      ];
      if (entry.armor.dexterity && Number.isFinite(entry.armor.maxDexterity)) {
        rules.push(`Dexterity bonus capped at +${entry.armor.maxDexterity}`);
      }
      if (entry.armor.strengthMinimum > 0) {
        rules.push(`Strength ${entry.armor.strengthMinimum} to avoid the armor speed penalty`);
      }
      if (entry.armor.stealthDisadvantage) rules.push('Disadvantage on Stealth checks');
      armor.textContent = `${rules.join('; ')}.`;
      paragraphs.unshift(armor);
    }
    if (entry.weapon) {
      const weapon = document.createElement('p');
      weapon.textContent = `${entry.weapon.damage} ${entry.weapon.damageType}; ${entry.weapon.properties.join(', ')}${entry.weapon.versatile ? `; versatile ${entry.weapon.versatile}` : ''}.`;
      paragraphs.unshift(weapon);
    }
    const source = this.catalog.packs.find(
      (pack) => pack.id === entry.sourcePack && pack.version === entry.sourceVersion
    );
    if (source) {
      const citation = document.createElement('p');
      citation.textContent = `Source: ${source.name} / ${source.version}${source.enabled ? '' : ' (disabled for new additions)'}`;
      paragraphs.push(citation);
    }
    this.detail.replaceChildren(heading, close, summary, coverage, ...paragraphs);
    this.results.hidden = true;
    this.more.hidden = true;
    this.detail.hidden = false;
  }
}
