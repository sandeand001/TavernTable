import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { validateApplicationRuntime } from './CloudRuntime.js';

export const FIREBASE_BROWSER_VERSION = '12.19.0';
const LINK_VERIFICATION_TTL_MS = 5 * 60 * 1000;
const linkingProviders = new Set(['password', 'google.com']);
const verificationRequired = () =>
  new CloudAccountError(
    401,
    'sign-in-verification-required',
    'Verify your existing sign-in method again before linking another method.'
  );

export class CloudAccountError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'CloudAccountError';
    this.status = status;
    this.code = code;
  }
}

const failures = new Map([
  [
    'auth/popup-closed-by-user',
    [400, 'sign-in-cancelled', 'Sign-in was cancelled. No account was changed.'],
  ],
  [
    'auth/cancelled-popup-request',
    [400, 'sign-in-cancelled', 'Sign-in was cancelled. No account was changed.'],
  ],
  ['auth/popup-blocked', [400, 'popup-blocked', 'Allow the sign-in popup, then try Google again.']],
  [
    'auth/account-exists-with-different-credential',
    [
      409,
      'sign-in-method-conflict',
      'Use the existing sign-in method for this account. Linking requires proving both credentials.',
    ],
  ],
  [
    'auth/credential-already-in-use',
    [
      409,
      'sign-in-method-conflict',
      'This sign-in method belongs to another account. Accounts and campaign access were not merged.',
    ],
  ],
  [
    'auth/provider-already-linked',
    [
      409,
      'sign-in-method-already-linked',
      'This sign-in method is already linked. Refresh its current status.',
    ],
  ],
  [
    'auth/user-mismatch',
    [401, 'invalid-credentials', 'Verify the currently signed-in account, not another account.'],
  ],
  [
    'auth/requires-recent-login',
    [
      401,
      'sign-in-verification-required',
      'Verify your existing sign-in method again before linking another method.',
    ],
  ],
  [
    'auth/operation-not-allowed',
    [
      403,
      'sign-in-method-unavailable',
      'This sign-in method is not enabled for the application. No account merge was performed.',
    ],
  ],
  [
    'auth/invalid-credential',
    [401, 'invalid-credentials', 'The email or password was not accepted.'],
  ],
  ['auth/wrong-password', [401, 'invalid-credentials', 'The email or password was not accepted.']],
  ['auth/user-not-found', [401, 'invalid-credentials', 'The email or password was not accepted.']],
  ['auth/invalid-email', [400, 'invalid-email', 'Enter a valid email address.']],
  [
    'auth/weak-password',
    [400, 'weak-password', 'Choose a stronger password with at least six characters.'],
  ],
  [
    'auth/email-already-in-use',
    [409, 'account-exists', 'This email already has an account. Sign in or recover its password.'],
  ],
  ['auth/user-disabled', [403, 'account-disabled', 'This account is disabled. Contact the host.']],
  ['auth/user-token-expired', [401, 'authentication-required', 'Sign in again to continue.']],
  ['auth/invalid-user-token', [401, 'authentication-required', 'Sign in again to continue.']],
  [
    'auth/network-request-failed',
    [503, 'auth-unavailable', 'Cloud sign-in is unavailable. Retry online.'],
  ],
  [
    'auth/unsupported-persistence-type',
    [
      503,
      'auth-persistence-unavailable',
      'Enable browser storage before signing in. No local campaign fallback was selected.',
    ],
  ],
  [
    'auth/web-storage-unsupported',
    [
      503,
      'auth-persistence-unavailable',
      'Enable browser storage before signing in. No local campaign fallback was selected.',
    ],
  ],
  [
    'auth/too-many-requests',
    [429, 'auth-rate-limited', 'Too many sign-in attempts. Please wait before retrying.'],
  ],
]);
const accountChanged = () =>
  new CloudAccountError(
    409,
    'account-changed',
    'The signed-in account changed. Reopen its campaigns.'
  );

function providerFailure(error, operation) {
  if (error instanceof CloudAccountError) return error;
  const known = failures.get(error?.code);
  if (known) return new CloudAccountError(...known);
  logger.log(LOG_LEVEL.ERROR, 'The managed sign-in provider failed', LOG_CATEGORY.SYSTEM, {
    component: 'CloudAccount',
    operation,
    code: 'unexpected-auth-error',
    kind: error instanceof Error ? 'error' : 'non-error',
  });
  return new CloudAccountError(
    503,
    'auth-unavailable',
    'Cloud sign-in could not complete. Retry online.'
  );
}

