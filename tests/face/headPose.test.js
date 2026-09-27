import test from 'node:test';
import assert from 'node:assert/strict';
import { headSample, createHeadController } from '../../src/face/headPose.js';

// Build landmark set: eyes 0.2 apart, centered at (cx, cy); tilt = roll in degrees (+ = user's left).
function lm({ cx = 0.5, cy = 0.5, roll = 0 } = {}) {
  const r = (roll * Math.PI) / 180, h = 0.1;
  const a = { x: cx - h * Math.cos(r), y: cy - h * Math.sin(r) };
  const b = { x: cx + h * Math.cos(r), y: cy + h * Math.sin(r) };
  const out = []; out[33] = a; out[263] = b; out[1] = { x: cx, y: cy + 0.1 };
  return out;
}
const calibrated = (opts) => { const c = createHeadController(opts); for (let i = 0; i < 30; i++) c.update(headSample(lm())); return c; };

test('headSample: tilt to the user\'s left is positive roll; missing landmarks -> null', () => {
  assert.ok(headSample(lm({ roll: 15 })).rollDeg > 14);
  assert.ok(headSample(lm({ roll: -15 })).rollDeg < -14);
  assert.equal(headSample([]), null);
});

test('tilt mode: left/right with deadzone and hysteresis', () => {
  const c = calibrated();
  assert.equal(c.update(headSample(lm({ roll: 4 }))).left, false);      // inside deadzone
  assert.equal(c.update(headSample(lm({ roll: 14 }))).left, true);
  assert.equal(c.update(headSample(lm({ roll: 8 }))).left, true);       // hysteresis keeps it on
  assert.equal(c.update(headSample(lm({ roll: 5 }))).left, false);
  const r = c.update(headSample(lm({ roll: -14 })));
  assert.equal(r.right, true); assert.equal(r.left, false);
});

test('vertical: head up = jump, head down = hide; neutral does nothing', () => {
  const c = calibrated();
  assert.deepEqual(['left', 'right', 'up', 'down'].map((k) => c.update(headSample(lm()))[k]), [false, false, false, false]);
  assert.equal(c.update(headSample(lm({ cy: 0.4 }))).up, true);    // 0.1 / 0.2 eye-dist = 0.5 > 0.3
  assert.equal(c.update(headSample(lm({ cy: 0.6 }))).down, true);
});

test('lean mode uses sideways head movement; recenter re-calibrates', () => {
  const c = calibrated({ mode: 'lean' });
  assert.equal(c.update(headSample(lm({ cx: 0.6 }))).left, true);   // image right = user's left
  assert.equal(c.update(headSample(lm({ cx: 0.4 }))).right, true);
  c.recenter();
  assert.equal(c.isCalibrated(), false);
  assert.equal(c.update(null).left, false);
});
