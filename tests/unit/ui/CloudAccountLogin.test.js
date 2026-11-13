import CloudAccountLogin, {
  consumeCloudInvitation,
  reopenCloudInvitation,
  watchCloudInvitationNavigation,
} from '../../../src/ui/sessions/CloudAccountLogin.js';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';
import CloudAccountMethods from '../../../src/ui/sessions/CloudAccountMethods.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

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

function fixture({ emailVerified = true, uidForEmail = () => 'email-fixture' } = {}) {
  const listeners = new Set();
  const submitted = [];
  const auth = { currentUser: null, authStateReady: async () => {} };
  const sdk = {
    signInWithEmailAndPassword: async (_auth, email, password) => {
      submitted.push({ email, password });
      const uid = uidForEmail(email);
      auth.currentUser = {
        uid,
        email,
        emailVerified,
        getIdToken: async () => (uid === 'email-fixture' ? 'fixture-token' : uid + '-token'),
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
  jest.restoreAllMocks();
});

test('a signed-in account can manage its own providers before campaign eligibility without opening campaign data', async () => {
  jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const setup = fixture();
  await setup.account.signInEmail('methods@example.invalid', 'Private fixture password');
  setup.fetch.mockImplementation(async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      version: 1,
      code: 'pilot-access-required',
      error: 'Campaign participation is not yet enabled.',
    }),
  }));
  const open = jest.spyOn(CloudAccountMethods.prototype, 'open').mockResolvedValue(true);
  const dialog = new CloudAccountLogin({
    account: setup.account,
    connection: setup.connection,
    runtime,
  });
  const selected = dialog.choose().catch((error) => error);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const button = dialog.root.querySelector('[data-account-methods]');
  expect(button.hidden).toBe(false);
  expect(button.disabled).toBe(false);
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(open).toHaveBeenCalledTimes(1);
  expect(open.mock.instances[0].account).toBe(setup.account);
  expect(setup.fetch.mock.calls.every(([url]) => url.endsWith('/account'))).toBe(true);
  dialog.destroy();
  expect((await selected).code).toBe('account-dialog-closed');
});

test('invitation credentials leave browser history before managed sign-in and malformed links never echo their secret', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const secret = 'a'.repeat(64);
  const history = { replaceState: jest.fn() };
  const location = { pathname: '/', search: '?test=1', hash: `#invite=${id}.${secret}` };
  expect(consumeCloudInvitation({ location, history })).toEqual({ version: 1, id, secret });
  expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '/?test=1');
  history.replaceState.mockClear();
  location.hash = `#invite=malformed.${secret}`;
  let failure;
  try {
    consumeCloudInvitation({ location, history });
  } catch (error) {
    failure = error;
  }
  expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '/?test=1');
  expect(failure.message).toContain('invitation is invalid');
  expect(failure.message).not.toContain(secret);
  expect(failure.cause).toBeUndefined();
  history.replaceState.mockClear();
  location.hash = '#unrelated-view';
  expect(consumeCloudInvitation({ location, history })).toBeNull();
  expect(history.replaceState).not.toHaveBeenCalled();
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

test('a same-document invitation is immediately removed from history and offered by the existing sign-in screen', async () => {
  const setup = fixture();
  const dialog = new CloudAccountLogin({ ...setup, runtime });
  const selected = dialog.choose();
  const closed = expect(selected).rejects.toMatchObject({ code: 'account-dialog-closed' });
  const onFailure = jest.fn();
  let stop;
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    stop = watchCloudInvitationNavigation({
      onInvitation: (invitation) => dialog.receiveInvitation(invitation),
      onFailure,
    });
    const fragment = '#invite=11111111-1111-4111-8111-111111111111.' + 'a'.repeat(64);
    window.history.replaceState(null, '', '/' + fragment);
    window.dispatchEvent(new Event('hashchange'));
    expect(location.hash).toBe('');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.root.querySelector('[data-campaign-invitation]').hidden).toBe(false);
    expect(dialog.root.querySelector('[data-accept-invitation]').disabled).toBe(true);
    expect(setup.fetch).not.toHaveBeenCalled();
    expect(onFailure).not.toHaveBeenCalled();
    stop();
    window.history.replaceState(null, '', '/' + fragment);
    window.dispatchEvent(new Event('hashchange'));
    expect(location.hash).toBe(fragment);
  } finally {
    stop?.();
    window.history.replaceState(null, '', '/');
    dialog.destroy();
    await closed;
  }
});

