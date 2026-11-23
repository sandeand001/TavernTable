import CloudAssignedCharacterStore from '../../campaigns/CloudAssignedCharacterStore.js';
import SavedCharacterSheets from './PlayerCharacterSheets.js';
import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

const accessDenials = new Set([
  'campaign-not-found',
  'campaign-access-changed',
  'pilot-access-required',
  'account-disabled',
  'account-changed',
  'invalid-identity',
  'email-verification-required',
]);

export default class CloudAssignedCharacterSheets {
  constructor({ workspace, campaignId }) {
    const store = workspace?.store;
    if (
      store?.storageInfo?.kind !== 'cloud' ||
      typeof workspace.resources?.catalog !== 'function' ||
      [
        'getParticipantAccess',
        'readAssignedCharacters',
        'commitAssignedCharacters',
        'subscribeSave',
      ].some((method) => typeof store[method] !== 'function')
    )
      throw new Error('Assigned sheets require the current cloud workspace and scoped sheet store');
    this.workspace = workspace;
    this.store = store;
    this.campaignId = campaignId;
    this.identityValid = true;
    this.busy = false;
    this.destroyed = false;
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Assigned cloud character sheets');
    this.root.tabIndex = -1;
    this.root.innerHTML = `<div class="campaign-shell">
      <h2>Assigned character sheets</h2>
      <p>Read and edit only your assigned saved characters while online.
      These short requests do not start a live game or open a game stream.</p>
      <p>World, combat, movement and unassigned character data are not available here.</p>
      <output role="status" aria-label="Assigned sheet status"></output>
      <section data-assigned-roster aria-label="Assigned saved characters"></section>
      <button type="button" data-retry-assigned-save hidden>Retry original sheet save</button>
      <button type="button" data-refresh-assigned>Refresh assigned sheets</button>
      <p>After a rejected change, Refresh replaces unsaved local edits with the current saved sheets.</p>
      <button type="button" data-close-assigned>Close</button>
    </div>`;
    this.status = this.root.querySelector('output');
    this.roster = this.root.querySelector('[data-assigned-roster]');
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.dataset.assignedCharacter)
        void this._perform(async () => {
          if (!this.sheets) throw new Error('Refresh current assigned sheets before opening one.');
          const sheets = this.sheets;
          await sheets.open(button.dataset.assignedCharacter);
          if (!this.identityValid || navigator.onLine === false) {
            sheets.destroy();
            throw new Error('Reconnect with the original account and refresh assigned sheets.');
          }
        }, 'Opening the assigned saved sheet...');
      else if (button.hasAttribute('data-refresh-assigned'))
        void this._perform(() => this._load(), 'Refreshing current assigned sheets...');
      else if (button.hasAttribute('data-retry-assigned-save'))
        void this.store.retryPending().catch((error) => this._failure(error));
      else if (button.hasAttribute('data-close-assigned')) void this.destroy();
    });
    this.leaving = (event) => {
      if (!this.store.pending && !this.sheets?.library.pendingWrites) return;
      event.preventDefault();
      event.returnValue = '';
    };
    this.offline = () => {
      this._clearSheets();
      this.status.textContent = this.store.pending
        ? 'Offline. The original cloud save is unconfirmed; reconnect and retry it before closing.'
        : 'Offline. Sheet editing is closed; reconnect and refresh assigned sheets.';
      this._controls();
    };
    this.online = () => {
      this.status.textContent = this.store.pending
        ? 'Reconnected. Retry the original unconfirmed save before refreshing.'
        : 'Reconnected. Refresh current assigned sheets to continue.';
      this._controls();
    };
  }

  async _load() {
    if (!this.identityValid || navigator.onLine === false)
      throw new Error('Reconnect with the original account before loading assigned sheets.');
    if (this.store.pending)
      throw new Error('Resolve the original cloud save before refreshing assigned sheets.');
    if (!this.sheets?.library.failure) await this.sheets?.library.flush();
    const grant = await this.store.getParticipantAccess(this.campaignId);
    if (grant.access.role !== 'member')
      throw new Error('Current player membership is required for assigned sheets.');
    const state = await this.store.readAssignedCharacters(this.campaignId, grant.access);
    const catalog = await this.workspace.resources.catalog(state.campaign);
    if (!this.identityValid || navigator.onLine === false)
      throw new Error('Reconnect with the original account and refresh assigned sheets.');
    const store = new CloudAssignedCharacterStore({ store: this.store, access: state.access });
    if (this.sheets) {
      this.sheets.library.store = store;
      this.sheets.refresh(state);
    } else {
      this.sheets = new SavedCharacterSheets({
        state,
        catalog,
        store,
        onChanged: () => this._renderRoster(),
      });
    }
    this._renderRoster();
    this.status.textContent =
      'Assigned sheets are ready. World gameplay still requires a separate live game.';
  }

  _renderRoster() {
    if (!this.sheets) return;
    const characters = this.sheets.library.list();
    this.roster.innerHTML = characters.length
      ? characters
          .map(
            (character) =>
              `<button type="button" data-assigned-character="${escape(character.id)}">${escape(character.name)}</button>`
          )
          .join('')
      : '<p>No saved characters are currently assigned to this player seat.</p>';
    this._controls();
  }

  async _perform(operation, message) {
    if (this.busy) {
      this._failure(new Error('Finish the current assigned-sheet request first.'));
      return false;
    }
    this.busy = true;
    this.status.textContent = message;
    this._controls();
    try {
      await operation();
      return true;
    } catch (error) {
      this._failure(error);
      return false;
    } finally {
      this.busy = false;
      this._controls();
    }
  }

  _controls() {
    const saving = this.store.saveState?.phase === 'saving';
    for (const control of this.root.querySelectorAll('button'))
      control.disabled =
        this.busy ||
        saving ||
        (!control.hasAttribute('data-close-assigned') &&
          (!this.identityValid || navigator.onLine === false));
    const retry = this.root.querySelector('[data-retry-assigned-save]');
    retry.hidden = this.store.saveState?.phase !== 'uncertain';
    retry.disabled = retry.hidden || this.busy || !this.identityValid || navigator.onLine === false;
    this.root.setAttribute('aria-busy', String(this.busy || saving));
  }

  _failure(error) {
    if (accessDenials.has(error.code)) this._clearSheets();
    this.status.textContent = this.store.pending
      ? 'Unconfirmed cloud save. Keep this panel open and retry the original command. ' +
        error.message
      : error.message;
    GameErrors.input(error, {
      component: 'CloudAssignedCharacterSheets',
      operation: 'assignedSheets',
    });
  }

  _clearSheets() {
    this.sheets?.destroy();
    this.sheets = null;
    this.roster.innerHTML = '';
  }

  async open() {
    this.previousFocus = document.activeElement;
    this.previousInert = new Map(
      [...document.body.children].map((element) => [element, element.inert])
    );
    for (const element of this.previousInert.keys()) element.inert = true;
    document.body.append(this.root);
    this.stopSave = this.store.subscribeSave((state) => {
      if (state.phase === 'uncertain' || state.phase === 'failed') this._failure(state.error);
      else if (state.phase === 'saving')
        this.status.textContent = 'Saving assigned sheet online...';
      else if (state.phase === 'saved') this.status.textContent = 'Assigned sheet saved online.';
      this._controls();
    });
    const account = this.store.connection?.account;
    if (typeof account?.subscribe === 'function')
      this.stopIdentity = account.subscribe(
        (identity) => {
          this.identityValid = identity?.uid === this.store.uid && identity?.emailVerified === true;
          if (!this.identityValid)
            this._failure(
              Object.assign(
                new Error(
                  'The verified account changed. Reopen assigned sheets from the current account.'
                ),
                { code: 'account-changed' }
              )
            );
          this._controls();
        },
        (error) => {
          this.identityValid = false;
          this._clearSheets();
          this._failure(error);
          this._controls();
        }
      );
    window.addEventListener('beforeunload', this.leaving);
    window.addEventListener('offline', this.offline);
    window.addEventListener('online', this.online);
    this.root.focus();
    return this._perform(async () => {
      await this.workspace.active?.autosave?.flush();
      await this.workspace.active?.library?.flush();
      await this._load();
    }, 'Loading current assigned saved characters...');
  }

  async destroy() {
    if (this.destroyed) return true;
    if (this.busy || this.store.pending) {
      this._failure(new Error('Finish or recover the original cloud save before closing.'));
      return false;
    }
    try {
      await this.sheets?.library.flush();
    } catch (error) {
      this._failure(error);
      return false;
    }
    this.destroyed = true;
    this._clearSheets();
    this.stopSave?.();
    this.stopIdentity?.();
    window.removeEventListener('beforeunload', this.leaving);
    window.removeEventListener('offline', this.offline);
    window.removeEventListener('online', this.online);
    for (const [element, inert] of this.previousInert) element.inert = inert;
    this.root.remove();
    this.previousFocus?.focus?.();
    return true;
  }
}
