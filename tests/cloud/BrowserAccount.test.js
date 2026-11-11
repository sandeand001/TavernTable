const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const sdk = require('firebase/auth');
const {
  createEmulatorRuntime,
  readEmulatorEnvironment,
} = require('../../tools/cloud/emulator-runtime.js');
const { default: CloudAccount } = require('../../src/campaigns/CloudAccount.js');
const {
  default: CloudAccountConnection,
} = require('../../src/campaigns/CloudAccountConnection.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { cloudApi } = require('./helpers/http.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { HostResources } = require('../../tools/host-resources.js');
const {
  default: CloudCampaignClientStore,
} = require('../../src/campaigns/CloudCampaignClientStore.js');
const { default: CampaignCharacters } = require('../../src/campaigns/CampaignCharacters.js');
const { default: CampaignWorld } = require('../../src/campaigns/CampaignWorld.js');
const { encodeScene } = require('../../src/campaigns/CampaignScene.js');
const { sceneState } = require('../helpers/sceneState.js');

test(
  'the browser account adapter signs into the same managed UID and never exposes a global role or stale token context',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const config = readEmulatorEnvironment();
    const uid = `browser-account-${randomUUID()}`;
    const email = `${uid}@example.invalid`;
    const password = `Fixture-${randomUUID()}-1!`;
    await runtime.auth.createUser({ uid, email, password, emailVerified: true });
    const app = initializeApp({ apiKey: 'demo-api-key', projectId: config.projectId }, uid);
    const auth = sdk.getAuth(app);
    sdk.connectAuthEmulator(auth, `http://${config.authHost}`);
    t.after(async () => {
      try {
        await sdk.signOut(auth);
      } finally {
        await deleteApp(app);
      }
    });
    const account = new CloudAccount({ auth, sdk });
    const identity = await account.signInEmail(email, password);
    assert.equal(identity.uid, uid);
    assert.equal(identity.emailVerified, true);
    assert.equal(Object.hasOwn(identity, 'role'), false);
    assert.equal(Object.isFrozen(identity), true);
    const credential = await account.tokenContext();
    assert.equal(credential.uid, uid);
    assert.equal(credential.isCurrent(), true);
    assert.equal((await runtime.auth.verifyIdToken(credential.token, true)).uid, uid);
    await account.signOut();
    assert.equal(account.identity(), null);
    assert.equal(credential.isCurrent(), false);
    const returning = await account.signInEmail(email, password);
    assert.equal(returning.uid, uid);
    assert.equal(credential.isCurrent(), false);
  }
);

test(
  'managed email registration, actual verification codes and password recovery preserve one UID',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const config = readEmulatorEnvironment();
    const name = `email-lifecycle-${randomUUID()}`;
    const email = `${name}@example.invalid`;
    const password = `Fixture-${randomUUID()}-1!`;
    const replacementPassword = `Fixture-${randomUUID()}-2!`;
    const app = initializeApp({ apiKey: 'demo-api-key', projectId: config.projectId }, name);
    const auth = sdk.getAuth(app);
    sdk.connectAuthEmulator(auth, `http://${config.authHost}`);
    t.after(async () => {
      try {
        await sdk.signOut(auth);
      } finally {
        await deleteApp(app);
      }
    });
    const account = new CloudAccount({ auth, sdk });
    const registered = await account.registerEmail(email, password);
    assert.equal(registered.emailVerified, false);
    const uid = registered.uid;
    const actionCode = async (requestType) => {
      const response = await fetch(
        `http://${config.authHost}/emulator/v1/projects/${config.projectId}/oobCodes`
      );
      assert.equal(response.status, 200);
      const data = await response.json();
      const action = data.oobCodes.find(
        (entry) => entry.email === email && entry.requestType === requestType
      );
      assert.ok(
        action && typeof action.oobCode === 'string',
        'The emulator must hold a real managed action code'
      );
      return action.oobCode;
    };
    await sdk.applyActionCode(auth, await actionCode('VERIFY_EMAIL'));
    const verified = await account.refreshIdentity();
    assert.equal(verified.uid, uid);
    assert.equal(verified.emailVerified, true);
    const credential = await account.tokenContext();
    assert.equal(
      (await runtime.auth.verifyIdToken(credential.token, true))['email_verified'],
      true
    );
    await account.signOut();
    await account.resetPassword(email);
    await sdk.confirmPasswordReset(auth, await actionCode('PASSWORD_RESET'), replacementPassword);
    const returning = await account.signInEmail(email, replacementPassword);
    assert.equal(returning.uid, uid);
    assert.equal(returning.emailVerified, true);
  }
);

