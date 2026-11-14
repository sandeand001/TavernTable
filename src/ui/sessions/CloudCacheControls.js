import { CloudParticipantCacheError } from '../../campaigns/CloudParticipantCache.js';
import { GameErrors } from '../../utils/error/ErrorHandler.js';

const MiB = 1024 * 1024;
const protectedBudgetNotice =
  'Current-view data remain protected above this limit; the reduction fully takes effect as protected views close.';

export default class CloudCacheControls {
  constructor({
    cache,
    uid,
    account,
    beforeClear = () => {},
    onCleared = null,
    ownsCache = false,
  }) {
    if (!cache || typeof uid !== 'string' || !uid || typeof account?.identity !== 'function')
      throw new Error('Private cache settings require the current signed-in account');
    this.cache = cache;
    this.uid = uid;
    this.account = account;
    this.beforeClear = beforeClear;
    this.onCleared = onCleared;
    this.ownsCache = ownsCache;
    this.busy = false;
    this.root = document.createElement('section');
    this.root.className = 'section cloud-cache-controls';
    this.root.setAttribute('aria-label', 'Private browser cache settings');
    this.root.innerHTML = `
      <div class="section-title">Private browser cache</div>
      <p>Replaceable authorized campaign data for this account in this browser only.
        Cloud authority remains online. Public catalogs are separate.</p>
      <output role="status" aria-label="Private cache availability"></output>
      <output aria-label="Private cache usage"></output>
      <form aria-label="Private cache budget">
        <label>Local cache budget (MiB)
          <input type="number" min="0" step="1" value="256" aria-label="Private cache budget in MiB">
        </label>
        <button type="submit">Set local cache budget</button>
      </form>
      <button type="button" data-cache-refresh>Refresh usage</button>
      <button type="button" data-cache-clear>Clear this account's private cache</button>
      <button type="button" data-cache-persistence>Request persistent browser storage</button>
      <output role="status" aria-label="Private cache status"></output>`;
    this.budget = this.root.querySelector('input');
    this.usageOutput = this.root.querySelector('[aria-label="Private cache usage"]');
    this.availabilityOutput = this.root.querySelector('[aria-label="Private cache availability"]');
    this.status = this.root.querySelector('[aria-label="Private cache status"]');
    this.budgetInput = () => {
      this.budgetDirty = true;
    };
    this.submit = (event) => {
      event.preventDefault();
      void this.setBudget().catch(() => {});
    };
    this.refreshClick = () => void this.refreshUsage().catch(() => {});
    this.clearClick = () => void this.clear().catch(() => {});
    this.persistenceClick = () => void this.requestPersistence().catch(() => {});
    this.budget.addEventListener('input', this.budgetInput);
    this.root.querySelector('form').addEventListener('submit', this.submit);
    this.root.querySelector('[data-cache-refresh]').addEventListener('click', this.refreshClick);
    this.root.querySelector('[data-cache-clear]').addEventListener('click', this.clearClick);
    this.root
      .querySelector('[data-cache-persistence]')
      .addEventListener('click', this.persistenceClick);
    if (typeof account.subscribe === 'function') {
      this.unsubscribeAccount = account.subscribe(
        (identity) => {
          if (identity?.uid === this.uid) return;
          this.accountEnded = true;
          this.usageOutput.textContent = '';
          this.availabilityOutput.textContent = '';
          this.budget.value = '';
          this.status.textContent =
            'The signed-in account changed. Reopen its private cache settings.';
          this._controls();
        },
        (error) => {
          this.accountEnded = true;
          this._failure(error, 'identity');
          this._controls();
        }
      );
    }
    this._controls();
    this.ready = this.refreshUsage();
    this.idle = this.ready;
    void this.ready.catch(() => {});
  }

  _identity() {
    if (this.destroyed)
      throw new CloudParticipantCacheError('cache-closed', 'Private cache settings were closed.');
    if (this.accountEnded || this.account.identity()?.uid !== this.uid)
      throw new CloudParticipantCacheError(
        'cache-unavailable',
        'These private cache settings belong to another signed-in account.'
      );
    if (this.cache.available !== true)
      throw new CloudParticipantCacheError(
        'cache-unavailable',
        'Private cache storage is unavailable in this browser.'
      );
  }

