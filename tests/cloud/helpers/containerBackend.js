const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createInterface } = require('node:readline');
const { promisify } = require('node:util');
const { readEmulatorEnvironment } = require('../../../tools/cloud/emulator-runtime.js');

const execute = promisify(execFile);
const CONTAINER_MESSAGE_PREFIX = 'taverntable-lifecycle:';
const CONTAINER_RUNTIME_FILES = [
  'tools/cloud/admin-runtime.js',
  'tools/cloud/campaign-store.js',
  'tools/cloud/cloud-http.js',
  'tools/cloud/event-stream.js',
  'tools/cloud/participant-changes.js',
  'tools/cloud/immutable-objects.js',
  'tools/cloud/backup-objects.js',
  'tools/cloud/usage-limits.js',
  'src/campaigns/CloudProtocol.js',
  'package.json',
  'package-lock.json',
];

async function docker(args) {
  const result = await execute('docker', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return result.stdout.trim();
}

async function launchContainerBackend({ image, bootstrap }) {
  const config = readEmulatorEnvironment();
  assert.match(image, /^taverntable-cloud:[a-z0-9][a-z0-9._-]*$/);
  const endpoint = await docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}']);
  assert.ok(
    endpoint.startsWith('npipe:////./pipe/') || endpoint.startsWith('unix:///'),
    'Lifecycle containers require the local Docker engine'
  );
  await docker(['image', 'inspect', image, '--format', '{{.Id}}']);
  const id = await docker([
    'create',
    '--pull=never',
    '--interactive',
    '--name=taverntable-lifecycle-' + randomUUID(),
    '--label=taverntable.validation=m405',
    '--read-only',
    '--network=host',
    '--cpus=1',
    '--memory=1g',
    '--pids-limit=128',
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    '--env=TAVERNTABLE_CLOUD_MODE=emulator',
    '--env=GCLOUD_PROJECT=' + config.projectId,
    '--env=GOOGLE_CLOUD_PROJECT=' + config.projectId,
    '--env=FIREBASE_AUTH_EMULATOR_HOST=' + config.authHost,
    '--env=FIRESTORE_EMULATOR_HOST=' + config.firestoreHost,
    '--env=FIREBASE_STORAGE_EMULATOR_HOST=' + config.storageHost,
    '--entrypoint=node',
    image,
    '-e',
    bootstrap,
  ]);
  assert.match(id, /^[a-f0-9]{64}$/);
  let child;
  try {
    const inspection = JSON.parse(await docker(['inspect', id]))[0];
    assert.equal(inspection.Config.User, 'node');
    assert.equal(inspection.HostConfig.ReadonlyRootfs, true);
    assert.equal(inspection.HostConfig.NetworkMode, 'host');
    assert.equal(inspection.HostConfig.NanoCpus, 1000000000);
    assert.equal(inspection.HostConfig.Memory, 1024 ** 3);
    assert.equal(inspection.Mounts.length, 0);
    assert.ok(!inspection.HostConfig.Binds?.length);
    assert.ok(!inspection.HostConfig.DeviceRequests?.length);
    assert.ok(
      inspection.Config.Env.every(
        (value) => !/^(GOOGLE_APPLICATION_CREDENTIALS|FIREBASE_CONFIG)=/.test(value)
      )
    );
    child = spawn('docker', ['start', '--attach', '--interactive', id], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      if (!line.startsWith(CONTAINER_MESSAGE_PREFIX)) return;
      let value;
      try {
        value = JSON.parse(line.slice(CONTAINER_MESSAGE_PREFIX.length));
      } catch (error) {
        child.emit(
          'error',
          new Error('The container lifecycle message is invalid', { cause: error })
        );
        return;
      }
      child.emit('message', value);
    });
    child.stderr.on('data', (data) => process.stderr.write(data));
    child.send = (value) => child.stdin.write(JSON.stringify(value) + '\n');
    child.container = {
      id,
      kills: 0,
      async kill() {
        const state = JSON.parse(await docker(['inspect', id, '--format', '{{json .State}}']));
        if (state.Running) {
          const exited =
            child.exitCode === null && child.signalCode === null
              ? once(child, 'exit')
              : Promise.resolve();
          await docker(['kill', '--signal=KILL', id]);
          await exited;
          this.kills++;
          const stopped = JSON.parse(await docker(['inspect', id, '--format', '{{json .State}}']));
          assert.equal(stopped.Running, false);
          assert.equal(stopped.ExitCode, 137);
          assert.equal(stopped.OOMKilled, false);
        }
      },
      async remove() {
        await this.kill();
        await docker(['rm', id]);
        assert.equal(
          await docker(['container', 'ls', '--all', '--filter', 'id=' + id, '--format', '{{.ID}}']),
          ''
        );
        lines.close();
      },
    };
    return child;
  } catch (error) {
    try {
      await docker(['rm', '--force', id]);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Lifecycle container setup and cleanup failed'
      );
    }
    throw error;
  }
}

module.exports = {
  launchContainerBackend,
  CONTAINER_MESSAGE_PREFIX,
  CONTAINER_RUNTIME_FILES,
};