export default class CloudAccount {
  constructor({ auth, sdk }) {
    if (
      !auth ||
      !sdk ||
      ['signInWithEmailAndPassword', 'signOut'].some((method) => typeof sdk[method] !== 'function')
    )
      throw new Error('Cloud accounts require the managed Firebase Auth interface');
    this.auth = auth;
    this.sdk = sdk;
    this.linkVerification = null;
    this.linkBusy = false;
    this.lastUid = auth.currentUser?.uid ?? null;
    this.invalidators = new Set();
  }

  async _request(operation, request) {
    try {
      return await request();
    } catch (error) {
      throw providerFailure(error, operation);
    }
  }

  async ready() {
    if (typeof this.auth.authStateReady !== 'function')
      throw new Error('Managed account persistence restoration is unavailable');
    await this._request('restoreIdentity', () => this.auth.authStateReady());
    return this.identity();
  }

  subscribe(onIdentity, onFailure) {
    if (
      typeof onIdentity !== 'function' ||
      typeof onFailure !== 'function' ||
      typeof this.sdk.onAuthStateChanged !== 'function'
    )
      throw new Error('Managed account observation requires identity and error listeners');
    return this.sdk.onAuthStateChanged(
      this.auth,
      () => onIdentity(this.identity()),
      (error) => onFailure(providerFailure(error, 'observeIdentity'))
    );
  }

  onInvalidated(listener) {
    if (typeof listener !== 'function')
      throw new Error('Private account cleanup requires an invalidation listener');
    this.invalidators.add(listener);
    return () => this.invalidators.delete(listener);
  }

  _invalidate(uid) {
    const tasks = [];
    for (const listener of this.invalidators) {
      try {
        tasks.push(listener(uid));
      } catch (error) {
        tasks.push(Promise.reject(error));
      }
    }
    const pending = Promise.all(tasks).then(() => {});
    void pending.catch(() => {
      logger.log(
        LOG_LEVEL.ERROR,
        'Private account cleanup could not complete',
        LOG_CATEGORY.SYSTEM,
        {
          component: 'CloudAccount',
          code: 'private-account-cleanup-failed',
        }
      );
    });
    return pending;
  }

  _observeUid(uid) {
    const previous = this.lastUid;
    this.lastUid = uid;
    if (previous !== null && previous !== uid) this._invalidate(previous);
  }

  identity() {
    const user = this.auth.currentUser;
    if (user === null) {
      this._observeUid(null);
      return null;
    }
    if (
      !user ||
      typeof user.uid !== 'string' ||
      !user.uid ||
      typeof user.emailVerified !== 'boolean'
    )
      throw new CloudAccountError(
        503,
        'invalid-auth-state',
        'The managed account identity is invalid. Sign in again.'
      );
    this._observeUid(user.uid);
    return Object.freeze({
      uid: user.uid,
      email: typeof user.email === 'string' ? user.email : null,
      displayName: typeof user.displayName === 'string' ? user.displayName : null,
      emailVerified: user.emailVerified,
    });
  }

  signInMethods() {
    const identity = this.identity();
    if (identity === null)
      throw new CloudAccountError(
        401,
        'authentication-required',
        'Sign in before managing sign-in methods.'
      );
    const providers = this.auth.currentUser.providerData;
    if (
      !Array.isArray(providers) ||
      providers.length === 0 ||
      providers.some((provider) => !linkingProviders.has(provider?.providerId)) ||
      new Set(providers.map((provider) => provider.providerId)).size !== providers.length
    )
      throw new CloudAccountError(
        503,
        'unsupported-sign-in-method',
        'The account sign-in methods could not be verified.'
      );
    return Object.freeze({
      uid: identity.uid,
      email: identity.email,
      emailVerified: identity.emailVerified,
      providers: Object.freeze(providers.map((provider) => provider.providerId).sort()),
    });
  }

  _linkUser() {
    const methods = this.signInMethods();
    if (!methods.emailVerified || typeof methods.email !== 'string' || !methods.email)
      throw new CloudAccountError(
        403,
        'email-verification-required',
        'Verify your current email before linking sign-in methods.'
      );
    return this.auth.currentUser;
  }

  _sameLinkUser(user, uid, result) {
    if (this.auth.currentUser !== user || user.uid !== uid || result?.user?.uid !== uid)
      throw accountChanged();
    this.signInMethods();
  }

