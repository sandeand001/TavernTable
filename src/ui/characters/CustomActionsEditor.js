import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import { reconcileContent } from './reconcileContent.js';
import { escapeHtml as escape } from './escapeHtml.js';
import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';

export default class CustomActionsEditor {
  constructor({ onChanged }) {
    this.onChanged = onChanged;
    this.characterId = null;
    this.editingId = null;
    this.root = document.createElement('section');
    this.root.className = 'sheet-custom-actions';
    this.root.setAttribute('aria-label', 'Custom ability editor');
    this.root.innerHTML = `
      <details>
        <summary>Custom abilities &amp; attack settings</summary>
        <p>Configure unsupported features here. Play buttons track costs/uses; conditions and effects remain manual.</p>
        <div class="sheet-custom-attack-count">
          <label><input type="checkbox" aria-label="Override attacks per action"> Override class attacks per Attack action</label>
          <input type="number" min="1" max="10" step="1" value="2" aria-label="Attacks per Attack action">
          <button type="button" data-custom-action="attacks">Save attack setting</button>
        </div>
        <p role="status" aria-label="Custom ability status"></p>
        <button type="button" data-custom-action="new">New custom ability</button>
        <form class="sheet-custom-form" novalidate hidden>
          <label class="sheet-field">Name<input aria-label="Custom ability name" maxlength="100"></label>
          <label class="sheet-field">Activation<select aria-label="Custom ability activation">
            <option value="action">Action</option><option value="bonus">Bonus action</option>
            <option value="reaction">Reaction</option><option value="free">No action</option>
          </select></label>
          <label data-custom-magic><input type="checkbox" aria-label="Custom ability uses Magic action"> Uses the Magic action (2024)</label>
          <label class="sheet-field">Shared class resource<select aria-label="Custom ability class resource"></select></label>
          <label class="sheet-field" data-custom-resource-cost>Resource cost
            <input type="number" min="1" max="10000" step="1" value="1" aria-label="Custom ability resource cost">
          </label>
          <label><input type="checkbox" aria-label="Limit custom ability uses"> Track separate limited uses</label>
          <div class="sheet-custom-use-settings">
            <label class="sheet-field">Maximum uses<input type="number" min="1" max="10000" step="1" value="1" aria-label="Custom ability maximum uses"></label>
            <label class="sheet-field">Reset<select aria-label="Custom ability reset">
              <option value="turn">Each combat turn</option><option value="short">Short / long rest</option>
              <option value="long" selected>Long rest</option><option value="daily">New game day</option>
              <option value="manual">Manual adjustment only</option>
            </select></label>
          </div>
          <label class="sheet-field">Rules / reminders<textarea aria-label="Custom ability notes" rows="3" maxlength="2000"></textarea></label>
          <div><button type="submit" data-custom-action="save">Save ability</button>
            <button type="button" data-custom-action="cancel">Cancel</button></div>
        </form>
        <div class="sheet-custom-list"></div>
      </details>`;
    this.status = this.root.querySelector('[role="status"]');
    this.form = this.root.querySelector('form');
    this.rows = this.root.querySelector('.sheet-custom-list');
    this.name = this.root.querySelector('[aria-label="Custom ability name"]');
    this.cost = this.root.querySelector('[aria-label="Custom ability activation"]');
    this.magic = this.root.querySelector('[aria-label="Custom ability uses Magic action"]');
    this.resource = this.root.querySelector('[aria-label="Custom ability class resource"]');
    this.resourceCost = this.root.querySelector('[aria-label="Custom ability resource cost"]');
    this.limited = this.root.querySelector('[aria-label="Limit custom ability uses"]');
    this.maximum = this.root.querySelector('[aria-label="Custom ability maximum uses"]');
    this.reset = this.root.querySelector('[aria-label="Custom ability reset"]');
    this.note = this.root.querySelector('textarea');
    this.override = this.root.querySelector('[aria-label="Override attacks per action"]');
    this.attackCount = this.root.querySelector('[aria-label="Attacks per Attack action"]');
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this._save();
    });
    this.root.addEventListener('change', () => this._visibility());
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('[data-custom-action]');
      if (!button) return;
      const action = button.dataset.customAction;
      if (action === 'new') this._edit(null);
      if (action === 'edit') this._edit(button.dataset.id);
      if (action === 'cancel') this.form.hidden = true;
      if (
        action === 'delete' &&
        window.confirm('Delete this custom ability and its tracked uses?')
      ) {
        this._perform(() => this.library.actions.remove(this.characterId, button.dataset.id));
      }
      if (action === 'attacks') {
        this._perform(() =>
          this.library.actions.setAttackCount(
            this.characterId,
            this.override.checked ? this.attackCount.valueAsNumber : null
          )
        );
      }
    });
  }

  // -- Lifecycle and display --
  update(character, library) {
    this.library = library;
    if (this.characterId !== character.id) {
      this.characterId = character.id;
      this.editingId = null;
      this.form.hidden = true;
      this.root.querySelector('details').open = false;
      this.status.textContent = '';
    }
    try {
      const state = library.actions.snapshot(character.id);
      const classes = library.rest
        .status(character.id)
        .resources.filter((resource) => !resource.id.startsWith('custom:'));
      const signature = JSON.stringify(classes.map((resource) => [resource.id, resource.name]));
      if (signature !== this.resourceSignature) {
        const selected = this.resource.value;
        this.resource.replaceChildren(
          ...[{ id: '', name: 'None: unlimited or separate uses' }, ...classes].map((resource) => {
            const option = document.createElement('option');
            option.value = resource.id;
            option.textContent = resource.name;
            return option;
          })
        );
        this.resource.value = selected;
        this.resourceSignature = signature;
      }
      if (!this.root.querySelector('.sheet-custom-attack-count').contains(document.activeElement)) {
        this.override.checked = state.attackCountOverride !== null;
        this.attackCount.value = String(state.attackCountOverride ?? 2);
      }
      reconcileContent(
        this.rows,
        library.actions
          .list(character.id)
          .map(
            (entry) => `
        <article class="sheet-custom-row" data-sheet-key="custom:${entry.id}">
          <div><strong>${escape(entry.name)}</strong><small>${escape(entry.cost)} |
            ${
              entry.resourceId
                ? `shared ${escape(entry.resourceId)}`
                : entry.maximum === null
                  ? 'Unlimited'
                  : `${entry.remaining}/${entry.maximum}; ${escape(entry.reset)}`
            }</small>
            ${entry.note ? `<p>${escape(entry.note)}</p>` : ''}</div>
          <button type="button" data-custom-action="edit" data-id="${entry.id}">Edit</button>
          <button type="button" data-custom-action="delete" data-id="${entry.id}">Delete</button>
        </article>`
          )
          .join('') ||
          '<p>No custom abilities. Standard class options are supplied automatically where supported.</p>'
      );
      this._visibility();
    } catch (error) {
      this._failure(error);
    }
  }

  clear() {
    this.characterId = null;
    this.form.hidden = true;
  }

  destroy() {
    this.clear();
    this.root.remove();
  }

  // -- Editing --
  _visibility() {
    const shared = !!this.resource.value;
    this.root.querySelector('[data-custom-magic]').hidden =
      this.library?.ruleset !== '2024' || this.cost.value !== 'action';
    this.limited.disabled = shared;
    this.root.querySelector('[data-custom-resource-cost]').hidden = !shared;
    this.root.querySelector('.sheet-custom-use-settings').hidden = shared || !this.limited.checked;
    this.attackCount.disabled = !this.override.checked;
  }

  _edit(id) {
    try {
      const entry = id
        ? this.library.actions.list(this.characterId).find((action) => action.id === id)
        : null;
      if (id && !entry) throw new Error('That custom ability no longer exists');
      this.editingId = id;
      this.name.value = entry?.name ?? '';
      this.cost.value = entry?.cost ?? 'action';
      this.resource.value = entry?.resourceId ?? '';
      if (entry?.resourceId && this.resource.value !== entry.resourceId) {
        const option = document.createElement('option');
        option.value = entry.resourceId;
        option.textContent = `${entry.resourceId} (not currently available to this class)`;
        this.resource.append(option);
        this.resource.value = entry.resourceId;
      }
      this.resourceCost.value = String(entry?.resourceCost ?? 1);
      this.limited.checked = entry?.maximum !== null && entry?.maximum !== undefined;
      this.maximum.value = String(entry?.maximum ?? 1);
      this.reset.value = entry?.reset ?? 'long';
      this.note.value = entry?.note ?? '';
      this.magic.checked = entry?.magicAction === true;
      this.form.hidden = false;
      this.root.querySelector('details').open = true;
      this._visibility();
      this.name.focus();
    } catch (error) {
      this._failure(error);
    }
  }

  _save() {
    const id = this.characterId;
    this._perform(() => {
      return afterCharacterCommit(
        this.library.actions.upsert(id, {
          ...(this.editingId ? { id: this.editingId } : {}),
          name: this.name.value,
          cost: this.cost.value,
          maximum: this.resource.value || !this.limited.checked ? null : this.maximum.valueAsNumber,
          reset: this.reset.value,
          note: this.note.value,
          resourceId: this.resource.value,
          resourceCost: this.resourceCost.valueAsNumber,
          magicAction:
            this.library.ruleset === '2024' && this.cost.value === 'action' && this.magic.checked,
        }),
        () => {
          if (this.characterId === id) {
            this.form.hidden = true;
            this.editingId = null;
          }
        }
      );
    });
  }

  _perform(operation) {
    const id = this.characterId;
    const fail = (error) => {
      this._failure(error);
      return false;
    };
    try {
      const result = afterCharacterCommit(operation(), () => {
        if (this.characterId === id) {
          this.status.textContent = 'Ability settings saved.';
          this.status.classList.remove('sheet-error');
        }
        this.onChanged(id);
        return true;
      });
      if (typeof result?.then === 'function') {
        this.status.textContent = 'Saving ability settings...';
        for (const control of this.root.querySelectorAll('input,select,textarea,button'))
          control.disabled = true;
        return result.catch(fail).finally(() => {
          for (const control of this.root.querySelectorAll('input,select,textarea,button'))
            control.disabled = false;
          this._visibility();
        });
      }
      return result;
    } catch (error) {
      return fail(error);
    }
  }

  _failure(error) {
    this.status.textContent = error.message;
    this.status.classList.add('sheet-error');
    new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
      component: 'CustomActionsEditor',
      operation: 'editAbility',
    });
  }
}
