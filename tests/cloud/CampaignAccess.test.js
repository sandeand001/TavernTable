const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { Timestamp } = require('firebase-admin/firestore');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { CloudError } = require('../../tools/cloud/cloud-error.js');
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
const { default: CloudEventStream } = require('../../src/campaigns/CloudEventStream.js');
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
const { participantDelta } = require('../../tools/cloud/participant-state.js');
const { applyCloudParticipantDelta } = require('../../src/campaigns/CloudParticipantProtocol.js');
const {
  createStructure,
  structureVolumes,
} = require('../../src/terrain/ConstructionBlueprints.js');

async function fixture(t, { now, withAssets = false, cleanup = false } = {}) {
  const runtime = await createEmulatorRuntime();
  const campaigns = [];
  const uids = [];
  t.after(async () => {
    const errors = [];
    if (cleanup) {
      for (const id of campaigns) {
        try {
          assert.match(id, /^[a-f0-9-]{36}$/);
          const [files] = await runtime.bucket.getFiles({ prefix: `campaigns/${id}/` });
          await Promise.all(files.map((file) => file.delete()));
          await runtime.firestore.recursiveDelete(
            runtime.firestore.collection('campaigns').doc(id)
          );
          assert.equal(
            (await runtime.bucket.getFiles({ prefix: `campaigns/${id}/` }))[0].length,
            0
          );
          assert.equal(
            (await runtime.firestore.collection('campaigns').doc(id).get()).exists,
            false
          );
        } catch (error) {
          errors.push(error);
        }
      }
      for (const uid of uids) {
        try {
          for (const name of [
            'pilotAccounts',
            'accountCommands',
            'campaignMemberships',
            'accountUsage',
            'accountStreams',
            'accountImports',
            'accountRequests',
            'accountObjectMaintenance',
          ]) {
            await runtime.firestore.recursiveDelete(
              runtime.firestore.collection(name).doc(pilotAccountKey(uid))
            );
            assert.equal(
              (await runtime.firestore.collection(name).doc(pilotAccountKey(uid)).get()).exists,
              false
            );
          }
        } catch (error) {
          errors.push(error);
        }
      }
    }
    try {
      await runtime.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'Owned campaign fixtures did not close');
  });
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
    if (cleanup) uids.push(identity.uid);
    t.after(() => identity.close());
    if (eligible)
      await runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(identity.uid))
        .set({ version: 1, uid: identity.uid, enabled: true });
    const principal = await access.verifyIdentity(`Bearer ${identity.token}`);
    return { ...identity, principal };
  };
  const create = async (principal, name) => {
    const campaign = await store.create(principal, {
      commandId: randomUUID(),
      options: { name, ruleset: '2014' },
    });
    if (cleanup) campaigns.push(campaign.id);
    return campaign;
  };
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
  'current participant access uses at most two metadata round trips without trusting stale seat hints or cached membership',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Current member read budget');
    await f.join(campaign.id, member.uid);
    const initial = await f.store.getParticipantAccess(member.principal, campaign.id);
    const expected = {
      seatId: initial.access.seatId,
      accessGeneration: initial.access.accessGeneration,
    };
    const transact = f.runtime.firestore.runTransaction.bind(f.runtime.firestore);
    let roundTrips = 0;
    t.mock.method(f.runtime.firestore, 'runTransaction', (operation, options) =>
      transact(async (transaction) => {
        for (const method of ['get', 'getAll']) {
          const read = transaction[method].bind(transaction);
          transaction[method] = (...args) => {
            roundTrips++;
            return read(...args);
          };
        }
        return operation(transaction);
      }, options)
    );
    assert.deepEqual(
      await f.createStore().getParticipantAccess(member.principal, campaign.id, expected),
      initial
    );
    assert.ok(roundTrips <= 2, `Fresh member authority used ${roundTrips} metadata round trips`);
    await assert.rejects(
      f.createStore().getParticipantAccess(member.principal, campaign.id, {
        ...expected,
        seatId: randomUUID(),
      }),
      (error) => error.code === 'campaign-access-changed'
    );
    await f.runtime.firestore
      .collection('campaignMemberships')
      .doc(pilotAccountKey(member.uid))
      .collection('campaigns')
      .doc(campaign.id)
      .delete();
    await assert.rejects(
      f.createStore().getParticipantAccess(member.principal, campaign.id, expected),
      (error) => error.status === 404
    );
    await assert.rejects(
      f.createStore().getParticipantAccess(owner.principal, campaign.id, expected),
      (error) => error.code === 'campaign-access-changed'
    );
  }
);

