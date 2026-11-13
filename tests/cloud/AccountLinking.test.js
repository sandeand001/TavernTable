const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const sdk = require('firebase/auth');
const {
  createEmulatorRuntime,
  readEmulatorEnvironment,
} = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { ImmutableCloudObjects } = require('../../tools/cloud/immutable-objects.js');
const { HostResources } = require('../../tools/host-resources.js');
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

async function fixture(t, { initialProvider = 'google.com' } = {}) {
  const runtime = await createEmulatorRuntime();
  const environment = readEmulatorEnvironment();
  const closeAccounts = [];
  t.after(async () => {
    try {
      for (const close of closeAccounts) await close();
    } finally {
      await runtime.close();
    }
  });
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(__dirname, '..', '..', 'assets', 'data', 'resources', 'manifest.json'),
      'utf8'
    )
  );
  const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
  const resources = new HostResources({ root: path.join(__dirname, '..', '..'), manifest });
  const store = new CloudCampaignStore({
    firestore: runtime.firestore,
    access,
    packs: manifest.packs,
    resources,
    objects: new ImmutableCloudObjects({ bucket: runtime.bucket }),
  });
  const api = await cloudApi({ access, store });
  closeAccounts.push(() => api.close());
  const id = randomUUID();
  const googleEmail = `link-${id}@example.invalid`;
  const googleSubject = `google-link-${id}`;
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const googleCredential = (email = googleEmail, subject = googleSubject) => {
    assert.equal(environment.projectId, 'demo-taverntable');
    const now = Math.floor(Date.now() / 1000);
    return sdk.GoogleAuthProvider.credential(
      encode({ alg: 'none', typ: 'JWT' }) +
        '.' +
        encode({
          iss: 'https://accounts.google.com',
          aud: 'demo-api-key',
          sub: subject,
          email,
          ['email_verified']: true,
          iat: now,
          exp: now + 3600,
        }) +
        '.'
    );
  };
  const initialPassword = `Fixture-${randomUUID()}-1!`;
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: environment.projectId }, id);
  const auth = sdk.getAuth(app);
  sdk.connectAuthEmulator(auth, `http://${environment.authHost}`);
  closeAccounts.push(async () => {
    try {
      await sdk.signOut(auth);
    } finally {
      await deleteApp(app);
    }
  });
  if (initialProvider === 'password') {
    const result = await sdk.createUserWithEmailAndPassword(auth, googleEmail, initialPassword);
    await runtime.auth.updateUser(result.user.uid, { emailVerified: true });
    await result.user.reload();
    await result.user.getIdToken(true);
  } else {
    await sdk.signInWithCredential(auth, googleCredential());
  }
  const popupCalls = [];
  // Native Auth mutations use synthetic provider credentials; real popup UX has a separate gate.
  const account = new CloudAccount({
    auth,
    sdk: {
      ...sdk,
      reauthenticateWithPopup: (user, provider) => {
        popupCalls.push('verify-google');
        assert.equal(provider.providerId, 'google.com');
        return sdk.reauthenticateWithCredential(user, googleCredential());
      },
      linkWithPopup: (user, provider) => {
        popupCalls.push('link-google');
        assert.equal(provider.providerId, 'google.com');
        return sdk.linkWithCredential(user, googleCredential(user.email));
      },
      signInWithPopup: (_auth, provider) => {
        assert.equal(provider.providerId, 'google.com');
        return sdk.signInWithCredential(
          auth,
          googleCredential(initialProvider === 'password' ? originalEmail : googleEmail)
        );
      },
    },
  });
  const uid = account.identity().uid;
  const originalEmail = account.identity().email;
  await runtime.firestore
    .collection('pilotAccounts')
    .doc(pilotAccountKey(uid))
    .create({ version: 1, uid, enabled: true });
  const principal = async () =>
    access.verifyAuthorization(`Bearer ${(await account.tokenContext()).token}`);
  const client = (identity) => {
    const connection = new CloudAccountConnection({
      account: identity,
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
          appId: 'demo-provider-linking',
        },
      },
    });
    return new CloudCampaignClientStore({
      connection,
      uid: identity.identity().uid,
      packs: manifest.packs,
    });
  };
  return {
    runtime,
    access,
    store,
    resources,
    manifest,
    account,
    uid,
    initialPassword,
    originalEmail,
    principal,
    client,
    popupCalls,
    closeAccounts,
    googleCredential,
  };
}

