import {
  readApplicationRuntime,
  validateApplicationRuntime,
} from '../../../src/campaigns/CloudRuntime.js';

const demoRuntime = () => ({
  version: 1,
  mode: 'cloud',
  environment: 'emulator',
  apiOrigin: 'http://127.0.0.1:19410',
  authEmulatorOrigin: 'http://127.0.0.1:19099',
  firebase: {
    apiKey: 'demo-api-key',
    projectId: 'demo-taverntable',
    authDomain: 'demo-taverntable.firebaseapp.com',
    appId: 'demo-taverntable-web',
  },
});

afterEach(() => {
  for (const element of document.querySelectorAll('[id="taverntable-runtime"]')) element.remove();
});

test('an explicit loopback demo runtime selects frozen cloud configuration rather than local authority', () => {
  const configuration = demoRuntime();
  const element = document.createElement('script');
  element.id = 'taverntable-runtime';
  element.type = 'application/json';
  element.textContent = JSON.stringify(configuration);
  document.head.append(element);
  const runtime = readApplicationRuntime({ document, baseURL: 'http://127.0.0.1:19410/' });
  expect(runtime).toEqual(configuration);
  expect(Object.isFrozen(runtime)).toBe(true);
  expect(Object.isFrozen(runtime.firebase)).toBe(true);
});

test('an absent runtime tag retains local mode while malformed, conflicting or remote demo settings fail without echoing input', () => {
  expect(readApplicationRuntime({ document, baseURL: 'http://127.0.0.1:19410/' })).toEqual({
    version: 1,
    mode: 'local',
  });
  const configuration = demoRuntime();
  const invalid = [
    { ...configuration, version: 2 },
    { ...configuration, mode: 'unknown' },
    { ...configuration, mode: 'local' },
    { ...configuration, environment: 'unknown' },
    { ...configuration, apiOrigin: 'https://remote.example.invalid' },
    { ...configuration, apiOrigin: 'http://127.0.0.1.evil.invalid:19410' },
    { ...configuration, apiOrigin: 'http://user:DO-NOT-ECHO-CONFIG@127.0.0.1:19410' },
    { ...configuration, authEmulatorOrigin: 'https://remote.example.invalid' },
    { ...configuration, firebase: { ...configuration.firebase, projectId: 'actual-project' } },
    {
      ...configuration,
      firebase: { ...configuration.firebase, storageBucket: 'actual-project.firebasestorage.app' },
    },
    {
      ...configuration,
      firebase: {
        ...configuration.firebase,
        ...JSON.parse('{"private_key":"DO-NOT-ECHO-CONFIG"}'),
      },
    },
    { ...configuration, environment: 'production' },
  ];
  const rejected = (value, baseURL = 'http://127.0.0.1:19410/') => {
    let failure;
    try {
      validateApplicationRuntime(value, { baseURL });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ status: 503, code: 'invalid-cloud-runtime' });
    expect(failure.message).not.toContain('DO-NOT-ECHO-CONFIG');
    expect(failure.cause).toBeUndefined();
  };
  for (const value of invalid) rejected(value);
  rejected(configuration, 'https://remote.example.invalid/');
  rejected(configuration, 'not-a-valid-url');
});

test('malformed runtime JSON, duplicate tags and executable configuration are explicit failures without a local fallback', () => {
  const element = document.createElement('script');
  element.id = 'taverntable-runtime';
  element.type = 'application/json';
  element.textContent = '{"credential":"DO-NOT-ECHO-CONFIG"';
  document.head.append(element);
  let failure;
  try {
    readApplicationRuntime({ document, baseURL: 'http://127.0.0.1:19410/' });
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ status: 503, code: 'invalid-cloud-runtime' });
  expect(failure.message).not.toContain('DO-NOT-ECHO-CONFIG');
  expect(failure.cause).toBeUndefined();
  element.textContent = JSON.stringify(demoRuntime());
  const duplicate = element.cloneNode(true);
  document.head.append(duplicate);
  expect(() => readApplicationRuntime({ document, baseURL: 'http://127.0.0.1:19410/' })).toThrow(
    'No local storage fallback'
  );
  duplicate.remove();
  element.type = 'text/plain';
  expect(() => readApplicationRuntime({ document, baseURL: 'http://127.0.0.1:19410/' })).toThrow(
    'No local storage fallback'
  );
});

test('production runtime requires an explicit real project and HTTPS API without emulator overrides', () => {
  const configuration = {
    version: 1,
    mode: 'cloud',
    environment: 'production',
    apiOrigin: 'https://backend.example.invalid',
    firebase: {
      apiKey: 'public-configuration-key',
      projectId: 'taverntable-fixture',
      authDomain: 'taverntable-fixture.firebaseapp.com',
      appId: 'fixture-web-app',
      storageBucket: 'taverntable-fixture.firebasestorage.app',
    },
  };
  expect(
    validateApplicationRuntime(configuration, { baseURL: 'https://taverntable-fixture.web.app/' })
  ).toEqual(configuration);
  expect(() =>
    validateApplicationRuntime(
      { ...configuration, authEmulatorOrigin: 'http://127.0.0.1:19099' },
      {
        baseURL: 'https://taverntable-fixture.web.app/',
      }
    )
  ).toThrow('No local storage fallback');
  expect(() =>
    validateApplicationRuntime(
      { ...configuration, apiOrigin: 'http://127.0.0.1:19410' },
      {
        baseURL: 'https://taverntable-fixture.web.app/',
      }
    )
  ).toThrow('No local storage fallback');
});