  async verifySignInMethod({ provider, password } = {}) {
    if (this.linkBusy)
      throw new CloudAccountError(
        409,
        'account-operation-pending',
        'Finish the current sign-in change first.'
      );
    this.linkVerification = null;
    const user = this._linkUser();
    const uid = user.uid;
    if (!linkingProviders.has(provider) || !this.signInMethods().providers.includes(provider))
      throw verificationRequired();
    this.linkBusy = true;
    try {
      const result = await this._request('verifySignInMethod', () => {
        if (provider === 'password') {
          if (typeof password !== 'string' || !password)
            throw new CloudAccountError(
              400,
              'invalid-credentials',
              'Enter your existing account password.'
            );
          return this.sdk.reauthenticateWithCredential(
            user,
            this.sdk.EmailAuthProvider.credential(user.email, password)
          );
        }
        const google = new this.sdk.GoogleAuthProvider();
        google.setCustomParameters({ prompt: 'select_account' });
        return this.sdk.reauthenticateWithPopup(user, google);
      });
      this._sameLinkUser(user, uid, result);
      this._linkUser();
      this.linkVerification = { user, uid, provider, verifiedAt: Date.now() };
      return this.signInMethods();
    } finally {
      this.linkBusy = false;
    }
  }

  cancelSignInLink() {
    if (this.linkBusy)
      throw new CloudAccountError(
        409,
        'account-operation-pending',
        'Finish the current sign-in change first.'
      );
    this.linkVerification = null;
  }

  async linkSignInMethod({ provider, password } = {}) {
    if (this.linkBusy)
      throw new CloudAccountError(
        409,
        'account-operation-pending',
        'Finish the current sign-in change first.'
      );
    const proof = this.linkVerification;
    this.linkVerification = null;
    const user = this._linkUser();
    if (!linkingProviders.has(provider))
      throw new CloudAccountError(
        400,
        'unsupported-sign-in-method',
        'Choose Google or email/password linking.'
      );
    if (this.signInMethods().providers.includes(provider))
      throw new CloudAccountError(
        409,
        'sign-in-method-already-linked',
        'This sign-in method is already linked.'
      );
    if (
      !proof ||
      proof.user !== user ||
      proof.uid !== user.uid ||
      proof.provider === provider ||
      Date.now() < proof.verifiedAt ||
      Date.now() - proof.verifiedAt >= LINK_VERIFICATION_TTL_MS
    )
      throw verificationRequired();
    this.linkBusy = true;
    let accepted = false;
    try {
      const result = await this._request('linkSignInMethod', () => {
        if (provider === 'password') {
          if (typeof password !== 'string' || password.length < 6)
            throw new CloudAccountError(
              400,
              'weak-password',
              'Choose a password with at least six characters.'
            );
          return this.sdk.linkWithCredential(
            user,
            this.sdk.EmailAuthProvider.credential(user.email, password)
          );
        }
        const google = new this.sdk.GoogleAuthProvider();
        google.setCustomParameters({ prompt: 'select_account' });
        return this.sdk.linkWithPopup(user, google);
      });
      accepted = true;
      this._sameLinkUser(user, proof.uid, result);
      await this.refreshIdentity();
      const methods = this.signInMethods();
      if (methods.uid !== proof.uid) throw accountChanged();
      if (!methods.providers.includes(provider))
        throw new CloudAccountError(
          503,
          'invalid-auth-state',
          'The linked sign-in method was not confirmed.'
        );
      return methods;
    } catch (error) {
      if (error.code !== 'account-changed' && (accepted || error.code === 'auth-unavailable'))
        throw new CloudAccountError(
          503,
          'sign-in-link-unconfirmed',
          'This sign-in change is unconfirmed. Refresh sign-in methods with the same account before trying again.'
        );
      throw error;
    } finally {
      this.linkBusy = false;
    }
  }

  async signInEmail(email, password) {
    this.linkVerification = null;
    await this._request('signInEmail', () =>
      this.sdk.signInWithEmailAndPassword(this.auth, email, password)
    );
    const identity = this.identity();
    if (identity === null)
      throw new CloudAccountError(
        503,
        'invalid-auth-state',
        'Sign-in completed without an account identity. Retry online.'
      );
    return identity;
  }

  async signInGoogle() {
    this.linkVerification = null;
    const provider = new this.sdk.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    await this._request('signInGoogle', () => this.sdk.signInWithPopup(this.auth, provider));
    const identity = this.identity();
    if (identity === null)
      throw new CloudAccountError(
        503,
        'invalid-auth-state',
        'Google sign-in completed without an account identity. Retry online.'
      );
    return identity;
  }

