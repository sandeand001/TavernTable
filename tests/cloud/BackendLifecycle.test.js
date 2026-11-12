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
const { pilotAccountKey } = require('../../tools/cloud/account-access.js');
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
        process.on('message', value => {
          if (value?.type !== 'arm-publication') return;
          holdPublication = true;
          process.send({ type: 'armed' });
        });
        const bucketFile = runtime.bucket.file.bind(runtime.bucket);
        runtime.bucket.file = (...args) => {
          const file = bucketFile(...args);
          const save = file.save.bind(file);
          file.save = async (...options) => {
            const result = await save(...options);
            if (holdPublication) {
              holdPublication = false;
              process.send({ type: 'publication-held' });
              return new Promise(() => {});
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
        });
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
    backend,
    store,
    library,
    campaign,
    commands,
    start,
    client,
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
