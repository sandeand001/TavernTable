const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes, webcrypto } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const {
  encryptProtectedAsset,
  loadProtectedAssetKeys,
} = require('../../tools/cloud/protected-assets.js');
const { decryptProtectedAsset } = require('../../src/core/ProtectedAsset.js');
const { default: ModelAssetCache } = require('../../src/core/ModelAssetCache.js');
const {
  default: CloudAccountConnection,
} = require('../../src/campaigns/CloudAccountConnection.js');
const {
  default: CloudCampaignClientStore,
} = require('../../src/campaigns/CloudCampaignClientStore.js');
const { createCloudHttpHandler } = require('../../tools/cloud/cloud-http.js');
const { CloudError } = require('../../tools/cloud/cloud-error.js');
const { CloudAccountAccess } = require('../../tools/cloud/account-access.js');
const { readProductionEnvironment } = require('../../tools/cloud/production-runtime.js');
const { syntheticGlb: glb } = require('../helpers/protectedModel.js');
const {
  CLOUD_ACCESS_SEAT_HEADER,
  CLOUD_ACCESS_GENERATION_HEADER,
} = require('../../src/campaigns/CloudProtocol.js');

test('a protected embedded model decrypts for the real GLTF loader and rejects tampering or another identity', async () => {
  const key = randomBytes(32);
  const options = { key, keyId: 'fixture-pack-v1', assetId: 'fixture-model' };
  const original = glb();
  const first = encryptProtectedAsset(original, options);
  const second = encryptProtectedAsset(original, options);
  assert.notDeepEqual(first, second);

  const decrypted = await decryptProtectedAsset({
    encrypted: first,
    key: key.toString('base64'),
    keyId: options.keyId,
    assetId: options.assetId,
    crypto: webcrypto,
  });
  assert.deepEqual(Buffer.from(decrypted), original);
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  assert.ok((await new GLTFLoader().parseAsync(decrypted, '')).scene);

  const tampered = Buffer.from(first);
  tampered[tampered.length - 1] ^= 1;
  for (const changes of [
    { encrypted: tampered },
    { assetId: 'another-model' },
    { keyId: 'another-pack' },
    { key: randomBytes(32).toString('base64') },
  ]) {
    await assert.rejects(
      decryptProtectedAsset({
        encrypted: first,
        key: key.toString('base64'),
        keyId: options.keyId,
        assetId: options.assetId,
        crypto: webcrypto,
        ...changes,
      }),
      /integrity|invalid/i
    );
  }
});

test('protected models cannot reference external textures or other files', () => {
  assert.throws(
    () =>
      encryptProtectedAsset(glb({ images: [{ uri: 'texture.png' }] }), {
        key: randomBytes(32),
        keyId: 'fixture-pack-v1',
        assetId: 'fixture-model',
      }),
    /embed/i
  );
});

test('keyrings are explicit, well-formed and outside the served application checkout', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-protected-keyring-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'checkout');
  await fs.mkdir(root);
  const filename = path.join(directory, 'private-keyring.json');
  const key = randomBytes(32).toString('base64');
  await fs.writeFile(filename, JSON.stringify({ version: 1, keys: { 'fixture-pack-v1': key } }));
  assert.equal(await loadProtectedAssetKeys(root), null);
  const keys = await loadProtectedAssetKeys(root, filename);
  assert.equal(keys.get('fixture-pack-v1'), key);
  assert.equal(keys.get('missing'), null);
  assert.equal(JSON.stringify(keys).includes(key), false);
  const inside = path.join(root, 'keys.json');
  await fs.copyFile(filename, inside);
  await assert.rejects(loadProtectedAssetKeys(root, inside), /outside/i);
  await assert.rejects(loadProtectedAssetKeys(root, 'relative-keyring.json'), /absolute/i);
  await fs.writeFile(filename, JSON.stringify({ version: 1, keys: { 'fixture-pack-v1': 'bad' } }));
  await assert.rejects(loadProtectedAssetKeys(root, filename), /invalid/i);
});

