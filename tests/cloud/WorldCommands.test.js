const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash, webcrypto } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
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
const { PhysicalDice } = require('../../tools/physical-dice.js');
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
const { gameplayRuntime, playerGameplayState } = require('../../src/campaigns/ServerGameplay.js');
const {
  createTwoFloorTravelScene,
} = require('../../src/campaigns/examples/ConnectedTravelExample.js');
const { applyCloudParticipantDelta } = require('../../src/campaigns/CloudParticipantProtocol.js');
const { sceneActorPlacement } = require('../../src/scene/token-adapter/SavedPlacements.js');
const { sceneState } = require('../helpers/sceneState.js');
const { participantStorage } = require('../helpers/participantStorage.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');
const { createCanvas } = require('canvas');
const { IDBFactory } = require('fake-indexeddb');
const { default: CloudParticipantCache } = require('../../src/campaigns/CloudParticipantCache.js');
const {
  default: CloudPlayerSessionConnection,
} = require('../../src/campaigns/CloudPlayerSessionConnection.js');
const { openDatabase, requestResult, transact } = require('../../src/storage/indexedDB.js');
const { default: PlayerCommandAdapter } = require('../../src/ui/sessions/PlayerCommandAdapter.js');

async function fixture(
  t,
  {
    ruleset = '2014',
    ownerFetch = globalThis.fetch,
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
  const owner = await account(ownerFetch);
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
      'X-TavernTable-Seat': scope.seatId ?? 'owner',
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
      const request = {
        pathname,
        body: options.body ? JSON.parse(options.body) : null,
        seatId: options.headers['X-TavernTable-Seat'],
        accessGeneration: options.headers['X-TavernTable-Access-Generation'],
      };
      requests.push(request);
      if (offline) throw new TypeError('Synthetic participant network is offline');
      const response = await fetch(url, options);
      request.status = response.status;
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

function measuredParticipantNetwork() {
  const requests = [];
  const events = [];
  const responses = [];
  const streams = new Map();
  let offline = false;
  let loseReply = false;
  return {
    requests,
    events,
    responses,
    streams,
    reset() {
      requests.length = events.length = responses.length = 0;
    },
    loseNextCommandReply() {
      loseReply = true;
    },
    measurement() {
      const payloads = [...responses, ...events].map((entry) => entry.payload);
      const bytes = (value) => (value ? Buffer.byteLength(JSON.stringify(value)) : 0);
      const graphicJSONBytes = payloads.reduce(
        (total, payload) =>
          total +
          bytes(
            (payload.result || payload.checkpoint || payload.delta?.checkpoint)?.state?.publicScene
              ?.assets
          ),
        0
      );
      const presentationJSONBytes = payloads.reduce(
        (total, payload) =>
          total + bytes(payload.result?.presentation) + bytes(payload.delta?.presentations),
        0
      );
      const responseBodyBytes = requests.reduce(
        (total, request) => total + request.responseBodyBytes,
        0
      );
      const imageBodyBytes = requests
        .filter((request) => /\/participant-assets\/[a-f0-9]{64}$/.test(request.pathname))
        .reduce(
          (total, request) => total + (request.status === 200 ? request.responseBodyBytes : 0),
          0
        );
      return {
        requests: requests.length,
        requestBodyBytes: requests.reduce((total, request) => total + request.requestBodyBytes, 0),
        responseBodyBytes,
        canonicalVerificationBodyBytes: requests
          .filter((request) => request.pathname.endsWith('/characters') && !request.body)
          .reduce((total, request) => total + request.responseBodyBytes, 0),
        sseBodyBytes: requests
          .filter((request) => request.sse)
          .reduce((total, request) => total + request.responseBodyBytes, 0),
        graphicJSONBytes,
        imageBodyBytes,
        presentationJSONBytes,
        stateAndEnvelopeBodyBytes:
          responseBodyBytes - graphicJSONBytes - imageBodyBytes - presentationJSONBytes,
        physicalFramesJSONBytes: payloads.reduce(
          (total, payload) => total + bytes(payload.result?.presentation?.roll?.physics),
          0
        ),
      };
    },
    async setOffline(value) {
      offline = value;
      if (!offline) return;
      await Promise.all(
        [...streams].map(async ([controller, reader]) => {
          controller.error(new TypeError('Synthetic managed transport loss'));
          await reader.cancel();
          streams.delete(controller);
        })
      );
    },
    fetch: async (url, options) => {
      const request = {
        pathname: new URL(url).pathname,
        body: options.body ?? '',
        seatId: options.headers['X-TavernTable-Seat'],
        accessGeneration: options.headers['X-TavernTable-Access-Generation'],
        requestBodyBytes: Buffer.byteLength(options.body ?? ''),
        responseBodyBytes: 0,
      };
      requests.push(request);
      if (offline) throw new TypeError('Synthetic managed transport is offline');
      const response = await fetch(url, options);
      request.status = response.status;
      const sse = response.headers.get('content-type')?.startsWith('text/event-stream');
      request.sse = !!sse;
      const json = response.headers.get('content-type')?.startsWith('application/json');
      if (loseReply && request.pathname.endsWith('/world-commands') && response.ok) {
        request.lostReply = true;
        loseReply = false;
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      const body = new ReadableStream({
        start(controller) {
          if (sse) streams.set(controller, reader);
        },
        async pull(controller) {
          try {
            const step = await reader.read();
            if (step.done) {
              streams.delete(controller);
              if (json)
                responses.push({
                  pathname: request.pathname,
                  payload: JSON.parse(buffered + decoder.decode()),
                  receivedAt: performance.now(),
                });
              if (request.lostReply)
                throw new TypeError('Synthetic lost reply after the actual native publication');
              controller.close();
              reader.releaseLock();
              return;
            }
            request.responseBodyBytes += step.value.byteLength;
            if (sse || json) buffered += decoder.decode(step.value, { stream: true });
            if (sse) {
              let end;
              while ((end = buffered.indexOf('\n')) !== -1) {
                const line = buffered.slice(0, end).trimEnd();
                buffered = buffered.slice(end + 1);
                if (line.startsWith('data:'))
                  events.push({
                    payload: JSON.parse(line.slice(5).trim()),
                    receivedAt: performance.now(),
                  });
              }
            }
            controller.enqueue(step.value);
          } catch (error) {
            streams.delete(controller);
            controller.error(error);
          }
        },
        async cancel(reason) {
          await reader.cancel(reason);
          for (const [controller, active] of streams)
            if (active === reader) streams.delete(controller);
          reader.releaseLock();
        },
      });
      return new Response(body, { headers: response.headers, status: response.status });
    },
  };
}

test(
  'ten managed SDK clients converge on current canonical authority without sharing private participant scope',
  { timeout: 240000 },
  async (t) => {
    const storage = participantStorage();
    const ownerNetwork = measuredParticipantNetwork();
    const firstNetwork = measuredParticipantNetwork();
    const f = await fixture(t, {
      ownerFetch: ownerNetwork.fetch,
      memberFetch: firstNetwork.fetch,
      participantCacheFactory: ({ uid }) => new CloudParticipantCache({ ...storage, uid }),
    });
    // Exercise real physical frames without making convergence depend on a random non-settling throw.
    let seed = 42;
    f.store.worldDice = new PhysicalDice({
      root: path.resolve(__dirname, '..', '..'),
      random: () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      },
    });
    const connections = [];
    const extraAccounts = [];
    const members = [
      {
        identity: f.member,
        characterId: f.hero,
        tokenId: 'token-1',
        access: f.grant.access,
        network: firstNetwork,
      },
    ];
    let ownerObservation;
    let ownerSnapshot;
    let staleWriter;
    const ownerArrivals = new Map();
    const convergence = [];
    const waiters = new Set();
    const wake = () => {
      for (const check of [...waiters]) check();
    };
    const until = (predicate, label) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error(label));
        }, 30000);
        const check = () => {
          if (!predicate()) return;
          clearTimeout(timer);
          waiters.delete(check);
          resolve();
        };
        waiters.add(check);
        check();
      });
    const atGeneration = (generation, selected = members) =>
      ownerSnapshot?.generation === generation &&
      ownerObservation.status.phase === 'ready' &&
      selected.every(
        (member) =>
          member.connection.snapshot?.generation === generation && member.connection.commandReady
      );
    const same = (actual, expected, label) => assert.ok(isDeepStrictEqual(actual, expected), label);
    const poses = (actors) =>
      actors
        .map((actor) => ({
          id: actor.id,
          mapId: actor.mapId,
          gridX: actor.gridX,
          gridY: actor.gridY,
          facingAngle: actor.facingAngle,
          pose: actor.pose,
        }))
        .sort((first, second) => first.id.localeCompare(second.id));
    const privateNote = 'PRIVATE ten-client NPC notes';
    const worldReceipts = async () =>
      (
        await Promise.all(
          [f.owner, ...members.map((member) => member.identity)].map((identity) =>
            f.runtime.firestore
              .collection('accountCommands')
              .doc(pilotAccountKey(identity.uid))
              .collection('receipts')
              .get()
          )
        )
      ).flatMap((snapshot) => snapshot.docs.filter((row) => row.data().kind === 'world.command'));
    const assertPublic = (member, payload) => {
      const text = JSON.stringify(payload);
      for (const secret of [
        privateNote,
        ...members.filter((entry) => entry !== member).map((entry) => entry.privateNote),
      ])
        assert.equal(
          text.includes(secret),
          false,
          'Public transport bytes must exclude private notes'
        );
      for (const foreign of [f.npc, ...members.map((entry) => entry.characterId)])
        if (foreign !== member.characterId)
          assert.equal(
            text.includes(foreign),
            false,
            'Public bytes must exclude foreign sheet IDs'
          );
      for (const field of ['sceneRef', 'charactersRef', 'presentationRef', 'ownerUid'])
        assert.equal(
          text.includes(`"${field}"`),
          false,
          'Public bytes must not expose owner snapshots'
        );
      const visit = (value) => {
        if (!value || typeof value !== 'object') return;
        if (Object.hasOwn(value, 'scene')) assert.equal(value.scene, null);
        if (value.access) {
          assert.equal(value.access.uid, member.identity.uid);
          assert.equal(value.access.seatId, member.access.seatId);
          assert.equal(value.access.accessGeneration, member.access.accessGeneration);
        }
        if (value.ownedTokens)
          assert.ok(
            value.ownedTokens.every((token) => token.tokenId === member.tokenId),
            'Foreign actors must not receive gameplay budgets'
          );
        if (value.budget || (value.motion && Object.hasOwn(value, 'costFeet')))
          assert.equal(
            value.tokenId,
            member.tokenId,
            'Only owned presentations expose cost/budget'
          );
        if (Object.hasOwn(value, 'owned')) {
          assert.equal(value.owned, value.id === member.tokenId);
          assert.equal(value.characterId, value.owned ? member.characterId : null);
        }
        for (const nested of Object.values(value)) visit(nested);
      };
      visit(payload);
    };
    const assertPublicHistory = () => {
      for (const member of members) {
        for (const event of member.network.events) {
          assertPublic(member, event.payload);
          assert.equal(JSON.stringify(event.payload).includes('"physics"'), false);
        }
        for (const response of member.network.responses) assertPublic(member, response.payload);
      }
    };
    const recordConvergence = (phase, generation, startedAt) => {
      const arrivals = [
        ownerArrivals.get(generation),
        ...members.map((member) => member.arrivals.get(generation)),
      ];
      assert.equal(arrivals.filter(Number.isFinite).length, 10);
      convergence.push({
        phase,
        clients: arrivals.length,
        generation,
        sceneRevision: ownerSnapshot.state.sceneRevision,
        charactersRevision: ownerSnapshot.state.revision,
        dispatchToAllReadyMs: Number((performance.now() - startedAt).toFixed(2)),
        firstToLastStateMs: Number((Math.max(...arrivals) - Math.min(...arrivals)).toFixed(2)),
      });
    };
    const assertConverged = async () => {
      const head = (
        await f.runtime.firestore.collection('campaigns').doc(f.campaign.id).get()
      ).data();
      const canonical = await f.owner.client.readCharacters(f.campaign.id);
      const scene = JSON.parse(canonical.scene);
      const library = new CampaignCharacters({ ...canonical, catalog: f.catalog });
      assert.equal(ownerObservation.status.phase, 'ready');
      assert.equal(ownerSnapshot.generation, head.generation);
      assert.equal(ownerSnapshot.access.role, 'owner');
      assert.equal(ownerSnapshot.access.uid, f.owner.uid);
      same(ownerSnapshot.state, canonical, 'The private owner stream must match canonical HTTP');
      assert.equal(new Set(members.map((member) => member.connection.snapshot.viewKey)).size, 9);
      for (const member of members) {
        const snapshot = member.connection.snapshot;
        assert.equal(member.connection.commandReady, true);
        assert.equal(snapshot.generation, head.generation);
        assert.equal(snapshot.state.sceneRevision, canonical.sceneRevision);
        assert.equal(snapshot.state.revision, canonical.revision);
        assert.equal(snapshot.sessionId, f.live.sessionId);
        same(snapshot.access, member.access, 'Each player must retain its own captured grant');
        same(
          snapshot.state.characterIds,
          [member.characterId],
          'Only the assigned sheet is public'
        );
        same(
          poses(snapshot.state.publicScene.actors),
          poses(scene.creatures),
          'Every currently visible actor must have the canonical pose'
        );
        same(
          snapshot.state.gameplay,
          playerGameplayState(scene, library, [member.characterId]),
          'Only this participant receives its canonical native gameplay budget'
        );
        assertPublic(member, snapshot);
      }
      assertPublicHistory();
      return { head, canonical };
    };
    try {
      const scene = structuredClone(f.scene);
      const positions = [
        [0, 0],
        [2, 0],
        [4, 0],
        [0, 2],
        [4, 2],
        [0, 4],
        [2, 4],
        [4, 4],
      ];
      for (const [index, [gridX, gridY]] of positions.entries()) {
        const network = measuredParticipantNetwork();
        const identity = await f.account(network.fetch);
        extraAccounts.push(identity);
        const characterId = await f.library.create(`Convergence player ${index + 2}`);
        const invitation = await f.owner.client.createInvitation(f.campaign.id, {
          name: `Convergence seat ${index + 2}`,
        });
        await identity.client.redeemInvitation(invitation);
        const joined = await identity.client.getParticipantAccess(f.campaign.id);
        await f.owner.client.assignCharacter(f.campaign.id, {
          seatId: joined.access.seatId,
          accessGeneration: joined.access.accessGeneration,
          characterId,
          assigned: true,
        });
        const grant = await identity.client.getParticipantAccess(f.campaign.id);
        const tokenId = `token-${index + 3}`;
        const actor = structuredClone(scene.creatures[0]);
        Object.assign(actor, {
          id: tokenId,
          instanceNumber: index + 3,
          name: `Convergence player ${index + 2}`,
          characterId,
          gridX,
          gridY,
          pose: { kind: 'ground', world: { x: gridX + 0.5, y: 0, z: gridY + 0.5 } },
        });
        scene.creatures.push(actor);
        members.push({ identity, characterId, tokenId, access: grant.access, network });
      }
      scene.tokenCounters = { nextId: 10, types: [[scene.creatures[0].type, 10]] };
      for (const [index, member] of members.entries()) {
        member.privateNote = `PRIVATE ten-client assigned sheet ${index + 1}`;
        member.arrivals = new Map();
        await f.library.edit(member.characterId, { notes: member.privateNote });
      }
      const imageBytes = createCanvas(2, 2).toBuffer('image/png');
      await f.library.edit(f.hero, {
        portraitImage: 'data:image/png;base64,' + imageBytes.toString('base64'),
      });
      await f.library.edit(f.npc, { notes: privateNote });
      const native = gameplayRuntime(scene, f.library);
      await native.combat.startTurn(native.actors.find((actor) => actor.id === 'token-1'));
      scene.combat = native.combat.snapshot();
      await f.owner.client.commitScene(f.campaign.id, {
        ruleset: '2014',
        revision: 1,
        charactersRevision: f.library.revision,
        scene: encodeScene(scene, f.validation),
      });
      for (const network of [ownerNetwork, ...members.map((member) => member.network)])
        network.reset();
      const joinStartedAt = performance.now();
      ownerObservation = await f.observeOwner({
        onState: (snapshot) => {
          ownerSnapshot = snapshot;
          if (!ownerArrivals.has(snapshot.generation))
            ownerArrivals.set(snapshot.generation, performance.now());
          wake();
        },
        onStatus: wake,
      });
      await ownerObservation.ready;
      for (let start = 0; start < members.length; start += 3)
        await Promise.all(
          members.slice(start, start + 3).map(async (member) => {
            const connection = new CloudPlayerSessionConnection({
              store: member.identity.client,
              campaignId: f.campaign.id,
              access: member.access,
              sessionId: f.live.sessionId,
              cache: new CloudParticipantCache({ ...storage, uid: member.identity.uid }),
            });
            connections.push(connection);
            member.connection = connection;
            connection.subscribe((event) => {
              if (event.type === 'state' && !member.arrivals.has(event.generation))
                member.arrivals.set(event.generation, performance.now());
              wake();
            });
            await connection.open();
          })
        );
      assert.equal(new Set([f.owner.uid, ...members.map(({ identity }) => identity.uid)]).size, 10);
      for (const identity of [f.owner, ...members.map((member) => member.identity)]) {
        assert.equal(identity.client.streams.size, 1);
        assert.equal(identity.client.liveConnections.size, 1);
      }
      const baseline = await assertConverged();
      assert.ok(
        ownerNetwork.events.some((event) => JSON.stringify(event.payload).includes(privateNote))
      );
      assert.equal(
        [ownerNetwork, ...members.map((member) => member.network)].reduce(
          (total, network) => total + network.streams.size,
          0
        ),
        10
      );
      recordConvergence('cold-join-three-at-a-time', baseline.head.generation, joinStartedAt);
      const command = (member, kind, payload) => ({
        version: 1,
        commandId: randomUUID(),
        sceneRevision: member.connection.snapshot.state.sceneRevision,
        charactersRevision: member.connection.snapshot.state.revision,
        observerTokenId: member.tokenId,
        tokenId: member.tokenId,
        kind,
        payload,
        view: {
          mapId: 'map-main',
          assetKey: member.connection.snapshot.state.publicScene.assetKey,
        },
      });
      const contenders = [
        {
          member: members[0],
          command: command(members[0], 'move', {
            target: { mapId: 'map-main', gridX: 2, gridY: 1 },
            closest: true,
          }),
        },
        {
          member: members[1],
          command: command(members[1], 'roll', {
            expression: '1d20+2',
            label: 'Ten-client physical check',
            mode: 'normal',
          }),
        },
      ];
      const stage = f.store.objects.stage.bind(f.store.objects);
      const release = Promise.withResolvers();
      let staged = 0;
      f.store.objects.stage = async (...args) => {
        const reference = await stage(...args);
        if (args[1] === 'scene') {
          staged++;
          wake();
          await release.promise;
        }
        return reference;
      };
      const competingStartedAt = performance.now();
      const competing = Promise.allSettled(
        contenders.map((entry) =>
          entry.member.connection.call('playerCommand', [f.campaign.id, entry.command])
        )
      );
      let results;
      try {
        await until(() => staged === 2, 'Both native commands must stage before the CAS race');
        release.resolve();
        results = await competing;
      } finally {
        release.resolve();
        f.store.objects.stage = stage;
        await competing;
      }
      assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
      const stale = results.findIndex((result) => result.status === 'rejected');
      assert.equal(results[stale].reason.status, 409);
      assert.equal(results[stale].reason.code, 'stale-revision');
      await until(
        () => atGeneration(baseline.head.generation + 1),
        'All ten live transports must reconcile the CAS winner'
      );
      recordConvergence('concurrent-CAS-winner', baseline.head.generation + 1, competingStartedAt);
      const rejectedId = contenders[stale].command.commandId;
      contenders[stale].command = command(
        contenders[stale].member,
        contenders[stale].command.kind,
        contenders[stale].command.payload
      );
      const retryStartedAt = performance.now();
      await contenders[stale].member.connection.call('playerCommand', [
        f.campaign.id,
        contenders[stale].command,
      ]);
      await until(
        () => atGeneration(baseline.head.generation + 2),
        'All ten live transports must converge after the explicit fresh-authority CAS retry'
      );
      recordConvergence('fresh-authority-CAS-retry', baseline.head.generation + 2, retryStartedAt);
      const committed = await assertConverged();
      assert.equal(committed.canonical.sceneRevision, baseline.canonical.sceneRevision + 2);
      assert.equal(
        JSON.parse(committed.canonical.scene).combat.states.find(
          (state) => state.tokenId === 'token-1'
        ).movementSpent,
        5
      );
      for (const entry of contenders) {
        const duplicate = await entry.member.identity.client.commitWorldCommand(
          f.campaign.id,
          { sessionId: f.live.sessionId, command: entry.command },
          entry.member.access
        );
        assert.equal(duplicate.outcome, 'duplicate');
        assert.equal(duplicate.presentation, null);
      }
      const unchanged = await assertConverged();
      same(
        unchanged.head,
        committed.head,
        'Exact duplicate commands cannot publish another generation'
      );
      same(
        unchanged.canonical,
        committed.canonical,
        'Duplicate moves or dice cannot change canonical state'
      );
      const receipts = await worldReceipts();
      assert.equal(receipts.length, 2);
      same(
        receipts.map((row) => row.id).sort(),
        contenders.map((entry) => entry.command.commandId).sort(),
        'Only the two accepted command IDs receive durable receipts'
      );
      assert.equal(
        receipts.some((row) => row.id === rejectedId),
        false
      );
      for (const receipt of receipts)
        assert.equal(JSON.stringify(receipt.data()).includes('"physics"'), false);
      const returning = members.at(-1);
      const recoveredCommand = command(returning, 'roll', {
        expression: '1d20+2',
        label: 'Unacknowledged ten-client physical check',
        mode: 'normal',
      });
      const recoveryStartedAt = performance.now();
      returning.network.loseNextCommandReply();
      await assert.rejects(
        returning.connection.call('playerCommand', [f.campaign.id, recoveredCommand]),
        { code: 'cloud-unavailable' }
      );
      await until(
        () => atGeneration(baseline.head.generation + 3),
        'All ten clients must see the committed generation even when its HTTP receipt is lost'
      );
      recordConvergence(
        'lost-reply-still-committed',
        baseline.head.generation + 3,
        recoveryStartedAt
      );
      const beforeRecovery = await assertConverged();
      const recovered = await returning.identity.client.retryWorldCommand();
      assert.equal(recovered.outcome, 'duplicate');
      assert.equal(recovered.presentation, null);
      const recoveredRequests = returning.network.requests.filter((request) =>
        request.pathname.endsWith('/world-commands')
      );
      assert.equal(recoveredRequests.length, 2);
      const recoveryAttempts = recoveredRequests.map(({ body, seatId, accessGeneration }) => ({
        body,
        seatId,
        accessGeneration,
      }));
      same(
        recoveryAttempts[0],
        recoveryAttempts[1],
        'Lost-reply recovery must use the exact original body, command ID and grant'
      );
      same(
        (await assertConverged()).canonical,
        beforeRecovery.canonical,
        'Original dice receipt recovery must neither reroll nor publish again'
      );
      const offlineGeneration = returning.connection.snapshot.generation;
      const offlineSceneRevision = returning.connection.snapshot.state.sceneRevision;
      await returning.network.setOffline(true);
      await until(
        () => returning.connection.phase === 'reconnecting',
        'The actual disconnected SDK transport must lose command authority'
      );
      assert.equal(returning.connection.commandReady, false);
      await assert.rejects(
        returning.connection.call('playerCommand', [
          f.campaign.id,
          command(returning, 'roll', {
            expression: '1d20+2',
            label: 'Blocked offline command',
            mode: 'normal',
          }),
        ]),
        { code: 'world-state-unavailable' }
      );
      assert.equal(
        returning.network.requests.filter((request) => request.pathname.endsWith('/world-commands'))
          .length,
        2
      );
      const missed = [];
      for (const [index, target] of [
        { mapId: 'map-main', gridX: 2, gridY: 2 },
        { mapId: 'map-main', gridX: 3, gridY: 2 },
      ].entries()) {
        const next = command(members[0], 'move', { target });
        missed.push(next.commandId);
        await members[0].connection.call('playerCommand', [f.campaign.id, next]);
        await until(
          () => atGeneration(baseline.head.generation + 4 + index, members.slice(0, -1)),
          'The still-connected owner and players must converge while one transport is offline'
        );
      }
      assert.equal(returning.connection.snapshot.generation, offlineGeneration);
      const reconnectEvents = returning.network.events.length;
      const reconnectRequests = returning.network.requests.length;
      const reconnectStartedAt = performance.now();
      await returning.network.setOffline(false);
      returning.connection.observation.reconnect();
      await until(
        () => atGeneration(baseline.head.generation + 5),
        'The reconnected tenth SDK transport must rejoin current canonical authority'
      );
      recordConvergence('latest-only-reconnect', baseline.head.generation + 5, reconnectStartedAt);
      const freshEvents = returning.network.events.slice(reconnectEvents);
      assert.equal(freshEvents[0].payload.kind, 'checkpoint');
      assert.equal(freshEvents[0].payload.checkpoint.generation, baseline.head.generation + 5);
      for (const event of freshEvents) {
        assert.equal(Object.hasOwn(event.payload, 'presentations'), false);
        assert.equal(event.payload.delta?.presentations?.length ?? 0, 0);
        for (const id of missed)
          assert.equal(
            JSON.stringify(event.payload).includes(id),
            false,
            'Missed routes are not replayed'
          );
        assert.equal(JSON.stringify(event.payload).includes('"physics"'), false);
      }
      assert.equal(
        returning.network.requests
          .slice(reconnectRequests)
          .filter((request) => request.pathname.endsWith('/events') && request.status === 200)
          .length,
        1
      );
      same(
        returning.connection.readLiveState(offlineSceneRevision).publicScene.updates,
        [],
        'Latest-state reconciliation clears all missed physical presentations'
      );
      const final = await assertConverged();
      assert.equal(final.head.generation, baseline.head.generation + 5);
      assert.equal(final.canonical.sceneRevision, baseline.canonical.sceneRevision + 5);
      assert.equal(
        JSON.parse(final.canonical.scene).combat.states.find((state) => state.tokenId === 'token-1')
          .movementSpent,
        15
      );
      const finalReceipts = await worldReceipts();
      assert.equal(finalReceipts.length, 5);
      same(
        finalReceipts.map((row) => row.id).sort(),
        [
          ...contenders.map((entry) => entry.command.commandId),
          recoveredCommand.commandId,
          ...missed,
        ].sort(),
        'Five accepted commands must have exactly five receipts across all ten accounts'
      );
      for (const receipt of finalReceipts)
        assert.equal(JSON.stringify(receipt.data()).includes('"physics"'), false);
      assert.equal(final.canonical.scene.includes('"physics"'), false);
      const duplicateBodies = members.flatMap((member) =>
        member.network.responses
          .map((response) => response.payload.result)
          .filter((result) => result?.outcome === 'duplicate')
      );
      assert.equal(duplicateBodies.length, 3);
      for (const body of duplicateBodies) assert.equal(body.presentation, null);
      for (const member of members) {
        const seen = member.network.events.flatMap(
          (event) => event.payload.delta?.presentations?.map((entry) => entry.commandId) ?? []
        );
        assert.equal(
          new Set(seen).size,
          seen.length,
          'A live transport must not deliver duplicate routes'
        );
      }
      const saved = await returning.connection.cache.readCheckpoint(
        returning.access,
        returning.connection.snapshot.viewKey
      );
      assert.equal(saved.generation, final.head.generation);
      same(
        saved.state.publicScene.updates,
        [],
        'Persisted checkpoints must remain presentation-free'
      );
      const reference = saved.manifest.images.find((slot) => slot.source === 'actor').reference;
      assert.equal(reference.bytes, imageBytes.length);
      assert.ok((await returning.connection.cache.getUsage()).bytes > imageBytes.length);
      staleWriter = new CloudParticipantCache({ ...storage, uid: returning.identity.uid });
      await staleWriter.readCheckpoint(saved.access, saved.viewKey);
      const revokeStart = returning.network.requests.length;
      await f.owner.client.removeMember(f.campaign.id, {
        seatId: returning.access.seatId,
        accessGeneration: returning.access.accessGeneration,
      });
      await returning.connection.done;
      await returning.connection.participantAssets.purging;
      assert.equal(returning.connection.commandReady, false);
      assert.equal(returning.connection.snapshot, null);
      assert.equal(returning.connection.state, null);
      assert.equal(returning.connection.participantAssets.images.size, 0);
      assert.equal((await returning.connection.cache.getUsage()).bytes, 0);
      await assert.rejects(staleWriter.writeCheckpoint(saved), { code: 'cache-invalidated' });
      await assert.rejects(staleWriter.writeAsset(saved, reference, imageBytes), {
        code: 'cache-invalidated',
      });
      assert.equal(
        await returning.connection.cache.readCheckpointCandidate(returning.access),
        null
      );
      assert.equal(await returning.connection.cache.readAuthorizedAsset(saved, reference), null);
      await assert.rejects(
        returning.identity.client.readParticipantSnapshot(
          f.campaign.id,
          {
            sessionId: f.live.sessionId,
            observerTokenId: returning.tokenId,
            mapId: 'map-main',
            assetKey: null,
          },
          returning.access
        ),
        { status: 404, code: 'campaign-not-found' }
      );
      await assert.rejects(
        returning.identity.client.readParticipantAsset(f.campaign.id, saved, reference),
        { status: 404, code: 'campaign-not-found' }
      );
      for (const request of returning.network.requests.slice(revokeStart))
        assert.notEqual(request.status, 200, 'Revocation must return no successful private body');
      for (const member of members.slice(0, -1))
        assert.ok(
          (await member.connection.cache.getUsage()).bytes > 0,
          'Other UID caches survive revocation'
        );
      assertPublicHistory();
      await f.owner.client.controlLiveSession(
        f.campaign.id,
        'end',
        await f.owner.client.getLiveSession(f.campaign.id)
      );
      await Promise.all([
        ownerObservation.done,
        ...connections.map((connection) => connection.done),
      ]);
      await ownerObservation.close();
      await Promise.all(connections.map((connection) => connection.close()));
      for (const identity of [f.owner, ...members.map((member) => member.identity)]) {
        assert.equal(identity.client.streams.size, 0);
        assert.equal(identity.client.liveConnections.size, 0);
        assert.equal(identity.client.connection.inFlight.size, 0);
      }
      assert.equal(
        [ownerNetwork, ...members.map((member) => member.network)].reduce(
          (total, network) => total + network.streams.size,
          0
        ),
        0
      );
      assert.equal(waiters.size, 0);
      const measurements = {
        owner: ownerNetwork.measurement(),
        players: members.map((member) => member.network.measurement()),
      };
      measurements.total = Object.fromEntries(
        Object.keys(measurements.owner).map((key) => [
          key,
          [measurements.owner, ...measurements.players].reduce(
            (total, sample) => total + sample[key],
            0
          ),
        ])
      );
      t.diagnostic(
        JSON.stringify({
          managedUIDs: 10,
          peakSimultaneousSSE: 10,
          convergence,
          receipts: finalReceipts.length,
          definitiveCASRejections: 1,
          freshAuthorityRetries: 1,
          exactDuplicates: 2,
          duplicateReceiptsIncludingRecovery: duplicateBodies.length,
          lostReplyOriginalAttempts: recoveredRequests.length,
          duplicatePhysicalFrames: 0,
          missedRoutesReplayed: 0,
          offlineNewWorldRequests: 0,
          privateBytesAfterRevocation: 0,
          stalePutsRejected: 2,
          openTransportsAfterClose: 0,
          measurements,
          bytesExcludeHTTPHeadersTLSAndAuthSDK: true,
          measurementsIncludeVerificationAndLifecycleTraffic: true,
          coldAdmissionAndCASBarrierAreNotPropagationLatency: true,
          stateAndEnvelopeAreNotArtworkBodiesOrIdleTraffic: true,
          hostedLatencyCostAndIdleApproval: false,
        })
      );
    } finally {
      for (const member of members) {
        await member.network.setOffline(false);
        if (member.identity.client.pendingWorld) await member.identity.client.retryWorldCommand();
      }
      staleWriter?.close();
      await ownerObservation?.close();
      await cleanParticipantFixture(f, storage, connections, extraAccounts);
    }
  }
);

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
      const closes = network.requests.filter(({ pathname }) =>
        pathname.endsWith('/live/presence/close')
      );
      assert.ok(closes.length > 0, 'Actual warm-rejoin cleanup must exercise explicit close');
      for (const close of closes)
        assert.equal(close.status, 200, 'A healthy-network explicit close must be confirmed');
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
  'a cloud DM arrival grant previews only authorized terrain and places the original assigned character once',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const unconfirmed = Promise.withResolvers();
    t.after(
      f.owner.client.subscribeSave((state) => {
        if (state.phase === 'uncertain') unconfirmed.reject(state.error);
      })
    );
    const unplaced = structuredClone(f.scene);
    unplaced.creatures = unplaced.creatures.filter((actor) => actor.characterId !== f.hero);
    unplaced.selection = null;
    const removed = await publishOwner(f, {
      commandId: randomUUID(),
      sessionId: f.live.sessionId,
      presentations: [],
      change: {
        ruleset: '2014',
        revision: 1,
        charactersRevision: f.library.revision,
        scene: encodeScene(unplaced, f.validation),
      },
    });
    assert.equal(removed.status, 200);
    const recordsBefore = (await f.owner.client.readCharacters(f.campaign.id)).records;
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await connection.open({ observerTokenId: null });
    assert.equal(connection.state.publicScene.assetKey, null);
    const noticed = Promise.withResolvers();
    t.after(
      connection.subscribe((event) => {
        if (event.type === 'state' && event.state.placementGrants?.length)
          noticed.resolve(event.state);
      })
    );
    const issued = await Promise.race([
      f.owner.client.grantPlacement(f.campaign.id, {
        seatId: f.grant.access.seatId,
        accessGeneration: f.grant.access.accessGeneration,
        characterId: f.hero,
        destination: { mapId: 'map-main', gridX: 2, gridY: 2, surfaceId: null },
      }),
      unconfirmed.promise,
    ]);
    const grantedState = await noticed.promise;
    assert.equal(grantedState.publicScene.assetKey, null);
    assert.equal(grantedState.placementGrants[0].id, issued.grant.id);
    await assert.rejects(
      f.member.client.readParticipantSnapshot(
        f.campaign.id,
        {
          sessionId: f.live.sessionId,
          observerTokenId: null,
          mapId: null,
          assetKey: null,
          placementGrantId: randomUUID(),
        },
        f.grant.access
      ),
      { status: 403, code: 'placement-forbidden' }
    );
    const deniedGrant = await fetch(`${f.api.url}/api/cloud/campaigns/${f.campaign.id}/arrivals`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + f.member.token,
        Origin: f.api.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commandId: randomUUID(),
        seatId: f.grant.access.seatId,
        accessGeneration: f.grant.access.accessGeneration,
        characterId: f.hero,
        destination: { mapId: 'map-main', gridX: 2, gridY: 2, surfaceId: null },
      }),
    });
    assert.equal(deniedGrant.status, 404);
    const view = await connection.call('playerState', [
      { placementGrantId: issued.grant.id, observerTokenId: null },
    ]);
    assert.equal(view.observerTokenId, null);
    assert.deepEqual(view.observers, []);
    assert.deepEqual(view.publicScene.actors, []);
    assert.deepEqual(view.gameplay.ownedTokens, []);
    assert.equal(view.view.mode, 'placement-preview');
    assert.equal(view.view.id, 'map-main');
    assert.deepEqual(
      view.publicScene.assets.maps.map((map) => map.id),
      ['map-main']
    );
    const request = {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: view.sceneRevision,
      charactersRevision: view.revision,
      observerTokenId: null,
      tokenId: null,
      kind: 'place',
      payload: { characterId: f.hero, grantId: issued.grant.id, appearance: 'female-archer' },
      view: { mapId: 'map-main', assetKey: view.publicScene.assetKey },
    };
    const placed = await connection.call('playerCommand', [f.campaign.id, request]);
    assert.equal(placed.outcome, 'applied');
    assert.equal(placed.receipt.characterId, f.hero);
    assert.equal(placed.state.observerTokenId, placed.receipt.tokenId);
    assert.equal(
      placed.state.publicScene.actors.find((actor) => actor.owned).type,
      'female-archer'
    );
    const repeated = await connection.call('playerCommand', [f.campaign.id, request]);
    assert.equal(repeated.outcome, 'duplicate');
    const saved = await f.owner.client.readCharacters(f.campaign.id);
    assert.equal(
      JSON.parse(saved.scene).creatures.filter((actor) => actor.characterId === f.hero).length,
      1
    );
    assert.deepEqual(saved.records, recordsBefore);
  }
);

