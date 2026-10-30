import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';

export default class HealthBar {
  constructor({ onApply }) {
    this.onApply = onApply;
    this.characterId = null;
    this.mode = null;
    this.root = document.createElement('section');
    this.root.className = 'sheet-health-display';
    this.root.innerHTML = `
      <div class="sheet-health-heading">
        <strong>Health</strong>
        <output aria-label="Hit point total">0 / 0</output>
        <span class="sheet-health-temp" aria-label="Temporary HP bonus" hidden></span>
      </div>
      <div class="sheet-health-meter" role="progressbar" aria-label="Hit points"
        aria-valuemin="0" aria-valuemax="1" aria-valuenow="0">
        <div class="sheet-health-fill"></div>
      </div>
      <div class="sheet-health-buttons">
        <button type="button" data-health-mode="damage" aria-label="Damage hit points" disabled>Damage</button>
        <button type="button" data-health-mode="heal" aria-label="Heal hit points" disabled>Heal</button>
        <button type="button" data-health-mode="edit" aria-label="Edit hit points" disabled>Edit</button>
      </div>
      <form class="sheet-health-editor" aria-label="Hit point adjustment" novalidate hidden>
        <div class="sheet-health-edit-values" hidden>
          <label class="sheet-field">Current HP<input type="number" min="0" max="9999" step="1"
            aria-label="Current hit points" data-health-value="current"></label>
          <label class="sheet-field">Maximum HP<input type="number" min="0" max="9999" step="1"
            aria-label="Maximum hit points" data-health-value="max"></label>
          <label class="sheet-field">Temporary HP<input type="number" min="0" max="9999" step="1"
            aria-label="Temporary hit points" data-health-value="temp"></label>
        </div>
        <label class="sheet-field sheet-health-amount">
          <span>Damage amount</span>
          <input type="number" min="0" max="1000000" step="1" aria-label="Damage amount">
        </label>
        <p class="sheet-health-help"></p>
        <div class="sheet-health-buttons">
          <button type="submit" aria-label="Apply HP change">Apply</button>
          <button type="button" data-health-cancel>Cancel</button>
        </div>
      </form>`;
    this.total = this.root.querySelector('output');
    this.temp = this.root.querySelector('.sheet-health-temp');
    this.meter = this.root.querySelector('[role="progressbar"]');
    this.fill = this.root.querySelector('.sheet-health-fill');
    this.editor = this.root.querySelector('form');
    this.editValues = this.root.querySelector('.sheet-health-edit-values');
    this.amountGroup = this.root.querySelector('.sheet-health-amount');
    this.amount = this.amountGroup.querySelector('input');
    this.help = this.root.querySelector('.sheet-health-help');
    this.root.addEventListener('click', (event) => {
      const mode = event.target.closest('[data-health-mode]')?.dataset.healthMode;
      if (mode) this._open(mode);
      if (event.target.closest('[data-health-cancel]')) this._close();
    });
    this.editor.addEventListener('submit', (event) => {
      event.preventDefault();
      this._apply();
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.mode) {
        event.preventDefault();
        event.stopPropagation();
        this._close();
      }
    });
  }

  // -- Display and lifecycle --
  update(character) {
    if (this.characterId !== character.id) this._close(false);
    this.characterId = character.id;
    this.hp = { ...character.hp };
    const { current, max, temp } = this.hp;
    const proportion = max > 0 ? current / max : 0;
    this.total.textContent = `${current} / ${max}`;
    this.meter.setAttribute('aria-valuenow', String(current));
    this.meter.setAttribute('aria-valuemax', String(Math.max(1, max)));
    this.meter.setAttribute(
      'aria-valuetext',
      `${current} of ${max} hit points; ${temp} temporary HP`
    );
    this.meter.dataset.healthLevel =
      proportion > 0.5 ? 'healthy' : proportion > 0.25 ? 'hurt' : 'critical';
    this.fill.style.width = `${100 * proportion}%`;
    this.temp.hidden = temp === 0;
    this.temp.textContent = `+${temp} temp`;
    for (const button of this.root.querySelectorAll('[data-health-mode]')) button.disabled = false;
  }

  clear() {
    this._close(false);
    this.characterId = null;
    this.hp = null;
  }

  // -- Editing --
  _open(mode) {
    this.mode = mode;
    this.editor.hidden = false;
    this.editValues.hidden = mode !== 'edit';
    this.amountGroup.hidden = mode === 'edit';
    if (mode === 'edit') {
      for (const key of ['current', 'max', 'temp']) {
        this.editValues.querySelector(`[data-health-value="${key}"]`).value = String(this.hp[key]);
      }
      this.help.textContent = 'Direct correction. Current HP cannot exceed maximum HP.';
      this.editValues.querySelector('input').focus();
    } else {
      const label = mode === 'damage' ? 'Damage amount' : 'Healing amount';
      this.amountGroup.querySelector('span').textContent = label;
      this.amount.setAttribute('aria-label', label);
      this.amount.value = '';
      this.help.textContent =
        mode === 'damage'
          ? 'Enter final damage after resistance or other adjustments. Temporary HP is used first.'
          : 'Healing cannot exceed maximum HP and does not change temporary HP.';
      this.amount.focus();
    }
  }

  _close(focus = true) {
    const previous = this.mode;
    this.mode = null;
    this.editor.hidden = true;
    if (focus && previous) this.root.querySelector(`[data-health-mode="${previous}"]`).focus();
  }

  _apply() {
    const values =
      this.mode === 'edit'
        ? Object.fromEntries(
            ['current', 'max', 'temp'].map((key) => [
              key,
              this.editValues.querySelector(`[data-health-value="${key}"]`).valueAsNumber,
            ])
          )
        : this.amount.valueAsNumber;
    const id = this.characterId;
    afterCharacterCommit(this.onApply(id, this.mode, values), (saved) => {
      if (saved && id === this.characterId) this._close();
    });
  }
}
