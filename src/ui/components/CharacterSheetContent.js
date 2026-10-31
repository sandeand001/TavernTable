import {
  field,
  signed,
  title,
  selected,
  renderCoreSection,
  renderEquipmentSection,
  renderSpellsSection,
} from './character-sheet/internals/sections.js';
import { SKILLS } from '../../entities/characters/CharacterLibrary.js';
import {
  getTokenCharacter,
  connectCharacterServices,
  loadCharacterServices,
  notifyCharacterChanged,
} from '../characters/characterServices.js';
import { getTokenDisplayName } from '../../entities/creatures/creatureHelpers.js';
import { renameCreature } from '../../entities/creatures/CreatureNames.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import { COMPENDIUM_DRAG_TYPE, readCompendiumDrag } from './CompendiumPanel.js';
import {
  getTokenMovementSettings,
  linkTokenCharacter,
  setTokenMovementSettings,
} from '../../entities/creatures/TokenMovement.js';
import { reconcileContent } from '../characters/reconcileContent.js';
import HealthBar from '../characters/HealthBar.js';
import RestControls from '../characters/RestControls.js';
import { REST_STORAGE_PREFIX } from '../../entities/characters/CharacterRest.js';
import { ACTION_STORAGE_PREFIX } from '../../entities/characters/CharacterActions.js';
import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { renderPlayView } from '../characters/playViews.js';
import { performPlayAction, rollForSheet, rollRecentAction } from '../characters/playActions.js';
import CustomActionsEditor from '../characters/CustomActionsEditor.js';
import PlayLayoutControls from '../characters/PlayLayoutControls.js';
import { PLAY_LAYOUT_STORAGE_PREFIX } from '../../entities/characters/CharacterPlayLayout.js';
import RollHistory from '../characters/RollHistory.js';
import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';

