import CampaignWorkspace from '../../campaigns/CampaignWorkspace.js';
import { edition, supportedEditions } from '../../rules/editions.js';
import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';
import CampaignMapControls from './CampaignMapControls.js';
import CampaignTraversalPopup from './CampaignTraversalPopup.js';
import CampaignBackupPanel, { downloadCampaignJSON } from './CampaignBackupPanel.js';
import CampaignSharingPanel from './CampaignSharingPanel.js';
import CloudCampaignInvitations from './CloudCampaignInvitations.js';
import { ensureSession } from '../sessions/SessionLogin.js';
import { attachHostSessionUpdates } from '../sessions/HostSessionUpdates.js';
import { CLOUD_BACKUP_BYTE_LIMIT } from '../../campaigns/CloudProtocol.js';
import { campaignBackupByteLength } from '../../campaigns/CampaignBackupBytes.js';
import CloudAccountMethods from '../sessions/CloudAccountMethods.js';
import CloudAssignedCharacterSheets from '../sessions/CloudAssignedCharacterSheets.js';
import CloudPlayerSessionConnection from '../../campaigns/CloudPlayerSessionConnection.js';
import CloudLiveSessionControls from '../sessions/CloudLiveSessionControls.js';

export default class CampaignLauncher {
  constructor({ workspace = null, saveFeedback = null } = {}) {
    this.workspace = workspace;
    this.saveFeedback = saveFeedback;
    this.busy = false;
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-labelledby', 'campaign-picker-title');
    this.root.innerHTML = `
      <div class="campaign-shell">
        <header><span class="campaign-eyebrow">TavernTable</span>
          <h1 id="campaign-picker-title">Choose your campaign</h1>
          <p>Separate adventures, separate characters, and the rules you choose.</p>
        </header>
        <p class="campaign-status" role="status" aria-label="Campaign status">Loading local campaigns...</p>
        <p data-cloud-account hidden></p>
        <button type="button" data-cloud-account-signout hidden>Sign out</button>
        <button type="button" data-cloud-account-methods hidden>Sign-in methods</button>
        <button type="button" data-campaign-retry hidden>Retry loading campaigns</button>
        <div class="campaign-columns">
          <section aria-label="Saved campaigns">
            <h2>Open a campaign</h2>
            <div class="campaign-list"></div>
            <section class="campaign-browser-import" aria-label="Browser-only campaigns" hidden>
              <h3>Browser-only campaigns</h3>
              <p>Copy these to host storage for durable saves. The browser originals are not removed.</p>
              <div data-browser-campaigns></div>
            </section>
            <button type="button" data-campaign-import>Import campaign backup</button>
            <input type="file" accept=".json,application/json" aria-label="Import campaign JSON" hidden>
          </section>
          <form aria-label="Create campaign" novalidate>
            <h2>Create a campaign</h2>
            <label>Campaign name<input aria-label="Campaign name" maxlength="100" required autocomplete="off"></label>
            <label>Ruleset<select aria-label="Campaign ruleset" required>
              <option value="">Choose 2014 or 2024</option>
              ${supportedEditions.map((profile) => `<option value="${profile.id}">${profile.name} rules / SRD ${profile.srd}</option>`).join('')}
            </select></label>
            <p class="campaign-hint">The ruleset is fixed when you create the campaign. It selects a separate rules engine and resource database.</p>
            <fieldset class="campaign-source-packs"><legend>Content sources</legend><div data-create-packs></div></fieldset>
            <button type="submit">Create &amp; open campaign</button>
          </form>
        </div>
        <form class="campaign-settings" aria-label="Campaign source settings" novalidate hidden>
          <h2>Campaign settings</h2>
          <label>Name<input aria-label="Rename campaign" maxlength="100" required></label>
          <p data-settings-ruleset></p>
          <fieldset class="campaign-source-packs"><legend>Enabled sources</legend><div data-settings-packs></div></fieldset>
          <p class="campaign-hint">Disabling a source prevents new additions. Already-owned content, layouts and pinned source versions are preserved.</p>
          <button type="submit">Save campaign settings</button>
          <button type="button" data-settings-cancel>Close settings</button>
        </form>
        <section class="campaign-backup" aria-label="Campaign backup export" hidden>
          <h2>Campaign JSON backup</h2>
          <p>Settings, characters, resources, layouts, terrain, placed creatures and committed combat state are included. Bundled catalog databases are not.</p>
          <textarea aria-label="Campaign JSON backup" rows="8" readonly spellcheck="false"></textarea>
          <button type="button" data-campaign-download>Download JSON</button>
          <button type="button" data-backup-close>Close backup</button>
        </section>
        <footer><span data-campaign-storage>Checking campaign storage...</span>
          <span data-campaign-storage-help>Export JSON for an independent backup. Opening a campaign restores its automatically saved board.</span>
          <a href="assets/data/resources/NOTICES.txt" target="_blank" rel="noopener">Sources &amp; licenses</a>
        </footer>
      </div>`;
    this.status = this.root.querySelector('[role="status"]');
    this.list = this.root.querySelector('.campaign-list');
    this.createForm = this.root.querySelector('[aria-label="Create campaign"]');
    this.name = this.root.querySelector('[aria-label="Campaign name"]');
    this.ruleset = this.root.querySelector('[aria-label="Campaign ruleset"]');
    this.settings = this.root.querySelector('.campaign-settings');
    this.settingsName = this.root.querySelector('[aria-label="Rename campaign"]');
    this.settingsBase = null;
    this.backup = this.root.querySelector('.campaign-backup');
    this.backupText = this.root.querySelector('textarea');
    this.backupData = null;
    this.importFile = this.root.querySelector('input[type="file"]');
    this.retry = this.root.querySelector('[data-campaign-retry]');
    this.root.querySelector('[data-cloud-account-signout]').addEventListener(
      'click',
      () =>
        void this._perform(async () => {
          if (!this.saveFeedback) throw new Error('Cloud save coordination is not ready');
          await this.saveFeedback.pauseForExit(async () => {
            const ended = await this.workspace.finishSession();
            if (ended.backupError)
              this.status.textContent =
                'Primary saves completed; the final JSON backup was not confirmed.';
            await this.workspace.store.connection.account.signOut();
          });
        }, 'Signing out of this account...')
    );
    this.root.querySelector('[data-cloud-account-methods]').addEventListener('click', () => {
      void this._perform(
        () => new CloudAccountMethods({ account: this.workspace.store.connection.account }).open(),
        'Opening current sign-in methods...'
      );
    });
    this.ruleset.addEventListener('change', () =>
      this._sources(this.root.querySelector('[data-create-packs]'), this.ruleset.value)
    );
    this.createForm.addEventListener('submit', (event) => {
      event.preventDefault();
      void this._perform(async () => {
        const campaign = await this.workspace.create({
          name: this.name.value,
          ruleset: this.ruleset.value,
          packIds: this._selectedPacks(this.createForm),
        });
        await this._renderSaved();
        await this._open(campaign.id);
      }, 'Creating campaign and installing its bundled resources...');
    });
    this.settings.addEventListener('submit', (event) => {
      event.preventDefault();
      void this._perform(async () => {
        const base = this.settingsBase;
        const campaign = await this.workspace.update(
          this.settingsId,
          {
            name: this.settingsName.value,
            packIds: this._selectedPacks(this.settings),
          },
          base
        );
        if (base) this.settingsBase = { ...base, generation: base.generation + 1, campaign };
        this.settingsName.value = campaign.name;
        await this._renderSaved();
        this.status.textContent =
          'Campaign settings saved. Existing characters and source version pins were preserved.';
      }, 'Saving campaign settings...');
    });
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const id = button.closest('[data-campaign-id]')?.dataset.campaignId;
      if (button.hasAttribute('data-open-campaign'))
        void this._perform(() => this._open(id), 'Opening the selected campaign...');
      if (button.hasAttribute('data-open-cloud-game'))
        void this._perform(() => this._openJoined(id), 'Joining the current live game...');
      if (button.hasAttribute('data-open-assigned-sheets'))
        void this._perform(
          () =>
            new CloudAssignedCharacterSheets({ workspace: this.workspace, campaignId: id }).open(),
          'Loading current assigned saved characters...'
        );
      if (button.hasAttribute('data-cloud-invitations'))
        void new CloudCampaignInvitations({
          workspace: this.workspace,
          campaignId: id,
        }).open();
      if (button.hasAttribute('data-view-campaign-access'))
        void this._perform(async () => {
          await this._renderSaved();
          const access = await this.workspace.store.getParticipantAccess(id);
          if (access.access.role !== 'member')
            throw new Error('Campaign access changed. Refresh the campaign picker.');
          this.status.textContent =
            `Joined ${access.campaign.name} as a player. ` +
            `${access.characterIds.length} assigned saved character${access.characterIds.length === 1 ? '' : 's'}. ` +
            (this.workspace.store.capabilities?.sharedSessions === true
              ? 'Use Join live game when the owner has started gameplay. No private owner data was opened.'
              : 'Cloud player gameplay is not enabled yet; no private owner data was opened.');
        }, 'Checking current player access...');
      if (button.hasAttribute('data-edit-campaign'))
        void this._perform(() => this._edit(id), 'Loading campaign settings...');
      if (button.hasAttribute('data-export-campaign'))
        void this._perform(() => this._export(id), 'Preparing campaign backup...');
      if (button.hasAttribute('data-campaign-backups'))
        void new CampaignBackupPanel({
          workspace: this.workspace,
          campaignId: id,
          onRestored: () => this._renderSaved(),
        }).open();
      if (button.hasAttribute('data-copy-browser-campaign'))
        void this._perform(async () => {
          await this.workspace.copyBrowserCampaign(button.dataset.copyBrowserCampaign);
          await this._renderSaved();
          this.status.textContent =
            'Copied the browser campaign to durable host storage. The original is unchanged.';
        }, 'Copying the browser campaign to the host...');
      if (button.hasAttribute('data-campaign-import')) this.importFile.click();
      if (button.hasAttribute('data-settings-cancel')) this.settings.hidden = true;
      if (button.hasAttribute('data-backup-close')) {
        this.backup.hidden = true;
        this.backupData = null;
        this.backupText.value = '';
      }
      if (button.hasAttribute('data-campaign-download')) this._download();
      if (button.hasAttribute('data-campaign-retry')) this.ready = this._load();
    });
    this.importFile.addEventListener('change', () => {
      const file = this.importFile.files?.[0];
      if (!file) return;
      void this._perform(async () => {
        const cloud = this.workspace.store.storageInfo?.kind === 'cloud';
        const maximum = cloud ? CLOUD_BACKUP_BYTE_LIMIT : 32000000;
        if (file.size > maximum)
          throw new Error(
            cloud
              ? 'Cloud campaign files must not exceed 128,000,000 UTF-8 bytes'
              : 'Campaign backups must be smaller than 32 MB'
          );
        const text = await this._readBackupFile(file, cloud);
        const campaign = await this.workspace.importBackup(text);
        await this._renderSaved();
        this.status.textContent = `Imported ${campaign.name} as a separate ${campaign.ruleset} campaign.`;
      }, 'Validating and importing campaign backup...').finally(() => {
        this.importFile.value = '';
      });
    });
  }

  async _readBackupFile(file, cloud) {
    if (!cloud) {
      if (typeof file.text === 'function') return file.text();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsText(file);
      });
    }
    const bytes =
      typeof file.arrayBuffer === 'function'
        ? await file.arrayBuffer()
        : await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.onabort = () => reject(new Error('Campaign file reading was cancelled'));
            reader.readAsArrayBuffer(file);
          });
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (error) {
      if (error instanceof TypeError || error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA')
        throw new Error('Choose a complete campaign file encoded as valid UTF-8 JSON');
      throw error;
    }
  }

  choose() {
    this.previousInert = new Map(
      [...document.body.children].map((element) => [element, element.inert])
    );
    for (const element of this.previousInert.keys()) element.inert = true;
    document.body.append(this.root);
    const choice = new Promise((resolve) => {
      this.resolve = resolve;
    });
    this.ready = this._load();
    return choice;
  }

  async _load() {
    const loaded = await this._perform(
      async () => {
        if (!this.workspace) {
          const identity = await ensureSession();
          if (identity.role === 'player') {
            window.location.replace(new URL('player.html', location.href).href);
            return;
          }
          this.workspace = await CampaignWorkspace.load();
        }
        const location = this.workspace.store.storageInfo;
        this.root.querySelector('[data-campaign-storage]').textContent =
          location?.kind === 'cloud'
            ? location.label
            : location?.kind === 'host'
              ? `Campaigns are saved on this host computer: ${location.dataDirectory}. Chrome and VS Code use the same host saves.`
              : 'Browser-only storage: temporary or isolated browser sessions can lose campaigns when the browser closes.';
        const cloud = location?.kind === 'cloud';
        const account = this.root.querySelector('[data-cloud-account]');
        account.hidden = !cloud;
        account.textContent = cloud
          ? `Signed in as ${this.workspace.store.connection.account.identity()?.email || 'your managed account'}.`
          : '';
        this.root.querySelector('[data-cloud-account-signout]').hidden = !cloud;
        this.root.querySelector('[data-cloud-account-methods]').hidden =
          !cloud || typeof this.workspace.store.connection.account.linkSignInMethod !== 'function';
        this.root.querySelector('[data-campaign-import]').hidden = !(
          this.workspace.store.capabilities?.portability ??
          this.workspace.store.capabilities?.backups !== false
        );
        this.root.querySelector('[data-campaign-storage-help]').textContent = cloud
          ? this.workspace.store.capabilities?.sharedSessions === true
            ? 'Prepare owned campaigns or edit assigned characters between games. The owner explicitly starts live gameplay; players then join only their authorized world view.'
            : 'Private cloud preparation and assigned online sheets are available between games. Complete rolling backups, restore-as-copy, import/export, invitations, assignments and settings are available; world gameplay and live-session transport remain gated.'
          : 'Export JSON for an independent backup. Opening a campaign restores its automatically saved board.';
        await this._renderSaved();
        this._sources(this.root.querySelector('[data-create-packs]'), this.ruleset.value);
        this.retry.hidden = true;
        this.status.textContent = 'Choose a saved campaign or create a new one.';
      },
      this.workspace?.store.storageInfo?.kind === 'cloud'
        ? 'Loading private cloud campaigns...'
        : 'Loading local campaigns...'
    );
    if (loaded) this.name.focus();
    return loaded;
  }

  async _renderSaved() {
    const cloud = this.workspace.store.storageInfo?.kind === 'cloud';
    const capabilities = this.workspace.store.capabilities;
    const portable = capabilities?.portability ?? capabilities?.backups !== false;
    const row = (campaign, role = null) => {
      const profile = edition(campaign.ruleset);
      const sources = cloud
        ? ` / ${role === 'owner' ? 'Owner' : 'Player'}`
        : ` / ${campaign.sourcePacks.filter((source) => source.enabled).length} enabled sources`;
      return `<article data-campaign-id="${escape(campaign.id)}">
        <h3>${escape(campaign.name)}</h3>
        <p>${profile.name} rules / SRD ${profile.srd}${sources}</p>
        <div class="campaign-row-actions">
          ${role === 'member' ? '<button type="button" data-view-campaign-access>View player access</button>' : '<button type="button" data-open-campaign>Open</button>'}
          ${role === 'member' && capabilities?.sharedSessions === true ? '<button type="button" data-open-cloud-game>Join live game</button>' : ''}
          ${role === 'member' && capabilities?.assignedSheets === true ? '<button type="button" data-open-assigned-sheets>Assigned characters</button>' : ''}
          ${cloud && role === 'owner' && capabilities?.invitations === true ? '<button type="button" data-cloud-invitations>Player invitations</button>' : ''}
          ${capabilities?.settings !== false && (!cloud || role === 'owner') ? '<button type="button" data-edit-campaign>Sources &amp; settings</button>' : ''}
          ${portable && (!cloud || role === 'owner') ? '<button type="button" data-export-campaign>Export</button>' : ''}
          ${capabilities?.backups !== false && this.workspace.store.listBackups && (!cloud || role === 'owner') ? '<button type="button" data-campaign-backups>JSON backups</button>' : ''}
        </div></article>`;
    };
    if (cloud) {
      const directory = await this.workspace.store.listAccess();
      this.list.innerHTML = ['owned', 'joined']
        .map(
          (group) => `<section data-campaign-group="${group}">
            <h3>${group === 'owned' ? 'Owned campaigns' : 'Joined campaigns'}</h3>
            ${
              directory[group].map((access) => row(access.campaign, access.role)).join('') ||
              `<p class="campaign-empty">${group === 'owned' ? 'No owned campaigns yet.' : 'No joined campaigns yet.'}</p>`
            }
          </section>`
        )
        .join('');
    } else {
      this.list.innerHTML =
        (await this.workspace.list()).map((campaign) => row(campaign)).join('') ||
        '<p class="campaign-empty">No campaigns saved in this storage location yet.</p>';
    }
    const browserCampaigns =
      capabilities?.browserImport === false
        ? []
        : (await this.workspace.browserCampaigns?.()) || [];
    this.root.querySelector('.campaign-browser-import').hidden = browserCampaigns.length === 0;
    this.root.querySelector('[data-browser-campaigns]').innerHTML = browserCampaigns
      .map(
        (campaign) =>
          `<article><strong>${escape(campaign.name)}</strong> (${escape(campaign.ruleset)})
      <button type="button" data-copy-browser-campaign="${escape(campaign.id)}">Copy to host</button></article>`
      )
      .join('');
  }

  _sources(host, ruleset, enabled = []) {
    if (!ruleset) {
      host.textContent = 'Choose a ruleset to see its compatible sources.';
      return;
    }
    const profile = edition(ruleset);
    const sources = this.workspace.manifest.packs.filter((source) => source.ruleset === ruleset);
    host.innerHTML = sources
      .map(
        (source) => `<label class="campaign-pack">
      <input type="checkbox" data-pack-id="${escape(source.id)}"
        ${source.core ? 'data-core-pack disabled checked' : enabled.includes(source.id) ? 'checked' : ''}>
      <span>${escape(source.name)}${source.core ? ' (required core)' : ''}
        <small>${source.count} entries / ${escape(source.licenses.join(', '))}</small></span>
    </label>`
      )
      .join('');
    if (!sources.some((source) => !source.core)) {
      const note = document.createElement('p');
      note.className = 'campaign-hint';
      note.textContent = `No validated supplemental ${profile.name} packs are currently bundled. Other editions and alternate game systems are not offered here.`;
      host.append(note);
    }
  }

  _selectedPacks(form) {
    return [...form.querySelectorAll('[data-pack-id]:checked')].map(
      (input) => input.dataset.packId
    );
  }

  async _open(id) {
    const services = await this.workspace.open(id);
    this.resolve(services);
    this.destroy();
  }

  async _openJoined(id) {
    const store = this.workspace.store;
    const { access } = await store.getParticipantAccess(id);
    if (access.role !== 'member')
      throw new Error('Campaign access changed. Refresh the campaign picker.');
    const session = await store.getLiveSession(id);
    if (session.state !== 'live')
      throw new Error(
        'The game is paused. The campaign owner must start live gameplay before you join.'
      );
    const connection = new CloudPlayerSessionConnection({
      store,
      campaignId: id,
      access,
      sessionId: session.sessionId,
    });
    try {
      const initialState = await connection.open();
      this.resolve({
        role: 'player',
        connection,
        identity: initialState.profile,
        initialState,
      });
      this.destroy();
    } catch (error) {
      await connection.close();
      throw error;
    }
  }

  async _edit(id) {
    const cloud = this.workspace.store.storageInfo?.kind === 'cloud';
    this.settingsBase = cloud ? await this.workspace.store.getSettings(id) : null;
    const campaign = cloud ? this.settingsBase.campaign : await this.workspace.store.get(id);
    this.settingsId = id;
    this.settingsName.value = campaign.name;
    this.settings.querySelector('[data-settings-ruleset]').textContent =
      `${campaign.ruleset} rules / SRD ${campaign.coreVersion}. The ruleset cannot be changed.`;
    this._sources(
      this.settings.querySelector('[data-settings-packs]'),
      campaign.ruleset,
      campaign.sourcePacks.filter((source) => source.enabled).map((source) => source.id)
    );
    this.settings.hidden = false;
    this.settings.scrollIntoView?.({ block: 'nearest' });
    this.status.textContent = 'Adjust compatible content sources or rename this campaign.';
  }

  async _export(id) {
    const text = await this.workspace.exportBackup(id);
    this.backupName = (await this.workspace.store.get(id)).name;
    const large =
      this.workspace.store.storageInfo?.kind === 'cloud' &&
      campaignBackupByteLength(text) > 1024 * 1024;
    this.backupData = text;
    this.backupText.value = large ? '' : text;
    this.backupText.hidden = large;
    this.backup.hidden = false;
    if (large) this.root.querySelector('[data-campaign-download]').focus();
    else {
      this.backupText.focus();
      this.backupText.select();
    }
    this.status.textContent = large
      ? 'Backup ready. Download the complete JSON file; large backups are not expanded in the preview.'
      : 'Backup ready. Download JSON or copy the text below.';
  }

  _download() {
    if (typeof this.backupData !== 'string') {
      this._failure(new Error('Prepare a complete campaign backup before downloading'));
      return;
    }
    downloadCampaignJSON(this.backupData, this.backupName);
  }

  async _perform(operation, message) {
    if (this.busy) {
      this._failure(new Error('Finish the current campaign operation first'));
      return false;
    }
    this.busy = true;
    this._controls();
    this.status.textContent = message;
    this.status.classList.remove('sheet-error');
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
    for (const control of this.root.querySelectorAll('input,select,button,textarea')) {
      control.disabled = this.busy || control.hasAttribute('data-core-pack');
    }
  }

  _failure(error) {
    this.status.textContent = error.message;
    this.status.classList.add('sheet-error');
    this.retry.hidden = !!this.workspace;
    new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
      component: 'CampaignLauncher',
      operation: 'campaign',
    });
  }

  destroy() {
    this.backupData = null;
    this.backupText.value = '';
    for (const [element, inert] of this.previousInert || []) element.inert = inert;
    this.root.remove();
  }
}

