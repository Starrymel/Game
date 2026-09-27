import test from 'node:test';
import assert from 'node:assert/strict';
import { createGestureDetector, scoreMap } from '../../src/face/gestures.js';
import { actionFor } from '../../src/ui/faceLab.js';

const run = (d, frames) => frames.flatMap(([t, s]) => d(s, t).map((g) => [t, g]));
const closed = { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.9 };

test('a natural 120 ms blink does not fire, a 300 ms one fires once', () => {
  const d = createGestureDetector();
  assert.deepEqual(run(d, [[0, closed], [60, closed], [120, closed], [150, {}]]), []);
  const fired = run(d, [[1000, closed], [1100, closed], [1250, closed], [1300, closed], [1400, closed], [1500, {}]]);
  assert.deepEqual(fired.map((f) => f[1]), ['blink']);
});

test('wink needs the other eye open; both closed is a blink not a wink', () => {
  const d = createGestureDetector();
  const f = run(d, [[0, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1 }], [200, { eyeBlinkLeft: 0.9, eyeBlinkRight: 0.1 }]]);
  assert.deepEqual(f.map((x) => x[1]), ['winkLeft']);
  const d2 = createGestureDetector();
  assert.deepEqual(run(d2, [[0, closed], [200, closed]]).map((x) => x[1]), []);
});

test('jaw open fires immediately, once per open, cooldown respected', () => {
  const d = createGestureDetector();
  const f = run(d, [[0, { jawOpen: 0.8 }], [50, { jawOpen: 0.8 }], [100, {}], [150, { jawOpen: 0.8 }], [600, { jawOpen: 0.9 }]]);
  assert.deepEqual(f.map((x) => x[0]), [0]); // second open at 150 is inside the cooldown; 600 still same hold
});

test('scoreMap and action mapping', () => {
  assert.equal(scoreMap([{ categoryName: 'jawOpen', score: 0.4 }]).jawOpen, 0.4);
  assert.deepEqual(actionFor({ blink: 'punch' }, 'blink'), ['light', 150]);
  assert.equal(actionFor({ blink: 'none' }, 'blink'), null);
});

test('single eyebrow raise fires; both brows up does not', () => {
  const d = createGestureDetector();
  const one = run(d, [[0, { browOuterUpLeft: 0.8, browOuterUpRight: 0.05 }], [80, { browOuterUpLeft: 0.8, browOuterUpRight: 0.05 }]]);
  assert.deepEqual(one.map((x) => x[1]), ['browLeft']);
  const d2 = createGestureDetector();
  assert.deepEqual(run(d2, [[0, { browOuterUpLeft: 0.8, browOuterUpRight: 0.8 }], [200, { browOuterUpLeft: 0.8, browOuterUpRight: 0.8 }]]), []);
  assert.equal(actionFor({ browRight: 'punch' }, 'browRight')[0], 'light');
});
