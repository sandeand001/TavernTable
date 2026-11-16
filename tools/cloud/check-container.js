const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120000,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) throw new Error(`Local Docker check failed: ${args[0]}`);
  return result.stdout.trim();
}

const smoke = `
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const { createHash } = require('node:crypto');
const sharp = require('sharp');
const { HostResources } = require('./tools/host-resources.js');
const { PrivateCampaignAssets } = require('./tools/cloud/campaign-assets.js');
(async () => {
  assert.equal(process.platform, 'linux');
  assert.equal(process.arch, 'x64');
  const [major, minor, patch] = process.versions.node.split('.').map(Number);
  assert.ok(major === 24 && (minor > 4 || (minor === 4 && patch >= 1)));
  assert.equal(process.getuid(), 1000);
  for (const name of [
    '.git', '.npmrc', 'index.html', 'tests', 'docs', 'firebase.json',
    'src/config/FirebaseConfig.json', 'tools/cloud/dev-host.js',
    'tools/cloud/emulator-runtime.js', 'node_modules/firebase-tools', 'node_modules/canvas',
  ]) assert.equal(fs.existsSync(name), false, name + ' must not be in the runtime image');
  assert.equal(fs.existsSync(os.homedir() + '/.config/gcloud/application_default_credentials.json'), false);
  assert.equal(process.env.GOOGLE_APPLICATION_CREDENTIALS, undefined);
  assert.equal(fs.existsSync('/dev/nvidia0'), false);
  const port = Number(process.env.PORT);
  let ready = false;
  let lastError;
  for (let attempt = 0; attempt < 30 && !ready; attempt++) {
    try {
      const response = await fetch('http://127.0.0.1:' + port + '/health', { signal: AbortSignal.timeout(1000) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { version: 1, status: 'ready' });
      ready = true;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw lastError;
  const account = await fetch('http://127.0.0.1:' + port + '/api/cloud/account');
  assert.equal(account.status, 401);
  assert.equal((await account.json()).code, 'authentication-required');
  const liveStatus = await fetch('http://127.0.0.1:' + port +
    '/api/cloud/campaigns/11111111-1111-4111-8111-111111111111/live/status');
  assert.equal(liveStatus.status, 401);
  assert.equal((await liveStatus.json()).code, 'authentication-required');
  const assignedSheets = await fetch('http://127.0.0.1:' + port +
    '/api/cloud/campaigns/11111111-1111-4111-8111-111111111111/assigned-characters');
  assert.equal(assignedSheets.status, 401);
  assert.equal((await assignedSheets.json()).code, 'authentication-required');
  const anonymousEvents = await fetch('http://127.0.0.1:' + port +
    '/api/cloud/campaigns/11111111-1111-4111-8111-111111111111/events', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    });
  assert.equal(anonymousEvents.status, 401);
  assert.equal((await anonymousEvents.json()).code, 'authentication-required');
  for (const operation of ['owner-state', 'owner-events', 'world-commands']) {
    const response = await fetch('http://127.0.0.1:' + port +
      '/api/cloud/campaigns/11111111-1111-4111-8111-111111111111/' + operation, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
    assert.equal(response.status, 401, operation);
    assert.equal((await response.json()).code, 'authentication-required', operation);
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const forged = encode({ alg: 'none', typ: 'JWT' }) + '.' + encode({
    aud: process.env.GCLOUD_PROJECT,
    iss: 'https://securetoken.google.com/' + process.env.GCLOUD_PROJECT,
    sub: 'forged-local-fixture', exp: Math.floor(Date.now() / 1000) + 3600,
    email_verified: true,
  }) + '.';
  const rejected = await fetch('http://127.0.0.1:' + port + '/api/cloud/account', {
    headers: { Authorization: 'Bearer ' + forged },
  });
  assert.equal(rejected.status, 401);
  assert.equal((await rejected.json()).code, 'invalid-identity');
  const rejectedEvents = await fetch('http://127.0.0.1:' + port +
    '/api/cloud/campaigns/11111111-1111-4111-8111-111111111111/events', {
      method: 'POST', headers: {
        Authorization: 'Bearer ' + forged, 'Content-Type': 'application/json',
      }, body: '{}',
    });
  assert.equal(rejectedEvents.status, 401);
  assert.equal((await rejectedEvents.json()).code, 'invalid-identity');
  const files = await fetch('http://127.0.0.1:' + port + '/tools/cloud/account-access.js');
  assert.equal(files.status, 404);
  await files.arrayBuffer();
  const sockets = fs.readFileSync('/proc/net/tcp', 'utf8');
  assert.ok(sockets.includes('00000000:' + port.toString(16).toUpperCase().padStart(4, '0')));
  const manifest = JSON.parse(fs.readFileSync('assets/data/resources/manifest.json', 'utf8'));
  let resourceBytes = 0;
  for (const pack of manifest.packs) {
    const bytes = fs.readFileSync(pack.file);
    assert.equal(bytes.length, pack.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), pack.hash);
    resourceBytes += bytes.length;
  }
  const resources = new HostResources({ root: process.cwd(), manifest });
  const { participantState } = require('./tools/cloud/participant-state.js');
  const { CharacterLibrary } = require('./src/entities/characters/CharacterLibrary.js');
  const { createTwoFloorTravelScene } = require('./src/campaigns/examples/ConnectedTravelExample.js');
  const { executePlayerCommand } = require('./src/campaigns/ServerGameplay.js');
  assert.equal(fs.existsSync('assets/animated-sprites'), false);
  let nativeCoverRulesets = 0;
  let nativeFlightRulesets = 0;
  assert.equal(typeof require('./tools/cloud/participant-changes.js').ParticipantChanges, 'function');
  assert.equal(typeof require('./tools/cloud/event-stream.js').openCloudEventStream, 'function');
  for (const ruleset of ['2014', '2024']) {
    const catalog = await resources.catalog({
      ruleset,
      sourcePacks: manifest.packs.filter(pack => pack.ruleset === ruleset && pack.core)
        .map(pack => ({ id: pack.id, version: pack.version, ruleset, enabled: true })),
    });
    const campaign = { id: '11111111-1111-4111-8111-111111111111', ruleset };
    const projection = await participantState({
      state: {
        campaign, revision: 0, records: [], scene: null, sceneRevision: 0, sceneSavedAt: null,
      },
      campaign, catalog, characterIds: [], images: [],
      options: { observerTokenId: null, mapId: null, assetKey: null },
    });
    assert.deepEqual(projection.state.publicScene.actors, []);
    assert.deepEqual(projection.state.records, []);
    const values = new Map();
    const memory = {
      getItem: key => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: key => values.delete(key),
      key: index => [...values.keys()][index] ?? null,
      get length() { return values.size; },
    };
    const library = new CharacterLibrary({
      ruleset, catalog: catalog.entries, classes: catalog.classes, storage: memory,
    });
    const characters = ['Cover scout', 'Lower guide', 'Upper guide']
      .map(name => library.get(library.create(name)));
    const board = createTwoFloorTravelScene({ ruleset, characters });
    board.maps[0].terrain.heights[10][11] = 4;
    const actor = board.creatures[0];
    const original = JSON.stringify(library.get(actor.characterId));
    const covered = await executePlayerCommand(board, library, {
      kind: 'emote', tokenId: actor.id, payload: { actionId: 'action-cover' },
    }, { ownedIds: [actor.characterId] });
    const placed = covered.scene.creatures.find(entry => entry.id === actor.id);
    assert.ok(placed.pose.world.x > actor.pose.world.x && placed.pose.world.x < 11);
    assert.deepEqual(covered.receipt.from.pose.world, actor.pose.world);
    assert.deepEqual(covered.receipt.placement.pose, placed.pose);
    assert.deepEqual(covered.scene.combat, board.combat);
    assert.equal(JSON.stringify(library.get(actor.characterId)), original);
    nativeCoverRulesets++;
    await library.edit(actor.characterId, { fallTraits: { flySpeed: 60, hover: true } });
    const airborne = structuredClone(board);
    const flyer = airborne.creatures.find(entry => entry.id === actor.id);
    flyer.pose = { kind: 'flight', world: { ...actor.pose.world, y: 1 } };
    const approached = await executePlayerCommand(airborne, library, {
      kind: 'move', tokenId: actor.id,
      payload: {
        target: { mapId: actor.mapId, gridX: actor.gridX - 1, gridY: actor.gridY, elevationFeet: 1 },
        closest: true,
      },
    }, { ownedIds: [actor.characterId] });
    assert.equal(approached.receipt.costFeet, 9);
    assert.equal(approached.receipt.placement.pose.kind, 'flight');
    assert.equal(approached.receipt.placement.pose.world.y, 0.2);
    assert.equal(approached.receipt.routeFeet[1].y, 1);
    nativeFlightRulesets++;
  }
  const { PhysicalDice } = require('./tools/physical-dice.js');
  let seed = 42;
  const dice = new PhysicalDice({
    root: process.cwd(),
    random: () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; },
  });
  const nativeD20 = await dice.d20({
    metrics: { cols: 25, rows: 25, tileSize: 1 },
    groundHeights: Array.from({ length: 25 }, () => Array(25).fill(0)), obstacles: [],
  });
  assert.equal(nativeD20.type, 'physical-d20');
  assert.equal(nativeD20.cocked, false);
  assert.ok(Number.isInteger(nativeD20.value) && nativeD20.value >= 1 && nativeD20.value <= 20);
  assert.ok(nativeD20.frames.length > 20);
  assert.notDeepEqual(nativeD20.frames[0].position, nativeD20.frames.at(-1).position);
  assert.equal(nativeD20.geometryKey, createHash('sha256')
    .update(fs.readFileSync('assets/Items/d20-gold.glb')).digest('hex'));
  const image = await sharp({ create: {
    width: 4000, height: 4000, channels: 4, background: '#112233',
  } }).png().toBuffer();
  const stop = new Error('Stop before any Storage request');
  const assets = new PrivateCampaignAssets({
    bucket: { name: 'local-validation-only', file() { throw new Error('Unexpected Storage request'); } },
  });
  await assert.rejects(
    assets.stage('11111111-1111-4111-8111-111111111111', 'image/png', image, () => { throw stop; }),
    error => error === stop
  );
  const runtimeHashes = {};
  for (const file of [
    'tools/cloud/admin-runtime.js', 'tools/cloud/production-runtime.js', 'tools/cloud/production-host.js',
    'tools/cloud/campaign-store.js', 'tools/cloud/cloud-http.js', 'tools/cloud/usage-limits.js',
    'tools/cloud/account-access.js', 'tools/player-undo-sessions.js',
    'tools/player-room-visits.js',
    'tools/assigned-character-change.js',
    'tools/published-maps.js', 'tools/cloud/participant-state.js',
    'tools/cloud/participant-changes.js',
    'tools/cloud/world-request-profile.js',
    'tools/cloud/event-stream.js',
    'src/campaigns/CloudParticipantProtocol.js',
    'src/campaigns/CloudProtocol.js',
    'tools/cloud/immutable-objects.js', 'tools/movement-presentations.js', 'tools/physical-dice.js',
    'src/campaigns/CloudOwnerProtocol.js', 'src/campaigns/PlayerPublicProtocol.js',
    'src/campaigns/ServerGameplay.js', 'src/campaigns/CampaignTravel.js', 'src/systems/dice/D20Dynamics.js',
    'src/campaigns/CampaignWorld.js', 'src/campaigns/CampaignConnectionGeometry.js',
    'src/campaigns/CampaignDoors.js', 'src/campaigns/CreatureVisibility.js',
    'src/campaigns/ServerTargeting.js',
    'src/campaigns/PlayerCommandProtocol.js', 'src/entities/creatures/TokenMovement.js',
    'src/campaigns/CampaignCover.js', 'src/config/token-adapter/CoverMetrics.js',
    'assets/Items/d20-gold.glb', 'package.json', 'package-lock.json',
  ]) {
    runtimeHashes[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  console.log(JSON.stringify({
    node: process.version, platform: process.platform, architecture: process.arch, uid: process.getuid(),
    port, bindsAllInterfaces: true, readiness: 200, anonymousAccount: 401, anonymousLiveStatus: 401,
    anonymousAssignedSheets: 401,
    anonymousEvents: 401, forgedEvents: 401,
    anonymousOwnerWorld: 401, anonymousWorldCommands: 401,
    nativeD20Frames: nativeD20.frames.length, nativeD20Value: nativeD20.value, nativeCoverRulesets,
    nativeFlightRulesets,
    forgedIdentity: 401, privateFiles: 404,
    resourcePacks: manifest.packs.length, resourceBytes, validatedImagePixels: 16000000,
    rssBytes: process.memoryUsage().rss, runtimeHashes,
  }));
})().catch(error => { console.error(error); process.exitCode = 1; });
`;

