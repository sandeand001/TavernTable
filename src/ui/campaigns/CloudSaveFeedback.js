import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';

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
  constructor({ store }) {
    if (store?.storageInfo?.kind !== 'cloud' || typeof store.subscribeSave !== 'function')
      throw new Error('Cloud save feedback requires an explicit cloud campaign store');
    this.store = store;
    this.blocked = false;
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
    this.reopen.addEventListener('click', () => window.location.reload());
    this.retry.addEventListener('click', () => {
      void this.store.retryPending().catch((error) => {
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
        !['saving', 'error'].includes(this.autosaveState?.state)
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
      if (['saving', 'uncertain'].includes(phase))
        text =
          'Offline. Cloud save unconfirmed. Keep this tab open; reconnect and retry the same save.';
      else if (['failed', 'checkpoint'].includes(phase))
        text = 'Offline. Earlier changes were not saved. Reconnect before continuing.';
      else text = 'Offline. Cloud editing paused. No offline change was queued.';
    }
    this.status.textContent = text;
    this.retry.hidden = this.state.phase !== 'uncertain';
    this.retry.disabled = offline;
    this.reopen.hidden = phase !== 'failed';
    this.reopen.disabled = offline;
    this.root.setAttribute(
      'aria-busy',
      String(['saving', 'checkpoint', 'loading', 'exiting'].includes(phase))
    );
    this.setBlocked(this.exiting || offline || ['saving', 'uncertain', 'failed'].includes(phase));
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
