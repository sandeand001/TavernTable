const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
const invalidRuntime = () =>
  Object.assign(
    new Error(
      'The cloud runtime configuration is invalid. No local storage fallback was selected.'
    ),
    { code: 'invalid-cloud-runtime', status: 503 }
  );
const knownKeys = (value, names) => Object.keys(value).every((key) => names.includes(key));

function runtimeURL(value) {
  if (typeof value !== 'string') throw invalidRuntime();
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    if (error instanceof TypeError || error?.name === 'TypeError') throw invalidRuntime();
    throw error;
  }
  return url;
}

function originURL(value, loopbackOnly = false) {
  const url = runtimeURL(value);
  const loopback = loopbackHosts.has(url.hostname);
  if (
    url.origin !== value ||
    (loopbackOnly && !loopback) ||
    !(url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) ||
    (url.port !== '' && Number(url.port) < 1)
  )
    throw invalidRuntime();
  return url;
}

export function validateApplicationRuntime(value, { baseURL = globalThis.location.href } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1)
    throw invalidRuntime();
  if (value.mode === 'local') {
    if (!knownKeys(value, ['version', 'mode'])) throw invalidRuntime();
    return Object.freeze({ version: 1, mode: 'local' });
  }
  if (
    value.mode !== 'cloud' ||
    !['emulator', 'production'].includes(value.environment) ||
    !knownKeys(value, [
      'version',
      'mode',
      'environment',
      'apiOrigin',
      'authEmulatorOrigin',
      'firebase',
    ])
  )
    throw invalidRuntime();
  const firebase = value.firebase;
  if (
    !firebase ||
    typeof firebase !== 'object' ||
    Array.isArray(firebase) ||
    !knownKeys(firebase, [
      'apiKey',
      'projectId',
      'authDomain',
      'appId',
      'storageBucket',
      'messagingSenderId',
    ]) ||
    ['apiKey', 'projectId', 'authDomain', 'appId'].some(
      (key) => typeof firebase[key] !== 'string' || !firebase[key]
    ) ||
    ['storageBucket', 'messagingSenderId'].some(
      (key) => Object.hasOwn(firebase, key) && (typeof firebase[key] !== 'string' || !firebase[key])
    ) ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(firebase.projectId)
  )
    throw invalidRuntime();
  const authDomain = originURL(`https://${firebase.authDomain}`);
  if (authDomain.host !== firebase.authDomain) throw invalidRuntime();
  const frontend = originURL(runtimeURL(baseURL).origin, value.environment === 'emulator');
  const api = originURL(value.apiOrigin, value.environment === 'emulator');
  if (value.environment === 'emulator') {
    const auth = originURL(value.authEmulatorOrigin, true);
    if (
      !firebase.projectId.startsWith('demo-') ||
      firebase.apiKey !== 'demo-api-key' ||
      firebase.authDomain !== `${firebase.projectId}.firebaseapp.com` ||
      (Object.hasOwn(firebase, 'storageBucket') &&
        firebase.storageBucket !== `${firebase.projectId}.appspot.com`) ||
      auth.protocol !== 'http:' ||
      !loopbackHosts.has(frontend.hostname) ||
      !loopbackHosts.has(api.hostname)
    )
      throw invalidRuntime();
  } else if (
    firebase.projectId.startsWith('demo-') ||
    firebase.apiKey === 'demo-api-key' ||
    api.protocol !== 'https:' ||
    Object.hasOwn(value, 'authEmulatorOrigin') ||
    (Object.hasOwn(firebase, 'storageBucket') &&
      ![`${firebase.projectId}.appspot.com`, `${firebase.projectId}.firebasestorage.app`].includes(
        firebase.storageBucket
      ))
  ) {
    throw invalidRuntime();
  }
  return Object.freeze({ ...value, firebase: Object.freeze({ ...firebase }) });
}

export function readApplicationRuntime({
  document = globalThis.document,
  baseURL = globalThis.location.href,
} = {}) {
  const elements = document.querySelectorAll('[id="taverntable-runtime"]');
  if (!elements.length) return Object.freeze({ version: 1, mode: 'local' });
  if (
    elements.length !== 1 ||
    elements[0].tagName !== 'SCRIPT' ||
    elements[0].type.toLowerCase() !== 'application/json'
  )
    throw invalidRuntime();
  let value;
  try {
    value = JSON.parse(elements[0].textContent);
  } catch (error) {
    if (error instanceof SyntaxError || error?.name === 'SyntaxError') throw invalidRuntime();
    throw error;
  }
  return validateApplicationRuntime(value, { baseURL });
}
