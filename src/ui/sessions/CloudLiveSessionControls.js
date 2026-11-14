import CloudHostSessionUpdates from './CloudHostSessionUpdates.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export default class CloudLiveSessionControls {
  constructor({ gameManager, services, parent }) {
    const store = services.workspace.store;
    if (
      store.storageInfo?.kind !== 'cloud' ||
      ['getLiveSession', 'getParticipantAccess', 'controlLiveSession'].some(
        (method) => typeof store[method] !== 'function'
      )
    )
      throw new Error('Cloud live controls require the current owner campaign workspace');
    this.gameManager = gameManager;
    this.services = services;
    this.store = store;
    this.campaignId = services.campaign.id;
    this.phase = 'loading';
    this.busy = false;
    this.closed = false;
    this.root = document.createElement('section');
    this.root.setAttribute('aria-label', 'Cloud live game');
    this.root.innerHTML = `
      <strong>Live game</strong>
      <p>Only the campaign owner starts or pauses gameplay. Opening campaign preparation does not start a game.</p>
      <output role="status" aria-label="Cloud live game status">Checking live game...</output>
      <button type="button" data-cloud-live-start>Start live game</button>
      <button type="button" data-cloud-live-pause>Pause live game</button>
      <button type="button" data-cloud-live-keep>Keep game active</button>`;
    this.output = this.root.querySelector('[role="status"]');
    this.startButton = this.root.querySelector('[data-cloud-live-start]');
    this.pauseButton = this.root.querySelector('[data-cloud-live-pause]');
    this.keepButton = this.root.querySelector('[data-cloud-live-keep]');
    parent.append(this.root);
    this.startButton.addEventListener(
      'click',
      () => void this._perform('start', () => this._start())
    );
    this.pauseButton.addEventListener(
      'click',
      () => void this._perform('pause', () => this._pause())
    );
    this.keepButton.addEventListener(
      'click',
      () => void this._perform('keepActive', () => this._keepActive())
    );
    this.pageHide = () => {
      void this.close().catch((error) =>
        GameErrors.gameState(error, { component: 'CloudLiveSessionControls', operation: 'close' })
      );
    };
    window.addEventListener('pagehide', this.pageHide, { once: true });
    this.ready = this._perform('load', async () => {
      this.session = await store.getLiveSession(this.campaignId);
      this._assertOpen();
      this.phase = this.session.state === 'live' ? 'connecting' : 'paused';
      if (this.session.state === 'live') await this._connect();
    });
  }

  _render() {
    if (this.closed) return;
    const live =
      this.session?.state === 'live' &&
      !['paused', 'ended', 'denied', 'error'].includes(this.phase);
    this.startButton.disabled = this.busy || live;
    this.pauseButton.disabled = this.busy || !live;
    this.keepButton.disabled = this.busy || !live;
    this.root.setAttribute('aria-busy', String(this.busy));
    this.output.textContent =
      this.error ||
      (this.phase === 'paused'
        ? 'Game paused. Owner preparation remains separate from player gameplay.'
        : this.phase === 'ready'
          ? 'Live game active. Accepted actions or Keep game active renew inactivity.'
          : this.phase === 'reconnecting'
            ? 'Live connection interrupted. Reconciling current campaign state...'
            : 'Synchronizing the current live game...');
  }

  async _perform(operation, action) {
    if (this.closed || this.busy) return false;
    this.busy = true;
    this.error = null;
    this._render();
    try {
      await action();
      return true;
    } catch (error) {
      if (this.closed && error.name === 'AbortError') return false;
      this.error = error.message;
      GameErrors.input(error, { component: 'CloudLiveSessionControls', operation });
      return false;
    } finally {
      this.busy = false;
      this._render();
    }
  }

  async _flush() {
    await this.services.autosave.flush();
    await this.services.library.flush();
  }

  _assertOpen() {
    if (this.closed) throw new DOMException('The live-game controls closed.', 'AbortError');
  }

  async _connect() {
    await this.sharing?.close();
    this._assertOpen();
    const { access } = await this.store.getParticipantAccess(this.campaignId);
    this._assertOpen();
    this.sharing = new CloudHostSessionUpdates({
      gameManager: this.gameManager,
      services: this.services,
      parent: this.root,
      sessionId: this.session.sessionId,
      access,
      onStatus: (status) => {
        this.phase = status.phase;
        this._render();
      },
    });
    await this.sharing.ready;
    this._assertOpen();
    this.phase = 'ready';
  }

  async _start() {
    await this._flush();
    this._assertOpen();
    this.session = await this.store.getLiveSession(this.campaignId);
    this._assertOpen();
    if (this.session.state !== 'live')
      this.session = await this.store.controlLiveSession(this.campaignId, 'start', this.session);
    await this._connect();
  }

  async _pause() {
    await this._flush();
    this._assertOpen();
    this.session = await this.store.getLiveSession(this.campaignId);
    this._assertOpen();
    if (this.session.state === 'live')
      this.session = await this.store.controlLiveSession(this.campaignId, 'end', this.session);
    await this.sharing?.close();
    this.sharing = null;
    this.phase = 'paused';
    this._render();
    try {
      await this.store.finishBackupSession(this.campaignId);
    } catch (error) {
      throw new Error(`Game paused; the final JSON backup was not confirmed: ${error.message}`, {
        cause: error,
      });
    }
  }

  async _keepActive() {
    this.session = await this.store.getLiveSession(this.campaignId);
    this._assertOpen();
    if (this.session.state !== 'live')
      throw new Error('Start the live game before keeping it active.');
    this.session = await this.store.controlLiveSession(
      this.campaignId,
      'keep-active',
      this.session
    );
  }

  async close() {
    if (this.closing) return this.closing;
    this.closed = true;
    window.removeEventListener('pagehide', this.pageHide);
    this.root.remove();
    this.closing = this.sharing?.close() || Promise.resolve();
    return this.closing;
  }
}
