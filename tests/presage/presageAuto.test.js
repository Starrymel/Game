import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || { addEventListener() {} };
const { probeBridge, createPresageAuto, presageChipText } = await import('../../src/presageAuto.js');

class FakeWS {                                   // opens, errors, or hangs depending on the address
  constructor(url) {
    this.url = url;
    setTimeout(() => {
      if (url.includes('up')) this.onopen?.();
      else if (url.includes('refused')) { this.onerror?.(); this.onclose?.(); }
    }, 5);
  }
  close() { this.closed = true; }
}

test('probeBridge: true when something answers, false when refused or silent', async () => {
  assert.equal(await probeBridge('ws://up', { WS: FakeWS, timeoutMs: 200 }), true);
  assert.equal(await probeBridge('ws://refused', { WS: FakeWS, timeoutMs: 200 }), false);
  assert.equal(await probeBridge('ws://hang', { WS: FakeWS, timeoutMs: 50 }), false);          // never answers: gives up
  assert.equal(await probeBridge('ws://x', { WS: class { constructor() { throw new Error('blocked'); } }, timeoutMs: 50 }), false);
});

function rig(overrides = {}) {
  const log = { source: [], started: [], changes: [] };
  const auto = createPresageAuto({
    player: 2, wsUrl: 'ws://localhost:8787/biometrics',
    probe: async () => true,
    start: async (player, opts) => { log.started.push([player, opts.wsUrl]); return () => { log.stopped = true; }; },
    setSource: (kind, o) => log.source.push([kind, o.player]),
    status: () => ({ lastSampleAt: { 2: 0 }, lastHint: {} }),
    onChange: (s) => log.changes.push(s.phase),
    ...overrides,
  });
  return { auto, log };
}

test('bridge running: switches this player to Presage and starts the camera feed (no button needed)', async () => {
  const { auto, log } = rig();
  await auto.start();
  assert.equal(auto.phase, 'live');
  assert.deepEqual(log.source, [['presage', 2]]);
  assert.deepEqual(log.started, [[2, 'ws://localhost:8787/biometrics']]);
  assert.deepEqual(log.changes, ['probing', 'live']);
});

test('no bridge: stays on simulated data and says so; Retry works once the bridge is up', async () => {
  let up = false;
  const { auto, log } = rig({ probe: async () => up });
  await auto.start();
  assert.equal(auto.phase, 'no-bridge');
  assert.deepEqual(log.source, [], 'nothing was switched');
  assert.match(auto.text(), /simulated.*not running/i);
  up = true;
  await auto.retry();
  assert.equal(auto.phase, 'live');
  assert.deepEqual(log.source, [['presage', 2]]);
});

test('camera refused: back to simulated for that player, with the reason', async () => {
  const { auto, log } = rig({ start: async () => { const e = new Error('Permission denied'); throw e; } });
  await auto.start();
  assert.equal(auto.phase, 'camera-error');
  assert.deepEqual(log.source, [['presage', 2], ['mock', 2]]);
  assert.match(auto.text(), /simulated.*Permission denied/);
});

test('it does not start twice (page load + Retry at the same time)', async () => {
  const { auto, log } = rig();
  await Promise.all([auto.start(), auto.retry(), auto.start()]);
  assert.equal(log.started.length, 1);
});

test('chip text: measuring, live reading, lost signal, certificate hint', () => {
  const now = 100000;
  assert.match(presageChipText({ phase: 'live', lastSampleAt: 0, now }), /measuring.*10 seconds/);
  assert.equal(presageChipText({ phase: 'live', lastSampleAt: now - 1000, hr: 71.6, now }), 'Heart rate: 72 bpm (live)');
  assert.match(presageChipText({ phase: 'live', lastSampleAt: now - 9000, hr: 70, hint: 'No face found', now }), /lost the signal.*No face found/);
  assert.match(presageChipText({ phase: 'no-bridge', wsUrl: 'wss://localhost:8790/biometrics' }), /https:\/\/localhost:8790/);
  assert.match(presageChipText({ phase: 'no-bridge', wsUrl: 'ws://192.168.1.5:8787/biometrics' }), /not running on this laptop/);
  // A deployed site's own same-origin /presage endpoint: no local process to start, different advice.
  assert.match(presageChipText({ phase: 'no-bridge', wsUrl: 'wss://composure.onrender.com/presage' }), /Could not reach Presage on the server/);
  // The camera connected fine, but the server-side session itself failed: this must be visible,
  // not indistinguishable from a normal "still measuring" wait.
  assert.match(
    presageChipText({ phase: 'live', lastSampleAt: 0, serverError: 'no API key configured on the server', now }),
    /unavailable \(no API key configured on the server\)/,
  );
  assert.equal(presageChipText({ phase: 'weird' }), '');
});

test('a server-side error is surfaced even though the camera connected fine (not silently swallowed)', async () => {
  const { auto, log } = rig({ status: () => ({ lastSampleAt: { 2: 0 }, lastHint: {}, lastError: { 2: 'SmartSpectra session failed: no key' } }) });
  await auto.start();
  assert.equal(auto.phase, 'live');
  assert.match(auto.text(), /unavailable \(SmartSpectra session failed: no key\)/);
});

test('restart() reconnects a live-but-broken session (plain retry() would no-op)', async () => {
  const { auto, log } = rig();
  await auto.start();
  assert.equal(auto.phase, 'live');
  await auto.retry();                    // no-op: phase is already 'live'
  assert.equal(log.started.length, 1);
  await auto.restart();                  // stop() then start() again: a real fresh connection
  assert.equal(log.stopped, true);
  assert.equal(log.started.length, 2);
  assert.equal(auto.phase, 'live');
});
