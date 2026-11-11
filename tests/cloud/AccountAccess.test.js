const { randomUUID } = require('node:crypto');
const http = require('node:http');
const { once } = require('node:events');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} = require('firebase/auth');
const {
  createEmulatorRuntime,
  readEmulatorEnvironment,
} = require('../../tools/cloud/emulator-runtime.js');
const { CloudAccountAccess, pilotAccountKey } = require('../../tools/cloud/account-access.js');

async function signedInIdentity(runtime, { emailVerified = true, claims = null } = {}) {
  const config = readEmulatorEnvironment();
  const id = randomUUID();
  const uid = `access-${id}`;
  const email = `access-${id}@example.invalid`;
  const password = `Fixture-${randomUUID()}-1!`;
  await runtime.auth.createUser({ uid, email, password, emailVerified });
  if (claims) await runtime.auth.setCustomUserClaims(uid, claims);
  const app = initializeApp({ apiKey: 'demo-api-key', projectId: config.projectId }, uid);
  const auth = getAuth(app);
  connectAuthEmulator(auth, `http://${config.authHost}`);
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    return {
      uid,
      token: await result.user.getIdToken(),
      async close() {
        try {
          await signOut(auth);
        } finally {
          await deleteApp(app);
        }
      },
    };
  } catch (error) {
    await deleteApp(app);
    throw error;
  }
}

async function accountApi(access) {
  const { createAccountHttpHandler } = require('../../tools/cloud/account-http.js');
  const origin = 'http://127.0.0.1:4300';
  const handler = createAccountHttpHandler({ access, allowedOrigins: [origin] });
  const server = http.createServer((request, response) => {
    void handler(request, response).then(
      (handled) => {
        if (!handled) {
          response.writeHead(404);
          response.end();
        }
      },
      () => {
        response.writeHead(500);
        response.end();
      }
    );
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('The account API did not bind TCP');
  return {
    origin,
    url: `http://127.0.0.1:${address.port}/api/cloud/account`,
    async close() {
      const closing = new Promise((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve()))
      );
      server.closeAllConnections();
      await closing;
    },
  };
}

test(
  'a verified, server-approved demo account resolves to UID authority without a global DM role',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    try {
      identity = await signedInIdentity(runtime);
      await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
        version: 1,
        uid: identity.uid,
        enabled: true,
      });

      const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
      const principal = await access.verifyAuthorization(`Bearer ${identity.token}`);
      assert.deepEqual(principal, { uid: identity.uid, emailVerified: true });
      assert.equal(Object.hasOwn(principal, 'role'), false);
    } finally {
      try {
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);

test(
  'missing, malformed and forged authorization produces typed unauthenticated denials without echoing token input',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    try {
      const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
      for (const header of [
        undefined,
        '',
        'Basic private-fixture',
        'Bearer',
        'Bearer not-a-valid-private-token',
      ]) {
        await assert.rejects(access.verifyAuthorization(header), (error) => {
          assert.equal(error.status, 401);
          assert(['authentication-required', 'invalid-identity'].includes(error.code));
          assert(!error.message.includes('private-fixture'));
          assert(!error.message.includes('not-a-valid-private-token'));
          return true;
        });
      }
    } finally {
      await runtime.close();
    }
  }
);