export default class CharacterSheetContent {
  constructor({ gameManager, services = null, onOpenCompendium = null }) {
    this.gameManager = gameManager;
    const provided = services || gameManager.characterServices || null;
    this.services = provided ? connectCharacterServices(gameManager, provided) : null;
    this.onOpenCompendium = onOpenCompendium;
    this.section = 'core';
    this.rollMode = 'normal';
    this.slotLevels = new Map();
    this.playChoices = {};
    this.playOpened = {};
    this.dmMovementDraft = null;
    this.dmEconomyDraft = {};
    this.token = null;
    this.disposed = false;
    this.root = document.createElement('div');
    this.root.className = 'character-sheet-editor';
    this.root.dataset.settingsOpen = 'false';
    this.root.innerHTML = `
      <div class="sheet-editor-primary">
      <section class="sheet-settings" id="character-sheet-settings" aria-label="Character settings" hidden>
      <header class="sheet-settings-header"><h4>Character settings</h4>
        <button type="button" data-sheet-settings-close aria-label="Close character settings">Close</button>
      </header>
      <div class="sheet-library-toolbar">
        <label>Saved character <select aria-label="Saved characters"></select></label>
        <button type="button" data-sheet-action="new">New</button>
        <button type="button" data-sheet-action="export">Export JSON</button>
        <button type="button" data-sheet-action="import">Import JSON</button>
        <button type="button" data-sheet-action="delete">Delete</button>
        <button type="button" data-sheet-action="compendium">Compendium</button>
        <input type="file" accept=".json,application/json" aria-label="Import character JSON" hidden>
      </div>
      <section class="sheet-card" data-sheet-backup hidden aria-label="Character backup export">
        <h4></h4>
        <p>A JSON download is requested. If your host does not offer a file download,
          copy the selected JSON into a .json file. Export again to include later edits.</p>
        <label class="sheet-field">Portable backup
          <textarea aria-label="Character JSON backup" rows="6" readonly spellcheck="false"></textarea>
        </label>
        <button type="button" data-sheet-action="close-backup">Close backup</button>
      </section>
      </section>
      <p class="sheet-save-status" id="character-sheet-save-status" role="status">Open a creature to load its saved character.</p>
      <div class="sheet-workspace">
        <main class="sheet-character-main"></main>
      </div>
      <output class="sheet-roll-status" aria-label="Character roll result" aria-live="polite"></output>
      </div>`;
    this.main = this.root.querySelector('main');
    this.settingsPanel = this.root.querySelector('.sheet-settings');
    this.librarySelect = this.root.querySelector('[aria-label="Saved characters"]');
    this.status = this.root.querySelector('[role="status"]');
    this.rollStatus = this.root.querySelector('[aria-label="Character roll result"]');
    this.fileInput = this.root.querySelector('input[type="file"]');
    this.backupPanel = this.root.querySelector('[data-sheet-backup]');
    this.backupText = this.root.querySelector('[aria-label="Character JSON backup"]');
    this.healthBar = new HealthBar({
      onApply: (id, kind, value) =>
        this._run(() => {
          if (id !== this.characterId)
            throw new Error('Reopen the health controls for this character');
          return kind === 'edit'
            ? this.services.library.edit(id, { hp: value })
            : this.services.library.adjustHitPoints(id, kind, value);
        }, 'Hit points updated.'),
    });
    this.restControls = new RestControls({
      canRest: () => !this.services?.combat?.active,
      roll: (request) => rollForSheet(this, request),
      onChanged: (id, message) => {
        if (id === this.token?.characterSheetId && !this.disposed) {
          this._run(() => {}, message);
        }
      },
    });
    this.customActions = new CustomActionsEditor({
      onChanged: (id) => {
        if (id === this.token?.characterSheetId) this._run(() => {}, 'Ability settings saved.');
      },
    });
    this.layoutControls = new PlayLayoutControls(this);
    this.historyPanel = new RollHistory({ onError: (error) => this._failure(error, 'history') });
    this.root.append(this.historyPanel.root);
    this.root.addEventListener('change', (event) => this._change(event));
    this.root.addEventListener('input', (event) => {
      if (event.target.dataset.playAmount) {
        const id = event.target.dataset.playAmount;
        this.playChoices[id] = { ...this.playChoices[id], amount: event.target.value };
      }
      if (event.target.hasAttribute('data-play-dm-movement'))
        this.dmMovementDraft = event.target.value;
      if (event.target.dataset.playDmEconomy) {
        this.dmEconomyDraft[event.target.dataset.playDmEconomy] = event.target.value;
      }
    });
    this.root.addEventListener(
      'toggle',
      (event) => {
        if (event.target.dataset.playDetails)
          this.playOpened[event.target.dataset.playDetails] = event.target.open;
      },
      true
    );
    this.root.addEventListener('click', (event) => this._click(event));
    this.root.addEventListener('dragover', (event) => {
      if (Array.from(event.dataTransfer?.types || []).includes(COMPENDIUM_DRAG_TYPE)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
      }
    });
    this.root.addEventListener('drop', (event) => this._drop(event));
    this._storageChanged = (event) => {
      if (
        !this.token ||
        ![
          `taverntable.character.v1.${this.token.characterSheetId}`,
          `${REST_STORAGE_PREFIX}${this.token.characterSheetId}`,
          `${ACTION_STORAGE_PREFIX}${this.token.characterSheetId}`,
          `${PLAY_LAYOUT_STORAGE_PREFIX}${this.token.characterSheetId}`,
        ].includes(event.key)
      ) {
        return;
      }
      if (
        this._deferRefresh(
          'Character changed in another tab. Finish this field to save your edit and refresh.'
        )
      )
        return;
      this._run(() => {}, 'Character updated in another tab.', false);
    };
    window.addEventListener('storage', this._storageChanged);
    this._characterChanged = (event) => {
      const { gameManager: source, characterId, entryKind } = event.detail || {};
      if (event.detail?.origin === this) return;
      if (source !== this.gameManager || characterId !== this.token?.characterSheetId) return;
      if (entryKind) this.section = entryKind === 'spell' ? 'spells' : 'equipment';
      if (this._deferRefresh('Character updated. Finish this field to refresh the sheet.')) return;
      this._run(() => {}, 'Character updated from the compendium.', false);
    };
    window.addEventListener('taverntable:characterChanged', this._characterChanged);
    this._combatChanged = (event) => {
      if (
        event.detail?.gameManager !== this.gameManager ||
        !this.token ||
        !this.gameManager.placedTokens.includes(this.token)
      )
        return;
      if (this._deferRefresh('Combat state updated; finish this field to refresh.')) return;
      this._run(() => {}, '', false);
    };
    window.addEventListener('taverntable:combatChanged', this._combatChanged);
  }

