const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { HostResources } = require('../../tools/host-resources.js');
const { readEmulatorEnvironment } = require('../../tools/cloud/emulator-runtime.js');
const sdk = require('firebase/auth');
const { default: CloudAccount } = require('../../src/campaigns/CloudAccount.js');
const {
  default: CloudAccountConnection,
} = require('../../src/campaigns/CloudAccountConnection.js');
const {
  default: CloudCampaignClientStore,
} = require('../../src/campaigns/CloudCampaignClientStore.js');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');

async function fixture(t, { now } = {}) {
  const runtime = await createEmulatorRuntime();
  t.after(() => runtime.close());
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(__dirname, '..', '..', 'assets', 'data', 'resources', 'manifest.json'),
      'utf8'
    )
  );
  const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
  const resources = new HostResources({ root: path.join(__dirname, '..', '..'), manifest });
  const createStore = () =>
    new CloudCampaignStore({
      firestore: runtime.firestore,
      access,
      packs: manifest.packs,
      resources,
      objects: new ImmutableCloudObjects({ bucket: runtime.bucket }),
      ...(now ? { now } : {}),
    });
  const store = createStore();
  const account = async ({ eligible = true, emailVerified = true } = {}) => {
    const identity = await signedInIdentity(runtime, { emailVerified });
    t.after(() => identity.close());
    if (eligible)
      await runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(identity.uid))
        .set({ version: 1, uid: identity.uid, enabled: true });
    const principal = await access.verifyIdentity(`Bearer ${identity.token}`);
    return { ...identity, principal };
  };
  const create = (principal, name) =>
    store.create(principal, { commandId: randomUUID(), options: { name, ruleset: '2014' } });
  const join = async (campaignId, uid) => {
    const id = randomUUID();
    const joinedAt = new Date().toISOString();
    const batch = runtime.firestore.batch();
    batch.create(
      runtime.firestore.collection('campaigns').doc(campaignId).collection('seats').doc(id),
      {
        version: 1,
        id,
        campaignId,
        name: 'Synthetic player seat',
        memberUid: uid,
        characterIds: [],
        createdAt: joinedAt,
      }
    );
    batch.create(
      runtime.firestore
        .collection('campaignMemberships')
        .doc(pilotAccountKey(uid))
        .collection('campaigns')
        .doc(campaignId),
      { version: 1, uid, campaignId, seatId: id, joinedAt }
    );
    await batch.commit();
    return id;
  };
  return { runtime, access, store, createStore, resources, manifest, account, create, join };
}

const summary = (campaign, role, seatId = null) => ({
  version: 1,
  campaign: {
    id: campaign.id,
    name: campaign.name,
    ruleset: campaign.ruleset,
    coreVersion: campaign.coreVersion,
  },
  role,
  seatId,
});

function invitation(name = 'Invited player', seatId = null) {
  const secret = randomBytes(32).toString('hex');
  return {
    secret,
    command: {
      commandId: randomUUID(),
      options: {
        name,
        seatId,
        tokenHash: createHash('sha256').update(secret).digest('hex'),
      },
    },
  };
}

test(
  'one verified UID owns one campaign and joins another without gaining canonical authority over the joined campaign',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const player = await f.account();
    const unrelated = await f.account();
    const owned = await f.create(owner.principal, 'Owner campaign');
    const personal = await f.create(player.principal, 'Player-owned campaign');
    const seatId = await f.join(owned.id, player.uid);
    assert.deepEqual(await f.store.listAccess(player.principal), {
      owned: [summary(personal, 'owner')],
      joined: [summary(owned, 'member', seatId)],
    });
    assert.deepEqual(
      await f.store.getAccess(player.principal, personal.id),
      summary(personal, 'owner')
    );
    assert.deepEqual(
      await f.store.getAccess(player.principal, owned.id),
      summary(owned, 'member', seatId)
    );
    assert.deepEqual(await f.store.listAccess(owner.principal), {
      owned: [summary(owned, 'owner')],
      joined: [],
    });
    assert.deepEqual(await f.store.listAccess(unrelated.principal), { owned: [], joined: [] });
    assert.equal(Object.hasOwn(player.principal, 'role'), false);
    const denied = { status: 404, code: 'campaign-not-found' };
    await assert.rejects(f.store.getAccess(unrelated.principal, owned.id), denied);
    await assert.rejects(f.store.get(player.principal, owned.id), denied);
    await assert.rejects(f.store.readCharacters(player.principal, owned.id), denied);
    await assert.rejects(f.store.readScene(player.principal, owned.id), denied);
    await assert.rejects(
      f.store.commitScene(player.principal, owned.id, {
        commandId: randomUUID(),
        change: { ruleset: '2014', revision: 0, charactersRevision: 0, scene: '{}' },
      }),
      denied
    );
    assert.deepEqual(await f.store.list(player.principal), [personal]);
  }
);