test(
  'authenticated presence routes acknowledge the current channel and explicitly close its server resources',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now, cleanup: true });
    const owner = await f.account();
    const unrelated = await f.account();
    const campaign = await f.create(owner.principal, 'Explicit live transport control');
    const paused = await f.store.getLiveSession(owner.principal, campaign.id);
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId: paused.sessionId,
    });
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const controller = new AbortController();
    const headers = {
      Authorization: 'Bearer ' + owner.token,
      'Content-Type': 'application/json',
      Origin: api.origin,
      'X-TavernTable-Seat': 'owner',
      'X-TavernTable-Access-Generation': '0',
    };
    try {
      const response = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}/events`, {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          sessionId: active.sessionId,
          observerTokenId: null,
          mapId: null,
          assetKey: null,
        }),
      });
      assert.equal(response.status, 200);
      const connectionId = response.headers.get('X-TavernTable-Live-Connection');
      assert.match(connectionId, /^[a-f0-9-]{36}$/);
      assert.ok(
        response.headers
          .get('Access-Control-Expose-Headers')
          .includes('X-TavernTable-Live-Connection')
      );
      const command = JSON.stringify({ sessionId: active.sessionId, connectionId });
      const resource = `${api.url}/api/cloud/campaigns/${campaign.id}/live/presence/`;
      const wrongScope = await fetch(resource + 'close', {
        method: 'POST',
        headers: { ...headers, 'X-TavernTable-Access-Generation': '1' },
        body: command,
      });
      assert.equal(wrongScope.status, 409);
      assert.equal((await wrongScope.json()).code, 'campaign-access-changed');
      const denied = await fetch(resource + 'ack', {
        method: 'POST',
        headers: { ...headers, Authorization: 'Bearer ' + unrelated.token },
        body: command,
      });
      assert.equal(denied.status, 404);
      now += 75000;
      const acknowledged = await fetch(resource + 'ack', {
        method: 'POST',
        headers,
        body: command,
      });
      assert.equal(acknowledged.status, 200);
      assert.deepEqual((await acknowledged.json()).result, {
        version: 1,
        connectionId,
        expiresAt: now + 90000,
      });
      const closed = await fetch(resource + 'close', { method: 'POST', headers, body: command });
      assert.equal(closed.status, 200);
      assert.deepEqual((await closed.json()).result, {
        version: 1,
        connectionId,
        closed: true,
        transportClosed: true,
      });
      assert.ok((await response.text()).includes('"code":"stream-closed"'));
      const lease = await f.runtime.firestore
        .collection('accountStreams')
        .doc(pilotAccountKey(owner.uid))
        .get();
      assert.deepEqual(lease.data().leases, []);
      assert.equal(
        (await f.store.getLiveStatus(owner.principal, campaign.id)).activity.disconnectedAt,
        new Date(now).toISOString()
      );
      const stale = await fetch(resource + 'ack', { method: 'POST', headers, body: command });
      assert.equal(stale.status, 409);
      assert.equal((await stale.json()).code, 'client-presence-expired');
      const repeated = await fetch(resource + 'close', { method: 'POST', headers, body: command });
      assert.deepEqual((await repeated.json()).result, {
        version: 1,
        connectionId,
        closed: false,
        transportClosed: false,
      });
    } finally {
      controller.abort();
    }
  }
);

test(
  'an authenticated Fetch SSE connection delivers scoped changes and releases its resources on pause, epoch change and membership removal',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Direct authenticated SSE');
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
    const hero = await library.create('Streaming observer');
    const validation = { ruleset: '2014', library };
    const raw = sceneState({ characterId: hero, name: 'Streaming observer' });
    raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
    const scene = CampaignWorld.fromScene(raw, validation).save();
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
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    const events = await memberClient.openEvents(
      campaign.id,
      {
        sessionId: live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      },
      grant.access
    );
    t.after(() => events.close());
    const next = async () => {
      const step = await events.next();
      return step.done ? null : step.value;
    };
    const initial = await next();
    assert.equal(initial.kind, 'checkpoint');
    assert.deepEqual(initial.checkpoint.access, grant.access);
    assert.equal(initial.checkpoint.state.scene, null);
    const usage = f.runtime.firestore.collection('accountStreams').doc(pilotAccountKey(member.uid));
    assert.equal((await usage.get()).data().leases.length, 1);
    const presence = await f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('livePresence')
      .get();
    assert.equal(
      presence.docs.reduce((sum, row) => sum + row.data().count, 0),
      1
    );
    const moved = structuredClone(scene);
    moved.creatures[0].gridY = 2;
    moved.creatures[0].pose.world.z = 2.5;
    await ownerClient.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 1,
      charactersRevision: library.revision,
      scene: encodeScene(moved, validation),
    });
    assert.equal((await next()).kind, 'delta');
    await ownerClient.controlLiveSession(
      campaign.id,
      'end',
      await ownerClient.getLiveSession(campaign.id)
    );
    const ended = await next();
    assert.equal(ended.kind, 'closed');
    assert.equal(ended.code, 'live-session-paused');
    assert.equal(await next(), null);
    assert.equal((await usage.get()).data().leases.length, 0);
    const closedPresence = await f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('livePresence')
      .get();
    assert.equal(
      closedPresence.docs.reduce((sum, row) => sum + row.data().count, 0),
      0
    );
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const restarted = await ownerClient.getLiveSession(campaign.id);
    await assert.rejects(
      memberClient.openEvents(
        campaign.id,
        {
          sessionId: live.sessionId,
          observerTokenId: 'token-1',
          mapId: 'map-main',
          assetKey: null,
        },
        grant.access
      ),
      { code: 'live-session-changed' }
    );
    const removed = await memberClient.openEvents(
      campaign.id,
      {
        sessionId: restarted.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      },
      grant.access
    );
    t.after(() => removed.close());
    assert.equal((await removed.next()).value.kind, 'checkpoint');
    await ownerClient.removeMember(campaign.id, {
      seatId,
      accessGeneration: grant.access.accessGeneration,
    });
    assert.deepEqual((await removed.next()).value, { kind: 'closed', code: 'campaign-not-found' });
    assert.equal((await removed.next()).done, true);
    assert.equal((await usage.get()).data().leases.length, 0);
    assert.equal(f.store.participantChanges.groups.size, 0);
    await ownerClient.controlLiveSession(
      campaign.id,
      'end',
      await ownerClient.getLiveSession(campaign.id)
    );
  }
);

test(
  'real owner streams enforce four UID-global leases across campaigns and recover a slot after client transport abort',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const campaigns = await Promise.all([
      f.create(owner.principal, 'Stream quota one'),
      f.create(owner.principal, 'Stream quota two'),
    ]);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const client = f.client(owner, api);
    const views = [];
    for (const campaign of campaigns) {
      await client.controlLiveSession(
        campaign.id,
        'start',
        await client.getLiveSession(campaign.id)
      );
      views.push({
        campaign,
        access: (await client.getParticipantAccess(campaign.id)).access,
        view: {
          sessionId: (await client.getLiveSession(campaign.id)).sessionId,
          observerTokenId: null,
          mapId: null,
          assetKey: null,
        },
      });
    }
    const streams = [];
    t.after(() => Promise.all(streams.map((stream) => stream.close())));
    const open = async ({ campaign, view, access }) => {
      const stream = await client.openEvents(campaign.id, view, access);
      streams.push(stream);
      assert.equal((await stream.next()).value.kind, 'owner-head');
      return stream;
    };
    for (let index = 0; index < 4; index++) await open(views[index % 2]);
    const usage = f.runtime.firestore.collection('accountStreams').doc(pilotAccountKey(owner.uid));
    assert.equal((await usage.get()).data().leases.length, 4);
    assert.equal(f.store.participantChanges.groups.size, 2);
    await assert.rejects(open(views[0]), { status: 429, code: 'stream-limit-reached' });
    assert.equal((await usage.get()).data().leases.length, 4);
    const released = Promise.withResolvers();
    const release = f.store.usage.releaseStream.bind(f.store.usage);
    f.store.usage.releaseStream = async (...args) => {
      const result = await release(...args);
      released.resolve();
      return result;
    };
    await streams.shift().close();
    await released.promise;
    assert.equal((await usage.get()).data().leases.length, 3);
    await open(views[0]);
    assert.equal((await usage.get()).data().leases.length, 4);
    for (const { campaign } of views)
      await client.controlLiveSession(campaign.id, 'end', await client.getLiveSession(campaign.id));
    for (const stream of streams) {
      assert.deepEqual((await stream.next()).value, {
        kind: 'closed',
        code: 'live-session-paused',
      });
      assert.equal((await stream.next()).done, true);
    }
    assert.equal((await usage.get()).data().leases.length, 0);
    assert.equal(f.store.participantChanges.groups.size, 0);
    for (const { campaign } of views) {
      const presence = await f.runtime.firestore
        .collection('campaigns')
        .doc(campaign.id)
        .collection('livePresence')
        .get();
      assert.equal(
        presence.docs.reduce((sum, row) => sum + row.data().count, 0),
        0
      );
    }
  }
);

test(
  'real event admission rejects anonymous, expired, revoked, foreign and stale access without a stream lease or cookie fallback',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const unrelated = await f.account();
    const campaign = await f.create(owner.principal, 'Denied event admissions');
    const foreign = await f.create(unrelated.principal, 'Other private campaign');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const memberClient = f.client(member, api);
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    const grant = await memberClient.getParticipantAccess(campaign.id);
    const body = { sessionId: live.sessionId, observerTokenId: null, mapId: null, assetKey: null };
    const headers = {
      Authorization: 'Bearer ' + member.token,
      Origin: api.origin,
      'Content-Type': 'application/json',
      'X-TavernTable-Seat': seatId,
      'X-TavernTable-Access-Generation': String(grant.access.accessGeneration),
    };
    const endpoint = `${api.url}/api/cloud/campaigns/${campaign.id}/events`;
    const parts = member.token.split('.');
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    const changedToken = (changes) =>
      [
        parts[0],
        Buffer.from(JSON.stringify({ ...claims, ...changes })).toString('base64url'),
        parts[2],
      ].join('.');
    const cases = [
      [
        'anonymous cookie',
        401,
        'authentication-required',
        {
          headers: { Authorization: '', Cookie: 'taverntable-host=not-cloud-authority' },
        },
      ],
      [
        'malformed token',
        401,
        'invalid-identity',
        { headers: { Authorization: 'Bearer not-a-token' } },
      ],
      [
        'expired token',
        401,
        'invalid-identity',
        { headers: { Authorization: 'Bearer ' + changedToken({ exp: 1 }) } },
      ],
      [
        'wrong project',
        401,
        'invalid-identity',
        { headers: { Authorization: 'Bearer ' + changedToken({ aud: 'different-demo-project' }) } },
      ],
      [
        'wrong UID',
        404,
        'campaign-not-found',
        { headers: { Authorization: 'Bearer ' + unrelated.token } },
      ],
      [
        'foreign campaign',
        404,
        'campaign-not-found',
        {
          url: `${api.url}/api/cloud/campaigns/${foreign.id}/events`,
        },
      ],
      [
        'stale seat',
        409,
        'campaign-access-changed',
        { headers: { 'X-TavernTable-Seat': randomUUID() } },
      ],
      [
        'stale generation',
        409,
        'campaign-access-changed',
        {
          headers: { 'X-TavernTable-Access-Generation': String(grant.access.accessGeneration + 1) },
        },
      ],
      ['stale epoch', 409, 'live-session-changed', { body: { ...body, sessionId: randomUUID() } }],
      [
        'owner as player',
        409,
        'campaign-access-changed',
        { headers: { Authorization: 'Bearer ' + owner.token } },
      ],
      [
        'player as owner',
        409,
        'campaign-access-changed',
        {
          headers: { 'X-TavernTable-Seat': 'owner', 'X-TavernTable-Access-Generation': '0' },
        },
      ],
      ['missing scope', 400, 'invalid-participant-request', { omitScope: true }],
      [
        'foreign origin',
        403,
        'origin-not-allowed',
        { headers: { Origin: 'https://foreign.example.invalid' } },
      ],
      [
        'query credentials',
        400,
        'invalid-campaign-request',
        { url: endpoint + '?token=FORBIDDEN' },
      ],
      [
        'malformed view',
        400,
        'invalid-participant-request',
        { body: { ...body, privateScene: 'NOT AUTHORIZED' } },
      ],
      ['native GET', 405, 'method-not-allowed', { method: 'GET' }],
    ];
    for (const [label, status, code, options] of cases) {
      const requestHeaders = { ...headers, ...options.headers };
      if (options.omitScope) {
        delete requestHeaders['X-TavernTable-Seat'];
        delete requestHeaders['X-TavernTable-Access-Generation'];
      }
      const result = await fetch(options.url || endpoint, {
        method: options.method || 'POST',
        headers: requestHeaders,
        ...(options.method === 'GET' ? {} : { body: JSON.stringify(options.body || body) }),
      });
      assert.equal(result.status, status, label);
      const denied = await result.json();
      assert.equal(denied.code, code, label);
      assert.ok(!Object.hasOwn(denied, 'result'), label);
      assert.ok(!JSON.stringify(denied).includes(member.token), label);
    }
    const preflight = await fetch(endpoint, {
      method: 'OPTIONS',
      headers: {
        Origin: api.origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers':
          'authorization,content-type,x-taverntable-seat,x-taverntable-access-generation',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), api.origin);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
    assert.equal(preflight.headers.get('access-control-allow-credentials'), null);
    assert.match(
      preflight.headers.get('access-control-allow-headers'),
      /X-TavernTable-Access-Generation/
    );
    await ownerClient.controlLiveSession(
      campaign.id,
      'end',
      await ownerClient.getLiveSession(campaign.id)
    );
    const paused = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(paused.status, 409);
    assert.equal((await paused.json()).code, 'live-session-paused');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await f.runtime.auth.revokeRefreshTokens(member.uid);
    const revoked = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    assert.equal(revoked.status, 401);
    assert.equal((await revoked.json()).code, 'invalid-identity');
    await f.runtime.auth.updateUser(unrelated.uid, { disabled: true });
    const disabled = await fetch(endpoint, {
      method: 'POST',
      headers: { ...headers, Authorization: 'Bearer ' + unrelated.token },
      body: JSON.stringify(body),
    });
    assert.equal(disabled.status, 401);
    assert.equal((await disabled.json()).code, 'invalid-identity');
    const streams = await f.runtime.firestore
      .collection('accountStreams')
      .doc(pilotAccountKey(member.uid))
      .get();
    assert.equal(streams.exists, false);
    assert.equal(f.store.participantChanges?.groups.size || 0, 0);
  }
);

test(
  'an owner opens a real authenticated stream without a player seat and receives only bounded head notifications',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Owner event transport');
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const client = f.client(owner, api);
    const grant = await client.getParticipantAccess(campaign.id);
    await client.controlLiveSession(campaign.id, 'start', await client.getLiveSession(campaign.id));
    const live = await client.getLiveSession(campaign.id);
    const controller = new AbortController();
    t.after(() => controller.abort());
    const response = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}/events`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: 'Bearer ' + owner.token,
        Origin: api.origin,
        'Content-Type': 'application/json',
        'X-TavernTable-Seat': 'owner',
        'X-TavernTable-Access-Generation': '0',
      },
      body: JSON.stringify({
        sessionId: live.sessionId,
        observerTokenId: null,
        mapId: null,
        assetKey: null,
      }),
    });
    assert.equal(response.status, 200);
    const events = new CloudEventStream({
      response,
      controller,
      account: new CloudAccount({ auth: owner.auth, sdk }),
      credential: { uid: owner.uid, isCurrent: () => owner.auth.currentUser?.uid === owner.uid },
    });
    t.after(() => events.close());
    const initial = (await events.next()).value;
    assert.deepEqual(initial, {
      kind: 'owner-head',
      version: 1,
      access: grant.access,
      sessionId: live.sessionId,
      head: { generation: 1, charactersRevision: 0, sceneRevision: 0, sceneSavedAt: null },
    });
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
      store: client,
    });
    await library.create('PRIVATE OWNER CHARACTER');
    const changed = (await events.next()).value;
    assert.equal(changed.kind, 'owner-head');
    assert.equal(changed.head.generation, 2);
    assert.equal(changed.head.charactersRevision, 1);
    assert.ok(!JSON.stringify(changed).includes('PRIVATE OWNER CHARACTER'));
    assert.ok(!JSON.stringify(changed).includes('charactersRef'));
    assert.equal(f.store.participantChanges.groups.size, 1);
    await client.controlLiveSession(campaign.id, 'end', await client.getLiveSession(campaign.id));
    assert.deepEqual((await events.next()).value, { kind: 'closed', code: 'live-session-paused' });
    assert.equal((await events.next()).done, true);
    assert.equal(f.store.participantChanges.groups.size, 0);
    const usage = await f.runtime.firestore
      .collection('accountStreams')
      .doc(pilotAccountKey(owner.uid))
      .get();
    assert.equal(usage.data().leases.length, 0);
  }
);

