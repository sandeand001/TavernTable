const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');

async function fixture(t) {
  const runtime = await createEmulatorRuntime();
  t.after(() => runtime.close());
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(__dirname, '..', '..', 'assets', 'data', 'resources', 'manifest.json'),
      'utf8'
    )
  );
  const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
  const store = new CloudCampaignStore({
    firestore: runtime.firestore,
    access,
    packs: manifest.packs,
  });
  const account = async () => {
    const identity = await signedInIdentity(runtime);
    t.after(() => identity.close());
    await runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(identity.uid))
      .set({ version: 1, uid: identity.uid, enabled: true });
    const principal = await access.verifyAuthorization(`Bearer ${identity.token}`);
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
  return { runtime, access, store, account, create, join };
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
