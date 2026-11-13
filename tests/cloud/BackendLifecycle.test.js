const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn, execFile } = require('node:child_process');
const { once } = require('node:events');
const { promisify } = require('node:util');
const sdk = require('firebase/auth');
const {
  createEmulatorRuntime,
  readEmulatorEnvironment,
} = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { HostResources } = require('../../tools/host-resources.js');
const { signedInIdentity } = require('./helpers/accounts.js');
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
const { sceneState } = require('../helpers/sceneState.js');

const root = path.resolve(__dirname, '..', '..');
const execute = promisify(execFile);

function messageFrom(child, type) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error('The demo backend event timed out')), 15000);
    const message = (value) => {
      if (value?.type === type) finish(null, value);
      else if (value?.type === 'failed') finish(new Error('The demo backend could not start'));
      else if (value?.type === 'journal-failed')
        finish(new Error('The replacement journal request failed: ' + value.code));
    };
    const exited = () => finish(new Error('The demo backend exited before its expected event'));
    const failed = (error) => finish(error);
    const finish = (error, value) => {
      clearTimeout(timer);
      child.off('message', message);
      child.off('exit', exited);
      child.off('error', failed);
      if (error) reject(error);
      else resolve(value);
    };
    child.on('message', message);
    child.once('exit', exited);
    child.once('error', failed);
  });
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  assert.ok(Number.isInteger(child.pid) && child.pid > 0);
  const exited = once(child, 'exit');
  if (process.platform === 'win32')
    await execute(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Stop-Process -Id ${child.pid} -Force -ErrorAction Stop`,
      ],
      { windowsHide: true, timeout: 10000 }
    );
  else assert.equal(child.kill('SIGKILL'), true);
  await exited;
}

function savePhase(store, phase) {
  let stop = () => {};
  let matched = false;
  let timer;
  const ready = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('The expected cloud save state did not arrive')),
      15000
    );
    stop = store.subscribeSave((state) => {
      if (state.phase !== phase) return;
      matched = true;
      resolve(state);
    });
  });
  if (matched) stop();
  return ready.finally(() => {
    clearTimeout(timer);
    stop();
  });
}

async function fixture(t) {
  const runtime = await createEmulatorRuntime();
  const config = readEmulatorEnvironment();
  const processes = [];
  const identities = [];
  t.after(async () => {
    const errors = [];
    for (const entry of processes) {
      try {
        await terminate(entry.child);
        await fs.rm(entry.cwd, { recursive: true, force: true });
      } catch (error) {
        errors.push(error);
      }
    }
    const closed = await Promise.allSettled([
      ...identities.map((identity) => identity.close()),
      runtime.close(),
    ]);
    errors.push(
      ...closed.filter((entry) => entry.status === 'rejected').map((entry) => entry.reason)
    );
    if (errors.length) throw new AggregateError(errors, 'Backend lifecycle fixtures did not close');
  });
  const manifest = JSON.parse(
    await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8')
  );
  const resources = new HostResources({ root, manifest });
  const identity = await signedInIdentity(runtime);
  identities.push(identity);
  const approve = (uid) =>
    runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(uid))
      .set({ version: 1, uid, enabled: true });
  await approve(identity.uid);
  const presenceAccess = new CloudAccountAccess({
    auth: runtime.auth,
    firestore: runtime.firestore,
  });
  const presencePrincipal = await presenceAccess.verifyIdentity('Bearer ' + identity.token);
  let presenceOffset = 0;
  const presenceStore = new CloudCampaignStore({
    firestore: runtime.firestore,
    access: presenceAccess,
    packs: manifest.packs,
    now: () => Date.now() + presenceOffset,
  });

  const start = async (port = 0) => {
    const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-cloud-backend-'));
    const bootstrap = `
      const { randomUUID } = require('node:crypto');
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const root = ${JSON.stringify(root)};
      const { createEmulatorRuntime } = require(path.join(root, 'tools', 'cloud', 'emulator-runtime.js'));
      const { CloudAccountAccess } = require(path.join(root, 'tools', 'cloud', 'account-access.js'));
      const { CloudCampaignStore } = require(path.join(root, 'tools', 'cloud', 'campaign-store.js'));
      const { ImmutableCloudObjects } = require(path.join(root, 'tools', 'cloud', 'immutable-objects.js'));
      const { HostResources } = require(path.join(root, 'tools', 'host-resources.js'));
      const { cloudApi } = require(path.join(root, 'tests', 'cloud', 'helpers', 'http.js'));
      (async () => {
        const runtime = await createEmulatorRuntime();
        let holdPublication = false;
        let releasePublication = null;
        let holdStagedRead = false;
        let holdAnnouncement = false;
        let excludedReadPath = null;
        let clockOffset = 0;
        process.on('message', value => {
          if (value?.type === 'arm-announcement') {
            holdAnnouncement = true;
            process.send({ type: 'armed' });
            return;
          }
          if (value?.type === 'read-journal') {
            void (async () => {
              const principal = await access.verifyAuthorization('Bearer ' + value.token);
              const result = await store.readCommittedChanges(principal, value.campaignId, {
                afterGeneration: value.afterGeneration,
              });
              process.send({ type: 'journal-read', result });
            })().catch(error => process.send({ type: 'journal-failed', code: error.code || 'journal-failed' }));
            return;
          }
          if (value?.type === 'advance-clock') {
            clockOffset = value.milliseconds;
            process.send({ type: 'clock-advanced' });
            return;
          }
          if (value?.type === 'arm-staged-read') {
            holdStagedRead = true;
            excludedReadPath = value.exclude;
            process.send({ type: 'armed' });
            return;
          }
          if (value?.type === 'release-publication') {
            releasePublication?.();
            return;
          }
          if (value?.type !== 'arm-publication') return;
          holdPublication = true;
          process.send({ type: 'armed' });
        });
        const bucketFile = runtime.bucket.file.bind(runtime.bucket);
        runtime.bucket.file = (...args) => {
          const file = bucketFile(...args);
          const download = file.download.bind(file);
          file.download = async (...options) => {
            const bytes = await download(...options);
            if (holdStagedRead && args[0] !== excludedReadPath && args[0].includes('/objects/characters/')) {
              holdStagedRead = false;
              process.send({ type: 'staged-read-held' });
              await new Promise(resolve => { releasePublication = resolve; });
            }
            return bytes;
          };
          const save = file.save.bind(file);
          file.save = async (...options) => {
            const result = await save(...options);
            if (holdPublication) {
              holdPublication = false;
              process.send({ type: 'publication-held' });
              return new Promise(resolve => { releasePublication = resolve; });
            }
            return result;
          };
          return file;
        };
        const objects = new ImmutableCloudObjects({ bucket: runtime.bucket });
        const manifest = JSON.parse(await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8'));
        const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
        const store = new CloudCampaignStore({
          firestore: runtime.firestore,
          access,
          packs: manifest.packs,
          resources: new HostResources({ root, manifest }),
          objects,
          now: () => Date.now() + clockOffset,
        });
        const commitCharacters = store.commitCharacters.bind(store);
        store.commitCharacters = async (...args) => {
          const result = await commitCharacters(...args);
          if (holdAnnouncement) {
            holdAnnouncement = false;
            process.send({ type: 'announcement-held' });
            await new Promise(resolve => { releasePublication = resolve; });
          }
          return result;
        };
        const api = await cloudApi({ access, store, port: ${port} });
        process.send({ type: 'ready', url: api.url, instance: randomUUID() });
      })().catch(() => {
        process.send({ type: 'failed' });
        process.exitCode = 1;
      });
    `;
    const child = spawn(process.execPath, ['-e', bootstrap], {
      cwd,
      env: process.env,
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      windowsHide: true,
    });
    processes.push({ child, cwd });
    const ready = await messageFrom(child, 'ready');
    assert.equal((await fetch(new URL('/api/cloud/account', ready.url))).status, 401);
    return { ...ready, child, port: Number(new URL(ready.url).port) };
  };
  let discardNextReply = false;
  const commands = [];
  const network = async (url, options) => {
    if (options.method === 'POST') commands.push(options.body);
    const response = await fetch(url, options);
    if (discardNextReply && options.method === 'POST') {
      discardNextReply = false;
      assert.equal(response.status, 200);
      await response.clone().json();
      throw new TypeError('Synthetic lost reply after real publication');
    }
    return response;
  };
  const client = (url, accountIdentity = identity) =>
    new CloudCampaignClientStore({
      uid: accountIdentity.uid,
      packs: manifest.packs,
      connection: new CloudAccountConnection({
        account: new CloudAccount({ auth: accountIdentity.auth, sdk }),
        baseURL: 'http://127.0.0.1:4300/',
        fetch: network,
        runtime: {
          version: 1,
          mode: 'cloud',
          environment: 'emulator',
          apiOrigin: url,
          authEmulatorOrigin: `http://${config.authHost}`,
          firebase: {
            apiKey: 'demo-api-key',
            projectId: config.projectId,
            authDomain: `${config.projectId}.firebaseapp.com`,
            appId: 'demo-backend-lifecycle',
          },
        },
      }),
    });
  const backend = await start();
  const store = client(backend.url);
  const campaign = await store.create({ name: 'Process lifecycle fixture', ruleset: '2014' });
  const library = new CampaignCharacters({
    ...(await store.readCharacters(campaign.id)),
    store,
    catalog: await resources.catalog(campaign),
  });
  const actorId = await library.create('Lifecycle scout');
  const capture = (engine) => {
    const actor = engine.get(actorId);
    const validation = { library: engine, ruleset: '2014' };
    const scene = CampaignWorld.fromScene(
      sceneState({ characterId: actor.id, name: actor.name }),
      validation
    ).save();
    return { scene, value: encodeScene(scene, validation) };
  };
  library.bindScene({ capture });
  await library.saveScene(capture);
  return {
    runtime,
    identity,
    resources,
    manifest,
    backend,
    store,
    library,
    campaign,
    commands,
    start,
    client,
    connectPresence(sessionId, milliseconds) {
      presenceOffset = milliseconds;
      return presenceStore.connectLivePresence(presencePrincipal, campaign.id, { sessionId });
    },
    discardReply: () => {
      discardNextReply = true;
    },
    async stranger() {
      const stranger = await signedInIdentity(runtime);
      identities.push(stranger);
      await approve(stranger.uid);
      return client(backend.url, stranger);
    },
  };
}

