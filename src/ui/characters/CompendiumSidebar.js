import CompendiumPanel from '../components/CompendiumPanel.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import {
  getTokenCharacter,
  connectCharacterServices,
  loadCharacterServices,
  notifyCharacterChanged,
} from './characterServices.js';
import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';

export default class CompendiumSidebar {
  constructor({ gameManager, services = null }) {
    this.gameManager = gameManager;
    const provided = services || gameManager.characterServices || null;
    this.services = provided ? connectCharacterServices(gameManager, provided) : null;
    this.targetChoice = 'selected';
    this.pendingEntry = null;
    this.disposed = false;
    this.root = document.createElement('div');
    this.root.className = 'compendium-sidebar';
    this.root.innerHTML = `
      <label class="sheet-field">Add to
        <select aria-label="Compendium destination"></select>
      </label>
      <p role="status" aria-label="Compendium status">Browse the compendium or select a destination.</p>
      <button type="button" data-compendium-retry hidden>Retry loading compendium</button>
      <div class="compendium-sidebar-content"></div>`;
    this.target = this.root.querySelector('select');
    this.status = this.root.querySelector('[role="status"]');
    this.retry = this.root.querySelector('[data-compendium-retry]');
    this.target.addEventListener('change', () => {
      this.targetChoice = this.target.value;
      this._refreshSafely();
    });
    this.retry.addEventListener('click', () => void this.open());
    this._sceneChanged = (event) => {
      if (event.detail?.gameManager === this.gameManager) this._refreshSafely();
    };
    this._storageChanged = (event) => {
      if (event.key?.startsWith('taverntable.character.v1.')) {
        this._refreshSafely();
        this.gameManager.token3DAdapter?.refreshMovementRange?.();
      }
    };
  }

  // -- Lifecycle --
  attach(parent) {
    parent.append(this.root);
    for (const name of ['tokenSelected', 'tokenRemoved', 'tokenNamesChanged', 'characterChanged']) {
      window.addEventListener(`taverntable:${name}`, this._sceneChanged);
    }
    window.addEventListener('storage', this._storageChanged);
    return this;
  }

  destroy() {
    this.disposed = true;
    for (const name of ['tokenSelected', 'tokenRemoved', 'tokenNamesChanged', 'characterChanged']) {
      window.removeEventListener(`taverntable:${name}`, this._sceneChanged);
    }
    window.removeEventListener('storage', this._storageChanged);
    this.root.remove();
  }

  async open(entryId = null) {
    if (entryId) this.pendingEntry = entryId;
    try {
      if (!this.services) {
        this.status.textContent = 'Loading the local SRD compendium...';
        this.services = await loadCharacterServices(this.gameManager);
      }
      if (this.disposed) return false;
      if (!this.panel) {
        this.panel = new CompendiumPanel({
          catalog: this.services.catalog,
          onAdd: (id, equip) => this._add(id, equip),
          onError: (error) => this._failure(error),
        });
        this.root.querySelector('.compendium-sidebar-content').append(this.panel.root);
      }
      this.retry.hidden = true;
      this.status.textContent = 'Ready. Add content to the destination shown above.';
      this.status.classList.remove('sheet-error');
      this._refreshTargets();
      if (this.pendingEntry) {
        this.panel.show(this.pendingEntry);
        this.pendingEntry = null;
      }
      return true;
    } catch (error) {
      if (!this.disposed) this._failure(error);
      return false;
    }
  }

  // -- Destination and mutations --
  _selectedToken() {
    const token = this.gameManager.token3DAdapter?.getSelectedToken?.();
    return this.gameManager.placedTokens.includes(token) ? token : null;
  }

  _refreshSafely() {
    if (!this.panel || this.disposed) return;
    try {
      this._refreshTargets();
    } catch (error) {
      this._failure(error);
    }
  }

  _refreshTargets() {
    const characters = this.services.library.list();
    const selected = this._selectedToken();
    const linked = selected?.characterSheetId
      ? this.services.library.get(selected.characterSheetId)
      : null;
    const options = [
      {
        id: 'selected',
        name: selected
          ? `Selected creature: ${getTokenDisplayName(selected)}${linked ? ` / ${linked.name}` : ''}`
          : 'Selected creature: none',
      },
      ...characters.map((character) => ({
        id: character.id,
        name: `${character.name} - ${character.classId || 'Custom'} ${character.level}`,
      })),
    ];
    const signature = JSON.stringify(options);
    if (signature !== this.targetSignature) {
      this.target.replaceChildren(
        ...options.map(({ id, name }) => {
          const option = document.createElement('option');
          option.value = id;
          option.textContent = name;
          return option;
        })
      );
      this.targetSignature = signature;
    }
    this.target.value = this.targetChoice;
    const available =
      this.targetChoice === 'selected'
        ? !!selected
        : characters.some((character) => character.id === this.targetChoice);
    this.panel.setAddEnabled(available);
    if (!available) {
      this.status.textContent =
        'Select a creature on the map or choose a saved character to add content.';
    }
  }

  _add(entryId, equip) {
    const failure = (error) => {
      this._failure(error);
      return false;
    };
    try {
      const { library } = this.services;
      const entry = library.catalog.get(entryId);
      if (!entry) throw new Error('Unknown compendium entry');
      let character;
      if (this.targetChoice === 'selected') {
        const token = this._selectedToken();
        if (!token) throw new Error('Select a creature or choose a saved character first');
        character = getTokenCharacter(this.gameManager, token, this.services);
      } else {
        character = library.get(this.targetChoice);
      }
      const added = afterCharacterCommit(character, (target) =>
        afterCharacterCommit(library.add(target.id, entryId, { equip }), () => {
          this._refreshTargets();
          this.status.textContent = `Added ${entry.name} to ${target.name}${equip ? ' and equipped it' : ''}.`;
          this.status.classList.remove('sheet-error');
          notifyCharacterChanged(this.gameManager, target.id, entry.kind);
          return true;
        })
      );
      if (typeof added?.then === 'function') {
        this.status.textContent = 'Saving content to the selected campaign character...';
        this.panel.setAddEnabled(false);
        return added.catch(failure);
      }
      return added;
    } catch (error) {
      return failure(error);
    }
  }

  _failure(error) {
    this.status.textContent = error.message;
    this.status.classList.add('sheet-error');
    this.retry.hidden = !!this.panel;
    this.panel?.setAddEnabled(false);
    new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
      component: 'CompendiumSidebar',
      operation: 'compendium',
    });
  }
}
