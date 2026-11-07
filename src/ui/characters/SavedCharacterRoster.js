import { CHARACTER_DEFINITIONS, getCharacterDefinition } from '../../config/CharacterCatalog.js';
import { escapeHtml as escape } from './escapeHtml.js';
import { notifyCharacterChanged } from './characterServices.js';
import { SavedCharacterSheets } from '../sessions/PlayerCharacterSheets.js';
import { CHARACTER_BACKUP_LIMIT } from '../../config/characters/CharacterImages.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export const SAVED_CHARACTER_DRAG_MIME = 'application/x-taverntable-saved-character';

export default class SavedCharacterRoster {
  constructor({ gameManager, services, onOpenPlaced, onSelectionChanged = () => {} }) {
    if (services.sessionRole === 'player' || services.library.store?.identity?.role === 'player')
      throw new Error('The campaign character roster is available only in the DM workspace');
    this.gm = gameManager;
    this.services = services;
    this.library = services.library;
    this.onOpenPlaced = onOpenPlaced;
    this.onSelectionChanged = onSelectionChanged;
    this.appearanceChoices = new Map();
    this.pending = false;
    this.disposed = false;
    this.root = document.createElement('div');
    this.root.className = 'saved-character-roster';
    this.root.innerHTML = `
      <div class="section-title">Saved Characters</div>
      <p class="small-text">All characters saved in this campaign. Players see only their assignments.
      Place retrieves the same character; removing its sprite does not delete its sheet.
      Choose Next sprite before placing an unplaced character without a known appearance.
      Unplaced choices last only for this workspace session, not across reload or export.</p>
      <form aria-label="Create saved character">
        <label>Name<input aria-label="New saved character name" maxlength="160" required autocomplete="off"></label>
        <button type="submit">Create character</button>
      </form>
      <button type="button" data-import-character>Import character JSON</button>
      <input type="file" accept=".json,application/json" aria-label="Import saved character JSON" hidden>
      <label>Find character<input type="search" aria-label="Search saved characters"></label>
      <button type="button" data-cancel-character-placement hidden>Cancel placement</button>
      <output role="status" aria-live="polite" aria-label="Saved character roster status">Choose a saved character.</output>
      <div data-saved-character-list></div>`;
    this.status = this.root.querySelector('output');
    this.list = this.root.querySelector('[data-saved-character-list]');
    this.search = this.root.querySelector('[type="search"]');
    this.importFile = this.root.querySelector('[type="file"]');
    this.search.addEventListener('input', () => this._refresh());
    this.root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this._perform(async () => {
        const field = this.root.querySelector('[aria-label="New saved character name"]');
        const id = await this.library.create(field.value);
        field.value = '';
        notifyCharacterChanged(this.gm, id);
        await this.open(id);
        this.status.textContent =
          'Character saved. Choose Next sprite, then Place it on the board.';
      });
    });
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-import-character')) {
        this.importFile.click();
        return;
      }
      if (button.hasAttribute('data-cancel-character-placement')) {
        this.gm.tokenManager.cancelSavedCharacterPlacement();
        this.status.textContent = 'Character placement canceled.';
        return;
      }
      const id = button.closest('[data-roster-character]')?.dataset.rosterCharacter;
      if (!id) return;
      if (button.dataset.rosterAction === 'open' || button.dataset.rosterAction === 'focus')
        void this._perform(() => this.open(id));
      else if (button.dataset.rosterAction === 'place') {
        void this._perform(async () => {
          const current = this.gm.placedTokens.find((token) => token.characterSheetId === id);
          if (current) {
            await this.onOpenPlaced(current);
            return;
          }
          const appearance = this._appearanceFor(id);
          if (!appearance) throw new Error('Choose a canonical Next sprite before placement');
          this.gm.tokenManager.selectSavedCharacter(id, appearance);
          await this.gm.token3DAdapter.setSelectedToken(null);
          this.status.textContent = `Click a supported floor to place ${this.library.get(id).name}, or drag its Place button.`;
        });
      }
    });
    this.root.addEventListener('change', (event) => {
      const id = event.target.dataset.characterAppearance;
      if (!id) return;
      void this._perform(async () => {
        if (this.gm.placedTokens.some((token) => token.characterSheetId === id))
          throw new Error('Remove the existing sprite before choosing its next appearance');
        this.library.get(id);
        const appearance = getCharacterDefinition(event.target.value)?.id;
        if (!appearance) throw new Error('Choose an available token appearance');
        this.appearanceChoices.set(id, appearance);
        if (this.gm.tokenManager.selectedSavedCharacterId === id)
          this.gm.tokenManager.selectSavedCharacter(id, appearance);
        this.status.textContent = 'Appearance selected for the next placement in this workspace.';
      });
    });
    this.root.addEventListener('dragstart', (event) => {
      const button = event.target.closest('[data-roster-action="place"]');
      if (!button || button.disabled || !event.dataTransfer) return;
      const id = button.closest('[data-roster-character]').dataset.rosterCharacter;
      this.gm.tokenManager.cancelSavedCharacterPlacement();
      event.dataTransfer.effectAllowed = 'copy';
      event.dataTransfer.setData(
        SAVED_CHARACTER_DRAG_MIME,
        JSON.stringify({ characterId: id, appearance: this._appearanceFor(id) })
      );
    });
    this.importFile.addEventListener('change', () => {
      const file = this.importFile.files?.[0];
      if (!file) return;
      void this._perform(async () => {
        if (file.size > CHARACTER_BACKUP_LIMIT)
          throw new Error('Choose a character JSON backup smaller than 4 MB');
        const id = await this.library.import(await file.text());
        notifyCharacterChanged(this.gm, id);
        await this.open(id);
        this.status.textContent = 'Character imported as a separate saved record.';
      }).finally(() => {
        this.importFile.value = '';
      });
    });
    this._sceneChanged = (event) => {
      if (event.detail?.gameManager !== this.gm) return;
      if (event.type === 'taverntable:tokenRemoved')
        void this._rememberAppearance(event.detail.token).catch((error) => this._failure(error));
      if (event.type === 'taverntable:characterChanged' && event.detail.origin !== this.savedSheets)
        this._refreshSheets();
      this._refresh();
    };
    this._selectionChanged = (event) => {
      if (event.detail?.gameManager !== this.gm) return;
      this.onSelectionChanged();
      this._refresh();
    };
    this._placementChanged = (event) => {
      if (event.detail?.gameManager !== this.gm) return;
      this.status.textContent = event.detail.message;
      this._refresh();
    };
    this._keyDown = (event) => {
      if (event.key !== 'Escape' || !this.gm.tokenManager.selectedSavedCharacterId) return;
      event.preventDefault();
      if (this.gm.inputCoordinator?.savedCharacterPending || this.gm.campaignViewBusy) {
        this.status.textContent = 'Placement is already in progress; wait for its save receipt.';
        return;
      }
      this.gm.tokenManager.cancelSavedCharacterPlacement();
      this.status.textContent = 'Character placement canceled.';
    };
  }

  attach(parent) {
    parent.append(this.root);
    for (const type of [
      'characterChanged',
      'tokenRemoved',
      'tokenNamesChanged',
      'campaignViewStateChanged',
    ])
      window.addEventListener(`taverntable:${type}`, this._sceneChanged);
    window.addEventListener('taverntable:tokenTypeChanged', this._selectionChanged);
    window.addEventListener('taverntable:savedCharacterPlacement', this._placementChanged);
    document.addEventListener('keydown', this._keyDown);
    this.unsubscribe = this.gm.sceneAutosave?.subscribe(() => this._refresh());
    this._refresh();
    return this;
  }

  async open(id) {
    if (this.disposed) throw new Error('The saved character roster is closed');
    this.library.get(id);
    const placed = this.gm.placedTokens.find((token) => token.characterSheetId === id);
    if (placed) {
      const result = await this.onOpenPlaced(placed);
      this.status.textContent = `Opened ${this.library.get(id).name} on its existing sprite.`;
      return result;
    }
    if (!this.savedSheets)
      this.savedSheets = new SavedCharacterSheets({
        library: this.library,
        gameManager: this.gm,
        onChanged: (characterId) => {
          if (characterId) notifyCharacterChanged(this.gm, characterId, null, this.savedSheets);
          this._refresh();
        },
      });
    else this.savedSheets.refresh();
    const result = await this.savedSheets.open(id);
    this.status.textContent = `Opened saved character ${this.library.get(id).name}; no sprite was created.`;
    return result;
  }

  _refreshSheets() {
    if (!this.savedSheets || this.library.isSaving) return;
    try {
      this.savedSheets.refresh();
    } catch (error) {
      this._failure(error);
    }
  }

  async _rememberAppearance(token) {
    const id = token?.characterSheetId;
    if (
      !id ||
      this.disposed ||
      this.gm.sceneAutosave?.ready !== true ||
      this.gm.campaignMapTransition
    )
      return;
    const character = this.library.list().find((entry) => entry.id === id);
    if (!character) return;
    const appearance = getCharacterDefinition(token.type)?.id;
    if (!appearance) throw new Error('The removed sprite has an unavailable character appearance');
    this.appearanceChoices.set(id, appearance);
  }

  _appearanceFor(id) {
    const token = this.gm.placedTokens.find((entry) => entry.characterSheetId === id);
    const type = token?.type ?? this.appearanceChoices.get(id);
    if (type === undefined) return null;
    const appearance = getCharacterDefinition(type)?.id;
    if (!appearance) throw new Error('This sprite has an unavailable token appearance');
    return appearance;
  }

  _refresh() {
    if (this.disposed) return;
    try {
      this.render();
    } catch (error) {
      this._failure(error);
    }
  }

  render() {
    const selected = this.gm.tokenManager.selectedSavedCharacterId;
    const term = this.search.value.trim().toLocaleLowerCase();
    const rows = this.library
      .list()
      .filter((character) =>
        `${character.name} ${character.classId}`.toLocaleLowerCase().includes(term)
      )
      .map((character) => {
        const placed = this.gm.placedTokens.filter(
          (token) => token.characterSheetId === character.id
        );
        const appearance = this._appearanceFor(character.id);
        const location = placed.length
          ? placed
              .map(
                (token) =>
                  this.gm.campaignWorld?.getMap(token.mapId || this.gm.campaignMapId || 'map-main')
                    .name || 'Current board'
              )
              .join(', ')
          : 'Not placed';
        return { ...character, placed: placed.length, appearance, location };
      });
    const signature = JSON.stringify([rows, selected]);
    if (signature !== this.signature) {
      this.signature = signature;
      this.list.innerHTML =
        rows
          .map(
            (character) =>
              `<article class="saved-character-card" data-roster-character="${escape(character.id)}">
          <strong>${escape(character.name)}</strong>
          <small>${escape(this.library.classes.get(character.classId)?.name || 'Custom')} ${character.level} | ${escape(character.location)}</small>
          <label>Next sprite<select aria-label="Appearance for ${escape(character.name)}"
            data-character-appearance="${escape(character.id)}" ${character.placed ? 'data-static-disabled disabled' : ''}>
            <option value="" disabled ${character.appearance ? '' : 'selected'}>Choose sprite appearance</option>
            ${CHARACTER_DEFINITIONS.map(
              (entry) =>
                `<option value="${entry.id}" ${entry.id === character.appearance ? 'selected' : ''}>${escape(entry.label)}</option>`
            ).join('')}
          </select></label>
          <div class="saved-character-actions">
            <button type="button" data-roster-action="open">Open sheet</button>
            <button type="button" data-roster-action="${character.placed ? 'focus' : 'place'}"
              ${character.placed ? '' : `draggable="${!!character.appearance}"`}
              ${!character.placed && !character.appearance ? 'data-static-disabled disabled title="Choose Next sprite first"' : ''}
              aria-pressed="${selected === character.id}">${character.placed ? 'Focus sprite' : 'Place'}</button>
          </div></article>`
          )
          .join('') ||
        '<p class="small-text">No saved characters match. Create or import a character, or open a token sheet to save one.</p>';
    }
    this.root.querySelector('[data-cancel-character-placement]').hidden = !selected;
    this._controls();
  }

  _controls() {
    const busy =
      this.pending ||
      this.library.isSaving ||
      this.gm.campaignViewBusy ||
      this.gm.campaignMapFailure ||
      this.gm.inputCoordinator?.savedCharacterPending ||
      this.gm.sceneAutosave?.ready === false;
    this.root.setAttribute('aria-busy', String(!!busy));
    for (const control of this.root.querySelectorAll('button,select,input'))
      control.disabled = !!busy || control.hasAttribute('data-static-disabled');
  }

  async _perform(operation) {
    if (this.disposed) {
      this._failure(new Error('The saved character roster is closed'));
      return false;
    }
    if (this.pending) {
      this._failure(new Error('Finish the current character operation first'));
      return false;
    }
    this.pending = true;
    this._controls();
    try {
      await operation();
      return true;
    } catch (error) {
      this._failure(error);
      return false;
    } finally {
      this.pending = false;
      this._refresh();
    }
  }

  _failure(error) {
    this.status.textContent = error.message;
    GameErrors.input(error, { component: 'SavedCharacterRoster', operation: 'character' });
  }

  destroy() {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe?.();
    for (const type of [
      'characterChanged',
      'tokenRemoved',
      'tokenNamesChanged',
      'campaignViewStateChanged',
    ])
      window.removeEventListener(`taverntable:${type}`, this._sceneChanged);
    window.removeEventListener('taverntable:tokenTypeChanged', this._selectionChanged);
    window.removeEventListener('taverntable:savedCharacterPlacement', this._placementChanged);
    document.removeEventListener('keydown', this._keyDown);
    this.savedSheets?.destroy();
    this.root.remove();
  }
}