test(
  'private committed change history is ordered across backend instances and cannot become a member data endpoint',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Ordered committed changes');
    await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const client = f.client(owner, api);
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
      store: client,
    });
    const hero = await library.create('Journal actor');
    await library.edit(hero, { notes: 'PRIVATE CANONICAL JOURNAL CONTENT' });
    const changes = await f.store.readCommittedChanges(owner.principal, campaign.id, {
      afterGeneration: 0,
    });
    assert.equal(changes.resync, null);
    assert.deepEqual(
      changes.changes.map((entry) => entry.generation),
      [1, 2, 3]
    );
    assert.deepEqual(
      changes.changes.map((entry) => entry.kind),
      ['campaign.create', 'characters.commit', 'characters.commit']
    );
    assert.equal(changes.headGeneration, 3);
    assert.ok(changes.changes.every((entry) => Number.isFinite(Date.parse(entry.committedAt))));
    assert.ok(!JSON.stringify(changes).includes('PRIVATE CANONICAL JOURNAL CONTENT'));
    assert.ok(!JSON.stringify(changes).includes('charactersRef'));
    const replacement = f.createStore();
    const recovered = await replacement.readCommittedChanges(owner.principal, campaign.id, {
      afterGeneration: 1,
    });
    assert.deepEqual(recovered.changes, changes.changes.slice(1));
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    await head.collection('changes').doc('2').delete();
    await assert.rejects(
      replacement.readCommittedChanges(owner.principal, campaign.id, {
        afterGeneration: 1,
      }),
      { code: 'invalid-change-history' }
    );
    const canonical = await f.store.readCharacters(owner.principal, campaign.id);
    assert.ok(JSON.stringify(canonical.records).includes('PRIVATE CANONICAL JOURNAL CONTENT'));
    await head.collection('changeHistory').doc('current').set({
      version: 1,
      campaignId: campaign.id,
      prunedThrough: 99,
      lastPrunedAt: Timestamp.now(),
    });
    await assert.rejects(
      replacement.readCommittedChanges(owner.principal, campaign.id, {
        afterGeneration: 3,
      }),
      { code: 'invalid-change-history' }
    );
    await assert.rejects(
      replacement.readCommittedChanges(member.principal, campaign.id, {
        afterGeneration: 0,
      }),
      { code: 'campaign-not-found' }
    );
  }
);

test(
  'fresh retained change history probes only its oldest entry without reading the whole retirement batch',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now, cleanup: true });
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Recent history read budget');
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const journal = head.collection('changes');
    const initial = (await journal.doc('1').get()).data().committedAt.toMillis();
    now = initial + 2000;
    const batch = f.runtime.firestore.batch();
    for (let generation = 2; generation <= 12; generation++)
      batch.create(journal.doc(String(generation)), {
        version: 1,
        generation,
        kind: 'campaign.settings',
        sceneRevision: 0,
        charactersRevision: 0,
        committedAt: Timestamp.fromMillis(initial + generation),
      });
    await batch.commit();
    await head.update({ generation: 12 });
    const before = (await head.get()).data();
    const transact = f.runtime.firestore.runTransaction.bind(f.runtime.firestore);
    let journalRowsRead = 0;
    t.mock.method(f.runtime.firestore, 'runTransaction', (operation, options) =>
      transact(async (transaction) => {
        const get = transaction.get.bind(transaction);
        transaction.get = async (...args) => {
          const result = await get(...args);
          if (
            Array.isArray(result.docs) &&
            result.docs.length &&
            result.docs.every((row) => row.ref.parent.path === journal.path)
          )
            journalRowsRead += result.size;
          return result;
        };
        return operation(transaction);
      }, options)
    );
    const retired = await f.store.runChangeMaintenance(owner.principal, campaign.id);
    assert.equal(retired.removed, 0);
    assert.equal(
      journalRowsRead,
      1,
      'No eligible retirement must cost one journal document, not a full batch'
    );
    assert.equal((await journal.get()).size, 12);
    assert.deepEqual((await head.get()).data(), before);
  }
);

test(
  'committed change history enforces the exact 1000-change and 24-hour boundaries and retires only expired metadata',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Bounded change history');
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const journal = head.collection('changes');
    const initial = (await journal.doc('1').get()).data().committedAt.toMillis();
    now = initial + 2000;
    for (let first = 2; first <= 1001; first += 500) {
      const batch = f.runtime.firestore.batch();
      for (let generation = first; generation < Math.min(first + 500, 1002); generation++)
        batch.create(journal.doc(String(generation)), {
          version: 1,
          generation,
          kind: 'campaign.settings',
          sceneRevision: 0,
          charactersRevision: 0,
          committedAt: Timestamp.fromMillis(initial + generation),
        });
      await batch.commit();
    }
    await head.update({ generation: 1001 });
    const primary = (await head.get()).data();
    const retained = await f.store.readCommittedChanges(owner.principal, campaign.id, {
      afterGeneration: 1,
    });
    assert.equal(retained.resync, null);
    assert.equal(retained.changes.length, 1000);
    assert.equal(retained.changes[0].generation, 2);
    assert.equal(retained.changes.at(-1).generation, 1001);
    assert.equal(
      (
        await f.store.readCommittedChanges(owner.principal, campaign.id, {
          afterGeneration: 0,
        })
      ).resync,
      'history-pruned'
    );
    const cutoff = now - 24 * 60 * 60 * 1000;
    await journal.doc('1').update({ committedAt: Timestamp.fromMillis(cutoff - 1) });
    await journal.doc('2').update({ committedAt: Timestamp.fromMillis(cutoff + 1) });
    assert.equal(
      (
        await f.store.readCommittedChanges(owner.principal, campaign.id, {
          afterGeneration: 1,
        })
      ).changes.length,
      1000
    );
    await journal.doc('2').update({ committedAt: Timestamp.fromMillis(cutoff) });
    assert.equal(
      (
        await f.store.readCommittedChanges(owner.principal, campaign.id, {
          afterGeneration: 1,
        })
      ).resync,
      'history-expired'
    );
    const retired = await f.store.runChangeMaintenance(owner.principal, campaign.id);
    assert.equal(retired.removed, 2);
    assert.equal((await journal.doc('1').get()).exists, false);
    assert.equal((await journal.doc('2').get()).exists, false);
    assert.equal((await journal.doc('3').get()).exists, true);
    assert.deepEqual((await head.get()).data(), primary);
    assert.equal((await journal.get()).size, 999);
    const oldCursor = await f.store.readCommittedChanges(owner.principal, campaign.id, {
      afterGeneration: 1,
    });
    assert.notEqual(oldCursor.resync, null);
    assert.deepEqual(oldCursor.changes, []);
    assert.equal(
      (
        await f.store.readCommittedChanges(owner.principal, campaign.id, {
          afterGeneration: 2,
        })
      ).changes.length,
      999
    );
    const aged = f.runtime.firestore.batch();
    for (let generation = 3; generation <= 202; generation++)
      aged.update(journal.doc(String(generation)), {
        committedAt: Timestamp.fromMillis(cutoff - 202 + generation),
      });
    await aged.commit();
    assert.equal((await f.store.runChangeMaintenance(owner.principal, campaign.id)).removed, 100);
    assert.equal((await journal.doc('102').get()).exists, false);
    assert.equal((await journal.doc('103').get()).exists, true);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    await f.client(owner, api).get(campaign.id);
    assert.equal((await journal.doc('202').get()).exists, false);
    assert.equal((await journal.doc('203').get()).exists, true);
    assert.equal((await journal.get()).size, 799);
    assert.deepEqual((await head.get()).data(), primary);
  }
);

test(
  'an invalid retention clock cannot retire recent committed history or produce a success-shaped history response',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now });
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Invalid journal clock');
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const before = (await head.get()).data();
    now = NaN;
    await assert.rejects(f.store.runChangeMaintenance(owner.principal, campaign.id), {
      code: 'change-history-unavailable',
    });
    assert.equal((await head.collection('changes').doc('1').get()).exists, true);
    assert.deepEqual((await head.get()).data(), before);
    await assert.rejects(
      f.store.readCommittedChanges(owner.principal, campaign.id, {
        afterGeneration: 0,
      }),
      { code: 'change-history-unavailable' }
    );
  }
);

