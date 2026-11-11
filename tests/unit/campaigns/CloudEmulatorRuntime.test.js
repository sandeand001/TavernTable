import { readEmulatorEnvironment } from '../../../tools/cloud/emulator-runtime.js';

const environment = () => ({
  TAVERNTABLE_CLOUD_MODE: 'emulator',
  GCLOUD_PROJECT: 'demo-taverntable',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:19099',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:18080',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:19199',
});

test('emulator configuration refuses a real project or an implicit/production mode', () => {
  for (const project of ['taverntable-489d5', '', undefined])
    expect(() => readEmulatorEnvironment({ ...environment(), GCLOUD_PROJECT: project })).toThrow(
      /demo-/i
    );
  for (const mode of ['production', '', undefined])
    expect(() =>
      readEmulatorEnvironment({ ...environment(), TAVERNTABLE_CLOUD_MODE: mode })
    ).toThrow(/explicit emulator mode/i);
});

test('every emulator service needs an explicit loopback host and valid port without credentials or URL paths', () => {
  const fields = [
    'FIREBASE_AUTH_EMULATOR_HOST',
    'FIRESTORE_EMULATOR_HOST',
    'FIREBASE_STORAGE_EMULATOR_HOST',
  ];
  for (const field of fields) {
    for (const endpoint of [
      undefined,
      '',
      'example.com:9099',
      '127.0.0.1.example.com:9099',
      'http://127.0.0.1:9099',
      '127.0.0.1:0',
      '127.0.0.1:65536',
      'user:password@127.0.0.1:9099',
      '127.0.0.1:9099/private',
    ])
      expect(() => readEmulatorEnvironment({ ...environment(), [field]: endpoint })).toThrow(
        /loopback.*endpoint/i
      );
  }
  expect(readEmulatorEnvironment(environment())).toMatchObject({
    projectId: 'demo-taverntable',
    authHost: '127.0.0.1:19099',
    firestoreHost: '127.0.0.1:18080',
    storageHost: '127.0.0.1:19199',
    bucketName: 'demo-taverntable.appspot.com',
  });
});

test('conflicting automatic SDK project, bucket or Storage endpoint settings cannot override the isolated demo', () => {
  for (const extra of [
    { GOOGLE_CLOUD_PROJECT: 'live-project' },
    { FIREBASE_CONFIG: JSON.stringify({ projectId: 'live-project' }) },
    {
      FIREBASE_CONFIG: JSON.stringify({
        projectId: 'demo-taverntable',
        storageBucket: 'live-bucket',
      }),
    },
    { FIREBASE_CONFIG: 'private-config.json' },
    { STORAGE_EMULATOR_HOST: 'https://storage.googleapis.com' },
    { STORAGE_EMULATOR_HOST: 'http://127.0.0.1:19200' },
  ])
    expect(() => readEmulatorEnvironment({ ...environment(), ...extra })).toThrow(
      /conflict|invalid/i
    );
  expect(
    readEmulatorEnvironment({
      ...environment(),
      GOOGLE_CLOUD_PROJECT: 'demo-taverntable',
      FIREBASE_CONFIG: JSON.stringify({
        projectId: 'demo-taverntable',
        storageBucket: 'demo-taverntable.appspot.com',
      }),
      STORAGE_EMULATOR_HOST: 'http://127.0.0.1:19199',
    }).projectId
  ).toBe('demo-taverntable');
});
