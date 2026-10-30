import fs from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(__dirname, '..', '..');

export async function fetchBundledResource(input) {
  const url = new URL(input, globalThis.location.href);
  if (url.origin !== globalThis.location.origin)
    throw new Error('Tests must not fetch provider APIs');
  const bytes = await fs.readFile(path.join(root, ...url.pathname.split('/').filter(Boolean)));
  return {
    ok: true,
    status: 200,
    json: async () => JSON.parse(bytes.toString('utf8')),
    arrayBuffer: async () =>
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}
