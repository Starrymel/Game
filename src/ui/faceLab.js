// Face lab (opt-in: ?facelab=1): MediaPipe face gestures -> game actions, with live values so you can tune.
import { bus } from '../eventBus.js';
import { pulseInput } from '../input.js';
import { startFaceTracking, stopFaceTracking } from '../face/faceTracker.js';
import { GESTURES } from '../face/gestures.js';
import { createHeadController } from '../face/headPose.js';

const ACTIONS = { none: null, punch: ['light', 150], special: ['special', 150], block: ['down', 400], jump: ['up', 200] };
const LABELS = { browsUp: 'Raise eyebrows', smirkRight: 'Smirk: one mouth corner (right)', smirkLeft: 'Smirk: one mouth corner (left)', browLeft: 'Raise left eyebrow only', browRight: 'Raise right eyebrow only', blink: 'Long blink (both eyes)', winkLeft: 'Wink left eye', winkRight: 'Wink right eye', jawOpen: 'Mouth open', smile: 'Smile' };
const DEFAULT_MAP = { browsUp: 'punch', smirkRight: 'none', smirkLeft: 'none', browLeft: 'none', browRight: 'none', blink: 'none', winkLeft: 'none', winkRight: 'none', jawOpen: 'special', smile: 'none' };

export function actionFor(map, gesture) { return ACTIONS[map[gesture]] ?? null; }

