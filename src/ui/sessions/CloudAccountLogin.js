import { GameErrors } from '../../utils/error/ErrorHandler.js';

export default class CloudAccountLogin {
  constructor({ account, connection, runtime, document = globalThis.document }) {
    if (
      typeof account?.ready !== 'function' ||
      typeof account.subscribe !== 'function' ||
      typeof account.identity !== 'function' ||
      typeof connection?.profile !== 'function'
    )
      throw new Error('Cloud sign-in requires managed identity and verified account access');
    this.account = account;
    this.connection = connection;
    this.document = document;
    this.busy = false;
    this.settled = false;
    this.queued = false;
    this.version = 0;
    this.lastUid = account.identity()?.uid ?? null;
    this.registering = false;
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Cloud account sign-in');
    this.root.tabIndex = -1;
    this.root.innerHTML = `<div class="campaign-shell">
      <header><span class="campaign-eyebrow">TavernTable account</span>
        <h1>Sign in to TavernTable</h1>
        <p>Use your own account. Campaign ownership and player access are checked separately.</p>
      </header>
      <p data-emulator-notice hidden>Development emulator: use synthetic test accounts only.</p>
      <output class="campaign-status" role="status" aria-label="Account sign-in status"></output>
      <section data-signed-out>
        <button type="button" data-google-login>Continue with Google</button>
        <form data-email-login>
          <h2 data-email-heading>Sign in with email</h2>
          <label>Email address<input type="email" autocomplete="username" aria-label="Email address" required></label>
          <label>Password<input type="password" autocomplete="current-password" aria-label="Account password" required></label>
          <button type="submit" data-email-submit>Sign in with email</button>
          <button type="button" data-register-toggle>Create an email account</button>
          <button type="button" data-reset-password>Forgot password?</button>
        </form>
      </section>
      <section data-signed-in hidden>
        <p data-account-summary></p>
        <p>Verified email and private-pilot approval are required before opening campaigns.</p>
        <button type="button" data-refresh-account>Refresh account access</button>
        <button type="button" data-send-verification>Resend verification email</button>
        <button type="button" data-account-signout>Sign out</button>
      </section>
      <footer>Stay online to use cloud campaigns. Sign-in failures never create a new campaign or select local storage.</footer>
    </div>`;
    this.status = this.root.querySelector('output');
    this.email = this.root.querySelector('[aria-label="Email address"]');
    this.password = this.root.querySelector('[aria-label="Account password"]');
    this.root.querySelector('[data-emulator-notice]').hidden = runtime?.environment !== 'emulator';
    this.root
      .querySelector('[data-google-login]')
      .addEventListener(
        'click',
        () => void this._run(() => this.account.signInGoogle(), 'Opening Google sign-in...')
      );
    this.root.querySelector('[data-email-login]').addEventListener('submit', (event) => {
      event.preventDefault();
      const email = this.email.value.trim();
      const password = this.password.value;
      void this._run(
        () =>
          this.registering
            ? this.account.registerEmail(email, password)
            : this.account.signInEmail(email, password),
        this.registering ? 'Creating your managed account...' : 'Signing in...'
      );
    });
    this.root.querySelector('[data-register-toggle]').addEventListener('click', () => {
      if (this.busy) return;
      this.registering = !this.registering;
      this.password.value = '';
      this.password.autocomplete = this.registering ? 'new-password' : 'current-password';
      this.password.minLength = this.registering ? 6 : 0;
      this.root.querySelector('[data-email-heading]').textContent = this.registering
        ? 'Create an email account'
        : 'Sign in with email';
      this.root.querySelector('[data-email-submit]').textContent = this.registering
        ? 'Create account & verify email'
        : 'Sign in with email';
      this.root.querySelector('[data-register-toggle]').textContent = this.registering
        ? 'Already have an account? Sign in'
        : 'Create an email account';
      this.status.textContent = this.registering
        ? 'Firebase manages your password. Verify your email before using campaigns.'
        : 'Choose Google or your existing email account.';
      this.email.focus();
    });
    this.root.querySelector('[data-reset-password]').addEventListener('click', () => {
      if (!this.email.reportValidity()) return;
      const email = this.email.value.trim();
      void this._run(() => this.account.resetPassword(email), 'Requesting password recovery...', {
        check: false,
        success:
          'If this email has an account, password recovery instructions have been requested. Return here to sign in.',
      });
    });
    this.root
      .querySelector('[data-refresh-account]')
      .addEventListener(
        'click',
        () =>
          void this._run(
            () => this.account.refreshIdentity(),
            'Refreshing verified account access...'
          )
      );
    this.root.querySelector('[data-send-verification]').addEventListener(
      'click',
      () =>
        void this._run(() => this.account.sendVerification(), 'Requesting verification email...', {
          check: false,
          success: 'Verification email requested. Check your inbox, then refresh account access.',
        })
    );
    this.root
      .querySelector('[data-account-signout]')
      .addEventListener(
        'click',
        () => void this._run(() => this.account.signOut(), 'Signing out...')
      );
  }