test(
  'bearer HTTP exposes only the participant access projection and never treats joined membership as owner authority',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const player = await f.account();
    const stranger = await f.account();
    const campaign = await f.create(owner.principal, 'Participant projection');
    const seatId = await f.join(campaign.id, player.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const read = async (resource, identity) =>
      fetch(`${api.url}/api/cloud/${resource}`, {
        headers: identity ? { Authorization: `Bearer ${identity.token}` } : {},
      });
    const listing = await read('account/campaigns', player);
    assert.equal(listing.status, 200);
    assert.deepEqual(await listing.json(), {
      version: 1,
      result: { owned: [], joined: [summary(campaign, 'member', seatId)] },
    });
    const access = await read(`campaigns/${campaign.id}/access`, player);
    assert.equal(access.status, 200);
    assert.deepEqual(await access.json(), {
      version: 1,
      result: summary(campaign, 'member', seatId),
    });
    for (const resource of [
      `campaigns/${campaign.id}`,
      `campaigns/${campaign.id}/characters`,
      `campaigns/${campaign.id}/scene`,
    ]) {
      const response = await read(resource, player);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, 'campaign-not-found');
    }
    assert.equal((await read(`campaigns/${campaign.id}/access`, stranger)).status, 404);
    assert.equal((await read('account/campaigns')).status, 401);
    await f.runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(player.uid))
      .update({ enabled: false });
    const disabled = await read(`campaigns/${campaign.id}/access`, player);
    assert.equal(disabled.status, 403);
    assert.equal((await disabled.json()).code, 'pilot-access-required');
  }
);

test(
  'malformed membership metadata fails explicitly and a mismatched current seat cannot preserve stale access',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const player = await f.account();
    const campaign = await f.create(owner.principal, 'Current membership checks');
    const seatId = await f.join(campaign.id, player.uid);
    const reference = f.runtime.firestore
      .collection('campaignMemberships')
      .doc(pilotAccountKey(player.uid))
      .collection('campaigns')
      .doc(campaign.id);
    const original = (await reference.get()).data();
    for (const invalid of [
      { ...original, uid: owner.uid },
      { ...original, campaignId: randomUUID() },
      { ...original, seatId: 'not-a-seat-id' },
      { ...original, joinedAt: 'not-a-timestamp' },
      { ...original, role: 'owner' },
    ]) {
      await reference.set(invalid);
      await assert.rejects(f.store.getAccess(player.principal, campaign.id), {
        status: 503,
        code: 'invalid-campaign-membership',
      });
      await assert.rejects(f.store.listAccess(player.principal), {
        status: 503,
        code: 'invalid-campaign-membership',
      });
    }
    await reference.set(original);
    await f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('seats')
      .doc(seatId)
      .update({ memberUid: owner.uid });
    await assert.rejects(f.store.getAccess(player.principal, campaign.id), {
      status: 404,
      code: 'campaign-not-found',
    });
    assert.deepEqual(await f.store.get(owner.principal, campaign.id), campaign);
  }
);

