import test from 'node:test';
import assert from 'node:assert/strict';
import { createFaceControl } from '../../src/face/faceControl.js';
import { bus } from '../../src/eventBus.js';
import { readInput } from '../../src/input.js';
import { headSample } from '../../src/face/headPose.js';
import { SETTINGS_KEY } from '../../src/face/settings.js';

function memStorage(initial) {
  const m = new Map(initial ? [[SETTINGS_KEY, JSON.stringify(initial)]] : []);
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), _m: m };
}
function lm({ cx = 0.5, cy = 0.5, roll = 0, eye = 0.1 } = {}) {
  const r = (roll * Math.PI) / 180;
  const out = []; out[33] = { x: cx - eye * Math.cos(r), y: cy - eye * Math.sin(r) };
  out[263] = { x: cx + eye * Math.cos(r), y: cy + eye * Math.sin(r) }; out[1] = { x: cx, y: cy + 0.1 };
  return out;
}
const feed = (player, spec, n = 1) => { for (let i = 0; i < n; i++) bus.emit('head_sample', { player, sample: headSample(lm(spec)) }); };
const made = [];
const mk = (opts = {}) => { const fc = createFaceControl({ player: 1, storage: memStorage(), track: async () => {}, untrack: () => {}, ...opts }); made.push(fc); return fc; };
test.afterEach(() => { while (made.length) made.pop().dispose(); });

test('start -> loading -> calibrating -> ready after ~30 face frames', async () => {
  const fc = mk(); const seen = [];
  const off = bus.on('face_status', (s) => seen.push(s.status));
  await fc.start();
  assert.deepEqual(seen, ['loading', 'calibrating']);
  feed(1, {}, 10); assert.equal(fc.status, 'calibrating');
  feed(1, {}, 25); assert.equal(fc.status, 'ready');
  off(); fc.dispose();
});

test('a failing camera start reports an error status with a message', async () => {
  const fc = mk({ track: async () => { const e = new Error('Permission denied'); e.name = 'NotAllowedError'; throw e; } });
  await fc.start();
  assert.equal(fc.status, 'error');
  assert.match(fc.error.message, /Permission denied/);
});

test('once ready, a head tilt presses left; before that nothing happens', async () => {
  const fc = mk(); await fc.start();
  feed(1, { roll: 30 }, 3);
  assert.equal(readInput(1).left, false);                // still calibrating
  feed(1, {}, 40);
  assert.equal(fc.status, 'ready');
  // walking is duty-cycled, so try a few frames across the cycle
  let pressed = false;
  for (let i = 0; i < 12 && !pressed; i++) { feed(1, { roll: 40 }, 4); pressed = readInput(1).left || pressed; await new Promise((r) => setTimeout(r, 25)); }
  assert.equal(pressed, true);
  fc.dispose();
});

test('gestures follow the saved map; other players are ignored', async () => {
  const fc = mk(); await fc.start(); feed(1, {}, 40);
  bus.emit('gesture', { player: 2, name: 'browsUp' });
  assert.equal(readInput(2).laser, false);
  bus.emit('gesture', { player: 1, name: 'browsUp' });
  assert.equal(readInput(1).laser, true);                // default map: eyebrows = the laser shot (regular attack)
  assert.equal(readInput(1).special, false);
  bus.emit('gesture', { player: 1, name: 'smile' });
  assert.equal(readInput(1).lightNear, true);            // default map: smile = punch, only when the opponent is near
  assert.equal(readInput(1).light, false);
  fc.update({ map: { browsUp: 'none', smile: 'punch' } });
  await new Promise((r) => setTimeout(r, 420));          // let earlier pulses expire
  bus.emit('gesture', { player: 1, name: 'browsUp' });
  assert.equal(readInput(1).laser, false);
  bus.emit('gesture', { player: 1, name: 'smile' });
  assert.equal(readInput(1).light, true);                // now an always-punch
  fc.dispose();
});

test('settings are saved, restored, validated and applied live', () => {
  const st = memStorage();
  const a = createFaceControl({ player: 1, storage: st, track: async () => {}, untrack: () => {} });
  a.update({ browsUp: 0.45, blinkHoldMs: 99999, mode: 'lean' });
  assert.equal(a.settings.blinkHoldMs, 600);             // clamped
  assert.equal(a.gestureOpts.browsUp, 0.45);             // live in the detector's options
  assert.equal(a.head.options.mode, 'lean');
  const b = createFaceControl({ player: 1, storage: st, track: async () => {}, untrack: () => {} });
  assert.equal(b.settings.browsUp, 0.45);
  assert.equal(b.settings.mode, 'lean');
  assert.equal(createFaceControl({ player: 1, storage: memStorage({ browsUp: 'junk', map: { smile: 'explode' } }), track: async () => {}, untrack: () => {} }).settings.browsUp, 0.3);
});

