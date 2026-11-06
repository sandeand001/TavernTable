/** @jest-environment node */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import http from 'node:http';
import CampaignWorkspace from '../../src/campaigns/CampaignWorkspace.js';
import { testIndexedDB } from '../helpers/indexedDB.js';
import { sceneState } from '../helpers/sceneState.js';
import { TerrainGeometry } from '../../src/terrain/TerrainGeometry.js';

const root = path.resolve(__dirname, '..', '..');
let folder;
let processes;

function proxyRequest(url, headers, body = null) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      url,
      {
        method: body === null ? 'GET' : 'POST',
        headers,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
          })
        );
      }
    );
    request.on('error', reject);
    request.end(body === null ? undefined : JSON.stringify(body));
  });
}

async function start(extraArgs = []) {
  const child = spawn(
    process.execPath,
    [path.join(root, 'tools', 'local-host.js'), '--port', '0', '--data-dir', folder, ...extraArgs],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  processes.add(child);
  let errors = '';
  child.stderr.on('data', (chunk) => {
    errors = (errors + chunk.toString()).slice(-4000);
  });
  const url = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Host startup timed out: ${errors}`)), 15000);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Host exited (${code}): ${errors}`));
    });
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const line = output.split('\n').find((entry) => entry.startsWith('TavernTable host ready '));
      if (line) {
        clearTimeout(timer);
        resolve(JSON.parse(line.slice('TavernTable host ready '.length)).url);
      }
    });
  });
  const key = (await fs.readFile(path.join(folder, 'host-access-key'), 'utf8')).trim();
  const login = await fetch(url + '/api/session/host', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  if (!login.ok) throw new Error('The local test operator could not sign in');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const host = await (await fetch(url + '/api/host', { headers: { Cookie: cookie } })).json();
  return {
    child,
    url,
    host,
    cookie,
    async request(operation, args = [], overrides = {}) {
      const response = await fetch(url + '/api/campaigns', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-TavernTable-Host': host.token,
          Cookie: cookie,
          ...overrides,
        },
        body: JSON.stringify({ operation, args }),
      });
      return { status: response.status, ...(await response.json()) };
    },
  };
}

async function terminate(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGKILL');
  await exited;
}

beforeEach(async () => {
  folder = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-host-process-'));
  processes = new Set();
});
afterEach(async () => {
  await Promise.all([...processes].map(terminate));
  await fs.rm(folder, { recursive: true, force: true });
});

test('authenticated live notifications publish committed changes and reject anonymous subscribers', async () => {
  const host = await start();
  expect((await fetch(host.url + '/api/events')).status).toBe(401);
  const campaign = (await host.request('create', [{ name: 'Live table', ruleset: '2024' }])).result;
  const controller = new AbortController();
  const response = await fetch(host.url + '/api/events', {
    headers: { Cookie: host.cookie },
    signal: controller.signal,
  });
  const reader = response.body.getReader();
  try {
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    await reader.read();
    await host.request('update', [campaign.id, { name: 'Live update' }]);
    const message = new TextDecoder().decode((await reader.read()).value);
    expect(message).toContain('event: campaign');
    expect(message).toContain(campaign.id);
    expect(message).toContain('"kind":"update"');
    expect(message).not.toContain(host.host.token);
  } finally {
    controller.abort();
    await reader.cancel().catch((error) => {
      if (error.name !== 'AbortError') throw error;
    });
  }
}, 30000);

test('a configured internet origin requires HTTPS proxying and cannot sign in as the host', async () => {
  const origin = 'https://table.example.invalid';
  const host = await start(['--public-origin', origin]);
  const headers = { Host: new URL(origin).host, Origin: origin };
  expect((await proxyRequest(host.url + '/api/session', headers)).status).toBe(426);
  const key = (await fs.readFile(path.join(folder, 'host-access-key'), 'utf8')).trim();
  const response = await proxyRequest(
    host.url + '/api/session/host',
    {
      ...headers,
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
    },
    { key }
  );
  expect(response.status).toBe(403);
  const campaign = (await host.request('create', [{ name: 'HTTPS table', ruleset: '2024' }]))
    .result;
  const invitation = (await host.request('createInvite', [campaign.id, { name: 'Remote player' }]))
    .result;
  const join = await proxyRequest(
    host.url + '/api/session/join',
    {
      ...headers,
      'X-Forwarded-Proto': 'https',
      'Content-Type': 'application/json',
    },
    { invite: invitation.invite }
  );
  expect(join.status).toBe(200);
  expect(join.headers['set-cookie'][0]).toContain('HttpOnly');
  expect(join.headers['set-cookie'][0]).toContain('SameSite=Strict');
  expect(join.headers['set-cookie'][0]).toContain('Secure');
  expect((await host.request('list', [], { Origin: 'https://unrelated.invalid' })).status).toBe(
    403
  );
}, 30000);

