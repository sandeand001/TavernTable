import { logger, LOG_LEVEL, LOG_CATEGORY } from '../utils/logger/Logger.js';
import { validateApplicationRuntime } from './CloudRuntime.js';

export const FIREBASE_BROWSER_VERSION = '12.19.0';

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

  identity() {
    const user = this.auth.currentUser;
    if (user === null) return null;
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
    return Object.freeze({
      uid: user.uid,
      email: typeof user.email === 'string' ? user.email : null,
      displayName: typeof user.displayName === 'string' ? user.displayName : null,
      emailVerified: user.emailVerified,
    });
  }

  async signInEmail(email, password) {
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
    await this._request('signOut', () => this.sdk.signOut(this.auth));
    if (this.auth.currentUser !== null)
      throw new CloudAccountError(
        503,
        'invalid-auth-state',
        'Sign-out did not complete. Please retry.'
      );
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