test('the packaging command reads only external plaintext and keys and refuses to overwrite output', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-protected-cli-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const root = path.join(directory, 'checkout');
  await fs.mkdir(path.join(root, 'tools', 'cloud'), { recursive: true });
  await fs.mkdir(path.join(root, 'src', 'core'), { recursive: true });
  await fs.copyFile(
    path.join(__dirname, '..', '..', 'tools', 'cloud', 'protected-assets.js'),
    path.join(root, 'tools', 'cloud', 'protected-assets.js')
  );
  await fs.copyFile(
    path.join(__dirname, '..', '..', 'src', 'core', 'ProtectedAsset.js'),
    path.join(root, 'src', 'core', 'ProtectedAsset.js')
  );
  const input = path.join(directory, 'fixture.glb');
  const keyring = path.join(directory, 'keyring.json');
  const key = randomBytes(32).toString('base64');
  await fs.writeFile(input, glb());
  await fs.writeFile(keyring, JSON.stringify({ version: 1, keys: { 'fixture-pack-v1': key } }));
  const command = [
    path.join(root, 'tools', 'cloud', 'protected-assets.js'),
    '--input',
    input,
    '--keyring-file',
    keyring,
    '--key-id',
    'fixture-pack-v1',
    '--asset-id',
    'fixture-model',
    '--output',
    path.join('assets', 'protected', 'fixture-model.ttasset'),
  ];
  const first = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8' });
  assert.ifError(first.error);
  assert.equal(first.status, 0, first.stderr);
  assert.equal((first.stdout + first.stderr).includes(key), false);
  const encrypted = await fs.readFile(
    path.join(root, 'assets', 'protected', 'fixture-model.ttasset')
  );
  assert.deepEqual(
    Buffer.from(
      await decryptProtectedAsset({
        encrypted,
        key,
        keyId: 'fixture-pack-v1',
        assetId: 'fixture-model',
        crypto: webcrypto,
      })
    ),
    glb()
  );
  const repeat = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8' });
  assert.equal(repeat.status, 1);
  assert.deepEqual(
    await fs.readFile(path.join(root, 'assets', 'protected', 'fixture-model.ttasset')),
    encrypted
  );
  const privateInput = path.join(root, 'unapproved.glb');
  await fs.copyFile(input, privateInput);
  const inside = [...command];
  inside[2] = privateInput;
  assert.equal(spawnSync(process.execPath, inside, { cwd: root }).status, 1);
});