  show(token) {
    if (token !== this.token) {
      this.playChoices = {};
      this.dmMovementDraft = null;
      this.dmEconomyDraft = {};
    }
    this.token = token;
    if (this.services) {
      try {
        this.ready = Promise.resolve(this._initialize()).catch((error) => {
          if (!this.disposed) this._failure(error, 'openCharacter');
          return false;
        });
        return this.ready;
      } catch (error) {
        this._failure(error, 'openCharacter');
        return Promise.resolve(false);
      }
    }
    this.main.textContent = 'Loading this campaign and its local resource database...';
    this.ready = loadCharacterServices(this.gameManager)
      .then((services) => {
        if (this.disposed || !this.token) return false;
        this.services = services;
        return this._initialize();
      })
      .catch((error) => {
        if (!this.disposed) this._failure(error, 'loadCharacterData');
        return false;
      });
    return this.ready;
  }

  setSettingsOpen(open) {
    this.settingsPanel.hidden = !open;
    this.root.dataset.settingsOpen = String(open);
  }

  rename(token, name, characterId = token.characterSheetId) {
    return this._run(
      () => {
        if (!characterId) throw new Error('Wait for the saved character before renaming');
        if (token.characterSheetId !== characterId)
          throw new Error('The loaded character changed; reopen its name before renaming');
        return afterCharacterCommit(renameCreature(this.gameManager, token, name), () => {
          notifyCharacterChanged(this.gameManager, characterId, null, this);
        });
      },
      'Character name saved.',
      false
    );
  }

  clear() {
    this.token = null;
    this.movementView = null;
    this.healthBar.clear();
    this.restControls.clear();
    this.customActions.clear();
    this.layoutControls.clear();
    this.historyPanel.clear();
    this.root.classList.remove('sheet-with-history');
  }

  destroy() {
    this.disposed = true;
    this.token = null;
    this.movementView = null;
    this.healthBar.clear();
    this.restControls.destroy();
    this.customActions.destroy();
    this.layoutControls.destroy();
    this.historyPanel.destroy();
    window.removeEventListener('storage', this._storageChanged);
    window.removeEventListener('taverntable:characterChanged', this._characterChanged);
    window.removeEventListener('taverntable:combatChanged', this._combatChanged);
  }

  _initialize() {
    const token = this.token;
    if (!this.gameManager.placedTokens.includes(token)) {
      throw new Error('The creature was removed before its character could open');
    }
    const character = getTokenCharacter(this.gameManager, token, this.services);
    if (typeof character?.then === 'function') {
      this.main.textContent = 'Saving the new campaign character...';
      this._syncSavingControls();
    }
    return afterCharacterCommit(character, () => {
      if (this.disposed || this.token !== token) return false;
      this.render();
      this.status.textContent = 'Saved in this campaign. Export JSON for a portable backup.';
      notifyCharacterChanged(this.gameManager, this.characterId, null, this);
      return true;
    });
  }

  get characterId() {
    if (!this.token || !this.gameManager.placedTokens.includes(this.token)) {
      throw new Error('Select a creature before editing a character');
    }
    return this.token.characterSheetId;
  }

