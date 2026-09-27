// Face controls without any UI: starts MediaPipe, calibrates, turns head moves and gestures into game input
// (the same pulseInput path keyboards use, so it works unchanged for the guest in two-laptop play), keeps
// the settings, and reports warnings. The overlay and the tuning panel are just views over this.
//
// status: 'off' -> 'loading' -> 'calibrating' -> 'ready'   (or 'error')
import { bus } from '../eventBus.js';
import { pulseInput } from '../input.js';
import { startFaceTracking, stopFaceTracking } from './faceTracker.js';
import { createHeadController } from './headPose.js';
import { actionFor } from './actions.js';
import { loadSettings, saveSettings, sanitizeSettings, getStorage } from './settings.js';
import { evaluateWarnings } from './warnings.js';
import { KINDS, thresholdFrom, robustPeak, mean } from './personalCal.js';

// Deliberately hard to trigger by accident: needs a clear move, and the neutral follows slow shifts.
const HEAD_BASE = { tiltDeg: 20, leanFrac: 0.55, vertFrac: 0.5 };
const WARN_EVERY_MS = 500;
const FPS_GRACE_MS = 5000; // the first seconds include model warm-up; don't nag about speed yet

export function createFaceControl({
  player, storage = getStorage(), track = startFaceTracking, untrack = stopFaceTracking, now = () => Date.now(),
} = {}) {
  const settings = loadSettings(storage);
  // These two objects are shared with the detector / head controller, so changes apply live.
  const gestureOpts = {};
  const head = createHeadController({ smooth: 0.35, drift: 0.01 });
  let status = 'off';
  let error = null;
  let lastFaceAt = 0;
  let frame = { luma: null, fps: null, eye: null };
  let warnings = [];
  let timer = null;
  let startedAt = 0;
  let wasUp = false; // jump is edge-triggered: one jump per head-up gesture, not "hold to bounce forever"
  let headActive = false; // true while ANY head tilt (left/right/up/down) is active (see the browsUp suppression below)
  const rest = { brows: [], smile: [] };   // face at rest, gathered while calibrating (for the personal thresholds)

  function apply() {
    gestureOpts.blinkHoldMs = settings.blinkHoldMs;
    gestureOpts.smirkUp = settings.smirkUp;
    gestureOpts.smile = settings.smileUp;
    gestureOpts.browsUp = settings.browsUp;
    head.options.mode = settings.mode;
    for (const k of Object.keys(HEAD_BASE)) head.options[k] = HEAD_BASE[k] * settings.headSens;
  }
  apply();

  function setStatus(next, err = null) {
    status = next; error = err;
    bus.emit('face_status', { player, status, error: err ? (err.message || err.name || String(err)) : null });
  }

  function persist() { saveSettings(settings, storage); }

  // Change settings (validated), apply them live and remember them.
  function update(patch) {
    const merged = sanitizeSettings({ ...settings, ...patch, map: { ...settings.map, ...(patch.map || {}) } });
    const modeChanged = merged.mode !== settings.mode;
    Object.assign(settings, merged);
    apply();
    if (modeChanged) head.recenter();
    persist();
    bus.emit('face_settings', { player, settings });
  }

  const offs = [];
  offs.push(bus.on('head_sample', (m) => {
    if (m.player !== player) return;
    if (m.sample) { lastFaceAt = now(); frame.eye = m.sample.eye ?? frame.eye; }
    const r = head.update(m.sample);
    if (status === 'calibrating' && head.isCalibrated()) setStatus('ready');
    bus.emit('head_state', { player, state: r });
    if (status !== 'ready' || !settings.headOn || !r.values) return;
    // Sideways: hold the direction while tilted, like a held key. (maxSpeed < 1 gives a slower stop-and-go walk.)
    const phase = (now() % 240) / 240;
    if ((r.left || r.right) && (settings.maxSpeed >= 0.95 || phase < settings.maxSpeed)) pulseInput(player, r.left ? 'left' : 'right', 120);
    // Jump: one pulse per head-up gesture (rising edge only) -- otherwise holding your
    // head up re-fires every frame, which reads as continuous bouncing, not a single jump.
    if (r.up && !wasUp) pulseInput(player, 'up', 120);
    wasUp = r.up;
    headActive = r.left || r.right || r.up || r.down;
    // Block: a genuine hold, same as holding the keyboard's down key.
    if (r.down) pulseInput(player, 'down', 120);
  }));

  offs.push(bus.on('gesture', (g) => {
    if (g.player !== player || status !== 'ready') return;
    // Any head tilt (left/right/up/down) shifts the face landmarks enough to nudge the eyebrow-raise
    // score too, for most people -- so the laser must NOT fire while the head is actively tilted;
    // it only fires from a genuine, deliberate eyebrow raise with the head at rest.
    if (g.name === 'browsUp' && headActive) return;
    const a = actionFor(settings.map, g.name);
    if (a) pulseInput(player, a[0], a[1]);
  }));

  // While calibrating (neutral face), remember what eyebrows and smile read at rest.
  offs.push(bus.on('face_values', (m) => {
    if (m.player !== player || status !== 'calibrating' || !m.scores) return;
    for (const k of Object.keys(rest)) { rest[k].push(KINDS[k](m.scores)); if (rest[k].length > 120) rest[k].shift(); }
  }));
  offs.push(bus.on('face_frame', (m) => {
    if (m.player !== player) return;
    // Smooth the frame rate so one slow half-second doesn't trigger a warning.
    const fps = frame.fps == null ? m.fps : frame.fps * 0.6 + m.fps * 0.4;
    frame = { ...frame, luma: m.luma, fps };
  }));

  // Ask the person to push a gesture as far as they can for `ms`; sets that gesture's threshold from their own range.
  // Resolves { ok, baseline, peak, threshold }. ok=false means "too small to tell apart from rest" (settings unchanged).
  function measure(kind, ms = 2000) {
    const read = KINDS[kind];
    return new Promise((resolve) => {
      const values = [];
      const off = bus.on('face_values', (m) => { if (m.player === player && m.scores) values.push(read(m.scores)); });
      setTimeout(() => {
        off();
        const baseline = mean(rest[kind]) ?? 0;
        const peak = robustPeak(values);
        const threshold = thresholdFrom(baseline, peak);
        if (threshold != null) update(kind === 'brows' ? { browsUp: threshold } : { smileUp: threshold });
        resolve({ ok: threshold != null, baseline, peak, threshold });
      }, ms);
    });
  }

  function checkWarnings() {
    if (status !== 'calibrating' && status !== 'ready') { if (warnings.length) { warnings = []; bus.emit('face_warnings', { player, warnings }); } return; }
    const inGrace = now() - startedAt < FPS_GRACE_MS;
    const next = evaluateWarnings({ now: now(), lastFaceAt, ...frame, fps: inGrace ? null : frame.fps });
    const same = next.length === warnings.length && next.every((w, i) => w.id === warnings[i].id);
    if (!same) { warnings = next; bus.emit('face_warnings', { player, warnings }); }
  }

  async function start() {
    if (status === 'loading' || status === 'calibrating' || status === 'ready') return;
    if (!settings.enabled) update({ enabled: true });
    setStatus('loading');
    try {
      await track({ player, opts: gestureOpts });
    } catch (e) {
      setStatus('error', e);
      return;
    }
    rest.brows.length = 0; rest.smile.length = 0;
    lastFaceAt = 0; startedAt = now(); frame = { luma: null, fps: null, eye: null }; wasUp = false;
    head.recenter();
    setStatus('calibrating');
    clearInterval(timer);
    timer = setInterval(checkWarnings, WARN_EVERY_MS);
  }

  function stop({ remember = true } = {}) {
    untrack();
    clearInterval(timer); timer = null;
    warnings = []; bus.emit('face_warnings', { player, warnings });
    setStatus('off');
    if (remember) update({ enabled: false }); // "use the keyboard": stay off next time
  }

  return {
    settings, head, gestureOpts,
    get status() { return status; },
    get error() { return error; },
    get warnings() { return warnings; },
    start, stop, update, measure,
    recenter: () => { head.recenter(); if (status === 'ready') { status = 'calibrating'; setStatus('calibrating'); } },
    dispose: () => { clearInterval(timer); timer = null; offs.forEach((off) => off()); },
  };
}
