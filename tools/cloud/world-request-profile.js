const { AsyncLocalStorage } = require('node:async_hooks');

const requests = new AsyncLocalStorage();
const instrumented = new WeakSet();

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
  try {
    return await requests.run(trace, operation);
  } catch (error) {
    trace.errorCode = error?.code || error?.name || 'non-error';
    throw error;
  } finally {
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
