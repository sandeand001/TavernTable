import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { webcrypto, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';
import CampaignWorkspace from '../../src/campaigns/CampaignWorkspace.js';
import CombatSession from '../../src/entities/characters/CombatSession.js';
import { linkTokenCharacter } from '../../src/entities/creatures/TokenMovement.js';
import { testIndexedDB } from '../helpers/indexedDB.js';
import { fetchBundledResource } from '../helpers/bundledResources.js';
import { sceneState } from '../helpers/sceneState.js';
import { TerrainGeometry } from '../../src/terrain/TerrainGeometry.js';
import CampaignWorld from '../../src/campaigns/CampaignWorld.js';
import { DatabaseSync } from 'node:sqlite';
import {
  validatePlayerState,
  validatePlayerCommandResult,
} from '../../src/campaigns/PlayerPublicProtocol.js';

const root = path.resolve(__dirname, '..', '..');
globalThis.TextDecoder ??= TextDecoder;
let dataDirectory;
let child;
let host;

function request(url, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const outgoing = http.request(
      url,
      { method: body === null ? 'GET' : 'POST', headers },
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
    outgoing.on('error', reject);
    outgoing.end(body === null ? undefined : JSON.stringify(body));
  });
}

function participant(url, cookie, csrf) {
  return {
    url,
    cookie,
    csrf,
    request: (operation, args = []) =>
      request(
        url + '/api/campaigns',
        { operation, args },
        {
          'Content-Type': 'application/json',
          Cookie: cookie,
          'X-TavernTable-Host': csrf,
        }
      ),
  };
}

async function campaignEvents(client) {
  let response;
  let buffer = '';
  const pending = [];
  const outgoing = http.get(client.url + '/api/events', { headers: { Cookie: client.cookie } });
  await new Promise((resolve, reject) => {
    outgoing.once('error', reject);
    outgoing.once('response', (received) => {
      response = received;
      expect(received.statusCode).toBe(200);
      received.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        while (buffer.includes('\n\n')) {
          const boundary = buffer.indexOf('\n\n');
          const packet = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          if (packet.startsWith(':')) resolve();
          const data = packet.split('\n').find((line) => line.startsWith('data: '));
          if (!data) continue;
          const event = JSON.parse(data.slice(6));
          for (const waiter of [...pending])
            if (waiter.kind === event.kind) {
              pending.splice(pending.indexOf(waiter), 1);
              clearTimeout(waiter.timer);
              waiter.resolve(event);
            }
        }
      });
      received.on('error', reject);
    });
  });
  return {
    next: (kind) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`No authorized ${kind} event received`)),
          5000
        );
        pending.push({ kind, timer, resolve, reject });
      }),
    close: () => {
      for (const waiter of pending) {
        clearTimeout(waiter.timer);
        waiter.reject(new Error('Fixture event stream closed'));
      }
      response.destroy();
      outgoing.destroy();
    },
  };
}