  render() {
    const { library, catalog } = this.services;
    const id = this.characterId;
    const character = linkTokenCharacter(this.token, library, id);
    const stats = library.stats(id);
    const movement = getTokenMovementSettings(this.token);
    const previous = this.movementView;
    this.movementView = { token: this.token, id, ...movement };
    if (
      !previous ||
      previous.token !== this.token ||
      previous.id !== id ||
      previous.speed !== movement.speed ||
      previous.mode !== movement.mode ||
      previous.type !== movement.type
    ) {
      if (
        previous?.token === this.token &&
        (previous.mode !== movement.mode || previous.type !== movement.type)
      ) {
        this.gameManager.token3DAdapter?.applyMovementStyle?.(this.token);
      }
      this.gameManager.token3DAdapter?.refreshMovementRange?.();
    }
    this.librarySelect.replaceChildren(
      ...library.list().map((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = `${entry.name} - ${entry.classId || 'Custom'} ${entry.level}`;
        return option;
      })
    );
    this.librarySelect.value = id;
    this.layoutControls.sync();
    const markup = `
      ${
        ['combat', 'noncombat'].includes(this.section)
          ? `
        <header class="sheet-play-identity"><div>
          <p>${escape(library.classes.get(character.classId)?.name || 'Custom character')} | Level ${character.level}${character.ancestry ? ` | ${escape(character.ancestry)}` : ''}</p>
        </div><button type="button" data-sheet-section="core">Edit character</button></header>`
          : `
      <div class="sheet-identity-grid">
        <label class="sheet-field">Class (single-class)<select aria-label="Character class" data-character-field="classId">
          <option value="" ${selected(character.classId === '')}>Custom / no class</option>
          ${catalog.classes.map((entry) => `<option value="${escape(entry.id)}" ${selected(entry.id === character.classId)}>${escape(entry.name)}</option>`).join('')}
        </select></label>
        ${field('Level', 'level', character.level, 'number', 'min="1" max="20" step="1"')}
        ${field('Ancestry', 'ancestry', character.ancestry)}
        ${field('Background', 'background', character.background)}
        ${field('Alignment', 'alignment', character.alignment)}
      </div>`
      }
      <div class="sheet-summary">
        ${this._stat('Armor class', stats.armorClass, 'AC')}
        ${this._stat('Initiative', signed(stats.initiative), 'Initiative', 'initiative')}
        ${this._stat('Proficiency bonus', signed(stats.proficiencyBonus), 'Proficiency')}
        ${this._stat('Passive perception', stats.passivePerception, 'Passive perception')}
      </div>
      <p class="sheet-ac-source">${escape(stats.armorName)}${stats.shieldName ? ` + ${escape(stats.shieldName)}` : ''}${stats.equipmentACBonus ? ` + ${stats.equipmentACBonus} equipment` : ''}${character.acBonus ? ` + ${character.acBonus} adjustment` : ''}</p>
      <div data-sheet-key="health" data-sheet-island="health"></div>
      <div class="sheet-movement-controls" role="group" aria-label="Movement controls">
        <div class="sheet-movement-pace" role="group" aria-label="Travel pace">
          <span>Pace</span>
          <div>${['walk', 'run']
            .map(
              (mode) => `<button type="button" data-sheet-action="movement-mode"
            data-mode="${mode}" aria-label="${title(mode)} movement" aria-pressed="${movement.mode === mode}">${title(mode)}</button>`
            )
            .join('')}</div>
        </div>
        <label class="sheet-field">Style
          <select aria-label="Movement type" data-movement-type>
            <option value="default" ${selected(movement.type === 'default')}>Default</option>
            <option value="drunk" ${selected(movement.type === 'drunk')}>Drunk</option>
          </select>
        </label>
      </div>
      <p class="sheet-reference">${this.services.combat.active ? 'Combat: the range uses remaining turn movement.' : 'Free play: speed sets the grid range for each move.'} Walk/Run is not the Dash action.</p>
      <nav class="sheet-section-nav" aria-label="Character sections">
        ${[
          ['combat', 'Combat'],
          ['noncombat', 'Non-combat'],
          ['core', 'Core'],
          ['equipment', 'Equipment'],
          ['spells', 'Spells'],
          ['notes', 'Bio & notes'],
        ]
          .map(
            ([value, name]) =>
              `<button type="button" data-sheet-section="${value}" aria-pressed="${this.section === value}">${name}</button>`
          )
          .join('')}
        <label>Roll <select aria-label="Character roll mode">
          ${[
            ['normal', 'Normal'],
            ['advantage', 'Advantage'],
            ['disadvantage', 'Disadvantage'],
          ]
            .map(
              ([value, name]) =>
                `<option value="${value}" ${selected(value === this.rollMode)}>${name}</option>`
            )
            .join('')}
        </select></label>
      </nav>
      ${
        ['combat', 'noncombat'].includes(this.section)
          ? renderPlayView({
              library,
              session: this.services.combat,
              token: this.token,
              mode: this.section,
              choices: this.playChoices,
              opened: this.playOpened,
              dmDraft: this.dmMovementDraft,
              dmEconomyDraft: this.dmEconomyDraft,
              editingLayout: this.layoutControls.editing,
            })
          : ''
      }
      <section class="sheet-section" ${this.section !== 'core' ? 'hidden' : ''}>
        ${this._core(character, stats)}
        <div data-sheet-key="custom-editor" data-sheet-island="custom-editor"></div>
      </section>
      <section class="sheet-section" ${this.section !== 'equipment' ? 'hidden' : ''}>
        ${this._equipment(character, stats)}
      </section>
      <section class="sheet-section" ${this.section !== 'spells' ? 'hidden' : ''}>
        ${this._spells(character, stats)}
      </section>
      <section class="sheet-section" ${this.section !== 'notes' ? 'hidden' : ''}>
        ${field('Experience', 'experience', character.experience, 'number', 'min="0" max="1000000000" step="1"')}
        <label class="sheet-field">Bio and notes<textarea aria-label="Bio and notes" data-character-field="notes" rows="10">${escape(character.notes)}</textarea></label>
      </section>
      <p class="sheet-rules-coverage">${library.ruleset} rules. Class/subclass features, conditional spell effects,
        targeting and guided level-ups are not fully automated. Combat costs are tracked only after Start Turn. Level edits recalculate
        proficiency and slots; apply HP/features manually. Manual adjustments remain available.</p>`;
    reconcileContent(this.main, markup);
    const healthHost = this.main.querySelector('[data-sheet-island="health"]');
    if (this.healthBar.root.parentNode !== healthHost) healthHost.append(this.healthBar.root);
    if (this.restControls.root.parentNode !== healthHost) healthHost.append(this.restControls.root);
    this.healthBar.update(character);
    this.restControls.update(character, this.services.library);
    const customHost = this.main.querySelector('[data-sheet-island="custom-editor"]');
    if (this.customActions.root.parentNode !== customHost)
      customHost.append(this.customActions.root);
    this.customActions.update(character, this.services.library);
    this._updateHistory(character);
    this._syncSavingControls();
  }

