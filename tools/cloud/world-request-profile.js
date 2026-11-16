const { AsyncLocalStorage } = require('node:async_hooks');
const { Session } = require('node:inspector/promises');

const requests = new AsyncLocalStorage();
const instrumented = new WeakSet();
let sampling = false;

function hotFunctions(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const totals = new Map();
  for (let index = 0; index < profile.samples.length; index++) {
    const frame = nodes.get(profile.samples[index]).callFrame;
    const filename = frame.url.replace(/^file:\/\//, '').replace(/^\/app\//, '');
    const key = `${frame.functionName || '(anonymous)'}|${filename}:${frame.lineNumber + 1}`;
    totals.set(key, (totals.get(key) || 0) + profile.timeDeltas[index]);
  }
  return [...totals]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 24)
    .map(([frame, time]) => ({ frame, ms: time / 1000 }));
}

async function sampleCpu(trace) {
  if (sampling) return null;
  sampling = true;
  const session = new Session();
  session.connect();
  try {
    await session.post('Profiler.enable');
    await session.post('Profiler.start');
  } catch (error) {
    trace.samplingError = error.code || error.name;
    console.error('[DEBUG-m5-cpu-profile-failed]', { code: trace.samplingError });
    session.disconnect();
    sampling = false;
    return null;
  }
  let stopping;
  const stop = () => {
    if (stopping) return stopping;
    clearTimeout(timer);
    stopping = session
      .post('Profiler.stop')
      .then(({ profile }) => {
        trace.sampledCpu = hotFunctions(profile);
      })
      .catch((error) => {
        trace.samplingError = error.code || error.name;
        console.error('[DEBUG-m5-cpu-profile-failed]', { code: trace.samplingError });
      })
      .finally(() => {
        session.disconnect();
        sampling = false;
      });
    return stopping;
  };
  const timer = setTimeout(() => void stop(), 15000);
  timer.unref();
  return stop;
}

async function timed(trace, name, operation) {
  const started = performance.now();
  try {
    return await operation();
  } finally {
    const elapsed = performance.now() - started;
    const row = (trace.stages[name] ||= { calls: 0, totalMs: 0, maxMs: 0 });
    row.calls++;
    row.totalMs += elapsed;
    row.maxMs = Math.max(row.maxMs, elapsed);
  }
}

function instrument(object, names, prefix) {
  if (object === null || instrumented.has(object)) return;
  instrumented.add(object);
  for (const name of names) {
    const original = object[name];
    if (typeof original !== 'function') throw new Error('Invalid diagnostic stage: ' + name);
    object[name] = function (...args) {
      const trace = requests.getStore();
      return trace
        ? timed(trace, prefix + name, () => original.apply(this, args))
        : original.apply(this, args);
    };
  }
}

function instrumentWorldStore(store) {
  instrument(
    store,
    [
      'commitWorldCommand',
      '_loadSnapshot',
      '_prepareWorldChange',
      '_publishCanonical',
      'runAssignedBackupWork',
      '_participantBackupOwner',
      '_runOwnerBackupWork',
      'runChangeMaintenance',
    ],
    'store.'
  );
  instrument(
    store.usage,
    ['reserveOwnerStorage', 'renewOwnerStorage', 'assertPublication'],
    'usage.'
  );
  instrument(store.objects, ['read', 'stage'], 'objects.');
  const firestore = store.firestore;
  if (instrumented.has(firestore)) return;
  instrumented.add(firestore);
  const runTransaction = firestore.runTransaction;
  firestore.runTransaction = function (update, ...options) {
    const trace = requests.getStore();
    if (!trace) return runTransaction.call(this, update, ...options);
    return timed(trace, 'firestore.transaction', () =>
      runTransaction.call(
        this,
        async (transaction) => {
          trace.transactionAttempts++;
          const originals = new Map();
          for (const name of ['get', 'getAll']) {
            const original = transaction[name];
            originals.set(name, original);
            transaction[name] = function (...args) {
              return timed(trace, 'firestore.' + name, () => original.apply(this, args));
            };
          }
          try {
            return await update(transaction);
          } finally {
            for (const [name, original] of originals) transaction[name] = original;
          }
        },
        ...options
      )
    );
  };
}

async function profileWorldRequest(operation) {
  const started = performance.now();
  const cpu = process.cpuUsage();
  const trace = { stages: {}, transactionAttempts: 0 };
  const stop = await sampleCpu(trace);
  try {
    return await requests.run(trace, operation);
  } catch (error) {
    trace.errorCode = error?.code || error?.name || 'non-error';
    throw error;
  } finally {
    await stop?.();
    const used = process.cpuUsage(cpu);
    console.info(
      '[DEBUG-m5-receipt] ' +
        JSON.stringify({
          elapsedMs: performance.now() - started,
          processCpuMs: (used.user + used.system) / 1000,
          ...trace,
        })
    );
  }
}

module.exports = { instrumentWorldStore, profileWorldRequest };
