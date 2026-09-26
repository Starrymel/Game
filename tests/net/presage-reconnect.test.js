// Owner: D. The game's connection to the local Presage bridge must survive the bridge starting late or restarting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { bus } from '../../src/eventBus.js';
import { startPresageBiometrics, stopPresageBiometrics } from '../../src/biometrics-presage.js';

const require = createRequire(import.meta.url);
const { WebSocketServer } = require('ws');

const freePort = () => new Promise((resolve) => {
  const s = require('node:net').createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
});
function bridge(port, hr) {
  const wss = new WebSocketServer({ port, host: '127.0.0.1', path: '/biometrics' });
  wss.on('connection', (ws) => {
    const t = setInterval(() => ws.readyState === ws.OPEN && ws.send(JSON.stringify({ player: 1, hr, breath: 12, stress: 0.2, calm: 0.8 })), 30);
    ws.on('close', () => clearInterval(t));
  });
  return { stop: () => new Promise((r) => { wss.clients.forEach((c) => c.terminate()); wss.close(r); }) };
}
const nextSample = (ms = 3000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => { off(); reject(new Error('no biometric_sample arrived')); }, ms);
  const off = bus.on('biometric_sample', (s) => { clearTimeout(timer); off(); resolve(s); });
});

test('connects even though the bridge starts AFTER the game asked for it', async () => {
  const port = await freePort();
  startPresageBiometrics(`ws://127.0.0.1:${port}/biometrics`, { retryAfterMs: 60 });
  await new Promise((r) => setTimeout(r, 200));            // bridge is not there yet: first attempts fail
  const b = bridge(port, 88);
  const s = await nextSample();
  assert.equal(s.source, 'presage');
  assert.equal(s.hr, 88);
  stopPresageBiometrics(); await b.stop();
});

test('reconnects by itself when the bridge is restarted', async () => {
  const port = await freePort();
  let b = bridge(port, 61);
  startPresageBiometrics(`ws://127.0.0.1:${port}/biometrics`, { retryAfterMs: 60 });
  assert.equal((await nextSample()).hr, 61);
  await b.stop();                                          // Ctrl+C the bridge
  await new Promise((r) => setTimeout(r, 200));
  b = bridge(port, 90);                                    // start it again
  await new Promise((r) => setTimeout(r, 200));
  const s = await nextSample();
  assert.equal(s.hr, 90);
  stopPresageBiometrics(); await b.stop();
});

test('stopPresageBiometrics really stops reconnecting', async () => {
  const port = await freePort();
  startPresageBiometrics(`ws://127.0.0.1:${port}/biometrics`, { retryAfterMs: 50 });
  stopPresageBiometrics();
  let connected = false;
  const wss = new WebSocketServer({ port, host: '127.0.0.1', path: '/biometrics' });
  wss.on('connection', () => { connected = true; });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(connected, false);
  await new Promise((r) => wss.close(r));
});
