const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase/app');
const {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut,
} = require('firebase/auth');
const { readEmulatorEnvironment } = require('../../../tools/cloud/emulator-runtime.js');

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
      auth,
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

module.exports = { signedInIdentity };
