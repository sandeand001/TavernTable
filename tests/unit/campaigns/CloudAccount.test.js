import CloudAccount, {
  loadCloudAccount,
  FIREBASE_BROWSER_VERSION,
} from '../../../src/campaigns/CloudAccount.js';
import { logger } from '../../../src/utils/logger/Logger.js';
import manifest from '../../../package.json';

test('Google sign-in exposes only managed identity and cancellation never changes identity or exposes provider credentials', async () => {
  const auth = { currentUser: null };
  let cancel = false;
  const sdk = {
    signInWithEmailAndPassword: async () => {
      throw new Error('Email sign-in is not used');
    },
    signOut: async () => {
      auth.currentUser = null;
    },
    GoogleAuthProvider: class {
      constructor() {
        this.providerId = 'google.com';
      }
      setCustomParameters(parameters) {
        this.parameters = parameters;
      }
    },
    signInWithPopup: async (_auth, provider) => {
      expect(provider.providerId).toBe('google.com');
      expect(provider.parameters).toEqual({ prompt: 'select_account' });
      if (cancel)
        throw Object.assign(new Error('PRIVATE OAUTH TOKEN'), {
          code: 'auth/popup-closed-by-user',
          credential: { accessToken: 'PRIVATE OAUTH TOKEN' },
        });
      auth.currentUser = {
        uid: 'google-fixture',
        email: 'google@example.invalid',
        displayName: 'Fixture',
        emailVerified: true,
        refreshToken: 'PRIVATE OAUTH TOKEN',
      };
      return { user: auth.currentUser, credential: { accessToken: 'PRIVATE OAUTH TOKEN' } };
    },
  };
  const account = new CloudAccount({ auth, sdk });
  const identity = await account.signInGoogle();
  expect(identity).toEqual({
    uid: 'google-fixture',
    email: 'google@example.invalid',
    displayName: 'Fixture',
    emailVerified: true,
  });
  expect(Object.isFrozen(identity)).toBe(true);
  await account.signOut();
  cancel = true;
  let failure;
  try {
    await account.signInGoogle();
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 400, code: 'sign-in-cancelled' });
  expect(failure.message).not.toContain('PRIVATE OAUTH TOKEN');
  expect(failure.cause).toBeUndefined();
  expect(account.identity()).toBe(null);
});

test('known and unexpected provider failures never expose password/token-bearing errors in UI errors or logs', async () => {
  const log = jest.spyOn(logger, 'log').mockImplementation(() => {});
  const auth = { currentUser: null };
  let code = 'auth/wrong-password';
  const sdk = {
    signInWithEmailAndPassword: async () => {
      throw Object.assign(new Error('PRIVATE PASSWORD AND TOKEN'), {
        code,
        credential: { accessToken: 'PRIVATE PASSWORD AND TOKEN' },
      });
    },
    signOut: async () => {},
  };
  const account = new CloudAccount({ auth, sdk });
  try {
    for (const [providerCode, status, safeCode] of [
      ['auth/wrong-password', 401, 'invalid-credentials'],
      ['auth/network-request-failed', 503, 'auth-unavailable'],
      ['PRIVATE PASSWORD AND TOKEN', 503, 'auth-unavailable'],
    ]) {
      code = providerCode;
      let failure;
      try {
        await account.signInEmail('fixture@example.invalid', 'PRIVATE PASSWORD AND TOKEN');
      } catch (error) {
        failure = error;
      }
      expect(failure).toMatchObject({ status, code: safeCode });
      expect(failure.message).not.toContain('PRIVATE PASSWORD AND TOKEN');
      expect(failure.cause).toBeUndefined();
      expect(account.identity()).toBe(null);
    }
    expect(JSON.stringify(log.mock.calls)).not.toContain('PRIVATE PASSWORD AND TOKEN');
    expect(log).toHaveBeenCalled();
  } finally {
    log.mockRestore();
  }
});

test('managed restoration and identity observation publish safe identity changes and explicit provider failures', async () => {
  const stored = {
    uid: 'returning-uid',
    email: 'returning@example.invalid',
    emailVerified: true,
    refreshToken: 'PRIVATE TOKEN',
  };
  const auth = {
    currentUser: null,
    authStateReady: async () => {
      auth.currentUser = stored;
    },
  };
  let changed;
  let failed;
  const unsubscribe = jest.fn();
  const sdk = {
    signInWithEmailAndPassword: async () => {
      throw new Error('Already restored');
    },
    signOut: async () => {
      auth.currentUser = null;
    },
    onAuthStateChanged: (_auth, onChange, onFailure) => {
      changed = onChange;
      failed = onFailure;
      return unsubscribe;
    },
  };
  const account = new CloudAccount({ auth, sdk });
  const restored = await account.ready();
  expect(restored.uid).toBe('returning-uid');
  expect(JSON.stringify(restored)).not.toContain('PRIVATE TOKEN');
  const identities = jest.fn();
  const failures = jest.fn();
  const stop = account.subscribe(identities, failures);
  changed(stored);
  expect(identities).toHaveBeenLastCalledWith(restored);
  auth.currentUser = null;
  changed(null);
  expect(identities).toHaveBeenLastCalledWith(null);
  failed(Object.assign(new Error('PRIVATE TOKEN'), { code: 'auth/network-request-failed' }));
  expect(failures.mock.calls[0][0]).toMatchObject({ status: 503, code: 'auth-unavailable' });
  expect(failures.mock.calls[0][0].message).not.toContain('PRIVATE TOKEN');
  stop();
  expect(unsubscribe).toHaveBeenCalledTimes(1);
});

test('the browser SDK pin matches the verified package graph and local mode cannot initialize cloud identity', async () => {
  expect(FIREBASE_BROWSER_VERSION).toBe(manifest.dependencies.firebase);
  await expect(
    loadCloudAccount({ version: 1, mode: 'local' }, { baseURL: 'http://127.0.0.1:19410/' })
  ).rejects.toMatchObject({ status: 400, code: 'cloud-mode-required' });
  await expect(
    loadCloudAccount(
      { version: 1, mode: 'cloud', environment: 'invalid' },
      { baseURL: 'http://127.0.0.1:19410/' }
    )
  ).rejects.toMatchObject({ status: 503, code: 'invalid-cloud-runtime' });
});