  _updateHistory(character) {
    this.historyPanel.update({
      session: this.services.combat,
      token: this.token,
      character,
      editing: this.layoutControls.editing,
    });
    this.root.classList.add('sheet-with-history');
  }

  _stat(label, value, caption, roll = '') {
    return `<div class="sheet-stat"><span>${caption}</span><output aria-label="${label}">${value}</output>
      ${roll ? `<button type="button" data-sheet-action="roll" data-roll-kind="${roll}" aria-label="Roll ${caption}">Roll</button>` : ''}</div>`;
  }

  _core(character, stats) {
    return renderCoreSection(this, character, stats);
  }

  _equipment(character, stats) {
    return renderEquipmentSection(this, character, stats);
  }

  _spells(character, stats) {
    return renderSpellsSection(this, character, stats);
  }

  _add(entryId, equip = false) {
    const token = this.token;
    this._run(() => {
      const entry = this.services.library.catalog.get(entryId);
      if (!entry) throw new Error('Unknown compendium entry');
      return afterCharacterCommit(
        this.services.library.add(this.characterId, entryId, { equip }),
        () => {
          if (this.token === token) this.section = entry.kind === 'spell' ? 'spells' : 'equipment';
        }
      );
    }, 'Added to the saved character.');
  }

  _drop(event) {
    if (!Array.from(event.dataTransfer?.types || []).includes(COMPENDIUM_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      if (!this.services) throw new Error('Wait for campaign resources before dropping content');
      const entryId = readCompendiumDrag(
        event.dataTransfer.getData(COMPENDIUM_DRAG_TYPE),
        this.services.catalog
      );
      const target = event.target.closest('[data-drop-kind]')?.dataset.dropKind;
      const entry = this.services.library.catalog.get(entryId);
      if (
        (target === 'spells' && entry.kind !== 'spell') ||
        (target === 'equip' && entry.kind !== 'item')
      )
        throw new Error('Drop equipment in Equipment and spells in the Spellbook');
      this._add(entryId, target === 'equip');
    } catch (error) {
      this._failure(error, 'dropEntry');
    }
  }

  _change(event) {
    const element = event.target;
    if (element === this.librarySelect) {
      this._run(() => {
        this.services.library.get(element.value);
        this.token.characterSheetId = element.value;
      }, 'Loaded saved character.');
    } else if (element === this.fileInput) {
      void this._importFile();
    } else if (element.matches('[aria-label="Character roll mode"]')) {
      this.rollMode = element.value;
    } else if (element.dataset.playSlot) {
      const id = element.dataset.playSlot;
      this.playChoices[id] = { ...this.playChoices[id], slotLevel: Number(element.value) };
      this._run(() => {}, 'Cast level selected.', false);
    } else if (element.dataset.slotChoice) {
      this.slotLevels.set(element.dataset.slotChoice, Number(element.value));
      this._run(() => {}, 'Cast level selected.', false);
    } else if (element.matches('[data-movement-type]')) {
      this._run(
        () => setTokenMovementSettings(this.token, { type: element.value }),
        'Movement style updated.'
      );
    } else if (element.dataset.characterField) {
      this._run(() => {
        const [fieldName, key] = element.dataset.characterField.split('.');
        const value =
          element.type === 'checkbox'
            ? element.checked
            : element.type === 'number'
              ? element.valueAsNumber
              : element.hasAttribute('data-number')
                ? Number(element.value)
                : element.value;
        return this.services.library.edit(
          this.characterId,
          key ? { [fieldName]: { [key]: value } } : { [fieldName]: value }
        );
      });
    } else if (element.dataset.itemAction) {
      this._run(() => {
        const library = this.services.library;
        const item = element.dataset.itemId;
        if (element.dataset.itemAction === 'equip')
          return library.equip(this.characterId, item, element.checked);
        if (element.dataset.itemAction === 'attune')
          return library.attune(this.characterId, item, element.checked);
        if (element.dataset.itemAction === 'quantity')
          return library.setItem(this.characterId, item, { quantity: element.valueAsNumber });
        if (element.dataset.itemAction === 'proficiency') {
          return library.setItem(this.characterId, item, {
            proficiencyOverride: element.value === 'auto' ? null : element.value === 'yes',
          });
        }
      });
    } else if (element.dataset.spellAction === 'prepare') {
      this._run(() =>
        this.services.library.prepare(this.characterId, element.dataset.spellId, element.checked)
      );
    } else if (element.dataset.usedSlot) {
      this._run(() =>
        this.services.library.setSlotUsed(
          this.characterId,
          Number(element.dataset.usedSlot),
          element.valueAsNumber
        )
      );
    }
  }

  _click(event) {
    const section = event.target.closest('[data-sheet-section]');
    if (section) {
      this.section = section.dataset.sheetSection;
      this._run(() => {}, '', false);
      return;
    }
    const button = event.target.closest('[data-sheet-action]');
    if (!button) return;
    const action = button.dataset.sheetAction;
    if (action === 'cast') {
      const slotLevel = this.slotLevels.get(button.dataset.instanceId);
      void performPlayAction(
        this,
        `spell:${button.dataset.instanceId}`,
        slotLevel === undefined ? {} : { slotLevel }
      );
      return;
    }
    if (action === 'use-action') {
      const card = button.closest('.sheet-play-action');
      const choice = {};
      const slot = card?.querySelector('[data-play-slot]');
      const amount = card?.querySelector('[data-play-amount]');
      if (slot) choice.slotLevel = Number(slot.value);
      if (amount) choice.amount = amount.valueAsNumber;
      void performPlayAction(this, button.dataset.actionId, choice);
      return;
    }
    if (action === 'recent-roll') {
      void rollRecentAction(this, button.dataset.sequence, button.dataset.part);
      return;
    }
    const session = this.services?.combat;
    if (
      [
        'turn-start',
        'turn-end',
        'combat-end',
        'use-undo',
        'attack-finish',
        'movement-adjust',
        'economy-adjust',
      ].includes(action)
    ) {
      this._run(
        () => {
          if (['turn-start', 'turn-end', 'combat-end'].includes(action)) {
            this.dmMovementDraft = null;
            this.dmEconomyDraft = {};
          }
          if (action === 'turn-start') session.startTurn(this.token);
          if (action === 'turn-end') session.endTurn();
          if (action === 'combat-end') session.endCombat();
          if (action === 'use-undo') return session.undoLastUse(this.token);
          if (action === 'attack-finish') session.finishAttackAction(this.token);
          if (action === 'movement-adjust') {
            session.adjustMovement(
              this.token,
              this.main.querySelector('[data-play-dm-movement]').valueAsNumber
            );
            this.dmMovementDraft = null;
          }
          if (action === 'economy-adjust') {
            session.adjustEconomy(
              this.token,
              Object.fromEntries(
                Array.from(this.main.querySelectorAll('[data-play-dm-economy]'), (input) => [
                  input.dataset.playDmEconomy,
                  input.valueAsNumber,
                ])
              )
            );
            this.dmEconomyDraft = {};
          }
        },
        'Combat state updated.',
        action === 'use-undo'
      );
      return;
    }
    if (action === 'movement-mode') {
      this._run(
        () => setTokenMovementSettings(this.token, { mode: button.dataset.mode }),
        'Movement pace updated.'
      );
      return;
    }
    if (action === 'roll') {
      void this._roll(button.dataset);
      return;
    }
    if (action === 'close-backup') {
      this.backupPanel.hidden = true;
      this.backupText.value = '';
      this.root.querySelector('[data-sheet-action="export"]').focus();
      return;
    }
    if (action === 'compendium' || action === 'details') {
      void this._openCompendium(button.dataset.entryId || null);
      return;
    }
    if (action === 'import') {
      this.fileInput.click();
      return;
    }
    this._run(
      () => {
        const library = this.services.library;
        const token = this.token;
        if (action === 'new')
          return afterCharacterCommit(
            library.create(getTokenDisplayName(token), { linkTokenId: token.id }),
            (id) => {
              token.characterSheetId = id;
            }
          );
        if (
          action === 'delete' &&
          window.confirm(
            'Delete this saved character? Export a JSON backup first if you may want it later.'
          )
        ) {
          return afterCharacterCommit(
            library.replace(this.characterId, getTokenDisplayName(token)),
            (id) => {
              token.characterSheetId = id;
            }
          );
        }
        if (action === 'export') this._exportFile();
        if (action === 'remove') return library.remove(this.characterId, button.dataset.instanceId);
        if (action === 'end-concentration') return library.endConcentration(this.characterId);
      },
      action === 'export'
        ? 'Backup ready. Copy the JSON if your host does not offer a download.'
        : 'Saved locally.'
    );
  }

  _deferRefresh(message) {
    if (['combat', 'noncombat'].includes(this.section)) return false;
    if (
      !this.main.contains(document.activeElement) ||
      !document.activeElement.matches('input,select,textarea')
    )
      return false;
    try {
      this.gameManager.token3DAdapter?.refreshMovementRange?.();
      this.healthBar.update(this.services.library.get(this.characterId));
      this.restControls.update(this.services.library.get(this.characterId), this.services.library);
      this._updateHistory(this.services.library.get(this.characterId));
      this.status.textContent = message;
      this.status.classList.remove('sheet-error');
    } catch (error) {
      this._failure(error, 'refreshCharacter');
    }
    return true;
  }

  _run(operation, message = 'Saved locally.', notify = true) {
    const token = this.token;
    const failure = (error) => {
      this._failure(error, 'changeCharacter');
      this._syncSavingControls();
      return false;
    };
    try {
      if (!this.services) throw new Error('Wait for character data to finish loading');
      const result = operation();
      const complete = () => {
        if (this.disposed || this.token !== token) return false;
        this.render();
        this.status.textContent = this.services.library.isSaving
          ? 'Saving remaining changes...'
          : message;
        this.status.classList.remove('sheet-error');
        if (notify) notifyCharacterChanged(this.gameManager, this.characterId, null, this);
        return true;
      };
      if (typeof result?.then === 'function') {
        this.status.textContent = 'Saving campaign character...';
        this._syncSavingControls();
        return result.then(complete).catch(failure);
      }
      return complete();
    } catch (error) {
      return failure(error);
    }
  }

  _syncSavingControls() {
    const busy = !!this.services?.library.isSaving || !!this.services?.combat.committing;
    this.root.setAttribute('aria-busy', String(busy));
    this.librarySelect.disabled = busy;
    for (const action of ['new', 'delete', 'import', 'export']) {
      this.root.querySelector(`[data-sheet-action="${action}"]`).disabled = busy;
    }
    this.healthBar.root.querySelector('[aria-label="Apply HP change"]').disabled = busy;
  }

  async _openCompendium(entryId) {
    try {
      if (!this.onOpenCompendium) throw new Error('The compendium sidebar is not available');
      const opened = await this.onOpenCompendium(entryId);
      this.status.textContent =
        opened === false
          ? 'Could not open the compendium. See the sidebar for the error.'
          : 'Compendium opened in the sidebar.';
      this.status.classList.toggle('sheet-error', opened === false);
    } catch (error) {
      this._failure(error, 'openCompendium');
    }
  }

  _failure(error, operation) {
    this.status.textContent = error.message || 'Character operation failed';
    this.status.classList.add('sheet-error');
    new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
      component: 'CharacterSheet',
      operation,
    });
    if (this.services && this.token?.characterSheetId) {
      try {
        this.render();
      } catch (renderError) {
        this.main.textContent = `Character data could not be displayed: ${renderError.message}. Stored data was not reset.`;
      }
    }
  }

  _exportFile() {
    const library = this.services.library;
    const character = library.get(this.characterId);
    const json = library.export(character.id);
    this.backupPanel.querySelector('h4').textContent = `JSON snapshot: ${character.name}`;
    this.backupPanel.hidden = false;
    this.backupText.value = json;
    this.backupText.focus();
    this.backupText.select();
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${character.name.replace(/[^a-z0-9._-]/gi, '-') || 'character'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  async _importFile() {
    const file = this.fileInput.files?.[0];
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error('Character backups must be smaller than 1 MB');
      const text =
        typeof file.text === 'function'
          ? await file.text()
          : await new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve(reader.result);
              reader.onerror = () => reject(reader.error);
              reader.readAsText(file);
            });
      if (this.disposed || !this.token) return;
      const token = this.token;
      await this._run(
        () =>
          afterCharacterCommit(
            this.services.library.import(text, { linkTokenId: token.id }),
            (id) => {
              token.characterSheetId = id;
            }
          ),
        'Imported as a new saved character.'
      );
    } catch (error) {
      this._failure(error, 'importCharacter');
    } finally {
      this.fileInput.value = '';
    }
  }

  async _roll(data) {
    if (data.rollKind === 'attack') return performPlayAction(this, `attack:${data.key}`);
    try {
      const library = this.services.library;
      const character = library.get(this.characterId);
      const stats = library.stats(character.id);
      const key = data.key;
      let label = '';
      let expression = '';
      let check = true;
      if (data.rollKind === 'death') {
        label = 'Death saving throw (resolve successes and failures manually)';
        expression = '1d20';
      }
      if (data.rollKind === 'ability') {
        label = `${title(key)} check`;
        expression = `1d20${signed(stats.abilityModifiers[key])}`;
      }
      if (data.rollKind === 'save') {
        label = `${title(key)} save`;
        expression = `1d20${signed(stats.saves[key])}`;
      }
      if (data.rollKind === 'skill') {
        label = SKILLS.find((skill) => skill.id === key).name;
        expression = `1d20${signed(stats.skills[key])}`;
      }
      if (data.rollKind === 'initiative') {
        label = 'Initiative';
        expression = `1d20${signed(stats.initiative)}`;
      }
      if (['attack', 'damage', 'versatile'].includes(data.rollKind)) {
        const attack = stats.attacks.find((entry) => entry.itemId === key);
        if (!attack) throw new Error('Equip this weapon before rolling it');
        label = `${attack.name} ${data.rollKind}`;
        check = data.rollKind === 'attack';
        expression = check
          ? `1d20${signed(attack.attackBonus)}`
          : data.rollKind === 'damage'
            ? attack.damage
            : attack.versatileDamage;
      }
      if (data.rollKind.startsWith('spell-') || data.rollKind === 'healing') {
        const spell = library.spell(character.id, key, this.slotLevels.get(key));
        label = spell.entry.name;
        check = data.rollKind === 'spell-attack';
        expression = check
          ? `1d20${signed(spell.attackBonus)}`
          : data.rollKind === 'healing'
            ? spell.healing
            : spell.damage[Number(data.part)].notation;
      }
      if (!expression) throw new Error('This effect requires a manual roll');
      return await rollForSheet(this, { expression, check, label: `${character.name}: ${label}` });
    } catch (error) {
      this.rollStatus.textContent = `Roll failed: ${error.message}`;
      this._failure(error, 'characterRoll');
      return null;
    }
  }
}
