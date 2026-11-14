export function encodeBase64(bytes) {
  const parts = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000)
    parts.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  return globalThis.btoa(parts.join(''));
}
