import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';
import CloudCampaignClientStore from '../../campaigns/CloudCampaignClientStore.js';
import { campaignCharacterRoster } from '../../campaigns/CampaignCharacters.js';

export default class CloudCampaignInvitations {
  constructor({ workspace, campaignId }) {
    const source = workspace?.store;
    if (
      source?.storageInfo?.kind !== 'cloud' ||
      ['createInvitation', 'revokeInvitation', 'listSeats'].some(
        (method) => typeof source[method] !== 'function'
      )
    )
      throw new Error('Cloud invitation management requires the explicit owner campaign store');
    this.workspace = workspace;
    this.store = new CloudCampaignClientStore({
      connection: source.connection,
      uid: source.uid,
      packs: [],
      crypto: source.crypto,
    });
    this.canAssign = source.capabilities?.assignments === true;
    this.canRemove = source.capabilities?.memberships === true;
    this.canGrant = source.capabilities?.placementGrants === true;
    this.campaignId = campaignId;
    this.busy = false;
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Cloud player invitations');
    this.root.tabIndex = -1;
    this.root.innerHTML = `<div class="campaign-shell">
      <h2>Players and invitations</h2>
      <p>Invite a player to a campaign seat, not to the owner workspace.
      Accepting requires a verified account and also enables that account for TavernTable.
      Explicit account blocks override invitations.</p>
      <p>Links are single-use and expire after seven days if unused.
      Accepted membership does not expire with the link. Share links only with the intended player.</p>
      <p>Removing a player keeps campaign characters and their assignments on the empty seat.
      Assigning the same character to multiple seats deliberately shares control; it does not transfer it.</p>
      <output role="status" aria-label="Cloud player invitation status"></output>
      <button type="button" data-retry-access hidden>Retry same access change</button>
      <form aria-label="Create cloud player invitation">
        <label>Player name<input aria-label="Invited player name" maxlength="80" required autocomplete="off"></label>
        <button type="submit">Create single-use invitation</button>
      </form>
      <label data-invitation-result hidden style="display:none;">Private single-use link
        <input aria-label="Private campaign invitation" readonly>
      </label>
      <section data-player-seats aria-label="Campaign player seats"></section>
      <p>Cloud player gameplay is not enabled in this preparation slice.
      Revoking an unused link does not remove a player who has already joined.</p>
      <button type="button" data-refresh-invitations>Refresh invitations</button>
      <button type="button" data-close-invitations>Close</button>
    </div>`;
    this.status = this.root.querySelector('output');
    this.field = this.root.querySelector('[aria-label="Invited player name"]');
    this.list = this.root.querySelector('[data-player-seats]');
    this.result = this.root.querySelector('[data-invitation-result]');
    this.link = this.result.querySelector('input');
    this.root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      const name = this.field.value;
      void this._perform(() => this._issue(name), 'Creating the single-use invitation...');
    });
    this.root.addEventListener('change', (event) => {
      const control = event.target;
      if (!control.matches('input[data-assign-character]')) return;
      const seat = this.seats.find((entry) => entry.id === control.dataset.seatId);
      const assigned = control.checked;
      void this._perform(async () => {
        if (!this.canAssign || !seat)
          throw new Error('Refresh the current seat before changing its assignments.');
        await this.store.assignCharacter(this.campaignId, {
          seatId: seat.id,
          characterId: control.dataset.assignCharacter,
          assigned,
          accessGeneration: seat.version === 1 ? 0 : seat.accessGeneration,
        });
        await this.render();
        this.status.textContent = assigned
          ? 'Character access assigned. Existing shared assignments were kept.'
          : 'Character access removed from this seat. The saved character was kept.';
      }, 'Updating saved-character access...');
    });
    this.root.addEventListener('submit', (event) => {
      const form = event.target.closest('[data-arrival-character]');
      if (!form) return;
      event.preventDefault();
      const seatId = form.dataset.arrivalSeat;
      const characterId = form.dataset.arrivalCharacter;
      const mapId = form.querySelector('[data-arrival-map]').value;
      const gridX = form.querySelector('[data-arrival-x]').valueAsNumber;
      const gridY = form.querySelector('[data-arrival-y]').valueAsNumber;
      void this._perform(async () => {
        const seat = this.seats.find((entry) => entry.id === seatId);
        const map = this.arrivalMaps.find((entry) => entry.id === mapId);
        if (
          !this.canGrant ||
          !seat?.characterIds.includes(characterId) ||
          !map ||
          !Number.isInteger(gridX) ||
          !Number.isInteger(gridY) ||
          gridX < 0 ||
          gridY < 0 ||
          gridX >= map.grid.cols ||
          gridY >= map.grid.rows
        )
          throw new Error(
            'Choose an assigned character, arrival area and valid zero-based column/row.'
          );
        await this.store.grantPlacement(this.campaignId, {
          seatId,
          characterId,
          accessGeneration: seat.version === 1 ? 0 : seat.accessGeneration,
          destination: { mapId, gridX, gridY },
        });
        await this.render();
        this.status.textContent =
          'Arrival destination granted. Only its terrain can be previewed; placement still requires a clear supported cell outside combat.';
      }, 'Granting the explicit arrival destination...');
    });
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-close-invitations')) this.destroy();
      else if (button.hasAttribute('data-retry-access'))
        void this.store.retryPending().catch((error) => this._failure(error));
      else if (button.hasAttribute('data-refresh-invitations'))
        void this._perform(() => this.render(), 'Checking current player seats...');
      else if (button.dataset.removeMember) {
        const seat = this.seats.find((entry) => entry.id === button.dataset.removeMember);
        void this._perform(async () => {
          if (!this.canRemove || !seat?.joined)
            throw new Error('Refresh the joined player seat before removing its access.');
          await this.store.removeMember(this.campaignId, {
            seatId: seat.id,
            accessGeneration: seat.version === 1 ? 0 : seat.accessGeneration,
          });
          await this.render();
          this.status.textContent =
            'Player access removed. Saved characters and seat assignments were kept.';
        }, 'Removing this player membership...');
      } else if (button.dataset.revokeInvitation)
        void this._perform(async () => {
          await this.store.revokeInvitation(this.campaignId, button.dataset.revokeInvitation);
          this._clearLink();
          await this.render();
          this.status.textContent = 'Unused invitation revoked. No accepted player was removed.';
        }, 'Revoking the unused invitation...');
      else if (button.dataset.reissueSeat)
        void this._perform(async () => {
          const seat = this.seats.find((entry) => entry.id === button.dataset.reissueSeat);
          if (!seat || seat.joined)
            throw new Error('The seat changed. Refresh invitations before issuing another link.');
          await this._issue(seat.name, seat.id);
        }, 'Replacing the invitation for the existing seat...');
    });
    this.leaving = (event) => {
      if (!this.busy && !this.store.pending) return;
      event.preventDefault();
      event.returnValue = '';
    };
    this.connectivityChanged = () => this._controls();
  }

  async _issue(name, seatId = null) {
    this._clearLink();
    const issued = await this.store.createInvitation(this.campaignId, { name, seatId });
    await this.render();
    const current = this.seats.find((entry) => entry.id === issued.seatId)?.invitation;
    if (current?.id !== issued.id || current.status !== 'pending')
      throw new Error(
        'The invitation was issued but is no longer current. Refresh before sharing another link.'
      );
    const link = new URL('/', location.href);
    link.hash = `invite=${issued.id}.${issued.secret}`;
    this.link.value = link.href;
    this.result.hidden = false;
    this.result.style.display = '';
    this.field.value = '';
    this.focusLink = true;
    this.status.textContent =
      'Copy this single-use link for the intended player. Its secret cannot be retrieved after closing; issue a new link if needed.';
  }

  _clearLink() {
    this.result.hidden = true;
    this.result.style.display = 'none';
    this.link.value = '';
    this.focusLink = false;
  }

  async open() {
    this.previousFocus = document.activeElement;
    this.previousInert = new Map(
      [...document.body.children].map((element) => [element, element.inert])
    );
    for (const element of this.previousInert.keys()) element.inert = true;
    document.body.append(this.root);
    this.stopSave = this.store.subscribeSave((state) => {
      this.accessState = state;
      if (state.phase === 'uncertain')
        this.status.textContent =
          'Unconfirmed campaign access change. Keep this panel open and retry the same change. ' +
          state.error.message;
      this._controls();
    });
    window.addEventListener('beforeunload', this.leaving);
    window.addEventListener('online', this.connectivityChanged);
    window.addEventListener('offline', this.connectivityChanged);
    this.root.focus();
    return this._perform(() => this.render(), 'Checking current player seats...');
  }

  async render() {
    const [seats, characters] = await Promise.all([
      this.store.listSeats(this.campaignId),
      this.canAssign ? this._characters() : [],
    ]);
    this.seats = seats;
    this.characters = characters;
    this.list.innerHTML =
      this.seats
        .map(
          (seat) => `<article>
        <h3>${escape(seat.name)}</h3>
        <p>${seat.joined ? 'Joined with a verified account.' : 'Not joined.'}</p>
        ${this.canRemove && seat.joined ? `<button type="button" data-remove-member="${escape(seat.id)}">Remove player access</button>` : ''}
        ${seat.invitation ? `<p>Invitation ${escape(seat.invitation.status)}. Expires ${escape(new Date(seat.invitation.expiresAt).toLocaleString())}.</p>` : ''}
        ${!seat.joined ? `<button type="button" data-reissue-seat="${escape(seat.id)}">New link for this seat</button>` : ''}
        ${seat.invitation?.status === 'pending' ? `<button type="button" data-revoke-invitation="${escape(seat.invitation.id)}">Revoke unused invitation</button>` : ''}
        ${
          this.canAssign
            ? `<fieldset><legend>Assigned saved characters</legend>${
                [
                  ...characters,
                  ...seat.characterIds
                    .filter((id) => !characters.some((character) => character.id === id))
                    .map((id) => ({ id, name: 'Unavailable saved character: ' + id })),
                ]
                  .map(
                    (character) => `<label><input type="checkbox"
            data-assign-character="${escape(character.id)}" data-seat-id="${escape(seat.id)}"
            ${seat.characterIds.includes(character.id) ? 'checked' : ''}>${escape(character.name)}</label>`
                  )
                  .join('') || '<p>Create a saved character before assigning it.</p>'
              }</fieldset>`
            : ''
        }
        ${
          this.canGrant && this.arrivalMaps.length
            ? characters
                .filter((character) => seat.characterIds.includes(character.id))
                .map(
                  (
                    character
                  ) => `<form data-arrival-seat="${escape(seat.id)}" data-arrival-character="${escape(character.id)}">
            <h4>Arrival destination for ${escape(character.name)}</h4>
            <label>Arrival area<select data-arrival-map aria-label="Arrival area for ${escape(character.name)}">
              ${this.arrivalMaps.map((map) => `<option value="${escape(map.id)}">${escape(map.name)}</option>`).join('')}
            </select></label>
            <label>Column (zero-based)<input type="number" min="0" step="1" value="0" required data-arrival-x></label>
            <label>Row (zero-based)<input type="number" min="0" step="1" value="0" required data-arrival-y></label>
            <button type="submit">Grant arrival destination</button>
          </form>`
                )
                .join('')
            : ''
        }
      </article>`
        )
        .join('') || '<p>No player seats have been invited yet.</p>';
    this.status.textContent = 'Player seats checked. Only unused links can be revoked here.';
  }

  async _characters() {
    const state = await this.workspace.store.readCharacters(this.campaignId);
    const scene = state.scene === null ? null : JSON.parse(state.scene);
    this.arrivalMaps = !scene
      ? []
      : scene.version === 3
        ? scene.maps
        : [{ id: 'map-main', name: 'Main map', grid: scene.grid }];
    if (state.records.length === 0) return [];
    if (typeof this.workspace.resources?.catalog !== 'function')
      throw new Error(
        'Campaign character sources are not ready. Reopen this campaign before assigning characters.'
      );
    const catalog = await this.workspace.resources.catalog(state.campaign);
    return campaignCharacterRoster(state.campaign, catalog, state.records);
  }

  async _perform(operation, message) {
    if (this.busy) {
      this._failure(new Error('Finish the current invitation operation first.'));
      return false;
    }
    this.busy = true;
    this._controls();
    this.status.textContent = message;
    try {
      await this.workspace.active?.autosave?.flush();
      await this.workspace.active?.library?.flush();
      await operation();
      return true;
    } catch (error) {
      if (!this.store.pending && this.store.saveState.phase === 'failed') {
        try {
          await this.render();
        } catch (refreshError) {
          GameErrors.input(refreshError, {
            component: 'CloudCampaignInvitations',
            operation: 'refreshAfterError',
          });
        }
      }
      this._failure(error);
      return false;
    } finally {
      this.busy = false;
      this._controls();
      if (this.focusLink) {
        this.focusLink = false;
        this.link.focus();
        this.link.select();
      }
    }
  }

  _controls() {
    for (const control of this.root.querySelectorAll('input,select,button'))
      control.disabled = this.busy;
    const retry = this.root.querySelector('[data-retry-access]');
    retry.hidden = this.accessState?.phase !== 'uncertain';
    retry.disabled =
      retry.hidden ||
      navigator.onLine === false ||
      this.store.connection.account.identity()?.uid !== this.store.uid;
    this.root.setAttribute('aria-busy', String(this.busy));
  }

  _failure(error) {
    this.status.textContent = this.store.pending
      ? 'Unconfirmed campaign access change. Keep this panel open and retry the same change. ' +
        error.message
      : error.message;
    GameErrors.input(error, { component: 'CloudCampaignInvitations', operation: 'invitation' });
  }

  destroy() {
    if (this.busy || this.store.pending) {
      this._failure(new Error('Finish the current invitation operation before closing.'));
      return;
    }
    this._clearLink();
    this.stopSave?.();
    window.removeEventListener('beforeunload', this.leaving);
    window.removeEventListener('online', this.connectivityChanged);
    window.removeEventListener('offline', this.connectivityChanged);
    this.store.close();
    for (const [element, inert] of this.previousInert) element.inert = inert;
    this.root.remove();
    this.previousFocus?.focus?.();
  }
}
