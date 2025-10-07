// tests/processListenerDiagnostics.js
// NFC diagnostic helper: captures baseline and final process listener counts per event.
// Enabled only when TEST_PROCESS_LISTENER_DIAGNOSTICS=1.
// Usage: imported by tests/setup.js (try/catch). Provides afterAll summary.

const ENABLED = process.env.TEST_PROCESS_LISTENER_DIAGNOSTICS === '1';
const baseline = {};

function snapshot() {
  const events = process.eventNames ? process.eventNames() : [];
  const out = {};
  for (const ev of events) {
    try {
      out[ev] = process.listenerCount(ev);
    } catch (_) {
      // ignore
    }
  }
  return out;
}

function diffCounts(before, after) {
  const delta = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    const b = before[k] || 0;
    const a = after[k] || 0;
    if (a !== b) delta[k] = { before: b, after: a, delta: a - b };
  }
  return delta;
}

function installProcessListenerDiagnostics() {
  if (!ENABLED || global.__PROCESS_LISTENER_DIAGNOSTICS__) return;
  global.__PROCESS_LISTENER_DIAGNOSTICS__ = true;
  Object.assign(baseline, snapshot());
  afterAll(() => {
    const finalCounts = snapshot();
    const changes = diffCounts(baseline, finalCounts);
    const changedKeys = Object.keys(changes);
    if (changedKeys.length) {
      // eslint-disable-next-line no-console
      console.warn('[process-listeners] Listener count deltas detected:', changes);
    }
  });
}

module.exports = { installProcessListenerDiagnostics };