  choose() {
    if (this.selection) return this.selection;
    this.selection = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    this.previousFocus = this.document.activeElement;
    this.previousInert = new Map(
      [...this.document.body.children].map((element) => [element, element.inert])
    );
    for (const element of this.previousInert.keys()) element.inert = true;
    this.document.body.append(this.root);
    this.stop = this.account.subscribe(
      (identity) => this._identityChanged(identity),
      (error) => {
        if (!this.settled) {
          this.version++;
          this.queued = false;
          this._showError(error);
        }
      }
    );
    this.email.focus();
    void this._run(() => this.account.ready(), 'Restoring your account...');
    return this.selection;
  }

  _identityChanged(identity) {
    if (this.settled) return;
    const uid = identity?.uid ?? null;
    if (uid === this.lastUid) return;
    this.lastUid = uid;
    this.version++;
    this.password.value = '';
    this._render();
    if (this.busy) this.queued = true;
    else void this._run(async () => {}, 'Checking account access...');
  }

  _render() {
    const identity = this.account.identity();
    this.root.querySelector('[data-signed-out]').hidden = identity !== null;
    this.root.querySelector('[data-signed-in]').hidden = identity === null;
    this.root.querySelector('[data-account-summary]').textContent = identity
      ? `Signed in as ${identity.email || identity.displayName || 'your managed account'}.`
      : '';
    this.root.querySelector('[data-send-verification]').hidden =
      !identity || identity.emailVerified;
    for (const control of this.root.querySelectorAll('input,button')) control.disabled = this.busy;
  }

  _showError(error) {
    this.status.textContent = error.message;
    GameErrors.input(error, { component: 'CloudAccountLogin', operation: 'accountAccess' });
  }

  async _checkAccess(ticket) {
    this._render();
    const identity = this.account.identity();
    if (identity === null) {
      this.status.textContent = 'Choose Google or your existing email account.';
      return;
    }
    this.status.textContent = 'Checking verified cloud account access...';
    const profile = await this.connection.profile();
    if (this.settled || ticket !== this.version) return;
    if (this.account.identity()?.uid !== profile.uid)
      throw Object.assign(new Error('The signed-in account changed. Refresh account access.'), {
        status: 409,
        code: 'account-changed',
      });
    this.settled = true;
    this._cleanup();
    this.resolve(profile);
  }

  async _run(operation, message, { check = true, success = null } = {}) {
    if (this.busy || this.settled) return;
    this.busy = true;
    const ticket = ++this.version;
    this.password.value = '';
    this.status.textContent = message;
    this._render();
    try {
      await operation();
      if (this.settled || ticket !== this.version) return;
      if (check) await this._checkAccess(ticket);
      else this.status.textContent = success;
    } catch (error) {
      if (!this.settled && ticket === this.version) this._showError(error);
    } finally {
      this.busy = false;
      if (!this.settled) {
        this._render();
        if (this.queued) {
          this.queued = false;
          void this._run(async () => {}, 'Checking the current account...');
        }
      }
    }
  }

  _cleanup() {
    try {
      this.stop?.();
    } finally {
      for (const [element, inert] of this.previousInert) element.inert = inert;
      this.root.remove();
      this.previousFocus?.focus?.();
    }
  }

  destroy() {
    if (!this.selection || this.settled) return;
    this.settled = true;
    this.version++;
    this._cleanup();
    this.reject(
      Object.assign(
        new Error('Cloud account sign-in was closed without selecting local storage.'),
        {
          status: 499,
          code: 'account-dialog-closed',
        }
      )
    );
  }
}
