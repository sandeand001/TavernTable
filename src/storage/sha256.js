export async function sha256(bytes, crypto = globalThis.crypto) {
  if (!crypto?.subtle) throw new Error('Integrity verification requires localhost or HTTPS');
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
