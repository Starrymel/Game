import test from 'node:test';
import assert from 'node:assert/strict';
import { thresholdFrom, robustPeak, mean, KINDS } from '../../src/face/personalCal.js';

test('threshold sits between rest and peak; too-small movements are rejected', () => {
  assert.ok(Math.abs(thresholdFrom(0.1, 0.7) - 0.4) < 1e-9);
  assert.ok(Math.abs(thresholdFrom(0.05, 0.35) - 0.2) < 1e-9);       // a shy smile still gets a usable threshold
  assert.equal(thresholdFrom(0.2, 0.25), null);                        // barely moved
  assert.equal(thresholdFrom(NaN, 0.5), null);
  assert.equal(thresholdFrom(0.0, 0.14, { fraction: 0.5 }), 0.1);      // floor
  assert.equal(thresholdFrom(0.5, 2.0), 0.85);                         // ceiling
});

test('robustPeak ignores single-frame spikes but keeps a held peak', () => {
  assert.ok(robustPeak([0.1, 0.1, 0.9, 0.1, 0.1, 0.1, 0.1]) < 0.4);
  assert.ok(robustPeak([0.1, 0.5, 0.6, 0.6, 0.55, 0.6, 0.1]) > 0.55);
  assert.equal(robustPeak([]), null);
  assert.equal(robustPeak([0.3, 0.4]), 0.4);
  assert.equal(mean([1, 2, 3]), 2);
  assert.equal(mean([]), null);
});

test('kinds read the right blendshapes', () => {
  assert.equal(KINDS.brows({ browOuterUpLeft: 0.2, browInnerUp: 0.5 }), 0.5);
  assert.equal(KINDS.smile({ mouthSmileLeft: 0.2, mouthSmileRight: 0.4 }), 0.30000000000000004);
});