test(
  'cloud arrival grants survive replacement authority while reissue and reassignment fence stale destinations',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const unplaced = structuredClone(f.scene);
    unplaced.creatures = unplaced.creatures.filter((actor) => actor.characterId !== f.hero);
    unplaced.selection = null;
    assert.equal(
      (
        await publishOwner(f, {
          commandId: randomUUID(),
          sessionId: f.live.sessionId,
          presentations: [],
          change: {
            ruleset: '2014',
            revision: 1,
            charactersRevision: f.library.revision,
            scene: encodeScene(unplaced, f.validation),
          },
        })
      ).status,
      200
    );
    const first = await f.owner.client.grantPlacement(f.campaign.id, {
      seatId: f.grant.access.seatId,
      accessGeneration: f.grant.access.accessGeneration,
      characterId: f.hero,
      destination: { mapId: 'map-main', gridX: 2, gridY: 2 },
    });
    const store = new CloudCampaignStore({
      firestore: f.runtime.firestore,
      access: f.access,
      packs: f.store.packs,
      resources: f.store.resources,
      objects: f.store.objects,
      assets: f.store.assets,
    });
    const replacement = await cloudApi({ access: f.access, store });
    t.after(() => replacement.close());
    const read = async (grantId, scope = f.grant.access) => {
      const response = await fetch(
        `${replacement.url}/api/cloud/campaigns/${f.campaign.id}/participant-state`,
        {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + f.member.token,
            Origin: replacement.origin,
            'Content-Type': 'application/json',
            'X-TavernTable-Seat': scope.seatId,
            'X-TavernTable-Access-Generation': String(scope.accessGeneration),
          },
          body: JSON.stringify({
            sessionId: f.live.sessionId,
            observerTokenId: null,
            mapId: null,
            assetKey: null,
            placementGrantId: grantId,
          }),
        }
      );
      return { status: response.status, body: await response.json() };
    };
    const recovered = await read(first.grant.id);
    assert.equal(recovered.status, 200);
    assert.equal(recovered.body.result.state.arrival.grantId, first.grant.id);
    assert.deepEqual(recovered.body.result.state.publicScene.actors, []);
    const second = await f.owner.client.grantPlacement(f.campaign.id, {
      seatId: f.grant.access.seatId,
      accessGeneration: f.grant.access.accessGeneration,
      characterId: f.hero,
      destination: { mapId: 'map-main', gridX: 1, gridY: 2 },
    });
    assert.equal((await read(first.grant.id)).status, 403);
    assert.equal((await read(second.grant.id)).status, 200);
    const head = await f.runtime.firestore.collection('campaigns').doc(f.campaign.id).get();
    const replay = await fetch(`${replacement.url}/api/cloud/campaigns/${f.campaign.id}/arrivals`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + f.owner.token,
        Origin: replacement.origin,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        commandId: first.grant.id,
        seatId: first.seatId,
        accessGeneration: first.accessGeneration,
        characterId: f.hero,
        destination: { mapId: 'map-main', gridX: 2, gridY: 2, surfaceId: null },
      }),
    });
    assert.equal(replay.status, 200);
    assert.deepEqual((await replay.json()).result, first);
    assert.equal(
      (await f.runtime.firestore.collection('campaigns').doc(f.campaign.id).get()).data()
        .generation,
      head.data().generation
    );
    const removed = await f.owner.client.assignCharacter(f.campaign.id, {
      seatId: first.seatId,
      characterId: f.hero,
      assigned: false,
      accessGeneration: first.accessGeneration,
    });
    assert.equal((await read(second.grant.id)).status, 409);
    await f.owner.client.assignCharacter(f.campaign.id, {
      seatId: first.seatId,
      characterId: f.hero,
      assigned: true,
      accessGeneration: removed.accessGeneration,
    });
    const fresh = await f.member.client.getParticipantAccess(f.campaign.id);
    const expired = await read(second.grant.id, fresh.access);
    assert.equal(expired.status, 403);
    assert.equal(expired.body.code, 'placement-forbidden');
    const saved = await f.owner.client.readCharacters(f.campaign.id);
    assert.equal(
      JSON.parse(saved.scene).creatures.some((actor) => actor.characterId === f.hero),
      false
    );
  }
);

