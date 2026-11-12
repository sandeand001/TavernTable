import { webcrypto, createHash } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import CloudCampaignInvitations from '../../../src/ui/campaigns/CloudCampaignInvitations.js';
import CloudAccount from '../../../src/campaigns/CloudAccount.js';
import CloudAccountConnection from '../../../src/campaigns/CloudAccountConnection.js';
import CloudCampaignClientStore from '../../../src/campaigns/CloudCampaignClientStore.js';
import CampaignWorkspace from '../../../src/campaigns/CampaignWorkspace.js';
import CloudSaveFeedback from '../../../src/ui/campaigns/CloudSaveFeedback.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';

globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;

const campaignId = '11111111-1111-4111-8111-111111111111';
const invitation = {
  version: 1,
  id: '22222222-2222-4222-8222-222222222222',
  campaignId,
  seatId: '33333333-3333-4333-8333-333333333333',
  createdAt: '2026-11-11T00:00:00.000Z',
  expiresAt: '2026-11-18T00:00:00.000Z',
};

function ownerStore(fetch, packs = []) {
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
  return new CloudCampaignClientStore({
    connection,
    uid: 'owner-fixture',
    packs,
    crypto: webcrypto,
  });
}

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
  let created = false;
  let revoked = false;
  let name;
  let creation;
  let loseCreationReply = true;
  const packs = [{ id: 'srd-2014', ruleset: '2014', version: '5.1-seed.1' }];
  const campaign = {
    version: 1,
    id: campaignId,
    name: 'Invitation UI fixture',
    ruleset: '2014',
    coreVersion: '5.1',
    sourcePacks: [{ ...packs[0], enabled: true }],
    createdAt: invitation.createdAt,
    charactersRevision: 0,
    sceneRevision: 0,
    sceneSavedAt: null,
  };
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
    else if (url.endsWith('/characters'))
      result = {
        campaign,
        revision: 0,
        records: [],
        scene: null,
        sceneRevision: 0,
        sceneSavedAt: null,
      };
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
      if (loseCreationReply) {
        loseCreationReply = false;
        throw new TypeError('Synthetic lost accepted invitation reply');
      }
    }
    return { ok: true, status: 200, json: async () => ({ version: 1, result }) };
  });
  const store = ownerStore(fetch, packs);
  const panel = new CloudCampaignInvitations({ workspace: { store }, campaignId });
  await panel.open();
  expect(outside.inert).toBe(true);
  const form = panel.root.querySelector('form');
  form.querySelector('input').value = 'Fixture <b>player</b>';
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  const result = panel.root.querySelector('[data-invitation-result]');
  const retry = panel.root.querySelector('[data-retry-access]');
  await until(() => !retry.hidden);
  expect(result.hidden).toBe(true);
  expect(retry.disabled).toBe(false);
  expect(panel.root.querySelector('[data-close-invitations]').disabled).toBe(true);
  expect(store.saveState.phase).toBe('idle');
  const leaving = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(leaving);
  expect(leaving.defaultPrevented).toBe(true);
  retry.click();
  await until(() => !result.hidden);
  const attempts = fetch.mock.calls.filter(([url]) => url.endsWith('/invitations'));
  expect(attempts).toHaveLength(2);
  expect(attempts[0][1].body).toBe(attempts[1][1].body);
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

test('owner assignment errors restore current controls, and removing access retains characters without changing canonical save state', async () => {
  const authority = await CampaignWorkspace.load({
    storage: 'browser',
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  const campaign = await authority.create({ name: 'Owner access UI fixture', ruleset: '2014' });
  const services = await authority.open(campaign.id);
  const characterId = await services.library.create('Scout <b>name</b>');
  const before = await authority.store.readCharacters(campaign.id);
  const seat = {
    version: 2,
    id: '44444444-4444-4444-8444-444444444444',
    name: 'Existing player',
    accessGeneration: 0,
    characterIds: [],
    joined: true,
    invitation: null,
  };
  const assignments = [];
  let denyFirst = true;
  const fetch = async (url, options) => {
    let result;
    if (url.endsWith('/seats')) result = [{ ...seat, characterIds: [...seat.characterIds] }];
    else if (url.endsWith('/characters'))
      result = await authority.store.readCharacters(campaign.id);
    else if (url.endsWith('/assignments')) {
      const input = JSON.parse(options.body);
      assignments.push(input);
      if (denyFirst) {
        denyFirst = false;
        seat.accessGeneration++;
        return {
          ok: false,
          status: 409,
          json: async () => ({
            version: 1,
            code: 'campaign-access-changed',
            error: 'PRIVATE POLICY DETAIL',
          }),
        };
      }
      expect(input.accessGeneration).toBe(seat.accessGeneration);
      seat.characterIds = input.assigned ? [input.characterId] : [];
      seat.accessGeneration++;
      result = {
        version: 1,
        seatId: seat.id,
        characterIds: [...seat.characterIds],
        accessGeneration: seat.accessGeneration,
        changed: true,
      };
    } else if (url.endsWith('/members/remove')) {
      const input = JSON.parse(options.body);
      expect(input.accessGeneration).toBe(seat.accessGeneration);
      seat.joined = false;
      seat.accessGeneration++;
      result = {
        version: 1,
        seatId: seat.id,
        accessGeneration: seat.accessGeneration,
        removedAt: '2026-11-11T00:00:00.000Z',
      };
    } else throw new Error('Unexpected owner access UI request');
    return { ok: true, status: 200, json: async () => ({ version: 1, result }) };
  };
  const store = ownerStore(fetch, authority.manifest.packs);
  const workspace = new CampaignWorkspace({
    store,
    manifest: authority.manifest,
    resources: authority.resources,
  });
  const feedback = new CloudSaveFeedback({ store }).attach();
  const panel = new CloudCampaignInvitations({ workspace, campaignId: campaign.id });
  try {
    await panel.open();
    const control = () => panel.root.querySelector(`[data-assign-character="${characterId}"]`);
    expect(control()).not.toBeNull();
    expect(panel.root.querySelector('[data-player-seats] b')).toBeNull();
    control().checked = true;
    control().dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => assignments.length === 1 && panel.root.getAttribute('aria-busy') === 'false');
    expect(control().checked).toBe(false);
    expect(panel.status.textContent).toContain('access changed');
    expect(panel.status.textContent).not.toContain('PRIVATE POLICY DETAIL');
    expect(store.saveState.phase).toBe('idle');
    control().checked = true;
    control().dispatchEvent(new Event('change', { bubbles: true }));
    await until(() => assignments.length === 2 && panel.root.getAttribute('aria-busy') === 'false');
    expect(control().checked).toBe(true);
    expect(assignments.map((input) => input.accessGeneration)).toEqual([0, 1]);
    panel.root.querySelector('[data-remove-member]').click();
    await until(() => !seat.joined && panel.root.getAttribute('aria-busy') === 'false');
    expect(control().checked).toBe(true);
    expect(panel.root.querySelector('[data-remove-member]')).toBeNull();
    expect(panel.status.textContent).toContain('kept');
    expect(store.saveState.phase).toBe('idle');
    expect(feedback.root.querySelector('[aria-label="Cloud save status"]').dataset.saveState).toBe(
      'idle'
    );
    expect(await authority.store.readCharacters(campaign.id)).toEqual(before);
  } finally {
    panel.destroy();
    feedback.dispose();
    workspace.close();
    authority.close();
  }
}, 30000);
