const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash, webcrypto } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sdk = require('firebase/auth');
const {
  createEmulatorRuntime,
  readEmulatorEnvironment,
} = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { PrivateCampaignAssets } = require('../../tools/cloud/campaign-assets.js');
const { HostResources } = require('../../tools/host-resources.js');
const { default: CloudAccount } = require('../../src/campaigns/CloudAccount.js');
const {
  default: CloudAccountConnection,
} = require('../../src/campaigns/CloudAccountConnection.js');
const {
  default: CloudCampaignClientStore,
} = require('../../src/campaigns/CloudCampaignClientStore.js');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');
const { default: CampaignWorld } = require('../../src/campaigns/CampaignWorld.js');
const { encodeScene } = require('../../src/campaigns/CampaignScene.js');
const { gameplayRuntime } = require('../../src/campaigns/ServerGameplay.js');
const { applyCloudParticipantDelta } = require('../../src/campaigns/CloudParticipantProtocol.js');
const { sceneActorPlacement } = require('../../src/scene/token-adapter/SavedPlacements.js');
const { sceneState } = require('../helpers/sceneState.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');
const { createCanvas } = require('canvas');
const { IDBFactory } = require('fake-indexeddb');
const { default: CloudParticipantCache } = require('../../src/campaigns/CloudParticipantCache.js');
const {
  default: CloudPlayerSessionConnection,
} = require('../../src/campaigns/CloudPlayerSessionConnection.js');
const { openDatabase, requestResult, transact } = require('../../src/storage/indexedDB.js');

async function fixture(
  t,
  {
    ruleset = '2014',
    memberFetch = globalThis.fetch,
    cleanup = false,
    participantCacheFactory,
  } = {}
) {
  const runtime = await createEmulatorRuntime();
  const identities = [];
  const events = [];
  let api = null;
  let participantFixture = null;
  t.after(async () => {
    const errors = [];
    for (const event of events) {
      try {
        await event.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (api) {
      try {
        await api.close();
      } catch (error) {
        errors.push(error);
      }
    }
    for (const identity of identities) {
      try {
        await identity.close();
      } catch (error) {
        errors.push(error);
      }
    }
    if (cleanup && participantFixture) {
      try {
        await cleanParticipantFixture(participantFixture, participantBrowserStorage(), []);
      } catch (error) {
        errors.push(error);
      }
    }
    try {
      await runtime.close();
    } catch (error) {
      errors.push(error);
    }
    if (errors.length) throw new AggregateError(errors, 'World command fixtures did not close');
  });
  const root = path.resolve(__dirname, '..', '..');
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8')
  );
  const resources = new HostResources({ root, manifest });
  const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
  const store = new CloudCampaignStore({
    firestore: runtime.firestore,
    access,
    packs: manifest.packs,
    resources,
    objects: new ImmutableCloudObjects({ bucket: runtime.bucket }),
    assets: new PrivateCampaignAssets({ bucket: runtime.bucket }),
  });
  api = await cloudApi({ access, store });
  const environment = readEmulatorEnvironment();
  const account = async (fetch = globalThis.fetch) => {
    const identity = await signedInIdentity(runtime);
    identities.push(identity);
    await runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(identity.uid))
      .set({ version: 1, uid: identity.uid, enabled: true });
    const client = new CloudCampaignClientStore({
      uid: identity.uid,
      packs: manifest.packs,
      connection: new CloudAccountConnection({
        account: new CloudAccount({ auth: identity.auth, sdk }),
        fetch,
        participantCacheFactory,
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
            appId: 'demo-live-world-commands',
          },
        },
      }),
    });
    return { ...identity, client };
  };
  const owner = await account();
  const member = await account(memberFetch);
  const campaign = await owner.client.create({ name: 'Cloud native motion', ruleset });
  const catalog = await resources.catalog(campaign);
  const library = await CampaignCharacters.open({
    campaignId: campaign.id,
    store: owner.client,
    catalog,
  });
  const hero = await library.create('Assigned observer');
  const npc = await library.create('Visible guide');
  const raw = sceneState({ characterId: hero, name: 'Assigned observer' });
  raw.ruleset = ruleset;
  raw.terrain.heights = raw.terrain.heights.map((row) => row.map(() => 0));
  const guide = structuredClone(raw.creatures[0]);
  Object.assign(guide, {
    id: 'token-2',
    instanceNumber: 2,
    characterId: npc,
    name: 'Visible guide',
    gridX: 3,
    pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 1.5 } },
  });
  raw.creatures.push(guide);
  raw.tokenCounters = { nextId: 2, types: [[guide.type, 2]] };
  const validation = { ruleset, library };
  const scene = CampaignWorld.fromScene(raw, validation).save();
  await owner.client.commitScene(campaign.id, {
    ruleset,
    revision: 0,
    charactersRevision: library.revision,
    scene: encodeScene(scene, validation),
  });
  const invite = await owner.client.createInvitation(campaign.id, { name: 'Cloud world player' });
  await member.client.redeemInvitation(invite);
  const joined = await member.client.getParticipantAccess(campaign.id);
  await owner.client.assignCharacter(campaign.id, {
    seatId: joined.access.seatId,
    characterId: hero,
    assigned: true,
    accessGeneration: joined.access.accessGeneration,
  });
  const grant = await member.client.getParticipantAccess(campaign.id);
  await owner.client.controlLiveSession(
    campaign.id,
    'start',
    await owner.client.getLiveSession(campaign.id)
  );
  const live = await owner.client.getLiveSession(campaign.id);
  participantFixture = {
    runtime,
    store,
    access,
    api,
    account,
    owner,
    member,
    campaign,
    library,
    catalog,
    hero,
    npc,
    scene,
    validation,
    grant,
    live,
    track: (value) => {
      events.push(value);
      return value;
    },
    async openMember() {
      const event = await member.client.openEvents(
        campaign.id,
        {
          sessionId: live.sessionId,
          observerTokenId: 'token-1',
          mapId: 'map-main',
          assetKey: null,
        },
        grant.access
      );
      events.push(event);
      return event;
    },
    observeMember(listeners) {
      const observation = member.client.observeEvents(
        campaign.id,
        {
          sessionId: live.sessionId,
          observerTokenId: 'token-1',
          mapId: 'map-main',
          assetKey: null,
        },
        grant.access,
        listeners
      );
      events.push(observation);
      return observation;
    },
    async openOwner() {
      const ownerGrant = await owner.client.getParticipantAccess(campaign.id);
      const event = await owner.client.openOwnerEvents(
        campaign.id,
        { sessionId: live.sessionId },
        ownerGrant.access
      );
      events.push(event);
      return event;
    },
    async observeOwner(listeners) {
      const ownerGrant = await owner.client.getParticipantAccess(campaign.id);
      const observation = owner.client.observeOwnerEvents(
        campaign.id,
        { sessionId: live.sessionId },
        ownerGrant.access,
        listeners
      );
      events.push(observation);
      return observation;
    },
  };
  return participantFixture;
}

function ownerMove(f) {
  const scene = structuredClone(f.scene);
  const actor = scene.creatures.find((entry) => entry.id === 'token-2');
  const from = sceneActorPlacement(
    f.scene,
    f.scene.creatures.find((entry) => entry.id === actor.id)
  );
  actor.gridY = 2;
  actor.pose.world.z = 2.5;
  return {
    commandId: randomUUID(),
    sessionId: f.live.sessionId,
    presentations: [
      {
        commandId: randomUUID(),
        tokenId: actor.id,
        kind: 'move',
        motion: { kind: 'walk', completed: true, from, route: [sceneActorPlacement(scene, actor)] },
      },
    ],
    change: {
      ruleset: '2014',
      revision: 1,
      charactersRevision: f.library.revision,
      scene: encodeScene(scene, f.validation),
    },
  };
}

async function publishOwner(f, command, identity = f.owner) {
  const response = await fetch(`${f.api.url}/api/cloud/campaigns/${f.campaign.id}/scene`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + identity.token,
      Origin: f.api.origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(command),
  });
  return { status: response.status, body: await response.json() };
}

function playerMove(f, checkpoint, target = { mapId: 'map-main', gridX: 2, gridY: 1 }) {
  return {
    sessionId: f.live.sessionId,
    command: {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: checkpoint.state.sceneRevision,
      charactersRevision: checkpoint.state.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target },
      view: { mapId: 'map-main', assetKey: checkpoint.state.publicScene.assetKey },
    },
  };
}