test(
  'cloud room discovery persists only assigned physical visits without granting later room sight',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const upper = await f.library.create('Unassigned upstairs guide');
    const scene = createTwoFloorTravelScene({
      ruleset: '2014',
      characters: [f.hero, f.npc, upper].map((id) => f.library.get(id)),
    });
    scene.connections[0].open = false;
    let sceneRevision = 1;
    const publish = async () => {
      const response = await publishOwner(f, {
        commandId: randomUUID(),
        sessionId: f.live.sessionId,
        presentations: [],
        change: {
          ruleset: '2014',
          revision: sceneRevision,
          charactersRevision: f.library.revision,
          scene: encodeScene(scene, f.validation),
        },
      });
      assert.equal(response.status, 200);
      sceneRevision++;
    };
    const read = (mapId) =>
      f.member.client.readParticipantSnapshot(
        f.campaign.id,
        { sessionId: f.live.sessionId, observerTokenId: 'token-1', mapId, assetKey: null },
        f.grant.access
      );
    await publish();
    assert.deepEqual((await read('map-main')).state.visitedRoomIds || [], []);
    const actor = scene.creatures.find((entry) => entry.characterId === f.hero);
    Object.assign(actor, {
      mapId: 'ground-floor',
      gridX: 1,
      gridY: 2,
      pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 2.5 } },
    });
    scene.view.mapId = 'ground-floor';
    await publish();
    assert.deepEqual((await read('ground-floor')).state.visitedRoomIds, ['ground-floor']);
    Object.assign(actor, {
      mapId: 'map-main',
      gridX: 10,
      gridY: 10,
      pose: { kind: 'ground', world: { x: 10.5, y: 0, z: 10.5 } },
    });
    scene.view.mapId = 'map-main';
    await publish();
    const returned = await read('map-main');
    assert.deepEqual(returned.state.visitedRoomIds, ['ground-floor']);
    assert(!returned.state.publicScene.assets.maps.some((map) => map.id === 'ground-floor'));
    assert(!returned.state.publicScene.assets.maps.some((map) => map.id === 'upper-floor'));
    const replacement = await cloudApi({
      access: f.access,
      store: new CloudCampaignStore({
        firestore: f.runtime.firestore,
        access: f.access,
        packs: f.store.packs,
        resources: f.store.resources,
        objects: f.store.objects,
        assets: f.store.assets,
      }),
    });
    t.after(() => replacement.close());
    const response = await fetch(
      `${replacement.url}/api/cloud/campaigns/${f.campaign.id}/participant-state`,
      {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + f.member.token,
          Origin: replacement.origin,
          'Content-Type': 'application/json',
          'X-TavernTable-Seat': f.grant.access.seatId,
          'X-TavernTable-Access-Generation': String(f.grant.access.accessGeneration),
        },
        body: JSON.stringify({
          sessionId: f.live.sessionId,
          observerTokenId: 'token-1',
          mapId: 'map-main',
          assetKey: null,
        }),
      }
    );
    assert.equal(response.status, 200);
    const recovered = (await response.json()).result;
    assert.deepEqual(recovered.state.visitedRoomIds, ['ground-floor']);
    assert.deepEqual(
      recovered.state.publicScene.assets.maps.map((map) => map.id),
      ['map-main']
    );
    const assigned = await f.owner.client.assignCharacter(f.campaign.id, {
      seatId: f.grant.access.seatId,
      characterId: upper,
      assigned: true,
      accessGeneration: f.grant.access.accessGeneration,
    });
    const access = await f.member.client.getParticipantAccess(f.campaign.id);
    assert.equal(access.access.accessGeneration, assigned.accessGeneration);
    const visitReference = f.runtime.firestore
      .collection('campaigns')
      .doc(f.campaign.id)
      .collection('seats')
      .doc(f.grant.access.seatId);
    const beforeRead = await visitReference.get();
    const newlyAssigned = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: null,
      },
      access.access
    );
    assert.deepEqual(newlyAssigned.state.visitedRoomIds, ['ground-floor', 'upper-floor']);
    assert.deepEqual(
      newlyAssigned.state.publicScene.assets.maps.map((map) => map.id),
      ['map-main']
    );
    assert((await visitReference.get()).updateTime.isEqual(beforeRead.updateTime));
  }
);