for (const initialProvider of ['google.com', 'password'])
  test(
    initialProvider === 'google.com'
      ? 'a real provider rejection cannot split the Google UID or change Owned/Joined campaigns and assigned characters'
      : 'real password-to-Google linking keeps the same UID, Owned/Joined campaigns and access generations',
    { timeout: 30000 },
    async (t) => {
      const f = await fixture(t, { initialProvider });
      const account = f.account;
      const memberClient = f.client(account);
      const owned = await memberClient.create({ name: 'Provider-owned fixture', ruleset: '2014' });
      const ownerIdentity = await signedInIdentity(f.runtime);
      f.closeAccounts.push(() => ownerIdentity.close());
      await f.runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(ownerIdentity.uid))
        .create({ version: 1, uid: ownerIdentity.uid, enabled: true });
      const ownerAccount = new CloudAccount({ auth: ownerIdentity.auth, sdk });
      const ownerClient = f.client(ownerAccount);
      const joined = await ownerClient.create({ name: 'Provider-joined fixture', ruleset: '2014' });
      const library = await CampaignCharacters.open({
        store: ownerClient,
        campaignId: joined.id,
        catalog: await f.resources.catalog(joined),
      });
      const characterId = await library.create('Linked account scout');
      const invitation = await ownerClient.createInvitation(joined.id, { name: 'Linked member' });
      await ownerClient.assignCharacter(joined.id, {
        seatId: invitation.seatId,
        characterId,
        assigned: true,
        accessGeneration: 0,
      });
      await memberClient.redeemInvitation({ id: invitation.id, secret: invitation.secret });
      const directory = await memberClient.listAccess();
      const grant = await memberClient.getParticipantAccess(joined.id);
      const records = await ownerClient.readCharacters(joined.id);
      assert.equal(directory.owned[0].campaign.id, owned.id);
      assert.equal(directory.joined[0].campaign.id, joined.id);
      assert.deepEqual(grant.characterIds, [characterId]);
      const beforeHead = (
        await f.runtime.firestore.collection('campaigns').doc(joined.id).get()
      ).data();
      if (initialProvider === 'google.com') {
        await account.verifySignInMethod({ provider: 'google.com' });
        await assert.rejects(
          account.linkSignInMethod({ provider: 'password', password: `Linked-${randomUUID()}-1!` }),
          { code: 'account-exists' }
        );
        assert.deepEqual(account.signInMethods().providers, ['google.com']);
        assert.deepEqual(f.popupCalls, ['verify-google']);
      } else {
        await account.verifySignInMethod({ provider: 'password', password: f.initialPassword });
        const linked = await account.linkSignInMethod({ provider: 'google.com' });
        assert.equal(linked.uid, f.uid);
        assert.deepEqual(linked.providers, ['google.com', 'password']);
        assert.deepEqual(f.popupCalls, ['link-google']);
        await account.signOut();
        assert.equal((await account.signInEmail(f.originalEmail, f.initialPassword)).uid, f.uid);
        assert.deepEqual(await memberClient.listAccess(), directory);
        assert.deepEqual(await memberClient.getParticipantAccess(joined.id, grant.access), grant);
      }
      await account.signOut();
      assert.equal((await account.signInGoogle()).uid, f.uid);
      assert.deepEqual(await memberClient.listAccess(), directory);
      assert.deepEqual(await memberClient.getParticipantAccess(joined.id, grant.access), grant);
      assert.deepEqual(await ownerClient.readCharacters(joined.id), records);
      assert.deepEqual(
        (await f.runtime.firestore.collection('campaigns').doc(joined.id).get()).data(),
        beforeHead
      );
      await assert.rejects(memberClient.readCharacters(joined.id), { code: 'campaign-not-found' });
      assert.equal((await f.principal()).uid, f.uid);
    }
  );