test(
  'one active campaign observer shares canonical downloads across participants and stops on scope revocation or owner pause',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const first = await f.account();
    const second = await f.account();
    const campaign = await f.create(owner.principal, 'Shared committed observation');
    const firstSeat = await f.join(campaign.id, first.uid);
    const secondSeat = await f.join(campaign.id, second.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    t.after(() => api.close());
    const ownerClient = f.client(owner, api);
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
      store: ownerClient,
    });
    const hero = await library.create('First observed hero');
    const ally = await library.create('Second observed hero');
    const npc = await library.create('PRIVATE SHARED OBSERVER NPC');
    await library.edit(npc, { notes: 'PRIVATE SHARED FRAME NOTE' });
    const raw = sceneState({ characterId: hero, name: 'First observed hero' });
    raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
    const other = structuredClone(raw.creatures[0]);
    Object.assign(other, {
      id: 'token-2',
      instanceNumber: 2,
      characterId: ally,
      name: 'Second observed hero',
      gridX: 3,
      pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
    });
    raw.creatures.push(other);
    raw.tokenCounters = { nextId: 2, types: [[other.type, 2]] };
    const validation = { ruleset: '2014', library };
    const scene = CampaignWorld.fromScene(raw, validation).save();
    await ownerClient.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: library.revision,
      scene: encodeScene(scene, validation),
    });
    for (const [seatId, characterId] of [
      [firstSeat, hero],
      [secondSeat, ally],
    ])
      await ownerClient.assignCharacter(campaign.id, {
        seatId,
        characterId,
        assigned: true,
        accessGeneration: 0,
      });
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    let downloads = 0;
    let holdFrame = false;
    let entered;
    let release;
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    t.after(() => release());
    const bucket = {
      name: f.runtime.bucket.name,
      file(...args) {
        const file = f.runtime.bucket.file(...args);
        const read = file.download.bind(file);
        file.download = async (...values) => {
          downloads++;
          const bytes = await read(...values);
          if (holdFrame && args[0].includes('/objects/scene/')) {
            holdFrame = false;
            entered();
            await gate;
          }
          return bytes;
        };
        return file;
      },
    };
    const shared = new CloudCampaignStore({
      firestore: f.runtime.firestore,
      access: f.access,
      packs: f.manifest.packs,
      resources: f.resources,
      objects: new ImmutableCloudObjects({ bucket }),
    });
    const events = [[], []];
    const updates = [];
    const failures = [];
    const resets = [];
    const resetPromises = [0, 1].map(
      (index) =>
        new Promise((resolve) => {
          resets[index] = resolve;
        })
    );
    const updatePromises = [0, 1].map(
      (index) =>
        new Promise((resolve) => {
          updates[index] = resolve;
        })
    );
    const failurePromises = [0, 1].map(
      (index) =>
        new Promise((resolve) => {
          failures[index] = resolve;
        })
    );
    const handles = [];
    for (const [index, identity] of [first, second].entries()) {
      const grant = await f.store.getParticipantAccess(identity.principal, campaign.id);
      const handle = shared.observeParticipant(
        identity.principal,
        campaign.id,
        {
          sessionId: live.sessionId,
          observerTokenId: `token-${index + 1}`,
          mapId: 'map-main',
          assetKey: null,
        },
        { seatId: grant.access.seatId, accessGeneration: grant.access.accessGeneration },
        {
          onEvent(event) {
            events[index].push(event);
            if (events[index].length === 2) updates[index](event);
            if (events[index].length === 3) resets[index](event);
          },
          onError(error) {
            failures[index](error);
          },
        }
      );
      handles.push(handle);
      t.after(() => handle.close());
    }
    await Promise.all(handles.map((handle) => handle.ready));
    assert.equal(downloads, 2);
    assert.ok(events[0][0].checkpoint.state.records.every((row) => row.key.endsWith(hero)));
    assert.ok(events[1][0].checkpoint.state.records.every((row) => row.key.endsWith(ally)));
    assert.ok(!JSON.stringify(events).includes('PRIVATE SHARED FRAME NOTE'));
    let warmEvent;
    let warmFailure;
    const warm = shared.observeParticipant(
      first.principal,
      campaign.id,
      {
        sessionId: live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: events[0][0].checkpoint.state.publicScene.assetKey,
      },
      { seatId: firstSeat, accessGeneration: 1 },
      {
        onEvent(event) {
          warmEvent = event;
        },
        onError(error) {
          warmFailure = error;
        },
      }
    );
    t.after(() => warm.close());
    await warm.ready;
    assert.equal(warmFailure, undefined);
    assert.equal(warmEvent.checkpoint.state.publicScene.assets, null);
    warm.close();
    assert.equal(downloads, 2);
    let callbackFailure;
    const broken = shared.observeParticipant(
      first.principal,
      campaign.id,
      { sessionId: live.sessionId, observerTokenId: 'token-1', mapId: 'map-main', assetKey: null },
      { seatId: firstSeat, accessGeneration: 1 },
      {
        onEvent() {
          return Promise.reject(new Error('PRIVATE ASYNC LISTENER DETAIL'));
        },
        onError(error) {
          callbackFailure = error;
        },
      }
    );
    t.after(() => broken.close());
    await assert.rejects(broken.ready, { code: 'participant-listener-failed' });
    assert.equal(callbackFailure.code, 'participant-listener-failed');
    assert.equal(downloads, 2);
    const moved = structuredClone(scene);
    moved.creatures[0].gridY = 2;
    moved.creatures[0].pose.world.z = 2.5;
    await ownerClient.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 1,
      charactersRevision: library.revision,
      scene: encodeScene(moved, validation),
    });
    const delivered = await Promise.all(updatePromises);
    assert.ok(delivered.every((event) => event.kind === 'delta'));
    assert.equal(downloads, 4);
    const presence = await f.store.connectLivePresence(first.principal, campaign.id, {
      sessionId: live.sessionId,
    });
    const ping = { sessionId: live.sessionId, connectionId: presence.id };
    for (let count = 0; count < 10; count++)
      await f.store.renewLivePresence(first.principal, campaign.id, ping);
    await f.store.disconnectLivePresence(first.principal, campaign.id, ping);
    assert.equal(downloads, 4);
    holdFrame = true;
    const midway = structuredClone(moved);
    midway.creatures[0].gridY = 3;
    midway.creatures[0].pose.world.z = 3.5;
    await ownerClient.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 2,
      charactersRevision: library.revision,
      scene: encodeScene(midway, validation),
    });
    await started;
    const latest = structuredClone(midway);
    latest.creatures[0].gridY = 4;
    latest.creatures[0].pose.world.z = 4.5;
    await ownerClient.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 3,
      charactersRevision: library.revision,
      scene: encodeScene(latest, validation),
    });
    release();
    const recovered = await Promise.all(resetPromises);
    assert.ok(recovered.every((event) => event.kind === 'resync'));
    assert.ok(
      recovered.every(
        (event) =>
          event.checkpoint.state.publicScene.actors.find((actor) => actor.id === 'token-1')
            .gridY === 4
      )
    );
    assert.ok(recovered.every((event) => event.checkpoint.state.publicScene.updates.length === 0));
    assert.equal(downloads, 8);
    await ownerClient.removeMember(campaign.id, { seatId: firstSeat, accessGeneration: 1 });
    assert.equal((await failurePromises[0]).code, 'campaign-not-found');
    await ownerClient.controlLiveSession(
      campaign.id,
      'end',
      await ownerClient.getLiveSession(campaign.id)
    );
    assert.equal((await failurePromises[1]).code, 'live-session-paused');
    const stopped = downloads;
    await library.edit(npc, { notes: 'PRIVATE AFTER OBSERVERS CLOSED' });
    assert.equal(downloads, stopped);
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const restarted = await ownerClient.getLiveSession(campaign.id);
    let finish;
    let count = 0;
    const outcome = new Promise((resolve) => {
      finish = resolve;
    });
    const regression = shared.observeParticipant(
      second.principal,
      campaign.id,
      {
        sessionId: restarted.sessionId,
        observerTokenId: 'token-2',
        mapId: 'map-main',
        assetKey: null,
      },
      { seatId: secondSeat, accessGeneration: 1 },
      {
        onEvent(event) {
          if (++count === 2) finish({ event });
        },
        onError(error) {
          finish({ error });
        },
      }
    );
    t.after(() => regression.close());
    await regression.ready;
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const currentGeneration = (await head.get()).data().generation;
    await head.update({
      generation: currentGeneration - 1,
      'lastCommand.generation': currentGeneration - 1,
    });
    assert.equal((await outcome).error?.code, 'invalid-change-history');
  }
);

test(
  'a live participant checkpoint contains only authorized rendering and assigned sheets with private image references',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, { withAssets: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Participant projection tracer');
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
    const hero = await library.create('Authorized observer');
    const npc = await library.create('PRIVATE UNPLACED NPC');
    await library.edit(npc, { notes: 'PRIVATE UNASSIGNED SHEET NOTE' });
    const bytes = createCanvas(2, 2).toBuffer('image/png');
    await library.edit(hero, {
      portraitImage: 'data:image/png;base64,' + bytes.toString('base64'),
    });
    const validation = { ruleset: '2014', library };
    const scene = CampaignWorld.fromScene(
      sceneState({ characterId: hero, name: 'Authorized observer' }),
      validation
    ).save();
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
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const before = (await head.get()).data();
    const snapshot = await memberClient.readParticipantSnapshot(
      campaign.id,
      { sessionId: live.sessionId, observerTokenId: 'token-1', mapId: 'map-main', assetKey: null },
      grant.access
    );
    assert.deepEqual(snapshot.access, grant.access);
    assert.equal(snapshot.sessionId, live.sessionId);
    assert.equal(snapshot.generation, before.generation);
    assert.equal(snapshot.state.scene, null);
    assert.equal(snapshot.state.observerTokenId, 'token-1');
    assert.ok(snapshot.state.records.every((row) => row.key.endsWith(hero)));
    assert.deepEqual(
      snapshot.state.publicScene.actors.map((actor) => actor.id),
      ['token-1']
    );
    assert.ok(snapshot.state.publicScene.assets.maps.length > 0);
    assert.ok(
      snapshot.manifest.images.some(
        (image) => image.reference.sha256 === createHash('sha256').update(bytes).digest('hex')
      )
    );
    const encoded = JSON.stringify(snapshot);
    for (const secret of [
      'PRIVATE UNPLACED NPC',
      'PRIVATE UNASSIGNED SHEET NOTE',
      'base64,',
      'ownerUid',
      'charactersRef',
      'sceneRef',
      'terrainKey',
    ])
      assert.ok(!encoded.includes(secret), secret + ' must not be in the participant checkpoint');
    const image = snapshot.manifest.images[0].reference;
    assert.deepEqual(
      Buffer.from(await memberClient.readParticipantAsset(campaign.id, snapshot, image)),
      bytes
    );
    await assert.rejects(
      memberClient.readParticipantAsset(campaign.id, snapshot, {
        ...image,
        generation: String(Number(image.generation) + 1),
      }),
      { code: 'asset-not-found' }
    );
    const request = {
      sessionId: live.sessionId,
      observerTokenId: 'token-1',
      mapId: 'map-main',
      assetKey: null,
    };
    const cachedAssets = snapshot.state.publicScene.assets;
    const warm = await memberClient.readParticipantSnapshot(
      campaign.id,
      { ...request, assetKey: snapshot.state.publicScene.assetKey },
      grant.access,
      { cachedAssets }
    );
    assert.equal(warm.state.publicScene.assets, null);
    assert.equal(warm.viewKey, snapshot.viewKey);
    assert.deepEqual(
      Buffer.from(
        await memberClient.readParticipantAsset(campaign.id, warm, image, { cachedAssets })
      ),
      bytes
    );
    const cleared = await memberClient.readParticipantSnapshot(
      campaign.id,
      {
        ...request,
        observerTokenId: null,
        mapId: null,
        assetKey: snapshot.state.publicScene.assetKey,
      },
      grant.access,
      { cachedAssets }
    );
    assert.equal(cleared.state.publicScene.assetKey, null);
    assert.deepEqual(cleared.state.publicScene.actors, []);
    assert.deepEqual(cleared.state.maps, []);
    assert.notEqual(cleared.viewKey, snapshot.viewKey);
    let response;
    const corrupted = f.client(member, api, async () => ({
      ok: true,
      status: 200,
      json: async () => ({ version: 1, result: response }),
    }));
    const malformed = [
      (value) => {
        value.sceneRef = 'PRIVATE CANONICAL REFERENCE';
      },
      (value) => {
        value.state.profile = { session: 'PRIVATE SESSION' };
      },
      (value) => {
        value.state.campaign.ownerUid = owner.uid;
      },
      (value) => {
        value.access.uid = 'another-uid';
      },
      (value) => {
        value.state.records.push({
          key: `taverntable.character.v1.${npc}`,
          value: JSON.stringify(library.get(npc)),
        });
      },
      (value) => {
        value.manifest.images[0].id = npc;
      },
      (value) => {
        value.state.publicScene.assets.maps[0].terrain.heights[0][0] = 1;
      },
    ];
    for (const mutate of malformed) {
      response = structuredClone(snapshot);
      mutate(response);
      await assert.rejects(corrupted.readParticipantSnapshot(campaign.id, request, grant.access), {
        code: 'invalid-cloud-response',
      });
    }
    assert.equal(corrupted.pending, null);
    corrupted.close();
    assert.deepEqual((await head.get()).data(), before);
    assert.deepEqual(await ownerClient.getLiveSession(campaign.id), live);
  }
);

