const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { PrivateCampaignAssets } = require('../../tools/cloud/campaign-assets.js');
const { createCanvas } = require('canvas');
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
const { default: CampaignWorld } = require('../../src/campaigns/CampaignWorld.js');
const { default: CombatSession } = require('../../src/entities/characters/CombatSession.js');
const {
  createTwoFloorTravelScene,
} = require('../../src/campaigns/examples/ConnectedTravelExample.js');
const { encodeScene } = require('../../src/campaigns/CampaignScene.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');
const { sceneState } = require('../helpers/sceneState.js');

async function fixture(t, { now, withAssets = false } = {}) {
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
      ...(withAssets ? { assets: new PrivateCampaignAssets({ bucket: runtime.bucket }) } : {}),
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
  const client = (identity, api, fetch = globalThis.fetch) => {
    const environment = readEmulatorEnvironment();
    const connection = new CloudAccountConnection({
      account: new CloudAccount({ auth: identity.auth, sdk }),
      fetch,
      baseURL: api.origin + '/',
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
          appId: 'demo-member-access-client',
        },
      },
    });
    return new CloudCampaignClientStore({ connection, uid: identity.uid, packs: manifest.packs });
  };
  return {
    runtime,
    access,
    store,
    createStore,
    resources,
    manifest,
    account,
    create,
    join,
    client,
    async advancePresence(principal, id, sessionId, advance, target) {
      let at = Date.parse((await store.getLiveStatus(principal, id)).activity.observedAt);
      assert.ok(target >= at);
      for (;;) {
        advance(at);
        await store.connectLivePresence(principal, id, { sessionId });
        if (at === target) return;
        at = Math.min(target, at + 10 * 60 * 1000);
      }
    },
  };
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
  'paused members read only their assigned sheets through current account scope without receiving world state',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const unrelated = await f.account();
    const campaign = await f.create(owner.principal, 'Between-game assigned sheets');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const memberClient = f.client(member, api);
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
      store: ownerClient,
    });
    const hero = await library.create('Between-game hero');
    const npc = await library.create('Private NPC');
    await library.edit(npc, { notes: 'PRIVATE NPC SHEET CONTENT' });
    const validation = { ruleset: '2014', library };
    const scene = CampaignWorld.fromScene(
      sceneState({ characterId: hero, name: 'Between-game hero' }),
      validation
    ).save();
    scene.maps[0].name = 'PRIVATE MAP CONTENT';
    await ownerClient.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: library.revision,
      scene: encodeScene(scene, validation),
    });
    await ownerClient.assignCharacter(campaign.id, {
      seatId,
      characterId: hero,
      assigned: true,
      accessGeneration: 0,
    });
    const grant = await memberClient.getParticipantAccess(campaign.id);
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const original = (await head.get()).data();
    const paused = await ownerClient.getLiveSession(campaign.id);
    const state = await memberClient.readAssignedCharacters(campaign.id, grant.access);
    assert.deepEqual(state.access, grant.access);
    assert.deepEqual(state.characterIds, [hero]);
    assert.equal(state.scene, null);
    assert.ok(state.records.length > 0);
    assert.ok(state.records.every((row) => row.key.endsWith(hero)));
    assert.ok(!JSON.stringify(state).includes('PRIVATE NPC'));
    assert.ok(!JSON.stringify(state).includes('PRIVATE MAP'));
    await assert.rejects(
      f.store.readAssignedCharacters(unrelated.principal, campaign.id, {
        seatId,
        accessGeneration: grant.access.accessGeneration,
      }),
      { code: 'campaign-not-found' }
    );
    assert.deepEqual(await ownerClient.getLiveSession(campaign.id), paused);
    assert.deepEqual((await head.get()).data(), original);
    await ownerClient.assignCharacter(campaign.id, {
      seatId,
      characterId: hero,
      assigned: false,
      accessGeneration: grant.access.accessGeneration,
    });
    await assert.rejects(memberClient.readAssignedCharacters(campaign.id, grant.access), {
      code: 'campaign-access-changed',
    });
    const empty = await memberClient.getParticipantAccess(campaign.id);
    assert.deepEqual(
      (await memberClient.readAssignedCharacters(campaign.id, empty.access)).records,
      []
    );
  }
);

test(
  'paused assigned-sheet saves charge the campaign owner and preserve private sheets, world positions and turn resources',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    await f.create(member.principal, 'Member owns a different campaign');
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const memberClient = f.client(member, api);
    for (const ruleset of ['2014', '2024']) {
      const campaign = await ownerClient.create({ name: `Paused sheet ${ruleset}`, ruleset });
      const seatId = await f.join(campaign.id, member.uid);
      const catalog = await f.resources.catalog(campaign);
      const library = await CampaignCharacters.open({
        campaignId: campaign.id,
        catalog,
        store: ownerClient,
      });
      const hero = await library.create('Assigned traveller');
      const npc = await library.create('Private keeper');
      await library.edit(npc, { notes: 'PRIVATE KEEPER NOTES' });
      const validation = { ruleset, library };
      const scene = CampaignWorld.fromScene(
        sceneState({ ruleset, characterId: hero, name: 'Assigned traveller' }),
        validation
      ).save();
      const combat = new CombatSession({ library: library.engine });
      const actor = { ...scene.creatures[0], characterSheetId: hero };
      combat.startTurn(actor);
      combat.adjustMovement(actor, 20);
      scene.combat = combat.snapshot();
      await ownerClient.commitScene(campaign.id, {
        ruleset,
        revision: 0,
        charactersRevision: library.revision,
        scene: encodeScene(scene, validation),
      });
      await ownerClient.assignCharacter(campaign.id, {
        seatId,
        characterId: hero,
        assigned: true,
        accessGeneration: 0,
      });
      const grant = await memberClient.getParticipantAccess(campaign.id);
      const before = await ownerClient.readCharacters(campaign.id);
      const ownerUsage = f.runtime.firestore
        .collection('accountUsage')
        .doc(pilotAccountKey(owner.uid));
      const memberUsage = f.runtime.firestore
        .collection('accountUsage')
        .doc(pilotAccountKey(member.uid));
      const ownerBytes = (await ownerUsage.get()).data().storageBytes;
      const memberBytes = (await memberUsage.get()).data().storageBytes;
      const state = await memberClient.readAssignedCharacters(campaign.id, grant.access);
      const sheet = new CampaignCharacters({
        ...state,
        catalog,
        store: {
          readCharacters: (id) => memberClient.readAssignedCharacters(id, grant.access),
          commitCharacters: (id, change) =>
            memberClient.commitAssignedCharacters(id, change, grant.access),
        },
      });
      await sheet.edit(hero, { name: 'Renamed between games', notes: 'Persistent assigned notes' });
      const after = await ownerClient.readCharacters(campaign.id);
      const oldWorld = JSON.parse(before.scene);
      const newWorld = JSON.parse(after.scene);
      const expected = structuredClone(oldWorld);
      expected.creatures[0].name = 'Renamed between games';
      assert.deepEqual(newWorld, expected);
      assert.deepEqual(
        after.records.filter((row) => row.key.endsWith(npc)),
        before.records.filter((row) => row.key.endsWith(npc))
      );
      assert.equal(after.revision, before.revision + 1);
      assert.equal(after.sceneRevision, before.sceneRevision + 1);
      const restored = await memberClient.readAssignedCharacters(campaign.id, grant.access);
      const reopened = new CampaignCharacters({ ...restored, catalog, store: sheet.store });
      assert.equal(reopened.get(hero).notes, 'Persistent assigned notes');
      assert.equal(reopened.get(hero).name, 'Renamed between games');
      assert.equal((await ownerClient.getLiveSession(campaign.id)).generation, 0);
      assert.ok((await ownerUsage.get()).data().storageBytes > ownerBytes);
      assert.equal((await memberUsage.get()).data().storageBytes, memberBytes);
    }
  }
);