function run() {
  const image = process.argv[2];
  if (
    process.argv.length !== 3 ||
    typeof image !== 'string' ||
    !/^[a-z0-9][a-z0-9./:@_-]+$/.test(image)
  )
    throw new Error('Pass one existing local image name to the container check');
  const endpoint = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  if (!endpoint.startsWith('npipe:////./pipe/') && !endpoint.startsWith('unix:///'))
    throw new Error('Container validation requires a local Docker endpoint');
  docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  let id;
  let failure;
  try {
    id = docker([
      'create',
      '--read-only',
      '--network=none',
      '--cpus=1',
      '--memory=1g',
      '--pids-limit=128',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--label=taverntable.validation=m406',
      '--env=TAVERNTABLE_CLOUD_MODE=production',
      '--env=GCLOUD_PROJECT=taverntable-container-check',
      '--env=TAVERNTABLE_CLOUD_BUCKET=taverntable-container-check.firebasestorage.app',
      '--env=TAVERNTABLE_CLOUD_ORIGINS=["https://frontend.example.test"]',
      '--env=PORT=18089',
      image,
    ]);
    assert.match(id, /^[a-f0-9]{64}$/);
    docker(['start', id]);
    const result = JSON.parse(docker(['exec', id, 'node', '-e', smoke]));
    const runtime = JSON.parse(docker(['inspect', id, '--format', '{{json .HostConfig}}']));
    assert.equal(runtime.ReadonlyRootfs, true);
    assert.equal(runtime.NetworkMode, 'none');
    assert.equal(runtime.NanoCpus, 1000000000);
    assert.equal(runtime.Memory, 1024 ** 3);
    assert.ok(!runtime.Binds?.length);
    assert.ok(!runtime.Mounts?.length);
    assert.ok(!runtime.DeviceRequests?.length);
    const { createHash } = require('node:crypto');
    for (const [file, hash] of Object.entries(result.runtimeHashes))
      assert.equal(
        createHash('sha256')
          .update(fs.readFileSync(path.join(__dirname, '..', '..', file)))
          .digest('hex'),
        hash
      );
    docker(['stop', '-t', '10', id]);
    const stopped = JSON.parse(docker(['inspect', id, '--format', '{{json .State}}']));
    assert.equal(stopped.Running, false);
    assert.equal(stopped.ExitCode, 0);
    assert.equal(stopped.OOMKilled, false);
    console.log(
      JSON.stringify({
        ...result,
        image,
        readonlyRoot: true,
        isolatedNetwork: true,
        cpu: 1,
        memoryBytes: runtime.Memory,
        gracefulExit: stopped.ExitCode,
      })
    );
  } catch (error) {
    failure = error instanceof Error ? error : new Error('Local container validation failed');
    if (id) {
      try {
        console.error(docker(['logs', id]));
      } catch (logError) {
        failure = new AggregateError(
          [failure, logError],
          `Validation container logs failed: ${id}`
        );
      }
    }
  } finally {
    if (id) {
      try {
        docker(['rm', '--force', id]);
      } catch (cleanupError) {
        failure = new AggregateError(
          failure ? [failure, cleanupError] : [cleanupError],
          `Validation container cleanup failed: ${id}`
        );
      }
    }
  }
  if (failure) throw failure;
}

try {
  run();
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