export function initFaceLab({ player, map = DEFAULT_MAP }) {
  const map_ = { ...map };
  const panel = document.createElement('details');
  panel.id = 'face-lab';
  panel.open = true;
  panel.innerHTML = `
    <summary>Face lab - MediaPipe (player ${player})</summary>
    <p id="fl-status">Click Start. Needs internet (loads MediaPipe and the face model).</p>
    <button type="button" id="fl-start">Start face tracking</button>
    <button type="button" id="fl-stop">Stop</button>
    <p id="fl-values">Eyes L/R: - | Mouth open: - | Mouth corners: -</p>
    <p id="fl-last"></p>
    <p><label>Eyebrow sensitivity: raise must reach <b id="fl-brow-v">0.30</b> <input type="range" id="fl-brow" min="0.1" max="0.7" step="0.01" value="0.3"></label> (lower = easier; it also fires if the head-jump lifts your brows, so raise it if so)</p>
    <p><label>Smirk sensitivity: corner must reach <b id="fl-smirk-v">0.22</b> <input type="range" id="fl-smirk" min="0.08" max="0.6" step="0.01" value="0.22"></label> (lower = easier)</p>
    <p><label>Long blink = eyes closed for <b id="fl-hold-v">250</b> ms <input type="range" id="fl-hold" min="150" max="600" step="10" value="250"></label> (normal blinks are ~100-150 ms)</p>
    <fieldset id="fl-head"><legend>Head controls</legend>
      <label><input type="checkbox" id="fl-head-on" checked> On</label>
      Move sideways by: <select id="fl-head-mode"><option value="tilt">tilting head (ear to shoulder)</option><option value="lean">leaning head sideways</option></select>
      <br><label>Head sensitivity (higher = needs a bigger move) <b id="fl-headsens-v">1.0</b> <input type="range" id="fl-headsens" min="0.6" max="2" step="0.1" value="1"></label>
      <br><label>Max walking speed <b id="fl-maxspeed-v">0.70</b> <input type="range" id="fl-maxspeed" min="0.2" max="1" step="0.05" value="0.7"></label>
      <br><button type="button" id="fl-recenter">Recenter (sit neutral first)</button>
      <p id="fl-head-vals">Look at the camera in a neutral pose after clicking Start; it calibrates for about a second.</p>
      <p>Move left/right = tilt or lean | Jump = raise your head | Hide (block) = lower your head</p>
    </fieldset>
    <table id="fl-map">${GESTURES.map((g) => `<tr><td>${LABELS[g]}</td><td><select data-g="${g}">${
      Object.keys(ACTIONS).map((a) => `<option value="${a}"${map_[g] === a ? ' selected' : ''}>${a}</option>`).join('')
    }</select></td><td class="fl-cnt" data-c="${g}">0</td></tr>`).join('')}</table>
  `;
  document.body.append(panel);
  const $ = (s) => panel.querySelector(s);
  const counts = {};
  const gestureOpts = { blinkHoldMs: 250, smirkUp: 0.22, browsUp: 0.3 }; // shared with the detector: changes apply live
  $('#fl-brow').oninput = (e) => { gestureOpts.browsUp = Number(e.target.value); $('#fl-brow-v').textContent = e.target.value; };
  $('#fl-smirk').oninput = (e) => { gestureOpts.smirkUp = Number(e.target.value); $('#fl-smirk-v').textContent = e.target.value; };
  $('#fl-hold').oninput = (e) => { gestureOpts.blinkHoldMs = Number(e.target.value); $('#fl-hold-v').textContent = e.target.value; };
  panel.querySelectorAll('select').forEach((sel) => { sel.onchange = () => { map_[sel.dataset.g] = sel.value; }; });

  $('#fl-start').onclick = async () => {
    try { await startFaceTracking({ player, opts: gestureOpts, onStatus: (t) => { $('#fl-status').textContent = t; } }); }
    catch (e) { $('#fl-status').textContent = `Couldn't start: ${e?.message || e?.name || e}`; }
  };
  $('#fl-stop').onclick = () => { stopFaceTracking(); $('#fl-status').textContent = 'Stopped.'; };

  // Gentler than the raw defaults: smoothing, bigger dead zone, speed grows with the tilt.
  const BASE = { tiltDeg: 14, leanFrac: 0.4, vertFrac: 0.35 };
  const head = createHeadController({ mode: 'tilt', ...BASE, smooth: 0.5 });
  let maxSpeed = 0.7; // 0..1 cap on sideways walking speed
  $('#fl-headsens').oninput = (e) => { const k = Number(e.target.value); $('#fl-headsens-v').textContent = k.toFixed(1); for (const key of Object.keys(BASE)) head.options[key] = BASE[key] * k; };
  $('#fl-maxspeed').oninput = (e) => { maxSpeed = Number(e.target.value); $('#fl-maxspeed-v').textContent = maxSpeed.toFixed(2); };
  $('#fl-head-mode').onchange = (e) => { head.options.mode = e.target.value; head.recenter(); };
  $('#fl-recenter').onclick = () => head.recenter();
  bus.on('head_sample', (m) => {
    if (m.player !== player) return;
    const r = head.update(m.sample);
    const el = $('#fl-head-vals');
    if (r.calibrating || !head.isCalibrated()) { el.textContent = m.sample ? 'Calibrating - hold a neutral pose…' : 'No face in view'; return; }
    if (r.values) {
      const on = ['left', 'right', 'up', 'down'].filter((k) => r[k]);
      el.textContent = `Tilt ${r.values.roll.toFixed(0)} deg | lean ${r.values.lean.toFixed(2)} | vertical ${r.values.vert.toFixed(2)} -> ${on.join('+') || 'neutral'}`;
    }
    if (!$('#fl-head-on').checked) return;
    // Held while the pose is held: refresh a short pulse every frame (drops out fast if tracking stops).
    // Sideways: pulse-width modulation, so a small tilt walks slowly and a big tilt walks at full speed.
    const duty = r.speed * maxSpeed;
    const phase = (Date.now() % 240) / 240;
    if ((r.left || r.right) && phase < duty) pulseInput(player, r.left ? 'left' : 'right', 70);
    for (const k of ['up', 'down']) if (r[k]) pulseInput(player, k, 120);
  });

  let lastPaint = 0;
  bus.on('face_values', (m) => {
    if (m.player !== player || Date.now() - lastPaint < 100) return;
    lastPaint = Date.now();
    const s = m.scores;
    $('#fl-values').textContent = s
      ? `Brows up L/R: ${(s.browOuterUpLeft ?? 0).toFixed(2)} / ${(s.browOuterUpRight ?? 0).toFixed(2)} | Eyes closed L/R: ${(s.eyeBlinkLeft ?? 0).toFixed(2)} / ${(s.eyeBlinkRight ?? 0).toFixed(2)} | Mouth open: ${(s.jawOpen ?? 0).toFixed(2)} | Mouth corners up L/R: ${(s.mouthSmileLeft ?? 0).toFixed(2)} / ${(s.mouthSmileRight ?? 0).toFixed(2)}`
      : 'No face in view';
  });
  bus.on('gesture', (g) => {
    if (g.player !== player) return;
    counts[g.name] = (counts[g.name] || 0) + 1;
    panel.querySelector(`[data-c="${g.name}"]`).textContent = counts[g.name];
    const a = actionFor(map_, g.name);
    $('#fl-last').textContent = `${LABELS[g.name]}${a ? ` -> ${map_[g.name].toUpperCase()}!` : ''}`;
    if (a) pulseInput(player, a[0], a[1]);
  });
}
