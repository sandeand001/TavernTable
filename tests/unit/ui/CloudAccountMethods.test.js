import CloudAccountMethods from '../../../src/ui/sessions/CloudAccountMethods.js';
import { ErrorHandler } from '../../../src/utils/error/ErrorHandler.js';

function fixture(providers = ['google.com']) {
  const methods = {
    uid: 'methods-fixture',
    email: 'methods@example.invalid',
    emailVerified: true,
    providers,
  };
  const snapshot = () => ({ ...methods, providers: [...methods.providers] });
  const account = {
    identity: () => ({
      uid: methods.uid,
      email: methods.email,
      emailVerified: methods.emailVerified,
    }),
    signInMethods: snapshot,
    verifySignInMethod: jest.fn(async () => snapshot()),
    linkSignInMethod: jest.fn(async ({ provider }) => {
      methods.providers.push(provider);
      return snapshot();
    }),
    refreshIdentity: jest.fn(async () => account.identity()),
    sendVerification: jest.fn(async () => account.identity()),
    cancelSignInLink: jest.fn(),
  };
  return { account, methods, snapshot };
}

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('The sign-in methods panel did not reach its expected state');
}

afterEach(() => {
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

test('sign-in methods require fresh proof and distinguish a linked password from pending email verification', async () => {
  const outside = document.createElement('button');
  outside.inert = false;
  document.body.append(outside);
  outside.focus();
  const report = jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const setup = fixture();
  setup.account.linkSignInMethod.mockImplementation(async () => {
    setup.methods.providers.push('password');
    setup.methods.emailVerified = false;
    return setup.snapshot();
  });
  const panel = new CloudAccountMethods({ account: setup.account });
  await panel.open();
  expect(setup.account.refreshIdentity).not.toHaveBeenCalled();
  const root = panel.root;
  const link = root.querySelector('[data-add-password] button');
  expect(outside.inert).toBe(true);
  expect(link.disabled).toBe(true);
  expect(setup.account.verifySignInMethod).not.toHaveBeenCalled();
  expect(setup.account.linkSignInMethod).not.toHaveBeenCalled();
  root.querySelector('[data-verify-google]').click();
  await until(() => !link.disabled);
  expect(setup.account.verifySignInMethod).toHaveBeenCalledWith({ provider: 'google.com' });
  const password = root.querySelector('[aria-label="New sign-in password"]');
  const confirmation = root.querySelector('[aria-label="Confirm sign-in password"]');
  password.value = confirmation.value = 'Private UI fixture password';
  root
    .querySelector('[data-add-password]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => root.getAttribute('aria-busy') === 'false');
  expect(setup.account.linkSignInMethod).toHaveBeenCalledWith({
    provider: 'password',
    password: 'Private UI fixture password',
  });
  expect(password.value).toBe('');
  expect(confirmation.value).toBe('');
  expect(root.textContent).not.toContain('Private UI fixture password');
  expect(root.querySelector('[data-link-controls]').hidden).toBe(true);
  expect(root.textContent).toContain('Google: linked');
  expect(root.textContent).toContain('Email/password: linked');
  expect(panel.status.textContent).toMatch(/linked.*verif/i);
  expect(report).not.toHaveBeenCalled();
  root.querySelector('[data-send-method-verification]').click();
  await until(() => setup.account.sendVerification.mock.calls.length === 1);
  await until(() => root.getAttribute('aria-busy') === 'false');
  setup.methods.emailVerified = true;
  root.querySelector('[data-refresh-methods]').click();
  await until(() => root.getAttribute('aria-busy') === 'false');
  expect(root.querySelector('[data-send-method-verification]').hidden).toBe(true);
  expect(root.querySelector('[data-method-verification]').textContent).toContain('verified');
  panel.destroy();
  expect(setup.account.cancelSignInLink).toHaveBeenCalled();
  expect(outside.inert).toBe(false);
  expect(document.activeElement).toBe(outside);
});

test('an uncertain provider change requires refresh instead of retrying or claiming cancellation undid it', async () => {
  jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const setup = fixture(['password']);
  let remotelyLinked = false;
  setup.account.linkSignInMethod.mockImplementation(async () => {
    remotelyLinked = true;
    throw Object.assign(new Error('Refresh the same account to confirm this change.'), {
      code: 'sign-in-link-unconfirmed',
    });
  });
  setup.account.refreshIdentity.mockImplementation(async () => {
    if (remotelyLinked) setup.methods.providers = ['google.com', 'password'];
    return setup.account.identity();
  });
  const panel = new CloudAccountMethods({ account: setup.account });
  await panel.open();
  const root = panel.root;
  root.querySelector('[aria-label="Existing sign-in password"]').value =
    'Existing fixture password';
  root
    .querySelector('[data-verify-password]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const link = root.querySelector('[data-add-google]');
  await until(() => !link.disabled);
  link.click();
  await until(() => panel.status.textContent.includes('Unconfirmed'));
  expect(root.querySelector('[data-cancel-method-proof]').disabled).toBe(true);
  expect(link.disabled).toBe(true);
  expect(root.querySelector('[aria-label="Existing sign-in password"]').value).toBe('');
  root.querySelector('[data-refresh-methods]').click();
  await until(() => root.querySelector('[data-link-controls]').hidden);
  expect(setup.account.linkSignInMethod).toHaveBeenCalledTimes(1);
  expect(panel.status.textContent).toContain('No link was retried');
  panel.destroy();
});

test('switching accounts after verification cannot submit a captured account link', async () => {
  jest.spyOn(ErrorHandler.prototype, 'handle').mockImplementation(() => {});
  const setup = fixture();
  const panel = new CloudAccountMethods({ account: setup.account });
  await panel.open();
  const root = panel.root;
  root.querySelector('[data-verify-google]').click();
  await until(() => !root.querySelector('[data-add-password] button').disabled);
  setup.methods.uid = 'different-methods-fixture';
  root.querySelector('[aria-label="New sign-in password"]').value = 'Private fixture password';
  root.querySelector('[aria-label="Confirm sign-in password"]').value = 'Private fixture password';
  root
    .querySelector('[data-add-password]')
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await until(() => panel.status.textContent.includes('account changed'));
  expect(setup.account.linkSignInMethod).not.toHaveBeenCalled();
  expect(root.querySelector('[aria-label="New sign-in password"]').value).toBe('');
  expect(root.querySelector('[data-add-password] button').disabled).toBe(true);
  panel.destroy();
});