test(
  'owner-issued invitations store only a hash, expire after seven days and recover the same seat after a lost creation reply',
  { timeout: 30000 },
  async (t) => {
    const now = Date.parse('2026-11-11T12:00:00.000Z');
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Single-use invitation fixture');
    const prepared = invitation();
    const issued = await f.store.createInvitation(owner.principal, campaign.id, prepared.command);
    assert.deepEqual(Object.keys(issued).sort(), [
      'campaignId',
      'createdAt',
      'expiresAt',
      'id',
      'seatId',
      'version',
    ]);
    assert.equal(issued.version, 1);
    assert.equal(issued.campaignId, campaign.id);
    assert.equal(Date.parse(issued.createdAt), now);
    assert.equal(Date.parse(issued.expiresAt), now + 7 * 24 * 60 * 60 * 1000);
    const replay = await f
      .createStore()
      .createInvitation(owner.principal, campaign.id, structuredClone(prepared.command));
    assert.deepEqual(replay, issued);
    const stored = (
      await f.runtime.firestore.collection('campaignInvitations').doc(issued.id).get()
    ).data();
    assert.equal(stored.tokenHash, prepared.command.options.tokenHash);
    assert.equal(stored.seatId, issued.seatId);
    assert.equal(stored.redeemedByUid, null);
    const head = await f.runtime.firestore.collection('campaigns').doc(campaign.id).get();
    const seats = await head.ref.collection('seats').get();
    assert.equal(seats.size, 1);
    assert.equal(seats.docs[0].id, issued.seatId);
    assert.deepEqual(seats.docs[0].data().characterIds, []);
    assert.equal(seats.docs[0].data().memberUid, null);
    assert.equal(seats.docs[0].data().activeInvitationId, issued.id);
    assert.equal(head.data().generation, 1);
    const receipt = await f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(owner.uid))
      .collection('receipts')
      .doc(prepared.command.commandId)
      .get();
    assert.equal(JSON.stringify(stored).includes(prepared.secret), false);
    assert.equal(JSON.stringify(receipt.data()).includes(prepared.secret), false);
    assert.equal(JSON.stringify(issued).includes(prepared.secret), false);
  }
);

test(
  'accepting a valid invitation atomically enables a verified account and binds its UID to the intended existing seat',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Approved by invitation');
    const prepared = invitation('Reserved seat');
    const issued = await f.store.createInvitation(owner.principal, campaign.id, prepared.command);
    const seatReference = f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('seats')
      .doc(issued.seatId);
    const characterIds = [randomUUID(), randomUUID()];
    await seatReference.update({ characterIds });
    await assert.rejects(f.access.verifyAuthorization(`Bearer ${recipient.token}`), {
      code: 'pilot-access-required',
    });
    const command = {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: prepared.secret,
    };
    const accepted = await f.store.redeemInvitation(recipient.principal, command);
    assert.deepEqual(accepted, {
      version: 1,
      invitationId: issued.id,
      access: summary(campaign, 'member', issued.seatId),
    });
    assert.deepEqual(
      await f.createStore().redeemInvitation(recipient.principal, structuredClone(command)),
      accepted
    );
    const principal = await f.access.verifyAuthorization(`Bearer ${recipient.token}`);
    assert.equal(principal.uid, recipient.uid);
    assert.deepEqual((await seatReference.get()).data().characterIds, characterIds);
    assert.equal((await seatReference.get()).data().memberUid, recipient.uid);
    const own = await f.create(principal, 'Recipient-owned campaign');
    assert.deepEqual(await f.store.listAccess(principal), {
      owned: [summary(own, 'owner')],
      joined: [summary(campaign, 'member', issued.seatId)],
    });
    assert.deepEqual(await f.store.get(owner.principal, campaign.id), campaign);
    await assert.rejects(f.store.readCharacters(principal, campaign.id), {
      code: 'campaign-not-found',
    });
    const receipt = await f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(recipient.uid))
      .collection('receipts')
      .doc(command.commandId)
      .get();
    assert.equal(JSON.stringify(receipt.data()).includes(prepared.secret), false);
  }
);

test(
  'an invitation is accepted one millisecond before expiry but not at expiry, and invalid proof cannot enable an account',
  { timeout: 30000 },
  async (t) => {
    let now = Date.parse('2026-11-11T12:00:00.000Z');
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const early = await f.account({ eligible: false });
    const late = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Exact expiry fixture');
    const first = invitation('Early seat');
    const second = invitation('Late seat');
    const issued = await f.store.createInvitation(owner.principal, campaign.id, first.command);
    const expired = await f.store.createInvitation(owner.principal, campaign.id, second.command);
    const unavailable = { status: 410, code: 'invitation-unavailable' };
    await assert.rejects(
      f.store.redeemInvitation(late.principal, {
        commandId: randomUUID(),
        invitationId: expired.id,
        secret: randomBytes(32).toString('hex'),
      }),
      unavailable
    );
    now = Date.parse(issued.expiresAt) - 1;
    await f.store.redeemInvitation(early.principal, {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: first.secret,
    });
    now++;
    await assert.rejects(
      f.store.redeemInvitation(late.principal, {
        commandId: randomUUID(),
        invitationId: expired.id,
        secret: second.secret,
      }),
      unavailable
    );
    assert.equal(
      (await f.runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(late.uid)).get())
        .exists,
      false
    );
    assert.deepEqual(await f.store.listAccess(early.principal), {
      owned: [],
      joined: [summary(campaign, 'member', issued.seatId)],
    });
  }
);

