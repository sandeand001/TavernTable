import { readFileSync } from 'node:fs';
import path from 'node:path';
import { preparePlayerApplication } from '../../../src/ui/sessions/PlayerApplication.js';
import SessionConnection from '../../../src/campaigns/SessionConnection.js';
import { createCampaignBoard } from '../../helpers/campaignBoard.js';
import { publicPlayerState } from '../../helpers/publicPlayerState.js';

function fixture() {
  const html = readFileSync(path.resolve(__dirname, '..', '..', '..', 'index.html'), 'utf8');
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
  const { source, state, catalog } = publicPlayerState();
  const gameManager = createCampaignBoard(source);
  const calls = [];
  const identity = { role: 'player', csrf: 'test-only-csrf' };
  const connection = new SessionConnection({
    identity,
    fetch: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return { ok: true, json: async () => ({ result: state }) };
    },
    EventSource: class {
      addEventListener() {}
      close() {}
    },
  });
  const resources = { catalog: async () => catalog, close: () => {} };
  return { gameManager, state, calls, identity, connection, resources };
}

afterEach(() => {
  document.body.replaceChildren();
  delete document.body.dataset.sessionRole;
});

test('the player startup rejects a DM identity without using query flags to change roles', async () => {
  const f = fixture();
  await expect(
    preparePlayerApplication({
      ...f,
      identity: { role: 'dm', csrf: 'test-only-csrf' },
    })
  ).rejects.toThrow('authenticated player');
  expect(f.calls).toEqual([]);
  expect(f.gameManager.placedTokens).toEqual([]);
});

test('an older marker-only host fails explicitly instead of starting a simplified or local-authority player viewer', async () => {
  const f = fixture();
  delete f.state.publicScene;
  await expect(preparePlayerApplication(f)).rejects.toThrow('interactive player snapshot');
  expect(f.gameManager.placedTokens).toEqual([]);
  expect(f.gameManager.playerApplication).toBeUndefined();
});

test('a versioned unplaced-player state keeps assigned sheets while disabling every world-view selector', async () => {
  const f = fixture();
  f.state.observerTokenId = null;
  f.state.observers = [];
  f.state.maps = [];
  f.state.location = null;
  f.state.publicScene = {
    version: 1,
    assetKey: null,
    assets: null,
    presentation: { mapId: null, focusTokenId: null },
    actors: [],
    updates: [],
  };
  f.state.gameplay = { version: 1, commands: [], ownedTokens: [], turn: null };
  const app = await preparePlayerApplication(f);
  await app.start();
  expect(app.sheets.library.list()).toHaveLength(2);
  expect(f.gameManager.placedTokens).toEqual([]);
  expect(document.querySelector('[aria-label="Active character"]').disabled).toBe(true);
  expect(document.querySelector('[aria-label="Location area"]').disabled).toBe(true);
  expect(document.getElementById('saved-character-roster').textContent).toContain('Wizard');
  expect(f.gameManager.threeSceneManager.scene.visible).toBe(false);
  await app.destroy();
});
