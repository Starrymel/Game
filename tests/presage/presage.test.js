import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Browser globals the biometrics modules touch at import / connect time.
const sockets = [];
class FakeWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  constructor(url) { this.url = url; this.readyState = 0; this.closed = false; sockets.push(this); }
  close() { this.closed = true; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  recv(obj) { this.onmessage?.({ data: typeof obj === 'string' ? obj : JSON.stringify(obj) }); }
}
globalThis.window = globalThis.window ?? {};
globalThis.WebSocket = FakeWebSocket;

let bio, presage, panel, bus, mock;
before(async () => {
  ({ bus } = await import('../../src/eventBus.js'));
  bio = await import('../../src/biometrics.js');
  presage = await import('../../src/biometrics-presage.js');
  panel = await import('../../src/ui/presagePanel.js');
  mock = await import('../../src/biometrics-mock.js');
});
after(() => { mock.stopMockBiometrics(); presage.stopPresageBiometrics(); });

const sample = (player, source, hr) => ({ player, source, hr, breath: 12, stress: 0.3, calm: 0.7, t: Date.now() });

test('starting a camera for P1 switches only P1; P2 keeps mock data instead of freezing', () => {
  bio.setBiometricsSource('presage', { player: 1, wsUrl: 'ws://localhost:8787/biometrics' });
  assert.equal(bio.getBiometricsSource(1), 'presage');
  assert.equal(bio.getBiometricsSource(2), 'mock');

  bus.emit('biometric_sample', sample(1, 'mock', 150));     // ignored: P1 is on the camera
  bus.emit('biometric_sample', sample(1, 'presage', 90));
  bus.emit('biometric_sample', sample(2, 'mock', 120));     // P2 still follows mock
  for (let i = 0; i < 240; i++) bio.advanceBiometricsSmoothing(1 / 60);
  assert.ok(Math.abs(bio.getBiometrics(1).hr - 90) < 1, `P1 hr ${bio.getBiometrics(1).hr}`);
  assert.equal(bio.getBiometrics(1).source, 'presage');
  assert.ok(Math.abs(bio.getBiometrics(2).hr - 120) < 1, `P2 hr ${bio.getBiometrics(2).hr}`);
  assert.equal(bio.getBiometrics(2).source, 'mock');

  // Old console usage still works: no player = both.
  bio.setBiometricsSource('mock');
  assert.deepEqual([bio.getBiometricsSource(1), bio.getBiometricsSource(2)], ['mock', 'mock']);
});

test('presage client: listens on the bridge the frames go to, reconnecting when it changes', () => {
  presage.startPresageBiometrics('ws://localhost:8787/biometrics');
  const first = sockets.at(-1);
  first.open();
  assert.equal(presage.getPresageStatus().connected, true);
  presage.startPresageBiometrics('wss://localhost:8790/biometrics'); // e.g. hosted https page
  assert.equal(first.closed, true);
  assert.equal(sockets.at(-1).url, 'wss://localhost:8790/biometrics');
  assert.equal(presage.getPresageStatus().url, 'wss://localhost:8790/biometrics');
});

test('presage client: status messages are not readings; bad messages are ignored', () => {
  presage.startPresageBiometrics('ws://localhost:8787/biometrics');
  const ws = sockets.at(-1);
  ws.open();
  const samples = [];
  const statuses = [];
  const offS = bus.on('biometric_sample', (s) => { if (s.source === 'presage') samples.push(s); });
  const offT = bus.on('presage_status', (s) => statuses.push(s));

  ws.recv({ type: 'status', player: 1, code: 1, hint: 'No face found.' });
  ws.recv('not json');
  ws.recv({ player: 3, hr: 70 });
  ws.recv({ player: 1 });                 // no numbers
  assert.equal(samples.length, 0);
  assert.deepEqual(statuses, [{ player: 1, code: 1, hint: 'No face found.', error: undefined }]);
  assert.equal(presage.getPresageStatus().lastHint[1], 'No face found.');

  ws.recv({ player: 1, hr: 72.5, breath: 13, stress: 0.2, calm: 0.8, source: 'presage', t: 1 });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].hr, 72.5);
  assert.ok(presage.getPresageStatus().lastSampleAt[1] > 0);
  offS(); offT();
});

test('camera panel explains every state in plain words', () => {
  const now = 100000;
  const st = (over = {}) => ({ connected: true, url: 'ws://localhost:8787/biometrics', lastSampleAt: { 1: 0, 2: 0 }, lastHint: { 1: null, 2: null }, ...over });
  const d = (over, status) => panel.describePresage(1, { source: 'presage', streaming: true, status: st(status), hr: 71.6, now, ...over });
  assert.match(d({ source: 'mock' }), /mock data/);
  assert.match(d({}, { connected: false }), /can't reach the Presage bridge .* is it running\?/);
  assert.match(d({ streaming: false }), /camera not started/);
  assert.match(d({}, {}), /waiting for first reading \(keep your face in view/);
  assert.match(d({}, { lastHint: { 1: 'No face found.' } }), /waiting for first reading -- No face found/);
  assert.equal(d({}, { lastSampleAt: { 1: now - 2000 } }), 'Player 1: 72 bpm from camera (updated 2s ago)');
  assert.match(d({}, { lastSampleAt: { 1: now - 9000 }, lastHint: { 1: 'Hold still.' } }), /no reading for 9s -- Hold still/);
});

test('camera errors are explained even when the browser gives no message', () => {
  assert.match(panel.cameraErrorText({ name: 'OverconstrainedError', message: '' }), /25\+ fps/);
  assert.match(panel.cameraErrorText({ name: 'NotAllowedError', message: '' }), /permission was denied/);
  assert.equal(panel.cameraErrorText({ name: 'Weird', message: 'boom' }), 'boom');
  assert.equal(panel.cameraErrorText({}), 'unknown error');
});

const rootEnv = fileURLToPath(new URL('../../.env', import.meta.url));
const hasRootKey = existsSync(rootEnv) && /^PRESAGE_API_KEY=.+/m.test(readFileSync(rootEnv, 'utf8'));
const bridgeInstalled = existsSync(fileURLToPath(new URL('../../bridge/node_modules/@smartspectra', import.meta.url)));

test('bridge started from bridge/ finds the key in the main .env', {
  skip: !hasRootKey ? 'no PRESAGE_API_KEY in main .env' : !bridgeInstalled ? 'bridge deps not installed (cd bridge && npm install)' : false,
}, async () => {
  const bridgeDir = fileURLToPath(new URL('../../bridge/', import.meta.url));
  const env = { ...process.env, PRESAGE_BRIDGE_PORT: '18787', PRESAGE_BRIDGE_WSS_PORT: '18790' };
  delete env.PRESAGE_API_KEY;
  const child = spawn(process.execPath, ['server.js'], { cwd: bridgeDir, env });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  try {
    for (let i = 0; i < 100 && !/listening on ws:/.test(out); i++) await new Promise((r) => setTimeout(r, 100));
    assert.match(out, /PRESAGE_API_KEY loaded from \.\.[\\/]\.env/);
    assert.doesNotMatch(out, /PRESAGE_API_KEY not set/);
  } finally {
    child.kill();
  }
});