test(
  'the browser account connection obtains approved same-UID state through actual bearer HTTP without creating a campaign',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const config = readEmulatorEnvironment();
    const uid = `browser-connection-${randomUUID()}`;
    const email = `${uid}@example.invalid`;
    const password = `Fixture-${randomUUID()}-1!`;
    await runtime.auth.createUser({ uid, email, password, emailVerified: true });
    await runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(uid))
      .set({ version: 1, uid, enabled: true });
    const app = initializeApp({ apiKey: 'demo-api-key', projectId: config.projectId }, uid);
    const auth = sdk.getAuth(app);
    sdk.connectAuthEmulator(auth, `http://${config.authHost}`);
    t.after(async () => {
      try {
        await sdk.signOut(auth);
      } finally {
        await deleteApp(app);
      }
    });
    const account = new CloudAccount({ auth, sdk });
    await account.signInEmail(email, password);
    const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
    const api = await cloudApi({ access });
    t.after(() => api.close());
    const connection = new CloudAccountConnection({
      account,
      baseURL: api.origin,
      runtime: {
        version: 1,
        mode: 'cloud',
        environment: 'emulator',
        apiOrigin: api.url,
        authEmulatorOrigin: `http://${config.authHost}`,
        firebase: {
          apiKey: 'demo-api-key',
          projectId: config.projectId,
          authDomain: `${config.projectId}.firebaseapp.com`,
          appId: 'demo-browser-connection',
        },
      },
    });
    const profile = await connection.profile();
    assert.deepEqual(profile, { uid, emailVerified: true, eligible: true });
    assert.equal(Object.isFrozen(profile), true);
    assert.equal(
      (await runtime.firestore.collection('campaigns').where('ownerUid', '==', uid).get()).size,
      0
    );
  }
);

test(
  'the full browser store and existing callers save current maps while explicitly gating unavailable visit/motion protocols',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const config = readEmulatorEnvironment();
    const identity = await signedInIdentity(runtime);
    t.after(() => identity.close());
    await runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(identity.uid))
      .set({ version: 1, uid: identity.uid, enabled: true });
    const account = new CloudAccount({ auth: identity.auth, sdk });
    const root = path.join(__dirname, '..', '..');
    const manifest = JSON.parse(
      await fs.readFile(path.join(root, 'assets', 'data', 'resources', 'manifest.json'), 'utf8')
    );
    const resources = new HostResources({ root, manifest });
    const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
    const backend = new CloudCampaignStore({
      firestore: runtime.firestore,
      access,
      packs: manifest.packs,
      resources,
      objects: new ImmutableCloudObjects({ bucket: runtime.bucket }),
    });
    const api = await cloudApi({ access, store: backend });
    t.after(() => api.close());
    const commands = [];
    const connection = new CloudAccountConnection({
      account,
      baseURL: api.origin,
      fetch: (url, options) => {
        if (options.method === 'POST') commands.push(JSON.parse(options.body));
        return fetch(url, options);
      },
      runtime: {
        version: 1,
        mode: 'cloud',
        environment: 'emulator',
        apiOrigin: api.url,
        authEmulatorOrigin: `http://${config.authHost}`,
        firebase: {
          apiKey: 'demo-api-key',
          projectId: config.projectId,
          authDomain: `${config.projectId}.firebaseapp.com`,
          appId: 'demo-full-client',
        },
      },
    });
    const store = new CloudCampaignClientStore({
      connection,
      uid: identity.uid,
      packs: manifest.packs,
    });
    const campaign = await store.create({
      name: 'End-to-end current client',
      ruleset: '2014',
      packIds: [],
    });
    const state = await store.readCharacters(campaign.id);
    const library = new CampaignCharacters({
      ...state,
      store,
      catalog: await resources.catalog(campaign),
    });
    const validation = { library, ruleset: '2014' };
    const current = CampaignWorld.fromScene(sceneState(), validation).save();
    const value = encodeScene(current, validation);
    const captured = {
      scene: current,
      value,
      presentations: [{ fixture: 'unavailable remote motion' }],
    };
    await library.saveScene(() => captured);
    expectMissingLegacyFields(commands[1].change);
    await library.saveScene(() => captured);
    assert.equal(commands.length, 2, 'An unchanged frame cannot become another durable write');
    library.bindScene({
      capture(engine) {
        const character = engine.list()[0];
        const scene = CampaignWorld.fromScene(
          sceneState({ characterId: character.id, name: character.name }),
          { library: engine, ruleset: '2014' }
        ).save();
        return {
          scene,
          value: encodeScene(scene, { library: engine, ruleset: '2014' }),
          presentations: [{ fixture: 'unavailable remote motion' }],
        };
      },
    });
    const characterId = await library.create('Cloud caller');
    expectMissingLegacyFields(commands[2].change.scene);
    const reopened = await store.readCharacters(campaign.id);
    assert.equal(reopened.revision, 1);
    assert.equal(reopened.sceneRevision, 2);
    assert.equal(JSON.parse(reopened.scene).creatures[0].characterId, characterId);
    assert.equal(store.saveState.phase, 'saved');

    function expectMissingLegacyFields(change) {
      assert.equal(Object.hasOwn(change, 'trackRoomVisits'), false);
      assert.equal(Object.hasOwn(change, 'presentations'), false);
    }
  }
);
