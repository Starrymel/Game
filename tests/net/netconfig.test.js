// Owner: D. URL decisions for two-player play and the Presage bridge.
import test from 'node:test';
import assert from 'node:assert/strict';
import { relayUrlFor, bridgeUrlFor, isForwardableSample, acceptGuestSample } from '../../src/netconfig.js';

const http = (host = '172.20.10.10:3000') => ({ protocol: 'http:', host, hostname: host.split(':')[0] });
const https = (host = 'composure.onrender.com') => ({ protocol: 'https:', host, hostname: host });
const q = (s) => new URLSearchParams(s);

test('same Wi-Fi: relay and bridge are on the host laptop', () => {
  assert.equal(relayUrlFor(http(), q('role=guest')), 'ws://172.20.10.10:8788/netplay');
  assert.equal(bridgeUrlFor(http(), q('role=guest')), 'ws://172.20.10.10:8787/biometrics');
});

test('same Wi-Fi, guest on its own localhost page: ?host= points at the host laptop', () => {
  const loc = http('localhost:8532');
  assert.equal(relayUrlFor(loc, q('role=guest&host=172.20.10.10')), 'ws://172.20.10.10:8788/netplay');
  assert.equal(bridgeUrlFor(loc, q('role=guest&host=172.20.10.10')), 'ws://172.20.10.10:8787/biometrics');
});

test('hosted https site: relay is the site itself over wss', () => {
  assert.equal(relayUrlFor(https(), q('role=host')), 'wss://composure.onrender.com/netplay');
});

test('hosted https site: each laptop uses its OWN bridge on localhost', () => {
  assert.equal(bridgeUrlFor(https(), q('role=host')), 'ws://localhost:8787/biometrics');
  // ?host= must not send camera video over the internet
  assert.equal(bridgeUrlFor(https(), q('role=guest&host=172.20.10.10')), 'ws://localhost:8787/biometrics');
});

test('overrides: relayPort, bridgePort, bridge, room', () => {
  assert.equal(relayUrlFor(http(), q('relayPort=3000')), 'ws://172.20.10.10:3000/netplay');
  assert.equal(bridgeUrlFor(http(), q('bridgePort=9000')), 'ws://172.20.10.10:9000/biometrics');
  assert.equal(bridgeUrlFor(https(), q('bridge=ws://localhost:9999/biometrics')), 'ws://localhost:9999/biometrics');
  assert.equal(relayUrlFor(https(), q('room=team 1')), 'wss://composure.onrender.com/netplay?room=team%201');
});

test('guest only forwards its own real (presage) readings', () => {
  assert.equal(isForwardableSample({ source: 'presage', player: 2, hr: 70 }, 2), true);
  assert.equal(isForwardableSample({ source: 'mock', player: 2, hr: 70 }, 2), false);     // mock never goes to the host
  assert.equal(isForwardableSample({ source: 'presage', player: 1, hr: 70 }, 2), false);   // not our player
  assert.equal(isForwardableSample(null, 2), false);
});

test('host only accepts well-formed readings for the guest player', () => {
  const ok = acceptGuestSample({ player: 2, hr: 72.5, breath: 15, stress: 0.3, calm: 0.7, evil: 'x' }, 2);
  assert.deepEqual({ ...ok, t: 0 }, { player: 2, t: 0, hr: 72.5, breath: 15, stress: 0.3, calm: 0.7, source: 'presage' });
  assert.equal(acceptGuestSample({ player: 1, hr: 72 }, 2), null);        // guest cannot write the host's player
  assert.equal(acceptGuestSample({ player: 2, hr: 'abc' }, 2), null);
  assert.equal(acceptGuestSample({ player: 2, hr: Infinity }, 2), null);
  assert.equal(acceptGuestSample(undefined, 2), null);
  const partial = acceptGuestSample({ player: 2, hr: 80 }, 2);
  assert.deepEqual([partial.breath, partial.stress, partial.calm], [14, 0, 1]);   // sensible defaults
});