async function publishPlayer(f, request, identity = f.member, scope = f.grant.access) {
  const response = await fetch(`${f.api.url}/api/cloud/campaigns/${f.campaign.id}/world-commands`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + identity.token,
      Origin: f.api.origin,
      'Content-Type': 'application/json',
      'X-TavernTable-Seat': scope.seatId,
      'X-TavernTable-Access-Generation': String(scope.accessGeneration),
    },
    body: JSON.stringify(request),
  });
  return { status: response.status, body: await response.json() };
}

function ownerRequest(
  f,
  {
    operation = 'owner-state',
    identity = f.owner,
    seatId = null,
    accessGeneration = 0,
    sessionId = f.live.sessionId,
    origin = f.api.origin,
  } = {}
) {
  return fetch(`${f.api.url}/api/cloud/campaigns/${f.campaign.id}/${operation}`, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + identity.token,
      Origin: origin,
      'Content-Type': 'application/json',
      'X-TavernTable-Seat': seatId ?? 'owner',
      'X-TavernTable-Access-Generation': String(accessGeneration),
    },
    body: JSON.stringify({ sessionId }),
  });
}

function participantBrowserStorage() {
  const entries = new Map();
  const pending = new Map();
  const held = new Set();
  return {
    entries,
    indexedDB: new IDBFactory(),
    crypto: webcrypto,
    cacheStorage: {
      open: async () => ({
        put: async (request, response) =>
          entries.set(request.url, {
            bytes: new Uint8Array(await response.arrayBuffer()),
            headers: new Headers(response.headers),
          }),
        match: async (request) => {
          const entry = entries.get(request.url);
          return entry && new Response(entry.bytes.slice(), { headers: entry.headers });
        },
        delete: async (request) => entries.delete(request.url),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
      }),
    },
    locks: {
      request: (name, { mode }, operation) => {
        const run = async () => {
          const lock = { name, mode };
          held.add(lock);
          try {
            return await operation(lock);
          } finally {
            held.delete(lock);
          }
        };
        if (mode === 'shared') return run();
        const task = (pending.get(name) ?? Promise.resolve()).then(run, run);
        pending.set(name, task);
        return task;
      },
      query: async () => ({ held: [...held], pending: [] }),
    },
  };
}

function participantNetwork() {
  const requests = [];
  const graphics = [];
  const images = [];
  const streams = new Set();
  let offline = false;
  let hold = null;
  const graphic = (snapshot) => {
    const assets = snapshot?.state?.publicScene?.assets;
    if (assets !== null && assets !== undefined) {
      const bytes = Buffer.from(JSON.stringify(assets));
      graphics.push({
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      });
    }
  };
  return {
    requests,
    graphics,
    images,
    setOffline(value) {
      offline = value;
      if (!offline) return;
      for (const controller of streams)
        controller.error(new TypeError('Synthetic participant network loss'));
      streams.clear();
    },
    holdNextState() {
      let entered;
      let release;
      hold = {
        entered: new Promise((resolve) => {
          entered = resolve;
        }),
        waiting: new Promise((resolve) => {
          release = resolve;
        }),
        enter: () => entered(),
        release: () => release(),
      };
      return hold;
    },
    fetch: async (url, options) => {
      const pathname = new URL(url).pathname;
      requests.push({
        pathname,
        body: options.body ? JSON.parse(options.body) : null,
        seatId: options.headers['X-TavernTable-Seat'],
        accessGeneration: options.headers['X-TavernTable-Access-Generation'],
      });
      if (offline) throw new TypeError('Synthetic participant network is offline');
      const response = await fetch(url, options);
      if (!response.ok) return response;
      if (pathname.endsWith('/participant-state')) {
        graphic((await response.clone().json()).result);
        if (hold) {
          const captured = hold;
          hold = null;
          captured.enter();
          await captured.waiting;
        }
      } else if (/\/participant-assets\/[a-f0-9]{64}$/.test(pathname)) {
        const bytes = Buffer.from(await response.clone().arrayBuffer());
        images.push({
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        });
      } else if (pathname.endsWith('/events')) {
        const decoder = new TextDecoder();
        let buffered = '';
        const stream = response.body.pipeThrough(
          new TransformStream({
            start(controller) {
              streams.add(controller);
            },
            transform(chunk, controller) {
              buffered += decoder.decode(chunk, { stream: true });
              let end;
              while ((end = buffered.indexOf('\n')) !== -1) {
                const line = buffered.slice(0, end).trimEnd();
                buffered = buffered.slice(end + 1);
                if (!line.startsWith('data:')) continue;
                const event = JSON.parse(line.slice(5).trim());
                graphic(event.checkpoint || event.delta?.checkpoint);
              }
              controller.enqueue(chunk);
            },
            flush(controller) {
              streams.delete(controller);
            },
          })
        );
        return new Response(stream, { headers: response.headers, status: response.status });
      }
      return response;
    },
  };
}

async function clearParticipantStorage(storage, uid) {
  const cache = new CloudParticipantCache({ ...storage, uid });
  try {
    await cache.clear();
    assert.equal((await cache.getUsage()).bytes, 0);
  } finally {
    cache.close();
  }
  for (const database of await storage.indexedDB.databases())
    await new Promise((resolve, reject) => {
      const request = storage.indexedDB.deleteDatabase(database.name);
      request.onsuccess = resolve;
      request.onerror = () => reject(request.error);
    });
  storage.entries.clear();
}

async function cleanParticipantFixture(f, storage, connections, extraAccounts = []) {
  for (const connection of connections) await connection.close();
  await clearParticipantStorage(storage, f.member.uid);
  const prefix = `campaigns/${f.campaign.id}/`;
  const [files] = await f.runtime.bucket.getFiles({ prefix, versions: true });
  for (const file of files) await file.delete({ ignoreNotFound: true });
  const invitations = await f.runtime.firestore
    .collection('campaignInvitations')
    .where('campaignId', '==', f.campaign.id)
    .get();
  for (const invitation of invitations.docs) await invitation.ref.delete();
  await f.runtime.firestore.recursiveDelete(
    f.runtime.firestore.collection('campaigns').doc(f.campaign.id)
  );
  for (const identity of [f.owner, f.member, ...extraAccounts]) {
    identity.client.close();
    for (const name of [
      'pilotAccounts',
      'accountCommands',
      'campaignMemberships',
      'accountImports',
      'accountObjectMaintenance',
    ])
      await f.runtime.firestore.recursiveDelete(
        f.runtime.firestore.collection(name).doc(pilotAccountKey(identity.uid))
      );
    await f.runtime.auth.deleteUser(identity.uid);
    assert.equal(
      (
        await f.runtime.firestore
          .collection('pilotAccounts')
          .doc(pilotAccountKey(identity.uid))
          .get()
      ).exists,
      false
    );
    await assert.rejects(f.runtime.auth.getUser(identity.uid), { code: 'auth/user-not-found' });
  }
  assert.equal(
    (await f.runtime.firestore.collection('campaigns').doc(f.campaign.id).get()).exists,
    false
  );
  assert.equal((await f.runtime.bucket.getFiles({ prefix, versions: true }))[0].length, 0);
  assert.equal((await storage.indexedDB.databases()).length, 0);
}

