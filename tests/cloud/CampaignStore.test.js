const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createEmulatorRuntime } = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');
const { CloudCampaignStore } = require('../../tools/cloud/campaign-store.js');
const { signedInIdentity } = require('./helpers/accounts.js');
const { cloudApi } = require('./helpers/http.js');

async function campaignContext(runtime) {
  const identity = await signedInIdentity(runtime);
  try {
    await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
      version: 1,
      uid: identity.uid,
      enabled: true,
    });
    const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
    const principal = await access.verifyAuthorization(`Bearer ${identity.token}`);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(__dirname, '..', '..', 'assets', 'data', 'resources', 'manifest.json'),
        'utf8'
      )
    );
    const createStore = () =>
      new CloudCampaignStore({ firestore: runtime.firestore, access, packs: manifest.packs });
    return {
      principal,
      authorization: `Bearer ${identity.token}`,
      store: createStore(),
      createStore,
      openApi: () => cloudApi({ access, store: createStore() }),
      close: () => identity.close(),
    };
  } catch (error) {
    await identity.close();
    throw error;
  }
}

test(
  'one verified UID explicitly creates, lists and reopens its private canonical campaign from durable metadata',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let context;
    try {
      context = await campaignContext(runtime);
      const options = { name: 'Private cloud fixture', ruleset: '2014' };
      const campaign = await context.store.create(context.principal, {
        commandId: randomUUID(),
        options,
      });
      assert.equal(campaign.name, options.name);
      assert.equal(campaign.ruleset, '2014');
      assert.equal(campaign.coreVersion, '5.1');
      assert.deepEqual(campaign.sourcePacks, [
        {
          id: 'srd-2014',
          ruleset: '2014',
          version: '5.1-seed.1',
          enabled: true,
        },
      ]);
      assert.deepEqual(
        (await context.store.list(context.principal)).map(({ id }) => id),
        [campaign.id]
      );
      assert.deepEqual(await context.store.get(context.principal, campaign.id), campaign);
      const state = await context.store.readCharacters(context.principal, campaign.id);
      assert.equal(state.campaign.id, campaign.id);
      assert.equal(state.revision, 0);
      assert.equal(state.sceneRevision, 0);
      assert.equal(state.scene, null);
      assert.deepEqual(state.records, []);
    } finally {
      try {
        if (context) await context.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'a lost create reply retried through another backend instance reuses its UID-scoped durable result without creating a second campaign',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let context;
    try {
      context = await campaignContext(runtime);
      const command = {
        commandId: randomUUID(),
        options: { name: 'Retry fixture', ruleset: '2014' },
      };
      const original = await context.store.create(context.principal, command);
      const replay = await context
        .createStore()
        .create(context.principal, structuredClone(command));
      assert.deepEqual(replay, original);
      assert.deepEqual(
        (await context.store.list(context.principal)).map(({ id }) => id),
        [original.id]
      );
    } finally {
      try {
        if (context) await context.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'another eligible UID cannot list or open a private campaign and cannot select its owner in campaign options',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await campaignContext(runtime);
    t.after(() => owner.close());
    const unrelated = await campaignContext(runtime);
    t.after(() => unrelated.close());
    const campaign = await owner.store.create(owner.principal, {
      commandId: randomUUID(),
      options: { name: 'Owner only', ruleset: '2014' },
    });
    assert.deepEqual(await unrelated.store.list(unrelated.principal), []);
    const unavailable = { status: 404, code: 'campaign-not-found' };
    await assert.rejects(unrelated.store.get(unrelated.principal, campaign.id), unavailable);
    await assert.rejects(
      unrelated.store.readCharacters(unrelated.principal, campaign.id),
      unavailable
    );
    await assert.rejects(unrelated.store.get(unrelated.principal, randomUUID()), unavailable);
    await assert.rejects(
      owner.store.create(owner.principal, {
        commandId: randomUUID(),
        options: { name: 'Forged owner', ruleset: '2014', ownerUid: unrelated.principal.uid },
      }),
      { status: 400, code: 'invalid-campaign-request' }
    );
    assert.deepEqual(await unrelated.store.list(unrelated.principal), []);
    assert.equal((await owner.store.list(owner.principal)).length, 1);
  }
);

test(
  'a command ID cannot change intent but is independent across verified UIDs',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const first = await campaignContext(runtime);
    t.after(() => first.close());
    const second = await campaignContext(runtime);
    t.after(() => second.close());
    const commandId = randomUUID();
    const original = await first.store.create(first.principal, {
      commandId,
      options: { name: 'Original intent', ruleset: '2014' },
    });
    await assert.rejects(
      first.createStore().create(first.principal, {
        commandId,
        options: { name: 'Different intent', ruleset: '2014' },
      }),
      { status: 409, code: 'command-id-conflict' }
    );
    const independent = await second.store.create(second.principal, {
      commandId,
      options: { name: 'Independent UID', ruleset: '2024' },
    });
    assert.notEqual(independent.id, original.id);
    assert.equal(independent.ruleset, '2024');
    assert.deepEqual(
      (await first.store.list(first.principal)).map(({ id }) => id),
      [original.id]
    );
    assert.deepEqual(
      (await second.store.list(second.principal)).map(({ id }) => id),
      [independent.id]
    );
  }
);

test(
  'concurrent backend instances publish one create result and command receipt rather than duplicate campaigns',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const command = {
      commandId: randomUUID(),
      options: { name: 'Concurrent create', ruleset: '2014' },
    };
    const replies = await Promise.all(
      Array.from({ length: 4 }, () =>
        context.createStore().create(context.principal, structuredClone(command))
      )
    );
    for (const reply of replies) assert.deepEqual(reply, replies[0]);
    assert.deepEqual(
      (await context.store.list(context.principal)).map(({ id }) => id),
      [replies[0].id]
    );
  }
);

test(
  'current server eligibility is required even after a principal was verified and a durable create result exists',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const command = {
      commandId: randomUUID(),
      options: { name: 'Revocation fixture', ruleset: '2014' },
    };
    const campaign = await context.store.create(context.principal, command);
    await runtime.firestore
      .collection('pilotAccounts')
      .doc(pilotAccountKey(context.principal.uid))
      .update({ enabled: false });
    const denied = { status: 403, code: 'pilot-access-required' };
    await assert.rejects(context.store.list(context.principal), denied);
    await assert.rejects(context.store.get(context.principal, campaign.id), denied);
    await assert.rejects(context.store.readCharacters(context.principal, campaign.id), denied);
    await assert.rejects(context.createStore().create(context.principal, command), denied);
  }
);