test(
  'two unapproved verified accounts racing one invitation produce one enabled member and no loser approval or receipt',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const candidates = [await f.account({ eligible: false }), await f.account({ eligible: false })];
    const campaign = await f.create(owner.principal, 'Invitation redemption race');
    const prepared = invitation();
    const issued = await f.store.createInvitation(owner.principal, campaign.id, prepared.command);
    const commands = candidates.map(() => ({
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: prepared.secret,
    }));
    const outcomes = await Promise.allSettled(
      candidates.map((candidate, index) =>
        f.createStore().redeemInvitation(candidate.principal, commands[index])
      )
    );
    assert.equal(outcomes.filter((entry) => entry.status === 'fulfilled').length, 1);
    assert.equal(outcomes.filter((entry) => entry.status === 'rejected').length, 1);
    const winner = outcomes.findIndex((entry) => entry.status === 'fulfilled');
    const loser = 1 - winner;
    assert.equal(outcomes[loser].reason.code, 'invitation-unavailable');
    for (const index of [winner, loser]) {
      const approval = await f.runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(candidates[index].uid))
        .get();
      const receipt = await f.runtime.firestore
        .collection('accountCommands')
        .doc(pilotAccountKey(candidates[index].uid))
        .collection('receipts')
        .doc(commands[index].commandId)
        .get();
      assert.equal(approval.exists, index === winner);
      assert.equal(receipt.exists, index === winner);
    }
    await assert.rejects(
      f.store.redeemInvitation(candidates[winner].principal, {
        ...commands[winner],
        commandId: randomUUID(),
      }),
      { code: 'invitation-unavailable' }
    );
    assert.deepEqual(
      await f.store.redeemInvitation(candidates[winner].principal, commands[winner]),
      outcomes[winner].value
    );
  }
);

test(
  'an explicit account block overrides valid invitations and previously committed redemption retries',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const blocked = await f.account({ eligible: false });
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Explicit blocks override invites');
    const prepared = invitation();
    const issued = await f.store.createInvitation(owner.principal, campaign.id, prepared.command);
    const blockedReference = f.runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(blocked.uid));
    await blockedReference.set({ version: 1, uid: blocked.uid, enabled: false });
    const command = {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: prepared.secret,
    };
    await assert.rejects(f.store.redeemInvitation(blocked.principal, command), {
      status: 403,
      code: 'pilot-access-required',
    });
    assert.equal((await blockedReference.get()).data().enabled, false);
    const accepted = await f.store.redeemInvitation(recipient.principal, command);
    assert.equal(accepted.access.seatId, issued.seatId);
    const approval = f.runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(recipient.uid));
    await approval.update({ enabled: false });
    await assert.rejects(f.createStore().redeemInvitation(recipient.principal, command), {
      status: 403,
      code: 'pilot-access-required',
    });
    assert.equal((await approval.get()).data().enabled, false);
    await assert.rejects(f.store.getAccess(recipient.principal, campaign.id), {
      code: 'pilot-access-required',
    });
  }
);

