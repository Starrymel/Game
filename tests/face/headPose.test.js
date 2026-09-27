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

test('a tilt-up that also carries incidental roll only jumps, not walks', () => {
  const c = calibrated();
  const r = c.update(headSample(lm({ roll: 14, cy: 0.4 })));   // crosses both the left and up thresholds at once
  assert.equal(r.up, true);
  assert.equal(r.left, false);
  assert.equal(r.right, false);
});

test('lean mode uses sideways head movement; recenter re-calibrates', () => {
  const c = calibrated({ mode: 'lean' });
  assert.equal(c.update(headSample(lm({ cx: 0.6 }))).left, true);   // image right = user's left
  assert.equal(c.update(headSample(lm({ cx: 0.4 }))).right, true);
  c.recenter();
  assert.equal(c.isCalibrated(), false);
  assert.equal(c.update(null).left, false);
});

test('smoothing ignores a one-frame jitter but follows a held tilt', () => {
  const c = calibrated({ smooth: 0.4 });
  assert.equal(c.update(headSample(lm({ roll: 20 }))).left, false);           // single spike is damped (8 deg after smoothing)
  let r; for (let i = 0; i < 8; i++) r = c.update(headSample(lm({ roll: 20 })));
  assert.equal(r.left, true);                                                  // held tilt gets through
});

test('speed grows with the tilt: slow near the threshold, full at 2x', () => {
  const c = calibrated({ tiltDeg: 10 });
  const slow = c.update(headSample(lm({ roll: 11 }))).speed;
  const fast = c.update(headSample(lm({ roll: 25 }))).speed;
  assert.ok(slow > 0 && slow < 0.4, `slow=${slow}`);
  assert.equal(fast, 1);
  assert.equal(c.update(headSample(lm())).speed, 0);
});

test('drift: slowly resting off-centre never triggers movement, a quick move still does', () => {
  const c = calibrated({ drift: 0.05, tiltDeg: 10 });
  let fired = false;
  for (let deg = 0; deg <= 30; deg += 0.25) {                 // creep from 0 to 30 degrees over 120 frames
    const r = c.update(headSample(lm({ roll: deg })));
    fired = fired || r.left || r.right;
  }
  assert.equal(fired, false);
  assert.equal(c.update(headSample(lm({ roll: 30 + 25 }))).left, true);   // then a sharp 25 degree move counts
  const fixed = calibrated({ drift: 0, tiltDeg: 10 });
  let firedFixed = false;
  for (let deg = 0; deg <= 30; deg += 0.25) firedFixed = firedFixed || fixed.update(headSample(lm({ roll: deg }))).left;
  assert.equal(firedFixed, true);                              // without drift the same slow creep does trigger
});