test(
  'invalid or implicit campaign configuration fails explicitly without creating a default campaign',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const options = { name: 'Explicit settings', ruleset: '2014' };
    const invalid = [
      { commandId: randomUUID(), options: { name: 'Missing edition' } },
      null,
      [],
      {},
      { commandId: 'not-a-command-id', options },
      { commandId: randomUUID(), options: null },
      { commandId: randomUUID(), options: { ...options, ruleset: 'unavailable' } },
      { commandId: randomUUID(), options: { ...options, name: ' ' } },
      { commandId: randomUUID(), options: { ...options, packIds: null } },
      { commandId: randomUUID(), options: { ...options, packIds: 123 } },
      { commandId: randomUUID(), options: { ...options, packIds: ['unavailable-pack'] } },
      { commandId: randomUUID(), options: { ...options, packIds: ['srd-2024'] } },
      { commandId: randomUUID(), options, uid: context.principal.uid },
    ];
    for (const command of invalid)
      await assert.rejects(context.store.create(context.principal, command), {
        status: 400,
        code: 'invalid-campaign-request',
      });
    assert.deepEqual(await context.store.list(context.principal), []);
  }
);

test(
  'real bearer-authenticated HTTP creates, lists and opens only the requesting UID campaign',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const owner = await campaignContext(runtime);
    t.after(() => owner.close());
    const unrelated = await campaignContext(runtime);
    t.after(() => unrelated.close());
    const api = await owner.openApi();
    t.after(() => api.close());
    const headers = {
      Authorization: owner.authorization,
      Origin: api.origin,
      'Content-Type': 'application/json',
    };
    const created = await fetch(`${api.url}/api/cloud/campaigns`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        commandId: randomUUID(),
        options: { name: 'HTTP private fixture', ruleset: '2014' },
      }),
    });
    assert.equal(created.status, 201);
    assert.equal(created.headers.get('cache-control'), 'no-store');
    assert.equal(created.headers.get('access-control-allow-origin'), api.origin);
    const body = await created.json();
    assert.equal(body.version, 1);
    const campaign = body.result;
    assert.equal(campaign.name, 'HTTP private fixture');
    const listed = await fetch(`${api.url}/api/cloud/campaigns`, { headers });
    assert.equal(listed.status, 200);
    assert.deepEqual((await listed.json()).result, [campaign]);
    const opened = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}`, { headers });
    assert.equal(opened.status, 200);
    assert.deepEqual((await opened.json()).result, campaign);
    const state = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}/characters`, {
      headers,
    });
    assert.equal(state.status, 200);
    assert.deepEqual((await state.json()).result.records, []);
    const forbidden = await fetch(`${api.url}/api/cloud/campaigns/${campaign.id}`, {
      headers: { ...headers, Authorization: unrelated.authorization },
    });
    assert.equal(forbidden.status, 404);
    assert.equal((await forbidden.json()).code, 'campaign-not-found');
    const anonymous = await fetch(`${api.url}/api/cloud/campaigns`, {
      headers: { Origin: api.origin },
    });
    assert.equal(anonymous.status, 401);
    assert.equal((await anonymous.json()).code, 'authentication-required');
  }
);

