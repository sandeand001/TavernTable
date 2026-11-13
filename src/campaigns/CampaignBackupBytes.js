export function campaignBackupByteLength(text) {
  if (typeof text !== 'string') throw new TypeError('Campaign backup byte counts require text');
  const encoder = new TextEncoder();
  const buffer = new Uint8Array(64 * 1024);
  let offset = 0;
  let bytes = 0;
  // Keep the encoding workspace bounded instead of copying another complete large file.
  while (offset < text.length) {
    const encoded = encoder.encodeInto(text.slice(offset), buffer);
    offset += encoded.read;
    bytes += encoded.written;
  }
  return bytes;
}
