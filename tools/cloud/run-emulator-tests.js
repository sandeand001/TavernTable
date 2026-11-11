const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseArgs } = require('node:util');
const { readEmulatorEnvironment } = require('./emulator-runtime.js');

function run() {
  const { values } = parseArgs({
    options: { 'inside-emulators': { type: 'boolean', default: false } },
  });
  const root = path.resolve(__dirname, '..', '..');
  const environment = { ...process.env };
  let args;
  if (values['inside-emulators']) {
    readEmulatorEnvironment(environment);
    const directory = path.join(root, 'tests', 'cloud');
    const tests = [...fs.globSync('**/*.test.js', { cwd: directory })]
      .sort()
      .map((file) => path.join(directory, file));
    if (!tests.length) throw new Error('No cloud integration tests were found');
    args = ['--test', '--test-concurrency=1', ...tests];
  } else {
    environment.TAVERNTABLE_CLOUD_MODE = 'emulator';
    environment.GCLOUD_PROJECT = 'demo-taverntable';
    environment.GOOGLE_CLOUD_PROJECT = 'demo-taverntable';
    if (environment.JAVA_HOME) {
      const bin = path.join(environment.JAVA_HOME, 'bin');
      const executable = path.join(bin, process.platform === 'win32' ? 'java.exe' : 'java');
      if (!fs.existsSync(executable))
        throw new Error('JAVA_HOME does not contain a Java executable');
      const key = Object.keys(environment).find((name) => name.toUpperCase() === 'PATH') || 'PATH';
      environment[key] = bin + path.delimiter + (environment[key] || '');
    }
    args = [
      require.resolve('firebase-tools/lib/bin/firebase.js'),
      'emulators:exec',
      '--project',
      'demo-taverntable',
      '--config',
      path.join(root, 'firebase.emulators.json'),
      '--only',
      'auth,firestore,storage',
      '--non-interactive',
      'node tools/cloud/run-emulator-tests.js --inside-emulators',
    ];
  }
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  const signals = ['SIGINT', 'SIGTERM'];
  const handlers = new Map(signals.map((signal) => [signal, () => child.kill(signal)]));
  for (const [signal, handler] of handlers) process.once(signal, handler);
  child.once('error', (error) => {
    console.error('[cloud-emulators]', error.message);
    process.exitCode = 1;
  });
  child.once('exit', (code, signal) => {
    for (const [name, handler] of handlers) process.removeListener(name, handler);
    if (signal) console.error('[cloud-emulators]', `Test child ended with ${signal}`);
    process.exitCode = code ?? 1;
  });
}

try {
  run();
} catch (error) {
  console.error('[cloud-emulators]', error.message);
  process.exitCode = 1;
}
