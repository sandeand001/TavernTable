export const PROTECTED_ASSET_MAGIC = Object.freeze([0x54, 0x54, 0x41, 0x31]);
export const PROTECTED_ASSET_MAX_BYTES = 64 * 1024 * 1024;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = PROTECTED_ASSET_MAGIC.length + NONCE_BYTES;

export function isProtectedAssetId(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value);
}

export function protectedAssetAAD(keyId, assetId) {
  if (!isProtectedAssetId(keyId) || !isProtectedAssetId(assetId))
    throw new Error('Protected model identity is invalid');
  return new TextEncoder().encode(`taverntable-protected-v1\0${keyId}\0${assetId}`);
}

export function isProtectedAssetEnvelope(bytes) {
  return (
    bytes instanceof Uint8Array &&
    bytes.length > HEADER_BYTES + TAG_BYTES &&
    bytes.length <= PROTECTED_ASSET_MAX_BYTES &&
    PROTECTED_ASSET_MAGIC.every((value, index) => bytes[index] === value)
  );
}

export function validateEmbeddedGlb(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20)
    throw new Error('Protected models require a valid embedded GLB');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLength = view.getUint32(12, true);
  if (
    view.getUint32(0, true) !== 0x46546c67 ||
    view.getUint32(4, true) !== 2 ||
    view.getUint32(8, true) !== bytes.length ||
    view.getUint32(16, true) !== 0x4e4f534a ||
    jsonLength % 4 !== 0 ||
    20 + jsonLength > bytes.length
  )
    throw new Error('Protected models require a valid embedded GLB');
  let document;
  try {
    document = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + jsonLength))
    );
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError)
      throw new Error('Protected models require a valid embedded GLB');
    throw error;
  }
  if (!document || typeof document !== 'object' || document.asset?.version !== '2.0')
    throw new Error('Protected models require a valid embedded GLB');
  const pending = [document];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [name, child] of Object.entries(value)) {
      if (name === 'uri' && (typeof child !== 'string' || !child.startsWith('data:')))
        throw new Error('Protected models must embed every texture and resource');
      if (child && typeof child === 'object') pending.push(child);
    }
  }
}

export async function decryptProtectedAsset({
  encrypted,
  key,
  keyId,
  assetId,
  crypto = globalThis.crypto,
}) {
  const aad = protectedAssetAAD(keyId, assetId);
  if (!isProtectedAssetEnvelope(encrypted)) throw new Error('Protected model envelope is invalid');
  if (
    typeof key !== 'string' ||
    !/^[A-Za-z0-9+/]{43}=$/.test(key) ||
    typeof globalThis.atob !== 'function' ||
    typeof crypto?.subtle?.decrypt !== 'function' ||
    typeof crypto.subtle.importKey !== 'function'
  )
    throw new Error('Protected model key or browser cryptography is invalid');
  const binary = globalThis.atob(key);
  if (binary.length !== 32 || globalThis.btoa(binary) !== key)
    throw new Error('Protected model key is invalid');
  const raw = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  let plaintext;
  try {
    const imported = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    plaintext = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: encrypted.subarray(PROTECTED_ASSET_MAGIC.length, HEADER_BYTES),
        additionalData: aad,
        tagLength: TAG_BYTES * 8,
      },
      imported,
      encrypted.subarray(HEADER_BYTES)
    );
  } catch (error) {
    if (error?.name === 'OperationError' || error?.name === 'DataError')
      throw new Error('Protected model integrity check failed');
    throw error;
  } finally {
    raw.fill(0);
  }
  validateEmbeddedGlb(new Uint8Array(plaintext));
  return plaintext;
}

export async function loadProtectedAsset({ path, keyId, assetId, keyProvider }) {
  if (
    typeof path !== 'string' ||
    !/^assets\/protected\/[a-z0-9][a-z0-9-]{0,79}\.ttasset$/.test(path) ||
    !isProtectedAssetId(keyId) ||
    !isProtectedAssetId(assetId) ||
    typeof keyProvider !== 'function'
  )
    throw new Error('Protected model configuration or account access is unavailable');
  const response = await fetch(path, { credentials: 'omit', redirect: 'error' });
  if (!response.ok || typeof response.body?.getReader !== 'function')
    throw new Error('The protected model download failed');
  const declared = response.headers.get('content-length');
  if (
    declared !== null &&
    (!/^[0-9]+$/.test(declared) || Number(declared) > PROTECTED_ASSET_MAX_BYTES)
  )
    throw new Error('The protected model exceeds its download limit');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > PROTECTED_ASSET_MAX_BYTES) {
        await reader.cancel();
        throw new Error('The protected model exceeds its download limit');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const encrypted = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    encrypted.set(chunk, offset);
    offset += chunk.length;
  }
  if (!isProtectedAssetEnvelope(encrypted)) throw new Error('Protected model envelope is invalid');
  const key = await keyProvider(keyId);
  return decryptProtectedAsset({ encrypted, key, keyId, assetId });
}
