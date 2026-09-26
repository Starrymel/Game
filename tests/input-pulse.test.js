import test from 'node:test';
import assert from 'node:assert/strict';
import { pulseInput, readInput } from '../src/input.js';

test('pulseInput presses an action briefly', async () => {
  pulseInput(1, 'light', 40);
  assert.equal(readInput(1).light, true);
  assert.equal(readInput(2).light, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(readInput(1).light, false);
});
