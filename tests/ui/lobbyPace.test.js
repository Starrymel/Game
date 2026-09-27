import test from 'node:test';
import assert from 'node:assert/strict';

const { LOBBY_PACE } = await import('../../src/ui/lobby.js');

test('the start screen face pace is deliberate but not sluggish', () => {
  // deliberate: nothing happens by accident
  assert.ok(LOBBY_PACE.warmupMs >= 2000, 'a moment to read before any face input counts');
  assert.ok(LOBBY_PACE.moveHoldMs >= 300, 'a tilt must be held to move');
  assert.ok(LOBBY_PACE.selectHoldMs >= 900, 'a choice needs a real hold, not a twitch');
  assert.ok(LOBBY_PACE.settleMs > LOBBY_PACE.moveHoldMs, 'you cannot choose while you are still moving');
  // not sluggish: a person with a small head movement can still get around quickly (this was too slow before)
  assert.ok(LOBBY_PACE.warmupMs <= 4000);
  assert.ok(LOBBY_PACE.moveHoldMs <= 600, 'first step within about half a second');
  assert.ok(LOBBY_PACE.repeatMs <= 1100, 'keep tilting and it keeps stepping');
  assert.ok(LOBBY_PACE.tiltDeg <= 12, 'a small tilt is enough on this screen');
  assert.ok(LOBBY_PACE.selectHoldMs <= 1500);
  // three cards: reaching the last one from the first in one motion should take about a second and a half
  const reachLast = LOBBY_PACE.moveHoldMs + LOBBY_PACE.repeatMs;
  assert.ok(reachLast <= 1600, `${reachLast} ms`);
  assert.ok(LOBBY_PACE.tiltReleaseDeg < LOBBY_PACE.tiltDeg, 'hysteresis: leaving a tilt needs less than entering it');
  assert.ok(LOBBY_PACE.gapToleranceMs >= 100, 'tracking flicker is forgiven');
});
