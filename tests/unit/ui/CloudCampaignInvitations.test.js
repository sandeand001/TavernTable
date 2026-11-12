import { webcrypto, createHash } from 'node:crypto';
import { TextEncoder } from 'node:util';
import CloudCampaignInvitations from '../../../src/ui/campaigns/CloudCampaignInvitations.js';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';
import CloudCampaignClientStore from '../../../src/campaigns/CloudCampaignClientStore.js';

globalThis.TextEncoder ??= TextEncoder;

const campaignId = '11111111-1111-4111-8111-111111111111';
const invitation = {
  version: 1,
  id: '22222222-2222-4222-8222-222222222222',
  campaignId,
  seatId: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-11-11T00:00:00.000Z',
  expiresAt: '2026-11-18T00:00:00.000Z',
};

async function until(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  throw new Error('The invitation UI did not reach the expected state');
}

afterEach(() => {
  document.body.replaceChildren();
});

test('the owner can issue and revoke a single-use link without exposing proof in durable creation data or enabling legacy sharing', async () => {
  const outside = document.createElement('button');
  outside.inert = false;
  document.body.append(outside);
  outside.focus();
  const account = new CloudAccount({
    auth: {
      currentUser: {
        uid: 'owner-fixture',
        emailVerified: true,
        getIdToken: async () => 'fixture-token',
      },
    },
    sdk: { signInWithEmailAndPassword: async () => {}, signOut: async () => {} },
  });
  let created = false;
  let revoked = false;
  let name;
  let creation;
  const fetch = jest.fn(async (url, options) => {
    let result;
    if (url.endsWith('/seats'))
      result = created
        ? [
            {
              version: 1,
              id: invitation.seatId,
              name,
              characterIds: [],
              joined: false,
              invitation: revoked ? null : { ...invitation, status: 'pending' },
            },
          ]
        : [];
    else if (url.endsWith('/invitations/revoke')) {
      revoked = true;
      result = {
        version: 1,
        invitationId: invitation.id,
        revokedAt: '2026-11-11T01:00:00.000Z',
      };
    } else {
      creation = JSON.parse(options.body);
      name = creation.options.name;
      created = true;
      result = invitation;
    }
    return { ok: true, status: 200, json: async () => ({ version: 1, result }) };
  });
  const connection = new CloudAccountConnection({
    account,
    fetch,
    baseURL: 'http://127.0.0.1:19410/',
    runtime: {
      version: 1,
      mode: 'cloud',
      environment: 'emulator',
      apiOrigin: 'http://127.0.0.1:19410',
      authEmulatorOrigin: 'http://127.0.0.1:19099',
      firebase: {
        apiKey: 'demo-api-key',
        projectId: 'demo-taverntable',
        authDomain: 'demo-taverntable.firebaseapp.com',
        appId: 'demo-invitations',
      },
    },
  });
  const store = new CloudCampaignClientStore({
    connection,
    uid: 'owner-fixture',
    packs: [],
    crypto: webcrypto,
  });
  const panel = new CloudCampaignInvitations({ workspace: { store }, campaignId });
  await panel.open();
  expect(outside.inert).toBe(true);
  const form = panel.root.querySelector('form');
  form.querySelector('input').value = 'Fixture <b>player</b>';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const result = panel.root.querySelector('[data-invitation-result]');
  await until(() => !result.hidden);
  const link = new URL(result.querySelector('input').value);
  expect(document.activeElement).toBe(result.querySelector('input'));
  expect(result.querySelector('input').selectionStart).toBe(0);
  expect(result.querySelector('input').selectionEnd).toBe(link.href.length);
  expect(link.origin).toBe(location.origin);
  expect(link.pathname).toBe('/');
  expect(link.search).toBe('');
  const secret = link.hash.split('.')[1];
  expect(secret).toMatch(/^[a-f0-9]{64}$/);
  expect(creation.options.tokenHash).toBe(createHash('sha256').update(secret).digest('hex'));
  expect(JSON.stringify(creation)).not.toContain(secret);
  expect(panel.root.querySelector('[data-player-seats]').textContent).toContain(name);
  expect(panel.root.querySelector('[data-player-seats] b')).toBeNull();
  expect(panel.root.textContent).not.toContain('arrival grants');
  panel.root.querySelector('[data-revoke-invitation]').click();
  await until(() => panel.root.querySelector('output').textContent.includes('revoked'));
  expect(result.hidden).toBe(true);
  expect(result.querySelector('input').value).toBe('');
  panel.destroy();
  expect(outside.inert).toBe(false);
  expect(document.activeElement).toBe(outside);
});
