const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCloudDevHost } = require('../../tools/cloud/dev-host.js');

test(
  'the emulator-only development host serves an explicit cloud shell and protected API without legacy authority or private files',
  { timeout: 30000 },
  async (t) => {
    const host = await createCloudDevHost({ port: 0 });
    t.after(() => host.close());
    const response = await fetch(host.url);
    assert.equal(response.status, 200);
    const html = await response.text();
    const match = /<script[^>]*id="taverntable-runtime"[^>]*>([\s\S]*?)<\/script>/.exec(html);
    assert.ok(match, 'The static shell must carry explicit runtime data even before sign-in');
    const runtime = JSON.parse(match[1]);
    assert.equal(runtime.mode, 'cloud');
    assert.equal(runtime.environment, 'emulator');
    assert.equal(runtime.firebase.projectId, 'demo-taverntable');
    assert.equal(runtime.firebase.apiKey, 'demo-api-key');
    assert.equal(runtime.apiOrigin, new URL(host.url).origin);
    assert.equal((await fetch(new URL('src/campaigns/CloudAccount.js', host.url))).status, 200);
    assert.equal(
      (await fetch(new URL('assets/data/resources/manifest.json', host.url))).status,
      200
    );
    const account = await fetch(new URL('api/cloud/account', host.url));
    assert.equal(account.status, 401);
    assert.equal((await account.json()).code, 'authentication-required');
    for (const resource of [
      'tools/local-host.js',
      'node_modules/firebase-admin/package.json',
      'tests/cloud/BrowserAccount.test.js',
      'package.json',
      '.git/config',
      '.firebaserc',
      'docs/proposals/cloud-migration-preparation.md',
    ])
      assert.equal((await fetch(new URL(resource, host.url))).status, 404);
    const legacy = await fetch(new URL('api/session/host', host.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: 'not-cloud-authority' }),
    });
    assert.equal(legacy.status, 404);
  }
);
