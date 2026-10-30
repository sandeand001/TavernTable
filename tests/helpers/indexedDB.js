import { serialize, deserialize } from 'node:v8';
import { IDBFactory } from 'fake-indexeddb';

export function testIndexedDB() {
  if (!globalThis.structuredClone) {
    globalThis.structuredClone = (value) => deserialize(serialize(value));
  }
  return new IDBFactory();
}
