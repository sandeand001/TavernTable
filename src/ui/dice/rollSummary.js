import { copyRollSummary } from '../../systems/dice/rollSummary.js';
import { escapeHtml as escape } from '../characters/escapeHtml.js';

export function rollSummaryMarkup(value, label) {
  const summary = copyRollSummary(value);
  const displayLabel = label ?? summary.label;
  return `<span class="roll-summary">${displayLabel ? `${escape(displayLabel)}: ` : ''}<span class="roll-total" tabindex="0"
    title="${escape(summary.breakdown)}" aria-label="Total ${summary.total}"
    aria-description="${escape(summary.breakdown)}">${summary.total}</span></span>`;
}