test(
  'an actual backend kill after commit but before announcement preserves one ordered journal event and original receipt',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const reference = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
    const before = (await reference.get()).data();
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-announcement' });
    await armed;
    const held = messageFrom(f.backend.child, 'announcement-held');
    const pending = f.library.create('Committed before lost announcement');
    await held;
    const originalBody = f.commands.at(-1);
    const commandId = JSON.parse(originalBody).commandId;
    const committed = (await reference.get()).data();
    assert.equal(committed.generation, before.generation + 1);
    assert.equal(
      (await reference.collection('changes').doc(String(committed.generation)).get()).exists,
      true
    );
    const receipt = f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(f.identity.uid))
      .collection('receipts')
      .doc(commandId);
    assert.equal((await receipt.get()).exists, true);
    const uncertain = savePhase(f.store, 'uncertain');
    await terminate(f.backend.child);
    await uncertain;
    const replacement = await f.start(f.backend.port);
    assert.notEqual(replacement.instance, f.backend.instance);
    const read = messageFrom(replacement.child, 'journal-read');
    replacement.child.send({
      type: 'read-journal',
      token: f.identity.token,
      campaignId: f.campaign.id,
      afterGeneration: before.generation,
    });
    const recovered = (await read).result;
    assert.equal(recovered.resync, null);
    assert.equal(recovered.changes.length, 1);
    assert.equal(recovered.changes[0].generation, committed.generation);
    await f.store.retryPending();
    const createdId = await pending;
    assert.equal(f.commands.at(-1), originalBody);
    assert.deepEqual((await reference.get()).data(), committed);
    const repeated = messageFrom(replacement.child, 'journal-read');
    replacement.child.send({
      type: 'read-journal',
      token: f.identity.token,
      campaignId: f.campaign.id,
      afterGeneration: before.generation,
    });
    assert.deepEqual((await repeated).result, recovered);
    const current = new CampaignCharacters({
      ...(await f.client(replacement.url).readCharacters(f.campaign.id)),
      catalog: await f.resources.catalog(f.campaign),
      store: f.store,
    });
    assert.equal(current.get(createdId).name, 'Committed before lost announcement');
  }
);

