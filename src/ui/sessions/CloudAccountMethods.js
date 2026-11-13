import { GameErrors } from '../../utils/error/ErrorHandler.js';

export default class CloudAccountMethods {
  constructor({ account }) {
    if (
      [
        'identity',
        'signInMethods',
        'verifySignInMethod',
        'linkSignInMethod',
        'cancelSignInLink',
        'refreshIdentity',
        'sendVerification',
      ].some((method) => typeof account?.[method] !== 'function') ||
      !account.identity()?.uid
    )
      throw new Error('Sign-in method management requires the current managed account');
    this.account = account;
    this.uid = account.identity().uid;
    this.busy = false;
    this.verified = false;
    this.unconfirmed = false;
    this.previousInert = new Map();
    this.root = document.createElement('section');
    this.root.className = 'campaign-picker';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Cloud sign-in methods');
    this.root.tabIndex = -1;
    this.root.innerHTML = `<div class="campaign-shell">
      <h2>Sign-in methods</h2>
      <p data-method-account></p>
      <p data-method-providers></p>
      <p data-method-verification></p>
      <output role="status" aria-label="Sign-in method status"></output>
      <section data-link-controls>
        <p>Verify your existing sign-in method first. Verification is single-use
        and expires after five minutes. Linking keeps the same account and campaign access.</p>
        <button type="button" data-verify-google>Verify Google sign-in</button>
        <form data-verify-password>
          <label>Existing password<input type="password" autocomplete="current-password"
            aria-label="Existing sign-in password" required></label>
          <button type="submit">Verify password sign-in</button>
        </form>
        <form data-add-password>
          <label>New TavernTable password<input type="password" autocomplete="new-password"
            aria-label="New sign-in password" minlength="6" required></label>
          <label>Confirm password<input type="password" autocomplete="new-password"
            aria-label="Confirm sign-in password" minlength="6" required></label>
          <button type="submit">Link email/password</button>
        </form>
        <button type="button" data-add-google>Link Google</button>
        <button type="button" data-cancel-method-proof>Cancel verification</button>
      </section>
      <p data-methods-complete hidden>Google and email/password are already linked.
      No duplicate link or account merge is needed.</p>
      <button type="button" data-send-method-verification>Send verification email</button>
      <button type="button" data-refresh-methods>Refresh sign-in methods</button>
      <button type="button" data-close-methods>Close</button>
    </div>`;
    this.status = this.root.querySelector('output');
    this.password = this.root.querySelector('[aria-label="Existing sign-in password"]');
    this.newPassword = this.root.querySelector('[aria-label="New sign-in password"]');
    this.confirmation = this.root.querySelector('[aria-label="Confirm sign-in password"]');
    this.root.addEventListener('keydown', (event) => event.stopPropagation());
    this.root.querySelector('[data-verify-google]').addEventListener('click', () => {
      void this._perform(() => this._verify({ provider: 'google.com' }), 'Verifying Google...');
    });
    this.root.querySelector('[data-verify-password]').addEventListener('submit', (event) => {
      event.preventDefault();
      const password = this.password.value;
      this.password.value = '';
      void this._perform(
        () => this._verify({ provider: 'password', password }),
        'Verifying the existing password...'
      );
    });
    this.root.querySelector('[data-add-password]').addEventListener('submit', (event) => {
      event.preventDefault();
      const password = this.newPassword.value;
      const confirmation = this.confirmation.value;
      this._clearPasswords();
      void this._perform(async () => {
        if (password !== confirmation) throw new Error('The new passwords do not match.');
        await this._link({ provider: 'password', password });
      }, 'Linking email/password to the current account...');
    });
    this.root.querySelector('[data-add-google]').addEventListener('click', () => {
      void this._perform(() => this._link({ provider: 'google.com' }), 'Linking Google...');
    });
    this.root.querySelector('[data-cancel-method-proof]').addEventListener('click', () => {
      void this._perform(async () => {
        this._cancelProof();
        this.status.textContent = 'Verification cancelled. No sign-in method was changed.';
      }, 'Cancelling verification...');
    });
    this.root.querySelector('[data-refresh-methods]').addEventListener('click', () => {
      void this._perform(async () => {
        this._cancelProof();
        await this.account.refreshIdentity();
        this.unconfirmed = false;
        this.status.textContent = 'Sign-in methods refreshed. No link was retried.';
      }, 'Refreshing current sign-in methods...');
    });
    this.root.querySelector('[data-send-method-verification]').addEventListener('click', () => {
      void this._perform(async () => {
        await this.account.sendVerification();
        this.status.textContent =
          'Verification email sent. Follow its link, then refresh sign-in methods.';
      }, 'Requesting email verification...');
    });
    this.root.querySelector('[data-close-methods]').addEventListener('click', () => this.destroy());
  }

