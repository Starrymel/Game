import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUND_END_PACE } from '../src/ui/roundEnd.js';

test('round-end pace: a short arming delay then a deliberate hold', () => {
  assert.ok(ROUND_END_PACE.armMs >= 1000, 'wait a moment before any gesture counts (people laugh when they win)');
  assert.ok(ROUND_END_PACE.holdMs >= 800, 'gesture must be held');
});
