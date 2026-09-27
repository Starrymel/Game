import test from 'node:test';
import assert from 'node:assert/strict';
import { median, baselineFrom, driftBaseline } from '../src/ui/lobby.js';

test('median ignores NaN and handles even/empty', () => {
  assert.equal(median([3, NaN, 1, 2]), 2);
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([]), 0);
});
test('baseline uses only the last window', () => {
  const s = [{ t: 0, roll: 14, brows: NaN, smile: NaN }, { t: 2000, roll: 0, brows: 0.35, smile: NaN }, { t: 2500, roll: 1, brows: 0.35, smile: NaN }];
  const b = baselineFrom(s, 3000, 1200);
  assert.equal(b.roll, 0.5); assert.equal(b.brows, 0.35);
});
test('drift follows small offsets only', () => {
  assert.ok(driftBaseline(0, 3, 5, 0.1) > 0);
  assert.equal(driftBaseline(0, 12, 5, 0.1), 0);
});
