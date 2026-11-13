import CloudAccount, {
  loadCloudAccount,
  FIREBASE_BROWSER_VERSION,
} from '../../../src/campaigns/CloudAccount.js';
import { logger } from '../../../src/utils/logger/Logger.js';
import manifest from '../../../package.json';

function linkingFixture(provider = 'password') {
  const steps = [];
  const user = {
    uid: 'link-fixture',
    email: 'link@example.invalid',
    displayName: 'Link fixture',
    emailVerified: true,
    providerData: [{ providerId: provider }],
    reload: jest.fn(async () => {
      steps.push('reload');
    }),
    getIdToken: jest.fn(async () => 'private-link-fixture-token'),
  };
  const auth = { currentUser: user };
  const sdk = {
    signInWithEmailAndPassword: jest.fn(),
    signOut: async () => {
      auth.currentUser = null;
    },
    EmailAuthProvider: {
      credential: (email, password) => ({ providerId: 'password', email, password }),
    },
    GoogleAuthProvider: class {
      constructor() {
        this.providerId = 'google.com';
      }
      setCustomParameters(parameters) {
        this.parameters = parameters;
      }
    },
    reauthenticateWithCredential: jest.fn(async (current, credential) => {
      if (credential.password !== 'Existing fixture password')
        throw Object.assign(new Error('PRIVATE PASSWORD DETAIL'), { code: 'auth/wrong-password' });
      steps.push('verify-password');
      return { user: current };
    }),
    reauthenticateWithPopup: jest.fn(async (current) => {
      steps.push('verify-google');
      return { user: current };
    }),
    linkWithPopup: jest.fn(async (current) => {
      steps.push('link-google');
      current.providerData.push({ providerId: 'google.com' });
      return { user: current };
    }),
    linkWithCredential: jest.fn(async (current) => {
      steps.push('link-password');
      current.providerData.push({ providerId: 'password' });
      return { user: current };
    }),
  };
  return { account: new CloudAccount({ auth, sdk }), auth, sdk, user, steps };
}

test('a password identity links Google only after explicit current-credential verification and keeps the same UID', async () => {
  const setup = linkingFixture();
  await expect(setup.account.linkSignInMethod({ provider: 'google.com' })).rejects.toMatchObject({
    code: 'sign-in-verification-required',
  });
  expect(setup.sdk.linkWithPopup).not.toHaveBeenCalled();
  await setup.account.verifySignInMethod({
    provider: 'password',
    password: 'Existing fixture password',
  });
  const result = await setup.account.linkSignInMethod({ provider: 'google.com' });
  expect(result).toEqual({
    uid: 'link-fixture',
    email: 'link@example.invalid',
    emailVerified: true,
    providers: ['google.com', 'password'],
  });
  expect(setup.steps).toEqual(['verify-password', 'link-google', 'reload']);
  expect(setup.sdk.signInWithEmailAndPassword).not.toHaveBeenCalled();
  expect(setup.sdk.linkWithPopup.mock.calls[0][1].parameters).toEqual({ prompt: 'select_account' });
  expect(setup.user.getIdToken).toHaveBeenCalledWith(true);
  expect(JSON.stringify(result)).not.toContain('private-link-fixture-token');
  expect(setup.account.identity().uid).toBe('link-fixture');
});

test('a Google identity adds password sign-in only to its verified managed email after proving the current Google account', async () => {
  const setup = linkingFixture('google.com');
  await setup.account.verifySignInMethod({ provider: 'google.com' });
  await expect(
    setup.account.linkSignInMethod({
      provider: 'password',
      password: 'New linked fixture password',
    })
  ).resolves.toMatchObject({ uid: 'link-fixture', providers: ['google.com', 'password'] });
  expect(setup.steps).toEqual(['verify-google', 'link-password', 'reload']);
  const credential = setup.sdk.linkWithCredential.mock.calls[0][1];
  expect(credential.email).toBe('link@example.invalid');
  expect(credential.password).toBe('New linked fixture password');
  expect(setup.sdk.signInWithEmailAndPassword).not.toHaveBeenCalled();
  expect(setup.auth.currentUser).toBe(setup.user);
});

