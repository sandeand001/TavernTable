const fs = require('node:fs/promises');
const path = require('node:path');
const { createCipheriv, randomBytes } = require('node:crypto');
const { parseArgs } = require('node:util');
const {
  PROTECTED_ASSET_MAGIC,
  PROTECTED_ASSET_MAX_BYTES,
  protectedAssetAAD,
  validateEmbeddedGlb,
  isProtectedAssetId,
} = require('../../src/core/ProtectedAsset.js');

function encryptProtectedAsset(bytes, { key, keyId, assetId }) {
  if (!(bytes instanceof Uint8Array) || bytes.length + 32 > PROTECTED_ASSET_MAX_BYTES)
    throw new Error('Protected model input is invalid or too large');
  if (!(key instanceof Uint8Array) || key.length !== 32)
    throw new Error('Protected models require a 32-byte AES key');
  const aad = protectedAssetAAD(keyId, assetId);
  validateEmbeddedGlb(bytes);
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  return Buffer.concat([
    Buffer.from(PROTECTED_ASSET_MAGIC),
    nonce,
    cipher.update(bytes),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}

function inside(root, filename) {
  const relative = path.relative(root, filename);
  return relative === '' || (!relative.startsWith('..' + path.sep) && !path.isAbsolute(relative));
}

async function loadProtectedAssetKeys(root, filename) {
  if (filename === undefined) return null;
  if (typeof filename !== 'string' || !path.isAbsolute(filename))
    throw new Error('Protected model keys require an absolute private keyring file');
  const resolvedRoot = await fs.realpath(root);
  const resolved = await fs.realpath(filename);
  const stat = await fs.stat(resolved);
  if (
    inside(resolvedRoot, path.resolve(filename)) ||
    inside(resolvedRoot, resolved) ||
    !stat.isFile()
  )
    throw new Error('Protected model keys must be stored outside the application checkout');
  if (stat.size > 64 * 1024) throw new Error('Protected model keyring is invalid');
  let document;
  try {
    document = JSON.parse(await fs.readFile(resolved, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('Protected model keyring is invalid');
    throw error;
  }
  if (
    !document ||
    typeof document !== 'object' ||
    Array.isArray(document) ||
    Object.keys(document).sort().join(',') !== 'keys,version' ||
    document.version !== 1 ||
    !document.keys ||
    typeof document.keys !== 'object' ||
    Array.isArray(document.keys)
  )
    throw new Error('Protected model keyring is invalid');
  const entries = Object.entries(document.keys);
  if (!entries.length || entries.length > 128)
    throw new Error('Protected model keyring is invalid');
  const keys = new Map();
  for (const [id, value] of entries) {
    if (
      !isProtectedAssetId(id) ||
      typeof value !== 'string' ||
      !/^[A-Za-z0-9+/]{43}=$/.test(value) ||
      Buffer.from(value, 'base64').toString('base64') !== value
    )
      throw new Error('Protected model keyring is invalid');
    keys.set(id, value);
  }
  return Object.freeze({ get: (id) => keys.get(id) ?? null });
}

async function packFromArguments() {
  const { values } = parseArgs({
    options: {
      input: { type: 'string' },
      'keyring-file': { type: 'string' },
      'key-id': { type: 'string' },
      'asset-id': { type: 'string' },
      output: { type: 'string' },
    },
  });
  const root = await fs.realpath(path.resolve(__dirname, '..', '..'));
  if (
    !path.isAbsolute(values.input || '') ||
    !path.isAbsolute(values['keyring-file'] || '') ||
    !isProtectedAssetId(values['key-id']) ||
    !isProtectedAssetId(values['asset-id']) ||
    typeof values.output !== 'string'
  )
    throw new Error('Specify an absolute input and keyring, key/asset IDs and a protected output');
  const [input, keyFile] = await Promise.all([
    fs.realpath(values.input),
    fs.realpath(values['keyring-file']),
  ]);
  if (
    inside(root, path.resolve(values.input)) ||
    inside(root, path.resolve(values['keyring-file'])) ||
    inside(root, input) ||
    inside(root, keyFile) ||
    input === keyFile
  )
    throw new Error('Plaintext model and key files must remain outside the application checkout');
  const directory = path.join(root, 'assets', 'protected');
  const output = path.resolve(root, values.output);
  if (
    path.dirname(output) !== directory ||
    !/^[a-z0-9][a-z0-9-]{0,79}\.ttasset$/.test(path.basename(output))
  )
    throw new Error('Protected output must be a named .ttasset file in assets/protected');
  const inputStat = await fs.stat(input);
  if (!inputStat.isFile() || inputStat.size + 32 > PROTECTED_ASSET_MAX_BYTES)
    throw new Error('Protected model input is invalid or too large');
  const keys = await loadProtectedAssetKeys(root, keyFile);
  const encoded = keys.get(values['key-id']);
  if (encoded === null) throw new Error('The requested protected model key is unavailable');
  const key = Buffer.from(encoded, 'base64');
  try {
    const encrypted = encryptProtectedAsset(await fs.readFile(input), {
      key,
      keyId: values['key-id'],
      assetId: values['asset-id'],
    });
    await fs.mkdir(directory, { recursive: true });
    if ((await fs.realpath(directory)) !== directory)
      throw new Error('Protected output cannot traverse filesystem links');
    await fs.writeFile(output, encrypted, { flag: 'wx' });
  } finally {
    key.fill(0);
  }
  console.log(`Created protected model ${path.basename(output)}`);
}

if (require.main === module)
  packFromArguments().catch((error) => {
    console.error('[protected-assets]', error.message);
    process.exitCode = 1;
  });

module.exports = { encryptProtectedAsset, loadProtectedAssetKeys };