test('acknowledged campaign state survives killing the host process and an independent client reconnect', async () => {
  const first = await start();
  const created = await first.request('create', [{ name: 'Restart proof', ruleset: '2024' }]);
  expect(created.status).toBe(200);
  const id = created.result.id;
  expect(
    (
      await first.request('commitCharacters', [
        id,
        {
          ruleset: '2024',
          revision: 0,
          records: [
            { key: 'character', value: '{"hp":7,"slotsUsed":[1,2],"favorites":["spell:fly"]}' },
          ],
          scene: {
            revision: 0,
            value: '{"version":3,"maps":[{"id":"floor"}],"turn":17,"effects":["fly"]}',
          },
        },
      ])
    ).status
  ).toBe(200);
  const before = (await first.request('readCharacters', [id])).result;
  await terminate(first.child);
  const reopened = await start();
  const after = await reopened.request('readCharacters', [id]);
  expect(after.status).toBe(200);
  expect(after.result).toEqual(before);
  expect((await reopened.request('list')).result.map((entry) => entry.id)).toEqual([id]);
  expect(
    (await reopened.request('list', [], { 'X-TavernTable-Host': first.host.token })).status
  ).toBe(403);
}, 30000);

test('concurrent clients cannot overwrite newer character or scene revisions', async () => {
  const host = await start();
  const id = (await host.request('create', [{ name: 'Two clients', ruleset: '2014' }])).result.id;
  const results = await Promise.all(
    ['first', 'second'].map((value) =>
      host.request('commitCharacters', [
        id,
        {
          ruleset: '2014',
          revision: 0,
          records: [{ key: 'resource', value }],
          scene: { revision: 0, value: JSON.stringify({ chosen: value }) },
        },
      ])
    )
  );
  expect(results.map((result) => result.status).sort()).toEqual([200, 409]);
  const saved = (await host.request('readCharacters', [id])).result;
  expect(saved.revision).toBe(1);
  expect(saved.sceneRevision).toBe(1);
  expect(JSON.parse(saved.scene).chosen).toBe(saved.records[0].value);
}, 30000);

test('the local host rejects foreign origins, missing tokens and non-public static files', async () => {
  const host = await start();
  expect((await host.request('list', [], { Origin: 'https://unrelated.invalid' })).status).toBe(
    403
  );
  expect((await host.request('list', [], { 'X-TavernTable-Host': '' })).status).toBe(403);
  expect((await host.request('close')).status).toBe(400);
  expect((await fetch(host.url + '/.git/config')).status).toBe(404);
  expect((await fetch(host.url + '/tools/local-host.js')).status).toBe(404);
  expect(
    (await fetch(host.url + '/src/campaigns/CampaignStore.js')).headers.get('content-type')
  ).toContain('javascript');
  expect((await fetch(host.url + '/')).status).toBe(200);
}, 30000);

test('automatic/manual JSON backup files are discoverable and restore without replacing the original', async () => {
  const host = await start();
  const id = (await host.request('create', [{ name: 'JSON snapshots', ruleset: '2024' }])).result
    .id;
  expect((await host.request('backupStatus', [id])).result).toMatchObject({
    state: 'pending',
    retain: 20,
    intervalMs: 300000,
  });
  const snapshot = await host.request('backupNow', [id]);
  expect(snapshot.status).toBe(200);
  const text = (await host.request('readBackup', [id, snapshot.result.name])).result;
  expect(JSON.parse(text)).toMatchObject({ format: 'taverntable-campaign', version: 2 });
  const copy = await host.request('importBackup', [text]);
  expect(copy.result.id).not.toBe(id);
  expect((await host.request('list')).result).toHaveLength(2);
  expect(
    (await fs.readdir(path.join(folder, 'backups', id))).filter((name) => name.endsWith('.json'))
  ).toHaveLength(1);
}, 30000);