test(
  'private SDK lifecycle purges logout and switched UID caches while retaining only the original unacknowledged edit for online receipt recovery',
  { timeout: 120000 },
  async (t) => {
    const storage = participantBrowserStorage();
    const network = participantNetwork();
    const bodies = [];
    const worldBodies = [];
    let loseReply = false;
    let loseWorldReply = false;
    const f = await fixture(t, {
      participantCacheFactory: ({ uid }) => new CloudParticipantCache({ ...storage, uid }),
      memberFetch: async (url, options) => {
        const assigned = url.endsWith('/assigned-characters') && options.method === 'POST';
        const world = url.endsWith('/world-commands') && options.method === 'POST';
        if (assigned) bodies.push(options.body);
        if (world) worldBodies.push(options.body);
        const response = await network.fetch(url, options);
        if ((assigned && loseReply) || (world && loseWorldReply)) {
          loseReply = false;
          loseWorldReply = false;
          assert.equal(response.status, 200);
          await response.clone().json();
          throw new TypeError('Synthetic lost reply after actual assigned publication');
        }
        return response;
      },
    });
    const connections = [];
    const extraAccounts = [];
    const create = () => {
      const connection = new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
        cache: new CloudParticipantCache({ ...storage, uid: f.member.uid }),
      });
      connections.push(connection);
      return connection;
    };
    const checking = new CloudParticipantCache({ ...storage, uid: f.member.uid });
    let foreignCache;
    let pending;
    let stopSave;
    try {
      const bytes = createCanvas(2, 2).toBuffer('image/png');
      await f.library.edit(f.hero, {
        portraitImage: 'data:image/png;base64,' + bytes.toString('base64'),
      });
      const connection = create();
      await connection.open();
      const cached = await connection.cache.readCheckpoint(
        connection.access,
        connection.snapshot.viewKey
      );
      const reference = cached.manifest.images.find((slot) => slot.source === 'actor').reference;
      const historical = structuredClone(cached);
      historical.viewKey = 'c'.repeat(64);
      historical.access.seatId = randomUUID();
      historical.access.accessGeneration++;
      await connection.cache.writeCheckpoint(historical);
      await connection.cache.writeAsset(historical, reference, bytes);
      const other = await f.account();
      extraAccounts.push(other);
      const foreign = structuredClone(cached);
      foreign.access.uid = other.uid;
      foreignCache = new CloudParticipantCache({ ...storage, uid: other.uid });
      await foreignCache.writeCheckpoint(foreign);
      await foreignCache.writeAsset(foreign, reference, bytes);

      const assigned = await f.member.client.readAssignedCharacters(f.campaign.id, f.grant.access);
      const sheet = new CampaignCharacters({
        ...assigned,
        catalog: f.catalog,
        store: {
          commitCharacters: (id, change) =>
            f.member.client.commitAssignedCharacters(id, change, f.grant.access),
        },
      });
      let unconfirmed;
      const uncertain = new Promise((resolve) => {
        unconfirmed = resolve;
      });
      stopSave = f.member.client.subscribeSave((state) => {
        if (state.phase === 'uncertain') unconfirmed();
      });
      loseReply = true;
      let acknowledged = false;
      pending = sheet.edit(f.hero, { notes: 'Retained only for the original UID' });
      void pending.then(() => {
        acknowledged = true;
      });
      await uncertain;
      assert.equal(acknowledged, false);
      let disconnected;
      const lost = new Promise((resolve) => {
        disconnected = resolve;
      });
      connection.subscribe((event) => {
        if (event.type === 'live-status' && event.status.phase === 'reconnecting') disconnected();
      });
      network.setOffline(true);
      await lost;
      assert.equal(connection.commandReady, false);
      await assert.rejects(connection.call('playerCommand', [f.campaign.id, { kind: 'move' }]), {
        code: 'world-state-unavailable',
      });
      await assert.rejects(
        connection.call('playerCommit', [
          f.campaign.id,
          { ruleset: '2014', revision: assigned.revision, records: [] },
        ]),
        { code: 'world-state-unavailable' }
      );
      await sdk.signInWithCustomToken(
        f.member.auth,
        await f.runtime.auth.createCustomToken(other.uid)
      );
      f.member.client.connection.account.identity();
      await f.member.client.connection.privateStateSettled;
      await connection.close();
      assert.equal((await checking.getUsage()).bytes, 0);
      assert.equal(await checking.readCheckpointCandidate(cached.access), null);
      assert.equal(await checking.readAuthorizedAsset(cached, reference), null);
      assert.equal(await checking.readAuthorizedAsset(historical, reference), null);
      assert.deepEqual(await foreignCache.readCheckpoint(foreign.access, foreign.viewKey), foreign);
      assert.deepEqual(Buffer.from(await foreignCache.readAsset(foreign, reference)), bytes);
      assert.throws(() => connection.readLiveState());
      await assert.rejects(f.member.client.retryPending(), { code: 'account-changed' });
      assert.equal(f.member.client.saveState.phase, 'uncertain');
      assert.equal(acknowledged, false);
      assert.equal(bodies.length, 1);
      assert.equal(
        network.requests.filter(({ pathname }) => pathname.endsWith('/world-commands')).length,
        0
      );

      network.setOffline(false);
      await sdk.signInWithCustomToken(
        f.member.auth,
        await f.runtime.auth.createCustomToken(f.member.uid)
      );
      f.member.client.connection.account.identity();
      await f.member.client.connection.account.tokenContext(true);
      await f.member.client.retryPending();
      await pending;
      assert.equal(acknowledged, true);
      assert.equal(bodies.length, 2);
      assert.equal(bodies[0], bodies[1]);
      const canonical = await f.owner.client.readCharacters(f.campaign.id);
      assert.equal(canonical.revision, assigned.revision + 1);
      assert.equal(
        new CampaignCharacters({ ...canonical, catalog: f.catalog, store: f.owner.client }).get(
          f.hero
        ).notes,
        'Retained only for the original UID'
      );
      const rejoined = create();
      await rejoined.open();
      assert.equal(rejoined.commandReady, true);
      const current = await rejoined.cache.readCheckpoint(
        rejoined.access,
        rejoined.snapshot.viewKey
      );
      const worldRequest = playerMove(f, current);
      loseWorldReply = true;
      await assert.rejects(rejoined.call('playerCommand', [f.campaign.id, worldRequest.command]), {
        code: 'cloud-unavailable',
      });
      assert.equal(worldBodies.length, 1);
      network.setOffline(true);
      await sdk.signInWithCustomToken(
        f.member.auth,
        await f.runtime.auth.createCustomToken(other.uid)
      );
      f.member.client.connection.account.identity();
      await f.member.client.connection.privateStateSettled;
      await rejoined.close();
      assert.equal((await checking.getUsage()).bytes, 0);
      await assert.rejects(f.member.client.retryWorldCommand(), { code: 'account-changed' });
      assert.equal(worldBodies.length, 1);
      network.setOffline(false);
      await sdk.signInWithCustomToken(
        f.member.auth,
        await f.runtime.auth.createCustomToken(f.member.uid)
      );
      f.member.client.connection.account.identity();
      await f.member.client.connection.account.tokenContext(true);
      const worldReceipt = await f.member.client.retryWorldCommand();
      assert.equal(worldReceipt.outcome, 'duplicate');
      assert.equal(worldReceipt.presentation, null);
      assert.equal(worldBodies.length, 2);
      assert.equal(worldBodies[0], worldBodies[1]);
      assert.equal(rejoined.commandReady, false);
      assert.throws(() => rejoined.readLiveState());
      const acknowledgedCanonical = await f.owner.client.readCharacters(f.campaign.id);
      assert.equal(acknowledgedCanonical.sceneRevision, canonical.sceneRevision + 1);
      assert.equal(acknowledgedCanonical.revision, canonical.revision);
      assert.deepEqual(acknowledgedCanonical.records, canonical.records);
      const finalConnection = create();
      await finalConnection.open();
      await finalConnection.logout();
      assert.equal(f.member.client.connection.account.identity(), null);
      assert.equal((await checking.getUsage()).bytes, 0);
      const preserved = await f.owner.client.readCharacters(f.campaign.id);
      assert.deepEqual(preserved, acknowledgedCanonical);
      t.diagnostic(
        JSON.stringify({
          privateBytesAfterSwitch: 0,
          privateBytesAfterLogout: 0,
          originalCommandAttempts: bodies.length,
          originalWorldCommandAttempts: worldBodies.length,
          canonicalRevisionIncrements: 1,
          canonicalSceneIncrements: 1,
          offlineWorldCommands: 0,
        })
      );
    } finally {
      network.setOffline(false);
      stopSave?.();
      if (f.member.client.pending || f.member.client.pendingWorld) {
        await sdk.signInWithCustomToken(
          f.member.auth,
          await f.runtime.auth.createCustomToken(f.member.uid)
        );
        f.member.client.connection.account.identity();
        if (f.member.client.pending) await f.member.client.retryPending();
        if (f.member.client.pendingWorld) await f.member.client.retryWorldCommand();
        await pending;
      }
      checking.close();
      foreignCache?.close();
      await cleanParticipantFixture(f, storage, connections, extraAccounts);
    }
  }
);

