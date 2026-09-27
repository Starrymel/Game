import test from 'node:test';
import assert from 'node:assert/strict';

const { LOBBY_PACE } = await import('../../src/ui/lobby.js');

test('the start screen face pace is deliberately slow (guards against being tuned back to twitchy)', () => {
  assert.ok(LOBBY_PACE.warmupMs >= 4000, 'time to read before any face input counts');
  assert.ok(LOBBY_PACE.moveHoldMs >= 600, 'a tilt must be held to move');
  assert.ok(LOBBY_PACE.moveCooldownMs >= 1000, 'no rapid-fire moves');
  assert.ok(LOBBY_PACE.settleMs >= 1500, 'the highlight must settle before a choice can start');
  assert.ok(LOBBY_PACE.selectHoldMs >= 1200, 'a choice needs a real hold, not a twitch');
  assert.ok(LOBBY_PACE.settleMs > LOBBY_PACE.moveHoldMs, 'you cannot choose while you are still moving');
});
