import { test, after } from 'node:test';
import assert from 'node:assert/strict';

// Browser globals touched at import/connect time.
const sockets = [];
class FakeWebSocket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 1; sockets.push(this); }
  send() {}
  close() {}
}
globalThis.window = globalThis.window ?? {};
globalThis.WebSocket = FakeWebSocket;

const { bus } = await import('../../src/eventBus.js');
const bio = await import('../../src/biometrics.js');
const { connectNet } = await import('../../src/net.js');
const mock = await import('../../src/biometrics-mock.js');
const presage = await import('../../src/biometrics-presage.js');

// Always stop the mock generator / reconnect timers, even if an assertion fails.
after(() => { mock.stopMockBiometrics(); presage.stopPresageBiometrics(); });

const settle = () => { for (let i = 0; i < 300; i++) bio.advanceBiometricsSmoothing(1 / 60); };
const relay = (ws, sample) => ws.onmessage({ data: JSON.stringify({ type: 'bio', sample }) });

test('host uses the guest\'s forwarded camera readings for the guest\'s player', () => {
  // Host laptop: its own camera on P1 (as the camera panel does), guest plays P2.
  bio.setBiometricsSource('presage', { player: 1, wsUrl: 'wss://localhost:8790/biometrics' });
  const ws = connectNet({ relayUrl: 'wss://example.onrender.com/netplay?room=team1', asRole: 'host', myPlayer: 1 });
  assert.equal(bio.getBiometricsSource(2), 'mock', 'before any guest reading, P2 is on mock');

  relay(ws, { player: 2, hr: 97, breath: 12, stress: 0.4, calm: 0.6, source: 'presage' });
  assert.equal(bio.getBiometricsSource(2), 'presage');
  settle();
  assert.ok(Math.abs(bio.getBiometrics(2).hr - 97) < 1, `P2 hr ${bio.getBiometrics(2).hr}`);

  // This laptop's mock generator must not override the guest's real readings.
  bus.emit('biometric_sample', { player: 2, hr: 150, breath: 20, stress: 0.9, calm: 0.1, source: 'mock', t: Date.now() });
  relay(ws, { player: 2, hr: 101, breath: 12, stress: 0.4, calm: 0.6, source: 'presage' });
  bus.emit('biometric_sample', { player: 2, hr: 150, breath: 20, stress: 0.9, calm: 0.1, source: 'mock', t: Date.now() });
  settle();
  assert.ok(Math.abs(bio.getBiometrics(2).hr - 101) < 1, `P2 hr ${bio.getBiometrics(2).hr}`);

  // A guest can't write the host's own player.
  const p1Before = bio.getBiometrics(1).hr;
  relay(ws, { player: 1, hr: 180, source: 'presage' });
  settle();
  assert.equal(bio.getBiometrics(1).hr, p1Before);
});
