const { randomUUID } = require('node:crypto');

async function createAdminRuntime(config) {
  const { initializeApp, deleteApp } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');
  const app = initializeApp(
    { projectId: config.projectId, storageBucket: config.bucketName },
    `taverntable-cloud-${randomUUID()}`
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
        'Cloud SDK initialization and cleanup failed'
      );
    }
    throw error;
  }
}

module.exports = { createAdminRuntime };