test(
  'participant checkpoints require current membership, scope and live epoch rather than another campaign ownership or a forged view',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const unrelated = await f.account();
    await f.create(unrelated.principal, 'Unrelated owner is not a global DM');
    const campaign = await f.create(owner.principal, 'Current participant admission');
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
    const hero = await library.create('Admission observer');
    const validation = { ruleset: '2014', library };
    const scene = CampaignWorld.fromScene(
      sceneState({ characterId: hero, name: 'Admission observer' }),
      validation
    ).save();
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
    const request = {
      sessionId: randomUUID(),
      observerTokenId: 'token-1',
      mapId: 'map-main',
      assetKey: null,
    };
    await assert.rejects(memberClient.readParticipantSnapshot(campaign.id, request, grant.access), {
      code: 'live-session-paused',
    });
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    request.sessionId = live.sessionId;
    await assert.rejects(
      f
        .client(unrelated, api)
        .readParticipantSnapshot(campaign.id, request, { ...grant.access, uid: unrelated.uid }),
      { code: 'campaign-not-found' }
    );
    await assert.rejects(
      memberClient.readParticipantSnapshot(campaign.id, request, {
        ...grant.access,
        accessGeneration: 0,
      }),
      { code: 'campaign-access-changed' }
    );
    await assert.rejects(
      memberClient.readParticipantSnapshot(
        campaign.id,
        { ...request, observerTokenId: 'unassigned-token' },
        grant.access
      ),
      { code: 'participant-view-forbidden' }
    );
    await assert.rejects(
      memberClient.readParticipantSnapshot(
        campaign.id,
        { ...request, ownerUid: owner.uid },
        grant.access
      ),
      { code: 'invalid-participant-request' }
    );
    await ownerClient.controlLiveSession(campaign.id, 'end', live);
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    await assert.rejects(memberClient.readParticipantSnapshot(campaign.id, request, grant.access), {
      code: 'live-session-changed',
    });
    assert.equal(memberClient.pending, null);
  }
);

test(
  'participant rendering uses one assigned observer without exposing closed rooms, inactive observer locations or construction notes',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Closed participant rooms');
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
    const ids = [];
    for (const name of ['Outside hero', 'Inside hero', 'PRIVATE ROOM NPC'])
      ids.push(await library.create(name));
    await library.edit(ids[2], { notes: 'PRIVATE ROOM SHEET' });
    const scene = createTwoFloorTravelScene({
      ruleset: '2014',
      characters: ids.map((id) => library.get(id)),
    });
    scene.maps[1].name = 'PRIVATE CLOSED GROUND ROOM';
    scene.maps[2].name = 'PRIVATE CLOSED UPPER ROOM';
    scene.connections[0].open = false;
    const wall = createStructure({
      id: 'public-wall',
      kind: 'wall',
      name: 'PRIVATE AUTHORING NOTES',
      xFeet: 5,
      zFeet: 5,
      heightFeet: 5,
      lengthFeet: 5,
      widthFeet: 1,
    });
    const geometry = scene.maps[0].terrain.geometry;
    geometry.version = 3;
    geometry.structures = [wall];
    geometry.volumes.push(...structureVolumes(wall));
    const distant = structuredClone(scene.maps[1]);
    distant.id = 'unrelated-secret-map';
    distant.name = 'PRIVATE UNRELATED MAP';
    distant.originFeet = { x: 98765.125, y: 0, z: 87654.375 };
    scene.maps.push(distant);
    await ownerClient.commitScene(campaign.id, {
      ruleset: '2014',
      revision: 0,
      charactersRevision: library.revision,
      scene: encodeScene(scene, { ruleset: '2014', library }),
    });
    let generation = 0;
    for (const characterId of ids.slice(0, 2)) {
      const assigned = await ownerClient.assignCharacter(campaign.id, {
        seatId,
        characterId,
        assigned: true,
        accessGeneration: generation,
      });
      generation = assigned.accessGeneration;
    }
    const grant = await memberClient.getParticipantAccess(campaign.id);
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    const snapshot = await f.store.readParticipantSnapshot(
      member.principal,
      campaign.id,
      { sessionId: live.sessionId, observerTokenId: 'token-1', mapId: 'map-main', assetKey: null },
      { seatId, accessGeneration: grant.access.accessGeneration }
    );
    const encoded = JSON.stringify(snapshot);
    for (const hidden of [
      'PRIVATE CLOSED GROUND ROOM',
      'PRIVATE CLOSED UPPER ROOM',
      'PRIVATE ROOM NPC',
      'PRIVATE ROOM SHEET',
      'PRIVATE AUTHORING NOTES',
      'PRIVATE UNRELATED MAP',
      '98765.125',
      '87654.375',
    ])
      assert.ok(
        !encoded.includes(hidden),
        hidden + ' must not be in the active observer checkpoint'
      );
    assert.deepEqual(
      snapshot.state.publicScene.actors.map((actor) => actor.id),
      ['token-1']
    );
    assert.deepEqual(
      snapshot.state.gameplay.ownedTokens.map((actor) => actor.tokenId),
      ['token-1']
    );
    assert.ok(
      snapshot.state.publicScene.assets.maps.every((map) => !map.terrain.geometry.structures)
    );
    assert.ok(snapshot.state.publicScene.assets.maps[0].terrain.geometry.volumes.length > 0);
    assert.equal(snapshot.state.observers.length, 2);
  }
);

