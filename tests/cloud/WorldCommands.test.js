const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
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

async function fixture(t, { ruleset = '2014' } = {}) {
  const runtime = await createEmulatorRuntime();
  const identities = [];
  const events = [];
  let api = null;
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
  const account = async () => {
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
  const member = await account();
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
  return {
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

test(
  'the cloud player connection publishes native public state and returns an authoritative command without another snapshot request',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
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
    const f = await fixture(t);
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