test('stop() remembers the keyboard choice; warnings appear when the face is lost', async () => {
  let t = 1000;
  const st = memStorage();
  const fc = mk({ storage: st, now: () => t });
  await fc.start(); feed(1, {}, 40);
  let warned = null; const off = bus.on('face_warnings', (w) => { warned = w.warnings; });
  t += 3000; // no face for 3s (no head_sample with a face)
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(warned && warned.some((w) => w.id === 'face'));
  off();
  fc.stop();
  assert.equal(fc.status, 'off');
  assert.equal(JSON.parse(st.getItem(SETTINGS_KEY)).enabled, false);
});

test('a slow frame rate only warns after the start-up grace period, and is smoothed', async () => {
  let t = 1000;
  const fc = mk({ now: () => t });
  await fc.start(); feed(1, {}, 40);
  let ids = [];
  const off = bus.on('face_warnings', (w) => { ids = w.warnings.map((x) => x.id); });
  bus.emit('face_frame', { player: 1, fps: 6, luma: 120 });
  bus.emit('head_sample', { player: 1, sample: headSample(lm()) });
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(!ids.includes('fps'), 'no fps warning during the grace period');
  t += 6000;
  for (let i = 0; i < 6; i++) bus.emit('face_frame', { player: 1, fps: 6, luma: 120 });
  bus.emit('head_sample', { player: 1, sample: headSample(lm()) });
  await new Promise((r) => setTimeout(r, 650));
  assert.ok(ids.includes('fps'), 'persistent low fps warns after the grace period');
  off();
});

test('personal calibration: thresholds come from this person\'s own rest and peak', async () => {
  const st = memStorage();
  const fc = mk({ storage: st });
  await fc.start();
  // neutral face while calibrating: brows rest ~0.2, smile rest ~0.05
  for (let i = 0; i < 40; i++) { bus.emit('face_values', { player: 1, scores: { browOuterUpLeft: 0.2, mouthSmileLeft: 0.05, mouthSmileRight: 0.05 } }); bus.emit('head_sample', { player: 1, sample: headSample(lm()) }); }
  assert.equal(fc.status, 'ready');
  const p = fc.measure('brows', 60);
  for (let i = 0; i < 20; i++) bus.emit('face_values', { player: 1, scores: { browOuterUpLeft: 0.7, browOuterUpRight: 0.65 } });
  const r = await p;
  assert.equal(r.ok, true);
  assert.ok(Math.abs(fc.settings.browsUp - 0.45) < 0.02, 'threshold between rest 0.2 and peak 0.7: ' + fc.settings.browsUp);
  assert.equal(fc.gestureOpts.browsUp, fc.settings.browsUp);                    // live in the detector
  assert.ok(JSON.parse(st.getItem(SETTINGS_KEY)).browsUp > 0.4);                // and remembered

  // a shy smile (0.05 -> 0.30) still gives a usable, lower threshold; a friend with a bigger smile gets a higher one
  const p2 = fc.measure('smile', 60);
  for (let i = 0; i < 20; i++) bus.emit('face_values', { player: 1, scores: { mouthSmileLeft: 0.3, mouthSmileRight: 0.3 } });
  const r2 = await p2;
  assert.equal(r2.ok, true);
  assert.ok(fc.settings.smileUp > 0.1 && fc.settings.smileUp < 0.25, 'shy smile threshold: ' + fc.settings.smileUp);
  assert.equal(fc.gestureOpts.smile, fc.settings.smileUp);

  // a movement too small to tell from rest leaves the setting alone
  const before = fc.settings.browsUp;
  const p3 = fc.measure('brows', 40);
  for (let i = 0; i < 10; i++) bus.emit('face_values', { player: 1, scores: { browOuterUpLeft: 0.22 } });
  const r3 = await p3;
  assert.equal(r3.ok, false);
  assert.equal(fc.settings.browsUp, before);
});

test('walking holds the direction continuously while tilted (no stop-and-go)', async () => {
  const fc = mk(); await fc.start(); feed(1, {}, 40);
  let held = 0, checks = 0;
  for (let i = 0; i < 12; i++) {
    feed(1, { roll: 40 }, 2); checks++;
    if (readInput(1).left) held++;
    await new Promise((r) => setTimeout(r, 30));
  }
  assert.equal(held, checks);
});
