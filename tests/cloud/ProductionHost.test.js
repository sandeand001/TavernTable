const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createProductionHost } = require('../../tools/cloud/production-host.js');
const { readProductionEnvironment } = require('../../tools/cloud/production-runtime.js');

const configuration = () => ({
  TAVERNTABLE_CLOUD_MODE: 'production',
  GCLOUD_PROJECT: 'taverntable-container-check',
  GOOGLE_CLOUD_PROJECT: 'taverntable-container-check',
  TAVERNTABLE_CLOUD_BUCKET: 'taverntable-container-check.firebasestorage.app',
  TAVERNTABLE_CLOUD_ORIGINS: '["https://frontend.example.test"]',
  PORT: '8080',
});

async function productionEnvironment(t) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-production-check-'));
  const values = {
    ...configuration(),
    HOME: home,
    USERPROFILE: home,
    APPDATA: home,
    CLOUDSDK_CONFIG: home,
    FIREBASE_AUTH_EMULATOR_HOST: undefined,
    FIRESTORE_EMULATOR_HOST: undefined,
    FIREBASE_STORAGE_EMULATOR_HOST: undefined,
    STORAGE_EMULATOR_HOST: undefined,
    FIREBASE_CONFIG: undefined,
    GOOGLE_APPLICATION_CREDENTIALS: undefined,
  };
  const previous = new Map(Object.keys(values).map((key) => [key, process.env[key]]));
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(async () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await fs.rm(home, { recursive: true, force: true });
  });
}

test('production configuration refuses development credentials, foreign projects and ambiguous origins', () => {
  for (const changes of [
    { TAVERNTABLE_CLOUD_MODE: 'emulator' },
    { GCLOUD_PROJECT: 'demo-taverntable' },
    { GOOGLE_CLOUD_PROJECT: 'another-project' },
    { TAVERNTABLE_CLOUD_BUCKET: 'another-project.firebasestorage.app' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'PRIVATE CONFIGURATION MARKER' },
    { FIREBASE_CONFIG: '{"private":"PRIVATE CONFIGURATION MARKER"}' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099' },
    { FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080' },
    { FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:19199' },
    { STORAGE_EMULATOR_HOST: 'http://127.0.0.1:19199' },
    { PORT: '0' },
    { PORT: '65536' },
    { TAVERNTABLE_CLOUD_ORIGINS: '["http://frontend.example.test"]' },
    { TAVERNTABLE_CLOUD_ORIGINS: '["https://*.example.test"]' },
    { TAVERNTABLE_CLOUD_ORIGINS: '["https://frontend.example.test/private"]' },
    {
      TAVERNTABLE_CLOUD_ORIGINS:
        '["https://frontend.example.test","https://frontend.example.test"]',
    },
  ]) {
    assert.throws(
      () => readProductionEnvironment({ ...configuration(), ...changes }),
      (error) => {
        assert.equal(error.code, 'invalid-production-runtime');
        assert.equal(error.message.includes('PRIVATE CONFIGURATION MARKER'), false);
        return true;
      }
    );
  }
});

test('a misconfigured production process exits explicitly without printing credential configuration', async (t) => {
  await productionEnvironment(t);
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '..', '..', 'tools', 'cloud', 'production-host.js')],
    {
      env: { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: 'PRIVATE CONFIGURATION MARKER' },
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true,
    }
  );
  assert.ifError(child.error);
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr.trim()), {
    version: 1,
    code: 'invalid-production-runtime',
  });
  assert.equal(child.stderr.includes('PRIVATE CONFIGURATION MARKER'), false);
});

test(
  'the production API starts without developer credentials and serves no frontend, tooling or private files',
  { timeout: 30000 },
  async (t) => {
    await productionEnvironment(t);
    const host = await createProductionHost();
    t.after(() => host.close());
    host.server.listen(0, '127.0.0.1');
    await once(host.server, 'listening');
    const origin = `http://127.0.0.1:${host.server.address().port}`;
    for (const resource of ['/health', '/healthz']) {
      const ready = await fetch(origin + resource);
      assert.equal(ready.status, 200);
      assert.deepEqual(await ready.json(), { version: 1, status: 'ready' });
      assert.equal((await fetch(origin + resource, { method: 'HEAD' })).status, 200);
      const rejected = await fetch(origin + resource, { method: 'POST' });
      assert.equal(rejected.status, 405);
      assert.equal(rejected.headers.get('allow'), 'GET, HEAD');
    }
    for (const resource of [
      '/',
      '/index.html',
      '/src/index.js',
      '/tools/cloud/account-access.js',
      '/firebase.json',
    ]) {
      const response = await fetch(origin + resource);
      assert.equal(response.status, 404);
      const body = await response.text();
      assert.equal(body.includes('taverntable-container-check'), false);
    }
    const account = await fetch(origin + '/api/cloud/account');
    assert.equal(account.status, 401);
    assert.equal((await account.json()).code, 'authentication-required');
    const deniedOrigin = await fetch(origin + '/api/cloud/account', {
      headers: { Origin: 'https://other.example.test' },
    });
    assert.equal(deniedOrigin.status, 403);
    assert.equal((await deniedOrigin.json()).code, 'origin-not-allowed');
    const preflight = await fetch(origin + '/api/cloud/account', {
      method: 'OPTIONS',
      headers: { Origin: 'https://frontend.example.test' },
    });
    assert.equal(preflight.status, 204);
    assert.equal(
      preflight.headers.get('access-control-allow-origin'),
      'https://frontend.example.test'
    );
    await host.close();
    assert.equal(host.server.listening, false);
  }
);