test(
  'live-game state and owner receipts survive actual backend replacement without resetting canonical data',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const before = await f.store.readCharacters(f.campaign.id);
    const initial = await f.store.getLiveSession(f.campaign.id);
    const active = await f.store.controlLiveSession(f.campaign.id, 'start', initial);
    const startBody = f.commands.at(-1);
    await terminate(f.backend.child);
    const replacement = await f.start(f.backend.port);
    assert.notEqual(replacement.instance, f.backend.instance);
    const clean = f.client(replacement.url);
    assert.deepEqual(await clean.getLiveSession(f.campaign.id), active);
    const request = await fetch(`${replacement.url}/api/cloud/campaigns/${f.campaign.id}/live`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + f.identity.token, 'Content-Type': 'application/json' },
      body: startBody,
    });
    assert.equal(request.status, 200);
    assert.deepEqual((await request.json()).result, active);
    const ended = await clean.controlLiveSession(f.campaign.id, 'end', active);
    assert.equal(ended.state, 'paused');
    assert.deepEqual(await f.store.getLiveSession(f.campaign.id), ended);
    assert.deepEqual(await clean.readCharacters(f.campaign.id), before);
  }
);

test(
  'a terminated backend cannot keep abandoned presence alive and a cold wake preserves the original grace deadline',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const before = await f.store.readCharacters(f.campaign.id);
    const active = await f.store.controlLiveSession(
      f.campaign.id,
      'start',
      await f.store.getLiveSession(f.campaign.id)
    );
    const connection = await f.connectPresence(active.sessionId, 0);
    await terminate(f.backend.child);
    const replacement = await f.start(f.backend.port);
    const advanced = messageFrom(replacement.child, 'clock-advanced');
    replacement.child.send({ type: 'advance-clock', milliseconds: 17 * 60 * 1000 });
    await advanced;
    const clean = f.client(replacement.url);
    const status = await clean.getLiveStatus(f.campaign.id);
    assert.equal(status.session.state, 'paused');
    assert.equal(status.session.pauseReason, 'disconnected');
    assert.equal(
      status.session.pausedAt,
      new Date(connection.expiresAt + 15 * 60 * 1000).toISOString()
    );
    assert.equal(status.session.lastMeaningfulAt, active.lastMeaningfulAt);
    assert.deepEqual(await clean.readCharacters(f.campaign.id), before);
  }
);