test(
  'reissuing an unclaimed seat invalidates its old link without recreating the seat or losing assignments',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Preserved player seat');
    const first = invitation('Reserved player');
    const issued = await f.store.createInvitation(owner.principal, campaign.id, first.command);
    const seat = f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('seats')
      .doc(issued.seatId);
    const characterIds = [randomUUID()];
    await seat.update({ characterIds });
    const before = (await seat.get()).data();
    const replacement = invitation('Reserved player', issued.seatId);
    const reissued = await f.store.createInvitation(
      owner.principal,
      campaign.id,
      replacement.command
    );
    assert.equal(reissued.seatId, issued.seatId);
    assert.notEqual(reissued.id, issued.id);
    assert.equal((await seat.parent.get()).size, 1);
    assert.equal((await seat.get()).data().createdAt, before.createdAt);
    assert.deepEqual((await seat.get()).data().characterIds, characterIds);
    await assert.rejects(
      f.store.redeemInvitation(recipient.principal, {
        commandId: randomUUID(),
        invitationId: issued.id,
        secret: first.secret,
      }),
      { code: 'invitation-unavailable' }
    );
    await f.store.redeemInvitation(recipient.principal, {
      commandId: randomUUID(),
      invitationId: reissued.id,
      secret: replacement.secret,
    });
    assert.deepEqual((await seat.get()).data().characterIds, characterIds);
    assert.equal((await seat.get()).data().memberUid, recipient.uid);
  }
);

test(
  'revoking an unused invitation is recoverable and never doubles as removing an accepted player',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Invitation revocation fixture');
    const first = invitation();
    const issued = await f.store.createInvitation(owner.principal, campaign.id, first.command);
    const command = { commandId: randomUUID(), invitationId: issued.id };
    const revoked = await f.store.revokeInvitation(owner.principal, campaign.id, command);
    assert.equal(revoked.version, 1);
    assert.equal(revoked.invitationId, issued.id);
    assert.ok(Number.isFinite(Date.parse(revoked.revokedAt)));
    assert.deepEqual(
      await f.createStore().revokeInvitation(owner.principal, campaign.id, command),
      revoked
    );
    await assert.rejects(
      f.store.redeemInvitation(recipient.principal, {
        commandId: randomUUID(),
        invitationId: issued.id,
        secret: first.secret,
      }),
      { code: 'invitation-unavailable' }
    );
    const replacement = invitation('Invited player', issued.seatId);
    const reissued = await f.store.createInvitation(
      owner.principal,
      campaign.id,
      replacement.command
    );
    await f.store.redeemInvitation(recipient.principal, {
      commandId: randomUUID(),
      invitationId: reissued.id,
      secret: replacement.secret,
    });
    await assert.rejects(
      f.store.revokeInvitation(owner.principal, campaign.id, {
        commandId: randomUUID(),
        invitationId: reissued.id,
      }),
      { status: 409, code: 'invitation-already-accepted' }
    );
    assert.deepEqual(
      await f.store.getAccess(recipient.principal, campaign.id),
      summary(campaign, 'member', issued.seatId)
    );
  }
);

