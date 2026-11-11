import CloudAccountLogin from '../../../src/ui/sessions/CloudAccountLogin.js';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';

const runtime = {
  version: 1,
  mode: 'cloud',
  environment: 'emulator',
  apiOrigin: 'http://127.0.0.1:19410',
  authEmulatorOrigin: 'http://127.0.0.1:19099',
  firebase: {
    apiKey: 'demo-api-key',
    projectId: 'demo-taverntable',
    authDomain: 'demo-taverntable.firebaseapp.com',
    appId: 'demo-login',
  },
};

function fixture() {
  const listeners = new Set();
  const submitted = [];
  const auth = { currentUser: null, authStateReady: async () => {} };
  const sdk = {
    signInWithEmailAndPassword: async (_auth, email, password) => {
      submitted.push({ email, password });
      auth.currentUser = {
        uid: 'email-fixture',
        email,
        emailVerified: true,
        getIdToken: async () => 'fixture-token',
      };
      for (const listener of listeners) listener(auth.currentUser);
      return { user: auth.currentUser };
    },
    signOut: async () => {
      auth.currentUser = null;
      for (const listener of listeners) listener(null);
    },
    onAuthStateChanged: (_auth, listener) => {
      listeners.add(listener);
      queueMicrotask(() => listener(auth.currentUser));
      return () => listeners.delete(listener);
    },
  };
  const account = new CloudAccount({ auth, sdk });
  const fetch = jest.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      version: 1,
      result: { uid: auth.currentUser.uid, emailVerified: true, eligible: true },
    }),
  }));
  const connection = new CloudAccountConnection({
    account,
    runtime,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
  });
  return { account, connection, submitted, fetch };
}

afterEach(() => {
  document.body.innerHTML = '';
});

test('the real account form uses managed credentials, clears the password and resolves only an approved same-UID profile', async () => {
  const setup = fixture();
  const outside = document.createElement('button');
  outside.textContent = 'Existing game controls';
  outside.inert = false;
  document.body.append(outside);
  outside.focus();
  const dialog = new CloudAccountLogin({
    account: setup.account,
    connection: setup.connection,
    runtime,
  });
  const selected = dialog.choose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const root = document.querySelector('[role="dialog"][aria-label="Cloud account sign-in"]');
  expect(root).not.toBeNull();
  expect(outside.inert).toBe(true);
  const email = root.querySelector('[aria-label="Email address"]');
  const password = root.querySelector('[aria-label="Account password"]');
  email.value = 'owner@example.invalid';
  password.value = ' keep spaces in password ';
  root
    .querySelector('[data-email-login]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await expect(selected).resolves.toEqual({
    uid: 'email-fixture',
    emailVerified: true,
    eligible: true,
  });
  expect(setup.submitted).toEqual([
    { email: 'owner@example.invalid', password: ' keep spaces in password ' },
  ]);
  expect(password.value).toBe('');
  expect(document.querySelector('[aria-label="Cloud account sign-in"]')).toBeNull();
  expect(outside.inert).toBe(false);
  expect(document.activeElement).toBe(outside);
  expect(setup.fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer fixture-token');
});