  _sameAccount() {
    if (this.account.identity()?.uid !== this.uid)
      throw new Error('The signed-in account changed. Close this panel and reopen account access.');
  }

  _clearPasswords() {
    this.password.value = this.newPassword.value = this.confirmation.value = '';
  }

  _cancelProof() {
    this.account.cancelSignInLink();
    this.verified = false;
    this._clearPasswords();
  }

  async _verify(options) {
    this.verified = false;
    await this.account.verifySignInMethod(options);
    this._sameAccount();
    this.verified = true;
    this.status.textContent =
      'Existing sign-in verified. Link the other method within five minutes.';
  }

  async _link(options) {
    if (!this.verified || this.unconfirmed)
      throw new Error('Verify the existing sign-in method before linking another method.');
    this.verified = false;
    const result = await this.account.linkSignInMethod(options);
    if (result.uid !== this.uid) throw new Error('The linked account could not be confirmed.');
    this.status.textContent = result.emailVerified
      ? 'Sign-in method linked to the same account. Campaign ownership and access were preserved.'
      : 'Sign-in method linked. Verify your email again before using campaigns.';
  }

  render() {
    this._sameAccount();
    this.methods = this.account.signInMethods();
    if (this.methods.uid !== this.uid)
      throw new Error('Refresh the current account before linking.');
    const google = this.methods.providers.includes('google.com');
    const password = this.methods.providers.includes('password');
    this.root.querySelector('[data-method-account]').textContent = this.methods.email;
    this.root.querySelector('[data-method-providers]').textContent =
      `Google: ${google ? 'linked' : 'not linked'}. Email/password: ${password ? 'linked' : 'not linked'}.`;
    this.root.querySelector('[data-method-verification]').textContent = this.methods.emailVerified
      ? 'Email verified.'
      : 'Email verification is required before linking another method or using campaigns.';
    this.root.querySelector('[data-link-controls]').hidden = google && password;
    this.root.querySelector('[data-methods-complete]').hidden = !(google && password);
    this.root.querySelector('[data-verify-google]').hidden = !google || password;
    this.root.querySelector('[data-verify-password]').hidden = !password || google;
    this.root.querySelector('[data-add-password]').hidden = password || !google;
    this.root.querySelector('[data-add-google]').hidden = google || !password;
    this.root.querySelector('[data-send-method-verification]').hidden = this.methods.emailVerified;
    this._controls();
  }

  _controls() {
    const changed = this.account.identity()?.uid !== this.uid;
    for (const control of this.root.querySelectorAll('input,button'))
      control.disabled = this.busy || changed;
    const blocked = this.busy || changed || this.unconfirmed || !this.methods?.emailVerified;
    this.root.querySelector('[data-verify-google]').disabled = blocked;
    this.root.querySelector('[data-verify-password] button').disabled = blocked;
    this.root.querySelector('[data-add-password] button').disabled = blocked || !this.verified;
    this.root.querySelector('[data-add-google]').disabled = blocked || !this.verified;
    const cancel = this.root.querySelector('[data-cancel-method-proof]');
    cancel.hidden = !this.verified;
    cancel.disabled = this.busy || changed || this.unconfirmed || !this.verified;
    this.root.querySelector('[data-close-methods]').disabled = this.busy;
    this.root.setAttribute('aria-busy', String(this.busy));
  }

  async _perform(operation, message) {
    if (this.busy) {
      this._failure(new Error('Finish the current sign-in operation first.'));
      return false;
    }
    this.busy = true;
    this.status.textContent = message;
    this._controls();
    try {
      this._sameAccount();
      await operation();
      this.render();
      return true;
    } catch (error) {
      if (error.code === 'sign-in-link-unconfirmed') this.unconfirmed = true;
      this._failure(error);
      return false;
    } finally {
      this.busy = false;
      this._controls();
    }
  }

  _failure(error) {
    this.status.textContent = this.unconfirmed
      ? 'Unconfirmed sign-in change. Refresh with this same account before trying again. ' +
        error.message
      : error.message;
    GameErrors.input(error, { component: 'CloudAccountMethods', operation: 'signInMethods' });
  }

  async open() {
    this.previousFocus = document.activeElement;
    this.previousInert = new Map(
      [...document.body.children].map((element) => [element, element.inert])
    );
    for (const element of this.previousInert.keys()) element.inert = true;
    document.body.append(this.root);
    this.root.focus();
    return this._perform(async () => {
      this._cancelProof();
      this.status.textContent = 'Manage Google and email/password on this same account.';
    }, 'Checking current sign-in methods...');
  }

  destroy() {
    if (this.busy) {
      this._failure(new Error('Finish the current sign-in operation before closing.'));
      return;
    }
    this._cancelProof();
    for (const [element, inert] of this.previousInert) element.inert = inert;
    this.root.remove();
    this.previousFocus?.focus?.();
  }
}
