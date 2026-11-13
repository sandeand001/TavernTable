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
      const response = await fetch('http://127.0.0.1:' + port + '/healthz', { signal: AbortSignal.timeout(1000) });
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
  for (const ruleset of ['2014', '2024']) {
    await resources.catalog({
      ruleset,
      sourcePacks: manifest.packs.filter(pack => pack.ruleset === ruleset && pack.core)
        .map(pack => ({ id: pack.id, version: pack.version, ruleset, enabled: true })),
    });
  }
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
    'tools/cloud/campaign-store.js', 'tools/cloud/cloud-http.js', 'src/campaigns/CloudProtocol.js',
  ]) {
    runtimeHashes[file] = createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  }
  console.log(JSON.stringify({
    node: process.version, platform: process.platform, architecture: process.arch, uid: process.getuid(),
    port, bindsAllInterfaces: true, readiness: 200, anonymousAccount: 401, anonymousLiveStatus: 401,
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