  refreshUsage({ duringAction = false } = {}) {
    if (this.busy && !duringAction) return this.idle.then(() => this.refreshUsage());
    if (this.refreshTask) return this.refreshTask;
    this.refreshTask = (async () => {
      this._identity();
      const usage = await this.cache.getUsage();
      this._identity();
      if (
        !Number.isSafeInteger(usage?.bytes) ||
        usage.bytes < 0 ||
        !Number.isSafeInteger(usage.limitBytes) ||
        usage.limitBytes < 0
      )
        throw new CloudParticipantCacheError(
          'cache-unavailable',
          'Private cache usage could not be verified.'
        );
      this.usage = usage;
      this._renderAvailability();
      this.initialized = true;
      this.usageOutput.textContent =
        `${usage.bytes.toLocaleString('en-US')} bytes used of ` +
        `${usage.limitBytes.toLocaleString('en-US')} bytes (${usage.limitBytes / MiB} MiB). ` +
        'This is local private-cache usage, not cloud quota.';
      if (!this.budgetDirty) this.budget.value = String(usage.limitBytes / MiB);
      this._controls();
      return usage;
    })().finally(() => {
      this.refreshTask = null;
    });
    void this.refreshTask.catch((error) => this._failure(error, 'usage'));
    return this.refreshTask;
  }

  updateStatus(status) {
    if (this.destroyed || this.accountEnded || !status?.cache) return;
    this.cacheStatus = status.cache;
    this._renderAvailability();
    if (!['warning', 'unavailable'].includes(this.cacheStatus.phase)) return;
    const signature = JSON.stringify(this.cacheStatus);
    if (signature === this.reportedCacheWarning) return;
    this.reportedCacheWarning = signature;
    GameErrors.input(
      new CloudParticipantCacheError(
        this.cacheStatus.code || 'cache-unavailable',
        this.cacheStatus.message || 'Private browser caching is unavailable.'
      ),
      { component: 'CloudCacheControls', operation: 'cacheRecovery' }
    );
  }

  _renderAvailability() {
    const warnings = [];
    if (['warning', 'unavailable'].includes(this.cacheStatus?.phase))
      warnings.push(this.cacheStatus.message || 'Private browser caching is unavailable.');
    if (this.usage?.crossTabCoordinated === false)
      warnings.push(
        'Cross-tab coordination is unavailable; live private-cache reads and writes are disabled.'
      );
    if (this.usage?.assetStorageAvailable === false)
      warnings.push('Private artwork cache storage is unavailable in this browser.');
    if (this.usage?.overBudget === true)
      warnings.push(
        this.usage.protectedBytes > 0
          ? protectedBudgetNotice
          : 'Local private-cache usage currently exceeds its configured budget.'
      );
    this.availabilityOutput.textContent =
      (warnings.length
        ? warnings.join(' ')
        : 'Detected browser cache capabilities do not guarantee storage.') +
      ' Private data remains replaceable; cloud authority remains online.';
  }

