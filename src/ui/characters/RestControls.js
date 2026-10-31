import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import { reconcileContent } from './reconcileContent.js';
import { escapeHtml } from './escapeHtml.js';
import { afterCharacterCommit } from '../../entities/characters/storageChanges.js';

const signed = (value) => `${value >= 0 ? '+' : ''}${value}`;

export default class RestControls {
  constructor({ onChanged, canRest = () => true, roll = null }) {
    this.onChanged = onChanged;
    this.canRest = canRest;
    this.roll = roll;
    this.characterId = null;
    this.generation = 0;
    this.busy = false;
    this.disposed = false;
    this.mode = null;
    this.root = document.createElement('section');
    this.root.className = 'sheet-rest-controls';
    this.root.innerHTML = `
      <div class="sheet-rest-toolbar" role="group" aria-label="Rest and recovery">
        <strong>Recovery</strong>
        <button type="button" data-rest-action="short" aria-label="Short rest">Short Rest</button>
        <button type="button" data-rest-action="long" aria-label="Long rest">Long Rest</button>
        <button type="button" data-rest-action="resources">Resources</button>
        <output aria-label="Hit Dice remaining"></output>
      </div>
      <p class="sheet-rest-status" role="status" aria-label="Rest status"></p>
      <section class="sheet-rest-panel" aria-label="Rest options" hidden>
        <h4></h4>
        <p class="sheet-rest-explanation"></p>
        <div class="sheet-rest-choices" aria-label="Optional short-rest recovery"></div>
        <div class="sheet-rest-actions">
          <button type="button" data-rest-action="complete-short" hidden>Complete short rest</button>
          <button type="button" data-rest-action="complete-long" hidden>Complete long rest</button>
          <button type="button" data-rest-action="hit-die" hidden></button>
          <button type="button" data-rest-action="arcane" hidden>Choose Arcane Recovery slots</button>
          <button type="button" data-rest-action="close">Done</button>
        </div>
        <form class="sheet-rest-arcane" aria-label="Arcane Recovery slots" novalidate hidden>
          <h5>Optional Arcane Recovery</h5>
          <output aria-label="Arcane Recovery budget"></output>
          <div class="sheet-rest-arcane-fields"></div>
          <button type="submit" data-rest-arcane-apply>Restore selected slots</button>
          <button type="button" data-rest-action="arcane-cancel">Cancel slot selection</button>
        </form>
        <div class="sheet-rest-resources">
          <h5>Class resource counters</h5>
          <p>Adjust remaining uses manually after using abilities. Effects and action costs are not applied here.</p>
          <div class="sheet-rest-resource-list"></div>
          <button type="button" data-rest-action="daily" hidden>New game day: reset daily uses (DM)</button>
        </div>
      </section>`;
    this.status = this.root.querySelector('[role="status"]');
    this.remaining = this.root.querySelector('output');
    this.panel = this.root.querySelector('[aria-label="Rest options"]');
    this.heading = this.panel.querySelector('h4');
    this.explanation = this.root.querySelector('.sheet-rest-explanation');
    this.choices = this.root.querySelector('.sheet-rest-choices');
    this.resources = this.root.querySelector('.sheet-rest-resource-list');
    this.arcaneForm = this.root.querySelector('.sheet-rest-arcane');
    this.arcaneFields = this.root.querySelector('.sheet-rest-arcane-fields');
    this.arcaneBudget = this.root.querySelector('[aria-label="Arcane Recovery budget"]');
    this.arcaneForm.addEventListener('submit', (event) => {
      event.preventDefault();
      this._perform(() => {
        if (!this.canRest()) throw new Error('End combat before using rest recovery');
        const selected = Object.fromEntries(
          Array.from(this.arcaneFields.querySelectorAll('input'), (input) => [
            input.dataset.arcaneSlot,
            input.valueAsNumber,
          ])
        );
        const id = this.characterId;
        const reset = this.info.resources.find(
          (resource) => resource.id === 'arcane-recovery'
        ).reset;
        return afterCharacterCommit(this.library.rest.recoverSpellSlots(id, selected), (result) => {
          if (this.characterId === id) this.arcaneOpen = false;
          return `Arcane Recovery restored ${result.points} total slot levels; use recovers after ${reset === 'daily' ? 'a new game day' : 'a long rest'}.`;
        });
      });
    });
    this.arcaneForm.addEventListener('input', () => this._updateArcaneBudget());
    this.root.addEventListener('click', (event) => {
      const action = event.target.closest('[data-rest-action]')?.dataset.restAction;
      if (action) this._action(action);
    });
    this.root.addEventListener('change', (event) => {
      const resource = event.target.dataset.restResource;
      if (resource) {
        const id = this.characterId;
        const remaining = event.target.valueAsNumber;
        this._perform(
          () => this.library.rest.setResourceRemaining(id, resource, remaining),
          'Resource counter updated; apply its effects manually.'
        );
      }
    });
    this.root.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && this.mode && !this.busy) {
        event.preventDefault();
        event.stopPropagation();
        this.mode = null;
        this._render();
        this.root.querySelector('[data-rest-action="short"]').focus();
      }
    });
  }

  // -- Lifecycle and display --
  update(character, library) {
    this.library = library;
    const changed =
      this.characterId !== character.id ||
      this.classId !== character.classId ||
      this.level !== character.level;
    if (changed) {
      this.generation++;
      this.mode = null;
      this.arcaneOpen = false;
      this.status.textContent = '';
    }
    this.characterId = character.id;
    this.classId = character.classId;
    this.level = character.level;
    this.character = character;
    this.root.hidden = false;
    try {
      this.info = library.rest.status(character.id);
      this._render();
    } catch (error) {
      this._failure(error);
      this.info = null;
      this.panel.hidden = true;
      this.remaining.textContent = 'Rest data unavailable';
      for (const button of this.root.querySelectorAll('button')) button.disabled = true;
    }
  }

  clear() {
    this.generation++;
    this.characterId = null;
    this.mode = null;
    this.arcaneOpen = false;
    this.root.hidden = true;
  }

  destroy() {
    this.disposed = true;
    this.clear();
    this.root.remove();
  }

  _render() {
    if (!this.info || !this.characterId) return;
    const dice = this.info.hitDice;
    this.remaining.textContent = dice.sides
      ? `${dice.remaining}/${dice.total} d${dice.sides} Hit Dice | CON ${signed(dice.constitutionModifier)}`
      : 'Choose a class to spend Hit Dice';
    this.panel.hidden = !this.mode;
    const confirmation = this.mode?.endsWith('-confirm');
    const short = this.mode === 'short';
    const revised = this.library.ruleset === '2024';
    this.heading.textContent =
      this.mode === 'short-confirm'
        ? 'Complete a short rest'
        : this.mode === 'long-confirm'
          ? 'Complete a long rest'
          : short
            ? 'Short rest completed'
            : this.mode === 'long'
              ? 'Long rest completed'
              : 'Rest resources';
    this.explanation.textContent =
      this.mode === 'short-confirm'
        ? `Confirm at least 1 hour of qualifying rest in game time. Supported short-rest resources recover even if you spend no Hit Dice.${this.classId === 'monk' && !revised ? ' Ki recovery includes at least 30 minutes of meditation.' : ''}${revised ? ' You must start with at least 1 HP.' : ''}`
        : this.mode === 'long-confirm'
          ? revised
            ? 'Confirm a qualifying 8-hour rest; wait at least 16 hours after finishing before starting another. Restore HP/slots, long-rest uses and all spent Hit Dice. Other HP-maximum/condition effects are manual.'
            : `Confirm a qualifying 8-hour rest, at most once per 24 game hours. Restore HP/slots and short/long-rest uses; recover up to ${Math.max(1, Math.floor(dice.total / 2))} spent Hit Dice. Daily uses require New game day.`
          : short
            ? 'Optionally spend one Hit Die at a time, see its healing, and stop whenever you choose. Temporary HP is unchanged. Other healing bonuses, such as Song of Rest or item effects, remain manual.'
            : 'Other item, subclass, condition and party-rest effects remain manual. Daily resets are declared by the DM, not the computer clock.';
    this.choices.hidden = this.mode !== 'short-confirm';
    if (!this.choices.hidden) {
      reconcileContent(
        this.choices,
        (this.info.shortRestChoices || [])
          .map(
            (choice) => `
        <label><input type="checkbox" data-short-recovery="${escapeHtml(choice.id)}">
          ${escapeHtml(choice.label)}</label>`
          )
          .join('')
      );
    }
    for (const button of this.root.querySelectorAll('button')) button.disabled = this.busy;
    for (const input of this.choices.querySelectorAll('input')) input.disabled = this.busy;
    this.root.querySelector('[data-rest-action="complete-short"]').hidden =
      this.mode !== 'short-confirm';
    this.root.querySelector('[data-rest-action="complete-short"]').disabled =
      this.busy || !this.library.rules.canStartShortRest(this.character);
    const completeLong = this.root.querySelector('[data-rest-action="complete-long"]');
    completeLong.hidden = this.mode !== 'long-confirm';
    completeLong.disabled = this.busy || this.character.hp.current < 1;
    completeLong.title =
      this.character.hp.current < 1 ? 'A long rest requires at least 1 HP at its start' : '';
    const spend = this.root.querySelector('[data-rest-action="hit-die"]');
    spend.hidden = !short;
    spend.textContent = dice.sides
      ? `Spend 1d${dice.sides} ${signed(dice.constitutionModifier)}`
      : 'No class Hit Die';
    spend.disabled =
      this.busy ||
      !this.library.rules.canStartShortRest(this.character) ||
      !dice.sides ||
      dice.remaining < 1 ||
      this.character.hp.current >= this.character.hp.max;
    const arcane = this.info.resources.find((resource) => resource.id === 'arcane-recovery');
    const recovery = this.root.querySelector('[data-rest-action="arcane"]');
    recovery.hidden = !short || !arcane;
    recovery.disabled =
      this.busy ||
      !arcane?.remaining ||
      !this.info.spellSlots.some((slot) => slot.level <= 5 && slot.used > 0);
    if (!short || !arcane?.remaining) this.arcaneOpen = false;
    this.arcaneForm.hidden = !this.arcaneOpen;
    if (this.arcaneOpen) {
      for (const input of this.arcaneFields.querySelectorAll('input')) {
        const slot = this.info.spellSlots.find(
          (entry) => entry.level === Number(input.dataset.arcaneSlot)
        );
        input.max = String(slot.used);
        input.disabled = this.busy;
      }
      this._updateArcaneBudget();
    }
    this.root.querySelector('[data-rest-action="close"]').textContent = confirmation
      ? 'Cancel'
      : 'Done';
    this.root.querySelector('.sheet-rest-resources').hidden = !!confirmation;
    const editingResource = this.resources.contains(this.root.ownerDocument.activeElement);
    if (!editingResource) {
      reconcileContent(
        this.resources,
        this.info.resources
          .map(
            (resource) => `
        <div class="sheet-rest-resource" data-sheet-key="resource:${escapeHtml(resource.id)}">
          <div><strong>${escapeHtml(resource.name)}</strong><small>${
            resource.reset === 'short'
              ? 'Short / long rest'
              : resource.reset === 'daily'
                ? 'New game day'
                : 'Long rest'
          }${resource.shortRecovery ? `; short rest: +${resource.shortRecovery}` : ''}</small></div>
          ${
            resource.maximum === null
              ? '<span>Unlimited</span>'
              : `<label>Remaining
            <input type="number" min="0" max="${resource.maximum}" step="1"
              aria-label="Remaining ${escapeHtml(resource.name)}" data-rest-resource="${escapeHtml(resource.id)}"
              value="${resource.remaining}" ${this.busy ? 'disabled' : ''}> / ${resource.maximum}</label>`
          }
        </div>`
          )
          .join('') || '<p>No tracked class-use counters at this class and level.</p>'
      );
    }
    this.root.querySelector('[data-rest-action="daily"]').hidden = !this.info.resources.some(
      (resource) => resource.reset === 'daily'
    );
    const allowed = this.canRest();
    for (const action of [
      'short',
      'long',
      'complete-short',
      'complete-long',
      'hit-die',
      'arcane',
      'daily',
    ]) {
      const button = this.root.querySelector(`[data-rest-action="${action}"]`);
      if (!allowed) button.disabled = true;
      if (['short', 'long', 'daily'].includes(action))
        button.title = allowed ? '' : 'End combat before resting or resetting daily uses';
    }
    this.root.querySelector('[data-rest-arcane-apply]').disabled = this.busy || !allowed;
    for (const input of this.resources.querySelectorAll('input')) input.disabled = this.busy;
  }

  // -- Rest actions --
  _action(action) {
    if (!this.canRest() && !['resources', 'close', 'arcane-cancel'].includes(action)) {
      this._failure(new Error('End combat before taking a rest or resetting daily uses'));
      return;
    }
    if (this.busy) {
      this._failure(new Error('Finish the current Hit Die roll first'));
      return;
    }
    if (action === 'short' || action === 'long') {
      this.arcaneOpen = false;
      this.mode = `${action}-confirm`;
      this._render();
      const confirm = this.root.querySelector(`[data-rest-action="complete-${action}"]`);
      confirm.scrollIntoView?.({ block: 'nearest' });
      if (!confirm.disabled) confirm.focus({ preventScroll: true });
    } else if (action === 'resources' || action === 'close') {
      this.arcaneOpen = false;
      this.mode = action === 'close' ? null : 'resources';
      this._render();
    } else if (action === 'complete-short') {
      const id = this.characterId;
      const choices = Object.fromEntries(
        [...this.choices.querySelectorAll('input')].map((input) => [
          input.dataset.shortRecovery,
          input.checked,
        ])
      );
      this._perform(() => {
        return afterCharacterCommit(this.library.rest.shortRest(id, choices), (result) => {
          if (this.characterId === id) this.mode = 'short';
          return `Short rest complete. ${result.slotsRecovered} Pact Magic slots recovered. ${result.restored.join(', ') || 'No spent class uses needed recovery'}.`;
        });
      });
    } else if (action === 'complete-long') {
      const id = this.characterId;
      this._perform(() => {
        return afterCharacterCommit(this.library.longRest(id), (result) => {
          if (this.characterId === id) this.mode = 'long';
          return `Long rest complete. HP, slots and rest-reset uses restored; ${result.hitDiceRecovered} Hit Dice recovered. Calendar-day custom uses are unchanged.`;
        });
      });
    } else if (action === 'daily') {
      if (
        this.root.ownerDocument.defaultView.confirm(
          "Declare a new game day and reset this character's daily-use counters?"
        )
      ) {
        this._perform(
          () => this.library.rest.resetDaily(this.characterId),
          'Daily uses reset for a new game day.'
        );
      }
    } else if (action === 'hit-die') {
      void this._spendHitDie();
    } else if (action === 'arcane') {
      const slots = this.info.spellSlots.filter((slot) => slot.level <= 5 && slot.used > 0);
      reconcileContent(
        this.arcaneFields,
        slots
          .map(
            (slot) => `
        <label class="sheet-field">Level ${slot.level}: ${slot.used} expended
          <input type="number" min="0" max="${slot.used}" step="1" value="0"
            aria-label="Recover level ${slot.level} slots" data-arcane-slot="${slot.level}">
        </label>`
          )
          .join('')
      );
      this.arcaneOpen = true;
      this._render();
      this.arcaneFields.querySelector('input')?.focus();
    } else if (action === 'arcane-cancel') {
      this.arcaneOpen = false;
      this._render();
    }
  }

  _updateArcaneBudget() {
    const inputs = Array.from(this.arcaneFields.querySelectorAll('input'));
    const valid = inputs.every(
      (input) => Number.isInteger(input.valueAsNumber) && input.valueAsNumber >= 0
    );
    const selected = inputs.reduce(
      (total, input) => total + Number(input.dataset.arcaneSlot) * input.valueAsNumber,
      0
    );
    const budget = this.info.arcaneRecoveryBudget;
    this.arcaneBudget.textContent = valid
      ? `${selected} / ${budget} total slot levels selected; no slot may be above level 5.`
      : `Enter whole, non-negative counts. Budget: ${budget} total slot levels.`;
    this.arcaneBudget.classList.toggle('sheet-error', !valid || selected > budget);
  }

  _perform(operation, message = null) {
    const id = this.characterId;
    this.busy = true;
    this._render();
    const fail = (error) => {
      this.busy = false;
      this._failure(error);
      this._render();
      return false;
    };
    try {
      const result = afterCharacterCommit(operation(), (value) => {
        this.busy = false;
        const notice = message || value;
        if (!this.disposed && this.characterId === id) {
          this.update(this.library.get(id), this.library);
          this.status.textContent = notice;
          this.status.classList.remove('sheet-error');
        }
        this.onChanged(id, notice);
        return true;
      });
      if (typeof result?.then === 'function') {
        this.status.textContent = 'Saving recovery...';
        return result.catch(fail);
      }
      return result;
    } catch (error) {
      return fail(error);
    }
  }

  async _spendHitDie() {
    const id = this.characterId;
    const generation = this.generation;
    this.busy = true;
    this.status.textContent = 'Rolling a Hit Die...';
    this._render();
    try {
      if (!this.canRest()) throw new Error('End combat before spending rest Hit Dice');
      if (this.library.isSaving)
        throw new Error('Finish saving character changes before rolling Hit Dice');
      const info = this.library.rest.status(id);
      const character = this.library.get(id);
      const expected = { classId: info.classId, level: info.level, ...info.hitDice };
      if (!info.hitDice.sides || info.hitDice.remaining < 1)
        throw new Error('No Hit Dice can be spent');
      const { rollDiceExpression } = await import('../../systems/dice/dice.js');
      if (this.disposed || generation !== this.generation || !this.canRest()) {
        throw new Error(
          'Character changed or combat started before the roll; no Hit Die was spent'
        );
      }
      const result = await (this.roll || rollDiceExpression)({
        expression: `1d${info.hitDice.sides}${signed(info.hitDice.constitutionModifier)}`,
        label: `${character.name}: short-rest Hit Die`,
      });
      if (result.cancelled || this.disposed || generation !== this.generation || !this.canRest()) {
        throw new Error(
          'Hit Die roll cancelled, character changed or combat started; no die was spent'
        );
      }
      const healed = await this.library.rest.spendHitDie(id, result.values[0], expected);
      if (this.disposed || generation !== this.generation) {
        this.onChanged(id, 'Hit Die recovery saved to its original character.');
        return;
      }
      this.status.textContent = `${result.text}. Restored ${healed.applied} HP; ${healed.remaining}/${info.hitDice.total} Hit Dice remain.`;
      this.status.classList.remove('sheet-error');
      this.onChanged(id, this.status.textContent);
    } catch (error) {
      this._failure(error);
    } finally {
      this.busy = false;
      if (!this.disposed && this.characterId) {
        try {
          this.update(this.library.get(this.characterId), this.library);
        } catch (error) {
          this._failure(error);
        }
      }
    }
  }

  _failure(error) {
    this.status.textContent = error.message;
    this.status.classList.add('sheet-error');
    new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
      component: 'RestControls',
      operation: 'rest',
    });
  }
}