test(
  'only verified bearer invitation redemption can enroll a new account through HTTP while normal routes remain approval-gated',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'HTTP invite onboarding');
    const prepared = invitation();
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const post = (resource, body, identity) =>
      fetch(`${api.url}/api/cloud/${resource}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(identity ? { Authorization: `Bearer ${identity.token}` } : {}),
        },
        body: JSON.stringify(body),
      });
    const response = await post(`campaigns/${campaign.id}/invitations`, prepared.command, owner);
    assert.equal(response.status, 201);
    const issued = (await response.json()).result;
    assert.equal(issued.campaignId, campaign.id);
    const command = {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: prepared.secret,
    };
    const accountState = () =>
      fetch(`${api.url}/api/cloud/account`, {
        headers: { Authorization: `Bearer ${recipient.token}` },
      });
    assert.equal((await accountState()).status, 403);
    assert.equal((await post('account/invitations/redeem', command)).status, 401);
    const unverified = await signedInIdentity(f.runtime, { emailVerified: false });
    t.after(() => unverified.close());
    const denied = await post('account/invitations/redeem', command, unverified);
    assert.equal(denied.status, 403);
    assert.equal((await denied.json()).code, 'email-verification-required');
    const accepted = await post('account/invitations/redeem', command, recipient);
    assert.equal(accepted.status, 200);
    assert.deepEqual((await accepted.json()).result, {
      version: 1,
      invitationId: issued.id,
      access: summary(campaign, 'member', issued.seatId),
    });
    assert.equal((await accountState()).status, 200);
    const inappropriate = await post(
      `campaigns/${campaign.id}/invitations`,
      invitation().command,
      recipient
    );
    assert.equal(inappropriate.status, 404);
    const revoke = await post(
      `campaigns/${campaign.id}/invitations/revoke`,
      { commandId: randomUUID(), invitationId: issued.id },
      owner
    );
    assert.equal(revoke.status, 409);
    assert.equal((await revoke.json()).code, 'invitation-already-accepted');
  }
);

test(
  'only the owner can list player seats and current invitation status without exposing reusable proof or account identity',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const player = await f.account();
    const campaign = await f.create(owner.principal, 'Owner invitation management');
    assert.deepEqual(await f.store.listSeats(owner.principal, campaign.id), []);
    const prepared = invitation('Reserved seat');
    const issued = await f.store.createInvitation(owner.principal, campaign.id, prepared.command);
    const seats = await f.store.listSeats(owner.principal, campaign.id);
    assert.deepEqual(seats, [
      {
        version: 1,
        id: issued.seatId,
        name: 'Reserved seat',
        characterIds: [],
        joined: false,
        invitation: { ...issued, status: 'pending' },
      },
    ]);
    assert.equal(JSON.stringify(seats).includes(prepared.secret), false);
    assert.equal(JSON.stringify(seats).includes(prepared.command.options.tokenHash), false);
    assert.equal(JSON.stringify(seats).includes(owner.uid), false);
    await f.store.redeemInvitation(player.principal, {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: prepared.secret,
    });
    const accepted = await f.store.listSeats(owner.principal, campaign.id);
    assert.deepEqual(accepted, [{ ...seats[0], joined: true, invitation: null }]);
    await assert.rejects(f.store.listSeats(player.principal, campaign.id), {
      code: 'campaign-not-found',
    });
  }
);

test(
  'real browser clients recover a lost acceptance through a replacement API and preserve actual campaign character assignments',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Complete invitation client fixture');
    let api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const environment = readEmulatorEnvironment();
    const acceptances = [];
    const resetConnections = [];
    const client = (identity, { loseReply = false } = {}) => {
      const connection = new CloudAccountConnection({
        account: new CloudAccount({ auth: identity.auth, sdk }),
        baseURL: api.origin,
        runtime: {
          version: 1,
          mode: 'cloud',
          environment: 'emulator',
          apiOrigin: api.url,
          authEmulatorOrigin: `http://${environment.authHost}`,
          firebase: {
            apiKey: 'demo-api-key',
            projectId: environment.projectId,
            authDomain: `${environment.projectId}.firebaseapp.com`,
            appId: 'demo-invitation-client',
          },
        },
        fetch: async (url, options) => {
          if (url.endsWith('/invitations/redeem')) acceptances.push(options.body);
          let response;
          try {
            response = await fetch(url, options);
          } catch (error) {
            if (['UND_ERR_SOCKET', 'ECONNRESET'].includes(error.cause?.code))
              resetConnections.push(error.cause.code);
            throw error;
          }
          if (url.endsWith('/invitations/redeem')) {
            if (loseReply) {
              loseReply = false;
              assert.equal(response.status, 200);
              await response.clone().json();
              throw new TypeError('Synthetic lost accepted invitation reply');
            }
          }
          return response;
        },
      });
      return new CloudCampaignClientStore({
        connection,
        uid: identity.uid,
        packs: f.manifest.packs,
      });
    };
    const ownerClient = client(owner);
    const library = await CampaignCharacters.open({
      store: ownerClient,
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
    });
    const characterIds = [
      await library.create('Assigned scout'),
      await library.create('Assigned companion'),
    ];
    const issued = await ownerClient.createInvitation(campaign.id, { name: 'Returning seat' });
    const seat = f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('seats')
      .doc(issued.seatId);
    await seat.update({ characterIds });
    const before = await ownerClient.readCharacters(campaign.id);
    const playerClient = client(recipient, { loseReply: true });
    let stop = () => {};
    const uncertain = new Promise((resolve) => {
      stop = playerClient.subscribeSave((state) => {
        if (state.phase === 'uncertain') resolve();
      });
    });
    const pending = playerClient.redeemInvitation({
      id: issued.id,
      secret: issued.secret,
    });
    await uncertain;
    stop();
    const originalPort = Number(new URL(api.url).port);
    await api.close();
    api = await cloudApi({ access: f.access, store: f.createStore(), port: originalPort });
    const originalCommandId = playerClient.saveState.commandId;
    // A replaced API can reset one pooled socket; another explicit retry must retain the command.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await playerClient.retryPending();
        break;
      } catch (error) {
        if (attempt !== 0 || error.code !== 'cloud-unavailable' || resetConnections.length !== 1)
          throw error;
        assert.equal(playerClient.saveState.phase, 'uncertain');
        assert.equal(playerClient.saveState.commandId, originalCommandId);
      }
    }
    const accepted = await pending;
    assert.equal(accepted.invitationId, issued.id);
    assert.equal(accepted.access.seatId, issued.seatId);
    assert.equal(acceptances.length, 2 + resetConnections.length);
    assert.ok(acceptances.every((body) => body === acceptances[0]));
    assert.equal((await playerClient.connection.profile()).uid, recipient.uid);
    assert.deepEqual((await playerClient.listAccess()).joined, [accepted.access]);
    const seats = await ownerClient.listSeats(campaign.id);
    assert.deepEqual(seats[0].characterIds, characterIds);
    assert.equal(seats[0].joined, true);
    assert.deepEqual(await ownerClient.readCharacters(campaign.id), before);
    await assert.rejects(playerClient.readCharacters(campaign.id), {
      code: 'campaign-not-found',
    });
  }
);

