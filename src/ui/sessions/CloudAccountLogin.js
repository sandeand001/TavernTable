import { GameErrors } from '../../utils/error/ErrorHandler.js';
import CloudCampaignClientStore from '../../campaigns/CloudCampaignClientStore.js';
import { isCloudInvitationLink } from '../../campaigns/CloudProtocol.js';
import CloudAccountMethods from './CloudAccountMethods.js';

export function consumeCloudInvitation({
  location = globalThis.location,
  history = globalThis.history,
} = {}) {
  const fragment = location.hash;
  if (!fragment.startsWith('#invite=')) return null;
  history.replaceState(null, '', location.pathname + location.search);
  const parts = fragment.slice('#invite='.length).split('.');
  const invitation = { version: 1, id: parts[0], secret: parts[1] };
  if (parts.length !== 2 || !isCloudInvitationLink(invitation))
    throw new Error('The campaign invitation is invalid. Ask its owner for a new private link.');
  return Object.freeze(invitation);
}

export function watchCloudInvitationNavigation({
  onInvitation,
  onFailure,
  window = globalThis.window,
}) {
  if (typeof onInvitation !== 'function' || typeof onFailure !== 'function')
    throw new Error('Cloud invitation navigation requires explicit receipt and failure handlers');
  const receive = async () => {
    try {
      const invitation = consumeCloudInvitation({
        location: window.location,
        history: window.history,
      });
      if (invitation !== null) await onInvitation(invitation);
    } catch (error) {
      onFailure(error);
    }
  };
  const stop = () => {
    window.removeEventListener('hashchange', receive);
    window.removeEventListener('pagehide', stop);
  };
  window.addEventListener('hashchange', receive);
  window.addEventListener('pagehide', stop, { once: true });
  return stop;
}

export async function reopenCloudInvitation({
  invitation,
  workspace,
  saveFeedback,
  location = globalThis.location,
  history = globalThis.history,
}) {
  if (
    !isCloudInvitationLink(invitation) ||
    workspace?.store?.storageInfo?.kind !== 'cloud' ||
    typeof saveFeedback?.pauseForExit !== 'function'
  )
    throw new Error('Opening an invitation requires its private link and cloud save coordination');
  await saveFeedback.pauseForExit(async () => {
    await workspace.active?.autosave?.flush();
    await workspace.active?.library.flush();
    if (workspace.store.pending) await workspace.store.pending.promise;
    const path = location.pathname + location.search;
    history.replaceState(null, '', path + '#invite=' + invitation.id + '.' + invitation.secret);
    try {
      location.reload();
    } catch (error) {
      history.replaceState(null, '', path);
      throw new Error('The invitation could not open. Reopen its original private link.');
    }
  });
}