test(
  'visible NPC images use the current observer grant without exposing NPC sheets and revocation during download denies delivery',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t, { withAssets: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Visible participant images');
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
    const hero = await library.create('Image observer');
    const npc = await library.create('Visible guide');
    const canvas = createCanvas(2, 2);
    const context = canvas.getContext('2d');
    context.fillStyle = 'red';
    context.fillRect(0, 0, 2, 2);
    const bytes = canvas.toBuffer('image/png');
    await library.edit(npc, {
      portraitImage: 'data:image/png;base64,' + bytes.toString('base64'),
      notes: 'PRIVATE VISIBLE NPC SHEET',
    });
    const raw = sceneState({ characterId: hero, name: 'Image observer' });
    raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
    const other = structuredClone(raw.creatures[0]);
    Object.assign(other, {
      id: 'token-2',
      instanceNumber: 2,
      characterId: npc,
      name: 'Visible guide',
      gridX: 3,
      pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
    });
    raw.creatures.push(other);
    raw.tokenCounters = { nextId: 2, types: [[other.type, 2]] };
    const validation = { ruleset: '2014', library };
    const scene = CampaignWorld.fromScene(raw, validation).save();
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
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    const scope = { seatId, accessGeneration: grant.access.accessGeneration };
    const view = {
      sessionId: live.sessionId,
      observerTokenId: 'token-1',
      mapId: 'map-main',
      assetKey: null,
    };
    const snapshot = await f.store.readParticipantSnapshot(
      member.principal,
      campaign.id,
      view,
      scope
    );
    const visible = snapshot.state.publicScene.actors.find((actor) => actor.id === 'token-2');
    assert.equal(visible.owned, false);
    assert.equal(visible.characterId, null);
    assert.equal(visible.portraitImage, null);
    assert.equal(visible.budget, undefined);
    assert.ok(!JSON.stringify(snapshot).includes('PRIVATE VISIBLE NPC SHEET'));
    assert.ok(!snapshot.state.records.some((row) => row.key.endsWith(npc)));
    assert.deepEqual(
      snapshot.state.gameplay.ownedTokens.map((actor) => actor.tokenId),
      ['token-1']
    );
    const slot = snapshot.manifest.images.find(
      (image) => image.source === 'actor' && image.id === 'token-2'
    );
    assert.ok(slot);
    const imageRequest = { ...view, viewKey: snapshot.viewKey };
    const imageResponse = await fetch(
      `${api.url}/api/cloud/campaigns/${campaign.id}/participant-assets/${slot.reference.sha256}`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + member.token,
          Origin: api.origin,
          'Content-Type': 'application/json',
          'X-TavernTable-Seat': scope.seatId,
          'X-TavernTable-Access-Generation': String(scope.accessGeneration),
        },
        body: JSON.stringify(imageRequest),
      }
    );
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get('content-type'), 'image/png');
    assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), bytes);
    await assert.rejects(
      f.store.readParticipantAsset(
        member.principal,
        campaign.id,
        slot.reference.sha256,
        { ...imageRequest, viewKey: '0'.repeat(64) },
        scope
      ),
      { code: 'participant-view-changed' }
    );
    await assert.rejects(
      f.store.readParticipantAsset(
        member.principal,
        campaign.id,
        slot.reference.sha256,
        { ...imageRequest, observerTokenId: 'token-2' },
        scope
      ),
      { code: 'participant-view-forbidden' }
    );
    const originalFile = f.runtime.bucket.file;
    let entered;
    let release;
    let hold = true;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const started = new Promise((resolve) => {
      entered = resolve;
    });
    f.runtime.bucket.file = function (...args) {
      const file = originalFile.apply(this, args);
      if (args[0] === `campaigns/${campaign.id}/assets/${slot.reference.sha256}.bin`) {
        const download = file.download.bind(file);
        file.download = async (...values) => {
          const result = await download(...values);
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
    const pending = f.store
      .readParticipantAsset(
        member.principal,
        campaign.id,
        slot.reference.sha256,
        imageRequest,
        scope
      )
      .then(
        (value) => ({ value }),
        (error) => ({ error })
      );
    await started;
    await ownerClient.removeMember(campaign.id, {
      seatId,
      accessGeneration: scope.accessGeneration,
    });
    release();
    assert.equal((await pending).error?.code, 'campaign-not-found');
  }
);

test(
  'participant deltas apply only to their captured revision and replace revoked views without replaying or retaining hidden actors',
  { timeout: 30000 },
  async (t) => {
    const f = await fixture(t);
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Participant delta contract');
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
    const hero = await library.create('Delta observer');
    const npc = await library.create('Revealed guide');
    await library.edit(npc, { notes: 'PRIVATE DELTA NPC NOTE' });
    const raw = sceneState({ characterId: hero, name: 'Delta observer' });
    raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
    const other = structuredClone(raw.creatures[0]);
    Object.assign(other, {
      id: 'token-2',
      instanceNumber: 2,
      characterId: npc,
      name: 'Revealed guide',
      gridX: 3,
      pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
    });
    raw.creatures.push(other);
    raw.tokenCounters = { nextId: 2, types: [[other.type, 2]] };
    const validation = { ruleset: '2014', library };
    const initial = CampaignWorld.fromScene(raw, validation).save();
    let revision = 0;
    const save = async (scene) => {
      const receipt = await ownerClient.commitScene(campaign.id, {
        ruleset: '2014',
        revision,
        charactersRevision: library.revision,
        scene: encodeScene(scene, validation),
      });
      revision = receipt.revision;
    };
    await save(initial);
    await ownerClient.assignCharacter(campaign.id, {
      seatId,
      characterId: hero,
      assigned: true,
      accessGeneration: 0,
    });
    const grant = await memberClient.getParticipantAccess(campaign.id);
    await ownerClient.controlLiveSession(
      campaign.id,
      'start',
      await ownerClient.getLiveSession(campaign.id)
    );
    const live = await ownerClient.getLiveSession(campaign.id);
    const request = {
      sessionId: live.sessionId,
      observerTokenId: 'token-1',
      mapId: 'map-main',
      assetKey: null,
    };
    const before = await memberClient.readParticipantSnapshot(campaign.id, request, grant.access);
    const moved = structuredClone(initial);
    moved.creatures[0].gridY = 2;
    moved.creatures[0].pose.world.z = 2.5;
    await save(moved);
    const cachedAssets = before.state.publicScene.assets;
    const current = await memberClient.readParticipantSnapshot(
      campaign.id,
      { ...request, assetKey: before.state.publicScene.assetKey },
      grant.access,
      { cachedAssets }
    );
    const delta = participantDelta(before, current);
    assert.equal(delta.kind, 'update');
    assert.equal(delta.changes.actors.upserts.length, 1);
    assert.equal(delta.changes.records.upserts.length, 0);
    const applied = applyCloudParticipantDelta(before, delta);
    assert.deepEqual(applied.state.publicScene.actors, current.state.publicScene.actors);
    assert.equal(applied.generation, current.generation);
    assert.equal(before.state.publicScene.actors[0].gridY, 1);
    assert.throws(() => applyCloudParticipantDelta(applied, delta), {
      code: 'participant-delta-gap',
    });
    const skipped = { ...delta, generation: delta.generation + 1 };
    assert.throws(() => applyCloudParticipantDelta(before, skipped), {
      code: 'participant-delta-gap',
    });
    const privateMetadata = structuredClone(delta);
    privateMetadata.changes.campaign.ownerUid = owner.uid;
    assert.throws(() => applyCloudParticipantDelta(before, privateMetadata), {
      code: 'invalid-cloud-participant',
    });
    const privateBudget = structuredClone(delta);
    privateBudget.changes.actors.upserts[0].budget = { action: 'PRIVATE NPC BUDGET' };
    assert.throws(() => applyCloudParticipantDelta(before, privateBudget), {
      code: 'invalid-player-state',
    });
    const hiddenSheet = structuredClone(delta);
    hiddenSheet.changes.records.upserts.push({
      key: `taverntable.character.v1.${npc}`,
      value: JSON.stringify(library.get(npc)),
    });
    assert.throws(() => applyCloudParticipantDelta(before, hiddenSheet), {
      code: 'invalid-cloud-participant',
    });
    assert.throws(
      () =>
        participantDelta(before, { ...current, access: { ...current.access, uid: 'foreign-uid' } }),
      { code: 'campaign-access-changed' }
    );
    const concealed = structuredClone(moved);
    concealed.creatures = concealed.creatures.filter((actor) => actor.id !== 'token-2');
    await save(concealed);
    const final = await memberClient.readParticipantSnapshot(campaign.id, request, grant.access);
    const replacement = participantDelta(current, final, { cachedAssets });
    assert.equal(replacement.kind, 'replace');
    assert.ok(!JSON.stringify(replacement).includes('Revealed guide'));
    assert.ok(!JSON.stringify(replacement).includes('PRIVATE DELTA NPC NOTE'));
    const reconciled = applyCloudParticipantDelta(applied, replacement);
    assert.deepEqual(
      reconciled.state.publicScene.actors.map((actor) => actor.id),
      ['token-1']
    );
    assert.deepEqual(reconciled.state.publicScene.updates, []);
  }
);

for (const change of ['membership', 'live pause', 'canonical head'])
  test(
    `participant checkpoint delivery rejects a ${change} change after actual Storage reads`,
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t);
      const owner = await f.account();
      const member = await f.account();
      const campaign = await f.create(owner.principal, 'Participant read admission fence');
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
      const hero = await library.create('In-flight observer');
      const validation = { ruleset: '2014', library };
      const scene = CampaignWorld.fromScene(
        sceneState({ characterId: hero, name: 'In-flight observer' }),
        validation
      ).save();
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
      await ownerClient.controlLiveSession(
        campaign.id,
        'start',
        await ownerClient.getLiveSession(campaign.id)
      );
      const live = await ownerClient.getLiveSession(campaign.id);
      const head = await f.runtime.firestore.collection('campaigns').doc(campaign.id).get();
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
        if (args[0] === head.data().charactersRef.path) {
          const download = file.download.bind(file);
          file.download = async (...values) => {
            const result = await download(...values);
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
      const pending = memberClient
        .readParticipantSnapshot(
          campaign.id,
          {
            sessionId: live.sessionId,
            observerTokenId: 'token-1',
            mapId: 'map-main',
            assetKey: null,
          },
          grant.access
        )
        .then(
          (value) => ({ value }),
          (error) => ({ error })
        );
      await started;
      if (change === 'membership')
        await ownerClient.removeMember(campaign.id, {
          seatId,
          accessGeneration: grant.access.accessGeneration,
        });
      else if (change === 'live pause')
        await ownerClient.controlLiveSession(campaign.id, 'end', live);
      else await library.edit(hero, { notes: 'Newer accepted canonical content' });
      release();
      assert.equal(
        (await pending).error?.code,
        change === 'membership'
          ? 'campaign-not-found'
          : change === 'live pause'
            ? 'live-session-paused'
            : 'participant-state-changed'
      );
      assert.equal(memberClient.pending, null);
    }
  );

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
  'ending a live campaign schedules its exact changed final checkpoint before the routine backup interval and skips an unchanged end',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Final paused checkpoint');
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
      store: {
        readCharacters: (id) => f.store.readCharacters(owner.principal, id),
        commitCharacters: (id, change) =>
          f.store.commitCharacters(owner.principal, id, { commandId: randomUUID(), change }),
      },
    });
    const hero = await library.create('Final resources');
    const validation = { library, ruleset: '2014' };
    const raw = sceneState({ characterId: hero, name: 'Final resources' });
    raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
    const scene = CampaignWorld.fromScene(raw, validation).save();
    const combat = new CombatSession({ library: library.engine });
    const actor = { ...scene.creatures[0], characterSheetId: hero };
    combat.startTurn(actor);
    combat.adjustMovement(actor, 20);
    scene.combat = combat.snapshot();
    await f.store.commitScene(owner.principal, campaign.id, {
      commandId: randomUUID(),
      change: {
        ruleset: '2014',
        revision: 0,
        charactersRevision: library.revision,
        scene: encodeScene(scene, validation),
      },
    });
    await f.store.runBackupWork(owner.principal, campaign.id, { final: true });
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    await library.edit(hero, { notes: 'EXACT FINAL LIVE RESOURCES' });
    const finalText = await f.store.exportBackup(owner.principal, campaign.id);
    const end = {
      commandId: randomUUID(),
      action: 'end',
      generation: active.generation,
      sessionId: active.sessionId,
    };
    const paused = await f.store.controlLiveSession(owner.principal, campaign.id, end);
    assert.equal(paused.state, 'paused');
    await library.edit(hero, { notes: 'LATER PAUSED PREPARATION' });
    const final = await f.createStore().runBackupWork(owner.principal, campaign.id);
    assert.ok(final, 'Pause must enqueue its final changed source before five minutes');
    assert.equal(await f.store.readBackup(owner.principal, campaign.id, final.name), finalText);
    assert.equal((await f.store.backupStatus(owner.principal, campaign.id)).state, 'pending');
    assert.deepEqual(await f.store.controlLiveSession(owner.principal, campaign.id, end), paused);
    assert.equal(await f.store.runBackupWork(owner.principal, campaign.id), null);
    assert.equal((await f.store.listBackups(owner.principal, campaign.id)).length, 2);
    await f.store.runBackupWork(owner.principal, campaign.id, { final: true });
    const before = await f.store.listBackups(owner.principal, campaign.id);
    const restarted = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId: paused.sessionId,
    });
    await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'end',
      generation: restarted.generation,
      sessionId: restarted.sessionId,
    });
    assert.equal(await f.store.runBackupWork(owner.principal, campaign.id), null);
    assert.deepEqual(await f.store.listBackups(owner.principal, campaign.id), before);
    assert.equal((await f.store.getLiveSession(owner.principal, campaign.id)).state, 'paused');
    t.diagnostic(
      'Exact complete final scene/turn/budgets/sheets preserved; unchanged end makes no copy'
    );
  }
);