test(
  'an actual publication failure rolls account approval, seat binding and invitation consumption back together',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Atomic invitation rollback');
    const prepared = invitation();
    const issued = await f.store.createInvitation(owner.principal, campaign.id, prepared.command);
    const command = {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: prepared.secret,
    };
    const marker = f.runtime.firestore.collection('invitationFaultMarkers').doc(randomUUID());
    await marker.create({ version: 1 });
    const original = f.runtime.firestore.runTransaction.bind(f.runtime.firestore);
    f.runtime.firestore.runTransaction = (operation, options) =>
      original(async (transaction) => {
        const result = await operation(transaction);
        transaction.create(marker, { version: 1 });
        return result;
      }, options);
    try {
      await assert.rejects(f.store.redeemInvitation(recipient.principal, command));
      f.runtime.firestore.runTransaction = original;
      const approval = f.runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(recipient.uid));
      const membership = f.runtime.firestore
        .collection('campaignMemberships')
        .doc(pilotAccountKey(recipient.uid))
        .collection('campaigns')
        .doc(campaign.id);
      const seat = f.runtime.firestore
        .collection('campaigns')
        .doc(campaign.id)
        .collection('seats')
        .doc(issued.seatId);
      assert.equal((await approval.get()).exists, false);
      assert.equal((await membership.get()).exists, false);
      assert.equal((await seat.get()).data().memberUid, null);
      assert.equal(
        (await f.runtime.firestore.collection('campaignInvitations').doc(issued.id).get()).data()
          .redeemedByUid,
        null
      );
      const accepted = await f.store.redeemInvitation(recipient.principal, command);
      assert.equal(accepted.access.seatId, issued.seatId);
      assert.equal((await approval.get()).data().enabled, true);
      assert.equal((await membership.get()).exists, true);
    } finally {
      f.runtime.firestore.runTransaction = original;
      await marker.delete();
    }
  }
);

test(
  'identical issuance and acceptance commands across four store instances publish one seat and one membership receipt',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const recipient = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Identical invitation contention');
    const prepared = invitation();
    const issued = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.createStore().createInvitation(owner.principal, campaign.id, prepared.command)
      )
    );
    for (const result of issued) assert.deepEqual(result, issued[0]);
    assert.equal(
      (await f.runtime.firestore.collection('campaigns').doc(campaign.id).collection('seats').get())
        .size,
      1
    );
    const command = {
      commandId: randomUUID(),
      invitationId: issued[0].id,
      secret: prepared.secret,
    };
    const accepted = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.createStore().redeemInvitation(recipient.principal, command)
      )
    );
    for (const result of accepted) assert.deepEqual(result, accepted[0]);
    assert.equal(
      (
        await f.runtime.firestore
          .collection('campaignMemberships')
          .doc(pilotAccountKey(recipient.uid))
          .collection('campaigns')
          .get()
      ).size,
      1
    );
    assert.equal(
      (
        await f.runtime.firestore
          .collection('accountCommands')
          .doc(pilotAccountKey(recipient.uid))
          .collection('receipts')
          .get()
      ).size,
      1
    );
  }
);
