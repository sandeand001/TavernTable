import CampaignWorkspace from '../../campaigns/CampaignWorkspace.js';
import { edition, supportedEditions } from '../../rules/editions.js';
import { escapeHtml as escape } from '../characters/escapeHtml.js';
import { ErrorHandler, ERROR_SEVERITY, ERROR_CATEGORY } from '../../utils/error/ErrorHandler.js';

export default class CampaignLauncher {
  constructor({ workspace = null } = {}) {
    this.workspace = workspace;
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
        <button type="button" data-campaign-retry hidden>Retry loading campaigns</button>
        <div class="campaign-columns">
          <section aria-label="Saved campaigns">
            <h2>Open a campaign</h2>
            <div class="campaign-list"></div>
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
        <footer>Campaigns are stored only in this browser profile. Export backups before clearing site data.
          Opening a campaign restores its automatically saved board.
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
    this.backup = this.root.querySelector('.campaign-backup');
    this.backupText = this.root.querySelector('textarea');
    this.importFile = this.root.querySelector('input[type="file"]');
    this.retry = this.root.querySelector('[data-campaign-retry]');
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
        await this.workspace.update(this.settingsId, {
          name: this.settingsName.value,
          packIds: this._selectedPacks(this.settings),
        });
        await this._renderSaved();
        this.status.textContent =
          'Campaign settings saved. Owned content and source pins are unchanged.';
      }, 'Saving campaign settings...');
    });
    this.root.addEventListener('click', (event) => {
      const button = event.target.closest('button');
      if (!button) return;
      const id = button.closest('[data-campaign-id]')?.dataset.campaignId;
      if (button.hasAttribute('data-open-campaign'))
        void this._perform(() => this._open(id), 'Opening the selected campaign...');
      if (button.hasAttribute('data-edit-campaign'))
        void this._perform(() => this._edit(id), 'Loading campaign settings...');
      if (button.hasAttribute('data-export-campaign'))
        void this._perform(() => this._export(id), 'Preparing campaign backup...');
      if (button.hasAttribute('data-campaign-import')) this.importFile.click();
      if (button.hasAttribute('data-settings-cancel')) this.settings.hidden = true;
      if (button.hasAttribute('data-backup-close')) this.backup.hidden = true;
      if (button.hasAttribute('data-campaign-download')) this._download();
      if (button.hasAttribute('data-campaign-retry')) this.ready = this._load();
    });
    this.importFile.addEventListener('change', () => {
      const file = this.importFile.files?.[0];
      if (!file) return;
      void this._perform(async () => {
        if (file.size > 32000000) throw new Error('Campaign backups must be smaller than 32 MB');
        const text =
          typeof file.text === 'function'
            ? await file.text()
            : await new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result);
                reader.onerror = () => reject(reader.error);
                reader.readAsText(file);
              });
        const campaign = await this.workspace.importBackup(text);
        await this._renderSaved();
        this.status.textContent = `Imported ${campaign.name} as a separate ${campaign.ruleset} campaign.`;
      }, 'Validating and importing campaign backup...').finally(() => {
        this.importFile.value = '';
      });
    });
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
    const loaded = await this._perform(async () => {
      if (!this.workspace) this.workspace = await CampaignWorkspace.load();
      await this._renderSaved();
      this._sources(this.root.querySelector('[data-create-packs]'), this.ruleset.value);
      this.retry.hidden = true;
      this.status.textContent = 'Choose a saved campaign or create a new one.';
    }, 'Loading local campaigns...');
    if (loaded) this.name.focus();
    return loaded;
  }

  async _renderSaved() {
    const campaigns = await this.workspace.list();
    this.list.innerHTML =
      campaigns
        .map((campaign) => {
          const profile = edition(campaign.ruleset);
          return `<article data-campaign-id="${escape(campaign.id)}">
        <h3>${escape(campaign.name)}</h3>
        <p>${profile.name} rules / SRD ${profile.srd} / ${campaign.sourcePacks.filter((source) => source.enabled).length} enabled sources</p>
        <div class="campaign-row-actions">
          <button type="button" data-open-campaign>Open</button>
          <button type="button" data-edit-campaign>Sources &amp; settings</button>
          <button type="button" data-export-campaign>Export</button>
        </div></article>`;
        })
        .join('') || '<p class="campaign-empty">No campaigns saved in this browser yet.</p>';
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

  async _edit(id) {
    const campaign = await this.workspace.store.get(id);
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
    this.backupText.value = await this.workspace.exportBackup(id);
    this.backupName = (await this.workspace.store.get(id)).name;
    this.backup.hidden = false;
    this.backupText.focus();
    this.backupText.select();
    this.status.textContent = 'Backup ready. Download JSON or copy the text below.';
  }

  _download() {
    const url = URL.createObjectURL(
      new Blob([this.backupText.value], { type: 'application/json' })
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${this.backupName.replace(/[^a-z0-9._-]/gi, '-') || 'campaign'}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
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
    for (const [element, inert] of this.previousInert || []) element.inert = inert;
    this.root.remove();
  }
}

export function mountCampaignControls(gameManager, services) {
  const bar = document.createElement('section');
  bar.className = 'campaign-tools';
  bar.setAttribute('aria-label', 'Current campaign');
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
  bar.append(name, rules, back, status, retry);
  back.addEventListener('click', async () => {
    try {
      const combat = gameManager.characterServices?.combat;
      if (
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
      await services.autosave?.flush();
      await services.library.flush();
      services.workspace.close();
      window.location.reload();
    } catch (error) {
      status.textContent = error.message;
      new ErrorHandler().handle(error, ERROR_SEVERITY.WARNING, ERROR_CATEGORY.INPUT, {
        component: 'CampaignControls',
        operation: 'returnToPicker',
      });
    }
  });
  document.body.append(bar);
  return bar;
}