test('player access follows assigned characters across isolated locations without per-area publication', async () => {
  let host = await start();
  expect((await fetch(host.url + '/api/host')).status).toBe(401);
  const workspace = await CampaignWorkspace.load({
    storage: 'browser',
    fetch,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
    baseURL: host.url + '/',
  });
  let campaignId;
  let hero;
  let npc;
  let scout;
  try {
    const campaign = await workspace.create({ name: 'Private table', ruleset: '2024' });
    const opened = await workspace.open(campaign.id);
    hero = await opened.library.create('Player hero');
    npc = await opened.library.create('Private NPC');
    scout = await opened.library.create('Remote scout');
    await opened.library.edit(npc, { notes: 'DM SECRET NOTES' });
    const legacy = sceneState({ ruleset: '2024', characterId: hero, name: 'Player hero' });
    legacy.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
    const geometry = new TerrainGeometry({
      widthFeet: 25,
      depthFeet: 25,
      getTerrainHeightFeet: () => 0,
    });
    geometry.addSolid({
      id: 'sight-wall',
      bounds: { min: { x: 12, y: 0, z: 0 }, max: { x: 13, y: 15, z: 25 } },
    });
    legacy.terrain.geometry = geometry.save();
    const scene = {
      version: 3,
      ruleset: '2024',
      locations: [
        { id: 'courtyard-location', name: 'Courtyard' },
        { id: 'secret-location', name: 'DM SECRET LOCATION' },
      ],
      maps: ['visible', 'hidden'].map((id, index) => ({
        id,
        locationId: index ? 'secret-location' : 'courtyard-location',
        name: index ? 'DM SECRET MAP' : 'Published map',
        originFeet: { x: 0, y: 0, z: 0 },
        quarterTurns: 0,
        base: 'ground',
        grid: legacy.grid,
        terrain: legacy.terrain,
      })),
      creatures: legacy.creatures.map((token) => ({ ...token, mapId: 'visible' })),
      tokenCounters: legacy.tokenCounters,
      combat: legacy.combat,
      rollLog: [],
      view: { mapId: 'visible', focusTokenId: null, camera: legacy.camera },
    };
    scene.maps.push({
      ...scene.maps[0],
      id: 'connected-area',
      name: 'Connected area',
      originFeet: { x: 30, y: 0, z: 0 },
    });
    const actor = scene.creatures[0];
    scene.creatures.push(
      {
        ...actor,
        id: 'near-guard',
        name: 'Visible guard',
        characterId: null,
        nameMode: 'custom',
        instanceNumber: 2,
        gridX: 0,
        movement: { mode: 'walk', type: 'default', speed: 30 },
        pose: { kind: 'ground', world: { x: 0.5, y: 0, z: 1.5 } },
      },
      {
        ...actor,
        id: 'secret-guard',
        name: 'DM SECRET GUARD',
        characterId: null,
        nameMode: 'custom',
        instanceNumber: 3,
        gridX: 4,
        movement: { mode: 'walk', type: 'default', speed: 30 },
        pose: { kind: 'ground', world: { x: 4.5, y: 0, z: 1.5 } },
      },
      {
        ...actor,
        id: 'remote-scout',
        name: 'Remote scout',
        characterId: scout,
        instanceNumber: 4,
        mapId: 'hidden',
      }
    );
    scene.tokenCounters.nextId = 3;
    scene.tokenCounters.types[0][1] = 4;
    const backup = JSON.parse(await workspace.exportBackup(campaign.id));
    backup.scene = JSON.stringify(scene);
    campaignId = (await host.request('importBackup', [JSON.stringify(backup)])).result.id;
  } finally {
    workspace.close();
  }
  const invitation = (
    await host.request('createInvite', [campaignId, { name: 'Returning player' }])
  ).result;
  expect(
    (await host.request('assignCharacter', [campaignId, invitation.id, hero, true])).status
  ).toBe(200);
  async function join() {
    const response = await fetch(host.url + '/api/session/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invite: invitation.invite }),
    });
    expect(response.status).toBe(200);
    const profile = await response.json();
    const cookie = response.headers.get('set-cookie').split(';')[0];
    return {
      profile,
      cookie,
      request: (operation, args) =>
        host.request(operation, args, {
          Cookie: cookie,
          'X-TavernTable-Host': profile.csrf,
        }),
    };
  }
  const player = await join();
  const state = await player.request('playerState', [{}]);
  expect(state.status).toBe(200);
  expect(state.result.profile.characterIds).toEqual([hero]);
  const allowedAreas = [
    { id: 'visible', name: 'Published map' },
    { id: 'connected-area', name: 'Connected area' },
  ];
  expect(state.result.maps).toEqual(allowedAreas);
  expect(state.result.location).toEqual({ id: 'courtyard-location', name: 'Courtyard' });
  expect(state.result.view.terrain.positions.length).toBeGreaterThan(0);
  expect(state.result.observerTokenId).toBe('token-1');
  expect(state.result.view.tokens.map(({ id }) => id)).toEqual(['token-1', 'near-guard']);
  expect(JSON.stringify(state.result)).not.toContain('DM SECRET');
  expect(JSON.stringify(state.result)).not.toContain(npc);
  expect((await player.request('playerState', [{ mapId: 'hidden' }])).status).toBe(403);
  expect((await player.request('playerState', [{ mapId: 'connected-area' }])).status).toBe(200);
  expect((await player.request('playerState', [{ observerTokenId: 'secret-guard' }])).status).toBe(
    403
  );
  expect((await player.request('list', [])).status).toBe(403);
  expect((await player.request('commitScene', [campaignId, {}])).status).toBe(403);
  const records = state.result.records.map((row) => {
    if (row.key === `taverntable.character.v1.${hero}`) {
      const character = JSON.parse(row.value);
      character.notes = 'My persistent character notes';
      return { ...row, value: JSON.stringify(character) };
    }
    return row;
  });
  const change = { ruleset: '2024', revision: state.result.revision, records };
  expect(
    (await player.request('playerCommit', [campaignId, { ...change, scene: {} }])).status
  ).toBe(403);
  expect(
    (
      await player.request('playerCommit', [
        campaignId,
        {
          ...change,
          records: [...records, { key: `taverntable.character.v1.${npc}`, value: '{}' }],
        },
      ])
    ).status
  ).toBe(403);
  expect((await player.request('playerCommit', [campaignId, change])).status).toBe(200);
  const reconnected = await join();
  const restored = (
    await reconnected.request('playerState', [{ terrainKey: state.result.view.terrainKey }])
  ).result;
  expect(restored.view.terrain).toBeNull();
  expect(JSON.parse(restored.records.find((row) => row.key.endsWith(hero)).value).notes).toBe(
    'My persistent character notes'
  );
  expect(
    (await host.request('readCharacters', [campaignId])).result.records.some((row) =>
      row.value.includes('DM SECRET NOTES')
    )
  ).toBe(true);
  await host.request('assignCharacter', [campaignId, invitation.id, scout, true]);
  const otherLocation = await player.request('playerState', [{ observerTokenId: 'remote-scout' }]);
  expect(otherLocation.status).toBe(200);
  expect(otherLocation.result.location.id).toBe('secret-location');
  expect(otherLocation.result.maps).toEqual([{ id: 'hidden', name: 'DM SECRET MAP' }]);
  expect(otherLocation.result.view.tokens.map((token) => token.id)).toEqual(['remote-scout']);
  expect(
    (await player.request('playerState', [{ observerTokenId: 'token-1', mapId: 'hidden' }])).status
  ).toBe(403);
  await host.request('assignCharacter', [campaignId, invitation.id, scout, false]);
  await terminate(host.child);
  host = await start();
  const afterRestart = await join();
  const restartedState = (await afterRestart.request('playerState', [{}])).result;
  expect(restartedState.profile.playerId).toBe(invitation.id);
  expect(restartedState.profile.characterIds).toEqual([hero]);
  expect(restartedState.maps).toEqual(allowedAreas);
  expect(JSON.parse(restartedState.records.find((row) => row.key.endsWith(hero)).value).notes).toBe(
    'My persistent character notes'
  );
  await host.request('revokeInvite', [campaignId, invitation.id]);
  expect((await afterRestart.request('playerState', [{}])).status).toBe(401);
}, 30000);