export default class CloudAccountLogin {
  constructor({
    account,
    connection,
    runtime,
    invitation = null,
    crypto = globalThis.crypto,
    document = globalThis.document,
  }) {
    if (
      typeof account?.ready !== 'function' ||
      typeof account.subscribe !== 'function' ||
      typeof account.identity !== 'function' ||
      typeof connection?.profile !== 'function'
    )
      throw new Error('Cloud sign-in requires managed identity and verified account access');
    if (invitation !== null && !isCloudInvitationLink(invitation))
      throw new Error('The campaign invitation is invalid. Ask its owner for a new private link.');
    this.account = account;
    this.connection = connection;
    this.invitation = invitation === null ? null : Object.freeze({ ...invitation });
    this.crypto = crypto;
    this.joinStore = null;
    this.joinState = null;
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
      <section data-campaign-invitation hidden>
        <h2>Campaign invitation</h2>
        <p>Sign in and verify your email before accepting this single-use invitation.
        Acceptance enables your account for TavernTable and joins the invited player seat.
        Unused links expire after seven days; accepted membership does not.</p>
        <button type="button" data-accept-invitation>Accept campaign invitation</button>
        <button type="button" data-retry-invitation hidden>Retry invitation acceptance</button>
        <button type="button" data-skip-invitation>Continue without accepting</button>
      </section>
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
        <button type="button" data-account-methods hidden>Sign-in methods</button>
        <button type="button" data-account-signout>Sign out</button>
      </section>
      <footer>Stay online to use cloud campaigns. Sign-in failures never create a new campaign or select local storage.</footer>
    </div>`;
    this.status = this.root.querySelector('output');
    this.email = this.root.querySelector('[aria-label="Email address"]');
    this.password = this.root.querySelector('[aria-label="Account password"]');
    this.root.querySelector('[data-emulator-notice]').hidden = runtime?.environment !== 'emulator';
    this.root.querySelector('[data-accept-invitation]').addEventListener('click', () => {
      void this._run(async () => {
        const identity = this.account.identity();
        if (!identity?.emailVerified)
          throw new Error('Sign in and verify your email before accepting an invitation.');
        if (!this.joinStore) {
          this.joinStore = new CloudCampaignClientStore({
            connection: this.connection,
            uid: identity.uid,
            packs: [],
            crypto: this.crypto,
          });
          this.stopJoin = this.joinStore.subscribeSave((state) => {
            this.joinState = state;
            if (state.phase === 'saving')
              this.status.textContent = 'Confirming invitation acceptance...';
            else if (state.phase === 'uncertain')
              this.status.textContent =
                'Unconfirmed invitation acceptance. Keep this tab open and retry with the same account. ' +
                state.error.message;
            this._render();
          });
        }
        await this.joinStore.redeemInvitation(this.invitation);
        this.invitation = null;
      }, 'Accepting the campaign invitation...');
    });
    this.root.querySelector('[data-retry-invitation]').addEventListener('click', () => {
      void this.joinStore.retryPending().catch((error) => this._showError(error));
    });
    this.root.querySelector('[data-skip-invitation]').addEventListener('click', () => {
      void this._run(async () => {
        this.invitation = null;
      }, 'Checking account access without the invitation...');
    });
    this.leaving = (event) => {
      if (!this.joinStore?.pending) return;
      event.preventDefault();
      event.returnValue = '';
    };
    this.connectivityChanged = () => this._render();
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
    this.root.querySelector('[data-account-methods]').addEventListener('click', () => {
      void this._run(
        () => new CloudAccountMethods({ account: this.account }).open(),
        'Opening current sign-in methods...',
        { check: false }
      );
    });
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
    window.addEventListener('beforeunload', this.leaving);
    window.addEventListener('online', this.connectivityChanged);
    window.addEventListener('offline', this.connectivityChanged);
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

  receiveInvitation(invitation) {
    if (!isCloudInvitationLink(invitation))
      throw new Error('The campaign invitation is invalid. Ask its owner for a new private link.');
    if (this.settled)
      throw new Error('The sign-in screen has closed. Reopen the original private invitation.');
    if (this.joinStore?.pending)
      throw new Error('Finish the current invitation acceptance before opening another link.');
    this._clearJoin();
    this.invitation = Object.freeze({ ...invitation });
    this.version++;
    if (this.busy) {
      this.queued = true;
      this._render();
    } else void this._run(async () => {}, 'Checking the received campaign invitation...');
  }

  _clearJoin() {
    this.stopJoin?.();
    this.stopJoin = null;
    this.joinStore = null;
    this.joinState = null;
  }

  _identityChanged(identity) {
    if (this.settled) return;
    const uid = identity?.uid ?? null;
    if (uid === this.lastUid) return;
    this.lastUid = uid;
    if (!this.joinStore?.pending) this._clearJoin();
    this.version++;
    this.password.value = '';
    this._render();
    if (this.busy) this.queued = true;
    else void this._run(async () => {}, 'Checking account access...');
  }

  _render() {
    const identity = this.account.identity();
    this.root.querySelector('[data-campaign-invitation]').hidden = this.invitation === null;
    this.root.querySelector('[data-signed-out]').hidden = identity !== null;
    this.root.querySelector('[data-signed-in]').hidden = identity === null;
    this.root.querySelector('[data-account-summary]').textContent = identity
      ? `Signed in as ${identity.email || identity.displayName || 'your managed account'}.`
      : '';
    this.root.querySelector('[data-send-verification]').hidden =
      !identity || identity.emailVerified;
    this.root.querySelector('[data-account-methods]').hidden =
      !identity || typeof this.account.linkSignInMethod !== 'function';
    for (const control of this.root.querySelectorAll('input,button')) control.disabled = this.busy;
    this.root.querySelector('[data-accept-invitation]').disabled =
      this.busy ||
      !identity?.emailVerified ||
      this.joinState?.phase === 'failed' ||
      navigator.onLine === false;
    const retry = this.root.querySelector('[data-retry-invitation]');
    retry.hidden = this.joinState?.phase !== 'uncertain';
    retry.disabled =
      retry.hidden || this.joinStore?.uid !== identity?.uid || navigator.onLine === false;
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
    if (this.invitation !== null) {
      this.status.textContent = identity.emailVerified
        ? 'Accept the campaign invitation to join, or continue without accepting it.'
        : 'Verify your email, then refresh account access before accepting this invitation.';
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
      this.stopJoin?.();
    } finally {
      window.removeEventListener('beforeunload', this.leaving);
      window.removeEventListener('online', this.connectivityChanged);
      window.removeEventListener('offline', this.connectivityChanged);
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
