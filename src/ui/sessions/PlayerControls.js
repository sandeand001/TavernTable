import { GameErrors } from '../../utils/error/ErrorHandler.js';
import { CHARACTER_DEFINITIONS, getCharacterDefinition } from '../../config/CharacterCatalog.js';
import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { reconcileContent } from '../characters/reconcileContent.js';

function setOptions(select, rows, value) {
  const signature = JSON.stringify(rows);
  if (select.dataset.options !== signature) {
    select.replaceChildren(
      ...rows.map(([id, name]) => {
        const option = document.createElement('option');
        option.value = id;
        option.textContent = name;
        return option;
      })
    );
    select.dataset.options = signature;
  }
  select.value = value || '';
  select.disabled = rows.length === 0;
}

export default class PlayerControls {
  constructor({
    identity,
    library,
    onObserver = () => {},
    onArea = () => {},
    onSheet = () => {},
    onReconnect = () => {},
    onSignOut = () => {},
    onRetry = () => {},
    onDice = null,
    onArrival = null,
    onPlace = null,
    onRetrieve = null,
  }) {
    if (identity.role !== 'player')
      throw new Error('Player controls require an authenticated player');
    this.library = library;
    this.appearanceChoices = new Map();
    document.body.dataset.sessionRole = 'player';
    this.hidden = [];
    const restricted = [
      ...document.querySelectorAll(
        '[data-tab="terrain"],[data-tab="biomes"],#terrain-panel,#biomes-panel'
      ),
      document.getElementById('creature-content')?.closest('.section'),
      document.getElementById('token-remove')?.closest('.section'),
      document.querySelector('#dice-log-panel .panel-footer'),
    ].filter(Boolean);
    for (const element of restricted) {
      this.hidden.push([element, element.hidden, element.inert]);
      element.hidden = true;
      element.inert = true;
    }
    this.roster = document.getElementById('saved-character-roster');
    const settings = document.getElementById('settings-panel');
    if (!this.roster || !settings) throw new Error('The shared game player controls are missing');
    this.root = document.createElement('section');
    this.root.className = 'section player-session-controls';
    this.root.innerHTML = `<div class="section-title">Campaign &amp; session</div>
      <strong data-player-campaign></strong>
      <output aria-label="Player session status" role="status"></output>
      <label>Active character<select aria-label="Active character"></select></label>
      <output aria-label="Current location"></output>
      <label>Area<select aria-label="Location area"></select></label>
      <p data-player-observer-notice></p>
      <div class="player-session-actions">
        <button type="button" data-player-reconnect>Reconnect</button>
        <button type="button" data-player-signout>Sign out</button>
        <button type="button" data-player-retry hidden>Retry uncertain command</button>
      </div>`;
    settings.prepend(this.root);
    this.observer = this.root.querySelector('[aria-label="Active character"]');
    this.area = this.root.querySelector('[aria-label="Location area"]');
    this.status = this.root.querySelector('[aria-label="Player session status"]');
    this.retry = this.root.querySelector('[data-player-retry]');
    this.root.querySelector('[data-player-reconnect]').addEventListener('click', onReconnect);
    this.root.querySelector('[data-player-signout]').addEventListener('click', onSignOut);
    this.retry.addEventListener('click', onRetry);
    this.observer.addEventListener('change', () => onObserver(this.observer.value));
    this.area.addEventListener('change', () => onArea(this.area.value));
    this.rosterClick = async (event) => {
      const id = event.target.closest('[data-assigned-character]')?.dataset.assignedCharacter;
      if (id) {
        onSheet(id);
        return;
      }
      const button = event.target.closest(
        '[data-player-arrival],[data-player-place],[data-player-retrieve],[data-player-activate]'
      );
      if (!button) return;
      try {
        const characterId = button.closest('[data-player-character]').dataset.playerCharacter;
        const grant = this.state.placementGrants?.find(
          (entry) => entry.characterId === characterId
        );
        const observer = this.state.observers.find((entry) => entry.characterId === characterId);
        if (button.hasAttribute('data-player-activate')) {
          if (!observer) throw new Error('This character has no authorized real observer');
          await onObserver(observer.id);
        } else if (button.hasAttribute('data-player-arrival')) {
          if (!grant || !onArrival)
            throw new Error('Ask the DM for an arrival grant for this character');
          await onArrival(grant.id);
        } else if (button.hasAttribute('data-player-place')) {
          if (!grant || !onPlace) throw new Error('The arrival placement controls are unavailable');
          await onPlace(characterId, this.appearanceChoices.get(characterId), grant.id);
        } else {
          if (!observer || !onRetrieve)
            throw new Error('Choose the real active assigned character before retrieval');
          await onRetrieve(observer.id);
        }
      } catch (error) {
        if (this.destroyed || this.accessEnded) return;
        this.status.textContent = error.message;
        GameErrors.input(error, { component: 'PlayerControls', operation: 'rosterCommand' });
      }
    };
    this.roster.addEventListener('click', this.rosterClick);
    this.rosterChange = (event) => {
      const id = event.target.dataset.playerAppearance;
      if (!id) return;
      try {
        if (this.state.observers.some((observer) => observer.characterId === id))
          throw new Error('Retrieve the existing sprite before choosing its Next sprite');
        const definition = getCharacterDefinition(event.target.value);
        if (!definition) throw new Error('Choose a canonical sprite appearance');
        this.appearanceChoices.set(id, definition.id);
        this.updateRoster();
      } catch (error) {
        this.status.textContent = error.message;
        GameErrors.input(error, { component: 'PlayerControls', operation: 'appearance' });
      }
    };
    this.roster.addEventListener('change', this.rosterChange);
    this.diceButtons = [...document.querySelectorAll('[data-dice]')].map((button) => ({
      button,
      disabled: button.disabled,
      title: button.title,
    }));
    this.diceResult = document.querySelector('[data-dice-result]');
    this.diceNotice = document.createElement('p');
    this.diceNotice.setAttribute('role', 'status');
    this.diceResult?.insertAdjacentElement('afterend', this.diceNotice);
    this.onDice = onDice;
    this.diceClick = async (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      try {
        if (!this.onDice) throw new Error('Host dice controls are not available');
        if (this.diceResult) this.diceResult.textContent = 'Waiting for the host physical roll...';
        await this.onDice(
          Number(event.currentTarget.dataset.sides),
          Number(document.querySelector('[data-dice-count]')?.value)
        );
      } catch (error) {
        if (this.diceResult) this.diceResult.textContent = error.message;
        GameErrors.input(error, { component: 'PlayerControls', operation: 'rollDice' });
      }
    };
    for (const { button } of this.diceButtons)
      button.addEventListener('click', this.diceClick, true);
  }