test(
  'the cloud player opens a physically nearby door with canonical scope and no action or movement cost',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const upper = await f.library.create('Upper scoped guide');
    const scene = createTwoFloorTravelScene({
      ruleset: '2014',
      characters: [f.hero, f.npc, upper].map((id) => f.library.get(id)),
    });
    const world = CampaignWorld.fromScene(scene, f.validation);
    world.setDoorState('building-door', { open: false, locked: false });
    const published = await publishOwner(f, {
      commandId: randomUUID(),
      sessionId: f.live.sessionId,
      presentations: [],
      change: {
        ruleset: '2014',
        revision: 1,
        charactersRevision: f.library.revision,
        scene: encodeScene(world.save(), f.validation),
      },
    });
    assert.equal(published.status, 200);
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await connection.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const before = structuredClone(connection.state.gameplay.ownedTokens[0]);
    const sceneRevision = connection.state.sceneRevision;
    assert.equal(connection.state.doors.find((door) => door.id === 'building-door').open, false);
    const receipt = await connection.call('doorState', [
      f.campaign.id,
      {
        doorId: 'building-door',
        observerTokenId: 'token-1',
        sceneRevision: connection.state.sceneRevision,
        open: true,
      },
    ]);
    assert.equal(receipt.revision, sceneRevision + 1);
    assert.deepEqual(receipt.door, { id: 'building-door', open: true, locked: false });
    const after = connection.state.gameplay.ownedTokens[0];
    assert.deepEqual(after.economy, before.economy);
    assert.deepEqual(after.movement, before.movement);
    assert.equal(connection.state.doors.find((door) => door.id === 'building-door').open, true);
    const saved = await f.owner.client.readScene(f.campaign.id);
    assert.equal(JSON.parse(saved.scene).connections[0].open, true);
    assert.equal(saved.revision, receipt.revision);
    const locked = CampaignWorld.fromScene(JSON.parse(saved.scene), f.validation);
    locked.setDoorState('building-door', { open: false, locked: true });
    const lock = await publishOwner(f, {
      commandId: randomUUID(),
      sessionId: f.live.sessionId,
      presentations: [],
      change: {
        ruleset: '2014',
        revision: saved.revision,
        charactersRevision: f.library.revision,
        scene: encodeScene(locked.save(), f.validation),
      },
    });
    assert.equal(lock.status, 200);
    await connection.call('playerState', [{ observerTokenId: 'token-1', mapId: 'map-main' }]);
    const unchanged = await f.owner.client.readScene(f.campaign.id);
    await assert.rejects(
      connection.call('doorState', [
        f.campaign.id,
        {
          doorId: 'building-door',
          observerTokenId: 'token-1',
          sceneRevision: connection.state.sceneRevision,
          open: true,
        },
      ]),
      { status: 403, code: 'door-locked' }
    );
    const forged = playerMove(f, { state: connection.state });
    forged.command.kind = 'door.state';
    forged.command.payload = { doorId: 'building-door', open: true, locked: false };
    assert.equal((await publishPlayer(f, forged)).status, 400);
    delete forged.command.payload.locked;
    await assert.rejects(connection.call('playerCommand', [f.campaign.id, forged.command]), {
      status: 400,
      code: 'invalid-command',
    });
    assert.deepEqual(await f.owner.client.readScene(f.campaign.id), unchanged);
    const far = locked.save();
    Object.assign(far.creatures[0], {
      gridX: 0,
      gridY: 0,
      pose: { kind: 'ground', world: { x: 0.5, y: 0, z: 0.5 } },
    });
    const relocated = await publishOwner(f, {
      commandId: randomUUID(),
      sessionId: f.live.sessionId,
      presentations: [],
      change: {
        ruleset: '2014',
        revision: unchanged.revision,
        charactersRevision: f.library.revision,
        scene: encodeScene(far, f.validation),
      },
    });
    assert.equal(relocated.status, 200);
    await connection.call('playerState', [{ observerTokenId: 'token-1', mapId: 'map-main' }]);
    const distant = await f.owner.client.readScene(f.campaign.id);
    await assert.rejects(
      connection.call('doorState', [
        f.campaign.id,
        {
          doorId: 'building-door',
          observerTokenId: 'token-1',
          sceneRevision: connection.state.sceneRevision,
          open: false,
        },
      ]),
      { status: 403, code: 'door-forbidden' }
    );
    assert.deepEqual(await f.owner.client.readScene(f.campaign.id), distant);
  }
);

