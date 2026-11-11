function loopbackEndpoint(environment, name) {
  const value = environment[name];
  const match =
    typeof value === 'string' && /^(127\.0\.0\.1|localhost|\[::1\]):([0-9]{1,5})$/.exec(value);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 65535)
    throw new Error(`Cloud emulator requires an explicit loopback ${name} endpoint`);
  return value;
}

function readEmulatorEnvironment(environment = process.env) {
  if (environment.TAVERNTABLE_CLOUD_MODE !== 'emulator')
    throw new Error('Cloud emulator clients require explicit emulator mode');
  const projectId = environment.GCLOUD_PROJECT;
  if (
    typeof projectId !== 'string' ||
    !/^demo-[a-z0-9](?:[a-z0-9-]{0,23}[a-z0-9])?$/.test(projectId)
  )
    throw new Error('Cloud emulator clients require an explicit demo- project ID');
  const config = {
    projectId,
    authHost: loopbackEndpoint(environment, 'FIREBASE_AUTH_EMULATOR_HOST'),
    firestoreHost: loopbackEndpoint(environment, 'FIRESTORE_EMULATOR_HOST'),
    storageHost: loopbackEndpoint(environment, 'FIREBASE_STORAGE_EMULATOR_HOST'),
    bucketName: `${projectId}.appspot.com`,
  };
  if (
    environment.GOOGLE_CLOUD_PROJECT !== undefined &&
    environment.GOOGLE_CLOUD_PROJECT !== projectId
  )
    throw new Error('Cloud SDK project settings conflict with the explicit demo project');
  if (environment.FIREBASE_CONFIG !== undefined) {
    let firebase;
    try {
      firebase = JSON.parse(environment.FIREBASE_CONFIG);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('Cloud SDK Firebase configuration is invalid for emulator mode');
    }
    if (
      !firebase ||
      typeof firebase !== 'object' ||
      Array.isArray(firebase) ||
      (firebase.projectId !== undefined && firebase.projectId !== projectId) ||
      (firebase.storageBucket !== undefined && firebase.storageBucket !== config.bucketName)
    )
      throw new Error('Cloud SDK Firebase settings conflict with the explicit demo project');
  }
  if (
    environment.STORAGE_EMULATOR_HOST !== undefined &&
    ![`http://${config.storageHost}`, `http://${config.storageHost}/`].includes(
      environment.STORAGE_EMULATOR_HOST
    )
  )
    throw new Error('Cloud SDK Storage endpoint conflicts with the explicit emulator endpoint');
  return config;
}

async function createEmulatorRuntime() {
  const config = readEmulatorEnvironment();
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const app = initializeApp(
    {
      projectId: config.projectId,
      storageBucket: config.bucketName,
    },
    `taverntable-emulator-${randomUUID()}`
  );
  try {
    let closing;
    return {
      projectId: config.projectId,
      auth: getAuth(app),
      firestore: getFirestore(app),
      bucket: getStorage(app).bucket(),
      close() {
        if (!closing) closing = deleteApp(app);
        return closing;
      },
    };
  } catch (error) {
    try {
      await deleteApp(app);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Emulator SDK initialization and cleanup failed'
      );
    }
    throw error;
  }
}

module.exports = { readEmulatorEnvironment, createEmulatorRuntime };
const { randomUUID } = require('node:crypto');
