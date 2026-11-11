import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

export function downloadCampaignJSON(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${name.replace(/[^a-z0-9._-]/gi, '-') || 'campaign'}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default class CampaignBackupPanel {
  constructor({ workspace, campaignId, onRestored = () => {} }) {
    this.workspace = workspace;
    this.campaignId = campaignId;
    this.onRestored = onRestored;
    this.busy = false;
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Campaign JSON backups');
    this.root.innerHTML = `<div class="campaign-shell">
      <h2>Campaign JSON backups</h2>
      <p>Automatic snapshots preserve committed campaign, character and board data.
      Restore creates a separate campaign; it never replaces the current one.</p>
      <output role="status" aria-label="JSON backup status"></output>
      <div><button type="button" data-backup-now>Back up now</button>
      <button type="button" data-close-backups>Close</button></div>
      <div data-backup-list></div></div>`;
    this.status = this.root.querySelector('output');
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-close-backups')) {
        if (!this.busy) this.destroy();
        return;
      }
      if (button.hasAttribute('data-backup-now'))
        void this._perform(async () => {
          await this.workspace.backupNow(this.campaignId);
          await this.render();
        });
      if (button.dataset.restoreBackup)
        void this._perform(async () => {
          const restored = await this.workspace.restoreBackup(
            this.campaignId,
            button.dataset.restoreBackup
          );
          await this.onRestored(restored);
          this.status.textContent = `Restored ${restored.name} as a separate campaign. Open it from Campaigns; the current campaign is unchanged.`;
        });
      if (button.dataset.downloadBackup)
        void this._perform(async () => {
          const text = await this.workspace.store.readBackup(
            this.campaignId,
            button.dataset.downloadBackup
          );
          downloadCampaignJSON(
            text,
            `campaign-${this.campaignId}-${button.dataset.downloadBackup.replace(/\.json$/, '')}`
          );
        });
    });
  }

  open() {
    this.previousFocus = document.activeElement;
    this.previousInert = new Map(
      [...document.body.children].map((element) => [element, element.inert])
    );
    for (const element of this.previousInert.keys()) element.inert = true;
    document.body.append(this.root);
    this.root.querySelector('button').focus();
    return this._perform(() => this.render());
  }

  async render() {
    const [state, records] = await Promise.all([
      this.workspace.store.backupStatus(this.campaignId),
      this.workspace.store.listBackups(this.campaignId),
    ]);
    this.status.textContent = state.error
      ? `Primary saves are separate. JSON backup failed: ${state.error}`
      : `Automatic backup every ${state.intervalMs / 60000} minutes when changed; ${state.retain} snapshots retained. ${state.latest ? `Latest: ${new Date(state.latest.createdAt).toLocaleString()}.` : 'No JSON snapshot yet.'}`;
    this.root.querySelector('[data-backup-list]').innerHTML =
      records
        .map(
          (record) =>
            `<article><strong>${escape(new Date(record.createdAt).toLocaleString())}</strong>
      <span>${Math.ceil(record.bytes / 1024)} KiB</span>
      <button type="button" data-download-backup="${escape(record.name)}">Download JSON</button>
      <button type="button" data-restore-backup="${escape(record.name)}">Restore as copy</button></article>`
        )
        .join('') || '<p>No JSON backups yet. Use Back up now to create the first one.</p>';
  }

  async _perform(operation) {
    if (this.busy) return;
    this.busy = true;
    for (const button of this.root.querySelectorAll('button')) button.disabled = true;
    try {
      await operation();
    } catch (error) {
      this.status.textContent = `JSON backup operation failed: ${error.message}`;
      GameErrors.gameState(error, { component: 'CampaignBackupPanel', operation: 'backup' });
    } finally {
      this.busy = false;
      for (const button of this.root.querySelectorAll('button')) button.disabled = false;
    }
  }

  destroy() {
    for (const [element, inert] of this.previousInert || []) element.inert = inert;
    this.root.remove();
    this.previousFocus?.focus?.();
  }
}
