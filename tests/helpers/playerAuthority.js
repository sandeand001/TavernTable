import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { webcrypto } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../src/campaigns/CampaignWorkspace.js';
import CombatSession from '../../src/entities/characters/CombatSession.js';
import SessionConnection from '../../src/campaigns/SessionConnection.js';
import { linkTokenCharacter } from '../../src/entities/creatures/TokenMovement.js';
import { testIndexedDB } from './indexedDB.js';
import { fetchBundledResource } from './bundledResources.js';
import { sceneState } from './sceneState.js';

export const authorityRoot =
  process.env.TAVERNTABLE_AUTHORITY_TREE || path.resolve(__dirname, '..', '..');

function request(url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      url,
      { method: body === null ? 'GET' : 'POST', headers },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          try {
            resolve({
              status: response.statusCode,
              headers: response.headers,
              body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
            });
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    outgoing.on('error', reject);
    outgoing.end(body === null ? undefined : JSON.stringify(body));
  });
}

function participant(url, cookie, csrf, liveUpdates = false) {
  const calls = [];
  class TestEventSource {
    constructor(route) {
      this.listeners = new Map();
      this.request = http.get(route, { headers: { Cookie: cookie } }, (response) => {
        this.response = response;
        if (response.statusCode !== 200) {
          response.resume();
          this.emit('error', new Error(`Live test session failed (${response.statusCode})`));
          return;
        }
        let buffered = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          buffered += chunk.replaceAll('\r\n', '\n');
          let boundary;
          while ((boundary = buffered.indexOf('\n\n')) !== -1) {
            const lines = buffered.slice(0, boundary).split('\n');
            buffered = buffered.slice(boundary + 2);
            const kind = lines
              .find((line) => line.startsWith('event:'))
              ?.slice(6)
              .trim();
            const data = lines
              .filter((line) => line.startsWith('data:'))
              .map((line) => line.slice(5).trimStart())
              .join('\n');
            if (kind && data) this.emit(kind, { data });
          }
        });
        response.on('error', (error) => {
          if (!this.closed) this.emit('error', error);
        });
        response.on('end', () => {
          if (!this.closed) this.emit('error', new Error('The live test session ended'));
        });
        this.emit('open', {});
      });
      this.request.on('error', (error) => {
        if (!this.closed) this.emit('error', error);
      });
    }
    addEventListener(kind, listener) {
      const listeners = this.listeners.get(kind) || [];
      listeners.push(listener);
      this.listeners.set(kind, listeners);
    }
    emit(kind, event) {
      for (const listener of this.listeners.get(kind) || []) listener(event);
    }
    close() {
      this.closed = true;
      this.response?.destroy();
      this.request.destroy();
    }
  }
  const connection = new SessionConnection({
    identity: { role: 'player', csrf },
    baseURL: url + '/',
    fetch: async (route, options) => {
      calls.push(JSON.parse(options.body));
      const response = await request(route, JSON.parse(options.body), {
        ...options.headers,
        Cookie: cookie,
      });
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        json: async () => response.body,
      };
    },
    EventSource: liveUpdates
      ? TestEventSource
      : class {
          addEventListener() {}
          close() {}
        },
  });
  return { connection, calls };
}