test(
  'cloud Cover commits a native wall-aligned stance once and sends only the authorized FROM and destination',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const scene = structuredClone(f.scene);
    const terrain =
      scene.version === 3 ? scene.maps.find((map) => map.id === 'map-main').terrain : scene.terrain;
    terrain.heights[1][2] = 4;
    assert.equal(
      (
        await publishOwner(f, {
          commandId: randomUUID(),
          sessionId: f.live.sessionId,
          presentations: [],
          change: {
            ruleset: '2014',
            revision: 1,
            charactersRevision: f.library.revision,
            scene: encodeScene(scene, f.validation),
          },
        })
      ).status,
      200
    );
    const owner = await f.openOwner();
    assert.equal((await owner.next()).value.kind, 'owner-checkpoint');
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await connection.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const before = structuredClone(connection.state);
    const original = await f.owner.client.readCharacters(f.campaign.id);
    const command = playerMove(f, { state: before }).command;
    command.kind = 'emote';
    command.payload = { actionId: 'action-cover' };
    const accepted = await connection.call('playerCommand', [f.campaign.id, command]);
    assert.equal(accepted.receipt.actionId, 'action-cover');
    assert.deepEqual(accepted.receipt.from.pose.world, before.publicScene.actors[0].pose.world);
    assert(accepted.receipt.placement.pose.world.x > accepted.receipt.from.pose.world.x);
    assert(accepted.receipt.placement.pose.world.x < 2);
    const delivered = (await owner.next()).value;
    assert.equal(delivered.kind, 'owner-delta');
    const visual = delivered.delta.presentations[0];
    assert.equal(visual.kind, 'emote');
    assert.deepEqual(visual.from, accepted.receipt.from);
    assert.deepEqual(visual.placement, accepted.receipt.placement);
    assert.equal(visual.motion, undefined);
    assert.equal(visual.costFeet, undefined);
    assert.equal(visual.budget, undefined);
    const ready = connection.readLiveState(before.sceneRevision);
    assert.deepEqual(ready.publicScene.updates[0].from, visual.from);
    assert.deepEqual(ready.gameplay.ownedTokens[0].economy, before.gameplay.ownedTokens[0].economy);
    assert.deepEqual(
      ready.gameplay.ownedTokens[0].movement,
      before.gameplay.ownedTokens[0].movement
    );
    const saved = await f.owner.client.readCharacters(f.campaign.id);
    const committed = JSON.parse(saved.scene).creatures.find((actor) => actor.id === 'token-1');
    assert.deepEqual(committed.pose, accepted.receipt.placement.pose);
    assert.equal(committed.facingAngle, accepted.receipt.placement.facingAngle);
    assert.deepEqual(saved.records, original.records);
    assert.deepEqual(JSON.parse(saved.scene).combat, JSON.parse(original.scene).combat);
    assert.equal(
      (await connection.call('playerCommand', [f.campaign.id, command])).outcome,
      'duplicate'
    );
    assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), saved);
    const clear = JSON.parse(saved.scene);
    const board =
      clear.version === 3 ? clear.maps.find((map) => map.id === 'map-main').terrain : clear.terrain;
    board.heights[1][2] = 0;
    assert.equal(
      (
        await publishOwner(f, {
          commandId: randomUUID(),
          sessionId: f.live.sessionId,
          presentations: [],
          change: {
            ruleset: '2014',
            revision: saved.sceneRevision,
            charactersRevision: saved.revision,
            scene: encodeScene(clear, f.validation),
          },
        })
      ).status,
      200
    );
    await connection.call('playerState', [{ observerTokenId: 'token-1', mapId: 'map-main' }]);
    const unchanged = await f.owner.client.readCharacters(f.campaign.id);
    const refused = playerMove(f, { state: connection.state }).command;
    refused.kind = 'emote';
    refused.payload = { actionId: 'action-cover' };
    await assert.rejects(connection.call('playerCommand', [f.campaign.id, refused]), {
      status: 422,
      code: 'cover-unavailable',
    });
    assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), unchanged);
  }
);

