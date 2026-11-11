import { readFileSync } from 'node:fs';
import path from 'node:path';
import SessionConnection from '../../../src/campaigns/SessionConnection.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { publicPlayerState } from '../../helpers/publicPlayerState.js';
import { fetchBundledResource } from '../../helpers/bundledResources.js';
import { testIndexedDB } from '../../helpers/indexedDB.js';
import { loadBundledResources } from '../../../src/resources/ResourceSeeds.js';
import { webcrypto } from 'node:crypto';
import * as three from 'three';
import { TextDecoder } from 'node:util';

test('authenticated player startup uses the authorized session RPC and the existing shared game manager', async () => {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const { state, source, catalog } = publicPlayerState();
  const manager = createCampaignBoard(source);
  const operations = [];
  const identity = { role: 'player', csrf: 'test-only-csrf' };
  const connection = new SessionConnection({
    identity,
    fetch: async (_url, options) => {
      const request = JSON.parse(options.body);
      operations.push(request);
      return { ok: true, json: async () => ({ result: state }) };
    },
    EventSource: class {
      addEventListener() {}
      close() {}
    },
  });
  const resources = { catalog: async () => catalog, close: () => {} };
  const { preparePlayerApplication } = require('../../../src/ui/sessions/PlayerApplication.js');
  const app = await preparePlayerApplication({
    gameManager: manager,
    identity,
    connection,
    resources,
  });
  await app.start();
  expect(operations).toEqual([{ operation: 'playerState', args: [{ presentationVersion: 1 }] }]);
  expect(manager.playerApplication).toBe(app);
  expect(manager.characterServices.sessionRole).toBe('player');
  expect(manager.characterServices.combat).toBeNull();
  expect(manager.sceneAutosave).toBeUndefined();
  expect(manager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
  await app.destroy();
  document.body.replaceChildren();
  delete document.body.dataset.sessionRole;
});

test('the normal game bootstrap routes an authenticated player to the shared renderer without requesting private campaign data', async () => {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const { state } = publicPlayerState();
  const previousFetch = globalThis.fetch;
  const previousIndexedDB = globalThis.indexedDB;
  const previousEventSource = globalThis.EventSource;
  const previousCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const previousTextDecoder = globalThis.TextDecoder;
  globalThis.TextDecoder = TextDecoder;
  globalThis.indexedDB = testIndexedDB();
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
  const loaded = await loadBundledResources({ fetch: fetchBundledResource });
  state.campaign.sourcePacks = loaded.manifest.packs
    .filter((pack) => pack.ruleset === '2014' && pack.core)
    .map(({ id, version, ruleset }) => ({ id, version, ruleset, enabled: true }));
  loaded.resources.close();
  const operations = [];
  globalThis.EventSource = class {
    addEventListener() {}
    close() {}
  };
  globalThis.fetch = async (url, options) => {
    if (new URL(url).pathname === '/api/session')
      return { ok: true, json: async () => ({ role: 'player', csrf: 'test-only-csrf' }) };
    if (new URL(url).pathname === '/api/campaigns') {
      const request = JSON.parse(options.body);
      operations.push(request.operation);
      if (request.operation !== 'playerState')
        throw new Error('Private campaign access is forbidden in this player test');
      return { ok: true, json: async () => ({ result: state }) };
    }
    return fetchBundledResource(url);
  };
  try {
    const { initializeApplication } = require('../../../src/ui/UIController.js');
    window.gameManager.__threeTestDouble = three;
    await initializeApplication();
    expect(document.querySelector('[aria-label="Opening campaign"]')?.textContent).toBeUndefined();
    expect(window.gameManager.playerApplication).toBeDefined();
    expect(window.gameManager.placedTokens.map(({ id }) => id)).toEqual(['canonical-scout']);
    expect(operations).toEqual(['playerState']);
    expect(window.gameManager.sceneAutosave).toBeUndefined();
    await window.gameManager.playerApplication.destroy();
  } finally {
    window.gameManager?.threeSceneManager?.dispose();
    globalThis.fetch = previousFetch;
    globalThis.indexedDB = previousIndexedDB;
    globalThis.EventSource = previousEventSource;
    globalThis.TextDecoder = previousTextDecoder;
    if (previousCrypto) Object.defineProperty(globalThis, 'crypto', previousCrypto);
    delete window.gameManager;
    document.body.replaceChildren();
    delete document.body.dataset.sessionRole;
  }
});