  update(state, { placementGrantId = null } = {}) {
    this.state = state;
    this.activeGrantId = placementGrantId;
    for (const actor of state.publicScene?.actors || [])
      if (actor.owned) this.appearanceChoices.set(actor.characterId, actor.type);
    this.root.querySelector('[data-player-campaign]').textContent = state.campaign.name;
    this.root.querySelector('[aria-label="Current location"]').textContent =
      state.location?.name || 'No placed assigned character';
    setOptions(
      this.observer,
      state.observers.map(({ id, name }) => [id, name]),
      state.observerTokenId
    );
    setOptions(
      this.area,
      state.maps.map(({ id, name }) => [id, name]),
      state.view?.mode === 'placement-preview'
        ? state.view.id
        : state.publicScene?.presentation.mapId
    );
    if (state.view?.mode === 'placement-preview') this.area.disabled = true;
    this.root.querySelector('[data-player-observer-notice]').textContent = state.observerTokenId
      ? 'Sight follows this character. Opening another sheet does not switch your viewpoint.'
      : state.view?.mode === 'placement-preview'
        ? 'DM-granted arrival preview only. No character vision or movement budget is created.'
        : 'Assigned sheets remain available. Ask the DM for an arrival grant before placement.';
    this.updateRoster();
    this.status.textContent = `${state.profile.name} - Connected`;
    this.updateDiceControls();
  }