test(
  'a cold replacement evaluates the original inactivity deadline without renewing on reconnect or receipt replay',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const before = await f.store.readCharacters(f.campaign.id);
    const active = await f.store.controlLiveSession(
      f.campaign.id,
      'start',
      await f.store.getLiveSession(f.campaign.id)
    );
    const startBody = f.commands.at(-1);
    for (let minutes = 10; minutes <= 50; minutes += 10)
      await f.connectPresence(active.sessionId, minutes * 60 * 1000);
    const warned = messageFrom(f.backend.child, 'clock-advanced');
    f.backend.child.send({ type: 'advance-clock', milliseconds: 55 * 60 * 1000 });
    await warned;
    const warning = await f.store.getLiveStatus(f.campaign.id);
    assert.equal(warning.activity.phase, 'warning');
    assert.deepEqual(warning.session, active);
    await terminate(f.backend.child);
    const reference = f.runtime.firestore
      .collection('campaigns')
      .doc(f.campaign.id)
      .collection('liveSession')
      .doc('current');
    assert.deepEqual((await reference.get()).data(), active);
    const replacement = await f.start(f.backend.port);
    const advanced = messageFrom(replacement.child, 'clock-advanced');
    replacement.child.send({ type: 'advance-clock', milliseconds: 61 * 60 * 1000 });
    await advanced;
    const replay = await fetch(`${replacement.url}/api/cloud/campaigns/${f.campaign.id}/live`, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + f.identity.token, 'Content-Type': 'application/json' },
      body: startBody,
    });
    assert.equal(replay.status, 200);
    assert.deepEqual((await replay.json()).result, active);
    const clean = f.client(replacement.url);
    const status = await clean.getLiveStatus(f.campaign.id);
    assert.equal(status.activity.phase, 'paused');
    assert.deepEqual(status.session, {
      ...active,
      generation: active.generation + 1,
      state: 'paused',
      pausedAt: new Date(Date.parse(active.lastMeaningfulAt) + 60 * 60 * 1000).toISOString(),
      pauseReason: 'inactivity',
    });
    assert.deepEqual((await reference.get()).data(), status.session);
    assert.deepEqual(await clean.readCharacters(f.campaign.id), before);
  }
);