test(
  'an accepted cloud visual action reaches live owner and player presentation feeds but never replays from a checkpoint',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const owner = await f.openOwner();
    assert.equal((await owner.next()).value.kind, 'owner-checkpoint');
    const member = await f.openMember();
    const checkpoint = (await member.next()).value.checkpoint;
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await connection.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const command = playerMove(f, checkpoint).command;
    command.kind = 'emote';
    command.payload = { actionId: 'action-wave' };
    const before = checkpoint.state.gameplay.ownedTokens[0];
    const accepted = await connection.call('playerCommand', [f.campaign.id, command]);
    assert.equal(accepted.receipt.actionId, 'action-wave');
    const renderState = connection.readLiveState(checkpoint.state.sceneRevision);
    assert.equal(renderState.publicScene.updates[0].kind, 'emote');
    connection.acknowledgeState(renderState.sceneRevision);
    assert.deepEqual(
      connection.readLiveState(checkpoint.state.sceneRevision).publicScene.updates,
      []
    );
    const ownerChange = (await owner.next()).value;
    assert.equal(ownerChange.kind, 'owner-delta');
    assert.equal(ownerChange.delta.presentations?.[0]?.kind, 'emote');
    const memberChange = (await member.next()).value;
    assert.equal(memberChange.kind, 'delta');
    assert.equal(memberChange.delta.presentations?.[0]?.kind, 'emote');
    assert.equal(
      memberChange.delta.presentations[0].animationKey,
      ownerChange.delta.presentations[0].animationKey
    );
    const updated = applyCloudParticipantDelta(checkpoint, memberChange.delta, {
      cachedAssets: checkpoint.state.publicScene.assets,
    });
    assert.deepEqual(updated.state.gameplay.ownedTokens[0].economy, before.economy);
    assert.deepEqual(updated.state.gameplay.ownedTokens[0].movement, before.movement);
    const canonical = await f.owner.client.readCharacters(f.campaign.id);
    assert(!canonical.scene.includes(command.commandId));
    assert(!canonical.scene.includes('action-wave'));
    const repeated = await f.member.client.commitWorldCommand(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        command,
      },
      f.grant.access
    );
    assert.equal(repeated.outcome, 'duplicate');
    assert.equal(repeated.presentation, null);
    await member.close();
    const rejoined = await f.openMember();
    const current = (await rejoined.next()).value;
    assert.equal(current.kind, 'checkpoint');
    assert.deepEqual(current.checkpoint.state.publicScene.updates, []);
    assert.equal(current.presentations, undefined);
    const scene = JSON.parse(canonical.scene);
    const guide = scene.creatures.find((actor) => actor.id === 'token-2');
    const ownerVisual = {
      commandId: randomUUID(),
      tokenId: guide.id,
      kind: 'emote',
      actionId: 'action-wave',
      animationKey: 'actionWave',
      placement: sceneActorPlacement(scene, guide),
    };
    assert.equal(
      (
        await publishOwner(f, {
          commandId: randomUUID(),
          sessionId: f.live.sessionId,
          presentations: [ownerVisual],
          change: {
            ruleset: '2014',
            revision: canonical.sceneRevision,
            charactersRevision: canonical.revision,
            scene: encodeScene(scene, f.validation),
          },
        })
      ).status,
      200
    );
    const mirrored = (await rejoined.next()).value;
    assert.equal(mirrored.kind, 'delta');
    assert.equal(mirrored.delta.presentations[0].tokenId, guide.id);
    assert.equal(mirrored.delta.presentations[0].animationKey, ownerVisual.animationKey);
    assert.equal(mirrored.delta.presentations[0].budget, undefined);
    assert.equal(mirrored.delta.presentations[0].costFeet, undefined);
  }
);

test(
  'cloud visual actions never disclose a hidden actor or replay its action when a room becomes visible',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const upper = await f.library.create('Hidden upstairs');
    const scene = createTwoFloorTravelScene({
      ruleset: '2014',
      characters: [f.hero, f.npc, upper].map((id) => f.library.get(id)),
    });
    scene.connections[0].open = false;
    assert.equal(
      (
        await publishOwner(f, {
          commandId: randomUUID(),
          sessionId: f.live.sessionId,
          presentations: [],
          change: {
            ruleset: '2014',
            revision: 1,
            charactersRevision: f.library.revision,
            scene: encodeScene(scene, f.validation),
          },
        })
      ).status,
      200
    );
    const member = await f.openMember();
    const before = (await member.next()).value.checkpoint;
    assert(!before.state.publicScene.actors.some((actor) => actor.id === 'token-2'));
    const hidden = scene.creatures.find((actor) => actor.id === 'token-2');
    assert.equal(
      (
        await publishOwner(f, {
          commandId: randomUUID(),
          sessionId: f.live.sessionId,
          presentations: [
            {
              commandId: randomUUID(),
              tokenId: hidden.id,
              kind: 'emote',
              actionId: 'action-wave',
              animationKey: 'actionWave',
              placement: sceneActorPlacement(scene, hidden),
            },
          ],
          change: {
            ruleset: '2014',
            revision: before.state.sceneRevision,
            charactersRevision: before.state.revision,
            scene: encodeScene(scene, f.validation),
          },
        })
      ).status,
      200
    );
    const notice = (await member.next()).value;
    assert.equal(notice.kind, 'delta');
    assert.deepEqual(notice.delta.presentations || [], []);
    assert(!JSON.stringify(notice).includes(hidden.id));
    assert(!JSON.stringify(notice).includes(hidden.name));
    const hero = scene.creatures.find((actor) => actor.id === 'token-1');
    Object.assign(hero, {
      mapId: 'ground-floor',
      gridX: 2,
      gridY: 2,
      pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 2.5 } },
    });
    scene.view.mapId = 'ground-floor';
    await member.close();
    assert.equal(
      (
        await publishOwner(f, {
          commandId: randomUUID(),
          sessionId: f.live.sessionId,
          presentations: [],
          change: {
            ruleset: '2014',
            revision: notice.delta.changes.sceneRevision,
            charactersRevision: notice.delta.changes.revision,
            scene: encodeScene(scene, f.validation),
          },
        })
      ).status,
      200
    );
    const visible = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: hero.id,
        mapId: 'ground-floor',
        assetKey: null,
      },
      f.grant.access
    );
    assert(visible.state.publicScene.actors.some((actor) => actor.id === hidden.id));
    assert.deepEqual(visible.state.publicScene.updates, []);
  }
);