test(
  'authoritative cold and warm SDK rejoin downloads zero unchanged graphic or private image bodies and recovers a corrupt graphic candidate online',
  { timeout: 120000 },
  async (t) => {
    const network = participantNetwork();
    const f = await fixture(t, { memberFetch: network.fetch });
    const storage = participantBrowserStorage();
    const connections = [];
    let gate;
    const open = (access = f.grant.access) => {
      const connection = new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access,
        sessionId: f.live.sessionId,
        cache: new CloudParticipantCache({ ...storage, uid: f.member.uid }),
      });
      connections.push(connection);
      return connection;
    };
    try {
      const bytes = createCanvas(2, 2).toBuffer('image/png');
      const reserveBytes = createCanvas(3, 2).toBuffer('image/png');
      const image = (value) => 'data:image/png;base64,' + value.toString('base64');
      await f.library.edit(f.hero, { portraitImage: image(bytes) });
      const reserve = await f.library.create('On-demand assigned reserve');
      await f.library.edit(reserve, { portraitImage: image(reserveBytes) });
      const hidden = await f.library.create('PRIVATE warm-cache unassigned');
      await f.library.edit(hidden, {
        portraitImage: image(createCanvas(4, 2).toBuffer('image/png')),
      });
      await f.owner.client.assignCharacter(f.campaign.id, {
        seatId: f.grant.access.seatId,
        accessGeneration: f.grant.access.accessGeneration,
        characterId: reserve,
        assigned: true,
      });
      let current = await f.member.client.getParticipantAccess(f.campaign.id);
      const cold = open(current.access);
      const coldState = await cold.open();
      assert.equal(cold.commandReady, true);
      assert.equal(network.graphics.length, 1);
      assert.deepEqual(network.images, [
        {
          bytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        },
      ]);
      const coldCheckpoint = await cold.cache.readCheckpoint(cold.access, cold.snapshot.viewKey);
      assert.equal(coldCheckpoint.state.publicScene.assetKey, network.graphics[0].sha256);
      assert.equal(coldCheckpoint.state.publicScene.actors[0].portraitImage, null);
      assert.deepEqual(coldCheckpoint.state.publicScene.updates, []);
      await cold.close();
      await f.library.edit(reserve, { notes: 'Fresh authorized reserve revision' });
      current = await f.member.client.getParticipantAccess(f.campaign.id);
      assert.deepEqual(current.access, coldCheckpoint.access);
      const head = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
      const before = (await head.get()).data();
      const campaign = await f.owner.client.get(f.campaign.id);
      const settings = await f.owner.client.getSettings(f.campaign.id);
      const live = await f.owner.client.getLiveSession(f.campaign.id);
      const start = {
        images: network.images.length,
        graphics: network.graphics.length,
        requests: network.requests.length,
      };
      const warm = open(current.access);
      gate = network.holdNextState();
      const joining = warm.open();
      await gate.entered;
      assert.equal(warm.commandReady, false);
      assert.throws(() => warm.readLiveState(), { code: 'live-session-changed' });
      await assert.rejects(warm.call('playerCommand', [f.campaign.id, { kind: 'move' }]), {
        code: 'world-state-unavailable',
      });
      gate.release();
      const warmState = await joining;
      assert.equal(warm.commandReady, true);
      assert.deepEqual(warm.snapshot.access, current.access);
      assert.equal(warm.snapshot.sessionId, f.live.sessionId);
      assert.equal(warm.snapshot.generation, before.generation);
      assert.equal(warmState.revision, campaign.charactersRevision);
      assert.equal(warmState.sceneRevision, campaign.sceneRevision);
      assert.equal(warm.snapshot.viewKey, coldCheckpoint.viewKey);
      assert.equal(warmState.publicScene.assetKey, coldState.publicScene.assetKey);
      assert.deepEqual(warmState.publicScene.updates, []);
      assert.deepEqual(warmState.gameplay, coldState.gameplay);
      assert.equal(network.images.length - start.images, 0);
      assert.equal(network.graphics.length - start.graphics, 0);
      const authority = network.requests
        .slice(start.requests)
        .filter(({ pathname }) => /\/(participant-state|events)$/.test(pathname));
      assert.equal(authority.length, 2);
      for (const request of authority) {
        assert.equal(request.body.sessionId, f.live.sessionId);
        assert.equal(request.body.observerTokenId, 'token-1');
        assert.equal(request.body.assetKey, coldState.publicScene.assetKey);
        assert.equal(request.seatId, current.access.seatId);
        assert.equal(request.accessGeneration, String(current.access.accessGeneration));
      }
      assert.equal(warm.characterImages(reserve), null);
      await warm.loadCharacterImages(reserve);
      assert.deepEqual(network.images.slice(start.images), [
        {
          bytes: reserveBytes.length,
          sha256: createHash('sha256').update(reserveBytes).digest('hex'),
        },
      ]);
      assert.equal(warm.characterImages(hidden), null);
      const saved = await warm.cache.readCheckpoint(warm.access, warm.snapshot.viewKey);
      assert.equal(JSON.stringify(saved).includes('base64,'), false);
      assert.equal(JSON.stringify(saved).includes('PRIVATE warm-cache unassigned'), false);
      await warm.close();
      const writer = new CloudParticipantCache({ ...storage, uid: f.member.uid });
      const corrupted = structuredClone(saved);
      corrupted.state.publicScene.assets.maps[0].terrain.heights[0][0]++;
      try {
        await writer.deleteCheckpoint(coldCheckpoint.access, coldCheckpoint.viewKey);
        await writer.writeCheckpoint(corrupted);
      } finally {
        writer.close();
      }
      const recoveryStart = { images: network.images.length, graphics: network.graphics.length };
      const recovered = open(current.access);
      const statuses = [];
      recovered.subscribe((event) => statuses.push(event));
      await recovered.open();
      assert.equal(recovered.commandReady, true);
      assert.equal(network.graphics.length - recoveryStart.graphics, 1);
      assert.equal(network.images.length - recoveryStart.images, 1);
      assert.ok(
        statuses.some(
          (event) =>
            event.type === 'assets-status' && event.progress?.cache?.code === 'cache-corrupt'
        )
      );
      assert.deepEqual((await head.get()).data(), before);
      assert.deepEqual(await f.owner.client.getSettings(f.campaign.id), settings);
      assert.deepEqual(await f.owner.client.getLiveSession(f.campaign.id), live);
      assert.equal(
        network.requests.filter(({ pathname }) => pathname.endsWith('/world-commands')).length,
        0
      );
      t.diagnostic(
        `cold graphics=1/${network.graphics[0].bytes}B images=1/${network.images[0].bytes}B; warm graphics=0/0B images=0/0B HTTP/SSE=2; on-demand images=1; corrupt graphics=1 images=1; SHA256=${network.images[0].sha256}`
      );
    } finally {
      gate?.release();
      await cleanParticipantFixture(f, storage, connections);
    }
  }
);