async function startFixtureHost() {
  child = spawn(
    process.execPath,
    [path.join(root, 'tools', 'local-host.js'), '--port', '0', '--data-dir', dataDirectory],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }
  );
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
  });
  const url = await new Promise((resolve, reject) => {
    let stdout = '';
    const timeout = setTimeout(() => reject(new Error(`Fixture host timed out: ${stderr}`)), 15000);
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Fixture host exited ${code}: ${stderr}`));
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      const ready = stdout.split('\n').find((line) => line.startsWith('TavernTable host ready '));
      if (ready) {
        clearTimeout(timeout);
        resolve(JSON.parse(ready.slice('TavernTable host ready '.length)).url);
      }
    });
  });
  const key = (await fs.readFile(path.join(dataDirectory, 'host-access-key'), 'utf8')).trim();
  const login = await request(
    url + '/api/session/host',
    { key },
    { 'Content-Type': 'application/json' }
  );
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const identity = await request(url + '/api/host', null, { Cookie: cookie });
  host = { url, ...participant(url, cookie, identity.body.token) };
}

async function stopFixtureHost() {
  if (child && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once('exit', resolve));
    child.kill('SIGTERM');
    await exited;
  }
}

beforeEach(async () => {
  dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'taverntable-player-authority-'));
  await startFixtureHost();
});

afterEach(async () => {
  await stopFixtureHost();
  await fs.rm(dataDirectory, { recursive: true, force: true });
});

async function table(
  ruleset = '2024',
  {
    geometry,
    conditions = [],
    gridSize = 5,
    npcPosition = { gridX: 4, gridY: 4 },
    characterUpdates = {},
    spells = [],
    activeTurn = true,
    placed = true,
    flightHeightFeet = null,
    heroPosition = { gridX: 1, gridY: 1 },
    sceneTransform,
  } = {}
) {
  const workspace = await CampaignWorkspace.load({
    storage: 'browser',
    fetch: fetchBundledResource,
    indexedDB: testIndexedDB(),
    crypto: webcrypto,
  });
  let records;
  let scene;
  let characterId;
  try {
    const campaign = await workspace.create({ name: 'Authority fixture', ruleset });
    const opened = await workspace.open(campaign.id);
    characterId = await opened.library.create('Owned hero');
    if (Object.keys(characterUpdates).length)
      await opened.library.edit(characterId, characterUpdates);
    if (conditions.length) await opened.library.edit(characterId, { conditions });
    for (const entryId of spells) {
      const spellId = await opened.library.add(characterId, entryId);
      await opened.library.prepare(characterId, spellId, true);
    }
    const privateId = await opened.library.create('Private NPC');
    await opened.library.edit(privateId, { notes: 'DM SECRET NOTES' });
    scene = sceneState({ ruleset, characterId, name: 'Owned hero' });
    scene.creatures[0].gridX = heroPosition.gridX;
    scene.creatures[0].gridY = heroPosition.gridY;
    scene.creatures[0].pose.world.x = heroPosition.gridX + 0.5;
    scene.creatures[0].pose.world.z = heroPosition.gridY + 0.5;
    scene.grid.cols = scene.grid.rows = gridSize;
    scene.terrain.heights = Array.from({ length: gridSize }, () => Array(gridSize).fill(0));
    if (flightHeightFeet !== null)
      scene.creatures[0].pose = {
        kind: 'flight',
        world: { x: 1.5, y: flightHeightFeet / 5, z: 1.5 },
      };
    if (geometry) {
      scene.version = 2;
      scene.terrain.geometry = geometry;
    }
    scene.creatures.push({
      ...scene.creatures[0],
      id: 'token-2',
      instanceNumber: 2,
      characterId: privateId,
      name: 'Private NPC',
      gridX: npcPosition.gridX,
      gridY: npcPosition.gridY,
      pose: {
        kind: 'ground',
        world: { x: npcPosition.gridX + 0.5, y: 0, z: npcPosition.gridY + 0.5 },
      },
    });
    scene.tokenCounters = { nextId: 2, types: [['mannequin', 2]] };
    const actor = {
      id: 'token-1',
      world: { ...scene.creatures[0].pose.world },
      movementSettings: { mode: 'walk', type: 'default' },
      flightActive: scene.creatures[0].pose.kind === 'flight',
    };
    linkTokenCharacter(actor, opened.library, characterId);
    const combat = new CombatSession({
      library: opened.library,
      hasToken: (token) => token === actor,
    });
    if (activeTurn) {
      await combat.startTurn(actor);
      scene.combat = combat.snapshot();
    }
    if (!placed)
      scene.creatures = scene.creatures.filter((entry) => entry.characterId !== characterId);
    if (sceneTransform) scene = sceneTransform(scene, opened.library);
    records = opened.library.engine.storage.snapshot();
  } finally {
    workspace.close();
  }
  const created = await host.request('create', [{ name: 'Authority fixture', ruleset }]);
  const campaignId = created.body.result.id;
  const seeded = await host.request('commitCharacters', [
    campaignId,
    { ruleset, revision: 0, records, scene: { revision: 0, value: JSON.stringify(scene) } },
  ]);
  expect(seeded.status).toBe(200);
  const invitation = await host.request('createInvite', [campaignId, { name: 'Mover' }]);
  const { invite, id: playerId } = invitation.body.result;
  expect(
    (await host.request('assignCharacter', [campaignId, playerId, characterId, true])).status
  ).toBe(200);
  const joined = await request(
    host.url + '/api/session/join',
    { invite },
    { 'Content-Type': 'application/json' }
  );
  expect(joined.status).toBe(200);
  const cookie = joined.headers['set-cookie'][0].split(';')[0];
  const session = await request(host.url + '/api/session', null, { Cookie: cookie });
  return {
    campaignId,
    characterId,
    playerId,
    invite,
    player: participant(host.url, cookie, session.body.csrf),
  };
}

test('an assigned active-turn player move is acknowledged with canonical cost and retrievable committed pose', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(before.status).toBe(200);
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
    },
  ]);
  expect(moved.status).toBe(200);
  expect(moved.body.result).toMatchObject({
    outcome: 'applied',
    receipt: {
      kind: 'move',
      tokenId: 'token-1',
      costFeet: 5,
      placement: {
        mapId: 'map-main',
        gridX: 2,
        gridY: 1,
        pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
      },
    },
  });
  const saved = await host.request('readScene', [campaignId]);
  const canonical = JSON.parse(saved.body.result.scene);
  expect(canonical.creatures.find((actor) => actor.id === 'token-1')).toMatchObject({
    gridX: 2,
    gridY: 1,
    pose: { world: { x: 2.5, y: 0, z: 1.5 } },
  });
  expect(canonical.combat.states.find((state) => state.tokenId === 'token-1').movementSpent).toBe(
    5
  );
  expect(moved.body.result.applied.sceneRevision).toBe(before.body.result.sceneRevision + 1);
}, 30000);

test.each(['2014', '2024'])(
  'multiplayer regression: DM switching to freeplay enables assigned movement with a fresh per-route budget (%s)',
  async (ruleset) => {
    const { campaignId, player } = await table(ruleset);
    const saved = await host.request('readCharacters', [campaignId]);
    const scene = JSON.parse(saved.body.result.scene);
    scene.combat = {
      ...scene.combat,
      active: false,
      activeTokenId: null,
      states: [],
    };
    const switched = await host.request('commitScene', [
      campaignId,
      {
        ruleset,
        revision: saved.body.result.sceneRevision,
        charactersRevision: saved.body.result.revision,
        scene: JSON.stringify(scene),
      },
    ]);
    expect(switched.status).toBe(200);
    for (const gridX of [2, 3]) {
      const before = await player.request('playerState', [
        { observerTokenId: 'token-1', presentationVersion: 1 },
      ]);
      expect(before.status).toBe(200);
      expect(before.body.result.gameplay.turn).toBeNull();
      expect(before.body.result.gameplay.ownedTokens[0]).toMatchObject({
        availability: { move: { allowed: true } },
        movement: { spentFeet: 0, remainingFeet: 30, allowanceFeet: 30 },
      });
      const moved = await player.request('playerCommand', [
        campaignId,
        {
          version: 1,
          commandId: randomUUID(),
          sceneRevision: before.body.result.sceneRevision,
          charactersRevision: before.body.result.revision,
          observerTokenId: 'token-1',
          tokenId: 'token-1',
          kind: 'move',
          payload: { target: { mapId: 'map-main', gridX, gridY: 1 } },
        },
      ]);
      expect(moved.status).toBe(200);
      expect(moved.body.result.receipt.costFeet).toBe(5);
      expect(moved.body.result.state.gameplay.ownedTokens[0].movement).toEqual({
        spentFeet: 0,
        remainingFeet: 30,
        allowanceFeet: 30,
      });
    }
  },
  30000
);

test('multiplayer regression: the DM receives the approved player route with the committed scene notice', async () => {
  const { campaignId, player } = await table();
  const events = await campaignEvents(host);
  try {
    const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    const noticed = events.next('playerCommand');
    const moved = await player.request('playerCommand', [
      campaignId,
      {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: before.body.result.sceneRevision,
        charactersRevision: before.body.result.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind: 'move',
        payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
      },
    ]);
    expect(moved.status).toBe(200);
    expect((await noticed).presentations).toContainEqual(
      expect.objectContaining({
        commandId: moved.body.result.commandId,
        tokenId: 'token-1',
        motion: moved.body.result.receipt.motion,
      })
    );
  } finally {
    events.close();
  }
}, 30000);

test('multiplayer regression: a DM route reaches a viewing player without private movement budgets or sheet data', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [
    { observerTokenId: 'token-1', presentationVersion: 1 },
  ]);
  const saved = await host.request('readCharacters', [campaignId]);
  const scene = JSON.parse(saved.body.result.scene);
  const actor = scene.creatures.find(({ id }) => id === 'token-2');
  const from = {
    mapId: 'map-main',
    gridX: actor.gridX,
    gridY: actor.gridY,
    facingAngle: actor.facingAngle,
    pose: JSON.parse(JSON.stringify(actor.pose)),
  };
  actor.gridX = 3;
  actor.pose.world.x = 3.5;
  const destination = {
    ...from,
    gridX: actor.gridX,
    pose: actor.pose,
  };
  const presentation = {
    commandId: randomUUID(),
    tokenId: actor.id,
    kind: 'move',
    motion: { kind: 'walk', completed: true, from, route: [destination] },
  };
  const committed = await host.request('commitScene', [
    campaignId,
    {
      ruleset: scene.ruleset,
      revision: saved.body.result.sceneRevision,
      charactersRevision: saved.body.result.revision,
      scene: JSON.stringify(scene),
      presentations: [presentation],
    },
  ]);
  expect(committed.status).toBe(200);
  const updated = await player.request('playerState', [
    {
      observerTokenId: 'token-1',
      presentationVersion: 1,
      sinceSceneRevision: before.body.result.sceneRevision,
    },
  ]);
  expect(updated.status).toBe(200);
  const motion = updated.body.result.publicScene.updates.find(
    ({ tokenId }) => tokenId === actor.id
  );
  expect(motion).toMatchObject(presentation);
  expect(motion).not.toHaveProperty('budget');
  expect(motion).not.toHaveProperty('costFeet');
  expect(updated.body.result.gameplay.ownedTokens.map(({ tokenId }) => tokenId)).toEqual([
    'token-1',
  ]);
  expect(JSON.stringify(updated.body.result)).not.toContain('DM SECRET NOTES');
  expect(validatePlayerState(updated.body.result)).toBe(updated.body.result);
  const refreshed = await player.request('playerState', [
    {
      observerTokenId: 'token-1',
      presentationVersion: 1,
      sinceSceneRevision: updated.body.result.sceneRevision,
    },
  ]);
  expect(refreshed.body.result.publicScene.updates).toEqual([]);
}, 30000);

test('multiplayer regression: another player receives visible player movement without receiving its private budget', async () => {
  const { campaignId, player } = await table();
  const saved = await host.request('readCharacters', [campaignId]);
  const scene = JSON.parse(saved.body.result.scene);
  const otherCharacterId = scene.creatures.find(({ id }) => id === 'token-2').characterId;
  const invitation = await host.request('createInvite', [campaignId, { name: 'Other observer' }]);
  await host.request('assignCharacter', [
    campaignId,
    invitation.body.result.id,
    otherCharacterId,
    true,
  ]);
  const joined = await request(
    host.url + '/api/session/join',
    { invite: invitation.body.result.invite },
    { 'Content-Type': 'application/json' }
  );
  const second = participant(
    host.url,
    joined.headers['set-cookie'][0].split(';')[0],
    joined.body.csrf
  );
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
    },
  ]);
  expect(moved.status).toBe(200);
  const updated = await second.request('playerState', [
    {
      observerTokenId: 'token-2',
      presentationVersion: 1,
      sinceSceneRevision: before.body.result.sceneRevision,
    },
  ]);
  expect(updated.status).toBe(200);
  const motion = updated.body.result.publicScene.updates.find(
    ({ tokenId }) => tokenId === 'token-1'
  );
  expect(motion?.motion).toEqual(moved.body.result.receipt.motion);
  expect(motion).not.toHaveProperty('budget');
  expect(motion).not.toHaveProperty('costFeet');
}, 30000);

test('multiplayer regression: a delayed client receives consecutive committed steps as one continuous route', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [
    { observerTokenId: 'token-1', presentationVersion: 1 },
  ]);
  let state = before.body.result;
  for (const gridX of [2, 3]) {
    const moved = await player.request('playerCommand', [
      campaignId,
      {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: state.sceneRevision,
        charactersRevision: state.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind: 'move',
        payload: { target: { mapId: 'map-main', gridX, gridY: 1 } },
      },
    ]);
    expect(moved.status).toBe(200);
    state = moved.body.result.state;
  }
  const updated = await player.request('playerState', [
    {
      observerTokenId: 'token-1',
      presentationVersion: 1,
      sinceSceneRevision: before.body.result.sceneRevision,
    },
  ]);
  expect(updated.status).toBe(200);
  expect(updated.body.result.publicScene.updates).toHaveLength(1);
  const motion = updated.body.result.publicScene.updates[0];
  expect(motion.motion.from.gridX).toBe(1);
  expect(motion.motion.route.map(({ gridX }) => gridX)).toEqual([2, 3]);
  expect(motion.costFeet).toBe(10);
  expect(motion.budget.movementRemainingFeet).toBe(20);
}, 30000);

test('multiplayer regression: invalid DM motion metadata is rejected before any canonical scene write', async () => {
  const { campaignId } = await table();
  const saved = await host.request('readCharacters', [campaignId]);
  const scene = JSON.parse(saved.body.result.scene);
  const actor = scene.creatures[0];
  const from = {
    mapId: 'map-main',
    gridX: actor.gridX,
    gridY: actor.gridY,
    facingAngle: actor.facingAngle,
    pose: JSON.parse(JSON.stringify(actor.pose)),
  };
  actor.gridX = 2;
  actor.pose.world.x = 2.5;
  const presentation = {
    commandId: randomUUID(),
    tokenId: actor.id,
    kind: 'move',
    motion: {
      kind: 'walk',
      completed: true,
      from,
      route: [{ ...from, gridX: 2, pose: actor.pose }],
    },
  };
  const before = await host.request('readScene', [campaignId]);
  for (const corrupt of [
    (entry) => {
      entry.motion.from.pose.world.x = 4.5;
    },
    (entry) => {
      entry.motion.route[0].pose.world.x = 3.5;
    },
    (entry) => {
      entry.motion.route[0].mapId = 'unknown-map';
    },
    (entry) => {
      entry.budget = { movementRemainingFeet: 10000 };
    },
  ]) {
    const invalid = JSON.parse(JSON.stringify(presentation));
    corrupt(invalid);
    const rejected = await host.request('commitScene', [
      campaignId,
      {
        ruleset: scene.ruleset,
        revision: saved.body.result.sceneRevision,
        charactersRevision: saved.body.result.revision,
        scene: JSON.stringify(scene),
        presentations: [invalid],
      },
    ]);
    expect([400, 422]).toContain(rejected.status);
    expect(rejected.body.code).toMatch(/^invalid-/);
    expect((await host.request('readScene', [campaignId])).body.result).toEqual(before.body.result);
  }
}, 30000);

test('multiplayer regression: a map resize can commit after movement without publishing obsolete out-of-bounds motion', async () => {
  const { campaignId, player } = await table('2024', {
    activeTurn: false,
    gridSize: 6,
    heroPosition: { gridX: 5, gridY: 1 },
    npcPosition: { gridX: 0, gridY: 4 },
  });
  const saved = await host.request('readCharacters', [campaignId]);
  const scene = JSON.parse(saved.body.result.scene);
  const actor = scene.creatures[0];
  const from = {
    mapId: 'map-main',
    gridX: actor.gridX,
    gridY: actor.gridY,
    facingAngle: actor.facingAngle,
    pose: JSON.parse(JSON.stringify(actor.pose)),
  };
  actor.gridX = 4;
  actor.pose.world.x = 4.5;
  scene.grid.cols = 5;
  scene.terrain.heights = scene.terrain.heights.map((row) => row.slice(0, 5));
  const committed = await host.request('commitScene', [
    campaignId,
    {
      ruleset: scene.ruleset,
      revision: saved.body.result.sceneRevision,
      charactersRevision: saved.body.result.revision,
      scene: JSON.stringify(scene),
      presentations: [
        {
          commandId: randomUUID(),
          tokenId: actor.id,
          kind: 'move',
          motion: {
            kind: 'walk',
            completed: true,
            from,
            route: [{ ...from, gridX: actor.gridX, pose: actor.pose }],
          },
        },
      ],
    },
  ]);
  expect(committed.status).toBe(200);
  const updated = await player.request('playerState', [
    {
      observerTokenId: 'token-1',
      presentationVersion: 1,
      sinceSceneRevision: saved.body.result.sceneRevision,
    },
  ]);
  expect({ status: updated.status, error: updated.body.error }).toEqual({
    status: 200,
    error: undefined,
  });
  expect(updated.body.result.publicScene.assets.maps[0].grid.cols).toBe(5);
  expect(updated.body.result.publicScene.actors[0].gridX).toBe(4);
  expect(updated.body.result.publicScene.updates).toEqual([]);
}, 30000);

test('multiplayer regression: a newly visible DM creature never reveals its hidden route origin', async () => {
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'sight-wall',
    bounds: { min: { x: 9.5, y: 0, z: 0 }, max: { x: 10.5, y: 10, z: 10 } },
  });
  const { campaignId, player } = await table('2024', {
    geometry: geometry.save(),
    npcPosition: { gridX: 3, gridY: 1 },
  });
  const before = await player.request('playerState', [
    { observerTokenId: 'token-1', presentationVersion: 1 },
  ]);
  expect(before.body.result.publicScene.actors.map(({ id }) => id)).toEqual(['token-1']);
  const saved = await host.request('readCharacters', [campaignId]);
  const scene = JSON.parse(saved.body.result.scene);
  const actor = scene.creatures.find(({ id }) => id === 'token-2');
  const from = {
    mapId: 'map-main',
    gridX: actor.gridX,
    gridY: actor.gridY,
    facingAngle: actor.facingAngle,
    pose: JSON.parse(JSON.stringify(actor.pose)),
  };
  actor.gridX = 1;
  actor.gridY = 2;
  actor.pose.world = { x: 1.5, y: 0, z: 2.5 };
  const committed = await host.request('commitScene', [
    campaignId,
    {
      ruleset: scene.ruleset,
      revision: saved.body.result.sceneRevision,
      charactersRevision: saved.body.result.revision,
      scene: JSON.stringify(scene),
      presentations: [
        {
          commandId: randomUUID(),
          tokenId: actor.id,
          kind: 'move',
          motion: {
            kind: 'walk',
            completed: true,
            from,
            route: [
              {
                ...from,
                gridY: 2,
                pose: { kind: 'ground', world: { x: 3.5, y: 0, z: 2.5 } },
              },
              { ...from, gridX: 1, gridY: 2, pose: actor.pose },
            ],
          },
        },
      ],
    },
  ]);
  expect(committed.status).toBe(200);
  const updated = await player.request('playerState', [
    {
      observerTokenId: 'token-1',
      presentationVersion: 1,
      sinceSceneRevision: before.body.result.sceneRevision,
    },
  ]);
  expect(updated.status).toBe(200);
  expect(updated.body.result.publicScene.actors.map(({ id }) => id)).toContain('token-2');
  expect(updated.body.result.publicScene.updates).toEqual([]);
}, 30000);

test('an unassigned actor move is rejected without changing canonical state or revealing its private identity', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const saved = await host.request('readScene', [campaignId]);
  const denied = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-2',
      tokenId: 'token-2',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 3, gridY: 4 } },
    },
  ]);
  expect(denied.status).toBe(403);
  expect(JSON.stringify(denied.body)).not.toContain('Private NPC');
  expect(JSON.stringify(denied.body)).not.toContain('DM SECRET');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(saved.body.result);
}, 30000);

test('retrying an acknowledged command returns its receipt without charging movement or creating another actor', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: before.body.result.sceneRevision,
    charactersRevision: before.body.result.revision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'move',
    payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
  };
  const first = await player.request('playerCommand', [campaignId, command]);
  expect(first.status).toBe(200);
  const after = await host.request('readScene', [campaignId]);
  const duplicate = await player.request('playerCommand', [campaignId, command]);
  expect(duplicate.status).toBe(200);
  expect(duplicate.body.result).toEqual({
    ...first.body.result,
    outcome: 'duplicate',
    state: {
      ...first.body.result.state,
      publicScene: { ...first.body.result.state.publicScene, updates: [] },
    },
  });
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(after.body.result);
  expect(JSON.parse(after.body.result.scene).creatures).toHaveLength(2);
  expect(
    JSON.parse(after.body.result.scene).combat.states.find((state) => state.tokenId === 'token-1')
      .movementSpent
  ).toBe(5);
}, 30000);

test('another authorized client sees the committed canonical placement and exact own movement budget without a private scene', async () => {
  const { campaignId, characterId, player } = await table();
  const invitation = await host.request('createInvite', [
    campaignId,
    { name: 'Second authorized client' },
  ]);
  expect(
    (
      await host.request('assignCharacter', [
        campaignId,
        invitation.body.result.id,
        characterId,
        true,
      ])
    ).status
  ).toBe(200);
  const joined = await request(
    host.url + '/api/session/join',
    { invite: invitation.body.result.invite },
    { 'Content-Type': 'application/json' }
  );
  const second = participant(
    host.url,
    joined.headers['set-cookie'][0].split(';')[0],
    joined.body.csrf
  );
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
    },
  ]);
  expect(moved.status).toBe(200);
  const updated = await second.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(updated.status).toBe(200);
  expect(updated.body.result.scene).toBeNull();
  expect(updated.body.result.sceneRevision).toBe(moved.body.result.applied.sceneRevision);
  expect(updated.body.result.view.tokens.find((token) => token.id === 'token-1').placement).toEqual(
    moved.body.result.receipt.placement
  );
  expect(updated.body.result.gameplay).toMatchObject({
    version: 1,
    commands: [
      'move',
      'turn.end',
      'stand',
      'roll',
      'action.use',
      'place',
      'remove',
      'flight.takeoff',
      'flight.drop',
      'traverse',
      'flight.raise',
      'flight.lower',
      'facing',
      'movement.settings',
      'emote',
      'action.undo',
    ],
    ownedTokens: [
      {
        tokenId: 'token-1',
        mapId: 'map-main',
        availability: { move: { allowed: true, code: 'allowed', reason: null } },
        movement: { spentFeet: 5, remainingFeet: 25, allowanceFeet: 30 },
      },
    ],
  });
  expect(JSON.stringify(updated.body.result.records)).not.toContain('DM SECRET NOTES');
}, 30000);

test('a physical wall between supported cells rejects movement without charging or revealing hidden blockers', async () => {
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'blocking-wall',
    bounds: { min: { x: 9.5, y: 0, z: 0 }, max: { x: 10.5, y: 10, z: 25 } },
  });
  const { campaignId, player } = await table('2024', { geometry: geometry.save() });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const saved = await host.request('readScene', [campaignId]);
  const denied = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
    },
  ]);
  expect(denied.status).toBe(422);
  expect(JSON.stringify(denied.body)).not.toContain('blocking-wall');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(saved.body.result);
}, 30000);

test('public presentation carries real native terrain assets and keeps its cache key across actor-only commands', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [
    { observerTokenId: 'token-1', presentationVersion: 1 },
  ]);
  expect(before.status).toBe(200);
  const presentation = before.body.result.view.presentation;
  expect(presentation).toMatchObject({
    version: 1,
    assets: {
      maps: [
        {
          id: 'map-main',
          base: 'ground',
          grid: { cols: 5, rows: 5, tileWorldSize: 1 },
          terrain: {
            heights: Array.from({ length: 5 }, () => Array(5).fill(0)),
            biome: null,
            seed: 42,
            placeables: [],
          },
        },
      ],
    },
  });
  expect(typeof presentation.assetKey).toBe('string');
  expect(before.body.result.scene).toBeNull();
  expect(before.body.result.view.terrain).toBeNull();
  expect(JSON.stringify(presentation)).not.toContain('Private NPC');
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
    },
  ]);
  expect(moved.status).toBe(200);
  const after = await player.request('playerState', [
    {
      observerTokenId: 'token-1',
      presentationVersion: 1,
      assetKey: presentation.assetKey,
    },
  ]);
  expect(after.body.result.view.presentation).toEqual({
    version: 1,
    assetKey: presentation.assetKey,
    assets: null,
  });
  expect(
    after.body.result.view.tokens.find((token) => token.id === 'token-1').placement.gridX
  ).toBe(2);
}, 30000);

test('reusing a command ID for a different destination returns a typed conflict without another mutation', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: before.body.result.sceneRevision,
    charactersRevision: before.body.result.revision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'move',
    payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
  };
  expect((await player.request('playerCommand', [campaignId, command])).status).toBe(200);
  const saved = await host.request('readScene', [campaignId]);
  const conflict = await player.request('playerCommand', [
    campaignId,
    { ...command, payload: { target: { mapId: 'map-main', gridX: 3, gridY: 1 } } },
  ]);
  expect(conflict.status).toBe(409);
  expect(conflict.body.code).toBe('command-id-conflict');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(saved.body.result);
}, 30000);

test('player gameplay rejects role, pose, cost and raw-scene claims rather than treating them as authority', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const saved = await host.request('readScene', [campaignId]);
  const denied = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      role: 'dm',
      scene: { creatures: [] },
      costFeet: 0,
      payload: {
        target: { mapId: 'map-main', gridX: 2, gridY: 1 },
        pose: { kind: 'flight', world: { x: 2.5, y: 100, z: 1.5 } },
      },
    },
  ]);
  expect(denied.status).toBe(400);
  expect(denied.body.code).toBe('invalid-command');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(saved.body.result);
}, 30000);

test('a player may end only their own active turn without resetting saved character resources', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const ended = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'turn.end',
      payload: {},
    },
  ]);
  expect(ended.status).toBe(200);
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(after.body.result.gameplay.ownedTokens[0].availability.move.allowed).toBe(false);
  const saved = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(saved.combat.activeTokenId).toBeNull();
  expect(saved.combat.active).toBe(true);
  const character = (state) =>
    JSON.parse(state.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value);
  expect(character(after.body.result)).toEqual(character(before.body.result));
}, 30000);

test('standing preserves action economy and spends half maximum movement while clearing persistent prone', async () => {
  const { campaignId, player } = await table('2024', { conditions: ['prone'] });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const stood = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'stand',
      payload: {},
    },
  ]);
  expect(stood.status).toBe(200);
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const owned = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(owned.conditions).not.toContain('prone');
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  const state = canonical.combat.states.find((entry) => entry.tokenId === 'token-1');
  expect(state).toMatchObject({
    movementSpent: 15,
    budget: { actions: 1, bonusActions: 1, reactions: 1 },
  });
  expect(after.body.result.gameplay.ownedTokens[0].movement.remainingFeet).toBe(15);
}, 30000);

test.each(['normal', 'advantage', 'disadvantage'])(
  'an owned d20 request in %s mode is resolved by host physical dice and records a real roll without changing action budget',
  async (mode) => {
    const { campaignId, player } = await table('2024', { gridSize: 25 });
    let before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    const savedBefore = JSON.parse(
      (await host.request('readScene', [campaignId])).body.result.scene
    );
    let rolled;
    for (let attempt = 0; attempt < 8; attempt++) {
      rolled = await player.request('playerCommand', [
        campaignId,
        {
          version: 1,
          commandId: randomUUID(),
          sceneRevision: before.body.result.sceneRevision,
          charactersRevision: before.body.result.revision,
          observerTokenId: 'token-1',
          tokenId: 'token-1',
          kind: 'roll',
          payload: { expression: '1d20', label: 'Physical check', mode },
        },
      ]);
      expect(rolled.body.error).toBeUndefined();
      expect(rolled.status).toBe(200);
      if (!rolled.body.result.receipt.roll.rerollRequired) break;
      expect(rolled.body.result.receipt.roll.cancelled).toBe(true);
      expect(rolled.body.result.receipt.roll.physics.at(-1)).toMatchObject({
        type: 'physical-d20',
        cocked: true,
        value: null,
      });
      before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    }
    expect(rolled.body.result.receipt).toMatchObject({
      kind: 'roll',
      tokenId: 'token-1',
      roll: { physical: true },
    });
    const die = rolled.body.result.receipt.roll.physics[0];
    expect(die.value).toBeGreaterThanOrEqual(1);
    expect(die.value).toBeLessThanOrEqual(20);
    expect(die.frames.length).toBeGreaterThan(20);
    const actual = rolled.body.result.receipt.roll;
    expect(actual.mapId).toBe('map-main');
    expect(validatePlayerCommandResult(rolled.body.result)).toBe(rolled.body.result);
    expect(actual.physics).toHaveLength(mode === 'normal' ? 1 : 2);
    for (const entry of actual.physics) expect(entry.cocked).toBe(false);
    expect(actual.values).toEqual(actual.physics.map((entry) => entry.value));
    expect(actual.total).toBe(
      mode === 'normal'
        ? die.value
        : mode === 'advantage'
          ? Math.max(...actual.values)
          : Math.min(...actual.values)
    );
    const after = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
    expect(after.combat.states[0].budget).toEqual(savedBefore.combat.states[0].budget);
    expect(after.combat.histories[0].entries.at(-1).label).toBe('Physical check');
  },
  30000
);

test('canonical Dash spends one action and increases owned movement without accepting a claimed budget', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const used = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'action.use',
      payload: { actionId: 'dash', choice: {} },
    },
  ]);
  expect(used.status).toBe(200);
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(after.body.result.gameplay.ownedTokens[0].movement).toMatchObject({
    allowanceFeet: 60,
    remainingFeet: 60,
    spentFeet: 0,
  });
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical.combat.states[0].budget).toMatchObject({
    actions: 0,
    dashes: 1,
    bonusActions: 1,
    reactions: 1,
  });
}, 30000);

test('a legal visible unarmed target uses host physical attack roll and canonical attack action cost', async () => {
  const { campaignId, player } = await table('2024', {
    gridSize: 25,
    npcPosition: { gridX: 2, gridY: 1 },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const used = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'action.use',
      payload: {
        actionId: 'attack:unarmed',
        choice: {},
        targeting: { targets: [{ tokenId: 'token-2', count: 1 }] },
      },
    },
  ]);
  expect(used.status).toBe(200);
  expect(used.body.result.receipt).toMatchObject({
    kind: 'action.use',
    tokenId: 'token-1',
    actionId: 'attack:unarmed',
    roll: { physical: true, physics: [{ type: 'physical-d20', cocked: false }] },
  });
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical.combat.states[0].budget).toMatchObject({
    actions: 0,
    attacksRemaining: 0,
    attackActionTaken: true,
  });
}, 30000);

test.each(['2014', '2024'])(
  '%s Fly reuses existing willing self-targeting, slot/action costs and concentration',
  async (ruleset) => {
    const { campaignId, player } = await table(ruleset, {
      characterUpdates: { classId: 'wizard', level: 5 },
      spells: ['spell:fly'],
    });
    const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    const own = JSON.parse(
      before.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.'))
        .value
    );
    const actionId = `spell:${own.spells[0].id}`;
    const cast = await player.request('playerCommand', [
      campaignId,
      {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: before.body.result.sceneRevision,
        charactersRevision: before.body.result.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind: 'action.use',
        payload: {
          actionId,
          choice: { slotLevel: 3 },
          targeting: { targets: [{ tokenId: 'token-1', count: 1 }], willingConfirmed: true },
        },
      },
    ]);
    expect(cast.body.error).toBeUndefined();
    expect(cast.status).toBe(200);
    const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    const saved = JSON.parse(
      after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
    );
    expect(saved.slotsUsed[2]).toBe(1);
    expect(saved.concentration).toBe(own.spells[0].id);
    const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
    expect(canonical.combat.states[0].budget.actions).toBe(0);
    expect(
      canonical.combat.effects.some(
        (effect) => effect.kind === 'flight' && effect.targetTokenIds.includes('token-1')
      )
    ).toBe(true);
  },
  30000
);

test('an actorless assigned character is placed only at an explicit DM grant using an explicit canonical model', async () => {
  const { campaignId, characterId, playerId, player } = await table('2024', {
    activeTurn: false,
    placed: false,
  });
  const before = await player.request('playerState', [{}]);
  const ownBefore = JSON.parse(
    before.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(before.body.result.view).toBeNull();
  const grant = await host.request('grantPlacement', [
    campaignId,
    playerId,
    characterId,
    { mapId: 'map-main', gridX: 1, gridY: 1 },
  ]);
  expect(grant.status).toBe(200);
  const placed = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: null,
      tokenId: null,
      kind: 'place',
      payload: { characterId, appearance: 'knight', grantId: grant.body.result.id },
    },
  ]);
  expect(placed.status).toBe(200);
  expect(placed.body.result.receipt).toMatchObject({
    kind: 'place',
    tokenId: 'token-3',
    characterId,
    placement: { mapId: 'map-main', gridX: 1, gridY: 1 },
  });
  const after = await player.request('playerState', [{ observerTokenId: 'token-3' }]);
  expect(after.body.result.observerTokenId).toBe('token-3');
  expect(after.body.result.view.tokens.find((token) => token.id === 'token-3').type).toBe('knight');
  expect(
    JSON.parse(
      after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
    )
  ).toEqual(ownBefore);
}, 30000);

test('owned removal outside combat retains the saved character and duplicate removal cannot mutate another actor', async () => {
  const { campaignId, player } = await table('2024', { activeTurn: false, conditions: ['prone'] });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: before.body.result.sceneRevision,
    charactersRevision: before.body.result.revision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'remove',
    payload: {},
  };
  const removed = await player.request('playerCommand', [campaignId, command]);
  expect(removed.status).toBe(200);
  const after = await player.request('playerState', [{}]);
  expect(after.body.result.records).toEqual(before.body.result.records);
  expect(after.body.result.observerTokenId).toBeNull();
  expect(
    JSON.parse((await host.request('readScene', [campaignId])).body.result.scene).creatures.map(
      (actor) => actor.id
    )
  ).toEqual(['token-2']);
  const repeated = await player.request('playerCommand', [campaignId, command]);
  expect(repeated.status).toBe(200);
  expect(repeated.body.result.outcome).toBe('duplicate');
}, 30000);

test('granted Fly takeoff uses canonical flying allowance and preserves concentration and action budget', async () => {
  const { campaignId, player } = await table('2024', {
    characterUpdates: { classId: 'wizard', level: 5 },
    spells: ['spell:fly'],
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const own = JSON.parse(
    before.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  const cast = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'action.use',
      payload: {
        actionId: `spell:${own.spells[0].id}`,
        choice: { slotLevel: 3 },
        targeting: { targets: [{ tokenId: 'token-1', count: 1 }], willingConfirmed: true },
      },
    },
  ]);
  expect(cast.status).toBe(200);
  const state = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const tookOff = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: state.body.result.sceneRevision,
      charactersRevision: state.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'flight.takeoff',
      payload: {},
    },
  ]);
  expect(tookOff.status).toBe(200);
  expect(tookOff.body.result.receipt.placement.pose).toMatchObject({
    kind: 'flight',
    world: { x: 1.5, y: 1, z: 1.5 },
  });
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical.combat.states[0]).toMatchObject({
    movementSpent: 5,
    budget: { actions: 0, bonusActions: 1, reactions: 1 },
  });
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(after.body.result.gameplay.ownedTokens[0].movement.remainingFeet).toBe(55);
  const saved = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(saved.concentration).toBe(own.spells[0].id);
}, 30000);

test('voluntary flight drop computes authoritative fall damage/prone from physical distance without a movement/action charge', async () => {
  const { campaignId, player } = await table('2024', {
    flightHeightFeet: 20,
    characterUpdates: { fallTraits: { flySpeed: 60, hover: true } },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const dropped = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'flight.drop',
      payload: { useSlowFall: false },
    },
  ]);
  expect(dropped.status).toBe(200);
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const own = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(own.conditions).toContain('prone');
  expect(own.lastFall).toMatchObject({ distanceFeet: 20, dice: 2, prone: true });
  expect(own.lastFall.damage).toBeGreaterThanOrEqual(2);
  expect(own.lastFall.damage).toBeLessThanOrEqual(12);
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical.creatures.find((actor) => actor.id === 'token-1').pose).toMatchObject({
    kind: 'ground',
    world: { y: 0 },
  });
  expect(canonical.combat.states[0]).toMatchObject({
    movementSpent: 0,
    budget: { actions: 1, bonusActions: 1, reactions: 1 },
  });
}, 30000);

test('an owned doorway traversal keeps canonical IDs and charges existing physical connection movement', async () => {
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'door-wall',
    bounds: { min: { x: 24, y: 0, z: 0 }, max: { x: 25, y: 10, z: 25 } },
  });
  geometry.carve({
    id: 'door-cut',
    bounds: { min: { x: 24, y: 0, z: 10 }, max: { x: 25, y: 6, z: 15 } },
  });
  const { campaignId, player } = await table('2024', {
    geometry: geometry.save(),
    heroPosition: { gridX: 4, gridY: 2 },
    sceneTransform: (scene, library) => {
      const world = CampaignWorld.fromScene(scene, { ruleset: '2024', library });
      world.addMap({
        id: 'inside',
        name: 'Inside',
        originFeet: { x: 25, y: 0, z: 0 },
        quarterTurns: 0,
        base: 'ground',
        grid: scene.grid,
        terrain: { ...scene.terrain, geometry: { version: 1, volumes: [] } },
      });
      world.addConnection({
        id: 'doorway',
        name: 'Doorway',
        kind: 'door',
        ends: [
          { mapId: 'map-main', positionFeet: { x: 22.5, y: 0, z: 12.5 } },
          { mapId: 'inside', positionFeet: { x: 2.5, y: 0, z: 12.5 } },
        ],
        feature: { mapId: 'map-main', volumeIds: ['door-cut'] },
        pathFeet: [],
      });
      return world.save();
    },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'traverse',
      payload: { connectionId: 'doorway' },
    },
  ]);
  expect(moved.status).toBe(200);
  expect(moved.body.result.receipt).toMatchObject({
    kind: 'traverse',
    tokenId: 'token-1',
    costFeet: 5,
    placement: { mapId: 'inside', gridX: 0, gridY: 2 },
  });
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(after.body.result.observerTokenId).toBe('token-1');
  expect(after.body.result.view.id).toBe('inside');
  expect(after.body.result.gameplay.ownedTokens[0].movement.spentFeet).toBe(5);
}, 30000);

test('owned walking cannot pass through a foreign same-location wall and an explicit refusal leaves the turn unchanged', async () => {
  const foreign = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  foreign.addSolid({
    id: 'foreign-wall',
    bounds: { min: { x: 10, y: 0, z: 0 }, max: { x: 15, y: 10, z: 25 } },
  });
  const { campaignId, player } = await table('2024', {
    sceneTransform: (scene, library) => {
      const world = CampaignWorld.fromScene(scene, { ruleset: '2024', library });
      world.addMap({
        id: 'overlap',
        name: 'Other physical map',
        originFeet: { x: 0, y: 0, z: 0 },
        quarterTurns: 0,
        base: 'ground',
        grid: scene.grid,
        terrain: { ...scene.terrain, geometry: foreign.save() },
      });
      return world.save();
    },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const canonical = (await host.request('readScene', [campaignId])).body.result;
  const denied = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
    },
  ]);
  expect(denied.status).toBe(422);
  expect(denied.body.code).toBe('unreachable');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(canonical);
}, 30000);

test('an explicit flight drop preserves Feather Fall: no damage roll, damage, prone or economy cost', async () => {
  const { campaignId, player } = await table('2014', {
    flightHeightFeet: 20,
    characterUpdates: { fallTraits: { flySpeed: 60, hover: true, featherFall: true } },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const canonicalBefore = JSON.parse(
    (await host.request('readScene', [campaignId])).body.result.scene
  );
  const dropped = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'flight.drop',
      payload: { useSlowFall: false },
    },
  ]);
  expect(dropped.status).toBe(200);
  expect(dropped.body.result.receipt.result).toMatchObject({
    distanceFeet: 20,
    rawDamage: 0,
    damage: 0,
    prone: false,
  });
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const own = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(own.lastFall).toMatchObject({ damage: 0, rawDamage: 0 });
  expect(own.conditions).not.toContain('prone');
  const canonicalAfter = JSON.parse(
    (await host.request('readScene', [campaignId])).body.result.scene
  );
  expect(canonicalAfter.combat.states[0]).toMatchObject({
    movementSpent: canonicalBefore.combat.states[0].movementSpent,
    budget: canonicalBefore.combat.states[0].budget,
  });
}, 30000);

test('running off a physical ledge stops at the first landing with fall damage and persistent prone, paying only the approach', async () => {
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'ledge',
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 25 } },
  });
  const { campaignId, player } = await table('2024', {
    geometry: geometry.save(),
    characterUpdates: { hp: { max: 60, current: 60, temp: 0 } },
    sceneTransform: (scene) => {
      scene.creatures.find((entry) => entry.id === 'token-1').pose.world.y = 4;
      return scene;
    },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 3, gridY: 1 } },
    },
  ]);
  expect(moved.status).toBe(200);
  expect(moved.body.result.receipt).toMatchObject({
    kind: 'move',
    costFeet: 5,
    placement: { gridX: 2, gridY: 1, pose: { kind: 'ground', world: { y: 0 } } },
    fall: { distanceFeet: 20, dice: 2, prone: true },
  });
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const own = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(own.conditions).toContain('prone');
  expect(own.lastFall).toMatchObject({ distanceFeet: 20, dice: 2, prone: true });
  expect(after.body.result.gameplay.ownedTokens[0].movement).toMatchObject({
    spentFeet: 5,
    remainingFeet: 25,
  });
}, 30000);

test('an eligible ledge fall requires an explicit Slow Fall choice and pays only its canonical reaction', async () => {
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'ledge',
    bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 25 } },
  });
  const { campaignId, player } = await table('2014', {
    geometry: geometry.save(),
    characterUpdates: { classId: 'monk', level: 4 },
    sceneTransform: (scene) => {
      scene.creatures.find((entry) => entry.id === 'token-1').pose.world.y = 4;
      return scene;
    },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: before.body.result.sceneRevision,
    charactersRevision: before.body.result.revision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'move',
    payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
  };
  const saved = (await host.request('readScene', [campaignId])).body.result;
  const pending = await player.request('playerCommand', [campaignId, command]);
  expect(pending.status).toBe(422);
  expect(pending.body.code).toBe('confirmation-required');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(saved);
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      ...command,
      payload: { ...command.payload, useSlowFall: true },
    },
  ]);
  expect(moved.status).toBe(200);
  expect(moved.body.result.receipt.fall).toMatchObject({ damage: 0, prone: false, reduction: 20 });
  const after = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(after.combat.states[0]).toMatchObject({
    movementSpent: 5,
    budget: { actions: 1, bonusActions: 1, reactions: 0 },
  });
}, 30000);

test('owned flight elevation pays the existing flying allowance and refuses a blocked ceiling without mutation', async () => {
  const geometry = new TerrainGeometry({
    widthFeet: 25,
    depthFeet: 25,
    getTerrainHeightFeet: () => 0,
  });
  geometry.addSolid({
    id: 'ceiling',
    bounds: { min: { x: 0, y: 20, z: 0 }, max: { x: 25, y: 22, z: 25 } },
  });
  const { campaignId, player } = await table('2024', {
    geometry: geometry.save(),
    flightHeightFeet: 5,
    characterUpdates: { fallTraits: { flySpeed: 60, hover: true } },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: before.body.result.sceneRevision,
    charactersRevision: before.body.result.revision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'flight.raise',
    payload: { feet: 10 },
  };
  const raised = await player.request('playerCommand', [campaignId, command]);
  expect(raised.status).toBe(200);
  expect(raised.body.result.receipt).toMatchObject({
    kind: 'flight.raise',
    costFeet: 10,
    placement: { pose: { kind: 'flight', world: { y: 3 } } },
  });
  const state = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(state.body.result.gameplay.ownedTokens[0].movement).toMatchObject({
    spentFeet: 10,
    remainingFeet: 50,
  });
  const saved = (await host.request('readScene', [campaignId])).body.result;
  const blocked = await player.request('playerCommand', [
    campaignId,
    {
      ...command,
      commandId: randomUUID(),
      sceneRevision: state.body.result.sceneRevision,
      charactersRevision: state.body.result.revision,
      payload: { feet: 5 },
    },
  ]);
  expect(blocked.status).toBe(422);
  expect(blocked.body.code).toBe('flight-blocked');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(saved);
}, 30000);

test('controlled flight descent lands on supported ground without fall damage or prone and pays flying distance', async () => {
  const { campaignId, player } = await table('2024', {
    flightHeightFeet: 10,
    characterUpdates: { fallTraits: { flySpeed: 60, hover: true } },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const lowered = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'flight.lower',
      payload: { feet: 10 },
    },
  ]);
  expect(lowered.status).toBe(200);
  expect(lowered.body.result.receipt).toMatchObject({
    kind: 'flight.lower',
    costFeet: 10,
    placement: { pose: { kind: 'ground', world: { y: 0 } } },
  });
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const own = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(own.lastFall).toBeUndefined();
  expect(own.conditions).not.toContain('prone');
  const scene = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(scene.combat.states[0]).toMatchObject({
    movementSpent: 10,
    budget: { actions: 1, bonusActions: 1, reactions: 1 },
  });
}, 30000);

test('owned airborne movement uses the shared physical route and exact flying budget, never a ground teleport', async () => {
  const { campaignId, player } = await table('2024', {
    flightHeightFeet: 10,
    characterUpdates: { fallTraits: { flySpeed: 60, hover: true } },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(before.body.result.gameplay.ownedTokens[0].availability.move.allowed).toBe(true);
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 3, gridY: 1 } },
    },
  ]);
  expect(moved.status).toBe(200);
  expect(moved.body.result.receipt).toMatchObject({
    kind: 'move',
    costFeet: 10,
    placement: { gridX: 3, gridY: 1, pose: { kind: 'flight', world: { x: 3.5, y: 2, z: 1.5 } } },
  });
  expect(moved.body.result.receipt.motion.from.pose.world).toEqual({ x: 1.5, y: 2, z: 1.5 });
  expect(moved.body.result.receipt.route.map((step) => step.pose.world)).toEqual([
    { x: 2.5, y: 2, z: 1.5 },
    { x: 3.5, y: 2, z: 1.5 },
  ]);
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(after.body.result.gameplay.ownedTokens[0].movement).toMatchObject({
    spentFeet: 10,
    remainingFeet: 50,
  });
}, 30000);

test('a real receipt persistence failure rolls back scene, character conditions and movement, then the same intent retries exactly once', async () => {
  const { campaignId, player } = await table('2024', { conditions: ['prone'] });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const saved = (await host.request('readCharacters', [campaignId])).body.result;
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: before.body.result.sceneRevision,
    charactersRevision: before.body.result.revision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'stand',
    payload: {},
  };
  const database = new DatabaseSync(path.join(dataDirectory, 'campaigns.sqlite'));
  try {
    database.exec(
      "CREATE TRIGGER authority_fixture_receipt_failure BEFORE INSERT ON player_commands BEGIN SELECT RAISE(ABORT, 'Fixture receipt persistence failed'); END"
    );
    const failed = await player.request('playerCommand', [campaignId, command]);
    expect(failed.status).toBe(500);
    expect(failed.body.error).toBe(
      'The host could not save/read campaign data. Check its terminal and retry.'
    );
    expect((await host.request('readCharacters', [campaignId])).body.result).toEqual(saved);
    expect(database.prepare('SELECT count(*) AS count FROM player_commands').get().count).toBe(0);
    database.exec('DROP TRIGGER authority_fixture_receipt_failure');
    const applied = await player.request('playerCommand', [campaignId, command]);
    expect(applied.status).toBe(200);
    const replay = await player.request('playerCommand', [campaignId, command]);
    expect(replay.body.result.outcome).toBe('duplicate');
    const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
    expect(canonical.combat.states[0].movementSpent).toBe(15);
    expect(database.prepare('SELECT count(*) AS count FROM player_commands').get().count).toBe(1);
  } finally {
    database.close();
  }
}, 30000);

test('a lost movement acknowledgement survives fixture host restart and new player sessions without charging twice', async () => {
  const { campaignId, player, invite } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: before.body.result.sceneRevision,
    charactersRevision: before.body.result.revision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'move',
    payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
  };
  expect((await player.request('playerCommand', [campaignId, command])).status).toBe(200);
  const saved = (await host.request('readScene', [campaignId])).body.result;
  await stopFixtureHost();
  await startFixtureHost();
  const joined = await request(
    host.url + '/api/session/join',
    { invite },
    { 'Content-Type': 'application/json' }
  );
  expect(joined.status).toBe(200);
  const cookie = joined.headers['set-cookie'][0].split(';')[0];
  const returning = participant(host.url, cookie, joined.body.csrf);
  const retry = await returning.request('playerCommand', [campaignId, command]);
  expect(retry.status).toBe(200);
  expect(retry.body.result.outcome).toBe('duplicate');
  expect((await host.request('readScene', [campaignId])).body.result).toEqual(saved);
  const current = await returning.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(current.body.result.gameplay.ownedTokens[0].movement.spentFeet).toBe(5);
  expect(
    current.body.result.view.tokens.find((entry) => entry.id === 'token-1').placement
  ).toMatchObject({ gridX: 2, gridY: 1 });
}, 30000);

test('a committed player move notifies another authorized client and the DM with exact revisions, never a private actor snapshot', async () => {
  const { campaignId, player, invite } = await table();
  const joined = await request(
    host.url + '/api/session/join',
    { invite },
    { 'Content-Type': 'application/json' }
  );
  const second = participant(
    host.url,
    joined.headers['set-cookie'][0].split(';')[0],
    joined.body.csrf
  );
  const streams = await Promise.all([campaignEvents(second), campaignEvents(host)]);
  try {
    const notifications = streams.map((stream) => stream.next('playerCommand'));
    const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    const moved = await player.request('playerCommand', [
      campaignId,
      {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: before.body.result.sceneRevision,
        charactersRevision: before.body.result.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind: 'move',
        payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
      },
    ]);
    expect(moved.status).toBe(200);
    for (const notification of await Promise.all(notifications)) {
      expect(notification).toMatchObject({
        version: 1,
        campaignId,
        kind: 'playerCommand',
        sceneRevision: moved.body.result.applied.sceneRevision,
        charactersRevision: moved.body.result.applied.charactersRevision,
      });
      expect(JSON.stringify(notification)).not.toMatch(/DM SECRET|Private NPC|token-2|"scene"/);
    }
    const refreshed = await second.request('playerState', [{ observerTokenId: 'token-1' }]);
    expect(
      refreshed.body.result.view.tokens.find((entry) => entry.id === 'token-1').placement
    ).toMatchObject({ gridX: 2, gridY: 1 });
  } finally {
    streams.forEach((stream) => stream.close());
  }
}, 30000);

test('a DM placement grant notifies the assigned unplaced player without exposing another character', async () => {
  const { campaignId, characterId, playerId, player } = await table('2024', {
    activeTurn: false,
    placed: false,
  });
  const stream = await campaignEvents(player);
  try {
    const notification = stream.next('grantPlacement');
    const granted = await host.request('grantPlacement', [
      campaignId,
      playerId,
      characterId,
      {
        mapId: 'map-main',
        gridX: 2,
        gridY: 1,
      },
    ]);
    expect(granted.status).toBe(200);
    const event = await notification;
    expect(event).toMatchObject({ campaignId, kind: 'grantPlacement' });
    expect(JSON.stringify(event)).not.toMatch(/Private NPC|token-2|DM SECRET/);
    const state = await player.request('playerState', [{}]);
    expect(state.body.result.placementGrants).toEqual([
      expect.objectContaining({
        id: granted.body.result.id,
        characterId,
        mapId: 'map-main',
        gridX: 2,
        gridY: 1,
      }),
    ]);
  } finally {
    stream.close();
  }
}, 30000);

test('an explicit unplaced-character grant exposes render-only destination geometry but never grants fabricated sight or private actors', async () => {
  const { campaignId, characterId, playerId, player } = await table('2024', {
    activeTurn: false,
    placed: false,
  });
  const granted = await host.request('grantPlacement', [
    campaignId,
    playerId,
    characterId,
    {
      mapId: 'map-main',
      gridX: 2,
      gridY: 1,
    },
  ]);
  const state = await player.request('playerState', [
    {
      placementGrantId: granted.body.result.id,
      presentationVersion: 1,
    },
  ]);
  expect(state.status).toBe(200);
  expect(state.body.result).toMatchObject({
    scene: null,
    observerTokenId: null,
    observers: [],
    gameplay: { ownedTokens: [] },
    view: {
      id: 'map-main',
      mode: 'placement-preview',
      tokens: [],
      presentation: {
        version: 1,
        assets: {
          maps: [
            expect.objectContaining({
              id: 'map-main',
              terrain: expect.objectContaining({ heights: expect.any(Array), biome: null }),
            }),
          ],
        },
      },
    },
  });
  expect(JSON.stringify(state.body.result)).not.toMatch(/Private NPC|token-2|DM SECRET/);
  const denied = await player.request('playerState', [
    { placementGrantId: randomUUID(), presentationVersion: 1 },
  ]);
  expect(denied.status).toBe(403);
  expect(denied.body.result).toBeUndefined();
}, 30000);

test('a prone owned attacker uses canonical disadvantage with two physical dice while preserving prone and exact action cost', async () => {
  const { campaignId, player } = await table('2024', {
    conditions: ['prone'],
    gridSize: 25,
    npcPosition: { gridX: 2, gridY: 1 },
  });
  let used;
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    used = await player.request('playerCommand', [
      campaignId,
      {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: state.body.result.sceneRevision,
        charactersRevision: state.body.result.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind: 'action.use',
        payload: {
          actionId: 'attack:unarmed',
          targeting: { targets: [{ tokenId: 'token-2', count: 1 }] },
        },
      },
    ]);
    expect(used.status).toBe(200);
    if (!used.body.result.receipt.rerollRequired) break;
  }
  expect(used.body.result.receipt.roll.mode).toBe('disadvantage');
  expect(used.body.result.receipt.roll.physics).toHaveLength(2);
  expect(used.body.result.receipt.roll.values).toEqual(
    used.body.result.receipt.roll.physics.map((entry) => entry.value)
  );
  expect(used.body.result.receipt.roll.summary.breakdown).toContain(
    `keep ${Math.min(...used.body.result.receipt.roll.values)}`
  );
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const own = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(own.conditions).toContain('prone');
  const scene = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(scene.combat.states[0].budget).toMatchObject({
    actions: 0,
    attacksRemaining: 0,
    attackActionTaken: true,
  });
}, 30000);

test('Scorching Ray resolves every allocated physical attack before one canonical action and slot debit', async () => {
  const { campaignId, player } = await table('2024', {
    gridSize: 25,
    npcPosition: { gridX: 3, gridY: 1 },
    characterUpdates: { classId: 'wizard', level: 3 },
    spells: ['spell:scorching-ray'],
  });
  const first = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const own = JSON.parse(
    first.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  let used;
  for (let attempt = 0; attempt < 8; attempt++) {
    const state = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    used = await player.request('playerCommand', [
      campaignId,
      {
        version: 1,
        commandId: randomUUID(),
        sceneRevision: state.body.result.sceneRevision,
        charactersRevision: state.body.result.revision,
        observerTokenId: 'token-1',
        tokenId: 'token-1',
        kind: 'action.use',
        payload: {
          actionId: `spell:${own.spells[0].id}`,
          choice: { slotLevel: 2 },
          targeting: { targets: [{ tokenId: 'token-2', count: 3 }] },
        },
      },
    ]);
    expect(used.status).toBe(200);
    if (!used.body.result.receipt.rerollRequired) break;
  }
  const rolls = used.body.result.receipt.rolls;
  expect(rolls).toHaveLength(3);
  for (const roll of rolls) {
    expect(roll.physical).toBe(true);
    expect(roll.values).toEqual(roll.physics.map((entry) => entry.value));
  }
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical.combat.states[0].budget.actions).toBe(0);
  const history = canonical.combat.histories[0].entries.find((entry) => entry.type === 'use');
  expect(history.targetRolls).toHaveLength(3);
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const updated = JSON.parse(
    after.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.')).value
  );
  expect(updated.slotsUsed[1]).toBe(own.slotsUsed[1] + 1);
}, 30000);

test('public gameplay projects owned canonical action availability and economy without private actor resources', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const actor = before.body.result.gameplay.ownedTokens[0];
  expect(before.body.result.gameplay.ownedTokens).toHaveLength(1);
  expect(actor.economy).toMatchObject({ actions: 1, bonusActions: 1, reactions: 1 });
  expect(actor.availableActions).toEqual(
    expect.arrayContaining([expect.objectContaining({ id: 'dash', cost: 'action' })])
  );
  const used = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'action.use',
      payload: { actionId: 'dash' },
    },
  ]);
  expect(used.status).toBe(200);
  const state = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(state.body.result.gameplay.ownedTokens[0].economy.actions).toBe(0);
  expect(
    state.body.result.gameplay.ownedTokens[0].availableActions.some((entry) => entry.id === 'dash')
  ).toBe(false);
  expect(JSON.stringify(state.body.result.gameplay)).not.toMatch(/token-2|Private NPC|DM SECRET/);
}, 30000);

test('an owned facing intent changes only canonical facing and spends no movement or action economy', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const sceneBefore = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  const turned = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'facing',
      payload: { angle: Math.PI / 2 },
    },
  ]);
  expect(turned.status).toBe(200);
  expect(turned.body.result.receipt).toMatchObject({
    kind: 'facing',
    tokenId: 'token-1',
    facingAngle: Math.PI / 2,
  });
  const sceneAfter = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(sceneAfter.creatures[0]).toEqual({
    ...sceneBefore.creatures[0],
    facingAngle: Math.PI / 2,
  });
  expect(sceneAfter.combat).toEqual(sceneBefore.combat);
}, 30000);

test('owned pace and locomotion style reuse existing settings without changing saved Speed or movement costs', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const saved = (await host.request('readCharacters', [campaignId])).body.result;
  const updated = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'movement.settings',
      payload: { mode: 'run', type: 'drunk' },
    },
  ]);
  expect(updated.status).toBe(200);
  expect(updated.body.result.receipt).toMatchObject({
    kind: 'movement.settings',
    tokenId: 'token-1',
    movement: { mode: 'run', type: 'drunk' },
  });
  const after = (await host.request('readCharacters', [campaignId])).body.result;
  expect(after.records).toEqual(saved.records);
  const oldScene = JSON.parse(saved.scene);
  const newScene = JSON.parse(after.scene);
  expect(newScene.creatures[0].movement).toEqual({ mode: 'run', type: 'drunk' });
  expect(newScene.combat).toEqual(oldScene.combat);
}, 30000);

test.each(['friendly', 'neutral'])(
  'a %s foreign creature is assumed willing without granting actor ownership',
  async (allegiance) => {
    const { campaignId, player } = await table('2014', {
      characterUpdates: { classId: 'wizard', level: 5 },
      spells: ['spell:fly'],
      npcPosition: { gridX: 2, gridY: 1 },
      sceneTransform: (scene) => {
        scene.creatures.find((entry) => entry.id === 'token-2').allegiance = allegiance;
        return scene;
      },
    });
    const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
    const own = JSON.parse(
      before.body.result.records.find((row) => row.key.startsWith('taverntable.character.v1.'))
        .value
    );
    const command = {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'action.use',
      payload: {
        actionId: `spell:${own.spells[0].id}`,
        choice: { slotLevel: 3 },
        targeting: { targets: [{ tokenId: 'token-2', count: 1 }] },
      },
    };
    const cast = await player.request('playerCommand', [campaignId, command]);
    expect(cast.status).toBe(200);
    const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
    expect(
      canonical.combat.effects.some(
        (entry) => entry.kind === 'flight' && entry.targetTokenIds.includes('token-2')
      )
    ).toBe(true);
    expect((await player.request('playerState', [{ observerTokenId: 'token-2' }])).status).toBe(
      403
    );
  },
  30000
);

test('a physical drop lands on the highest foreign floor in the same location, retaining that map ID and real fall distance', async () => {
  const { campaignId, player } = await table('2024', {
    flightHeightFeet: 20,
    characterUpdates: { hp: { max: 60, current: 60 }, fallTraits: { flySpeed: 60, hover: true } },
    sceneTransform: (scene, library) => {
      const world = CampaignWorld.fromScene(scene, { library, ruleset: '2024' });
      world.addMap({
        id: 'intercept-floor',
        name: 'Supported upper floor',
        originFeet: { x: 0, y: 10, z: 0 },
        quarterTurns: 0,
        base: 'floor',
        grid: scene.grid,
        terrain: { ...scene.terrain, geometry: { version: 1, volumes: [] } },
      });
      return world.save();
    },
  });
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const dropped = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'flight.drop',
      payload: { useSlowFall: false },
    },
  ]);
  expect(dropped.status).toBe(200);
  expect(dropped.body.result.receipt).toMatchObject({
    distanceFeet: 10,
    placement: {
      mapId: 'intercept-floor',
      gridX: 1,
      gridY: 1,
      pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
    },
  });
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(after.body.result.view.id).toBe('intercept-floor');
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical.view.mapId).toBe('map-main');
  expect(canonical.creatures[0].mapId).toBe('intercept-floor');
}, 30000);

test('an authorized cosmetic emote exposes only a visible animation command and never spends actions or moves the actor', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const saved = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  const commandId = randomUUID();
  const emote = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId,
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'emote',
      payload: { actionId: 'emote-rumba' },
    },
  ]);
  expect(emote.status).toBe(200);
  expect(emote.body.result.receipt).toMatchObject({
    kind: 'emote',
    tokenId: 'token-1',
    actionId: 'emote-rumba',
    animationKey: 'jump',
  });
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical).toEqual(saved);
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(
    after.body.result.view.tokens.find((entry) => entry.id === 'token-1').visualCommand
  ).toMatchObject({
    commandId,
    sceneRevision: emote.body.result.applied.sceneRevision,
    actionId: 'emote-rumba',
    animationKey: 'jump',
  });
  expect(
    after.body.result.view.tokens.find((entry) => entry.id === 'token-2').visualCommand
  ).toBeNull();
}, 30000);

test('owned Undo reuses the canonical last-use receipt and retries cannot refund an action twice', async () => {
  const { campaignId, player } = await table();
  const before = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  const dash = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: before.body.result.sceneRevision,
      charactersRevision: before.body.result.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'action.use',
      payload: { actionId: 'dash' },
    },
  ]);
  expect(dash.status).toBe(200);
  const command = {
    version: 1,
    commandId: randomUUID(),
    sceneRevision: dash.body.result.applied.sceneRevision,
    charactersRevision: dash.body.result.applied.charactersRevision,
    observerTokenId: 'token-1',
    tokenId: 'token-1',
    kind: 'action.undo',
    payload: {},
  };
  const undone = await player.request('playerCommand', [campaignId, command]);
  expect(undone.status).toBe(200);
  expect(undone.body.result.receipt).toMatchObject({
    kind: 'action.undo',
    tokenId: 'token-1',
  });
  const replay = await player.request('playerCommand', [campaignId, command]);
  expect(replay.body.result.outcome).toBe('duplicate');
  const after = await player.request('playerState', [{ observerTokenId: 'token-1' }]);
  expect(after.body.result.gameplay.ownedTokens[0].economy.actions).toBe(1);
  expect(after.body.result.gameplay.ownedTokens[0].movement.allowanceFeet).toBe(30);
  const canonical = JSON.parse((await host.request('readScene', [campaignId])).body.result.scene);
  expect(canonical.combat.histories[0].entries[0].undone).toBe(true);
}, 30000);

test('the finalized browser snapshot publishes publicScene and canonical commands/ownedTokens without a private restore snapshot', async () => {
  const { player } = await table();
  const response = await player.request('playerState', [
    { observerTokenId: 'token-1', presentationVersion: 1 },
  ]);
  expect(response.status).toBe(200);
  const state = response.body.result;
  expect(state.scene).toBeNull();
  expect(state.publicScene).toMatchObject({
    version: 1,
    presentation: { mapId: 'map-main', focusTokenId: 'token-1' },
    assets: { maps: [expect.objectContaining({ id: 'map-main' })] },
    actors: [
      expect.objectContaining({ id: 'token-1', owned: true, mapId: 'map-main' }),
      expect.objectContaining({ id: 'token-2', owned: false, characterId: null }),
    ],
    updates: [],
  });
  expect(state.gameplay).toMatchObject({
    version: 1,
    commands: expect.arrayContaining(['move']),
    ownedTokens: [
      { tokenId: 'token-1', availability: { move: { allowed: true, code: 'allowed' } } },
    ],
    turn: { active: true, number: 1, tokenId: 'token-1' },
  });
  expect(state.publicScene).not.toHaveProperty('combat');
  expect(state.publicScene).not.toHaveProperty('tokenCounters');
  expect(JSON.stringify(state.publicScene)).not.toContain('DM SECRET NOTES');
}, 30000);

test('the browser-safe public validator accepts the actual producer and rejects private restore data', async () => {
  const { player } = await table();
  const response = await player.request('playerState', [
    { observerTokenId: 'token-1', presentationVersion: 1 },
  ]);
  expect(validatePlayerState(response.body.result)).toBe(response.body.result);
  const privateSnapshot = JSON.parse(JSON.stringify(response.body.result));
  privateSnapshot.publicScene.combat = { secretActorId: 'hidden-token' };
  expect(() => validatePlayerState(privateSnapshot)).toThrow(/public|private/i);
}, 30000);

test('the finalized tokenId/view command returns a completed five-foot route with explicit FROM and fresh authorized state', async () => {
  const { campaignId, player } = await table();
  const response = await player.request('playerState', [
    { observerTokenId: 'token-1', presentationVersion: 1 },
  ]);
  const before = response.body.result;
  const from = {
    mapId: 'map-main',
    gridX: 1,
    gridY: 1,
    facingAngle: 0,
    pose: { kind: 'ground', world: { x: 1.5, y: 0, z: 1.5 } },
  };
  const commandId = randomUUID();
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId,
      sceneRevision: before.sceneRevision,
      charactersRevision: before.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
      view: { mapId: 'map-main', assetKey: before.publicScene.assetKey },
    },
  ]);
  expect(moved.status).toBe(200);
  const result = moved.body.result;
  expect(result).toMatchObject({
    version: 1,
    commandId,
    outcome: 'applied',
    applied: { sceneRevision: before.sceneRevision + 1, charactersRevision: before.revision },
    receipt: {
      kind: 'move',
      tokenId: 'token-1',
      costFeet: 5,
      budget: { movementSpentFeet: 5, movementRemainingFeet: 25 },
      motion: { kind: 'walk', completed: true, from },
    },
  });
  expect(result.receipt.route).toHaveLength(1);
  expect(result.receipt.route[0]).toMatchObject({
    mapId: 'map-main',
    gridX: 2,
    gridY: 1,
    pose: { kind: 'ground', world: { x: 2.5, y: 0, z: 1.5 } },
  });
  expect(result.receipt.motion.route).toEqual(result.receipt.route);
  expect(validatePlayerState(result.state)).toBe(result.state);
  expect(result.state.publicScene.assets).toBeNull();
  expect(result.state.publicScene.updates).toEqual([
    expect.objectContaining({
      commandId,
      tokenId: 'token-1',
      kind: 'move',
      motion: result.receipt.motion,
      sceneRevision: result.applied.sceneRevision,
      charactersRevision: result.applied.charactersRevision,
    }),
  ]);
  expect(validatePlayerCommandResult(result, { cachedAssets: before.publicScene.assets })).toBe(
    result
  );
  const invalidResult = JSON.parse(JSON.stringify(result));
  invalidResult.receipt.motion.from.mapId = 'unauthorized-map';
  expect(() =>
    validatePlayerCommandResult(invalidResult, { cachedAssets: before.publicScene.assets })
  ).toThrow();
}, 30000);

test('a player-first commit makes stale DM scene writes a typed CAS conflict without changing poses or resources', async () => {
  const { campaignId, player } = await table();
  const original = (await host.request('readCharacters', [campaignId])).body.result;
  const state = (
    await player.request('playerState', [{ observerTokenId: 'token-1', presentationVersion: 1 }])
  ).body.result;
  const moved = await player.request('playerCommand', [
    campaignId,
    {
      version: 1,
      commandId: randomUUID(),
      sceneRevision: state.sceneRevision,
      charactersRevision: state.revision,
      observerTokenId: 'token-1',
      tokenId: 'token-1',
      kind: 'move',
      payload: { target: { mapId: 'map-main', gridX: 2, gridY: 1 } },
    },
  ]);
  expect(moved.status).toBe(200);
  const canonical = (await host.request('readCharacters', [campaignId])).body.result;
  const stale = await host.request('commitScene', [
    campaignId,
    {
      ruleset: '2024',
      revision: original.sceneRevision,
      charactersRevision: original.revision,
      scene: original.scene,
    },
  ]);
  expect(stale.status).toBe(409);
  expect(stale.body.code).toBe('stale-revision');
  expect(stale.body.current).toEqual({
    sceneRevision: canonical.sceneRevision,
    charactersRevision: canonical.revision,
  });
  expect((await host.request('readCharacters', [campaignId])).body.result).toEqual(canonical);
}, 30000);
