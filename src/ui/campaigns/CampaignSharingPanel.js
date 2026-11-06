import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export default class CampaignSharingPanel {
  constructor({ workspace, campaignId }) {
    this.workspace = workspace;
    this.campaignId = campaignId;
    this.store = workspace.store;
    this.busy = false;
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Players and sharing');
    this.root.innerHTML = `<div class="campaign-shell">
      <h2>Players and sharing</h2>
      <p>Characters are persistent saved records, not temporary tokens. Each player follows their active assigned character's location.</p>
      <output role="status" aria-label="Player sharing status"></output>
      <form data-create-invite><label>Player name<input aria-label="Player name" maxlength="80" required></label>
      <button type="submit">Create private invitation</button></form>
      <label data-invite-result hidden style="display:none;">Private player link<input aria-label="Private player link" readonly></label>
      <section data-player-list></section>
      <section><h3>Location access</h3>
      <p>Placing or moving an assigned character grants that player access to the character's location and its connected areas.
      Internal rooms and floors do not need individual publication. Separate locations do not interact physically.</p></section>
      <p>First milestone: assigned sheets and a read-only location terrain/tactical-token viewer.
      Player movement and combat require the next authoritative command stage.</p>
      <button type="button" data-close-sharing>Close</button></div>`;
    this.status = this.root.querySelector('output');
    this.root.querySelector('form').addEventListener('submit', (event) => {
      event.preventDefault();
      void this._perform(async () => {
        const invitation = await this.store.sessionCall('createInvite', [
          this.campaignId,
          { name: this.root.querySelector('[aria-label="Player name"]').value },
        ]);
        this._showInvite(invitation.invite);
        await this.render();
      });
    });
    this.root.addEventListener('change', (event) => {
      const control = event.target;
      if (control.dataset.assignCharacter)
        void this._perform(async () => {
          await this.store.sessionCall('assignCharacter', [
            this.campaignId,
            control.dataset.playerId,
            control.dataset.assignCharacter,
            control.checked,
          ]);
          await this.render();
        });
    });
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-close-sharing')) {
        if (!this.busy) this.destroy();
      } else if (button.dataset.revokePlayer)
        void this._perform(async () => {
          await this.store.sessionCall('revokeInvite', [
            this.campaignId,
            button.dataset.revokePlayer,
          ]);
          await this.render();
        });
      else if (button.dataset.reissuePlayer)
        void this._perform(async () => {
          const invitation = await this.store.sessionCall('createInvite', [
            this.campaignId,
            { name: button.dataset.playerName, playerId: button.dataset.reissuePlayer },
          ]);
          this._showInvite(invitation.invite);
          await this.render();
        });
    });
  }

  _showInvite(secret) {
    const host = this.store.publicOrigin || location.origin;
    const link = new URL('player.html', host + '/');
    link.hash = `invite=${secret}`;
    this.root.querySelector('[data-invite-result]').hidden = false;
    this.root.querySelector('[data-invite-result]').style.display = '';
    const field = this.root.querySelector('[aria-label="Private player link"]');
    field.value = link.href;
    field.focus();
    field.select();
    this.status.textContent =
      'Copy this private link for this player. Reissuing or revoking invalidates earlier access.';
  }

  open() {
    this.previousFocus = document.activeElement;
    this.previousInert = new Map(
      [...document.body.children].map((element) => [element, element.inert])
    );
    for (const element of this.previousInert.keys()) element.inert = true;
    document.body.append(this.root);
    return this._perform(() => this.render());
  }

  async render() {
    const state = await this.store.sessionCall('sessionInfo', [this.campaignId]);
    this.root.querySelector('[data-player-list]').innerHTML =
      state.players
        .map(
          (player) =>
            `<article><h3>${escape(player.name)}${player.revoked ? ' (revoked)' : ''}</h3>
      <button type="button" data-reissue-player="${escape(player.id)}" data-player-name="${escape(player.name)}">New private link</button>
      <button type="button" data-revoke-player="${escape(player.id)}">Revoke access</button>
      <fieldset><legend>Assigned saved characters</legend>${
        state.characters
          .map(
            (character) =>
              `<label><input type="checkbox" data-assign-character="${escape(character.id)}"
        data-player-id="${escape(player.id)}" ${player.characterIds.includes(character.id) ? 'checked' : ''}
        ${player.revoked ? 'data-static-disabled disabled' : ''}>${escape(character.name)}</label>`
          )
          .join('') || '<p>Create or load a saved character before assigning it.</p>'
      }</fieldset></article>`
        )
        .join('') || '<p>No player invitations yet.</p>';
  }

  async _perform(operation) {
    if (this.busy) return;
    this.busy = true;
    this._controls();
    try {
      await operation();
    } catch (error) {
      this.status.textContent = error.message;
      GameErrors.input(error, { component: 'CampaignSharingPanel', operation: 'sharing' });
      await this.render().catch((refreshError) =>
        GameErrors.input(refreshError, {
          component: 'CampaignSharingPanel',
          operation: 'refreshAfterError',
        })
      );
    } finally {
      this.busy = false;
      this._controls();
    }
  }

  _controls() {
    for (const control of this.root.querySelectorAll('input,button'))
      control.disabled = this.busy || control.hasAttribute('data-static-disabled');
  }

  destroy() {
    for (const [element, inert] of this.previousInert || []) element.inert = inert;
    this.root.remove();
    this.previousFocus?.focus?.();
  }
}
