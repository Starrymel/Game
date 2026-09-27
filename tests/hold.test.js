import test from 'node:test';
import assert from 'node:assert/strict';
import { isHeld, setLocalHold, setPeerHold, onLocalHoldChange } from '../src/hold.js';

test('held while this laptop or the other player is calibrating', () => {
  const seen = [];
  onLocalHoldChange((v) => seen.push(v));
  assert.equal(isHeld(), false);
  setLocalHold(true); setLocalHold(true);
  assert.equal(isHeld(), true);
  setLocalHold(false);
  assert.equal(isHeld(), false);
  setPeerHold(true);
  assert.equal(isHeld(), true);
  setPeerHold(false);
  assert.deepEqual(seen, [true, false]);   // only real changes are announced
});
