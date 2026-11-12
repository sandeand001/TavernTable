import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export default class CloudCampaignInvitations {
  constructor({ workspace, campaignId }) {
    if (
      workspace?.store.storageInfo?.kind !== 'cloud' ||
      ['createInvitation', 'revokeInvitation', 'listSeats'].some(
        (method) => typeof workspace.store[method] !== 'function'
      )
    )
      throw new Error('Cloud invitation management requires the explicit owner campaign store');
    this.workspace = workspace;
    this.store = workspace.store;
    this.campaignId = campaignId;
    this.busy = false;
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Cloud player invitations');
    this.root.tabIndex = -1;
    this.root.innerHTML = `<div class="campaign-shell">
      <h2>Player invitations</h2>
      <p>Invite a player to a campaign seat, not to the owner workspace.
      Accepting requires a verified account and also enables that account for TavernTable.
      Explicit account blocks override invitations.</p>
      <p>Links are single-use and expire after seven days if unused.
      Accepted membership does not expire with the link. Share links only with the intended player.</p>
      <output role="status" aria-label="Cloud player invitation status"></output>
      <form aria-label="Create cloud player invitation">
        <label>Player name<input aria-label="Invited player name" maxlength="80" required autocomplete="off"></label>
        <button type="submit">Create single-use invitation</button>
      </form>
      <label data-invitation-result hidden style="display:none;">Private single-use link
        <input aria-label="Private campaign invitation" readonly>
      </label>
      <section data-player-seats aria-label="Campaign player seats"></section>
      <p>Cloud player gameplay and assignment controls are not enabled in this preparation slice.
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
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-close-invitations')) this.destroy();
      else if (button.hasAttribute('data-refresh-invitations'))
        void this._perform(() => this.render(), 'Checking current player seats...');
      else if (button.dataset.revokeInvitation)
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
    this.root.focus();
    return this._perform(() => this.render(), 'Checking current player seats...');
  }

  async render() {
    this.seats = await this.store.listSeats(this.campaignId);
    this.list.innerHTML =
      this.seats
        .map(
          (seat) => `<article>
        <h3>${escape(seat.name)}</h3>
        <p>${seat.joined ? 'Joined with a verified account.' : 'Not joined.'}</p>
        ${seat.invitation ? `<p>Invitation ${escape(seat.invitation.status)}. Expires ${escape(new Date(seat.invitation.expiresAt).toLocaleString())}.</p>` : ''}
        ${!seat.joined ? `<button type="button" data-reissue-seat="${escape(seat.id)}">New link for this seat</button>` : ''}
        ${seat.invitation?.status === 'pending' ? `<button type="button" data-revoke-invitation="${escape(seat.invitation.id)}">Revoke unused invitation</button>` : ''}
      </article>`
        )
        .join('') || '<p>No player seats have been invited yet.</p>';
    this.status.textContent = 'Player seats checked. Only unused links can be revoked here.';
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
    for (const control of this.root.querySelectorAll('input,button')) control.disabled = this.busy;
    this.root.setAttribute('aria-busy', String(this.busy));
  }

  _failure(error) {
    this.status.textContent = error.message;
    GameErrors.input(error, { component: 'CloudCampaignInvitations', operation: 'invitation' });
  }

  destroy() {
    if (this.busy) {
      this._failure(new Error('Finish the current invitation operation before closing.'));
      return;
    }
    this._clearLink();
    for (const [element, inert] of this.previousInert) element.inert = inert;
    this.root.remove();
    this.previousFocus?.focus?.();
  }
}