test(
  'a paused campaign drains accepted work and owner-member streams independently of backup failure while another campaign stays live',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Paused backup failure');
    const otherCampaign = await f.create(owner.principal, 'Independent active game');
    const seatId = await f.join(campaign.id, member.uid);
    const api = await cloudApi({ access: f.access, store: f.store });
    const opens = new Map();
    let sceneAttempts = 0;
    const fetch = async (url, options) => {
      const event = /\/campaigns\/([^/]+)\/events$/.exec(String(url));
      if (event) opens.set(event[1], (opens.get(event[1]) ?? 0) + 1);
      if (String(url).endsWith(`/campaigns/${campaign.id}/scene`) && options.method === 'POST')
        sceneAttempts++;
      return globalThis.fetch(url, options);
    };
    const controller = f.client(owner, api, fetch);
    const memberClient = f.client(member, api, fetch);
    const observations = [];
    let release;
    let published;
    let saving;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    const committed = new Promise((resolve) => {
      published = resolve;
    });
    const writer = f.client(owner, api, async (url, options) => {
      const response = await fetch(url, options);
      if (String(url).endsWith(`/campaigns/${campaign.id}/scene`) && options.method === 'POST') {
        assert.equal(response.status, 200);
        published((await response.clone().json()).result);
        await held;
      }
      return response;
    });
    try {
      const library = await CampaignCharacters.open({
        campaignId: campaign.id,
        catalog: await f.resources.catalog(campaign),
        store: controller,
      });
      const hero = await library.create('Drained actor');
      await library.edit(hero, { notes: 'PRIVATE ACCEPTED FINAL CHECKPOINT' });
      const validation = { library, ruleset: '2014' };
      const raw = sceneState({ characterId: hero, name: 'Drained actor' });
      raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
      const scene = CampaignWorld.fromScene(raw, validation).save();
      await controller.commitScene(campaign.id, {
        ruleset: '2014',
        revision: 0,
        charactersRevision: library.revision,
        scene: encodeScene(scene, validation),
      });
      const otherLibrary = await CampaignCharacters.open({
        campaignId: otherCampaign.id,
        catalog: await f.resources.catalog(otherCampaign),
        store: controller,
      });
      await otherLibrary.create('Still active');
      await f.store.runBackupWork(owner.principal, campaign.id, { final: true });
      await f.store.runBackupWork(owner.principal, otherCampaign.id, { final: true });
      await controller.assignCharacter(campaign.id, {
        seatId,
        characterId: hero,
        assigned: true,
        accessGeneration: 0,
      });
      const active = await controller.controlLiveSession(
        campaign.id,
        'start',
        await controller.getLiveSession(campaign.id)
      );
      const otherActive = await controller.controlLiveSession(
        otherCampaign.id,
        'start',
        await controller.getLiveSession(otherCampaign.id)
      );
      const ownerAccess = await controller.getParticipantAccess(campaign.id);
      const memberAccess = await memberClient.getParticipantAccess(campaign.id);
      const otherAccess = await controller.getParticipantAccess(otherCampaign.id);
      const view = (sessionId) => ({
        sessionId,
        observerTokenId: null,
        mapId: null,
        assetKey: null,
      });
      const ownerLive = controller.observeEvents(
        campaign.id,
        view(active.sessionId),
        ownerAccess.access,
        {
          onState: () => {},
          onStatus: () => {},
        }
      );
      const memberLive = memberClient.observeEvents(
        campaign.id,
        { ...view(active.sessionId), observerTokenId: 'token-1', mapId: 'map-main' },
        memberAccess.access,
        { onState: () => {}, onStatus: () => {} }
      );
      let otherGeneration = Infinity;
      let deliverOther;
      const otherChanged = new Promise((resolve) => {
        deliverOther = resolve;
      });
      const otherLive = controller.observeEvents(
        otherCampaign.id,
        view(otherActive.sessionId),
        otherAccess.access,
        {
          onState: (state) => {
            if ((state?.head?.generation ?? 0) > otherGeneration) deliverOther(state);
          },
          onStatus: () => {},
        }
      );
      observations.push(ownerLive, memberLive, otherLive);
      const [, , otherInitial] = await Promise.all(observations.map((entry) => entry.ready));
      otherGeneration = otherInitial.head.generation;
      const moved = structuredClone(scene);
      moved.creatures[0].gridX = 2;
      moved.creatures[0].pose.world.x = 2.5;
      const attemptsBefore = sceneAttempts;
      saving = writer
        .commitScene(campaign.id, {
          ruleset: '2014',
          revision: 1,
          charactersRevision: library.revision,
          scene: encodeScene(moved, validation),
        })
        .then(
          (result) => ({ result }),
          (error) => ({ error })
        );
      assert.equal((await committed).revision, 2);
      const finalText = await f.store.exportBackup(owner.principal, campaign.id);
      const stage = f.store.backupObjects.stage;
      let backupAttempts = 0;
      f.store.backupObjects.stage = async () => {
        backupAttempts++;
        throw new CloudError(503, 'backup-storage-unavailable', 'Synthetic backup failure');
      };
      const prepare = f.store.usage.prepareOwnerStorage;
      let preparationAttempts = 0;
      f.store.usage.prepareOwnerStorage = async () => {
        preparationAttempts++;
        throw new CloudError(
          503,
          'storage-reservation-unavailable',
          'Synthetic backup preparation failure'
        );
      };
      const paused = await controller.controlLiveSession(campaign.id, 'end', active);
      assert.equal(paused.state, 'paused');
      await Promise.all([ownerLive.done, memberLive.done]);
      assert.equal(ownerLive.status.phase, 'paused');
      assert.equal(memberLive.status.phase, 'paused');
      assert.equal(ownerLive.current, null);
      assert.equal(memberLive.current, null);
      release();
      const acknowledged = await saving;
      if (acknowledged.error) throw acknowledged.error;
      assert.equal(acknowledged.result.revision, 2);
      assert.equal(sceneAttempts - attemptsBefore, 1);
      const wake = await memberClient.getLiveStatus(campaign.id);
      assert.equal(wake.session.state, 'paused');
      assert.ok(!JSON.stringify(wake).includes('PRIVATE ACCEPTED FINAL CHECKPOINT'));
      const failed = await f.store.backupStatus(owner.principal, campaign.id);
      assert.equal(failed.state, 'error');
      assert.equal(preparationAttempts, 1);
      assert.equal(backupAttempts, 0);
      f.store.usage.prepareOwnerStorage = prepare;
      assert.equal((await memberClient.getLiveStatus(campaign.id)).session.state, 'paused');
      assert.equal((await f.store.backupStatus(owner.principal, campaign.id)).state, 'error');
      assert.equal(backupAttempts, 1);
      assert.equal((await f.store.getLiveSession(owner.principal, campaign.id)).state, 'paused');
      f.store.backupObjects.stage = stage;
      const finished = await controller.finishBackupSession(campaign.id);
      assert.ok(finished);
      assert.equal(
        await f.store.readBackup(owner.principal, campaign.id, finished.name),
        finalText
      );
      assert.equal((await f.store.backupStatus(owner.principal, campaign.id)).state, 'saved');
      await otherLibrary.create('Accepted in the other live game');
      assert.equal((await otherChanged).head.generation, otherGeneration + 1);
      assert.equal(otherLive.status.phase, 'ready');
      assert.equal((await f.store.getLiveSession(owner.principal, otherCampaign.id)).state, 'live');
      assert.equal(f.store.participantChanges.groups.size, 1);
      const before = opens.get(campaign.id);
      ownerLive.reconnect();
      memberLive.reconnect();
      await new Promise((resolve) => setTimeout(resolve, 1250));
      assert.equal(opens.get(campaign.id), before);
      assert.equal(before, 2);
      assert.equal(opens.get(otherCampaign.id), 1);
      const usage = await f.runtime.firestore
        .collection('accountStreams')
        .doc(pilotAccountKey(member.uid))
        .get();
      assert.equal(usage.data().leases.length, 0);
      t.diagnostic(
        'One canonical acknowledgement survives pause; two paused streams stop without retries; private failed final backup recovers while the other stream stays ready'
      );
    } finally {
      release();
      if (saving) await saving;
      await Promise.all(observations.map((entry) => entry.close()));
      controller.close();
      writer.close();
      memberClient.close();
      await api.close();
    }
  }
);

test(
  'natural inactivity and disconnected cold wake retain exact final sources without reviving live authority or granting member backup access',
  { timeout: 60000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now, cleanup: true });
    const owner = await f.account();
    const member = await f.account();
    for (const mode of ['inactivity-publication', 'disconnected-cold-wake']) {
      const campaign = await f.create(owner.principal, mode);
      await f.join(campaign.id, member.uid);
      const library = await CampaignCharacters.open({
        campaignId: campaign.id,
        catalog: await f.resources.catalog(campaign),
        store: {
          readCharacters: (id) => f.store.readCharacters(owner.principal, id),
          commitCharacters: (id, change) =>
            f.store.commitCharacters(owner.principal, id, { commandId: randomUUID(), change }),
        },
      });
      const hero = await library.create('Natural final actor');
      await f.store.runBackupWork(owner.principal, campaign.id, { final: true });
      const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
        commandId: randomUUID(),
        action: 'start',
        generation: 0,
        sessionId: null,
      });
      let deadline;
      if (mode === 'inactivity-publication') {
        deadline = Date.parse(active.lastMeaningfulAt) + 60 * 60 * 1000;
        await f.advancePresence(
          owner.principal,
          campaign.id,
          active.sessionId,
          (at) => {
            now = at;
          },
          deadline - 1
        );
        now = deadline;
        await library.edit(hero, { notes: 'ACCEPTED AT INACTIVITY PAUSE' });
      } else {
        const presence = await f.store.connectLivePresence(owner.principal, campaign.id, {
          sessionId: active.sessionId,
        });
        await library.edit(hero, { notes: 'FINAL BEFORE LAST DISCONNECT' });
        await f.store.disconnectLivePresence(owner.principal, campaign.id, {
          sessionId: active.sessionId,
          connectionId: presence.id,
        });
        deadline = now + 15 * 60 * 1000;
        now = deadline + 2 * 60 * 1000;
      }
      const status = await f.createStore().getLiveStatus(member.principal, campaign.id);
      assert.equal(status.session.state, 'paused');
      assert.equal(
        status.session.pauseReason,
        mode === 'inactivity-publication' ? 'inactivity' : 'disconnected'
      );
      assert.equal(status.session.pausedAt, new Date(deadline).toISOString());
      if (mode === 'inactivity-publication')
        assert.equal(status.session.lastMeaningfulAt, active.lastMeaningfulAt);
      const finalText = await f.store.exportBackup(owner.principal, campaign.id);
      await library.edit(hero, { notes: 'LATER PERMITTED PAUSED PREPARATION' });
      const replacement = f.createStore();
      assert.equal(await replacement.runLiveBackupWork(member.principal, campaign.id), undefined);
      const final = (await f.store.backupStatus(owner.principal, campaign.id)).latest;
      assert.equal(await f.store.readBackup(owner.principal, campaign.id, final.name), finalText);
      await assert.rejects(f.store.readBackup(member.principal, campaign.id, final.name), {
        code: 'campaign-not-found',
      });
      assert.deepEqual(
        await replacement.getLiveSession(member.principal, campaign.id),
        status.session
      );
      await assert.rejects(
        replacement.getLiveAccess(member.principal, campaign.id, {
          sessionId: active.sessionId,
        }),
        { code: 'live-session-paused' }
      );
    }
    t.diagnostic(
      'Natural 60-minute and original 15-minute grace pauses preserve frozen sources across fresh workers and later paused edits; member wake returns no private backup data'
    );
  }
);

test(
  'paused live status rechecks member access after final-backup IO while the accepted owner backup remains durable',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Final backup access race');
    const seatId = await f.join(campaign.id, member.uid);
    const library = await CampaignCharacters.open({
      campaignId: campaign.id,
      catalog: await f.resources.catalog(campaign),
      store: {
        readCharacters: (id) => f.store.readCharacters(owner.principal, id),
        commitCharacters: (id, change) =>
          f.store.commitCharacters(owner.principal, id, { commandId: randomUUID(), change }),
      },
    });
    const hero = await library.create('Access-race actor');
    await f.store.runBackupWork(owner.principal, campaign.id, { final: true });
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: 0,
      sessionId: null,
    });
    await library.edit(hero, { notes: 'OWNER FINAL SOURCE DURING MEMBER REMOVAL' });
    await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'end',
      generation: active.generation,
      sessionId: active.sessionId,
    });
    const finalText = await f.store.exportBackup(owner.principal, campaign.id);
    const api = await cloudApi({ access: f.access, store: f.store });
    const ownerClient = f.client(owner, api);
    const memberClient = f.client(member, api);
    let release;
    let entered;
    let request;
    const hold = new Promise((resolve) => {
      release = resolve;
    });
    const writing = new Promise((resolve) => {
      entered = resolve;
    });
    const stage = f.store.backupObjects.stage;
    f.store.backupObjects.stage = async (...args) => {
      entered();
      await hold;
      return stage.apply(f.store.backupObjects, args);
    };
    try {
      request = memberClient.getLiveStatus(campaign.id).then(
        (result) => ({ result }),
        (error) => ({ error })
      );
      await writing;
      await ownerClient.removeMember(campaign.id, { seatId, accessGeneration: 0 });
      release();
      const outcome = await request;
      assert.equal(outcome.error?.code, 'campaign-not-found');
      assert.equal(outcome.error.status, 404);
      const saved = await f.store.backupStatus(owner.principal, campaign.id);
      assert.equal(saved.state, 'saved');
      assert.equal(
        await f.store.readBackup(owner.principal, campaign.id, saved.latest.name),
        finalText
      );
      t.diagnostic(
        'Revoked member gets 404 after held backup IO; accepted owner source still completes'
      );
    } finally {
      release();
      if (request) await request;
      ownerClient.close();
      memberClient.close();
      await api.close();
    }
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
  'transport presence acknowledgements coalesce durable proof and server renewal cannot keep a vanished client alive',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now, cleanup: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Client presence proof');
    await f.join(campaign.id, member.uid);
    const grant = await f.store.getParticipantAccess(member.principal, campaign.id);
    const scope = {
      seatId: grant.access.seatId,
      accessGeneration: grant.access.accessGeneration,
    };
    const paused = await f.store.getLiveSession(owner.principal, campaign.id);
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId: paused.sessionId,
    });
    const started = now;
    const connection = await f.store.connectLivePresence(
      member.principal,
      campaign.id,
      { sessionId: active.sessionId },
      { clientAcknowledgements: true }
    );
    const command = { sessionId: active.sessionId, connectionId: connection.id };
    const reference = f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('livePresenceConnections')
      .doc(connection.id);
    const before = (await reference.get()).data();
    now = started + 25000;
    const early = await f.store.acknowledgeLivePresence(
      member.principal,
      campaign.id,
      command,
      scope
    );
    assert.equal(early.expiresAt, started + 90000);
    assert.deepEqual((await reference.get()).data(), before);
    now = started + 60000;
    const serverRenewal = await f.store.renewLivePresence(member.principal, campaign.id, command);
    assert.equal(serverRenewal.clientExpiresAt, started + 90000);
    assert.equal(serverRenewal.expiresAt, started + 90000);
    now = started + 75000;
    const acknowledged = await f.store.acknowledgeLivePresence(
      member.principal,
      campaign.id,
      command,
      scope
    );
    assert.equal(acknowledged.expiresAt, started + 165000);
    now = started + 150000;
    const later = await f.store.renewLivePresence(member.principal, campaign.id, command);
    assert.equal(later.clientExpiresAt, started + 165000);
    assert.equal(later.expiresAt, started + 165000);
    now = started + 165000;
    await assert.rejects(
      f.store.renewLivePresence(member.principal, campaign.id, command),
      (error) => error.code === 'client-presence-expired'
    );
    await assert.rejects(
      f.store.acknowledgeLivePresence(member.principal, campaign.id, command, scope),
      (error) => error.code === 'client-presence-expired'
    );
    const disconnected = await f.store.getLiveStatus(owner.principal, campaign.id);
    assert.equal(disconnected.activity.disconnectedAt, new Date(now).toISOString());
    assert.equal(disconnected.session.lastMeaningfulAt, active.lastMeaningfulAt);
    await f.store.disconnectLivePresence(member.principal, campaign.id, command, scope);
  }
);

