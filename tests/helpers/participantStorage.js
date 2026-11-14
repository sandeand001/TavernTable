import { webcrypto } from 'node:crypto';
import { testIndexedDB } from './indexedDB.js';

export function participantStorage({ beforePut = async () => {} } = {}) {
  const entries = new Map();
  const held = new Set();
  const pending = new Map();
  return {
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
    entries,
    cacheStorage: {
      open: async () => ({
        put: async (request, response) => {
          await beforePut(request);
          entries.set(request.url, {
            bytes: new Uint8Array(await response.arrayBuffer()),
            headers: new Headers(response.headers),
          });
        },
        match: async (request) => {
          const entry = entries.get(request.url);
          return entry && new Response(entry.bytes.slice(), { headers: entry.headers });
        },
        delete: async (request) => entries.delete(request.url),
        keys: async () => [...entries.keys()].map((url) => new Request(url)),
      }),
    },
    locks: {
      request: (name, { mode }, operation) => {
        const run = async () => {
          const lock = { name, mode };
          held.add(lock);
          try {
            return await operation(lock);
          } finally {
            held.delete(lock);
          }
        };
        if (mode === 'shared') return run();
        const task = (pending.get(name) ?? Promise.resolve()).then(run, run);
        pending.set(name, task);
        return task;
      },
      query: async () => ({ held: [...held], pending: [] }),
    },
  };
}