test(
  'warm SDK rejoin recovers corrupt or evicted bytes and stale schema while current references, access and epoch remain authoritative',
  { timeout: 120000 },
  async (t) => {
    const network = participantNetwork();
    const f = await fixture(t, { memberFetch: network.fetch });
    const storage = participantBrowserStorage();
    const connections = [];
    const extraAccounts = [];
    const measured = [];
    const create = ({
      access = f.grant.access,
      sessionId = f.live.sessionId,
      identity = f.member,
    } = {}) => {
      const connection = new CloudPlayerSessionConnection({
        store: identity.client,
        campaignId: f.campaign.id,
        access,
        sessionId,
        cache: new CloudParticipantCache({ ...storage, uid: identity.uid }),
      });
      connections.push(connection);
      return connection;
    };
    const rejoin = async (kind, expected) => {
      const start = { graphics: network.graphics.length, images: network.images.length };
      const connection = create();
      const events = [];
      connection.subscribe((event) => events.push(event));
      await connection.open();
      const actual = {
        graphics: network.graphics.length - start.graphics,
        images: network.images.length - start.images,
      };
      assert.deepEqual(actual, expected);
      assert.equal(connection.commandReady, true);
      assert.deepEqual(connection.readLiveState().publicScene.updates, []);
      measured.push({ kind, ...actual });
      return { connection, events };
    };
    try {
      const bytes = createCanvas(2, 2).toBuffer('image/png');
      await f.library.edit(f.hero, {
        portraitImage: 'data:image/png;base64,' + bytes.toString('base64'),
      });
      const cold = create();
      const initial = await cold.open();
      let saved = await cold.cache.readCheckpoint(cold.access, cold.snapshot.viewKey);
      const reference = saved.manifest.images.find((slot) => slot.source === 'actor').reference;
      await cold.close();
      const entry = [...storage.entries].find(([url]) => url.endsWith('/' + reference.sha256))[1];
      entry.bytes[0] ^= 1;
      const corrupt = await rejoin('binary-corrupt', { graphics: 0, images: 1 });
      assert.ok(
        corrupt.events.some(
          (event) =>
            event.type === 'assets-status' &&
            event.progress?.cache?.code === 'cache-asset-integrity'
        )
      );
      assert.equal(network.images.at(-1).sha256, reference.sha256);
      saved = await corrupt.connection.cache.readCheckpoint(
        corrupt.connection.access,
        corrupt.connection.snapshot.viewKey
      );
      await corrupt.connection.close();
      const editor = new CloudParticipantCache({ ...storage, uid: f.member.uid });
      try {
        await editor.deleteAsset(saved, reference);
      } finally {
        editor.close();
      }
      const evicted = await rejoin('binary-evicted', { graphics: 0, images: 1 });
      await evicted.connection.close();
      const database = await openDatabase(
        storage.indexedDB,
        'taverntable.cloud.participants.v1',
        () => {},
        2
      );
      try {
        await transact(database, ['checkpoints'], 'readwrite', async (transaction) => {
          const checkpoints = transaction.objectStore('checkpoints');
          const [row] = await requestResult(checkpoints.getAll());
          const payload = JSON.parse(row.payload);
          payload.manifest.version = 0;
          row.payload = JSON.stringify(payload);
          row.bytes = Buffer.byteLength(row.payload);
          row.sha256 = createHash('sha256').update(row.payload).digest('hex');
          await requestResult(checkpoints.put(row));
        });
      } finally {
        database.close();
      }
      const stale = await rejoin('schema-stale', { graphics: 1, images: 1 });
      assert.ok(
        stale.events.some(
          (event) =>
            event.type === 'assets-status' && event.progress?.cache?.code === 'cache-corrupt'
        )
      );
      assert.equal(
        (
          await stale.connection.cache.readCheckpoint(
            stale.connection.access,
            stale.connection.snapshot.viewKey
          )
        ).manifest.version,
        1
      );
      await stale.connection.close();
      const replacementBytes = createCanvas(3, 3).toBuffer('image/png');
      await f.library.edit(f.hero, {
        portraitImage: 'data:image/png;base64,' + replacementBytes.toString('base64'),
      });
      const replaced = await rejoin('reference-changed', { graphics: 0, images: 1 });
      assert.deepEqual(network.images.at(-1), {
        bytes: replacementBytes.length,
        sha256: createHash('sha256').update(replacementBytes).digest('hex'),
      });
      assert.deepEqual(replaced.connection.readLiveState().gameplay, initial.gameplay);
      await replaced.connection.close();
      await f.owner.client.assignCharacter(f.campaign.id, {
        seatId: f.grant.access.seatId,
        accessGeneration: f.grant.access.accessGeneration,
        characterId: f.npc,
        assigned: true,
      });
      const current = await f.member.client.getParticipantAccess(f.campaign.id);
      const beforeDenied = { graphics: network.graphics.length, images: network.images.length };
      const denied = create();
      await assert.rejects(denied.open(), { code: 'campaign-access-changed' });
      assert.equal(denied.commandReady, false);
      await denied.close();
      const purged = new CloudParticipantCache({ ...storage, uid: f.member.uid });
      try {
        assert.equal((await purged.getUsage()).bytes, 0);
      } finally {
        purged.close();
      }
      const ended = create({ access: current.access, sessionId: randomUUID() });
      await assert.rejects(ended.open(), { code: 'live-session-changed' });
      assert.equal(ended.commandReady, false);
      const other = await f.account(network.fetch);
      extraAccounts.push(other);
      const foreign = create({ access: { ...current.access, uid: other.uid }, identity: other });
      await assert.rejects(foreign.open(), { code: 'campaign-not-found' });
      assert.equal(foreign.commandReady, false);
      assert.deepEqual(
        {
          graphics: network.graphics.length - beforeDenied.graphics,
          images: network.images.length - beforeDenied.images,
        },
        { graphics: 0, images: 0 }
      );
      assert.equal(
        network.requests.filter(({ pathname }) => pathname.endsWith('/world-commands')).length,
        0
      );
      await f.owner.client.assignCharacter(f.campaign.id, {
        seatId: current.access.seatId,
        accessGeneration: current.access.accessGeneration,
        characterId: f.hero,
        assigned: false,
      });
      const reassigned = await f.member.client.getParticipantAccess(f.campaign.id);
      const hintStart = {
        graphics: network.graphics.length,
        images: network.images.length,
        requests: network.requests.length,
      };
      const fresh = create({ access: reassigned.access });
      const selected = await fresh.open();
      assert.equal(fresh.commandReady, true);
      assert.equal(selected.observerTokenId, 'token-2');
      assert.deepEqual(selected.profile.characterIds, [f.npc]);
      assert.equal(fresh.characterImages(f.hero), null);
      assert.equal(
        network.requests
          .slice(hintStart.requests)
          .filter(({ pathname }) => pathname.endsWith('/participant-state')).length,
        1
      );
      assert.deepEqual(
        {
          graphics: network.graphics.length - hintStart.graphics,
          images: network.images.length - hintStart.images,
        },
        { graphics: 1, images: 1 }
      );
      measured.push({ kind: 'membership-scope-purged', graphics: 1, images: 1 });
      assert.equal(
        (await f.owner.client.getLiveSession(f.campaign.id)).sessionId,
        f.live.sessionId
      );
      t.diagnostic(
        JSON.stringify({
          recovery: measured,
          denied: ['current-access', 'live-epoch', 'managed-UID'],
          commands: 0,
        })
      );
    } finally {
      await cleanParticipantFixture(f, storage, connections, extraAccounts);
    }
  }
);

test(
  'the cloud player connection publishes native public state and returns an authoritative command without another snapshot request',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    let snapshots = 0;
    const readSnapshot = f.member.client.readParticipantSnapshot.bind(f.member.client);
    f.member.client.readParticipantSnapshot = (...args) => {
      snapshots++;
      return readSnapshot(...args);
    };
    const { default: CloudPlayerSessionConnection } = await import(
      '../../src/campaigns/CloudPlayerSessionConnection.js'
    );
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    const initial = await connection.open({ observerTokenId: 'token-1' });
    assert.equal(initial.profile.role, 'player');
    assert.equal(initial.profile.campaignId, f.campaign.id);
    assert.deepEqual(initial.profile.characterIds, [f.hero]);
    const updates = [];
    const stop = connection.subscribe((event) => updates.push(event));
    const request = playerMove(f, { state: initial });
    const result = await connection.call('playerCommand', [f.campaign.id, request.command]);
    assert.equal(result.outcome, 'applied');
    assert.equal(result.receipt.kind, 'move');
    assert.equal(result.receipt.tokenId, 'token-1');
    assert.equal(result.receipt.costFeet, 5);
    assert.equal(result.state.publicScene.updates.length, 0);
    assert.equal(result.state.publicScene.actors.find((actor) => actor.id === 'token-1').gridX, 2);
    assert.ok(
      updates.some(
        (event) =>
          event.type === 'state' &&
          event.state.publicScene.updates[0]?.commandId === request.command.commandId
      )
    );
    assert.equal(snapshots, 0);
    const duplicate = await connection.call('playerCommand', [f.campaign.id, request.command]);
    assert.equal(duplicate.outcome, 'duplicate');
    assert.equal(duplicate.receipt.motion, undefined);
    await f.owner.client.controlLiveSession(
      f.campaign.id,
      'end',
      await f.owner.client.getLiveSession(f.campaign.id)
    );
    await connection.done;
    assert.ok(
      updates.some((event) => event.type === 'live-status' && event.status.phase === 'paused')
    );
    stop();
  }
);

test(
  'a cloud player retains two unrendered accepted steps as one continuous route with the final combat budget',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const storage = participantBrowserStorage();
    t.after(() => clearParticipantStorage(storage, f.member.uid));
    const native = gameplayRuntime(f.scene, f.library);
    await native.combat.startTurn(native.actors.find((actor) => actor.id === 'token-1'));
    const combat = structuredClone(f.scene);
    combat.combat = native.combat.snapshot();
    await f.owner.client.commitScene(f.campaign.id, {
      ruleset: '2014',
      revision: 1,
      charactersRevision: f.library.revision,
      scene: encodeScene(combat, f.validation),
    });
    const {
      default: CloudPlayerSessionConnection,
    } = require('../../src/campaigns/CloudPlayerSessionConnection.js');
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
        cache: new CloudParticipantCache({ ...storage, uid: f.member.uid }),
      })
    );
    const initial = await connection.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const first = await connection.call('playerCommand', [
      f.campaign.id,
      playerMove(f, { state: initial }).command,
    ]);
    const secondRequest = playerMove(
      f,
      { state: first.state },
      { mapId: 'map-main', gridX: 2, gridY: 2 }
    );
    const second = await connection.call('playerCommand', [f.campaign.id, secondRequest.command]);
    const pending = connection.readLiveState(initial.sceneRevision);
    assert.equal(pending.publicScene.updates.length, 1);
    const movement = pending.publicScene.updates[0];
    assert.deepEqual(movement.motion.from.pose.world, { x: 1.5, y: 0, z: 1.5 });
    assert.deepEqual(
      movement.motion.route.map((step) => [step.gridX, step.gridY]),
      [
        [2, 1],
        [2, 2],
      ]
    );
    assert.equal(movement.costFeet, 10);
    assert.equal(movement.budget.movementSpentFeet, 10);
    assert.equal(pending.gameplay.ownedTokens[0].movement.spentFeet, 10);
    connection.acknowledgeState(second.state.sceneRevision);
    assert.deepEqual(connection.readLiveState(initial.sceneRevision).publicScene.updates, []);
  }
);