test(
  'assigned-sheet requests cannot delete characters, alter unassigned records, publish scenes or bypass the owner byte limit',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    await f.create(member.principal, 'Member byte ledger');
    const campaign = await f.create(owner.principal, 'Assigned policy and owner allowance');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const client = f.client(member, api);
    const catalog = await f.resources.catalog(campaign);
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog,
      store: ownerClient,
    });
    const hero = await library.create('Permitted sheet');
    const npc = await library.create('Unassigned sheet');
    await ownerClient.assignCharacter(campaign.id, {
      seatId,
      characterId: hero,
      assigned: true,
      accessGeneration: 0,
    });
    const grant = await client.getParticipantAccess(campaign.id);
    const state = await client.readAssignedCharacters(campaign.id, grant.access);
    const before = await ownerClient.readCharacters(campaign.id);
    const change = { ruleset: '2014', revision: state.revision, records: state.records };
    for (const invalid of [
      {
        ...change,
        records: [...state.records, ...before.records.filter((row) => row.key.endsWith(npc))],
      },
      {
        ...change,
        records: state.records.filter((row) => !row.key.startsWith('taverntable.character.v1.')),
      },
      { ...change, scene: { revision: 0, value: '{}' } },
    ]) {
      await assert.rejects(client.commitAssignedCharacters(campaign.id, invalid, grant.access), {
        code: 'invalid-assigned-change',
      });
      assert.equal(client.pending, null);
    }
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const original = (await head.get()).data();
    const [filesBefore] = await f.runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` });
    await f.runtime.firestore
      .collection('accountUsage')
      .doc(pilotAccountKey(owner.uid))
      .update({ storageBytes: 20 * 1024 ** 3 - 1 });
    const sheet = new CampaignCharacters({
      ...state,
      catalog,
      store: {
        commitCharacters: (id, input) => client.commitAssignedCharacters(id, input, grant.access),
      },
    });
    await assert.rejects(sheet.edit(hero, { notes: 'Cannot borrow the player allowance' }), {
      code: 'storage-limit-reached',
    });
    assert.equal(client.pending, null);
    assert.deepEqual((await head.get()).data(), original);
    const [filesAfter] = await f.runtime.bucket.getFiles({ prefix: `campaigns/${campaign.id}/` });
    assert.equal(filesAfter.length, filesBefore.length);
    assert.equal(
      (
        await f.runtime.firestore.collection('accountUsage').doc(pilotAccountKey(member.uid)).get()
      ).data().storageBytes,
      0
    );
    assert.deepEqual(await ownerClient.readCharacters(campaign.id), before);
  }
);

test(
  'a lost assigned-sheet reply recovers the original own receipt after removal without reviving access',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Assigned original caller recovery');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const catalog = await f.resources.catalog(campaign);
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog,
      store: ownerClient,
    });
    const hero = await library.create('Receipt keeper');
    await ownerClient.assignCharacter(campaign.id, {
      seatId,
      characterId: hero,
      assigned: true,
      accessGeneration: 0,
    });
    let discard = false;
    const bodies = [];
    const client = f.client(member, api, async (url, options) => {
      const assigned = url.endsWith('/assigned-characters') && options.method === 'POST';
      if (assigned) bodies.push(options.body);
      const response = await fetch(url, options);
      if (assigned && discard) {
        discard = false;
        assert.equal(response.status, 200);
        await response.clone().json();
        throw new TypeError('Synthetic lost reply after actual assigned publication');
      }
      return response;
    });
    const grant = await client.getParticipantAccess(campaign.id);
    const state = await client.readAssignedCharacters(campaign.id, grant.access);
    const sheet = new CampaignCharacters({
      ...state,
      catalog,
      store: {
        commitCharacters: (id, input) => client.commitAssignedCharacters(id, input, grant.access),
      },
    });
    let observed;
    const uncertain = new Promise((resolve) => {
      observed = resolve;
    });
    const stop = client.subscribeSave((value) => {
      if (value.phase === 'uncertain') observed();
    });
    t.after(stop);
    discard = true;
    const pending = sheet.edit(hero, { notes: 'Saved once before access removal' });
    await uncertain;
    await ownerClient.removeMember(campaign.id, {
      seatId,
      accessGeneration: grant.access.accessGeneration,
    });
    await client.retryPending();
    await pending;
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(client.pending, null);
    await assert.rejects(client.readAssignedCharacters(campaign.id, grant.access), {
      code: 'campaign-not-found',
    });
    const current = await ownerClient.readCharacters(campaign.id);
    const restored = new CampaignCharacters({ ...current, catalog, store: ownerClient });
    assert.equal(restored.get(hero).notes, 'Saved once before access removal');
    assert.equal(current.revision, state.revision + 1);
    assert.equal((await ownerClient.getLiveSession(campaign.id)).generation, 0);
  }
);

for (const operation of ['read', 'save'])
  test(
    `assigned ${operation} rechecks membership after actual Storage I/O`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const owner = await f.account();
      const member = await f.account();
      const campaign = await f.create(owner.principal, 'In-flight assigned access');
      const seatId = await f.join(campaign.id, member.uid);
      const api = await cloudApi({ access: f.access, store: f.store });
      t.after(() => api.close());
      const ownerClient = f.client(owner, api);
      const memberClient = f.client(member, api);
      const catalog = await f.resources.catalog(campaign);
      const library = await CampaignCharacters.open({
        campaignId: campaign.id,
        catalog,
        store: ownerClient,
      });
      const hero = await library.create('Fenced assigned sheet');
      await ownerClient.assignCharacter(campaign.id, {
        seatId,
        characterId: hero,
        assigned: true,
        accessGeneration: 0,
      });
      const grant = await memberClient.getParticipantAccess(campaign.id);
      const state = await memberClient.readAssignedCharacters(campaign.id, grant.access);
      const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
      const original = (await head.get()).data();
      const originalFile = f.runtime.bucket.file;
      let entered;
      let release;
      let hold = true;
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      f.runtime.bucket.file = function (...args) {
        const file = originalFile.apply(this, args);
        const selected =
          operation === 'read'
            ? args[0] === original.charactersRef.path
            : args[0].includes('/objects/characters/') && args[0] !== original.charactersRef.path;
        if (selected) {
          const method = operation === 'read' ? 'download' : 'save';
          const execute = file[method].bind(file);
          file[method] = async (...values) => {
            const result = await execute(...values);
            if (hold) {
              hold = false;
              entered();
              await gate;
            }
            return result;
          };
        }
        return file;
      };
      t.after(() => {
        release();
        f.runtime.bucket.file = originalFile;
      });
      const sheets = new CampaignCharacters({
        ...state,
        catalog,
        store: {
          commitCharacters: (id, change) =>
            memberClient.commitAssignedCharacters(id, change, grant.access),
        },
      });
      const pending =
        operation === 'read'
          ? memberClient.readAssignedCharacters(campaign.id, grant.access)
          : sheets.edit(hero, { notes: 'Revoked before delivery or publication' });
      const outcome = pending.then(
        (value) => ({ value }),
        (error) => ({ error })
      );
      await started;
      await ownerClient.removeMember(campaign.id, {
        seatId,
        accessGeneration: grant.access.accessGeneration,
      });
      release();
      assert.equal((await outcome).error?.code, 'campaign-not-found');
      assert.deepEqual((await head.get()).data(), original);
      assert.equal((await ownerClient.readCharacters(campaign.id)).revision, state.revision);
      assert.equal((await ownerClient.getLiveSession(campaign.id)).generation, 0);
    }
  );

test(
  'paused member image edits remain private and owner-billed and short sheet reads finish due complete backups',
  { timeout: 30000 },
  async (t) => {
    let now = Date.parse('2026-11-16T00:00:00.000Z');
    const f = await fixture(t, { now: () => now, withAssets: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Assigned image and rolling backup');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const memberClient = f.client(member, api);
    const catalog = await f.resources.catalog(campaign);
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog,
      store: ownerClient,
    });
    const hero = await library.create('Assigned image owner');
    const npc = await library.create('Private backup NPC');
    await library.edit(npc, { notes: 'PRIVATE COMPLETE BACKUP NOTE' });
    await ownerClient.assignCharacter(campaign.id, {
      seatId,
      characterId: hero,
      assigned: true,
      accessGeneration: 0,
    });
    const grant = await memberClient.getParticipantAccess(campaign.id);
    const state = await memberClient.readAssignedCharacters(campaign.id, grant.access);
    const before = await f.store.backupStatus(owner.principal, campaign.id);
    const usage = f.runtime.firestore.collection('accountUsage').doc(pilotAccountKey(owner.uid));
    const originalBytes = (await usage.get()).data().storageBytes;
    const sheets = new CampaignCharacters({
      ...state,
      catalog,
      store: {
        commitCharacters: (id, change) =>
          memberClient.commitAssignedCharacters(id, change, grant.access),
      },
    });
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    const portraitImage = 'data:image/png;base64,' + bytes.toString('base64');
    await sheets.edit(hero, { portraitImage, notes: 'New member backup note' });
    const manifest = await f.store.getAssetManifest(member.principal, campaign.id);
    assert.equal(manifest.images.length, 1);
    const reference = manifest.images[0].reference;
    assert.deepEqual(
      (await f.store.readAsset(member.principal, campaign.id, reference.sha256, grant.access))
        .bytes,
      bytes
    );
    assert.ok((await usage.get()).data().storageBytes > originalBytes + bytes.length);
    assert.equal(
      (await f.store.backupStatus(owner.principal, campaign.id)).latest.name,
      before.latest.name
    );
    now += 5 * 60 * 1000;
    const restored = await memberClient.readAssignedCharacters(campaign.id, grant.access);
    assert.equal(
      new CampaignCharacters({ ...restored, catalog, store: memberClient }).get(hero).portraitImage,
      portraitImage
    );
    const complete = await f.store.backupStatus(owner.principal, campaign.id);
    assert.notEqual(complete.latest.name, before.latest.name);
    const backup = await f.store.readBackup(owner.principal, campaign.id, complete.latest.name);
    assert.ok(backup.includes('PRIVATE COMPLETE BACKUP NOTE'));
    assert.ok(backup.includes('New member backup note'));
    assert.ok(backup.includes(portraitImage));
    await assert.rejects(f.store.readBackup(member.principal, campaign.id, complete.latest.name), {
      code: 'campaign-not-found',
    });
    assert.ok(!JSON.stringify(restored).includes('PRIVATE COMPLETE BACKUP NOTE'));
    assert.equal((await ownerClient.getLiveSession(campaign.id)).generation, 0);
  }
);

test(
  'only the campaign owner controls durable live state and login or membership cannot start or extend it',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const member = await f.account();
    const unrelated = await f.account();
    const campaign = await f.create(owner.principal, 'Owner-controlled live game');
    await f.join(campaign.id, member.uid);
    const otherCampaign = await f.create(member.principal, 'Member owns another campaign');
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const original = (await head.get()).data();
    const paused = await f.store.getLiveSession(member.principal, campaign.id);
    assert.equal(paused.state, 'paused');
    assert.equal(paused.generation, 0);
    assert.equal(paused.sessionId, null);
    await assert.rejects(f.store.getLiveSession(unrelated.principal, campaign.id), {
      code: 'campaign-not-found',
    });
    const start = {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId: paused.sessionId,
    };
    await assert.rejects(f.store.controlLiveSession(member.principal, campaign.id, start), {
      code: 'campaign-not-found',
    });
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, start);
    assert.equal(active.state, 'live');
    assert.equal(active.generation, 1);
    assert.ok(active.sessionId);
    assert.deepEqual(
      await f.createStore().controlLiveSession(owner.principal, campaign.id, start),
      active
    );
    await f.advancePresence(
      owner.principal,
      campaign.id,
      active.sessionId,
      (value) => {
        now = value;
      },
      now + 20 * 60 * 1000
    );
    assert.deepEqual(await f.createStore().getLiveSession(member.principal, campaign.id), active);
    assert.equal(
      (await f.store.getLiveSession(member.principal, otherCampaign.id)).state,
      'paused'
    );
    const keep = {
      commandId: randomUUID(),
      action: 'keep-active',
      generation: active.generation,
      sessionId: active.sessionId,
    };
    await assert.rejects(f.store.controlLiveSession(member.principal, campaign.id, keep), {
      code: 'campaign-not-found',
    });
    let kept = await f.createStore().controlLiveSession(owner.principal, campaign.id, keep);
    assert.equal(kept.sessionId, active.sessionId);
    assert.equal(kept.generation, 2);
    assert.equal(kept.lastMeaningfulAt, new Date(now).toISOString());
    for (let renewal = 0; renewal < 19; renewal++) {
      await f.advancePresence(
        owner.principal,
        campaign.id,
        active.sessionId,
        (value) => {
          now = value;
        },
        now + 20 * 60 * 1000
      );
      kept = await f.createStore().controlLiveSession(owner.principal, campaign.id, {
        commandId: randomUUID(),
        action: 'keep-active',
        generation: kept.generation,
        sessionId: kept.sessionId,
      });
    }
    assert.ok(Date.parse(kept.lastMeaningfulAt) - Date.parse(kept.startedAt) > 6 * 60 * 60 * 1000);
    assert.equal(kept.sessionId, active.sessionId);
    const end = {
      commandId: randomUUID(),
      action: 'end',
      generation: kept.generation,
      sessionId: kept.sessionId,
    };
    const ended = await f.createStore().controlLiveSession(owner.principal, campaign.id, end);
    assert.equal(ended.state, 'paused');
    assert.equal(ended.pauseReason, 'owner-end');
    assert.deepEqual(await f.store.getLiveSession(member.principal, campaign.id), ended);
    assert.deepEqual((await head.get()).data(), original);
    const restarted = await f.createStore().controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: ended.generation,
      sessionId: ended.sessionId,
    });
    assert.notEqual(restarted.sessionId, active.sessionId);
    assert.deepEqual(await f.store.getLiveSession(member.principal, campaign.id), restarted);
  }
);

test(
  'only the last presence disconnect starts a durable fifteen-minute grace across overlapping workers',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Coalesced presence grace');
    await f.join(campaign.id, member.uid);
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const original = (await head.get()).data();
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    const command = { sessionId: active.sessionId };
    const first = await f.store.connectLivePresence(owner.principal, campaign.id, command);
    const second = await f.store.connectLivePresence(member.principal, campaign.id, command);
    const otherWorker = f.createStore();
    const third = await otherWorker.connectLivePresence(member.principal, campaign.id, command);
    now += 30 * 1000;
    await f.store.disconnectLivePresence(owner.principal, campaign.id, {
      ...command,
      connectionId: first.id,
    });
    assert.equal(
      (await f.store.getLiveStatus(member.principal, campaign.id)).activity.disconnectedAt,
      null
    );
    now += 15 * 1000;
    await f.store.disconnectLivePresence(member.principal, campaign.id, {
      ...command,
      connectionId: second.id,
    });
    assert.equal(
      (await f.store.getLiveStatus(owner.principal, campaign.id)).activity.disconnectedAt,
      null
    );
    now += 15 * 1000;
    await otherWorker.disconnectLivePresence(member.principal, campaign.id, {
      ...command,
      connectionId: third.id,
    });
    const disconnectedAt = now;
    const status = await f.createStore().getLiveStatus(owner.principal, campaign.id);
    assert.deepEqual(status.session, active);
    assert.equal(status.activity.disconnectedAt, new Date(disconnectedAt).toISOString());
    assert.equal(
      status.activity.graceUntil,
      new Date(disconnectedAt + 15 * 60 * 1000).toISOString()
    );
    assert.equal(status.activity.pauseAt, status.activity.graceUntil);
    now = disconnectedAt + 15 * 60 * 1000 - 1;
    assert.equal(
      (await f.createStore().getLiveAccess(member.principal, campaign.id, command)).session.state,
      'live'
    );
    now++;
    await assert.rejects(f.createStore().getLiveAccess(member.principal, campaign.id, command), {
      code: 'live-session-paused',
    });
    const paused = await f.store.getLiveSession(owner.principal, campaign.id);
    assert.equal(paused.pauseReason, 'disconnected');
    assert.equal(paused.pausedAt, new Date(now).toISOString());
    assert.equal(paused.lastMeaningfulAt, active.lastMeaningfulAt);
    assert.deepEqual((await head.get()).data(), original);
  }
);

test(
  'ten participant heartbeats coalesce into campaign-level presence writes without extending meaningful activity',
  { timeout: 60000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Coalesced heartbeat writes');
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    const participants = [];
    for (let index = 0; index < 10; index++) {
      const identity = index === 0 ? owner : await f.account();
      if (index > 0) await f.join(campaign.id, identity.uid);
      participants.push({
        principal: identity.principal,
        connection: await f.store.connectLivePresence(identity.principal, campaign.id, {
          sessionId: active.sessionId,
        }),
      });
    }
    const summaries = await f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('livePresence')
      .get();
    assert.equal(summaries.size, 1);
    const reference = summaries.docs[0].ref;
    const startedAt = now;
    let writes = 0;
    for (const seconds of [20, 40, 60, 80, 100, 120]) {
      now = startedAt + seconds * 1000;
      for (const participant of participants) {
        const before = (await reference.get()).updateTime;
        const renewed = await f.store.renewLivePresence(participant.principal, campaign.id, {
          sessionId: active.sessionId,
          connectionId: participant.connection.id,
        });
        const after = (await reference.get()).updateTime;
        const changed = !before.isEqual(after);
        assert.equal(changed, seconds % 60 === 0 && participant === participants[0]);
        if (changed) writes++;
        assert.ok(renewed.expiresAt > now);
      }
    }
    assert.equal(writes, 2);
    const status = await f.createStore().getLiveStatus(owner.principal, campaign.id);
    assert.deepEqual(status.session, active);
    assert.equal(status.activity.disconnectedAt, null);
    assert.equal(
      status.activity.pauseAt,
      new Date(Date.parse(active.lastMeaningfulAt) + 60 * 60 * 1000).toISOString()
    );
  }
);

test(
  'expired presence generations cannot revive or close a replacement and late cleanup cannot restart grace',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Presence epoch fencing');
    await f.join(campaign.id, member.uid);
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    const sessionId = active.sessionId;
    const first = await f.store.connectLivePresence(member.principal, campaign.id, { sessionId });
    now = first.expiresAt;
    await assert.rejects(
      f.store.renewLivePresence(member.principal, campaign.id, {
        sessionId,
        connectionId: first.id,
      }),
      { code: 'live-presence-expired' }
    );
    assert.equal(
      (await f.store.getLiveStatus(owner.principal, campaign.id)).activity.disconnectedAt,
      new Date(now).toISOString()
    );
    now += 60 * 1000;
    const replacement = await f.store.connectLivePresence(member.principal, campaign.id, {
      sessionId,
    });
    await assert.rejects(
      f.store.renewLivePresence(member.principal, campaign.id, {
        sessionId,
        connectionId: first.id,
      }),
      { code: 'live-presence-changed' }
    );
    await f.store.disconnectLivePresence(member.principal, campaign.id, {
      sessionId,
      connectionId: first.id,
    });
    assert.equal(
      (await f.store.getLiveStatus(owner.principal, campaign.id)).activity.disconnectedAt,
      null
    );
    await assert.rejects(
      f.store.disconnectLivePresence(owner.principal, campaign.id, {
        sessionId,
        connectionId: replacement.id,
      }),
      { code: 'campaign-not-found' }
    );
    now = replacement.expiresAt;
    const absent = await f.createStore().getLiveStatus(owner.principal, campaign.id);
    const disconnectedAt = now;
    assert.equal(absent.activity.disconnectedAt, new Date(now).toISOString());
    now += 60 * 1000;
    await f.store.disconnectLivePresence(member.principal, campaign.id, {
      sessionId,
      connectionId: replacement.id,
    });
    const lateCleanup = await f.createStore().getLiveStatus(owner.principal, campaign.id);
    assert.equal(lateCleanup.activity.disconnectedAt, absent.activity.disconnectedAt);
    assert.equal(lateCleanup.activity.graceUntil, absent.activity.graceUntil);
    now = disconnectedAt + 15 * 60 * 1000;
    const attempts = await Promise.allSettled([
      f.createStore().connectLivePresence(member.principal, campaign.id, { sessionId }),
      f.store.controlLiveSession(owner.principal, campaign.id, {
        commandId: randomUUID(),
        action: 'keep-active',
        generation: active.generation,
        sessionId,
      }),
    ]);
    assert.ok(attempts.every((result) => result.status === 'rejected'));
    for (const result of attempts)
      assert.ok(['live-session-paused', 'live-session-changed'].includes(result.reason.code));
    const paused = await f.store.getLiveSession(owner.principal, campaign.id);
    assert.equal(paused.state, 'paused');
    assert.equal(paused.pauseReason, 'disconnected');
    assert.equal(paused.pausedAt, new Date(now).toISOString());
    assert.equal(paused.lastMeaningfulAt, active.lastMeaningfulAt);
    const restarted = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId,
    });
    assert.notEqual(restarted.sessionId, sessionId);
    assert.deepEqual(
      await f.store.disconnectLivePresence(member.principal, campaign.id, {
        sessionId,
        connectionId: replacement.id,
      }),
      { closed: false }
    );
    assert.deepEqual(await f.store.getLiveSession(owner.principal, campaign.id), restarted);
    now += 15 * 60 * 1000;
    await assert.rejects(
      f.store.controlLiveSession(owner.principal, campaign.id, {
        commandId: randomUUID(),
        action: 'keep-active',
        generation: restarted.generation,
        sessionId: restarted.sessionId,
      }),
      { code: 'live-session-paused' }
    );
    const unattached = await f.store.getLiveSession(owner.principal, campaign.id);
    assert.equal(unattached.pauseReason, 'disconnected');
    assert.equal(unattached.pausedAt, new Date(now).toISOString());
  }
);

test(
  'presence renewals recheck current membership and eligibility while revoked connections can still close',
  { timeout: 30000 },
  async (t) => {
    const now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const removed = await f.account();
    const disabled = await f.account();
    const campaign = await f.create(owner.principal, 'Current presence authority');
    await f.join(campaign.id, removed.uid);
    await f.join(campaign.id, disabled.uid);
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    const connections = [];
    for (const identity of [removed, disabled])
      connections.push(
        await f.store.connectLivePresence(identity.principal, campaign.id, {
          sessionId: active.sessionId,
        })
      );
    const summaries = await f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('livePresence')
      .get();
    const reference = summaries.docs[0].ref;
    const stamp = (await reference.get()).updateTime;
    await f.runtime.firestore
      .collection('campaignMemberships')
      .doc(pilotAccountKey(removed.uid))
      .collection('campaigns')
      .doc(campaign.id)
      .delete();
    await f.runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(disabled.uid))
      .update({ enabled: false });
    for (const [index, identity] of [removed, disabled].entries()) {
      const command = { sessionId: active.sessionId, connectionId: connections[index].id };
      await assert.rejects(f.store.renewLivePresence(identity.principal, campaign.id, command), {
        code: index === 0 ? 'campaign-not-found' : 'pilot-access-required',
      });
    }
    assert.ok(stamp.isEqual((await reference.get()).updateTime));
    for (const [index, identity] of [removed, disabled].entries())
      assert.deepEqual(
        await f.store.disconnectLivePresence(identity.principal, campaign.id, {
          sessionId: active.sessionId,
          connectionId: connections[index].id,
        }),
        { closed: true }
      );
    assert.deepEqual(await f.store.getLiveSession(owner.principal, campaign.id), active);
    await reference.update({ count: -1 });
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    await assert.rejects(f.client(owner, api).getLiveStatus(campaign.id), {
      code: 'invalid-live-presence',
    });
    assert.equal((await reference.get()).data().count, -1);
  }
);

test(
  'natural authenticated requests persist the sixty-minute inactivity pause before admission or late keep-active',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const member = await f.account();
    for (const action of ['admission', 'keep-active']) {
      const campaign = await f.create(owner.principal, `Inactivity ${action}`);
      await f.join(campaign.id, member.uid);
      const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
      const original = (await head.get()).data();
      const initial = await f.store.getLiveSession(owner.principal, campaign.id);
      const start = {
        commandId: randomUUID(),
        action: 'start',
        generation: initial.generation,
        sessionId: initial.sessionId,
      };
      const active = await f.store.controlLiveSession(owner.principal, campaign.id, start);
      const startedAt = now;
      await f.advancePresence(
        owner.principal,
        campaign.id,
        active.sessionId,
        (value) => {
          now = value;
        },
        startedAt + 55 * 60 * 1000
      );
      assert.deepEqual(await f.createStore().getLiveSession(member.principal, campaign.id), active);
      now = startedAt + 60 * 60 * 1000 - 1;
      assert.equal(
        (
          await f.createStore().getLiveAccess(member.principal, campaign.id, {
            sessionId: active.sessionId,
          })
        ).session.lastMeaningfulAt,
        active.lastMeaningfulAt
      );
      now++;
      await assert.rejects(
        action === 'admission'
          ? f.createStore().getLiveAccess(member.principal, campaign.id, {
              sessionId: active.sessionId,
            })
          : f.createStore().controlLiveSession(owner.principal, campaign.id, {
              commandId: randomUUID(),
              action,
              generation: active.generation,
              sessionId: active.sessionId,
            }),
        { code: 'live-session-paused' }
      );
      const expected = {
        ...active,
        generation: active.generation + 1,
        state: 'paused',
        pausedAt: new Date(now).toISOString(),
        pauseReason: 'inactivity',
      };
      assert.deepEqual(
        (await head.collection('liveSession').doc('current').get()).data(),
        expected
      );
      now += 10 * 60 * 1000;
      assert.deepEqual(
        await f.createStore().controlLiveSession(owner.principal, campaign.id, start),
        active
      );
      assert.deepEqual(
        await f.createStore().getLiveSession(owner.principal, campaign.id),
        expected
      );
      assert.deepEqual((await head.get()).data(), original);
    }
  }
);

test(
  'accepted world and sheet changes renew inactivity atomically but camera, unchanged, invalid and replayed saves do not',
  { timeout: 60000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const client = f.client(owner, api);
    for (const connected of [false, true]) {
      const campaign = await f.create(
        owner.principal,
        `Meaningful ${connected ? 'world' : 'board'}`
      );
      const catalog = await f.resources.catalog(campaign);
      const library = await CampaignCharacters.open({
        campaignId: campaign.id,
        catalog,
        store: client,
      });
      const actorId = await library.create('Activity scout');
      const validation = { library, ruleset: '2014' };
      const initial = sceneState({ characterId: actorId, name: 'Activity scout' });
      const scene = connected ? CampaignWorld.fromScene(initial, validation).save() : initial;
      let revision = 0;
      let active = null;
      const save = async (value) => {
        if (active !== null)
          await f.advancePresence(
            owner.principal,
            campaign.id,
            active.sessionId,
            (at) => {
              now = at;
            },
            now
          );
        const command = {
          commandId: randomUUID(),
          change: {
            ruleset: '2014',
            revision,
            charactersRevision: library.revision,
            scene: encodeScene(value, validation),
          },
        };
        revision = (await f.store.commitScene(owner.principal, campaign.id, command)).revision;
        return command;
      };
      await save(scene);
      const paused = await client.getLiveSession(campaign.id);
      active = await client.controlLiveSession(campaign.id, 'start', paused);
      now += 10 * 60 * 1000;
      scene.creatures[0].gridX = 3;
      scene.creatures[0].pose.world.x = 3.5;
      const move = await save(scene);
      let acceptedAt = new Date(now).toISOString();
      assert.equal((await client.getLiveSession(campaign.id)).lastMeaningfulAt, acceptedAt);
      now += 5 * 60 * 1000;
      await save(scene);
      now += 5 * 60 * 1000;
      const camera = connected ? scene.view.camera : scene.camera;
      camera.zoom = 2;
      if (connected) scene.view.focusTokenId = scene.creatures[0].id;
      else scene.selection = scene.creatures[0].id;
      await save(scene);
      now += 60 * 1000;
      const invalid = structuredClone(scene);
      invalid.creatures[0].gridX = 999;
      await assert.rejects(
        f.store.commitScene(owner.principal, campaign.id, {
          commandId: randomUUID(),
          change: {
            ruleset: '2014',
            revision,
            charactersRevision: library.revision,
            scene: JSON.stringify(invalid),
          },
        }),
        { code: 'invalid-campaign-change' }
      );
      await f.createStore().commitScene(owner.principal, campaign.id, move);
      assert.equal((await client.getLiveSession(campaign.id)).lastMeaningfulAt, acceptedAt);
      now += 5 * 60 * 1000;
      scene.rollLog.push({
        id: 1,
        message: 'Activity scout rolls perception: 17',
        type: 'dice',
        timestamp: new Date(now).toISOString(),
      });
      await save(scene);
      acceptedAt = new Date(now).toISOString();
      assert.equal((await client.getLiveSession(campaign.id)).lastMeaningfulAt, acceptedAt);
      now += 5 * 60 * 1000;
      const terrain = connected ? scene.maps[0].terrain : scene.terrain;
      terrain.heights[0][0]++;
      await save(scene);
      acceptedAt = new Date(now).toISOString();
      assert.equal((await client.getLiveSession(campaign.id)).lastMeaningfulAt, acceptedAt);
      now += 5 * 60 * 1000;
      const combat = new CombatSession({ library: library.engine });
      combat.startTurn({ ...scene.creatures[0], characterSheetId: actorId });
      scene.combat = combat.snapshot();
      await save(scene);
      acceptedAt = new Date(now).toISOString();
      assert.equal((await client.getLiveSession(campaign.id)).lastMeaningfulAt, acceptedAt);
      now += 5 * 60 * 1000;
      const current = await CampaignCharacters.open({
        campaignId: campaign.id,
        catalog,
        store: client,
      });
      await current.create('Accepted sheet addition');
      acceptedAt = new Date(now).toISOString();
      const changed = await client.getLiveSession(campaign.id);
      assert.equal(changed.lastMeaningfulAt, acceptedAt);
      assert.equal(changed.generation, active.generation);
      now += 60 * 1000;
      const unchanged = await f.store.readCharacters(owner.principal, campaign.id);
      await f.store.commitCharacters(owner.principal, campaign.id, {
        commandId: randomUUID(),
        change: { ruleset: '2014', revision: unchanged.revision, records: unchanged.records },
      });
      assert.equal((await client.getLiveSession(campaign.id)).lastMeaningfulAt, acceptedAt);
      const ended = await client.controlLiveSession(campaign.id, 'end', active);
      assert.equal(ended.lastMeaningfulAt, acceptedAt);
      assert.equal(ended.pauseReason, 'owner-end');
      assert.equal((await client.getLiveSession(campaign.id)).state, 'paused');
    }
  }
);

test(
  'authenticated live status warns at fifty-five minutes and replayed owner keep-active never renews twice',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Inactivity warning boundaries');
    await f.join(campaign.id, member.uid);
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const original = (await head.get()).data();
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    let controlBody;
    const memberClient = f.client(member, api);
    const client = f.client(owner, api, async (url, options) => {
      if (url.endsWith('/live') && options.method === 'POST') controlBody = options.body;
      return fetch(url, options);
    });
    const active = await client.controlLiveSession(
      campaign.id,
      'start',
      await client.getLiveSession(campaign.id)
    );
    const startedAt = now;
    const status = async () => {
      const response = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}/live/status`, {
        headers: { Authorization: 'Bearer ' + member.token },
      });
      assert.equal(response.status, 200);
      const value = (await response.json()).result;
      assert.deepEqual(await memberClient.getLiveStatus(campaign.id), value);
      return value;
    };
    await f.advancePresence(
      owner.principal,
      campaign.id,
      active.sessionId,
      (value) => {
        now = value;
      },
      startedAt + 55 * 60 * 1000 - 1
    );
    let current = await status();
    assert.equal(current.activity.phase, 'active');
    assert.equal(current.activity.observedAt, new Date(now).toISOString());
    assert.equal(current.activity.warningAt, new Date(startedAt + 55 * 60 * 1000).toISOString());
    assert.equal(current.activity.pauseAt, new Date(startedAt + 60 * 60 * 1000).toISOString());
    now++;
    current = await status();
    assert.equal(current.activity.phase, 'warning');
    assert.deepEqual(current.session, active);
    const kept = await client.controlLiveSession(campaign.id, 'keep-active', active);
    const keepBody = controlBody;
    const renewedAt = now;
    now += 5 * 60 * 1000;
    const replay = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}/live`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + owner.token, 'Content-Type': 'application/json' },
      body: keepBody,
    });
    assert.equal(replay.status, 200);
    assert.deepEqual((await replay.json()).result, kept);
    current = await status();
    assert.equal(current.activity.phase, 'active');
    assert.deepEqual(current.session, kept);
    assert.equal(current.activity.pauseAt, current.activity.graceUntil);
    assert.ok(Date.parse(current.activity.pauseAt) < renewedAt + 60 * 60 * 1000);
    await f.advancePresence(
      owner.principal,
      campaign.id,
      active.sessionId,
      (value) => {
        now = value;
      },
      now
    );
    current = await status();
    assert.equal(current.activity.disconnectedAt, null);
    assert.deepEqual(current.session, kept);
    assert.equal(current.activity.pauseAt, new Date(renewedAt + 60 * 60 * 1000).toISOString());
    await f.advancePresence(
      owner.principal,
      campaign.id,
      active.sessionId,
      (value) => {
        now = value;
      },
      renewedAt + 55 * 60 * 1000
    );
    assert.equal((await status()).activity.phase, 'warning');
    now = renewedAt + 60 * 60 * 1000;
    current = await status();
    assert.equal(current.session.state, 'paused');
    assert.equal(current.session.pauseReason, 'inactivity');
    assert.equal(current.session.pausedAt, new Date(now).toISOString());
    assert.deepEqual(current.activity, {
      observedAt: new Date(now).toISOString(),
      warningAt: null,
      pauseAt: null,
      phase: 'paused',
      disconnectedAt: null,
      graceUntil: null,
    });
    assert.deepEqual((await head.get()).data(), original);
  }
);

test(
  'authenticated live admission rejects paused, stale-session and removed-member access across backend instances',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Live admission scope');
    await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const request = async (identity, suffix, body) => {
      const response = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}/${suffix}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: 'Bearer ' + identity.token,
          Origin: api.origin,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, data: await response.json() };
    };
    const paused = await request(member, 'live');
    assert.equal(paused.status, 200);
    assert.equal(
      (await request(member, 'live/access', { sessionId: null })).data.code,
      'live-session-paused'
    );
    const started = await request(owner, 'live', {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    assert.equal(started.status, 200);
    const active = started.data.result;
    const admitted = await request(member, 'live/access', { sessionId: active.sessionId });
    assert.equal(admitted.status, 200);
    assert.equal(admitted.data.result.session.sessionId, active.sessionId);
    assert.equal(admitted.data.result.participant.access.uid, member.uid);
    assert.equal(admitted.data.result.participant.access.role, 'member');
    const ended = await request(owner, 'live', {
      commandId: randomUUID(),
      action: 'end',
      generation: active.generation,
      sessionId: active.sessionId,
    });
    assert.equal(ended.status, 200);
    assert.equal(
      (await request(member, 'live/access', { sessionId: active.sessionId })).data.code,
      'live-session-paused'
    );
    const restarted = await f.createStore().controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: ended.data.result.generation,
      sessionId: active.sessionId,
    });
    assert.equal(
      (await request(member, 'live/access', { sessionId: active.sessionId })).data.code,
      'live-session-changed'
    );
    assert.equal(
      (await request(member, 'live/access', { sessionId: restarted.sessionId })).status,
      200
    );
    await f.store.removeMember(owner.principal, campaign.id, {
      commandId: randomUUID(),
      seatId: admitted.data.result.participant.access.seatId,
      accessGeneration: 0,
    });
    assert.equal(
      (await request(member, 'live/access', { sessionId: restarted.sessionId })).status,
      404
    );
    assert.equal(
      (await f.store.getLiveSession(owner.principal, campaign.id)).sessionId,
      restarted.sessionId
    );
  }
);

test(
  'an uncertain owner control retries its original command without reviving an obsolete live-state receipt',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Uncertain live control');
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const bodies = [];
    let lose = true;
    const client = f.client(owner, api, async (url, options) => {
      const response = await fetch(url, options);
      if (url.endsWith('/live') && options.method === 'POST') {
        bodies.push(options.body);
        if (lose) {
          lose = false;
          assert.equal(response.status, 200);
          await response.clone().json();
          throw new TypeError('Fixture lost the committed owner start reply');
        }
      }
      return response;
    });
    t.after(() => client.close());
    const initial = await client.getLiveSession(campaign.id);
    await assert.rejects(client.controlLiveSession(campaign.id, 'start', initial), {
      code: 'cloud-unavailable',
    });
    assert.equal(client.saveState.phase, 'idle');
    const active = await f.createStore().getLiveSession(owner.principal, campaign.id);
    assert.equal(active.state, 'live');
    const ended = await f.createStore().controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'end',
      generation: active.generation,
      sessionId: active.sessionId,
    });
    const historical = await client.retryLiveSession();
    assert.deepEqual(historical, active);
    assert.deepEqual(await client.getLiveSession(campaign.id), ended);
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0], bodies[1]);
    assert.equal(client.saveState.phase, 'idle');
    const restarted = await client.controlLiveSession(campaign.id, 'start', ended);
    assert.notEqual(restarted.sessionId, active.sessionId);
    const access = await client.getLiveAccess(campaign.id, restarted.sessionId);
    assert.equal(access.participant.access.uid, owner.uid);
    assert.equal(access.session.sessionId, restarted.sessionId);
  }
);

test(
  'competing live controls serialize and damaged live metadata cannot silently reset a campaign',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Concurrent live-state authority');
    const start = { commandId: randomUUID(), action: 'start', generation: 0, sessionId: null };
    const starts = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.createStore().controlLiveSession(owner.principal, campaign.id, start)
      )
    );
    for (const result of starts) assert.deepEqual(result, starts[0]);
    const active = starts[0];
    const race = await Promise.allSettled(
      ['end', 'keep-active'].map((action) =>
        f.createStore().controlLiveSession(owner.principal, campaign.id, {
          commandId: randomUUID(),
          action,
          generation: active.generation,
          sessionId: active.sessionId,
        })
      )
    );
    assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(
      race.find((result) => result.status === 'rejected').reason.code,
      'live-session-changed'
    );
    const winner = race.find((result) => result.status === 'fulfilled').value;
    assert.equal(winner.generation, 2);
    await assert.rejects(
      f.store.create(owner.principal, {
        commandId: start.commandId,
        options: { name: 'Conflicting command endpoint', ruleset: '2014' },
      }),
      { code: 'command-id-conflict' }
    );
    const reference = f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('liveSession')
      .doc('current');
    await reference.update({ generation: -1 });
    await assert.rejects(f.store.getLiveSession(owner.principal, campaign.id), {
      code: 'invalid-live-session',
    });
    await assert.rejects(
      f.store.controlLiveSession(owner.principal, campaign.id, {
        commandId: randomUUID(),
        action: 'start',
        generation: 0,
        sessionId: null,
      }),
      { code: 'invalid-live-session' }
    );
    assert.equal((await reference.get()).data().generation, -1);
  }
);

test(
  'paused owner token preparation preserves committed movement, actions, sheets and the ended live session',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Paused token preparation');
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
      store: {
        readCharacters: (id) => f.store.readCharacters(owner.principal, id),
        commitCharacters: (id, change) =>
          f.store.commitCharacters(owner.principal, id, {
            commandId: randomUUID(),
            change,
          }),
      },
    });
    for (const name of ['Pathfinder', 'Lower lookout', 'Upper lookout']) await library.create(name);
    const validation = { library, ruleset: '2014' };
    const world = CampaignWorld.fromScene(
      createTwoFloorTravelScene({
        ruleset: '2014',
        characters: library.list(),
      }),
      validation
    );
    const initial = world.save();
    const combat = new CombatSession({ library: library.engine });
    const actor = { ...initial.creatures[0], characterSheetId: initial.creatures[0].characterId };
    combat.startTurn(actor);
    combat.adjustMovement(actor, 20);
    initial.combat = combat.snapshot();
    world.acceptCheckpoint(initial);
    await f.store.commitScene(owner.principal, campaign.id, {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: library.revision,
        scene: encodeScene(world.save(), validation),
      },
    });
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    const ended = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'end',
      generation: active.generation,
      sessionId: active.sessionId,
    });
    const before = await f.store.readCharacters(owner.principal, campaign.id);
    const prepared = world.save();
    prepared.creatures[0].gridX = 9;
    prepared.creatures[0].pose.world.x = 9.5;
    world.acceptCheckpoint(prepared);
    const scene = encodeScene(world.save(), validation);
    await f.store.commitScene(owner.principal, campaign.id, {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene,
      },
    });
    const after = await f.createStore().readCharacters(owner.principal, campaign.id);
    assert.equal(after.scene, scene);
    assert.deepEqual(after.records, before.records);
    assert.deepEqual(JSON.parse(after.scene).combat, JSON.parse(before.scene).combat);
    assert.equal(JSON.parse(after.scene).creatures[0].gridX, 9);
    assert.deepEqual(await f.store.getLiveSession(owner.principal, campaign.id), ended);
  }
);

test(
  'campaign copy import preserves saved data but never copies the source live-game authority',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const source = await f.create(owner.principal, 'Live source is not copied');
    const active = await f.store.controlLiveSession(owner.principal, source.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    const text = await f.store.exportBackup(owner.principal, source.id);
    assert.equal(text.includes(active.sessionId), false);
    const bytes = Buffer.from(text);
    const commandId = randomUUID();
    const ticket = await f.store.startImport(owner.principal, {
      commandId,
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    await f.store.uploadImportChunk(owner.principal, ticket.importId, {
      index: 0,
      data: bytes.toString('base64'),
    });
    const copied = await f.store.finishImport(owner.principal, ticket.importId, { commandId });
    const state = await f.createStore().getLiveSession(owner.principal, copied.campaign.id);
    assert.equal(state.state, 'paused');
    assert.equal(state.generation, 0);
    assert.equal(state.sessionId, null);
    assert.deepEqual(await f.store.getLiveSession(owner.principal, source.id), active);
  }
);

test(
  'removing a member revokes its account access while preserving the original seat and canonical campaign',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Member removal fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const before = (await head.get()).data();
    assert.equal((await f.store.getAccess(member.principal, campaign.id)).seatId, seatId);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const response = await fetch(
      api.url + '/api/cloud/campaigns/' + campaign.id + '/members/remove',
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + owner.token,
          Origin: api.origin,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ commandId: randomUUID(), seatId, accessGeneration: 0 }),
      }
    );
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.deepEqual(Object.keys(result).sort(), [
      'accessGeneration',
      'removedAt',
      'seatId',
      'version',
    ]);
    assert.equal(result.version, 1);
    assert.equal(result.seatId, seatId);
    assert.equal(result.accessGeneration, 1);
    assert.ok(Number.isFinite(Date.parse(result.removedAt)));
    await assert.rejects(f.store.getAccess(member.principal, campaign.id), {
      code: 'campaign-not-found',
    });
    assert.deepEqual(await f.store.listAccess(member.principal), { owned: [], joined: [] });
    const seats = await f.store.listSeats(owner.principal, campaign.id);
    assert.equal(seats.length, 1);
    assert.equal(seats[0].id, seatId);
    assert.equal(seats[0].joined, false);
    assert.deepEqual((await head.get()).data(), before);
  }
);

test(
  'a removed and reinvited UID cannot reuse its earlier participant-access scope',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Scoped rejoin fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const read = (accessGeneration = null) =>
      fetch(api.url + '/api/cloud/campaigns/' + campaign.id + '/participant-access', {
        headers: {
          Authorization: 'Bearer ' + member.token,
          Origin: api.origin,
          ...(accessGeneration === null
            ? {}
            : {
                'X-TavernTable-Seat': seatId,
                'X-TavernTable-Access-Generation': String(accessGeneration),
              }),
        },
      });
    const initial = await read();
    assert.equal(initial.status, 200);
    const before = (await initial.json()).result;
    assert.deepEqual(Object.keys(before).sort(), ['access', 'campaign', 'characterIds', 'version']);
    assert.deepEqual(before.access, {
      version: 1,
      uid: member.uid,
      campaignId: campaign.id,
      role: 'member',
      seatId,
      accessGeneration: 0,
    });
    assert.deepEqual(before.characterIds, []);
    await f.store.removeMember(owner.principal, campaign.id, {
      commandId: randomUUID(),
      seatId,
      accessGeneration: 0,
    });
    assert.equal((await read(0)).status, 404);
    const replacement = invitation('Returning member', seatId);
    const issued = await f.store.createInvitation(
      owner.principal,
      campaign.id,
      replacement.command
    );
    await f.store.redeemInvitation(member.principal, {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: replacement.secret,
    });
    const stale = await read(0);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).code, 'campaign-access-changed');
    const current = await read();
    assert.equal(current.status, 200);
    const after = (await current.json()).result;
    assert.equal(after.access.uid, member.uid);
    assert.equal(after.access.seatId, seatId);
    assert.equal(after.access.accessGeneration, 2);
    assert.equal((await read(2)).status, 200);
    assert.deepEqual(
      await f.store.getAccess(member.principal, campaign.id),
      summary(campaign, 'member', seatId)
    );
  }
);

test(
  'assigning an actual saved character advances only the member access scope, not canonical campaign data',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Character assignment fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const library = await CampaignCharacters.open({
      store: ownerClient,
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
    });
    const characterId = await library.create('Persisted assignment scout');
    const before = await ownerClient.readCharacters(campaign.id);
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const headBefore = (await head.get()).data();
    const response = await fetch(api.url + '/api/cloud/campaigns/' + campaign.id + '/assignments', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + owner.token,
        Origin: api.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commandId: randomUUID(),
        seatId,
        characterId,
        assigned: true,
        accessGeneration: 0,
      }),
    });
    assert.equal(response.status, 200);
    const { result } = await response.json();
    assert.deepEqual(result, {
      version: 1,
      seatId,
      characterIds: [characterId],
      accessGeneration: 1,
      changed: true,
    });
    const manifest = await fetch(
      api.url + '/api/cloud/campaigns/' + campaign.id + '/participant-access',
      {
        headers: { Authorization: 'Bearer ' + member.token, Origin: api.origin },
      }
    );
    assert.equal(manifest.status, 200);
    const current = (await manifest.json()).result;
    assert.deepEqual(current.characterIds, [characterId]);
    assert.equal(current.access.accessGeneration, 1);
    assert.deepEqual(await ownerClient.readCharacters(campaign.id), before);
    assert.deepEqual((await head.get()).data(), headBefore);
  }
);

test(
  'removing one explicitly shared player grant preserves its assignments, the saved character and the other player access',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const first = await f.account();
    const second = await f.account();
    const campaign = await f.create(owner.principal, 'Shared character removal fixture');
    const firstSeat = await f.join(campaign.id, first.uid);
    const secondSeat = await f.join(campaign.id, second.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const library = await CampaignCharacters.open({
      store: ownerClient,
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
    });
    const characterId = await library.create('Deliberately shared scout');
    const before = await ownerClient.readCharacters(campaign.id);
    for (const seatId of [firstSeat, secondSeat])
      await f.store.assignCharacter(owner.principal, campaign.id, {
        commandId: randomUUID(),
        seatId,
        characterId,
        assigned: true,
        accessGeneration: 0,
      });
    assert.deepEqual(
      (await f.store.getParticipantAccess(first.principal, campaign.id)).characterIds,
      [characterId]
    );
    assert.deepEqual(
      (await f.store.getParticipantAccess(second.principal, campaign.id)).characterIds,
      [characterId]
    );
    await f.store.removeMember(owner.principal, campaign.id, {
      commandId: randomUUID(),
      seatId: firstSeat,
      accessGeneration: 1,
    });
    await assert.rejects(
      f.store.getParticipantAccess(first.principal, campaign.id, {
        seatId: firstSeat,
        accessGeneration: 1,
      }),
      { code: 'campaign-not-found' }
    );
    const unaffected = await f.store.getParticipantAccess(second.principal, campaign.id, {
      seatId: secondSeat,
      accessGeneration: 1,
    });
    assert.deepEqual(unaffected.characterIds, [characterId]);
    const retained = (await f.store.listSeats(owner.principal, campaign.id)).find(
      (seat) => seat.id === firstSeat
    );
    assert.equal(retained.joined, false);
    assert.deepEqual(retained.characterIds, [characterId]);
    assert.deepEqual(await ownerClient.readCharacters(campaign.id), before);
  }
);

test(
  'deleting a saved character invalidates its old access scope while preserving remaining assignments and records',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Deleted character access fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const library = await CampaignCharacters.open({
      store: ownerClient,
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
    });
    const removedId = await library.create('Character to delete');
    const remainingId = await library.create('Character to retain');
    for (const [generation, characterId] of [removedId, remainingId].entries())
      await f.store.assignCharacter(owner.principal, campaign.id, {
        commandId: randomUUID(),
        seatId,
        characterId,
        assigned: true,
        accessGeneration: generation,
      });
    const before = await ownerClient.readCharacters(campaign.id);
    const original = await f.store.getParticipantAccess(member.principal, campaign.id);
    assert.equal(original.access.accessGeneration, 2);
    await library.delete(removedId);
    await assert.rejects(
      f.store.getParticipantAccess(member.principal, campaign.id, {
        seatId,
        accessGeneration: original.access.accessGeneration,
      }),
      { code: 'campaign-access-changed' }
    );
    const current = await f.store.getParticipantAccess(member.principal, campaign.id);
    assert.equal(current.access.accessGeneration, 3);
    assert.deepEqual(current.characterIds, [remainingId]);
    const after = await ownerClient.readCharacters(campaign.id);
    assert.deepEqual(
      after.records.filter((record) => record.key.endsWith('.' + remainingId)),
      before.records.filter((record) => record.key.endsWith('.' + remainingId))
    );
    assert.equal(
      after.records.some((record) => record.key.endsWith('.' + removedId)),
      false
    );
  }
);

test(
  'a failed canonical deletion rolls back access revocation and retries the same command exactly once',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Atomic deletion revocation fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const library = await CampaignCharacters.open({
      store: ownerClient,
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
    });
    const characterId = await library.create('Atomic deletion scout');
    await f.store.assignCharacter(owner.principal, campaign.id, {
      commandId: randomUUID(),
      seatId,
      characterId,
      assigned: true,
      accessGeneration: 0,
    });
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const before = (await head.get()).data();
    const beforeRecords = await ownerClient.readCharacters(campaign.id);
    const marker = head.collection('changes').doc(String(before.generation + 1));
    await marker.create({ fixturePublicationConflict: true });
    let stop = () => {};
    const uncertain = new Promise((resolve) => {
      stop = ownerClient.subscribeSave((state) => {
        if (state.phase === 'uncertain') resolve(state);
      });
    });
    const pending = library.delete(characterId);
    try {
      const state = await uncertain;
      const originalCommandId = state.commandId;
      assert.deepEqual((await head.get()).data(), before);
      assert.deepEqual(await ownerClient.readCharacters(campaign.id), beforeRecords);
      const retained = await f.store.getParticipantAccess(member.principal, campaign.id, {
        seatId,
        accessGeneration: 1,
      });
      assert.deepEqual(retained.characterIds, [characterId]);
      await marker.delete();
      assert.equal(ownerClient.saveState.commandId, originalCommandId);
      await ownerClient.retryPending();
      await pending;
      assert.equal((await head.get()).data().generation, before.generation + 1);
      await assert.rejects(
        f.store.getParticipantAccess(member.principal, campaign.id, {
          seatId,
          accessGeneration: 1,
        }),
        { code: 'campaign-access-changed' }
      );
      const current = await f.store.getParticipantAccess(member.principal, campaign.id);
      assert.equal(current.access.accessGeneration, 2);
      assert.deepEqual(current.characterIds, []);
    } finally {
      stop();
      await marker.delete();
    }
  }
);

test(
  'owner seat projections expose the current access generation without member identifiers or canonical data',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Seat generation projection fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const initial = await f.store.listSeats(owner.principal, campaign.id);
    assert.equal(initial[0].version, 2);
    assert.equal(initial[0].accessGeneration, 0);
    assert.deepEqual(Object.keys(initial[0]).sort(), [
      'accessGeneration',
      'characterIds',
      'id',
      'invitation',
      'joined',
      'name',
      'version',
    ]);
    assert.equal(JSON.stringify(initial).includes(member.uid), false);
    await f.store.removeMember(owner.principal, campaign.id, {
      commandId: randomUUID(),
      seatId,
      accessGeneration: 0,
    });
    const removed = await f.store.listSeats(owner.principal, campaign.id);
    assert.equal(removed[0].accessGeneration, 1);
    assert.equal(removed[0].joined, false);
    await assert.rejects(f.store.listSeats(member.principal, campaign.id), {
      code: 'campaign-not-found',
    });
  }
);

test(
  'member administration and scoped manifests fail closed for other UIDs, forged roles and malformed headers',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const unrelated = await f.account();
    const unapproved = await f.account({ eligible: false });
    const campaign = await f.create(owner.principal, 'Scoped access denial fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const request = (identity, suffix, { method = 'GET', body, headers = {} } = {}) =>
      fetch(api.url + '/api/cloud/campaigns/' + campaign.id + suffix, {
        method,
        headers: {
          Origin: api.origin,
          Authorization: 'Bearer ' + identity.token,
          ...headers,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    for (const identity of [member, unrelated]) {
      assert.equal(
        (
          await request(identity, '/members/remove', {
            method: 'POST',
            body: { commandId: randomUUID(), seatId, accessGeneration: 0 },
          })
        ).status,
        404
      );
      assert.equal(
        (
          await request(identity, '/assignments', {
            method: 'POST',
            body: {
              commandId: randomUUID(),
              seatId,
              accessGeneration: 0,
              characterId: 'unavailable-character',
              assigned: true,
            },
          })
        ).status,
        404
      );
    }
    assert.equal((await request(unrelated, '/participant-access')).status, 404);
    assert.equal((await request(unapproved, '/participant-access')).status, 403);
    const valid = await request(member, '/participant-access');
    assert.equal(valid.status, 200);
    const manifest = (await valid.json()).result;
    assert.equal(manifest.access.uid, member.uid);
    assert.equal(JSON.stringify(manifest).includes(owner.uid), false);
    for (const headers of [
      { 'X-TavernTable-Seat': 'owner', 'X-TavernTable-Access-Generation': '0' },
      { 'X-TavernTable-Seat': randomUUID(), 'X-TavernTable-Access-Generation': '0' },
      { 'X-TavernTable-Seat': seatId, 'X-TavernTable-Access-Generation': '1' },
    ]) {
      const response = await request(member, '/participant-access', { headers });
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'campaign-access-changed');
    }
    for (const generation of ['', '-1', '01', '1.5', '1e3', '9007199254740992']) {
      assert.equal(
        (
          await request(member, '/participant-access', {
            headers: {
              'X-TavernTable-Seat': seatId,
              'X-TavernTable-Access-Generation': generation,
            },
          })
        ).status,
        400
      );
    }
    assert.equal(
      (await request(member, '/participant-access', { headers: { 'X-TavernTable-Seat': seatId } }))
        .status,
      400
    );
    assert.equal(
      (
        await request(owner, '/characters', {
          headers: {
            'X-TavernTable-Seat': 'owner',
            'X-TavernTable-Access-Generation': '0',
          },
        })
      ).status,
      400
    );
    const preflight = await request(member, '/participant-access', { method: 'OPTIONS' });
    assert.equal(preflight.status, 204);
    assert.ok(preflight.headers.get('access-control-allow-headers').includes('X-TavernTable-Seat'));
    assert.ok(
      preflight.headers
        .get('access-control-allow-headers')
        .includes('X-TavernTable-Access-Generation')
    );
  }
);

test(
  'assignment contention has one winner, identical commands replay once, and later reassignment cannot revive an old scope',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Assignment contention fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const library = await CampaignCharacters.open({
      store: ownerClient,
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
    });
    const ids = [await library.create('First contender'), await library.create('Second contender')];
    const before = await ownerClient.readCharacters(campaign.id);
    const competing = await Promise.allSettled(
      ids.map((characterId) =>
        f.createStore().assignCharacter(owner.principal, campaign.id, {
          commandId: randomUUID(),
          seatId,
          characterId,
          assigned: true,
          accessGeneration: 0,
        })
      )
    );
    const winners = competing.filter((result) => result.status === 'fulfilled');
    const losers = competing.filter((result) => result.status === 'rejected');
    assert.equal(winners.length, 1);
    assert.equal(losers.length, 1);
    assert.equal(losers[0].reason.code, 'campaign-access-changed', losers[0].reason.message);
    const characterId = winners[0].value.characterIds[0];
    const sameState = await f.store.assignCharacter(owner.principal, campaign.id, {
      commandId: randomUUID(),
      seatId,
      characterId,
      assigned: true,
      accessGeneration: 1,
    });
    assert.equal(sameState.changed, false);
    assert.equal(sameState.accessGeneration, 1);
    const command = {
      commandId: randomUUID(),
      seatId,
      characterId,
      assigned: false,
      accessGeneration: 1,
    };
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        f.createStore().assignCharacter(owner.principal, campaign.id, command)
      )
    );
    for (const result of results) assert.deepEqual(result, results[0]);
    assert.equal(results[0].accessGeneration, 2);
    assert.deepEqual(results[0].characterIds, []);
    await f.store.assignCharacter(owner.principal, campaign.id, {
      commandId: randomUUID(),
      seatId,
      characterId,
      assigned: true,
      accessGeneration: 2,
    });
    await assert.rejects(
      f.store.getParticipantAccess(member.principal, campaign.id, {
        seatId,
        accessGeneration: 1,
      }),
      { code: 'campaign-access-changed' }
    );
    const current = await f.store.getParticipantAccess(member.principal, campaign.id);
    assert.equal(current.access.accessGeneration, 3);
    assert.deepEqual(current.characterIds, [characterId]);
    assert.deepEqual(await ownerClient.readCharacters(campaign.id), before);
  }
);

for (const scenario of ['canonical snapshot', 'membership'])
  test(
    `an in-flight assignment rechecks the ${scenario} before publication`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const owner = await f.account();
      const member = await f.account();
      const campaign = await f.create(owner.principal, 'In-flight assignment fixture');
      const seatId = await f.join(campaign.id, member.uid);
      const api = await cloudApi({ access: f.access, store: f.store });
      t.after(() => api.close());
      const ownerClient = f.client(owner, api);
      const library = await CampaignCharacters.open({
        store: ownerClient,
        campaignId: campaign.id,
        catalog: await f.resources.catalog(campaign),
      });
      const characterId = await library.create('Prepared assignment scout');
      const head = await f.runtime.firestore.collection('campaigns').doc(campaign.id).get();
      const sourcePath = head.data().charactersRef.path;
      const originalFile = f.runtime.bucket.file;
      let release;
      let entered;
      let hold = true;
      const gate = new Promise((resolve) => {
        release = resolve;
      });
      const started = new Promise((resolve) => {
        entered = resolve;
      });
      f.runtime.bucket.file = function (...args) {
        const file = originalFile.apply(this, args);
        if (args[0] === sourcePath) {
          const download = file.download.bind(file);
          file.download = async (...values) => {
            if (hold) {
              hold = false;
              entered();
              await gate;
            }
            return download(...values);
          };
        }
        return file;
      };
      const outcome = f.store
        .assignCharacter(owner.principal, campaign.id, {
          commandId: randomUUID(),
          seatId,
          characterId,
          assigned: true,
          accessGeneration: 0,
        })
        .then(
          (value) => ({ value }),
          (error) => ({ error })
        );
      try {
        await started;
        if (scenario === 'canonical snapshot') await library.create('Newer canonical character');
        else
          await f.store.removeMember(owner.principal, campaign.id, {
            commandId: randomUUID(),
            seatId,
            accessGeneration: 0,
          });
        release();
        const result = await outcome;
        assert.equal(
          result.error?.code,
          scenario === 'canonical snapshot' ? 'revision-conflict' : 'campaign-access-changed'
        );
        if (scenario === 'canonical snapshot') {
          const current = await f.store.getParticipantAccess(member.principal, campaign.id);
          assert.equal(current.access.accessGeneration, 0);
          assert.deepEqual(current.characterIds, []);
        } else {
          await assert.rejects(f.store.getParticipantAccess(member.principal, campaign.id), {
            code: 'campaign-not-found',
          });
          const seat = (await f.store.listSeats(owner.principal, campaign.id)).find(
            (entry) => entry.id === seatId
          );
          assert.deepEqual(seat.characterIds, []);
        }
      } finally {
        release();
        f.runtime.bucket.file = originalFile;
        await outcome;
      }
    }
  );

test(
  'malformed versioned seat and membership records cannot fall back to legacy generation zero',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Invalid access generation fixture');
    const prepared = invitation('Versioned member');
    const issued = await f.store.createInvitation(owner.principal, campaign.id, prepared.command);
    await f.store.redeemInvitation(member.principal, {
      commandId: randomUUID(),
      invitationId: issued.id,
      secret: prepared.secret,
    });
    const seatReference = f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('seats')
      .doc(issued.seatId);
    const membershipReference = f.runtime.firestore
      .collection('campaignMemberships')
      .doc(pilotAccountKey(member.uid))
      .collection('campaigns')
      .doc(campaign.id);
    const seat = (await seatReference.get()).data();
    const membership = (await membershipReference.get()).data();
    const seatWithoutGeneration = { ...seat };
    delete seatWithoutGeneration.accessGeneration;
    const membershipWithoutGeneration = { ...membership };
    delete membershipWithoutGeneration.accessGeneration;
    try {
      for (const [reference, malformed] of [
        [seatReference, seatWithoutGeneration],
        [membershipReference, membershipWithoutGeneration],
        [seatReference, { ...seat, accessGeneration: 0 }],
        [membershipReference, { ...membership, accessGeneration: 2 }],
        [seatReference, { ...seatWithoutGeneration, version: 1 }],
      ]) {
        await reference.set(malformed);
        await assert.rejects(f.store.getParticipantAccess(member.principal, campaign.id), {
          code: 'invalid-campaign-membership',
        });
        await seatReference.set(seat);
        await membershipReference.set(membership);
      }
      const restored = await f.store.getParticipantAccess(member.principal, campaign.id);
      assert.equal(restored.access.accessGeneration, 1);
    } finally {
      await seatReference.set(seat);
      await membershipReference.set(membership);
    }
  }
);

test(
  'real owner clients recover lost assignment and removal replies from durable receipts without applying them twice',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Owner access receipt recovery fixture');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const normal = f.client(owner, api);
    const library = await CampaignCharacters.open({
      store: normal,
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
    });
    const characterId = await library.create('Recovered assignment scout');
    const before = await normal.readCharacters(campaign.id);
    const losses = new Set(['/assignments', '/members/remove']);
    const requests = [];
    const client = f.client(owner, api, async (url, options) => {
      const suffix = [...losses].find((value) => url.endsWith(value));
      if (options.method === 'POST') requests.push({ url, body: options.body });
      const response = await fetch(url, options);
      if (suffix && response.status === 200) {
        losses.delete(suffix);
        await response.clone().json();
        throw new TypeError('Synthetic lost committed owner access reply');
      }
      return response;
    });
    for (const operation of ['assign', 'remove']) {
      let stop = () => {};
      const uncertain = new Promise((resolve) => {
        stop = client.subscribeSave((state) => {
          if (state.phase === 'uncertain') resolve(state);
        });
      });
      const pending =
        operation === 'assign'
          ? client.assignCharacter(campaign.id, {
              seatId,
              characterId,
              assigned: true,
              accessGeneration: 0,
            })
          : client.removeMember(campaign.id, { seatId, accessGeneration: 1 });
      try {
        const state = await uncertain;
        const firstRequest = requests.at(-1);
        const command = JSON.parse(firstRequest.body);
        assert.equal(command.commandId, state.commandId);
        if (operation === 'assign') {
          const current = await f.store.getParticipantAccess(member.principal, campaign.id);
          assert.deepEqual(current.characterIds, [characterId]);
          assert.equal(current.access.accessGeneration, 1);
        } else {
          await assert.rejects(f.store.getParticipantAccess(member.principal, campaign.id), {
            code: 'campaign-not-found',
          });
        }
        const replay =
          operation === 'assign'
            ? await f.createStore().assignCharacter(owner.principal, campaign.id, command)
            : await f.createStore().removeMember(owner.principal, campaign.id, command);
        await client.retryPending();
        assert.deepEqual(await pending, replay);
        const attempts = requests.filter((request) => request.url === firstRequest.url);
        assert.equal(attempts.length, 2);
        assert.ok(attempts.every((request) => request.body === firstRequest.body));
      } finally {
        stop();
      }
    }
    const seat = (await f.store.listSeats(owner.principal, campaign.id)).find(
      (value) => value.id === seatId
    );
    assert.equal(seat.accessGeneration, 2);
    assert.equal(seat.joined, false);
    assert.deepEqual(seat.characterIds, [characterId]);
    assert.deepEqual(await normal.readCharacters(campaign.id), before);
  }
);

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
        version: 2,
        id: issued.seatId,
        accessGeneration: 0,
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
    assert.deepEqual(accepted, [
      {
        ...seats[0],
        accessGeneration: 1,
        joined: true,
        invitation: null,
      },
    ]);
    assert.equal(JSON.stringify(accepted).includes(player.uid), false);
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