test(
  'owner preparation published after inactivity expiry remains durable without reviving or resetting the game',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const before = await f.store.readCharacters(f.campaign.id);
    const active = await f.store.controlLiveSession(
      f.campaign.id,
      'start',
      await f.store.getLiveSession(f.campaign.id)
    );
    for (let minutes = 10; minutes <= 50; minutes += 10)
      await f.connectPresence(active.sessionId, minutes * 60 * 1000);
    let advanced = messageFrom(f.backend.child, 'clock-advanced');
    f.backend.child.send({ type: 'advance-clock', milliseconds: 59 * 60 * 1000 });
    await advanced;
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-publication' });
    await armed;
    const held = messageFrom(f.backend.child, 'publication-held');
    const pending = f.library.create('Prepared across inactivity boundary');
    await held;
    advanced = messageFrom(f.backend.child, 'clock-advanced');
    f.backend.child.send({ type: 'advance-clock', milliseconds: 61 * 60 * 1000 });
    await advanced;
    f.backend.child.send({ type: 'release-publication' });
    const createdId = await pending;
    const status = await f.store.getLiveStatus(f.campaign.id);
    assert.equal(status.session.state, 'paused');
    assert.equal(status.session.pauseReason, 'inactivity');
    assert.equal(status.session.lastMeaningfulAt, active.lastMeaningfulAt);
    assert.equal(
      status.session.pausedAt,
      new Date(Date.parse(active.lastMeaningfulAt) + 60 * 60 * 1000).toISOString()
    );
    const after = await f.store.readCharacters(f.campaign.id);
    assert.equal(after.revision, before.revision + 1);
    assert.deepEqual(JSON.parse(after.scene).combat, JSON.parse(before.scene).combat);
    const saved = new CampaignCharacters({
      ...after,
      store: f.store,
      catalog: await f.resources.catalog(after.campaign),
    });
    assert.equal(saved.get(createdId).name, 'Prepared across inactivity boundary');
    await terminate(f.backend.child);
    const replacement = await f.start(f.backend.port);
    assert.deepEqual(await f.client(replacement.url).getLiveSession(f.campaign.id), status.session);
  }
);