test('a confirmed same-UID link reports required email re-verification without pretending the link failed', async () => {
  const setup = linkingFixture('google.com');
  await setup.account.verifySignInMethod({ provider: 'google.com' });
  setup.sdk.linkWithCredential.mockImplementationOnce(async (current) => {
    current.providerData.push({ providerId: 'password' });
    current.emailVerified = false;
    return { user: current };
  });
  await expect(
    setup.account.linkSignInMethod({
      provider: 'password',
      password: 'New linked fixture password',
    })
  ).resolves.toMatchObject({
    uid: 'link-fixture',
    emailVerified: false,
    providers: ['google.com', 'password'],
  });
  expect(setup.account.identity().emailVerified).toBe(false);
  expect(setup.sdk.linkWithCredential).toHaveBeenCalledTimes(1);
  await expect(
    setup.account.verifySignInMethod({
      provider: 'password',
      password: 'Existing fixture password',
    })
  ).rejects.toMatchObject({ code: 'email-verification-required' });
  expect(setup.sdk.reauthenticateWithCredential).not.toHaveBeenCalled();
});

test('provider credential conflicts never merge accounts, change the UID or retain reusable verification', async () => {
  const setup = linkingFixture();
  await setup.account.verifySignInMethod({
    provider: 'password',
    password: 'Existing fixture password',
  });
  setup.sdk.linkWithPopup.mockImplementationOnce(async () => {
    throw Object.assign(new Error('PRIVATE PROVIDER CREDENTIAL'), {
      code: 'auth/credential-already-in-use',
      credential: { accessToken: 'PRIVATE PROVIDER CREDENTIAL' },
    });
  });
  let failure;
  try {
    await setup.account.linkSignInMethod({ provider: 'google.com' });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 409, code: 'sign-in-method-conflict' });
  expect(failure.message).not.toContain('PRIVATE PROVIDER CREDENTIAL');
  expect(failure.cause).toBeUndefined();
  expect(setup.account.identity().uid).toBe('link-fixture');
  expect(setup.account.signInMethods().providers).toEqual(['password']);
  await expect(setup.account.linkSignInMethod({ provider: 'google.com' })).rejects.toMatchObject({
    code: 'sign-in-verification-required',
  });
});

test('lost linking replies and failed confirmation remain unconfirmed until an explicit same-account refresh', async () => {
  for (const failureAt of ['link-reply', 'confirmation']) {
    const setup = linkingFixture();
    let linked = false;
    let fail = true;
    setup.user.reload.mockImplementation(async () => {
      if (failureAt === 'confirmation' && fail)
        throw Object.assign(new Error('PRIVATE CONFIRMATION DETAIL'), {
          code: 'auth/network-request-failed',
        });
      if (linked)
        setup.user.providerData = [{ providerId: 'password' }, { providerId: 'google.com' }];
    });
    setup.sdk.linkWithPopup.mockImplementation(async () => {
      linked = true;
      if (failureAt === 'link-reply')
        throw Object.assign(new Error('PRIVATE LINKING DETAIL'), {
          code: 'auth/network-request-failed',
        });
      return { user: setup.user };
    });
    await setup.account.verifySignInMethod({
      provider: 'password',
      password: 'Existing fixture password',
    });
    let failure;
    try {
      await setup.account.linkSignInMethod({ provider: 'google.com' });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ status: 503, code: 'sign-in-link-unconfirmed' });
    expect(failure.message).toContain('unconfirmed');
    expect(failure.message).not.toContain('PRIVATE');
    expect(failure.cause).toBeUndefined();
    expect(setup.account.identity().uid).toBe('link-fixture');
    expect(setup.sdk.linkWithPopup).toHaveBeenCalledTimes(1);
    fail = false;
    await setup.account.refreshIdentity();
    expect(setup.account.signInMethods().providers).toEqual(['google.com', 'password']);
    expect(setup.sdk.linkWithPopup).toHaveBeenCalledTimes(1);
  }
});