test(
  'an owner receives a player route with a contiguous sparse private world delta rather than a new terrain body',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const events = await f.openOwner();
    const initial = (await events.next()).value;
    assert.equal(initial.kind, 'owner-checkpoint');
    assert.equal(initial.checkpoint.access.role, 'owner');
    assert.ok(initial.checkpoint.state.records.some((row) => row.key.endsWith(f.npc)));
    const observed = Promise.withResolvers();
    const observation = await f.observeOwner({
      onState: (checkpoint, context) => {
        if (!context.reconcile) observed.resolve({ checkpoint, context });
      },
      onStatus: () => {},
    });
    await observation.ready;
    const current = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      },
      f.grant.access
    );
    const request = playerMove(f, current);
    const accepted = await publishPlayer(f, request);
    assert.equal(accepted.status, 200);
    const update = (await events.next()).value;
    assert.equal(update.kind, 'owner-delta');
    assert.equal(update.delta.baseGeneration, initial.checkpoint.generation);
    assert.equal(update.delta.generation, initial.checkpoint.generation + 1);
    assert.equal(update.delta.presentations[0].commandId, request.command.commandId);
    assert.ok(!JSON.stringify(update.delta.changes).includes('heights'));
    const { applyCloudOwnerDelta } = await import('../../src/campaigns/CloudOwnerProtocol.js');
    const applied = applyCloudOwnerDelta(initial.checkpoint, update.delta);
    const scene = JSON.parse(applied.state.scene);
    assert.equal(scene.creatures.find((actor) => actor.id === 'token-1').gridX, 2);
    assert.equal(applied.state.sceneRevision, accepted.body.result.applied.sceneRevision);
    assert.deepEqual(applied.state, await f.owner.client.readCharacters(f.campaign.id));
    const managed = await observed.promise;
    assert.deepEqual(managed.context.presentations, update.delta.presentations);
    assert.deepEqual(managed.checkpoint.state, applied.state);
    assert.equal(managed.context.origin.commandId, request.command.commandId);
    await f.owner.client.controlLiveSession(
      f.campaign.id,
      'end',
      await f.owner.client.getLiveSession(f.campaign.id)
    );
    assert.equal((await events.next()).value.code, 'live-session-paused');
    await observation.done;
  }
);

for (const ruleset of ['2014', '2024']) {
  test(
    `a ${ruleset} off-turn member cannot move but an owner Free Play transition immediately restores native assigned movement`,
    { timeout: 60000 },
    async (t) => {
      const f = await fixture(t, { ruleset });
      const combat = structuredClone(f.scene);
      const native = gameplayRuntime(f.scene, f.library);
      await native.combat.startTurn(native.actors.find((actor) => actor.id === 'token-2'));
      combat.combat = native.combat.snapshot();
      await f.owner.client.commitScene(f.campaign.id, {
        ruleset,
        revision: 1,
        charactersRevision: f.library.revision,
        scene: encodeScene(combat, f.validation),
      });
      const view = {
        sessionId: f.live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      };
      const blocked = await f.member.client.readParticipantSnapshot(
        f.campaign.id,
        view,
        f.grant.access
      );
      assert.equal(blocked.state.gameplay.ownedTokens[0].availability.move.allowed, false);
      const before = await f.owner.client.readCharacters(f.campaign.id);
      const denied = await publishPlayer(f, playerMove(f, blocked));
      assert.equal(denied.status, 422);
      assert.equal(denied.body.code, 'not-your-turn');
      assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), before);
      const freeplay = JSON.parse(before.scene);
      freeplay.combat = { ...freeplay.combat, active: false, activeTokenId: null, states: [] };
      await f.owner.client.commitScene(f.campaign.id, {
        ruleset,
        revision: before.sceneRevision,
        charactersRevision: before.revision,
        scene: encodeScene(freeplay, f.validation),
      });
      const current = await f.member.client.readParticipantSnapshot(
        f.campaign.id,
        view,
        f.grant.access
      );
      assert.equal(current.state.gameplay.turn, null);
      assert.equal(current.state.gameplay.ownedTokens[0].availability.move.allowed, true);
      const accepted = await publishPlayer(f, playerMove(f, current));
      assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
      const after = await f.member.client.readParticipantSnapshot(
        f.campaign.id,
        view,
        f.grant.access
      );
      assert.deepEqual(after.state.gameplay.ownedTokens[0].movement, {
        spentFeet: 0,
        remainingFeet: 30,
        allowanceFeet: 30,
      });
    }
  );
}

test(
  'competing member movement intents publish exactly one canonical scene and one journal generation',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const view = {
      sessionId: f.live.sessionId,
      observerTokenId: 'token-1',
      mapId: 'map-main',
      assetKey: null,
    };
    const initial = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      view,
      f.grant.access
    );
    const first = playerMove(f, initial);
    const second = playerMove(f, initial, { mapId: 'map-main', gridX: 1, gridY: 2 });
    const results = await Promise.all([publishPlayer(f, first), publishPlayer(f, second)]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);
    assert.equal(results.find((result) => result.status === 409).body.code, 'stale-revision');
    const head = await f.runtime.firestore.collection('campaigns').doc(f.campaign.id).get();
    assert.equal(head.data().generation, initial.generation + 1);
    const receipts = await f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(f.member.uid))
      .collection('receipts')
      .get();
    assert.equal(receipts.docs.filter((row) => row.data().kind === 'world.command').length, 1);
    const latest = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      view,
      f.grant.access
    );
    assert.equal(latest.generation, initial.generation + 1);
    assert.deepEqual(latest.state.gameplay.ownedTokens[0].movement, {
      spentFeet: 0,
      remainingFeet: 30,
      allowanceFeet: 30,
    });
  }
);

test(
  'membership removal after a staged player route prevents scene, cost and command-receipt publication',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const initial = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      },
      f.grant.access
    );
    const request = playerMove(f, initial);
    const before = await f.owner.client.readCharacters(f.campaign.id);
    const uploaded = Promise.withResolvers();
    const release = Promise.withResolvers();
    const stage = f.store.objects.stage.bind(f.store.objects);
    f.store.objects.stage = async (...args) => {
      const object = await stage(...args);
      if (args[1] === 'presentations') {
        uploaded.resolve();
        await release.promise;
      }
      return object;
    };
    const pending = publishPlayer(f, request);
    try {
      await uploaded.promise;
      await f.owner.client.removeMember(f.campaign.id, {
        seatId: f.grant.access.seatId,
        accessGeneration: f.grant.access.accessGeneration,
      });
      release.resolve();
      const denied = await pending;
      assert.equal(denied.status, 404);
      assert.equal(denied.body.code, 'campaign-not-found');
      assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), before);
      const receipt = await f.runtime.firestore
        .collection('accountCommands')
        .doc(pilotAccountKey(f.member.uid))
        .collection('receipts')
        .doc(request.command.commandId)
        .get();
      assert.equal(receipt.exists, false);
    } finally {
      release.resolve();
      await pending;
    }
  }
);