test(
  'a stalled verified object cannot publish after cleanup and the same caller retries with a new generation',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const headReference = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
    const before = (await headReference.get()).data();
    const access = new CloudAccountAccess({ auth: f.runtime.auth, firestore: f.runtime.firestore });
    const principal = await access.verifyAuthorization('Bearer ' + f.identity.token);
    let now = Date.now();
    const cleaner = new CloudCampaignStore({
      firestore: f.runtime.firestore,
      access,
      packs: f.manifest.packs,
      resources: f.resources,
      objects: new ImmutableCloudObjects({ bucket: f.runtime.bucket }),
      now: () => now,
    });
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-staged-read', exclude: before.charactersRef.path });
    await armed;
    const held = messageFrom(f.backend.child, 'staged-read-held');
    const pending = f.library.create('Stalled until object cleanup');
    await held;
    const originalBody = f.commands.at(-1);
    const [staged] = await f.runtime.bucket.getFiles({
      prefix: `campaigns/${f.campaign.id}/objects/characters/`,
    });
    const candidate = staged.find((file) => file.name !== before.charactersRef.path);
    assert.ok(candidate);
    const originalGeneration = candidate.metadata.generation;
    now = Date.now();
    assert.equal((await cleaner.maintainObjects(principal, f.campaign.id)).quarantined, 1);
    now += 24 * 60 * 60 * 1000;
    assert.equal((await cleaner.maintainObjects(principal, f.campaign.id)).deleted, 1);
    const advanced = messageFrom(f.backend.child, 'clock-advanced');
    f.backend.child.send({ type: 'advance-clock', milliseconds: 24 * 60 * 60 * 1000 });
    await advanced;
    const uncertain = savePhase(f.store, 'uncertain');
    f.backend.child.send({ type: 'release-publication' });
    const state = await uncertain;
    assert.equal(state.error.code, 'object-publication-expired');
    assert.deepEqual((await headReference.get()).data(), before);
    await f.store.retryPending();
    const id = await pending;
    assert.equal(f.commands.filter((body) => body === originalBody).length, 2);
    const after = (await headReference.get()).data();
    assert.equal(after.generation, before.generation + 1);
    assert.notEqual(after.charactersRef.generation, originalGeneration);
    const reopened = new CampaignCharacters({
      ...(await f.store.readCharacters(f.campaign.id)),
      store: f.store,
      catalog: await f.resources.catalog(after.campaign),
    });
    assert.equal(reopened.get(id).name, 'Stalled until object cleanup');
    assert.equal(reopened.list().filter((character) => character.id === id).length, 1);
  }
);

test(
  'an uploaded complete backup survives a backend kill before publication and wakes as one original private point',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.readCharacters(f.campaign.id);
    const headReference = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
    const originalHead = (await headReference.get()).data();
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-publication' });
    await armed;
    const held = messageFrom(f.backend.child, 'publication-held');
    const pending = f.store.backupNow(f.campaign.id).then(
      (record) => ({ record }),
      (error) => ({ error })
    );
    await held;
    const originalBody = f.commands.at(-1);
    const commandId = JSON.parse(originalBody).commandId;
    const history = headReference.collection('backups').doc(commandId);
    const receipt = f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(f.identity.uid))
      .collection('receipts')
      .doc(commandId);
    assert.equal((await history.get()).exists, false);
    assert.equal((await receipt.get()).exists, false);
    const [files] = await f.runtime.bucket.getFiles({
      prefix: `campaigns/${f.campaign.id}/backups/${commandId}/`,
    });
    assert.equal(files.length, 1);
    const [bytes] = await files[0].download();
    const complete = JSON.parse(bytes.toString('utf8'));
    assert.deepEqual(complete.records, source.records);
    assert.equal(complete.scene, source.scene);
    assert.equal((await f.store.backupStatus(f.campaign.id)).state, 'pending');
    await terminate(f.backend.child);
    assert.ok((await pending).error);
    const replacement = await f.start(f.backend.port);
    assert.notEqual(replacement.instance, f.backend.instance);
    const clean = f.client(replacement.url);
    const awakened = await clean.backupStatus(f.campaign.id);
    assert.equal(awakened.state, 'saved');
    assert.equal(awakened.latest.name, commandId);
    const recovered = await f.store.backupNow(f.campaign.id);
    assert.equal(recovered.name, commandId);
    assert.equal(f.commands.at(-1), originalBody);
    assert.equal((await clean.listBackups(f.campaign.id)).length, 1);
    assert.deepEqual((await headReference.get()).data(), originalHead);
    assert.deepEqual(await clean.readCharacters(f.campaign.id), source);
    const saved = JSON.parse(await clean.readBackup(f.campaign.id, commandId));
    assert.deepEqual(saved.records, source.records);
    assert.equal(saved.scene, source.scene);
  }
);

