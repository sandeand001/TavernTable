import { reconcileContent } from './reconcileContent.js';
import { escapeHtml as escape } from './escapeHtml.js';
import { rollSummaryMarkup } from '../dice/rollSummary.js';

function withoutCharacterName(text, name) {
  const prefix = `${name}: `;
  return text.startsWith(prefix) ? text.slice(prefix.length) : text;
}

export default class RollHistory {
  constructor({ onError }) {
    this.onError = onError;
    this.filter = 'all';
    this.context = null;
    this.root = document.createElement('aside');
    this.root.className = 'sheet-history-rail';
    this.root.setAttribute('aria-label', 'Recent action rolls');
    this.root.hidden = true;
    this.root.innerHTML = `
      <header class="sheet-history-header">
        <h4>Recent uses &amp; follow-up rolls</h4>
        <div class="sheet-history-filters" role="group" aria-label="History filter">
          <button type="button" data-history-filter="all" aria-pressed="true">All rolls</button>
          <button type="button" data-history-filter="turn" aria-pressed="false">This turn</button>
        </div>
      </header>
      <div class="sheet-history-list"></div>`;
    this.list = this.root.querySelector('.sheet-history-list');
    this.root.addEventListener('click', (event) => {
      const filter = event.target.closest('[data-history-filter]')?.dataset.historyFilter;
      if (!filter) return;
      try {
        if (!['all', 'turn'].includes(filter)) throw new Error('Choose a supported history filter');
        this.filter = filter;
        this._render();
        this.list.scrollTop = 0;
      } catch (error) {
        this.onError(error);
      }
    });
  }

  // -- Context and lifecycle --
  update(context) {
    this.context = context;
    this.root.hidden = false;
    this._render();
  }

  clear() {
    this.context = null;
    this.root.hidden = true;
    this.list.replaceChildren();
  }

  destroy() {
    this.clear();
    this.root.remove();
  }

  // -- Filtered, independently scrolling history --
  _render() {
    if (!this.context) return;
    const { session, token, editing } = this.context;
    const entries = session.history(token, this.filter);
    for (const button of this.root.querySelectorAll('[data-history-filter]')) {
      button.setAttribute('aria-pressed', String(button.dataset.historyFilter === this.filter));
    }
    const empty =
      this.filter === 'turn'
        ? session.active
          ? 'No uses or rolls for this character this turn.'
          : 'No combat turn is active.'
        : 'Uses and character-sheet rolls will appear here.';
    reconcileContent(
      this.list,
      entries
        .map((entry) => {
          const name = entry.characterName ?? this.context.character.name;
          const label =
            entry.type === 'roll'
              ? withoutCharacterName(entry.label, name)
              : entry.rollResult && entry.roll
                ? entry.roll.label
                : entry.label;
          const summary = entry.rollResult
            ? rollSummaryMarkup(
                {
                  ...entry.rollResult,
                  breakdown: withoutCharacterName(entry.rollResult.breakdown, name),
                },
                label
              )
            : escape(label);
          return `
      <article data-history-entry="${entry.sequence}" data-sheet-key="history:${entry.sequence}">
        <strong>${summary}${entry.undone ? ' (costs undone)' : ''}</strong>
        <small class="sheet-history-meta">${entry.turn === null ? 'Free play' : `Turn ${entry.turn}`} | ${entry.type === 'roll' ? 'Roll' : 'Use'}</small>
        ${entry.rollText && !entry.rollResult ? `<p>${escape(withoutCharacterName(entry.rollText, name))}</p>` : ''}
        ${entry.note ? `<small>${escape(entry.note)}</small>` : ''}
        <div class="sheet-history-followups">${entry.followups
          .map(
            (roll, index) => `
          <button type="button" data-sheet-action="recent-roll" data-sequence="${entry.sequence}"
            data-part="${index}" ${editing ? 'disabled' : ''}>${escape(roll.label)}: ${escape(roll.expression)}</button>`
          )
          .join('')}</div>
      </article>`;
        })
        .join('') || `<p class="sheet-history-empty">${empty}</p>`
    );
  }
}