test('wrong credentials, unverified identity and popup cancellation never authorize another sign-in method', async () => {
  const password = linkingFixture();
  await expect(
    password.account.verifySignInMethod({
      provider: 'password',
      password: 'Wrong fixture password',
    })
  ).rejects.toMatchObject({ code: 'invalid-credentials' });
  await expect(password.account.linkSignInMethod({ provider: 'google.com' })).rejects.toMatchObject(
    { code: 'sign-in-verification-required' }
  );
  expect(password.sdk.linkWithPopup).not.toHaveBeenCalled();

  const google = linkingFixture('google.com');
  google.user.emailVerified = false;
  await expect(google.account.verifySignInMethod({ provider: 'google.com' })).rejects.toMatchObject(
    { code: 'email-verification-required' }
  );
  expect(google.sdk.reauthenticateWithPopup).not.toHaveBeenCalled();
  google.user.emailVerified = true;
  google.sdk.reauthenticateWithPopup.mockImplementationOnce(async (current) => {
    current.emailVerified = false;
    return { user: current };
  });
  await expect(google.account.verifySignInMethod({ provider: 'google.com' })).rejects.toMatchObject(
    { code: 'email-verification-required' }
  );
  google.user.emailVerified = true;
  await expect(
    google.account.linkSignInMethod({ provider: 'password', password: 'New fixture password' })
  ).rejects.toMatchObject({ code: 'sign-in-verification-required' });
  google.sdk.reauthenticateWithPopup.mockRejectedValueOnce(
    Object.assign(new Error('PRIVATE POPUP DETAIL'), { code: 'auth/popup-closed-by-user' })
  );
  await expect(google.account.verifySignInMethod({ provider: 'google.com' })).rejects.toMatchObject(
    { code: 'sign-in-cancelled' }
  );
  await expect(
    google.account.linkSignInMethod({ provider: 'password', password: 'New fixture password' })
  ).rejects.toMatchObject({ code: 'sign-in-verification-required' });
  expect(google.sdk.linkWithCredential).not.toHaveBeenCalled();
});

test('link verification expires at five minutes and cancellation removes the one-use proof', async () => {
  jest.useFakeTimers();
  try {
    const start = Date.parse('2026-11-12T00:00:00.000Z');
    for (const age of [5 * 60 * 1000 - 1, 5 * 60 * 1000]) {
      const setup = linkingFixture();
      jest.setSystemTime(start);
      await setup.account.verifySignInMethod({
        provider: 'password',
        password: 'Existing fixture password',
      });
      jest.setSystemTime(start + age);
      const link = setup.account.linkSignInMethod({ provider: 'google.com' });
      if (age < 5 * 60 * 1000) await expect(link).resolves.toMatchObject({ uid: 'link-fixture' });
      else {
        await expect(link).rejects.toMatchObject({ code: 'sign-in-verification-required' });
        expect(setup.sdk.linkWithPopup).not.toHaveBeenCalled();
      }
    }
    const cancelled = linkingFixture();
    await cancelled.account.verifySignInMethod({
      provider: 'password',
      password: 'Existing fixture password',
    });
    cancelled.account.cancelSignInLink();
    await expect(
      cancelled.account.linkSignInMethod({ provider: 'google.com' })
    ).rejects.toMatchObject({ code: 'sign-in-verification-required' });
  } finally {
    jest.useRealTimers();
  }
});

test('a late current-credential proof for a different managed account cannot authorize linking', async () => {
  const setup = linkingFixture();
  let release;
  setup.sdk.reauthenticateWithCredential.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      })
  );
  const pending = setup.account.verifySignInMethod({
    provider: 'password',
    password: 'Existing fixture password',
  });
  await Promise.resolve();
  setup.auth.currentUser = { ...setup.user, uid: 'other-fixture' };
  release({ user: setup.user });
  await expect(pending).rejects.toMatchObject({ code: 'account-changed' });
  await expect(setup.account.linkSignInMethod({ provider: 'google.com' })).rejects.toMatchObject({
    code: 'sign-in-verification-required',
  });
  expect(setup.sdk.linkWithPopup).not.toHaveBeenCalled();
});

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