  updateRoster() {
    if (!this.state || this.accessEnded) return;
    const state = this.state;
    const busy = this.commandPending || this.commandUncertain || this.library.isSaving;
    const combat = !!state.gameplay.turn?.active;
    const markup = `<div class="section-title">Assigned saved characters</div>
      <p class="small-text">Next sprite choices last only for this workspace. A DM arrival grant is required; no temporary observer is created.</p>
      ${this.library
        .list()
        .map((character) => {
          const observer = state.observers.find((entry) => entry.characterId === character.id);
          const grant = state.placementGrants?.find((entry) => entry.characterId === character.id);
          const appearance = this.appearanceChoices.get(character.id);
          const active = observer?.id === state.observerTokenId;
          const removal = state.gameplay.ownedTokens.find((token) => token.tokenId === observer?.id)
            ?.availability.remove;
          const ready =
            !busy &&
            !combat &&
            state.gameplay.commands.includes('place') &&
            !!grant &&
            !!appearance &&
            this.activeGrantId === grant.id &&
            state.view?.mode === 'placement-preview';
          const reason = combat
            ? 'Only the DM may place or retrieve sprites during combat.'
            : !grant
              ? 'Ask the DM for an arrival grant for this assigned character.'
              : !appearance
                ? 'Choose a canonical Next sprite.'
                : 'Open the authorized arrival preview first.';
          return `<article class="saved-character-card" data-player-character="${escape(character.id)}" data-sheet-key="player-character:${escape(character.id)}">
          <button type="button" data-assigned-character="${escape(character.id)}">${escape(character.name)}</button>
          <label>Next sprite<select data-player-appearance="${escape(character.id)}" aria-label="Appearance for ${escape(character.name)}" ${observer || busy ? 'disabled' : ''}>
            <option value="" ${appearance ? '' : 'selected'} disabled>Choose sprite appearance</option>
            ${CHARACTER_DEFINITIONS.map((entry) => `<option value="${entry.id}" ${entry.id === appearance ? 'selected' : ''}>${escape(entry.label)}</option>`).join('')}
          </select></label>
          ${
            observer
              ? `
            <button type="button" data-player-activate="${escape(character.id)}" ${busy || active ? 'disabled' : ''}>Make active character</button>
            <button type="button" data-player-retrieve="${escape(character.id)}" ${busy || !active || !removal?.allowed ? 'disabled' : ''}
              title="${escape(removal?.reason || (active ? removal?.code || 'Host retrieval eligibility unavailable' : 'Make this character active before retrieval'))}">Retrieve sprite</button>`
              : `<button type="button" data-player-arrival="${escape(character.id)}" ${busy || combat || !grant ? 'disabled' : ''} title="${escape(reason)}">Preview arrival area</button>
            <button type="button" data-player-place="${escape(character.id)}" ${ready ? '' : 'disabled'} title="${escape(reason)}">Place saved character</button>
            <p>${ready ? 'Ready: placement goes only to the DM-granted destination.' : escape(reason)}</p>`
          }
        </article>`;
        })
        .join('')}`;
    const focused = this.roster.contains(document.activeElement) ? document.activeElement : null;
    reconcileContent(this.roster, markup, focused);
  }

  endAccess() {
    this.accessEnded = true;
    this.roster.textContent = 'Player access ended. Reconnect with a valid invitation.';
    this.observer.replaceChildren();
    this.area.replaceChildren();
    this.observer.disabled = true;
    this.area.disabled = true;
    this.root.querySelector('[data-player-observer-notice]').textContent =
      'Character viewpoints are unavailable until you reconnect.';
    this.updateDiceControls();
    this.updateRoster();
  }

  updateCommandState(commands) {
    this.commandPending = commands.pending;
    this.commandUncertain = commands.canRetry;
    this.retry.hidden = !commands.canRetry;
    this.retry.disabled = commands.pending;
    this.root.querySelector('[data-player-reconnect]').disabled =
      commands.pending || this.library.isSaving;
    this.root.querySelector('[data-player-signout]').disabled =
      commands.pending || this.library.isSaving;
    if (commands.pending)
      this.status.textContent = 'Waiting for the host command and its visual checkpoint...';
    else if (commands.failure) this.status.textContent = commands.failure.message;
    this.updateDiceControls();
    this.updateRoster();
  }

  updateDiceControls() {
    const state = this.state;
    const owned = state?.gameplay.ownedTokens.find(
      (token) => token.tokenId === state.observerTokenId
    );
    const capability = owned?.availability.roll;
    const supported = !!state?.gameplay.commands.includes('roll') && !!this.onDice;
    const allowed =
      supported && capability?.allowed === true && !this.accessEnded && !this.commandUncertain;
    const reason = this.accessEnded
      ? 'Player access ended. Reconnect before rolling.'
      : this.commandUncertain
        ? 'Resolve the uncertain host command with same-ID retry or reconnect before rolling.'
        : !state?.observerTokenId
          ? 'Choose a placed assigned character before rolling.'
          : !supported || !capability
            ? 'The host has not provided roll eligibility yet.'
            : capability.reason || capability.code.replaceAll('-', ' ');
    for (const { button } of this.diceButtons) {
      button.disabled = this.commandPending || !allowed;
      button.title = allowed
        ? 'The host rolls the physical dice; this client displays that same roll.'
        : reason;
      button.setAttribute('aria-disabled', String(button.disabled));
    }
    this.diceNotice.textContent = allowed ? '' : reason;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.roster.removeEventListener('click', this.rosterClick);
    this.roster.removeEventListener('change', this.rosterChange);
    for (const { button, disabled, title } of this.diceButtons) {
      button.removeEventListener('click', this.diceClick, true);
      button.disabled = disabled;
      button.title = title;
    }
    this.diceNotice.remove();
    for (const [element, hidden, inert] of this.hidden) {
      element.hidden = hidden;
      element.inert = inert;
    }
    this.root.remove();
  }
}