test(
  'email verification is required even when the server has approved the account',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    try {
      identity = await signedInIdentity(runtime, { emailVerified: false });
      await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
        version: 1,
        uid: identity.uid,
        enabled: true,
      });
      const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
      await assert.rejects(access.verifyAuthorization(`Bearer ${identity.token}`), {
        status: 403,
        code: 'email-verification-required',
      });
    } finally {
      try {
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'server-owned eligibility is checked on every request and cannot be granted by a global role claim',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    try {
      identity = await signedInIdentity(runtime, { claims: { role: 'dm' } });
      const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
      const authorization = `Bearer ${identity.token}`;
      await assert.rejects(access.verifyAuthorization(authorization), {
        status: 403,
        code: 'pilot-access-required',
      });
      const record = runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(identity.uid));
      await record.set({ version: 1, uid: identity.uid, enabled: true });
      assert.deepEqual(await access.verifyAuthorization(authorization), {
        uid: identity.uid,
        emailVerified: true,
      });
      await record.update({ enabled: false });
      await assert.rejects(access.verifyAuthorization(authorization), {
        status: 403,
        code: 'pilot-access-required',
      });
      assert.equal((await record.get()).exists, true);
    } finally {
      try {
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'expired and wrong-project identity claims are rejected even for a verified approved UID',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    try {
      identity = await signedInIdentity(runtime);
      await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
        version: 1,
        uid: identity.uid,
        enabled: true,
      });
      const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
      const parts = identity.token.split('.');
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      for (const changes of [
        { exp: 1 },
        { aud: 'different-demo-project' },
        { iss: 'https://securetoken.google.com/different-demo-project' },
      ]) {
        const token = [
          parts[0],
          Buffer.from(JSON.stringify({ ...payload, ...changes })).toString('base64url'),
          parts[2],
        ].join('.');
        await assert.rejects(access.verifyAuthorization(`Bearer ${token}`), {
          status: 401,
          code: 'invalid-identity',
        });
      }
    } finally {
      try {
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'a disabled Firebase account cannot reuse a previously valid token and pilot approval',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    try {
      identity = await signedInIdentity(runtime);
      await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
        version: 1,
        uid: identity.uid,
        enabled: true,
      });
      const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
      const authorization = `Bearer ${identity.token}`;
      assert.equal((await access.verifyAuthorization(authorization)).uid, identity.uid);
      await runtime.auth.updateUser(identity.uid, { disabled: true });
      await assert.rejects(access.verifyAuthorization(authorization), {
        status: 401,
        code: 'invalid-identity',
      });
    } finally {
      try {
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'malformed or mismatched server eligibility records fail explicitly without granting or rewriting access',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    try {
      identity = await signedInIdentity(runtime);
      const record = runtime.firestore
        .collection('pilotAccounts')
        .doc(pilotAccountKey(identity.uid));
      const access = new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore });
      for (const data of [
        { version: 1, uid: 'different-private-fixture', enabled: true },
        { version: 1, uid: identity.uid, enabled: 'true' },
        { version: 2, uid: identity.uid, enabled: true },
      ]) {
        await record.set(data);
        await assert.rejects(access.verifyAuthorization(`Bearer ${identity.token}`), (error) => {
          assert.equal(error.status, 503);
          assert.equal(error.code, 'invalid-account-eligibility');
          assert(!error.message.includes('different-private-fixture'));
          return true;
        });
        assert.deepEqual((await record.get()).data(), data);
      }
    } finally {
      try {
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'the real HTTP account route authenticates the bearer token and returns only approved account state',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    let api;
    try {
      identity = await signedInIdentity(runtime);
      await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
        version: 1,
        uid: identity.uid,
        enabled: true,
      });
      api = await accountApi(
        new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore })
      );
      const response = await fetch(api.url, {
        headers: { Authorization: `Bearer ${identity.token}`, Origin: api.origin },
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('access-control-allow-origin'), api.origin);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await response.json(), {
        version: 1,
        result: { uid: identity.uid, emailVerified: true, eligible: true },
      });
    } finally {
      try {
        if (api) await api.close();
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'an allowed frontend preflight never replaces Firebase authentication or accepts local host credentials',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let api;
    try {
      api = await accountApi(
        new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore })
      );
      const preflight = await fetch(api.url, {
        method: 'OPTIONS',
        headers: {
          Origin: api.origin,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      });
      assert.equal(preflight.status, 204);
      assert.equal(await preflight.text(), '');
      assert.equal(preflight.headers.get('access-control-allow-origin'), api.origin);
      assert.match(preflight.headers.get('access-control-allow-headers'), /authorization/i);
      const anonymous = await fetch(api.url, {
        headers: {
          Origin: api.origin,
          Cookie: 'taverntable-session=private-local-cookie',
          'X-TavernTable-Host': 'private-local-key',
        },
      });
      assert.equal(anonymous.status, 401);
      const denied = await anonymous.json();
      assert.equal(denied.code, 'authentication-required');
      assert(!Object.hasOwn(denied, 'result'));
      assert(!JSON.stringify(denied).includes('private-local'));
    } finally {
      try {
        if (api) await api.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'HTTP origin, method and query validation cannot expose approved account state or accept URL credentials',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let identity;
    let api;
    try {
      identity = await signedInIdentity(runtime);
      await runtime.firestore.collection('pilotAccounts').doc(pilotAccountKey(identity.uid)).set({
        version: 1,
        uid: identity.uid,
        enabled: true,
      });
      api = await accountApi(
        new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore })
      );
      for (const origin of ['http://127.0.0.1:4301', 'https://unrelated.invalid', 'null']) {
        const response = await fetch(api.url, {
          headers: { Origin: origin, Authorization: `Bearer ${identity.token}` },
        });
        assert.equal(response.status, 403);
        assert.equal(response.headers.get('access-control-allow-origin'), null);
        assert(!JSON.stringify(await response.json()).includes(identity.uid));
      }
      const query = new URL(api.url);
      query.searchParams.set('token', 'private-query-token');
      query.searchParams.set('uid', 'different-private-fixture');
      const rejected = await fetch(query, {
        headers: { Origin: api.origin, Authorization: `Bearer ${identity.token}` },
      });
      assert.equal(rejected.status, 400);
      const denial = await rejected.json();
      assert.equal(denial.code, 'invalid-account-request');
      assert(!JSON.stringify(denial).includes('private-query-token'));
      const method = await fetch(api.url, {
        method: 'POST',
        headers: { Origin: api.origin, Authorization: `Bearer ${identity.token}` },
      });
      assert.equal(method.status, 405);
      assert.equal(method.headers.get('allow'), 'GET, OPTIONS');
      assert(!Object.hasOwn(await method.json(), 'result'));
    } finally {
      try {
        if (api) await api.close();
        if (identity) await identity.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
test(
  'unexpected account transport failures never disclose provider details or structured credential data in replies/logs',
  { timeout: 30000 },
  async (context) => {
    const logged = [];
    context.mock.method(console, 'error', (...args) => logged.push(args));
    const api = await accountApi({
      verifyAuthorization: async () => {
        throw Object.assign(new Error('PRIVATE PROVIDER DETAILS'), {
          code: { token: 'PRIVATE CREDENTIAL VALUE' },
        });
      },
    });
    try {
      const response = await fetch(api.url, {
        headers: { Origin: api.origin, Authorization: 'Bearer private-fixture-token' },
      });
      assert.equal(response.status, 500);
      const denial = await response.json();
      assert.equal(denial.code, 'account-request-failed');
      assert(!JSON.stringify(denial).includes('PRIVATE'));
      assert(logged.length > 0);
      assert(!JSON.stringify(logged).includes('PRIVATE'));
    } finally {
      await api.close();
    }
  }
);
test(
  'HTTP verification and eligibility denials preserve distinct recoverable states without returning private account data',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    let api;
    try {
      api = await accountApi(
        new CloudAccountAccess({ auth: runtime.auth, firestore: runtime.firestore })
      );
      for (const verified of [false, true]) {
        const identity = await signedInIdentity(runtime, { emailVerified: verified });
        try {
          if (!verified) {
            await runtime.firestore
              .collection('pilotAccounts')
              .doc(pilotAccountKey(identity.uid))
              .set({
                version: 1,
                uid: identity.uid,
                enabled: true,
              });
          }
          const response = await fetch(api.url, {
            headers: { Origin: api.origin, Authorization: `Bearer ${identity.token}` },
          });
          assert.equal(response.status, 403);
          const denial = await response.json();
          assert.equal(
            denial.code,
            verified ? 'pilot-access-required' : 'email-verification-required'
          );
          assert(!Object.hasOwn(denial, 'result'));
          assert(!JSON.stringify(denial).includes(identity.uid));
        } finally {
          await identity.close();
        }
      }
    } finally {
      try {
        if (api) await api.close();
      } finally {
        await runtime.close();
      }
    }
  }
);
