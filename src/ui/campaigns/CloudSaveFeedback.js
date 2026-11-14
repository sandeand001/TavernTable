import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import { CloudAccountError } from '../../campaigns/CloudAccount.js';
import { logger, LOG_LEVEL, LOG_CATEGORY } from '../../utils/logger/Logger.js';

const INPUT_EVENTS = [
  'pointerdown',
  'mousedown',
  'touchstart',
  'keydown',
  'click',
  'dblclick',
  'contextmenu',
  'submit',
  'drop',
  'input',
  'change',
];
const PHASE_MESSAGES = Object.freeze({
  idle: 'Cloud connected. No save pending.',
  saving: 'Saving to cloud...',
  checkpoint: 'Saving to cloud... Waiting for the completed scene checkpoint.',
  saved: 'Saved to cloud',
  loading: 'Restoring campaign...',
  exiting: 'Finishing cloud saves before leaving...',
});

export default class CloudSaveFeedback {
  constructor({ store, hasUnconfirmedCommand = () => false, retryUnconfirmedCommand = null }) {
    if (store?.storageInfo?.kind !== 'cloud' || typeof store.subscribeSave !== 'function')
      throw new Error('Cloud save feedback requires an explicit cloud campaign store');
    this.store = store;
    this.hasUnconfirmedCommand = hasUnconfirmedCommand;
    this.blocked = false;
    this.recoveryRequired = false;
    this.identityInvalidated = false;
    this.exiting = false;
    this.previousInert = new Map();
    this.root = document.createElement('section');
    this.root.className = 'cloud-save-feedback';
    this.root.setAttribute('role', 'region');
    this.root.setAttribute('aria-label', 'Cloud save feedback');
    this.root.tabIndex = -1;
    this.root.innerHTML = `
      <div class="cloud-save-card">
        <output role="status" aria-label="Cloud save status"></output>
        <button type="button" hidden>Retry same save</button>
        <button type="button" data-save-reopen hidden>Reopen cloud version</button>
      </div>`;
    this.status = this.root.querySelector('output');
    this.retry = this.root.querySelector('button');
    this.reopen = this.root.querySelector('[data-save-reopen]');
    this.reopen.addEventListener('click', () => {
      if (this.store.pending || this.hasUnconfirmedCommand()) return;
      window.location.reload();
    });
    this.retry.addEventListener('click', () => {
      void Promise.resolve()
        .then(() => {
          if (this.state.phase === 'uncertain') return this.store.retryPending();
          if (this.hasUnconfirmedCommand() && typeof retryUnconfirmedCommand === 'function')
            return retryUnconfirmedCommand();
          throw new Error('There is no original unconfirmed cloud command to recover.');
        })
        .then(() => {
          this.recoveryConfirmed = true;
          this.render();
        })
        .catch((error) => {
          new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
            component: 'CloudSaveFeedback',
            operation: 'retrySave',
          });
        });
    });
    this.blockInput = (event) => {
      if (!this.blocked || (event.target instanceof Node && this.root.contains(event.target)))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    for (const type of INPUT_EVENTS)
      this.root.addEventListener(type, (event) => {
        if (this.blocked) event.stopPropagation();
      });
    this.leaving = (event) => {
      if (
        !['saving', 'uncertain', 'failed'].includes(this.state?.phase) &&
        !['saving', 'error'].includes(this.autosaveState?.state) &&
        !this.hasUnconfirmedCommand()
      )
        return;
      event.preventDefault();
      event.returnValue = '';
    };
    this.onConnectivityChange = () => this.render();
    this.onPageHide = () => this.dispose();
  }

  attach() {
    if (this.stopSave) throw new Error('Cloud save feedback is already attached');
    document.body.append(this.root);
    this.stopSave = this.store.subscribeSave((state) => {
      this.state = state;
      this.render();
    });
    this.stopPrivateInvalidation = this.store.connection?.subscribePrivateInvalidation?.((uid) => {
      if (uid === this.store.uid) this.invalidateIdentity();
    });
    for (const type of INPUT_EVENTS)
      window.addEventListener(type, this.blockInput, { capture: true, passive: false });
    window.addEventListener('beforeunload', this.leaving);
    window.addEventListener('online', this.onConnectivityChange);
    window.addEventListener('offline', this.onConnectivityChange);
    window.addEventListener('pagehide', this.onPageHide, { once: true });
    return this;
  }

  bindAutosave(autosave) {
    if (typeof autosave?.subscribe !== 'function')
      throw new Error('Cloud scene feedback requires the campaign save coordinator');
    this.stopAutosave?.();
    this.stopAutosave = autosave.subscribe((state) => {
      this.autosaveState = state;
      this.render();
    });
    return this;
  }

  async pauseForExit(operation) {
    if (typeof operation !== 'function')
      throw new Error('A safe cloud exit requires its account or campaign operation');
    if (this.exiting) throw new Error('Finish the current cloud exit before leaving again');
    this.exiting = true;
    this.render();
    try {
      return await operation();
    } finally {
      this.exiting = false;
      this.render();
    }
  }

  invalidateIdentity() {
    this.identityInvalidated = true;
    this.recoveryRequired = true;
    for (const element of document.body.children) if (element !== this.root) element.hidden = true;
    this.root.hidden = false;
    this.render();
  }

  reconciled() {
    if (this.identityInvalidated || navigator.onLine === false || this.store.pending) return;
    this.recoveryRequired = false;
    this.render();
  }

  render() {
    let phase = this.state.phase;
    if (!['saving', 'uncertain', 'failed'].includes(phase) && this.autosaveState)
      phase =
        this.autosaveState.state === 'error'
          ? 'failed'
          : this.autosaveState.state === 'saving'
            ? 'checkpoint'
            : this.autosaveState.state;
    if (this.exiting && ['idle', 'saved'].includes(phase)) phase = 'exiting';
    const offline = navigator.onLine === false;
    const commandPending = this.hasUnconfirmedCommand();
    if (offline) this.recoveryRequired = true;
    let originalIdentity = true;
    let identityUnavailable = false;
    if (this.identityInvalidated) {
      try {
        const identity = this.store.connection.account.identity();
        originalIdentity = identity?.uid === this.store.uid && identity.emailVerified === true;
      } catch (error) {
        if (!(error instanceof CloudAccountError)) {
          logger.log(
            LOG_LEVEL.ERROR,
            'Cloud recovery identity checking failed',
            LOG_CATEGORY.SYSTEM,
            {
              component: 'CloudSaveFeedback',
              code: 'identity-check-failed',
              kind: error instanceof Error ? 'error' : 'non-error',
            }
          );
          throw error;
        }
        logger.log(LOG_LEVEL.WARN, 'Cloud recovery identity is unavailable', LOG_CATEGORY.SYSTEM, {
          component: 'CloudSaveFeedback',
          code: 'identity-unavailable',
        });
        identityUnavailable = true;
        originalIdentity = false;
      }
    }
    this.status.dataset.saveState = offline ? 'offline' : phase === 'checkpoint' ? 'saving' : phase;
    let text = PHASE_MESSAGES[phase];
    if (phase === 'uncertain')
      text = `Unconfirmed cloud save. Keep this tab open and retry the same save. ${this.state.error.message}`;
    if (phase === 'failed') {
      const error = this.state.error
        ? `Not saved: ${this.state.error.message}`
        : this.autosaveState.text;
      text = `${error} Reopening loads the cloud version and discards unsaved local changes.`;
    }
    if (typeof text !== 'string') throw new Error('Unsupported cloud save feedback state');
    if (offline) {
      if (['saving', 'uncertain'].includes(phase) || commandPending)
        text =
          'Offline. Cloud save unconfirmed. Keep this tab open; reconnect and retry the same save.';
      else if (['failed', 'checkpoint'].includes(phase))
        text = 'Offline. Earlier changes were not saved. Reconnect before continuing.';
      else text = 'Offline. Cloud editing paused. No offline change was queued.';
    }
    if (identityUnavailable)
      text =
        'The original account could not be verified. Keep this tab open and restore verified account access before recovering the original save.';
    else if (!originalIdentity)
      text =
        'Account changed. The private view is cleared. Sign in to the original account in another tab to recover any unconfirmed save.';
    else if (this.recoveryRequired && commandPending && !offline)
      text =
        'The original command is unconfirmed. Keep this tab open for current online state and same-command recovery.';
    else if (this.recoveryRequired && !offline && !this.store.pending)
      text =
        phase === 'saved' || this.recoveryConfirmed
          ? 'Original save confirmed. Reopen the current cloud version before editing.'
          : 'Reopen the current cloud version and verify account access before editing.';
    this.status.textContent = text;
    this.retry.hidden = this.state.phase !== 'uncertain' && !commandPending;
    this.retry.disabled = offline || !originalIdentity;
    this.reopen.hidden =
      commandPending || (phase !== 'failed' && !(this.recoveryRequired && !this.store.pending));
    this.reopen.disabled = offline || !originalIdentity || !!this.store.pending || commandPending;
    this.root.setAttribute(
      'aria-busy',
      String(['saving', 'checkpoint', 'loading', 'exiting'].includes(phase))
    );
    this.setBlocked(
      this.exiting ||
        offline ||
        this.recoveryRequired ||
        ['saving', 'uncertain', 'failed'].includes(phase)
    );
  }

  setBlocked(blocked) {
    if (blocked === this.blocked) return;
    this.blocked = blocked;
    this.root.dataset.blocked = String(blocked);
    if (blocked) {
      this.previousFocus = document.activeElement;
      this.rootWasInert = !!this.root.inert;
      for (const element of document.body.children) {
        if (element === this.root) continue;
        this.previousInert.set(element, !!element.inert);
        element.inert = true;
      }
      this.root.inert = false;
      this.root.setAttribute('role', 'dialog');
      this.root.setAttribute('aria-modal', 'true');
      this.root.focus();
    } else {
      for (const [element, inert] of this.previousInert) element.inert = inert;
      this.previousInert.clear();
      this.root.inert = this.rootWasInert;
      this.root.setAttribute('role', 'region');
      this.root.removeAttribute('aria-modal');
      if (this.previousFocus?.isConnected && !this.previousFocus.inert) this.previousFocus.focus();
    }
  }

  dispose() {
    this.stopSave?.();
    this.stopAutosave?.();
    this.stopPrivateInvalidation?.();
    this.stopSave = null;
    this.stopAutosave = null;
    this.setBlocked(false);
    for (const type of INPUT_EVENTS) window.removeEventListener(type, this.blockInput, true);
    window.removeEventListener('beforeunload', this.leaving);
    window.removeEventListener('online', this.onConnectivityChange);
    window.removeEventListener('offline', this.onConnectivityChange);
    window.removeEventListener('pagehide', this.onPageHide);
    this.root.remove();
  }
}
