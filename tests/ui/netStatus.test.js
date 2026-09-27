import test from 'node:test';
import assert from 'node:assert/strict';
globalThis.window = globalThis.window || { addEventListener() {} };   // net.js pulls in modules that touch window
const { bannerFor } = await import('../../src/ui/netStatus.js');

const base = { role: 'host', room: 'A1', state: 'open', peerKnown: true, peerPresent: true, rejectedCode: null };

test('nothing to say while both players are in and connected', () => {
  assert.equal(bannerFor(base), null);
});
test('host waits for Player 2; guest waits for Player 1', () => {
  assert.match(bannerFor({ ...base, peerPresent: false }).text, /Player 1.*Waiting for Player 2/);
  assert.match(bannerFor({ ...base, role: 'guest', peerPresent: false }).text, /Player 2.*Waiting for Player 1/);
  assert.doesNotMatch(bannerFor({ ...base, room: 'MAIN', peerPresent: false }).text, /room/);   // the shared room is not mentioned
});
test('an old-style relay that never reports presence does not show a waiting banner', () => {
  assert.equal(bannerFor({ ...base, peerKnown: false, peerPresent: false }), null);
});
test('connecting, lost connection, and seat taken', () => {
  assert.match(bannerFor({ ...base, state: 'connecting' }).text, /Connecting \(room A1\)/);
  const lost = bannerFor({ ...base, state: 'closed' });
  assert.match(lost.text, /reconnect/); assert.equal(lost.warn, true);
  const taken = bannerFor({ ...base, role: 'guest', state: 'rejected', rejectedCode: 4001 });
  assert.match(taken.text, /Player 2 is already taken in room A1/);
  assert.equal(taken.action, 'lobby');
});