test(
  'ended or foreign presence channels expire without revoking a current campaign member',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now, cleanup: true });
    const owner = await f.account();
    const member = await f.account();
    const campaign = await f.create(owner.principal, 'Ended presence is not campaign removal');
    await f.join(campaign.id, member.uid);
    const grant = await f.store.getParticipantAccess(member.principal, campaign.id);
    const scope = {
      seatId: grant.access.seatId,
      accessGeneration: grant.access.accessGeneration,
    };
    const paused = await f.store.getLiveSession(owner.principal, campaign.id);
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId: paused.sessionId,
    });
    const keeper = await f.store.connectLivePresence(
      owner.principal,
      campaign.id,
      { sessionId: active.sessionId },
      { clientAcknowledgements: true }
    );
    const connection = await f.store.connectLivePresence(
      member.principal,
      campaign.id,
      { sessionId: active.sessionId },
      { clientAcknowledgements: true }
    );
    const head = f.runtime.firestore.collection('campaigns').doc(campaign.id);
    const before = (await head.get()).data();
    const keeperReference = head.collection('livePresenceConnections').doc(keeper.id);
    const keeperBefore = (await keeperReference.get()).data();
    await f.store.disconnectLivePresence(
      member.principal,
      campaign.id,
      { sessionId: active.sessionId, connectionId: connection.id },
      scope
    );
    for (const connectionId of [connection.id, randomUUID(), keeper.id]) {
      const command = { sessionId: active.sessionId, connectionId };
      await assert.rejects(
        f.store.acknowledgeLivePresence(member.principal, campaign.id, command, scope),
        { status: 409, code: 'client-presence-expired' }
      );
      await assert.rejects(f.store.renewLivePresence(member.principal, campaign.id, command), {
        status: 409,
        code: 'client-presence-expired',
      });
    }
    assert.deepEqual((await keeperReference.get()).data(), keeperBefore);
    assert.deepEqual(
      (await f.store.getParticipantAccess(member.principal, campaign.id)).access,
      grant.access
    );
    const reopened = await f.store.connectLivePresence(
      member.principal,
      campaign.id,
      { sessionId: active.sessionId },
      { clientAcknowledgements: true }
    );
    now += 75000;
    const command = { sessionId: active.sessionId, connectionId: reopened.id };
    const acknowledged = await f.store.acknowledgeLivePresence(
      member.principal,
      campaign.id,
      command,
      scope
    );
    assert.equal(acknowledged.expiresAt, now + 90000);
    assert.equal(
      (await f.store.getLiveSession(member.principal, campaign.id)).lastMeaningfulAt,
      active.lastMeaningfulAt
    );
    assert.deepEqual((await head.get()).data(), before);
    await f.store.disconnectLivePresence(member.principal, campaign.id, command, scope);
    await f.store.disconnectLivePresence(owner.principal, campaign.id, {
      sessionId: active.sessionId,
      connectionId: keeper.id,
    });
  }
);

test(
  'a managed HTTP observer reconnects an ended presence channel without losing valid campaign access',
  { timeout: 90000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const owner = await f.account();
    const campaign = await f.create(owner.principal, 'Presence renewal recovery');
    const grant = await f.store.getParticipantAccess(owner.principal, campaign.id);
    const paused = await f.store.getLiveSession(owner.principal, campaign.id);
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId: paused.sessionId,
    });
    const keeper = await f.store.connectLivePresence(owner.principal, campaign.id, {
      sessionId: active.sessionId,
    });
    const api = await cloudApi({ access: f.access, store: f.store });
    const client = f.client(owner, api);
    const reconnected = Promise.withResolvers();
    const statuses = [];
    let observation;
    let recovering = false;
    let received = 0;
    let deadline;
    try {
      observation = client.observeEvents(
        campaign.id,
        {
          sessionId: active.sessionId,
          observerTokenId: null,
          mapId: null,
          assetKey: null,
        },
        grant.access,
        {
          onState(value) {
            received++;
            if (recovering && received > 1) reconnected.resolve(value);
          },
          onStatus(status) {
            statuses.push(status);
            if (recovering && ['denied', 'error'].includes(status.phase))
              reconnected.reject(new Error('Current campaign access was ended: ' + status.reason));
          },
        }
      );
      await observation.ready;
      const connections = await f.runtime.firestore
        .collection('campaigns')
        .doc(campaign.id)
        .collection('livePresenceConnections')
        .get();
      const transport = connections.docs.filter(
        (value) => value.data().uid === owner.uid && value.data().version === 2
      );
      assert.equal(transport.length, 1);
      recovering = true;
      await f.store.disconnectLivePresence(owner.principal, campaign.id, {
        sessionId: active.sessionId,
        connectionId: transport[0].id,
      });
      const restored = await Promise.race([
        reconnected.promise,
        new Promise((_, reject) => {
          deadline = setTimeout(
            () => reject(new Error('The valid managed observer did not reconnect')),
            45000
          );
        }),
      ]);
      assert.equal(restored.access.uid, owner.uid);
      assert.equal(observation.status.phase, 'ready');
      assert.ok(statuses.some((status) => status.phase === 'reconnecting'));
      assert.ok(!statuses.some((status) => status.phase === 'denied'));
      assert.deepEqual(
        (await f.store.getParticipantAccess(owner.principal, campaign.id)).access,
        grant.access
      );
      assert.equal(
        (await f.store.getLiveSession(owner.principal, campaign.id)).lastMeaningfulAt,
        active.lastMeaningfulAt
      );
    } finally {
      clearTimeout(deadline);
      await observation?.close();
      await client.close();
      await api.close();
      await f.store.disconnectLivePresence(owner.principal, campaign.id, {
        sessionId: active.sessionId,
        connectionId: keeper.id,
      });
    }
  }
);

test(
  'client presence proof is UID and epoch scoped across workers while revoked owners of a connection can still close it',
  { timeout: 30000 },
  async (t) => {
    let now = Date.now();
    const f = await fixture(t, { now: () => now, cleanup: true });
    const owner = await f.account();
    const member = await f.account();
    const unrelated = await f.account();
    const campaign = await f.create(owner.principal, 'Scoped client acknowledgement');
    await f.join(campaign.id, member.uid);
    const grant = await f.store.getParticipantAccess(member.principal, campaign.id);
    const scope = {
      seatId: grant.access.seatId,
      accessGeneration: grant.access.accessGeneration,
    };
    const paused = await f.store.getLiveSession(owner.principal, campaign.id);
    const active = await f.store.controlLiveSession(owner.principal, campaign.id, {
      commandId: randomUUID(),
      action: 'start',
      generation: paused.generation,
      sessionId: paused.sessionId,
    });
    const connection = await f.store.connectLivePresence(
      member.principal,
      campaign.id,
      { sessionId: active.sessionId },
      { clientAcknowledgements: true }
    );
    const command = { sessionId: active.sessionId, connectionId: connection.id };
    const reference = f.runtime.firestore
      .collection('campaigns')
      .doc(campaign.id)
      .collection('livePresenceConnections')
      .doc(connection.id);
    const before = (await reference.get()).data();
    await assert.rejects(
      f.store.acknowledgeLivePresence(unrelated.principal, campaign.id, command, scope),
      (error) => error.status === 404
    );
    await assert.rejects(
      f.store.acknowledgeLivePresence(member.principal, campaign.id, command, {
        ...scope,
        accessGeneration: scope.accessGeneration + 1,
      }),
      (error) => error.code === 'campaign-access-changed'
    );
    assert.deepEqual((await reference.get()).data(), before);
    now += 75000;
    const otherWorker = f.createStore();
    const accepted = await otherWorker.acknowledgeLivePresence(
      member.principal,
      campaign.id,
      command,
      scope
    );
    assert.equal(accepted.expiresAt, now + 90000);
    await f.runtime.firestore
      .collection('campaignMemberships')
      .doc(pilotAccountKey(member.uid))
      .collection('campaigns')
      .doc(campaign.id)
      .delete();
    await assert.rejects(
      otherWorker.acknowledgeLivePresence(member.principal, campaign.id, command, scope),
      (error) => error.status === 404
    );
    await assert.rejects(
      otherWorker.disconnectLivePresence(member.principal, campaign.id, command, {
        ...scope,
        accessGeneration: scope.accessGeneration + 1,
      }),
      (error) => error.code === 'campaign-access-changed'
    );
    assert.equal(
      (await otherWorker.disconnectLivePresence(member.principal, campaign.id, command, scope))
        .closed,
      true
    );
    assert.equal(
      (await otherWorker.disconnectLivePresence(member.principal, campaign.id, command, scope))
        .closed,
      false
    );
    assert.equal(
      (await f.store.getLiveStatus(owner.principal, campaign.id)).activity.disconnectedAt,
      new Date(now).toISOString()
    );
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