test(
  'native paused owner scene and character saves translate local visit hints without sending client room authority',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    await f.owner.client.controlLiveSession(f.campaign.id, 'end', f.live);
    const original = await f.owner.client.readCharacters(f.campaign.id);
    const library = new CampaignCharacters({
      ...original,
      catalog: f.catalog,
      store: f.owner.client,
    });
    const scene = JSON.parse(original.scene);
    scene.maps[0].name = 'Native paused preparation';
    const captured = {
      scene,
      value: encodeScene(scene, { ruleset: '2014', library }),
    };
    await library.saveScene(async () => captured);
    const prepared = await f.owner.client.readCharacters(f.campaign.id);
    assert.equal(prepared.sceneRevision, original.sceneRevision + 1);
    assert.equal(prepared.revision, original.revision);
    assert.equal(f.owner.client.pending, null);
    scene.maps[0].name = 'Native atomic paused preparation';
    library.bindScene({
      capture: async () => ({
        scene,
        value: encodeScene(scene, { ruleset: '2014', library }),
      }),
    });
    await library.edit(f.hero, { notes: 'An authorized paused native sheet edit' });
    const atomic = await f.owner.client.readCharacters(f.campaign.id);
    assert.equal(atomic.sceneRevision, prepared.sceneRevision + 1);
    assert.equal(atomic.revision, prepared.revision + 1);
    assert.equal(JSON.parse(atomic.scene).maps[0].name, scene.maps[0].name);
    assert.equal(
      new CampaignCharacters({ ...atomic, catalog: f.catalog }).get(f.hero).notes,
      'An authorized paused native sheet edit'
    );
    assert.equal((await f.owner.client.getLiveSession(f.campaign.id)).state, 'paused');
    assert.equal(f.owner.client.pending, null);
  }
);

test(
  'native control refusals remain definitive through real cloud HTTP and never trap the player in uncertain-command retry',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { ruleset: '2024', cleanup: true });
    await f.library.edit(f.hero, { fallTraits: { flySpeed: 60, hover: true } });
    const scene = structuredClone(f.scene);
    scene.creatures.find((actor) => actor.id === 'token-1').pose = {
      kind: 'flight',
      world: { x: 1.5, y: 1, z: 1.5 },
    };
    const native = gameplayRuntime(scene, f.library);
    await native.combat.startTurn(native.actors.find((actor) => actor.id === 'token-1'));
    scene.combat = native.combat.snapshot();
    const published = await publishOwner(f, {
      commandId: randomUUID(),
      sessionId: f.live.sessionId,
      presentations: [],
      change: {
        ruleset: '2024',
        revision: 1,
        charactersRevision: f.library.revision,
        scene: encodeScene(scene, f.validation),
      },
    });
    assert.equal(published.status, 200);
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await connection.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const commands = new PlayerCommandAdapter({
      connection,
      getState: () => connection.state,
      getCachedAssets: () => connection.assets,
    });
    const before = await f.owner.client.readCharacters(f.campaign.id);
    await assert.rejects(commands.send('flight.lower', 'token-1', { feet: 10 }), {
      status: 422,
      code: 'flight-blocked',
    });
    assert.equal(commands.canRetry, false);
    assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), before);
    await commands.send('facing', 'token-1', { angle: Math.PI / 2 });
    const unchanged = await f.owner.client.readCharacters(f.campaign.id);
    const raw = (kind) => ({
      version: 1,
      commandId: randomUUID(),
      kind,
      payload: {},
      sceneRevision: connection.state.sceneRevision,
      charactersRevision: connection.state.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      view: {
        mapId: connection.state.publicScene.presentation.mapId,
        assetKey: connection.state.publicScene.assetKey,
      },
    });
    for (const [kind, code] of [
      ['stand', 'stand-unavailable'],
      ['flight.takeoff', 'flight-unavailable'],
    ]) {
      await assert.rejects(connection.call('playerCommand', [f.campaign.id, raw(kind)]), {
        status: 422,
        code,
      });
      assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), unchanged);
    }
    await commands.send('facing', 'token-1', { angle: Math.PI });
    assert.equal(commands.canRetry, false);
    const saved = await f.owner.client.readCharacters(f.campaign.id);
    assert.equal(saved.sceneRevision, before.sceneRevision + 2);
    assert.equal(saved.revision, before.revision);
    const final = playerGameplayState(JSON.parse(saved.scene), f.library, [f.hero]).ownedTokens[0];
    assert.deepEqual(final.movement, { spentFeet: 0, remainingFeet: 60, allowanceFeet: 60 });
    assert.equal(final.economy.actions, 1);
  }
);

test(
  'the cloud player can undo an accepted action through current live authority',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { cleanup: true });
    const combat = structuredClone(f.scene);
    const native = gameplayRuntime(f.scene, f.library);
    await native.combat.startTurn(native.actors.find((actor) => actor.id === 'token-1'));
    combat.combat = native.combat.snapshot();
    const published = await publishOwner(f, {
      commandId: randomUUID(),
      sessionId: f.live.sessionId,
      presentations: [],
      change: {
        ruleset: '2014',
        revision: 1,
        charactersRevision: f.library.revision,
        scene: encodeScene(combat, f.validation),
      },
    });
    assert.equal(published.status, 200);
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await connection.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const command = (kind, payload, player = connection) => ({
      version: 1,
      commandId: randomUUID(),
      kind,
      payload,
      sceneRevision: player.state.sceneRevision,
      charactersRevision: player.state.revision,
      tokenId: 'token-1',
      observerTokenId: 'token-1',
      view: {
        mapId: player.state.publicScene.presentation.mapId,
        assetKey: player.state.publicScene.assetKey,
      },
    });
    await connection.call('playerCommand', [
      f.campaign.id,
      command('action.use', { actionId: 'dash', choice: {} }),
    ]);
    const used = connection.state.gameplay.ownedTokens.find((actor) => actor.tokenId === 'token-1');
    assert.equal(used.economy.actions, 0);
    assert.equal(used.canUndo, true);
    await sdk.getIdToken(f.member.auth.currentUser, true);
    const refreshed = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: 'token-1',
        mapId: 'map-main',
        assetKey: connection.state.publicScene.assetKey,
      },
      f.grant.access,
      { cachedAssets: connection.assets }
    );
    assert.equal(
      refreshed.state.gameplay.ownedTokens.find((actor) => actor.tokenId === 'token-1').canUndo,
      true
    );
    await connection.call('playerCommand', [f.campaign.id, command('action.undo', {})]);
    const undone = connection.state.gameplay.ownedTokens.find(
      (actor) => actor.tokenId === 'token-1'
    );
    assert.equal(undone.economy.actions, 1);
    assert.equal(undone.canUndo, false);
    await connection.call('playerCommand', [
      f.campaign.id,
      command('action.use', { actionId: 'dash', choice: {} }),
    ]);
    assert.equal(
      connection.state.gameplay.ownedTokens.find((actor) => actor.tokenId === 'token-1').canUndo,
      true
    );
    const email = f.member.auth.currentUser.email;
    const password = `Fixture-${randomUUID()}-1!`;
    await connection.close();
    await f.runtime.auth.updateUser(f.member.uid, { password });
    await sdk.signOut(f.member.auth);
    await sdk.signInWithEmailAndPassword(f.member.auth, email, password);
    const returning = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await returning.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const returned = returning.state.gameplay.ownedTokens.find(
      (actor) => actor.tokenId === 'token-1'
    );
    assert.equal(returned.economy.actions, 0);
    assert.equal(returned.canUndo, false);
    await assert.rejects(
      returning.call('playerCommand', [f.campaign.id, command('action.undo', {}, returning)]),
      { code: 'undo-unavailable' }
    );
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
    const { default: CloudPlayerSessionConnection } =
      await import('../../src/campaigns/CloudPlayerSessionConnection.js');
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

