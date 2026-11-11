const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initializeApp, deleteApp } = require('firebase/app');
const {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  setDoc,
  terminate,
} = require('firebase/firestore');
const {
  getStorage,
  connectStorageEmulator,
  ref,
  getBytes,
  uploadBytes,
} = require('firebase/storage');
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

test(
  'real Admin SDK clients round-trip synthetic Auth, Firestore and Storage state inside one isolated demo',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    try {
      const id = randomUUID();
      const uid = `runtime-${id}`;
      await runtime.auth.createUser({
        uid,
        email: `runtime-${id}@example.invalid`,
        emailVerified: true,
      });

      assert.equal((await runtime.auth.getUser(uid)).emailVerified, true);
      const document = runtime.firestore.collection('runtimeChecks').doc(id);
      await document.set({ uid, value: 'emulator-only' });
      assert.deepEqual((await document.get()).data(), { uid, value: 'emulator-only' });
      const bytes = Buffer.from(JSON.stringify({ value: 'emulator-only caf\u00e9' }));
      const object = runtime.bucket.file(`runtime-checks/${id}.json`);
      await object.save(bytes, { resumable: false, contentType: 'application/json' });
      const [downloaded] = await object.download();
      assert.deepEqual(downloaded, bytes);
      assert.equal(runtime.projectId, 'demo-taverntable');
      assert.equal(runtime.bucket.name, 'demo-taverntable.appspot.com');
    } finally {
      await runtime.close();
    }
  }
);

test(
  'the browser Auth SDK obtains a demo identity token verified independently by the Admin SDK',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    const config = readEmulatorEnvironment();
    let app;
    let auth;
    try {
      const id = randomUUID();
      const uid = `client-${id}`;
      const email = `client-${id}@example.invalid`;
      const password = `Fixture-${randomUUID()}-1!`;
      await runtime.auth.createUser({ uid, email, password, emailVerified: true });
      app = initializeApp({ apiKey: 'demo-api-key', projectId: config.projectId }, `client-${id}`);
      auth = getAuth(app);
      connectAuthEmulator(auth, `http://${config.authHost}`);
      const signedIn = await signInWithEmailAndPassword(auth, email, password);
      const token = await signedIn.user.getIdToken();
      const verified = await runtime.auth.verifyIdToken(token, true);
      assert.equal(verified.uid, uid);
      assert.equal(verified.aud, 'demo-taverntable');
      assert.equal(verified.email_verified, true);
    } finally {
      if (auth) await signOut(auth);
      if (app) await deleteApp(app);
      await runtime.close();
    }
  }
);

test(
  'authenticated browser clients cannot directly read or write private Firestore/Storage data',
  { timeout: 30000 },
  async () => {
    const runtime = await createEmulatorRuntime();
    const config = readEmulatorEnvironment();
    let app;
    let auth;
    let firestore;
    try {
      const id = randomUUID();
      const email = `rules-${id}@example.invalid`;
      const password = `Fixture-${randomUUID()}-1!`;
      await runtime.auth.createUser({ email, password, emailVerified: true });
      const objectPath = `runtime-checks/${id}.json`;
      const bytes = Buffer.from('{"value":"private-emulator-only"}');
      await runtime.firestore
        .collection('runtimeChecks')
        .doc(id)
        .set({ value: 'private-emulator-only' });
      await runtime.bucket
        .file(objectPath)
        .save(bytes, { resumable: false, contentType: 'application/json' });
      app = initializeApp(
        {
          apiKey: 'demo-api-key',
          projectId: config.projectId,
          storageBucket: config.bucketName,
        },
        `rules-${id}`
      );
      auth = getAuth(app);
      connectAuthEmulator(auth, `http://${config.authHost}`);
      await signInWithEmailAndPassword(auth, email, password);
      firestore = getFirestore(app);
      const firestoreURL = new URL(`http://${config.firestoreHost}`);
      connectFirestoreEmulator(firestore, firestoreURL.hostname, Number(firestoreURL.port));
      const storage = getStorage(app);
      const storageURL = new URL(`http://${config.storageHost}`);
      connectStorageEmulator(storage, storageURL.hostname, Number(storageURL.port));
      await assert.rejects(getDoc(doc(firestore, 'runtimeChecks', id)), {
        code: 'permission-denied',
      });
      await assert.rejects(
        setDoc(doc(firestore, 'runtimeChecks', `other-${id}`), { value: 'denied' }),
        { code: 'permission-denied' }
      );
      await assert.rejects(getBytes(ref(storage, objectPath)), { code: 'storage/unauthorized' });
      await assert.rejects(uploadBytes(ref(storage, `runtime-checks/other-${id}.json`), bytes), {
        code: 'storage/unauthorized',
      });
    } finally {
      if (firestore) await terminate(firestore);
      if (auth) await signOut(auth);
      if (app) await deleteApp(app);
      await runtime.close();
    }
  }
);