test('a newly received invitation invalidates an in-flight profile result instead of silently dismissing acceptance', async () => {
  const setup = fixture();
  await setup.account.signInEmail('returning@example.invalid', 'Synthetic fixture password');
  let releaseProfile;
  const response = {
    ok: true,
    status: 200,
    json: async () => ({
      version: 1,
      result: { uid: 'email-fixture', emailVerified: true, eligible: true },
    }),
  };
  setup.fetch.mockImplementationOnce(
    () => new Promise((resolve) => (releaseProfile = () => resolve(response)))
  );
  const dialog = new CloudAccountLogin({ ...setup, runtime });
  const selected = dialog.choose();
  let resolved = false;
  selected.then(() => {
    resolved = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setup.fetch).toHaveBeenCalledTimes(1);
  dialog.receiveInvitation({
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    secret: 'a'.repeat(64),
  });
  releaseProfile();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(resolved).toBe(false);
  expect(dialog.root.querySelector('[data-accept-invitation]').disabled).toBe(false);
  dialog.root.querySelector('[data-skip-invitation]').click();
  await expect(selected).resolves.toMatchObject({ uid: 'email-fixture' });
  expect(setup.fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});

test('an invitation received in a campaign waits for canonical flushes and the pending receipt before reloading', async () => {
  const order = [];
  let releaseScene;
  let releaseReceipt;
  const scene = new Promise((resolve) => (releaseScene = resolve));
  const receipt = new Promise((resolve) => (releaseReceipt = resolve));
  const invitation = {
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    secret: 'a'.repeat(64),
  };
  const workspace = {
    store: { storageInfo: { kind: 'cloud' }, pending: { promise: receipt } },
    active: {
      autosave: {
        flush: async () => {
          order.push('scene');
          await scene;
        },
      },
      library: {
        flush: async () => {
          order.push('characters');
        },
      },
    },
  };
  const saveFeedback = {
    pauseForExit: async (operation) => {
      order.push('pause');
      try {
        await operation();
      } finally {
        order.push('resume');
      }
    },
  };
  const history = { replaceState: jest.fn(() => order.push('private-fragment')) };
  const location = {
    pathname: '/index.html',
    search: '?pane=campaigns',
    reload: jest.fn(() => order.push('reload')),
  };
  const navigation = reopenCloudInvitation({
    invitation,
    workspace,
    saveFeedback,
    location,
    history,
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(order).toEqual(['pause', 'scene']);
  expect(history.replaceState).not.toHaveBeenCalled();
  releaseScene();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(order).toEqual(['pause', 'scene', 'characters']);
  expect(location.reload).not.toHaveBeenCalled();
  releaseReceipt();
  await navigation;
  expect(order).toEqual(['pause', 'scene', 'characters', 'private-fragment', 'reload', 'resume']);
  expect(history.replaceState).toHaveBeenCalledWith(
    null,
    '',
    '/index.html?pane=campaigns#invite=' + invitation.id + '.' + invitation.secret
  );
});

test('a failed canonical flush never puts a new invitation back in history or reloads away unsaved work', async () => {
  const failure = new Error('Synthetic unconfirmed scene');
  const history = { replaceState: jest.fn() };
  const location = { pathname: '/', search: '', reload: jest.fn() };
  const workspace = {
    store: { storageInfo: { kind: 'cloud' }, pending: null },
    active: {
      autosave: {
        flush: async () => {
          throw failure;
        },
      },
      library: { flush: jest.fn() },
    },
  };
  await expect(
    reopenCloudInvitation({
      invitation: {
        version: 1,
        id: '11111111-1111-4111-8111-111111111111',
        secret: 'a'.repeat(64),
      },
      workspace,
      location,
      history,
      saveFeedback: { pauseForExit: (operation) => operation() },
    })
  ).rejects.toBe(failure);
  expect(history.replaceState).not.toHaveBeenCalled();
  expect(location.reload).not.toHaveBeenCalled();
  expect(workspace.active.library.flush).not.toHaveBeenCalled();
});

test('malformed same-document links are stripped and reported without forwarding their proof', () => {
  const onInvitation = jest.fn();
  const onFailure = jest.fn();
  const stop = watchCloudInvitationNavigation({ onInvitation, onFailure });
  const secret = 'a'.repeat(64);
  try {
    window.history.replaceState(null, '', '/#invite=malformed.' + secret);
    window.dispatchEvent(new Event('hashchange'));
    expect(location.hash).toBe('');
    expect(onInvitation).not.toHaveBeenCalled();
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(onFailure.mock.calls[0][0].message).not.toContain(secret);
    expect(onFailure.mock.calls[0][0].cause).toBeUndefined();
  } finally {
    stop();
    window.history.replaceState(null, '', '/');
  }
});

test('a refused browser reload removes the private fragment again and reports a sanitized navigation failure', async () => {
  const secret = 'a'.repeat(64);
  const history = { replaceState: jest.fn() };
  const location = {
    pathname: '/',
    search: '',
    reload: () => {
      throw new Error('PRIVATE NAVIGATION DETAIL ' + secret);
    },
  };
  let failure;
  try {
    await reopenCloudInvitation({
      invitation: { version: 1, id: '11111111-1111-4111-8111-111111111111', secret },
      workspace: { store: { storageInfo: { kind: 'cloud' }, pending: null }, active: null },
      saveFeedback: { pauseForExit: (operation) => operation() },
      location,
      history,
    });
  } catch (error) {
    failure = error;
  }
  expect(failure.message).toContain('invitation could not open');
  expect(failure.message).not.toContain(secret);
  expect(failure.message).not.toContain('PRIVATE NAVIGATION DETAIL');
  expect(failure.cause).toBeUndefined();
  expect(history.replaceState).toHaveBeenLastCalledWith(null, '', '/');
});

test('a verified new account explicitly accepts its invitation and retries an uncertain acceptance with the original command', async () => {
  const setup = fixture({
    uidForEmail: (email) => (email.startsWith('other@') ? 'other-fixture' : 'email-fixture'),
  });
  const invitation = {
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    secret: 'a'.repeat(64),
  };
  const receipt = {
    version: 1,
    invitationId: invitation.id,
    access: {
      version: 1,
      role: 'member',
      seatId: '22222222-2222-4222-8222-222222222222',
      campaign: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Invited campaign',
        ruleset: '2014',
        coreVersion: '5.1',
      },
    },
  };
  const acceptances = [];
  let enabled = false;
  setup.fetch.mockImplementation(async (url, options) => {
    if (url.endsWith('/invitations/redeem')) {
      acceptances.push(options.body);
      enabled = true;
      if (acceptances.length === 1) throw new TypeError('Synthetic lost acceptance reply');
      return { ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) };
    }
    return {
      ok: enabled,
      status: enabled ? 200 : 403,
      json: async () =>
        enabled
          ? {
              version: 1,
              result: { uid: 'email-fixture', emailVerified: true, eligible: true },
            }
          : { version: 1, code: 'pilot-access-required', error: 'Not enabled' },
    };
  });
  const dialog = new CloudAccountLogin({
    account: setup.account,
    connection: setup.connection,
    runtime,
    invitation,
    crypto: webcrypto,
  });
  const selected = dialog.choose();
  let resolved = false;
  void selected.then(() => {
    resolved = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  dialog.email.value = 'new-player@example.invalid';
  dialog.password.value = 'Synthetic fixture password';
  dialog.root
    .querySelector('[data-email-login]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(resolved).toBe(false);
  expect(acceptances).toHaveLength(0);
  const accept = dialog.root.querySelector('[data-accept-invitation]');
  expect(accept).not.toBeNull();
  expect(accept.disabled).toBe(false);
  accept.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(resolved).toBe(false);
  expect(dialog.status.textContent).toContain('Unconfirmed');
  const retry = dialog.root.querySelector('[data-retry-invitation]');
  expect(retry.hidden).toBe(false);
  expect(retry.disabled).toBe(false);
  expect(dialog.root.querySelector('[data-account-signout]').disabled).toBe(true);
  expect(() =>
    dialog.receiveInvitation({
      version: 1,
      id: '55555555-5555-4555-8555-555555555555',
      secret: 'b'.repeat(64),
    })
  ).toThrow('Finish the current invitation acceptance');
  const originalEmail = setup.account.identity().email;
  await setup.account.signInEmail('other@example.invalid', 'Synthetic fixture password');
  expect(retry.disabled).toBe(true);
  expect(dialog.root.querySelector('[data-account-signout]').disabled).toBe(true);
  await setup.account.signInEmail(originalEmail, 'Synthetic fixture password');
  expect(retry.disabled).toBe(false);
  expect(acceptances).toHaveLength(1);
  retry.click();
  await expect(selected).resolves.toEqual({
    uid: 'email-fixture',
    emailVerified: true,
    eligible: true,
  });
  expect(acceptances).toHaveLength(2);
  expect(acceptances[0]).toBe(acceptances[1]);
  expect(dialog.password.value).toBe('');
});

test('an unverified signed-in account cannot submit an invitation and remains at verification rather than gaining access', async () => {
  const setup = fixture({ emailVerified: false });
  const dialog = new CloudAccountLogin({
    ...setup,
    runtime,
    crypto: webcrypto,
    invitation: {
      version: 1,
      id: '11111111-1111-4111-8111-111111111111',
      secret: 'a'.repeat(64),
    },
  });
  const selected = dialog.choose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  dialog.email.value = 'unverified@example.invalid';
  dialog.password.value = 'Synthetic fixture password';
  dialog.root
    .querySelector('[data-email-login]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(dialog.status.textContent).toContain('Verify your email');
  expect(dialog.root.querySelector('[data-send-verification]').hidden).toBe(false);
  expect(dialog.root.querySelector('[data-accept-invitation]').disabled).toBe(true);
  expect(setup.fetch).not.toHaveBeenCalled();
  const closed = expect(selected).rejects.toMatchObject({ code: 'account-dialog-closed' });
  dialog.destroy();
  await closed;
});

test('an already-approved account may decline an invitation without submitting or silently accepting it', async () => {
  const setup = fixture();
  const dialog = new CloudAccountLogin({
    ...setup,
    runtime,
    invitation: {
      version: 1,
      id: '11111111-1111-4111-8111-111111111111',
      secret: 'a'.repeat(64),
    },
  });
  const selected = dialog.choose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  dialog.email.value = 'approved@example.invalid';
  dialog.password.value = 'Synthetic fixture password';
  dialog.root
    .querySelector('[data-email-login]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setup.fetch).not.toHaveBeenCalled();
  dialog.root.querySelector('[data-skip-invitation]').click();
  await expect(selected).resolves.toMatchObject({ uid: 'email-fixture', eligible: true });
  expect(setup.fetch.mock.calls.every(([, options]) => options.method === 'GET')).toBe(true);
});

test('switching away from a definitively denied account creates a new UID-bound acceptance without reusing its failed client', async () => {
  const setup = fixture({
    uidForEmail: (email) => (email.startsWith('blocked@') ? 'blocked-fixture' : 'email-fixture'),
  });
  const invitation = {
    version: 1,
    id: '11111111-1111-4111-8111-111111111111',
    secret: 'a'.repeat(64),
  };
  const receipt = {
    version: 1,
    invitationId: invitation.id,
    access: {
      version: 1,
      role: 'member',
      seatId: '22222222-2222-4222-8222-222222222222',
      campaign: {
        id: '33333333-3333-4333-8333-333333333333',
        name: 'Invited campaign',
        ruleset: '2014',
        coreVersion: '5.1',
      },
    },
  };
  const acceptedTokens = [];
  setup.fetch.mockImplementation(async (url, options) => {
    if (url.endsWith('/invitations/redeem')) {
      acceptedTokens.push(options.headers.Authorization);
      const denied = options.headers.Authorization === 'Bearer blocked-fixture-token';
      return denied
        ? {
            ok: false,
            status: 403,
            json: async () => ({ version: 1, code: 'pilot-access-required' }),
          }
        : { ok: true, status: 200, json: async () => ({ version: 1, result: receipt }) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        version: 1,
        result: { uid: 'email-fixture', emailVerified: true, eligible: true },
      }),
    };
  });
  const dialog = new CloudAccountLogin({
    ...setup,
    runtime,
    invitation,
    crypto: require('node:crypto').webcrypto,
  });
  const selected = dialog.choose().then(
    (profile) => ({ profile }),
    (error) => ({ code: error.code })
  );
  const signIn = async (email) => {
    dialog.email.value = email;
    dialog.password.value = 'Synthetic fixture password';
    dialog.root
      .querySelector('[data-email-login]')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  try {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await signIn('blocked@example.invalid');
    dialog.root.querySelector('[data-accept-invitation]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(dialog.status.textContent).toContain('private pilot');
    dialog.root.querySelector('[data-account-signout]').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await signIn('recipient@example.invalid');
    expect(dialog.root.querySelector('[data-accept-invitation]').disabled).toBe(false);
    dialog.root.querySelector('[data-accept-invitation]').click();
    await expect(selected).resolves.toMatchObject({ profile: { uid: 'email-fixture' } });
    expect(acceptedTokens).toEqual(['Bearer blocked-fixture-token', 'Bearer fixture-token']);
  } finally {
    dialog.destroy();
    await selected;
  }
});

test('a fresh account block is explicit and still permits signing out of the denied account', async () => {
  const setup = fixture();
  setup.fetch.mockImplementation(async () => ({
    ok: false,
    status: 403,
    json: async () => ({
      version: 1,
      code: 'pilot-access-required',
      error: 'PRIVATE POLICY DETAIL',
    }),
  }));
  const dialog = new CloudAccountLogin({
    ...setup,
    runtime,
    crypto: webcrypto,
    invitation: {
      version: 1,
      id: '11111111-1111-4111-8111-111111111111',
      secret: 'a'.repeat(64),
    },
  });
  const selected = dialog.choose();
  await new Promise((resolve) => setTimeout(resolve, 0));
  dialog.email.value = 'blocked@example.invalid';
  dialog.password.value = 'Synthetic fixture password';
  dialog.root
    .querySelector('[data-email-login]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  dialog.root.querySelector('[data-accept-invitation]').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(dialog.status.textContent).toContain('private pilot');
  expect(dialog.status.textContent).not.toContain('PRIVATE POLICY DETAIL');
  expect(dialog.root.querySelector('[data-retry-invitation]').hidden).toBe(true);
  const signout = dialog.root.querySelector('[data-account-signout]');
  expect(signout.disabled).toBe(false);
  signout.click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(setup.account.identity()).toBeNull();
  const closed = expect(selected).rejects.toMatchObject({ code: 'account-dialog-closed' });
  dialog.destroy();
  await closed;
});
import { webcrypto } from 'node:crypto';
