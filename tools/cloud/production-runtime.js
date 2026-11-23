const { isIP } = require('node:net');
const { createAdminRuntime } = require('./admin-runtime.js');

const invalidRuntime = () =>
  Object.assign(
    new Error(
      'Production cloud configuration is invalid; no emulator or local fallback was selected'
    ),
    {
      code: 'invalid-production-runtime',
    }
  );

function readProductionEnvironment(environment = process.env) {
  const projectId = environment.GCLOUD_PROJECT;
  const bucketName = environment.TAVERNTABLE_CLOUD_BUCKET;
  const port = environment.PORT ?? '8080';
  const eligibilityMode = environment.TAVERNTABLE_CLOUD_ELIGIBILITY ?? 'pilot';
  if (
    environment.TAVERNTABLE_CLOUD_MODE !== 'production' ||
    typeof projectId !== 'string' ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
    projectId.startsWith('demo-') ||
    (environment.GOOGLE_CLOUD_PROJECT !== undefined &&
      environment.GOOGLE_CLOUD_PROJECT !== projectId) ||
    ![`${projectId}.appspot.com`, `${projectId}.firebasestorage.app`].includes(bucketName) ||
    typeof port !== 'string' ||
    !/^[1-9][0-9]{0,4}$/.test(port) ||
    Number(port) > 65535 ||
    !['pilot', 'public'].includes(eligibilityMode) ||
    [
      'FIREBASE_AUTH_EMULATOR_HOST',
      'FIRESTORE_EMULATOR_HOST',
      'FIREBASE_STORAGE_EMULATOR_HOST',
      'STORAGE_EMULATOR_HOST',
      'FIREBASE_CONFIG',
      'GOOGLE_APPLICATION_CREDENTIALS',
    ].some((key) => environment[key] !== undefined)
  )
    throw invalidRuntime();
  let allowedOrigins;
  try {
    allowedOrigins = JSON.parse(environment.TAVERNTABLE_CLOUD_ORIGINS);
  } catch (error) {
    if (error instanceof SyntaxError) throw invalidRuntime();
    throw error;
  }
  if (
    !Array.isArray(allowedOrigins) ||
    !allowedOrigins.length ||
    new Set(allowedOrigins).size !== allowedOrigins.length ||
    allowedOrigins.some((value) => {
      if (typeof value !== 'string' || !URL.canParse(value)) return true;
      const url = new URL(value);
      return (
        url.protocol !== 'https:' ||
        url.origin !== value ||
        url.hostname.includes('*') ||
        ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
        isIP(url.hostname.replace(/^\[|\]$/g, '')) !== 0
      );
    })
  )
    throw invalidRuntime();
  return Object.freeze({
    projectId,
    bucketName,
    port: Number(port),
    eligibilityMode,
    allowedOrigins: Object.freeze(allowedOrigins),
  });
}

async function createProductionRuntime() {
  const config = readProductionEnvironment();
  return { ...(await createAdminRuntime(config)), config };
}

module.exports = { readProductionEnvironment, createProductionRuntime };