  setBudget(value = this.budget.value) {
    return this._run(
      'budget',
      async () => {
        const amount = typeof value === 'string' && !value.trim() ? NaN : Number(value);
        if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(amount * MiB))
          throw new Error('Choose a non-negative whole number of MiB for this private cache.');
        await this.cache.setBudget(amount * MiB);
        this._identity();
        this.budgetDirty = false;
        await this.refreshUsage({ duringAction: true });
        this.status.textContent = this.usage.overBudget
          ? `Private cache budget saved. ${protectedBudgetNotice} Cloud storage limits are unchanged.`
          : 'Private cache budget saved for this account in this browser. Cloud storage limits are unchanged.';
      },
      'Updating the local private-cache budget...'
    );
  }

  clear() {
    return this._run(
      'clear',
      async () => {
        this.cacheWasCleared = false;
        this.beforeClear();
        await this.cache.clear();
        this.cacheWasCleared = true;
        this._identity();
        await this.refreshUsage({ duringAction: true });
        if (this.onCleared) {
          this.status.textContent =
            "Cleared this account's private cache. Reconnecting from current cloud authority...";
          await this.onCleared();
          this._identity();
          await this.refreshUsage({ duringAction: true });
        }
        this.status.textContent =
          "Cleared this account's private cache in this browser. Active-view data may be cached again from current cloud authority.";
      },
      "Clearing only this account's local private cache..."
    );
  }

  requestPersistence() {
    return this._run(
      'persistence',
      async () => {
        const result = await this.cache.requestPersistence();
        this._identity();
        if (result?.status === 'failed') {
          if (result.error instanceof CloudParticipantCacheError) throw result.error;
          throw new CloudParticipantCacheError(
            'cache-unavailable',
            'The browser persistence failure could not be verified.'
          );
        }
        const messages = {
          accepted:
            'Browser persistence accepted. This private cache remains replaceable; browser settings can still remove it. Cloud authority is unchanged.',
          denied:
            'Browser persistence denied. The private cache may be evicted. Cloud authority is unchanged.',
          unavailable:
            'Browser persistence unavailable. The private cache may be evicted. Cloud authority is unchanged.',
        };
        if (
          !Object.hasOwn(messages, result?.status) ||
          result.persistent !== (result.status === 'accepted')
        )
          throw new CloudParticipantCacheError(
            'cache-unavailable',
            'The browser persistence response could not be verified.'
          );
        this.status.textContent = messages[result.status];
      },
      'Requesting best-effort persistent browser storage...'
    );
  }

  _run(operation, action, message) {
    if (this.busy || this.externalBusy)
      return Promise.reject(new Error('Finish the current private cache operation first.'));
    this.busy = true;
    this._controls();
    this.status.textContent = message;
    this.status.classList.remove('sheet-error');
    this.idle = (async () => {
      this._identity();
      if (!this.initialized) throw new Error('Wait for private cache settings to load.');
      await action();
    })()
      .catch((error) => {
        this._failure(error, operation);
        throw error;
      })
      .finally(() => {
        this.busy = false;
        this._controls();
      });
    return this.idle;
  }

  _failure(error, operation) {
    if (this.destroyed) return;
    const label =
      operation === 'persistence'
        ? 'Browser persistence'
        : error instanceof CloudParticipantCacheError
          ? 'Private browser cache'
          : 'Private cache settings';
    this.status.textContent =
      operation === 'clear' && this.cacheWasCleared
        ? `Private cache was cleared, but recovery failed: ${error.message} Reconnect to current cloud authority before playing.`
        : `${label} failed: ${error.message} Cloud authority is unchanged.`;
    this.status.classList.add('sheet-error');
    GameErrors.input(error, { component: 'CloudCacheControls', operation });
  }

  _controls() {
    for (const control of this.root.querySelectorAll('input,button'))
      control.disabled =
        this.busy ||
        this.externalBusy ||
        this.destroyed ||
        this.accountEnded ||
        (!this.initialized && !control.hasAttribute('data-cache-refresh'));
  }

  setBlocked(blocked) {
    this.externalBusy = blocked;
    this._controls();
  }

  destroy() {
    if (this.closing) return this.closing;
    this.destroyed = true;
    this.unsubscribeAccount?.();
    this.root.querySelector('form').removeEventListener('submit', this.submit);
    this.budget.removeEventListener('input', this.budgetInput);
    this.root.querySelector('[data-cache-refresh]').removeEventListener('click', this.refreshClick);
    this.root.querySelector('[data-cache-clear]').removeEventListener('click', this.clearClick);
    this.root
      .querySelector('[data-cache-persistence]')
      .removeEventListener('click', this.persistenceClick);
    this.root.remove();
    this.closing = this.ownsCache ? Promise.resolve(this.cache.close()) : Promise.resolve();
    return this.closing;
  }
}