export async function createPlayerAuthorityTable({
  activeTurn = true,
  placed = true,
  characterUpdates = {},
  spells = [],
  visibleNPC = false,
  liveUpdates = false,
} = {}) {
  const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-client-interop-'));
  let child;
  const close = async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = new Promise((resolve) => child.once('exit', resolve));
      child.kill('SIGTERM');
      await exited;
    }
    await fs.rm(dataDirectory, { recursive: true, force: true });
  };
  try {
    child = spawn(
      process.execPath,
      [
        path.join(authorityRoot, 'tools', 'local-host.js'),
        '--port',
        '0',
        '--data-dir',
        dataDirectory,
      ],
      { cwd: authorityRoot, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-4000);
    });
    const url = await new Promise((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(
        () => reject(new Error(`Isolated authority timed out: ${stderr}`)),
        15000
      );
      const fail = (error) => {
        clearTimeout(timer);
        reject(error);
      };
      child.once('error', fail);
      child.once('exit', (code) => fail(new Error(`Authority exited ${code}: ${stderr}`)));
      child.stdout.on('data', (chunk) => {
        stdout += chunk;
        const ready = stdout.split('\n').find((line) => line.startsWith('TavernTable host ready '));
        if (!ready) return;
        clearTimeout(timer);
        resolve(JSON.parse(ready.slice('TavernTable host ready '.length)).url);
      });
    });
    const key = (await fs.readFile(path.join(dataDirectory, 'host-access-key'), 'utf8')).trim();
    const login = await request(
      url + '/api/session/host',
      { key },
      { 'Content-Type': 'application/json' }
    );
    if (login.status !== 200) throw new Error('The isolated DM session did not authenticate');
    const cookie = login.headers['set-cookie'][0].split(';')[0];
    const identity = await request(url + '/api/host', null, { Cookie: cookie });
    const dm = participant(url, cookie, identity.body.token, liveUpdates);
    dm.identity = identity.body.identity;
    dm.connection.identity = { ...dm.identity, csrf: identity.body.token };
    const previousDecoder = globalThis.TextDecoder;
    globalThis.TextDecoder ??= TextDecoder;
    const workspace = await CampaignWorkspace.load({
      storage: 'browser',
      fetch: fetchBundledResource,
      indexedDB: testIndexedDB(),
      crypto: webcrypto,
    });
    let records;
    let scene;
    let characterId;
    let catalog;
    try {
      const campaign = await workspace.create({ name: 'Native client interop', ruleset: '2024' });
      const opened = await workspace.open(campaign.id);
      catalog = await workspace.resources.catalog(campaign);
      characterId = await opened.library.create('Assigned scout');
      if (Object.keys(characterUpdates).length)
        await opened.library.edit(characterId, characterUpdates);
      for (const entryId of spells) {
        const spellId = await opened.library.add(characterId, entryId);
        await opened.library.prepare(characterId, spellId, true);
      }
      const privateId = await opened.library.create('DM-only record');
      await opened.library.edit(privateId, { notes: 'PRIVATE AUTHORITY FIXTURE NOTES' });
      scene = sceneState({ ruleset: '2024', characterId, name: 'Assigned scout' });
      scene.terrain.heights = Array.from({ length: 5 }, () => Array(5).fill(0));
      if (visibleNPC) {
        scene.creatures.push({
          ...scene.creatures[0],
          id: 'token-2',
          instanceNumber: 2,
          characterId: privateId,
          name: opened.library.get(privateId).name,
          gridX: 2,
          gridY: 1,
          pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
        });
        scene.tokenCounters = { nextId: 2, types: [['mannequin', 2]] };
      }
      const token = { id: 'token-1', world: { ...scene.creatures[0].pose.world } };
      linkTokenCharacter(token, opened.library, characterId);
      const combat = new CombatSession({
        library: opened.library,
        hasToken: (actor) => actor === token,
      });
      if (activeTurn) {
        await combat.startTurn(token);
        scene.combat = combat.snapshot();
      }
      if (!placed) scene.creatures = [];
      records = opened.library.engine.storage.snapshot();
    } finally {
      workspace.close();
      if (previousDecoder === undefined) delete globalThis.TextDecoder;
      else globalThis.TextDecoder = previousDecoder;
    }
    const campaign = await dm.connection.call('create', [
      { name: 'Native client interop', ruleset: '2024' },
    ]);
    await dm.connection.call('commitCharacters', [
      campaign.id,
      {
        ruleset: '2024',
        revision: 0,
        records,
        scene: { revision: 0, value: JSON.stringify(scene) },
      },
    ]);
    const invitation = await dm.connection.call('createInvite', [campaign.id, { name: 'Player' }]);
    await dm.connection.call('assignCharacter', [campaign.id, invitation.id, characterId, true]);
    const joined = await request(
      url + '/api/session/join',
      { invite: invitation.invite },
      { 'Content-Type': 'application/json' }
    );
    if (joined.status !== 200) throw new Error('The isolated player invitation did not join');
    const playerCookie = joined.headers['set-cookie'][0].split(';')[0];
    const session = await request(url + '/api/session', null, { Cookie: playerCookie });
    const player = participant(url, playerCookie, session.body.csrf, liveUpdates);
    return {
      ...player,
      identity: session.body,
      dm,
      campaign,
      playerId: invitation.id,
      characterId,
      catalog,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