export function mountCampaignControls(gameManager, services) {
  const settingsPanel = document.getElementById('settings-panel');
  if (!settingsPanel) throw new Error('Campaign controls require the sidebar Settings panel');
  const bar = document.createElement('section');
  bar.className = 'section campaign-session-controls';
  bar.setAttribute('aria-label', 'Current campaign');
  const heading = document.createElement('div');
  heading.className = 'section-title';
  heading.textContent = 'Campaign & session';
  const name = document.createElement('strong');
  name.textContent = services.campaign.name;
  const rules = document.createElement('span');
  rules.textContent = `${services.campaign.ruleset} / SRD ${services.campaign.coreVersion}`;
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Campaigns';
  back.setAttribute('aria-label', 'Return to campaign picker');
  const status = document.createElement('output');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-label', 'Campaign save status');
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry save';
  retry.hidden = true;
  retry.addEventListener('click', () => {
    void services.autosave.retry().catch((error) => {
      status.textContent = error.message;
    });
  });
  services.autosave?.subscribe((state) => {
    status.textContent = state.text;
    status.dataset.saveState = state.state;
    retry.hidden = state.state !== 'error' || !services.autosave.ready;
    bar.setAttribute('aria-busy', String(state.state === 'loading' || state.state === 'saving'));
  });
  new CampaignTraversalPopup({ gameManager }).attach();
  bar.append(heading, name, rules, back, status, retry);
  const store = services.workspace.store;
  const role = store.identity?.role;
  const cloud = store.storageInfo?.kind === 'cloud';
  if (role === undefined || role === 'dm') {
    const maps = new CampaignMapControls({ gameManager });
    const mapTools = document.createElement('section');
    mapTools.className = 'campaign-tools';
    mapTools.setAttribute('aria-label', 'DM map controls');
    mapTools.append(maps.root);
    document.body.append(mapTools);
  }
  if (role === 'dm') {
    const sharing = document.createElement('button');
    sharing.type = 'button';
    sharing.textContent = 'Players & sharing';
    sharing.addEventListener(
      'click',
      () =>
        void new CampaignSharingPanel({
          workspace: services.workspace,
          campaignId: services.campaign.id,
        }).open()
    );
    bar.append(sharing);
    attachHostSessionUpdates({ gameManager, services, parent: bar });
  }
  if (cloud && store.capabilities?.invitations === true) {
    const invitations = document.createElement('button');
    invitations.type = 'button';
    invitations.textContent = 'Player invitations';
    invitations.addEventListener(
      'click',
      () =>
        void new CloudCampaignInvitations({
          workspace: services.workspace,
          campaignId: services.campaign.id,
        }).open()
    );
    bar.append(invitations);
  }
  if (cloud && store.capabilities?.sharedSessions === true)
    services.cloudLiveControls = new CloudLiveSessionControls({
      gameManager,
      services,
      parent: bar,
    });
  if (role === 'dm' || cloud) {
    const signout = document.createElement('button');
    signout.type = 'button';
    signout.textContent = 'Sign out';
    signout.addEventListener('click', async () => {
      signout.disabled = true;
      try {
        const leave = async () => {
          const ended = await services.workspace.finishSession();
          if (ended.backupError)
            status.textContent =
              'Primary saves completed; the final JSON backup was not confirmed.';
          if (cloud) await store.connection.account.signOut();
          else {
            await store.connection.logout();
            window.location.reload();
          }
        };
        if (cloud) {
          if (!services.saveFeedback) throw new Error('Cloud save coordination is not ready');
          await services.saveFeedback.pauseForExit(leave);
        } else await leave();
      } catch (error) {
        status.textContent = `Could not sign out safely: ${error.message}`;
        new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
          component: 'CampaignControls',
          operation: 'signOut',
        });
      } finally {
        signout.disabled = false;
      }
    });
    bar.append(signout);
  }
  if (services.workspace.store.backupStatus) {
    const backups = document.createElement('button');
    backups.type = 'button';
    backups.textContent = 'JSON backups';
    backups.addEventListener(
      'click',
      () =>
        void new CampaignBackupPanel({
          workspace: services.workspace,
          campaignId: services.campaign.id,
        }).open()
    );
    const backupStatus = document.createElement('output');
    backupStatus.setAttribute('aria-label', 'Automatic JSON backup status');
    let lastError = null;
    const refresh = async () => {
      try {
        const state = await services.workspace.store.backupStatus(services.campaign.id);
        backupStatus.textContent = state.error
          ? `JSON backup failed: ${state.error}`
          : state.latest
            ? `JSON backup: ${new Date(state.latest.createdAt).toLocaleTimeString()}`
            : 'JSON backup pending';
        if (state.error && state.error !== lastError)
          new ErrorHandler().handle(
            new Error(state.error),
            ERROR_SEVERITY.WARNING,
            ERROR_CATEGORY.INPUT,
            {
              component: 'CampaignControls',
              operation: 'automaticBackup',
            }
          );
        lastError = state.error;
      } catch (error) {
        backupStatus.textContent = `JSON backup unavailable: ${error.message}`;
        if (error.message !== lastError)
          new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
            component: 'CampaignControls',
            operation: 'backupStatus',
          });
        lastError = error.message;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 30000);
    window.addEventListener('pagehide', () => clearInterval(timer), { once: true });
    bar.append(backups, backupStatus);
  }
  back.addEventListener('click', async () => {
    try {
      const combat = gameManager.characterServices?.combat;
      if (
        gameManager.campaignViewBusy ||
        combat?.pending ||
        combat?.moves.size ||
        gameManager.placedTokens.some((token) =>
          gameManager.token3DAdapter?.isMovementInProgress?.(token)
        )
      ) {
        throw new Error('Finish the current roll or movement before changing campaigns');
      }
      if (
        !window.confirm(
          'Save this campaign and return to the campaign picker? Its terrain, creatures and completed turn state will be restored when you reopen it.'
        )
      )
        return;
      const leave = async () => {
        const ended = await services.workspace.finishSession();
        if (ended.backupError)
          status.textContent = 'Primary saves completed; the final JSON backup was not confirmed.';
        services.workspace.close();
        window.location.reload();
      };
      if (cloud) {
        if (!services.saveFeedback) throw new Error('Cloud save coordination is not ready');
        await services.saveFeedback.pauseForExit(leave);
      } else await leave();
    } catch (error) {
      status.textContent = error.message;
      new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
        component: 'CampaignControls',
        operation: 'returnToPicker',
      });
    }
  });
  settingsPanel.append(bar);
  return bar;
}