test(
  'cloud HTTP accepts exactly 24 MiB of UTF-8 JSON, rejects one more byte, and never substitutes malformed input',
  { timeout: 30000 },
  async (t) => {
    const runtime = await createEmulatorRuntime();
    t.after(() => runtime.close());
    const context = await campaignContext(runtime);
    t.after(() => context.close());
    const api = await context.openApi();
    t.after(() => api.close());
    const headers = {
      Authorization: context.authorization,
      Origin: api.origin,
      'Content-Type': 'application/json',
    };
    const post = (body, extra = {}) =>
      fetch(`${api.url}/api/cloud/campaigns`, {
        method: 'POST',
        headers: { ...headers, ...extra },
        body,
      });
    const maximum = 24 * 1024 * 1024;
    const command = JSON.stringify({
      commandId: randomUUID(),
      options: { name: 'Caf\u00e9 boundary', ruleset: '2014' },
    });
    const body = command + ' '.repeat(maximum - Buffer.byteLength(command));
    assert.equal(Buffer.byteLength(body), maximum);
    const accepted = await post(body);
    assert.equal(accepted.status, 201);
    const original = (await accepted.json()).result;
    const exceeded = await post(body + ' ');
    assert.equal(exceeded.status, 413);
    assert.equal((await exceeded.json()).code, 'request-too-large');
    const malformed = await post('{"credential":"REDACTION-CANARY"');
    assert.equal(malformed.status, 400);
    assert.ok(!(await malformed.text()).includes('REDACTION-CANARY'));
    const invalidUtf8 = Buffer.concat([
      Buffer.from(`{"commandId":"${randomUUID()}","options":{"name":"`),
      Buffer.from([0xc3, 0x28]),
      Buffer.from('","ruleset":"2014"}}'),
    ]);
    const invalidEncoding = await post(invalidUtf8);
    assert.equal(invalidEncoding.status, 400);
    assert.equal((await invalidEncoding.json()).code, 'invalid-campaign-request');
    for (const extra of [{ 'Content-Type': 'text/plain' }, { 'Content-Encoding': 'gzip' }]) {
      const unsupported = await post(command, extra);
      assert.equal(unsupported.status, 415);
      assert.equal((await unsupported.json()).code, 'unsupported-request-format');
    }
    assert.deepEqual(
      (await context.store.list(context.principal)).map(({ id }) => id),
      [original.id]
    );
  }
);