test(
  'a delayed older backup cannot become the newest restore point or move the automatic baseline backwards',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const original = (
      await f.runtime.firestore.collection('campaigns').doc(f.campaign.id).get()
    ).data();
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-publication' });
    await armed;
    const held = messageFrom(f.backend.child, 'publication-held');
    const older = f.store.backupNow(f.campaign.id);
    await held;
    await f.library.create('Accepted while the older backup is in progress');
    const concurrent = await f.start();
    const client = f.client(concurrent.url);
    const newer = await client.backupNow(f.campaign.id);
    f.backend.child.send({ type: 'release-publication' });
    const delayed = await older;
    const history = await client.listBackups(f.campaign.id);
    assert.deepEqual(
      history.map((record) => record.name),
      [newer.name, delayed.name]
    );
    assert.equal(newer.generation, original.generation + 1);
    assert.equal(delayed.generation, original.generation);
    assert.equal((await client.backupStatus(f.campaign.id)).latest.name, newer.name);
    assert.equal(JSON.parse(await client.readBackup(f.campaign.id, newer.name)).records.length, 2);
    assert.equal(
      JSON.parse(await client.readBackup(f.campaign.id, delayed.name)).records.length,
      1
    );
    assert.equal((await client.listBackups(f.campaign.id)).length, 2);
  }
);

test(
  'losing a backup intent after actual upload cannot publish a success-shaped history or receipt',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const headReference = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
    const originalHead = (await headReference.get()).data();
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-publication' });
    await armed;
    const held = messageFrom(f.backend.child, 'publication-held');
    const pending = f.store.backupNow(f.campaign.id);
    await held;
    const commandId = JSON.parse(f.commands.at(-1)).commandId;
    const account = f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(f.identity.uid));
    await account.collection('claims').doc(commandId).delete();
    const rejected = assert.rejects(pending, (error) => error.code === 'invalid-backup-state');
    f.backend.child.send({ type: 'release-publication' });
    await rejected;
    assert.equal((await account.collection('receipts').doc(commandId).get()).exists, false);
    assert.equal((await headReference.collection('backups').doc(commandId).get()).exists, false);
    assert.deepEqual((await headReference.get()).data(), originalHead);
    const status = await f.store.backupStatus(f.campaign.id);
    assert.equal(status.state, 'error');
    assert.equal(status.latest, null);
  }
);

test(
  'an interrupted multipart import resumes through a fresh backend process without exposing or duplicating a campaign',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const source = await f.store.readCharacters(f.campaign.id);
    const text = await f.store.exportBackup(f.campaign.id);
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-publication' });
    await armed;
    const held = messageFrom(f.backend.child, 'publication-held');
    const uncertain = savePhase(f.store, 'uncertain');
    const pending = f.store.importBackup(text);
    await held;
    const importId = f.store.saveState.commandId;
    const job = (
      await f.runtime.firestore
        .collection('accountImports')
        .doc(pilotAccountKey(f.identity.uid))
        .collection('transfers')
        .doc(importId)
        .get()
    ).data();
    assert.equal(job.state, 'uploading');
    assert.equal(
      (await f.runtime.firestore.collection('campaigns').doc(job.campaignId).get()).exists,
      false
    );
    assert.equal((await f.store.list()).length, 1);
    await terminate(f.backend.child);
    await uncertain;
    const replacement = await f.start(f.backend.port);
    assert.notEqual(replacement.instance, f.backend.instance);
    const imported = await f.store.retryPending();
    assert.deepEqual(await pending, imported);
    assert.equal(imported.id, job.campaignId);
    const clean = f.client(replacement.url);
    const state = await clean.readCharacters(imported.id);
    assert.deepEqual(state.records, source.records);
    assert.equal(state.scene, source.scene);
    assert.equal((await clean.list()).length, 2);
    const starts = f.commands
      .map((body) => JSON.parse(body))
      .filter((body) => body.commandId === importId && Number.isSafeInteger(body.bytes));
    assert.equal(starts.length, 2);
    assert.deepEqual(starts[0], starts[1]);
    assert.equal(
      (
        await f.runtime.firestore
          .collection('accountUsage')
          .doc(pilotAccountKey(f.identity.uid))
          .get()
      ).data().ownedCampaigns,
      2
    );
  }
);