test(
  'cloud passage travel preserves an owner follow view without revealing an unvisited chamber',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const world = CampaignWorld.fromScene(f.scene, f.validation);
    const source = world.getMap('map-main');
    world.addLocation({
      id: 'hidden-location',
      name: 'SECRET LOCATION',
      map: { ...source, id: 'hidden-chamber', name: 'SECRET CHAMBER' },
    });
    world.addLogicalPassage({
      version: 1,
      id: 'cavern-passage',
      kind: 'chamber',
      ends: [
        { mapId: 'map-main', side: 'east' },
        { mapId: 'hidden-chamber', side: 'west' },
      ],
    });
    const connected = world.save();
    const actor = connected.creatures.find(({ id }) => id === 'token-1');
    Object.assign(actor, {
      gridX: 4,
      gridY: 2,
      pose: { kind: 'ground', world: { x: 4.5, y: 0, z: 2.5 } },
    });
    connected.view.focusTokenId = actor.id;
    connected.view.camera.target = { ...actor.pose.world };
    const existing = await f.owner.client.readCharacters(f.campaign.id);
    await f.owner.client.commitScene(f.campaign.id, {
      ruleset: f.library.ruleset,
      revision: existing.sceneRevision,
      charactersRevision: existing.revision,
      scene: encodeScene(connected, f.validation),
    });
    const before = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: actor.id,
        mapId: 'map-main',
        assetKey: null,
      },
      f.grant.access
    );
    assert.ok(!JSON.stringify(before.state).includes('hidden-chamber'));
    assert.ok(!JSON.stringify(before.state).includes('SECRET'));
    const moved = await publishPlayer(f, {
      sessionId: f.live.sessionId,
      command: {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: before.state.sceneRevision,
        charactersRevision: before.state.revision,
        observerTokenId: actor.id,
        tokenId: actor.id,
        kind: 'traverse',
        payload: { connectionId: 'cavern-passage' },
        view: { mapId: 'map-main', assetKey: before.state.publicScene.assetKey },
      },
    });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const saved = JSON.parse((await f.owner.client.readCharacters(f.campaign.id)).scene);
    assert.equal(saved.view.mapId, 'hidden-chamber');
    assert.equal(saved.view.focusTokenId, actor.id);
    assert.deepEqual(saved.view.camera.target, saved.creatures[0].pose.world);
    const after = await f.member.client.readParticipantSnapshot(
      f.campaign.id,
      {
        sessionId: f.live.sessionId,
        observerTokenId: actor.id,
        mapId: 'hidden-chamber',
        assetKey: null,
      },
      f.grant.access
    );
    assert.deepEqual(
      after.state.publicScene.assets.maps.map(({ id }) => id),
      ['hidden-chamber']
    );
    assert.ok(!JSON.stringify(after.state).includes('map-main'));
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
  'independent free-roam moves submitted from the same world both survive a fresh owner read',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const other = await f.account();
    const invite = await f.owner.client.createInvitation(f.campaign.id, { name: 'Second mover' });
    await other.client.redeemInvitation(invite);
    const joined = await other.client.getParticipantAccess(f.campaign.id);
    await f.owner.client.assignCharacter(f.campaign.id, {
      seatId: joined.access.seatId,
      accessGeneration: joined.access.accessGeneration,
      characterId: f.npc,
      assigned: true,
    });
    const grant = await other.client.getParticipantAccess(f.campaign.id);
    const view = (observerTokenId) => ({
      sessionId: f.live.sessionId,
      observerTokenId,
      mapId: 'map-main',
      assetKey: null,
    });
    const [left, right] = await Promise.all([
      f.member.client.readParticipantSnapshot(f.campaign.id, view('token-1'), f.grant.access),
      other.client.readParticipantSnapshot(f.campaign.id, view('token-2'), grant.access),
    ]);
    assert.equal(left.state.sceneRevision, right.state.sceneRevision);
    const ownerEvents = await f.openOwner();
    const playerEvents = await f.openMember();
    assert.equal((await ownerEvents.next()).value.kind, 'owner-checkpoint');
    assert.equal((await playerEvents.next()).value.kind, 'checkpoint');
    const first = playerMove(f, left, { mapId: 'map-main', gridX: 1, gridY: 2 });
    const second = playerMove(f, right, { mapId: 'map-main', gridX: 3, gridY: 2 });
    Object.assign(second.command, { tokenId: 'token-2', observerTokenId: 'token-2' });
    const results = await Promise.all([
      publishPlayer(f, first),
      publishPlayer(f, second, other, grant.access),
    ]);
    assert.deepEqual(
      results.map(({ status, body }) => [status, body.code]),
      [
        [200, undefined],
        [200, undefined],
      ]
    );
    const saved = await f.owner.client.readScene(f.campaign.id);
    assert.equal(saved.revision, left.state.sceneRevision + 2);
    assert.deepEqual(
      JSON.parse(saved.scene).creatures.map(({ id, gridX, gridY }) => [id, gridX, gridY]),
      [
        ['token-1', 1, 2],
        ['token-2', 3, 2],
      ]
    );
    const targetGeneration = left.generation + 2;
    for (const [stream, kind] of [
      [ownerEvents, 'owner-delta'],
      [playerEvents, 'delta'],
    ]) {
      const routes = [];
      let generation = left.generation;
      while (generation < targetGeneration) {
        const { value } = await stream.next();
        assert.equal(value.kind, kind, 'An already-visible actor should get a route, not a resync');
        routes.push(...(value.delta.presentations || []));
        generation = value.delta.generation;
      }
      assert.deepEqual(
        routes
          .map(({ tokenId, commandId, motion }) => [
            tokenId,
            commandId,
            motion.from.gridY,
            motion.route.at(-1).gridY,
          ])
          .sort(),
        [
          ['token-1', first.command.commandId, 1, 2],
          ['token-2', second.command.commandId, 1, 2],
        ]
      );
    }
  }
);

test(
  'DM and player share the same Free Roam board and only the genuinely blocked move is refused',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const ownerScope = (await f.owner.client.getParticipantAccess(f.campaign.id)).access;
    const linked = await f.owner.client.readCharacters(f.campaign.id);
    const board = JSON.parse(linked.scene);
    const npc = board.creatures.find(({ id }) => id === 'token-2');
    Object.assign(npc, { characterId: null, nameMode: 'custom' });
    npc.movement.speed = 30;
    await f.owner.client.commitScene(f.campaign.id, {
      ruleset: f.campaign.ruleset,
      revision: linked.sceneRevision,
      charactersRevision: linked.revision,
      scene: encodeScene(board, f.validation),
    });
    const start = await f.owner.client.readCharacters(f.campaign.id);
    const request = (base, gridX, gridY) =>
      playerMove(
        f,
        { state: { ...base, publicScene: { assetKey: null } } },
        { mapId: 'map-main', gridX, gridY }
      );
    const own = (base, x, y) => {
      const move = request(base, x, y);
      Object.assign(move.command, { tokenId: 'token-2', observerTokenId: 'token-2' });
      return move;
    };
    const [playerReply, ownerReply] = await Promise.all([
      publishPlayer(f, request(start, 1, 2)),
      f.owner.client.commitWorldCommand(f.campaign.id, own(start, 3, 2), ownerScope),
    ]);
    assert.equal(playerReply.status, 200);
    assert.equal(playerReply.body.result.freeRoam, true);
    assert.equal(ownerReply.freeRoam, true);
    assert.equal(ownerReply.presentation.motion.route.at(-1).gridY, 2);
    const middle = await f.owner.client.readCharacters(f.campaign.id);
    const blocked = await Promise.all([
      publishPlayer(f, request(middle, 2, 2)),
      publishPlayer(f, own(middle, 2, 2), f.owner, ownerScope),
    ]);
    assert.deepEqual(blocked.map(({ status }) => status).sort(), [200, 422]);
    assert.equal(blocked.find(({ status }) => status === 422).body.code, 'unreachable');
    const end = await f.owner.client.readScene(f.campaign.id);
    assert.equal(end.revision, start.sceneRevision + 3);
    const actors = JSON.parse(end.scene).creatures;
    assert.equal(actors.filter(({ gridX, gridY }) => gridX === 2 && gridY === 2).length, 1);
    await f.owner.client.controlLiveSession(
      f.campaign.id,
      'end',
      await f.owner.client.getLiveSession(f.campaign.id)
    );
    const backup = await f.owner.client.finishBackupSession(f.campaign.id);
    assert.ok(backup, 'Pause must export the latest compact movement checkpoint');
    const restored = JSON.parse(await f.owner.client.readBackup(f.campaign.id, backup.name));
    assert.equal(restored.scene, end.scene);
  }
);

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
  'membership removal during Free Roam resolution prevents scene, cost and command-receipt publication',
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
    const planning = Promise.withResolvers();
    const release = Promise.withResolvers();
    const catalog = f.store.resources.catalog.bind(f.store.resources);
    let held = false;
    f.store.resources.catalog = async (...args) => {
      const current = await catalog(...args);
      if (!held) {
        held = true;
        planning.resolve();
        await release.promise;
      }
      return current;
    };
    const pending = publishPlayer(f, request);
    try {
      await planning.promise;
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
  'a cloud flight approach publishes a paid fractional-elevation route once and same-ID recovery cannot replay it',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { ruleset: '2024', cleanup: true });
    await f.library.edit(f.hero, { fallTraits: { flySpeed: 60, hover: true } });
    const scene = structuredClone(f.scene);
    scene.creatures.find((actor) => actor.id === 'token-1').pose = {
      kind: 'flight',
      world: { x: 1.5, y: 1, z: 1.5 },
    };
    const native = gameplayRuntime(scene, f.library);
    await native.combat.startTurn(native.actors.find((actor) => actor.id === 'token-1'));
    scene.combat = native.combat.snapshot();
    await f.owner.client.commitScene(f.campaign.id, {
      ruleset: '2024',
      revision: 1,
      charactersRevision: f.library.revision,
      scene: encodeScene(scene, f.validation),
    });
    const owner = await f.openOwner();
    assert.equal((await owner.next()).value.kind, 'owner-checkpoint');
    const connection = f.track(
      new CloudPlayerSessionConnection({
        store: f.member.client,
        campaignId: f.campaign.id,
        access: f.grant.access,
        sessionId: f.live.sessionId,
      })
    );
    await connection.open({ observerTokenId: 'token-1', mapId: 'map-main' });
    const command = {
      version: 1,
      commandId: randomUUID(),
      kind: 'move',
      tokenId: 'token-1',
      observerTokenId: 'token-1',
      sceneRevision: connection.state.sceneRevision,
      charactersRevision: connection.state.revision,
      view: { mapId: 'map-main', assetKey: connection.state.publicScene.assetKey },
      payload: {
        target: { mapId: 'map-main', gridX: 2, gridY: 1, elevationFeet: 1 },
        closest: true,
      },
    };
    const accepted = await connection.call('playerCommand', [f.campaign.id, command]);
    assert.equal(accepted.outcome, 'applied');
    assert.equal(accepted.receipt.costFeet, 9);
    assert.deepEqual(connection.state.gameplay.ownedTokens[0].movement, {
      spentFeet: 9,
      remainingFeet: 51,
      allowanceFeet: 60,
    });
    const delivered = (await owner.next()).value;
    assert.equal(delivered.kind, 'owner-delta');
    const motion = delivered.delta.presentations[0].motion;
    assert.equal(motion.kind, 'fly');
    assert.deepEqual(motion.from.pose.world, { x: 1.5, y: 1, z: 1.5 });
    assert.deepEqual(
      motion.route.map((point) => point.pose.world),
      [
        { x: 1.5, y: 0.2, z: 1.5 },
        { x: 2.5, y: 0.2, z: 1.5 },
      ]
    );
    const canonical = await f.owner.client.readCharacters(f.campaign.id);
    const repeated = await connection.call('playerCommand', [f.campaign.id, command]);
    assert.equal(repeated.outcome, 'duplicate');
    assert.equal(repeated.receipt.motion, undefined);
    assert.deepEqual(await f.owner.client.readCharacters(f.campaign.id), canonical);
  }
);

test(
  'cloud native takeoff, airborne steps, elevation and fall deliver owner routes with one canonical movement debit',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t, { ruleset: '2024' });
    let seed = 13;
    f.store.worldDice = new PhysicalDice({
      root: path.resolve(__dirname, '..', '..'),
      random: () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        return seed / 4294967296;
      },
    });
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
      if (kind === 'flight.drop') {
        const roll = accepted.presentation.roll;
        assert.equal(roll.mapId, 'map-main');
        assert.equal(roll.physical, true);
        assert.deepEqual(
          roll.physics.map(({ type, sides, color, cocked }) => ({ type, sides, color, cocked })),
          [{ type: 'physical-die', sides: 6, color: 'ocean', cocked: false }]
        );
        assert.deepEqual(
          roll.values,
          roll.physics.map(({ value }) => value)
        );
      }
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