test('the model cache renders protected GLB in memory and never falls back to plaintext', async (t) => {
  const key = randomBytes(32);
  const encrypted = encryptProtectedAsset(
    glb({
      materials: [{ name: 'rock' }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
    }),
    {
      key,
      keyId: 'fixture-pack-v1',
      assetId: 'fixture-model',
    }
  );
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  let downloads = 0;
  globalThis.fetch = async (url) => {
    downloads++;
    assert.equal(url, 'assets/protected/fixture-model.ttasset');
    return new Response(encrypted);
  };
  const cache = new ModelAssetCache();
  cache._registry['fixture-model'] = {
    path: 'assets/protected/fixture-model.ttasset',
    format: 'GLB',
    protectedKeyId: 'fixture-pack-v1',
  };
  cache.setProtectedAssetKeyProvider(async () => key.toString('base64'));
  const [first, second] = await Promise.all([
    cache.getModel('fixture-model'),
    cache.getModel('fixture-model'),
  ]);
  assert.ok(first.isObject3D);
  assert.ok(second.isObject3D);
  let mesh = false;
  first.traverse((node) => {
    if (node.isMesh) mesh = true;
  });
  assert.equal(mesh, true);
  assert.equal(downloads, 1);
  assert.equal(cache._textureLoader, null);
  await cache.whenModelReady('fixture-model');

  const denied = new ModelAssetCache();
  denied._registry['fixture-model'] = cache._registry['fixture-model'];
  denied.setProtectedAssetKeyProvider(async () => {
    throw new Error('Membership revoked');
  });
  await assert.rejects(denied.getModel('fixture-model'), /Membership revoked/);
  assert.equal(downloads, 2);
  const external = new ModelAssetCache();
  external._registry['fixture-model'] = {
    ...cache._registry['fixture-model'],
    textures: { baseColor: 'external.png' },
  };
  external.setProtectedAssetKeyProvider(async () => key.toString('base64'));
  await assert.rejects(external.getModel('fixture-model'), /embed textures/i);
  assert.equal(downloads, 2);
});

test('protected access verification checks the current key against encrypted model bytes', async (t) => {
  const key = randomBytes(32);
  const encrypted = encryptProtectedAsset(glb(), {
    key,
    keyId: 'fixture-pack-v1',
    assetId: 'fixture-model',
  });
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(encrypted);
  const cache = new ModelAssetCache();
  cache._registry['fixture-model'] = {
    path: 'assets/protected/fixture-model.ttasset',
    format: 'GLB',
    protectedKeyId: 'fixture-pack-v1',
  };
  let keyValue = key.toString('base64');
  cache.setProtectedAssetKeyProvider(async () => keyValue);
  await cache.verifyProtectedAssetAccess('fixture-model');
  keyValue = randomBytes(32).toString('base64');
  await assert.rejects(cache.verifyProtectedAssetAccess('fixture-model'), /integrity/i);

  let release;
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  cache.setProtectedAssetKeyProvider(() => {
    requested();
    return new Promise((resolve) => {
      release = () => resolve(key.toString('base64'));
    });
  });
  const pending = cache.verifyProtectedAssetAccess('fixture-model');
  await started;
  cache.setProtectedAssetKeyProvider(null);
  release();
  await assert.rejects(pending, /access changed/i);
});

test('invalidating account access retires a protected model that is still loading', async (t) => {
  const key = randomBytes(32);
  const encrypted = encryptProtectedAsset(glb(), {
    key,
    keyId: 'fixture-pack-v1',
    assetId: 'fixture-model',
  });
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async () => new Response(encrypted);
  let release;
  let requested;
  const started = new Promise((resolve) => {
    requested = resolve;
  });
  const cache = new ModelAssetCache();
  cache._registry['fixture-model'] = {
    path: 'assets/protected/fixture-model.ttasset',
    format: 'GLB',
    protectedKeyId: 'fixture-pack-v1',
  };
  cache.setProtectedAssetKeyProvider(() => {
    requested();
    return new Promise((resolve) => {
      release = () => resolve(key.toString('base64'));
    });
  });
  const first = cache.getModel('fixture-model');
  const second = cache.getModel('fixture-model');
  await started;
  cache.setProtectedAssetKeyProvider(null);
  release();
  const results = await Promise.allSettled([first, second]);
  assert.ok(results.every((result) => result.status === 'rejected'));
  await assert.rejects(cache.whenModelReady('fixture-model'), /not available/);
  await assert.rejects(cache.getModel('fixture-model'), /account access/i);
});

test('the cloud client binds each key request to its freshly checked campaign access', async () => {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const key = randomBytes(32).toString('base64');
  const runtime = {
    version: 1,
    mode: 'cloud',
    environment: 'emulator',
    apiOrigin: 'http://127.0.0.1:19410',
    authEmulatorOrigin: 'http://127.0.0.1:19099',
    firebase: {
      apiKey: 'demo-api-key',
      projectId: 'demo-taverntable',
      authDomain: 'demo-taverntable.firebaseapp.com',
      appId: 'demo-protected-client',
    },
  };
  for (const [role, seatId] of [
    ['owner', null],
    ['member', '22222222-2222-4222-8222-222222222222'],
  ]) {
    const uid = `fixture-${role}`;
    const scope = {
      version: 1,
      uid,
      campaignId,
      role,
      seatId,
      accessGeneration: role === 'owner' ? 0 : 1,
    };
    const calls = [];
    let responseKey = key;
    let verified = true;
    let waitForKey = null;
    const account = {
      identity: () => ({ uid, emailVerified: verified }),
      tokenContext: async () => ({ uid, token: 'fixture-token', isCurrent: () => true }),
    };
    const connection = new CloudAccountConnection({
      account,
      runtime,
      baseURL: 'http://127.0.0.1:19410/',
      fetch: async (url, options) => {
        calls.push({ url, options });
        if (url.endsWith('/protected-asset-key') && waitForKey) await waitForKey();
        const result = url.endsWith('/participant-access')
          ? {
              version: 1,
              access: scope,
              campaign: {
                id: campaignId,
                name: 'Fixture game',
                ruleset: '2014',
                coreVersion: '5.1',
              },
              characterIds: [],
            }
          : { version: 1, keyId: 'fixture-pack-v1', key: responseKey };
        return new Response(JSON.stringify({ version: 1, result }), {
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });
    const store = new CloudCampaignClientStore({ connection, uid, packs: [], crypto: webcrypto });
    const keys = await Promise.all(
      Array.from({ length: 20 }, () => store.getProtectedAssetKey(campaignId, 'fixture-pack-v1'))
    );
    assert.ok(keys.every((value) => value === key));
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /participant-access$/);
    assert.match(calls[1].url, /protected-asset-key$/);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer fixture-token');
    assert.equal(calls[1].options.headers[CLOUD_ACCESS_SEAT_HEADER], seatId ?? 'owner');
    assert.equal(
      calls[1].options.headers[CLOUD_ACCESS_GENERATION_HEADER],
      String(scope.accessGeneration)
    );
    assert.equal(calls[1].options.cache, 'no-store');
    responseKey = 'not-a-key';
    await assert.rejects(store.getProtectedAssetKey(campaignId, 'fixture-pack-v1'), /invalid/i);
    assert.equal(calls.length, 4);
    verified = false;
    await assert.rejects(store.getProtectedAssetKey(campaignId, 'fixture-pack-v1'), {
      code: 'email-verification-required',
    });
    assert.equal(calls.length, 4);
    verified = true;
    responseKey = key;
    let release;
    let requested;
    const started = new Promise((resolve) => {
      requested = resolve;
    });
    waitForKey = () => {
      requested();
      return new Promise((resolve) => {
        release = resolve;
      });
    };
    const pending = store.getProtectedAssetKey(campaignId, 'fixture-pack-v1');
    await started;
    verified = false;
    release();
    await assert.rejects(pending, { code: 'email-verification-required' });
    store.close();
  }
});

test('public account access is opt-in and still refuses unverified or explicitly disabled accounts', async () => {
  let record = null;
  const firestore = {
    collection: () => ({
      doc: () => ({ get: async () => ({ exists: record !== null, data: () => record }) }),
    }),
  };
  let verified = true;
  const auth = {
    verifyIdToken: async () => ({
      uid: 'fixture-user',
      ['email_verified']: verified,
      ['auth_time']: 1,
    }),
  };
  const pilot = new CloudAccountAccess({ auth, firestore });
  const publicAccess = new CloudAccountAccess({ auth, firestore, eligibilityMode: 'public' });
  await assert.rejects(pilot.verifyAuthorization('Bearer token'), {
    code: 'pilot-access-required',
  });
  assert.equal((await publicAccess.verifyAuthorization('Bearer token')).uid, 'fixture-user');
  assert.equal(await publicAccess.assertInvitationEligibility('fixture-user', null), true);
  record = { version: 1, uid: 'fixture-user', enabled: false };
  await assert.rejects(publicAccess.verifyAuthorization('Bearer token'), {
    code: 'account-disabled',
  });
  await assert.rejects(publicAccess.assertInvitationEligibility('fixture-user', null), {
    code: 'account-disabled',
  });
  record = null;
  verified = false;
  await assert.rejects(publicAccess.verifyAuthorization('Bearer token'), {
    code: 'email-verification-required',
  });
  const config = {
    TAVERNTABLE_CLOUD_MODE: 'production',
    GCLOUD_PROJECT: 'public-fixture',
    TAVERNTABLE_CLOUD_BUCKET: 'public-fixture.firebasestorage.app',
    TAVERNTABLE_CLOUD_ORIGINS: '["https://example.test"]',
  };
  assert.equal(readProductionEnvironment(config).eligibilityMode, 'pilot');
  assert.equal(
    readProductionEnvironment({ ...config, TAVERNTABLE_CLOUD_ELIGIBILITY: 'public' })
      .eligibilityMode,
    'public'
  );
  assert.throws(
    () => readProductionEnvironment({ ...config, TAVERNTABLE_CLOUD_ELIGIBILITY: 'unknown' }),
    { code: 'invalid-production-runtime' }
  );
});

test('key delivery requires a current authenticated owner or joined member', async (t) => {
  const campaignId = '11111111-1111-4111-8111-111111111111';
  const seatId = '22222222-2222-4222-8222-222222222222';
  const key = randomBytes(32).toString('base64');
  const members = new Map([
    ['owner', { seatId: null, accessGeneration: 0 }],
    ['player', { seatId, accessGeneration: 1 }],
  ]);
  let slowAccess = false;
  const access = {
    async verifyAuthorization(header) {
      const uid = /^Bearer (owner|player|stranger)$/.exec(header || '')?.[1];
      if (!uid) throw new CloudError(401, 'authentication-required', 'Sign in');
      return { uid };
    },
  };
  const store = new Proxy(
    {
      usage: { consumeRequest: async () => {} },
      async getParticipantAccess(principal, id, expected) {
        if (slowAccess) await new Promise((resolve) => setTimeout(resolve, 50));
        const member = id === campaignId && members.get(principal.uid);
        if (!member) throw new CloudError(404, 'campaign-not-found', 'Campaign unavailable');
        if (
          !expected ||
          expected.seatId !== member.seatId ||
          expected.accessGeneration !== member.accessGeneration
        )
          throw new CloudError(409, 'campaign-access-changed', 'Access changed');
        return { access: member };
      },
    },
    {
      get(target, property) {
        return property in target ? target[property] : async () => {};
      },
    }
  );
  let handler = createCloudHttpHandler({
    access,
    store,
    allowedOrigins: ['http://127.0.0.1:4300'],
    protectedAssetKeys: {
      get: (id) => (id === 'fixture-pack-v1' || /^batch-[0-9]+$/.test(id) ? key : null),
    },
  });
  const server = http.createServer((request, response) => {
    void handler(request, response).then((handled) => {
      if (!handled) {
        response.writeHead(404);
        response.end();
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/cloud/campaigns/${campaignId}/protected-asset-key`;
  const request = (uid, seat, generation, keyId = 'fixture-pack-v1') =>
    fetch(url, {
      method: 'POST',
      headers: {
        Origin: 'http://127.0.0.1:4300',
        Authorization: `Bearer ${uid}`,
        'Content-Type': 'application/json',
        [CLOUD_ACCESS_SEAT_HEADER]: seat,
        [CLOUD_ACCESS_GENERATION_HEADER]: String(generation),
      },
      body: JSON.stringify({ keyId }),
    });
  for (const [uid, seat, generation] of [
    ['owner', 'owner', 0],
    ['player', seatId, 1],
  ]) {
    const response = await request(uid, seat, generation);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    assert.deepEqual((await response.json()).result, { version: 1, keyId: 'fixture-pack-v1', key });
  }
  assert.equal((await request('stranger', seatId, 1)).status, 404);
  assert.equal((await request('invalid', seatId, 1)).status, 401);
  assert.equal((await request('owner', 'owner', 0, 'missing-pack')).status, 404);
  assert.equal((await request('owner', 'owner', 0, '../invalid')).status, 400);
  assert.equal((await request('player', seatId, 0)).status, 409);
  assert.equal(
    (
      await fetch(url, {
        method: 'POST',
        headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyId: 'fixture-pack-v1' }),
      })
    ).status,
    400
  );
  slowAccess = true;
  const simultaneous = await Promise.all(
    Array.from({ length: 8 }, (_, index) => request('owner', 'owner', 0, `batch-${index}`))
  );
  assert.deepEqual(
    simultaneous.map((response) => response.status),
    Array(8).fill(200)
  );
  slowAccess = false;
  members.delete('player');
  const revoked = await request('player', seatId, 1);
  assert.equal(revoked.status, 404);
  assert.equal(JSON.stringify(await revoked.json()).includes(key), false);
  handler = createCloudHttpHandler({ access, store, allowedOrigins: ['http://127.0.0.1:4300'] });
  const unavailable = await request('owner', 'owner', 0);
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'protected-assets-unavailable');
});