test(
  'an acknowledged canonical scene and lost character reply survive an actual backend process kill and same-command recovery',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const baseline = await f.store.readCharacters(f.campaign.id);
    assert.equal(baseline.revision, 1);
    assert.equal(baseline.sceneRevision, 1);
    f.discardReply();
    const uncertain = savePhase(f.store, 'uncertain');
    const pending = f.library.create('Recovered after termination');
    await uncertain;
    const originalBody = f.commands.at(-1);
    const committed = await f.store.readCharacters(f.campaign.id);
    assert.equal(committed.revision, baseline.revision + 1);
    assert.equal(committed.sceneRevision, baseline.sceneRevision + 1);
    await terminate(f.backend.child);
    const replacement = await f.start(f.backend.port);
    assert.notEqual(replacement.instance, f.backend.instance);
    await f.store.retryPending();
    const createdId = await pending;
    assert.equal(f.commands.at(-1), originalBody);
    const clean = f.client(replacement.url);
    assert.deepEqual(await clean.readCharacters(f.campaign.id), committed);
    const reopened = new CampaignCharacters({
      ...(await clean.readCharacters(f.campaign.id)),
      store: clean,
      catalog: await f.resources.catalog(committed.campaign),
    });
    assert.deepEqual(reopened.list(), f.library.list());
    assert.equal(
      reopened.list().filter((entry) => entry.name === 'Recovered after termination').length,
      1
    );
    assert.equal(reopened.get(createdId).id, createdId);
    const stranger = await f.stranger();
    assert.deepEqual(await stranger.list(), []);
    await assert.rejects(stranger.readScene(f.campaign.id), { code: 'campaign-not-found' });
  }
);

test(
  'termination after real uploads but before publication leaves the committed head intact and recovers one original change',
  { timeout: 60000 },
  async (t) => {
    const f = await fixture(t);
    const baseline = await f.store.readCharacters(f.campaign.id);
    const headReference = f.runtime.firestore.collection('campaigns').doc(f.campaign.id);
    const originalHead = (await headReference.get()).data();
    const prefix = `campaigns/${f.campaign.id}/objects/`;
    const [originalFiles] = await f.runtime.bucket.getFiles({ prefix });
    const armed = messageFrom(f.backend.child, 'armed');
    f.backend.child.send({ type: 'arm-publication' });
    await armed;
    const held = messageFrom(f.backend.child, 'publication-held');
    const uncertain = savePhase(f.store, 'uncertain');
    const pending = f.library.create('Unpublished before termination');
    await held;
    const originalBody = f.commands.at(-1);
    const commandId = JSON.parse(originalBody).commandId;
    const receiptReference = f.runtime.firestore
      .collection('accountCommands')
      .doc(pilotAccountKey(f.identity.uid))
      .collection('receipts')
      .doc(commandId);
    const [stagedFiles] = await f.runtime.bucket.getFiles({ prefix });
    assert.ok(
      stagedFiles.length > originalFiles.length,
      'Real candidates must exist before termination'
    );
    assert.deepEqual(await f.store.readCharacters(f.campaign.id), baseline);
    assert.deepEqual((await headReference.get()).data(), originalHead);
    assert.equal((await receiptReference.get()).exists, false);
    await terminate(f.backend.child);
    await uncertain;
    const replacement = await f.start(f.backend.port);
    assert.notEqual(replacement.instance, f.backend.instance);
    await f.store.retryPending();
    const createdId = await pending;
    assert.equal(f.commands.at(-1), originalBody);
    const clean = f.client(replacement.url);
    const recovered = await clean.readCharacters(f.campaign.id);
    assert.equal(recovered.revision, baseline.revision + 1);
    assert.equal(recovered.sceneRevision, baseline.sceneRevision + 1);
    assert.equal((await headReference.get()).data().generation, originalHead.generation + 1);
    assert.equal((await receiptReference.get()).exists, true);
    const reopened = new CampaignCharacters({
      ...recovered,
      store: clean,
      catalog: await f.resources.catalog(recovered.campaign),
    });
    assert.deepEqual(reopened.list(), f.library.list());
    assert.equal(reopened.get(createdId).name, 'Unpublished before termination');
    assert.equal(
      reopened.list().filter((entry) => entry.name === 'Unpublished before termination').length,
      1
    );
  }
);