test(
  'an assigned freeplay movement uses native authority and same-ID retry cannot spend or publish twice',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const events = await f.openMember();
    const initial = (await events.next()).value.checkpoint;
    assert.equal(initial.state.gameplay.turn, null);
    const command = {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: initial.state.sceneRevision,
      charactersRevision: initial.state.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
      view: { mapId: 'map-main', assetKey: initial.state.publicScene.assetKey },
    };
    const send = () =>
      fetch(`${f.api.url}/api/cloud/campaigns/${f.campaign.id}/world-commands`, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + f.member.token,
          Origin: f.api.origin,
          'Content-Type': 'application/json',
          'X-TavernTable-Seat': f.grant.access.seatId,
          'X-TavernTable-Access-Generation': String(f.grant.access.accessGeneration),
        },
        body: JSON.stringify({ sessionId: f.live.sessionId, command }),
      });
    const applied = await send();
    assert.equal(applied.status, 200);
    const receipt = (await applied.json()).result;
    assert.equal(receipt.outcome, 'applied');
    assert.equal(receipt.commandId, command.commandId);
    assert.equal(receipt.applied.generation, initial.generation + 1);
    const update = (await events.next()).value;
    assert.equal(update.kind, 'delta');
    assert.equal(update.delta.presentations[0].commandId, command.commandId);
    assert.equal(update.delta.presentations[0].costFeet, 5);
    const current = applyCloudParticipantDelta(initial, update.delta);
    assert.deepEqual(current.state.gameplay.ownedTokens[0].movement, {
      spentFeet: 0,
      remainingFeet: 30,
      allowanceFeet: 30,
    });
    const beforeRetry = await f.owner.client.readCharacters(f.campaign.id);
    const retried = await send();
    assert.equal(retried.status, 200);
    const duplicate = (await retried.json()).result;
    assert.equal(duplicate.outcome, 'duplicate');
    assert.deepEqual(duplicate.applied, receipt.applied);
    assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), beforeRetry);
    const head = await f.runtime.firestore.collection('campaigns').doc(f.campaign.id).get();
    assert.equal(head.data().generation, initial.generation + 1);
    const actor = JSON.parse(beforeRetry.scene).creatures.find((entry) => entry.id === 'token-1');
    assert.equal(actor.gridX, 2);
    await f.owner.client.controlLiveSession(
      f.campaign.id,
      'end',
      await f.owner.client.getLiveSession(f.campaign.id)
    );
    assert.equal((await events.next()).value.code, 'live-session-paused');
    await f.owner.client.removeMember(f.campaign.id, {
      seatId: f.grant.access.seatId,
      accessGeneration: f.grant.access.accessGeneration,
    });
    const backupWork = t.mock.method(f.store, 'runAssignedBackupWork');
    const changeWork = t.mock.method(f.store, 'runChangeMaintenance');
    const historical = await send();
    assert.equal(historical.status, 200);
    assert.deepEqual((await historical.json()).result, {
      ...receipt,
      outcome: 'duplicate',
      presentation: null,
    });
    assert.equal(backupWork.mock.calls.length, 0);
    assert.equal(changeWork.mock.calls.length, 0);
    await assert.rejects(
      f.member.client.readParticipantSnapshot(
        f.campaign.id,
        {
          sessionId: f.live.sessionId,
          observerTokenId: 'token-1',
          mapId: 'map-main',
          assetKey: null,
        },
        f.grant.access
      ),
      { status: 404, code: 'campaign-not-found' }
    );
  }
);

test(
  'cloud native takeoff, airborne steps, elevation and fall deliver owner routes with one canonical movement debit',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { ruleset: '2024' });
    await f.library.edit(f.hero, { fallTraits: { flySpeed: 60, hover: true } });
    const native = gameplayRuntime(f.scene, f.library);
    await native.combat.startTurn(native.actors.find((actor) => actor.id === 'token-1'));
    const combat = structuredClone(f.scene);
    combat.combat = native.combat.snapshot();
    await f.owner.client.commitScene(f.campaign.id, {
      ruleset: '2024',
      revision: 1,
      charactersRevision: f.library.revision,
      scene: encodeScene(combat, f.validation),
    });
    const events = await f.openOwner();
    assert.equal((await events.next()).value.kind, 'owner-checkpoint');
    let current = await f.owner.client.readCharacters(f.campaign.id);
    for (const [kind, payload, motionKind, spent] of [
      ['flight.takeoff', {}, 'fly', 5],
      ['move', { target: { mapId: 'map-main', gridX: 2, gridY: 1 } }, 'fly', 10],
      ['flight.raise', { feet: 10 }, 'fly', 20],
      ['flight.drop', { useSlowFall: false }, 'fall', 20],
    ]) {
      const command = {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: current.sceneRevision,
        charactersRevision: current.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind,
        payload,
        view: { mapId: 'map-main', assetKey: null },
      };
      const accepted = await f.member.client.commitWorldCommand(
        f.campaign.id,
        {
          sessionId: f.live.sessionId,
          command,
        },
        f.grant.access
      );
      assert.equal(accepted.presentation.motion.kind, motionKind);
      const received = (await events.next()).value;
      assert.equal(received.kind, 'owner-delta');
      assert.equal(received.delta.presentations[0].commandId, command.commandId);
      assert.equal(received.delta.presentations[0].motion.kind, motionKind);
      current = await f.owner.client.readCharacters(f.campaign.id);
      assert.equal(JSON.parse(current.scene).combat.states[0].movementSpent, spent);
    }
    const actor = JSON.parse(current.scene).creatures.find((entry) => entry.id === 'token-1');
    assert.equal(actor.pose.kind, 'ground');
    assert.equal(actor.pose.world.y, 0);
    const character = new CampaignCharacters({ ...current, catalog: f.catalog }).get(f.hero);
    assert.equal(character.lastFall.distanceFeet, 15);
    assert.equal(character.conditions.includes('prone'), true);
  }
);

test(
  'native player dice are authoritative and transient, and same-ID recovery never returns or persists old physical frames',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const initial = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      },
      f.grant.access
    );
    const request = playerMove(f, initial);
    request.command.kind = 'roll';
    request.command.payload = {
      expression: '1d20+2',
      label: 'Cloud physical check',
      mode: 'normal',
    };
    const applied = await f.member.client.commitWorldCommand(
      f.campaign.id,
      request,
      f.grant.access
    );
    assert.equal(applied.outcome, 'applied');
    assert.equal(applied.presentation.kind, 'roll');
    const rolled = applied.presentation.roll;
    assert.equal(rolled.physical, true);
    assert.ok(rolled.physics.length >= 1);
    for (const physical of rolled.physics) {
      assert.equal(physical.type, 'physical-d20');
      assert.ok(physical.frames.length > 20);
      if (physical.cocked) assert.equal(rolled.cancelled, true);
      else
        assert.ok(Number.isInteger(physical.value) && physical.value >= 1 && physical.value <= 20);
    }
    const current = await f.owner.client.readCharacters(f.campaign.id);
    const replay = await f.member.client.commitWorldCommand(f.campaign.id, request, f.grant.access);
    assert.deepEqual(replay, { ...applied, outcome: 'duplicate', presentation: null });
    assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), current);
    const stored = await f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(f.member.uid))
      .collection('receipts')
      .doc(request.command.commandId)
      .get();
    assert.equal(stored.exists, true);
    assert.equal(JSON.stringify(stored.data()).includes('"physics"'), false);
    assert.equal(current.scene.includes('"physics"'), false);
  }
);

test(
  'player world intents cannot claim a foreign actor, observer, role or movement cost',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const initial = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      },
      f.grant.access
    );
    const before = await f.owner.client.readCharacters(f.campaign.id);
    for (const [changes, status, code] of [
      [{ tokenId: 'token-2', observerTokenId: 'token-2' }, 403, 'actor-forbidden'],
      [{ observerTokenId: 'token-2' }, 403, 'actor-forbidden'],
      [{ role: 'dm' }, 400, 'invalid-command'],
      [
        { payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 }, costFeet: 0 } },
        400,
        'invalid-command',
      ],
    ]) {
      const request = playerMove(f, initial);
      Object.assign(request.command, changes);
      const rejected = await publishPlayer(f, request);
      assert.equal(rejected.status, status);
      assert.equal(rejected.body.code, code);
      assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), before);
      const stored = await f.runtime.firestore
        .collection('accountCommands')
        .doc(pilotAccountKey(f.member.uid))
        .collection('receipts')
        .doc(request.command.commandId)
        .get();
      assert.equal(stored.exists, false);
    }
  }
);