  async registerEmail(email, password) {
    this.linkVerification = null;
    await this._request('registerEmail', () =>
      this.sdk.createUserWithEmailAndPassword(this.auth, email, password)
    );
    if (this.identity() === null)
      throw new CloudAccountError(
        503,
        'invalid-auth-state',
        'Registration completed without an account identity. Retry online.'
      );
    return this.sendVerification();
  }

  async sendVerification() {
    const user = this.auth.currentUser;
    if (!user)
      throw new CloudAccountError(
        401,
        'authentication-required',
        'Sign in before requesting email verification.'
      );
    await this._request('sendVerification', () => this.sdk.sendEmailVerification(user));
    if (this.auth.currentUser !== user) throw accountChanged();
    return this.identity();
  }

  async refreshIdentity() {
    const user = this.auth.currentUser;
    if (!user)
      throw new CloudAccountError(
        401,
        'authentication-required',
        'Sign in before refreshing email verification.'
      );
    await this._request('refreshIdentity', () => user.reload());
    if (this.auth.currentUser !== user) throw accountChanged();
    await this.tokenContext(true);
    if (this.auth.currentUser !== user) throw accountChanged();
    return this.identity();
  }

  async resetPassword(email) {
    await this._request('resetPassword', async () => {
      try {
        await this.sdk.sendPasswordResetEmail(this.auth, email);
      } catch (error) {
        // Keep recovery private when older providers reveal a missing account.
        if (error?.code !== 'auth/user-not-found') throw error;
      }
    });
  }

  async signOut() {
    this.linkVerification = null;
    const uid = this.identity()?.uid;
    if (uid) await this._invalidate(uid);
    await this._request('signOut', () => this.sdk.signOut(this.auth));
    if (this.auth.currentUser !== null)
      throw new CloudAccountError(
        503,
        'invalid-auth-state',
        'Sign-out did not complete. Please retry.'
      );
    this.lastUid = null;
  }

  async tokenContext(forceRefresh = false) {
    const user = this.auth.currentUser;
    if (!user)
      throw new CloudAccountError(
        401,
        'authentication-required',
        'Sign in before using cloud campaigns.'
      );
    const token = await this._request('token', () => user.getIdToken(forceRefresh));
    if (this.auth.currentUser !== user) throw accountChanged();
    if (typeof token !== 'string' || !token)
      throw new CloudAccountError(
        503,
        'invalid-auth-state',
        'The managed account token is unavailable. Sign in again.'
      );
    return Object.freeze({
      uid: user.uid,
      token,
      isCurrent: () => this.auth.currentUser === user,
    });
  }
}

export async function loadCloudAccount(value, { baseURL = globalThis.location?.href } = {}) {
  const runtime = validateApplicationRuntime(value, { baseURL });
  if (runtime.mode !== 'cloud')
    throw new CloudAccountError(
      400,
      'cloud-mode-required',
      'Choose explicit cloud mode before loading managed sign-in.'
    );
  let apps;
  let sdk;
  try {
    [apps, sdk] = await Promise.all([
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_BROWSER_VERSION}/firebase-app.js`),
      import(`https://www.gstatic.com/firebasejs/${FIREBASE_BROWSER_VERSION}/firebase-auth.js`),
    ]);
  } catch (error) {
    throw providerFailure(error, 'loadSdk');
  }
  let app;
  try {
    app = apps.initializeApp(runtime.firebase, `taverntable-cloud-${runtime.firebase.projectId}`);
    const auth = sdk.getAuth(app);
    if (runtime.environment === 'emulator')
      sdk.connectAuthEmulator(auth, runtime.authEmulatorOrigin);
    await sdk.setPersistence(auth, sdk.indexedDBLocalPersistence);
    const account = new CloudAccount({ auth, sdk });
    await account.ready();
    let closing = null;
    return Object.freeze({
      account,
      close: () => {
        if (!closing)
          closing = apps.deleteApp(app).catch((error) => {
            throw providerFailure(error, 'closeSdk');
          });
        return closing;
      },
    });
  } catch (error) {
    const failure = providerFailure(error, 'initializeSdk');
    if (app) {
      try {
        await apps.deleteApp(app);
      } catch (cleanupError) {
        throw Object.assign(
          new AggregateError(
            [failure, providerFailure(cleanupError, 'closeSdk')],
            'Cloud sign-in could not initialize or close its client safely.'
          ),
          {
            status: 503,
            code: 'auth-unavailable',
          }
        );
      }
    }
    throw failure;
  }
}