test(
  'owner world bodies and streams deny member/unrelated identities, wrong scope, epoch and origin before private body I/O',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const stranger = await f.account();
    const read = t.mock.method(f.store.objects, 'read');
    for (const operation of ['owner-state', 'owner-events']) {
      for (const [options, status, code] of [
        [
          {
            identity: f.member,
            seatId: f.grant.access.seatId,
            accessGeneration: f.grant.access.accessGeneration,
          },
          400,
          operation === 'owner-events' ? 'invalid-participant-request' : 'invalid-access-scope',
        ],
        [{ identity: f.member }, 409, 'campaign-access-changed'],
        [{ identity: stranger }, 404, 'campaign-not-found'],
        [{ sessionId: randomUUID() }, 409, 'live-session-changed'],
        [{ origin: 'https://unrelated.example.invalid' }, 403, 'origin-not-allowed'],
      ]) {
        const response = await ownerRequest(f, { operation, ...options });
        assert.equal(response.status, status);
        const body = await response.json();
        assert.equal(body.code, code);
        assert.equal(Object.hasOwn(body, 'result'), false);
        assert.equal(Object.hasOwn(body, 'state'), false);
      }
    }
    assert.equal(read.mock.calls.length, 0);
  }
);

test(
  'owner eligibility revoked during canonical body loading fences the private world checkpoint after I/O',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const read = f.store.objects.read.bind(f.store.objects);
    let disabled = false;
    f.store.objects.read = async (...args) => {
      const value = await read(...args);
      if (args[1] === 'scene' && !disabled) {
        disabled = true;
        await f.runtime.firestore
          .collection('pilotAccounts')
          .doc(pilotAccountKey(f.owner.uid))
          .update({ enabled: false });
      }
      return value;
    };
    const response = await ownerRequest(f);
    assert.equal(disabled, true);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'pilot-access-required');
    assert.equal(Object.hasOwn(body, 'result'), false);
    assert.equal(Object.hasOwn(body, 'state'), false);
  }
);

test(
  'an owner native route is published with its atomic scene commit and delivered only as a live scoped member presentation',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const events = await f.openMember();
    const checkpoint = (await events.next()).value.checkpoint;
    const observed = Promise.withResolvers();
    const observation = f.observeMember({
      onState: (state, context) => {
        if (!context.reconcile) observed.resolve({ state, context });
      },
      onStatus: () => {},
    });

    await observation.ready;
    const next = structuredClone(f.scene);
    const guide = next.creatures.find((actor) => actor.id === 'token-2');
    const from = sceneActorPlacement(
      f.scene,
      f.scene.creatures.find((actor) => actor.id === guide.id)
    );
    guide.gridY = 2;
    guide.pose.world.z = 2.5;
    const route = {
      commandId: randomUUID(),
      tokenId: guide.id,
      kind: 'move',
      motion: { kind: 'walk', completed: true, from, route: [sceneActorPlacement(next, guide)] },
    };
    const response = await fetch(`${f.api.url}/api/cloud/campaigns/${f.campaign.id}/scene`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + f.owner.token,
        Origin: f.api.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commandId: randomUUID(),
        sessionId: f.live.sessionId,
        presentations: [route],
        change: {
          ruleset: '2014',
          revision: 1,
          charactersRevision: f.library.revision,
          scene: encodeScene(next, f.validation),
        },
      }),
    });
    const acknowledgement = await response.json();
    assert.equal(response.status, 200, JSON.stringify(acknowledgement));
    const changed = (await events.next()).value;
    assert.equal(changed.kind, 'delta');
    assert.equal(changed.delta.kind, 'update');
    assert.deepEqual(changed.delta.presentations, [
      {
        ...route,
        sceneRevision: 2,
        charactersRevision: f.library.revision,
      },
    ]);
    const applied = applyCloudParticipantDelta(checkpoint, changed.delta);
    assert.equal(applied.state.publicScene.actors.find((actor) => actor.id === guide.id).gridY, 2);
    assert.equal(applied.state.publicScene.updates.length, 0);
    assert.equal(
      applied.state.publicScene.actors.find((actor) => actor.id === guide.id).characterId,
      null
    );
    assert.equal(changed.delta.presentations[0].budget, undefined);
    const liveUpdate = await observed.promise;
    assert.deepEqual(liveUpdate.context.presentations, changed.delta.presentations);
    assert.equal(liveUpdate.state.state.publicScene.updates.length, 0);
    assert.ok(!JSON.stringify(changed).includes('presentationRef'));
    assert.ok(!JSON.stringify(changed).includes('/objects/presentations/'));
    await events.close();
    const rejoined = await f.openMember();
    const fresh = (await rejoined.next()).value;
    assert.equal(fresh.kind, 'checkpoint');
    assert.equal(fresh.checkpoint.generation, changed.delta.generation);
    assert.equal(fresh.checkpoint.state.publicScene.updates.length, 0);
    assert.equal(Object.hasOwn(fresh, 'presentations'), false);
    await f.owner.client.controlLiveSession(
      f.campaign.id,
      'end',
      await f.owner.client.getLiveSession(f.campaign.id)
    );
    assert.equal((await rejoined.next()).value.code, 'live-session-paused');
    await observation.done;
  }
);

test(
  'owner live routes reject changed epochs, forged endpoints and extra private fields without publishing or allocating motion objects',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const reference = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
    const before = (await reference.get()).data();
    const command = ownerMove(f);
    const cases = [
      [
        'changed epoch',
        409,
        'live-session-changed',
        (value) => {
          value.sessionId = randomUUID();
        },
      ],
      [
        'missing epoch',
        400,
        'invalid-scene-presentation',
        (value) => {
          delete value.sessionId;
        },
      ],
      [
        'forged origin',
        422,
        'invalid-scene-presentation',
        (value) => {
          value.presentations[0].motion.from.gridX = 2;
          value.presentations[0].motion.from.pose.world.x = 2.5;
        },
      ],
      [
        'forged destination',
        422,
        'invalid-scene-presentation',
        (value) => {
          value.presentations[0].motion.route[0].gridY = 3;
          value.presentations[0].motion.route[0].pose.world.z = 3.5;
        },
      ],
      [
        'private presentation fields',
        422,
        'invalid-scene-presentation',
        (value) => {
          value.presentations[0].characterId = f.npc;
        },
      ],
    ];
    for (const [label, status, code, mutate] of cases) {
      const request = structuredClone(command);
      request.commandId = randomUUID();
      mutate(request);
      const denied = await publishOwner(f, request);
      assert.equal(denied.status, status, label);
      assert.equal(denied.body.code, code, label);
      assert.deepEqual((await reference.get()).data(), before, label);
    }
    const member = await publishOwner(f, command, f.member);
    assert.equal(member.status, 409);
    assert.equal(member.body.code, 'campaign-access-changed');
    await f.owner.client.controlLiveSession(
      f.campaign.id,
      'end',
      await f.owner.client.getLiveSession(f.campaign.id)
    );
    const paused = await publishOwner(f, command);
    assert.equal(paused.status, 409);
    assert.equal(paused.body.code, 'live-session-paused');
    assert.deepEqual((await reference.get()).data(), before);
    const [objects] = await f.runtime.bucket.getFiles({
      prefix: `campaigns/${f.campaign.id}/objects/presentations/`,
    });
    assert.equal(objects.length, 0);
  }
);

test(
  'a pause after the immutable native route upload prevents atomic scene, motion-head and receipt publication',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const reference = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
    const before = (await reference.get()).data();
    const command = ownerMove(f);
    const uploaded = Promise.withResolvers();
    const release = Promise.withResolvers();
    const stage = f.store.objects.stage.bind(f.store.objects);
    f.store.objects.stage = async (...args) => {
      const object = await stage(...args);
      if (args[1] === 'presentations') {
        uploaded.resolve(object);
        await release.promise;
      }
      return object;
    };
    const pending = publishOwner(f, command);
    try {
      const staged = await uploaded.promise;
      assert.equal(staged.kind, 'presentations');
      await f.owner.client.controlLiveSession(
        f.campaign.id,
        'end',
        await f.owner.client.getLiveSession(f.campaign.id)
      );
      release.resolve();
      const denied = await pending;
      assert.equal(denied.status, 409);
      assert.equal(denied.body.code, 'live-session-paused');
      assert.deepEqual((await reference.get()).data(), before);
      const receipt = await f.runtime.firestore
        .collection('accountCommands')
        .doc(pilotAccountKey(f.owner.uid))
        .collection('receipts')
        .doc(command.commandId)
        .get();
      assert.equal(receipt.exists, false);
      const canonical = await f.owner.client.readCharacters(f.campaign.id);
      assert.equal(canonical.sceneRevision, 1);
      assert.deepEqual(JSON.parse(canonical.scene), JSON.parse(encodeScene(f.scene, f.validation)));
    } finally {
      release.resolve();
      await pending;
    }
  }
);
