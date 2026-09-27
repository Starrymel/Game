// Face lab (opt-in: ?facelab=1): live values and sliders for tuning the face controls. A view over
// face/faceControl.js (which also runs by itself, with the calibration overlay, on every page).
import { bus } from '../eventBus.js';
import { GESTURES } from '../face/gestures.js';
import { ACTIONS, ACTION_LABELS, LABELS, actionFor } from '../face/actions.js';

export { actionFor }; // kept for existing imports/tests

export function initFaceLab({ player, control }) {
  const s = control.settings;
  const panel = document.createElement('details');
  panel.id = 'face-lab';
  panel.open = true;
  panel.innerHTML = `
    <summary>Face lab - tuning (player ${player})</summary>
    <p id="fl-status">Face controls start automatically. Settings here are saved in this browser.</p>
    <button type="button" id="fl-start">Start face tracking</button>
    <button type="button" id="fl-stop">Stop</button>
    <p id="fl-values">Eyes L/R: - | Mouth open: - | Mouth corners: -</p>
    <p id="fl-last"></p>
    <p><label>Eyebrow sensitivity: raise must reach <b id="fl-brow-v"></b> <input type="range" id="fl-brow" min="0.1" max="0.85" step="0.01"></label> (lower = easier; it also fires if the head-jump lifts your brows, so raise it if so)</p>
    <p><label>Smile sensitivity: smile must reach <b id="fl-smile-v"></b> <input type="range" id="fl-smile" min="0.1" max="0.85" step="0.01"></label> (lower = easier; set automatically by the start screen)</p>
    <p><label>Smirk sensitivity: corner must reach <b id="fl-smirk-v"></b> <input type="range" id="fl-smirk" min="0.08" max="0.6" step="0.01"></label> (lower = easier)</p>
    <p><label>Long blink = eyes closed for <b id="fl-hold-v"></b> ms <input type="range" id="fl-hold" min="150" max="600" step="10"></label> (normal blinks are ~100-150 ms)</p>
    <fieldset id="fl-head"><legend>Head controls</legend>
      <label><input type="checkbox" id="fl-head-on"> On</label>
      Move sideways by: <select id="fl-head-mode"><option value="tilt">tilting head (ear to shoulder)</option><option value="lean">leaning head sideways</option></select>
      <br><label>Head sensitivity (higher = needs a bigger move) <b id="fl-headsens-v"></b> <input type="range" id="fl-headsens" min="0.6" max="2" step="0.1"></label>
      <br><label>Walking: 1 = full speed while tilted, lower = slower stop-and-go <b id="fl-maxspeed-v"></b> <input type="range" id="fl-maxspeed" min="0.2" max="1" step="0.05"></label>
      <br><button type="button" id="fl-recenter">Recenter (sit neutral first)</button>
      <p id="fl-head-vals">Waiting for the camera...</p>
      <p>Move left/right = tilt or lean | Jump = raise your head | Hide (block) = lower your head</p>
    </fieldset>
    <table id="fl-map">${GESTURES.map((g) => `<tr><td>${LABELS[g]}</td><td><select data-g="${g}">${
      Object.keys(ACTIONS).map((a) => `<option value="${a}">${ACTION_LABELS[a] || a}</option>`).join('')
    }</select></td><td class="fl-cnt" data-c="${g}">0</td></tr>`).join('')}</table>
  `;
  document.body.append(panel);
  const $ = (q) => panel.querySelector(q);

  // Sliders <-> saved settings.
  const sliders = [['#fl-brow', 'browsUp', '#fl-brow-v', (v) => v.toFixed(2)], ['#fl-smile', 'smileUp', '#fl-smile-v', (v) => v.toFixed(2)], ['#fl-smirk', 'smirkUp', '#fl-smirk-v', (v) => v.toFixed(2)],
    ['#fl-hold', 'blinkHoldMs', '#fl-hold-v', (v) => String(v)], ['#fl-headsens', 'headSens', '#fl-headsens-v', (v) => v.toFixed(1)],
    ['#fl-maxspeed', 'maxSpeed', '#fl-maxspeed-v', (v) => v.toFixed(2)]];
  for (const [sel, key, label, fmt] of sliders) {
    $(sel).value = s[key]; $(label).textContent = fmt(Number(s[key]));
    $(sel).oninput = (e) => { const v = Number(e.target.value); control.update({ [key]: v }); $(label).textContent = fmt(v); };
  }
  $('#fl-head-on').checked = s.headOn;
  $('#fl-head-on').onchange = (e) => control.update({ headOn: e.target.checked });
  $('#fl-head-mode').value = s.mode;
  $('#fl-head-mode').onchange = (e) => control.update({ mode: e.target.value });
  $('#fl-recenter').onclick = () => control.recenter();
  panel.querySelectorAll('#fl-map select').forEach((sel) => {
    sel.value = s.map[sel.dataset.g];
    sel.onchange = () => control.update({ map: { [sel.dataset.g]: sel.value } });
  });

  $('#fl-start').onclick = () => control.start();
  $('#fl-stop').onclick = () => control.stop();
  const statusText = { off: 'Stopped.', loading: 'Loading MediaPipe and the face model...', calibrating: 'Calibrating - hold a neutral pose...', ready: 'Face tracking on.', error: 'Could not start.' };
  const showStatus = () => { $('#fl-status').textContent = control.status === 'error' ? `Couldn't start: ${control.error?.message || control.error?.name || 'unknown error'}` : statusText[control.status]; };
  bus.on('face_status', (m) => { if (m.player === player) showStatus(); });
  showStatus();

  const counts = {};
  let lastPaint = 0;
  bus.on('face_values', (m) => {
    if (m.player !== player || Date.now() - lastPaint < 100) return;
    lastPaint = Date.now();
    const v = m.scores;
    $('#fl-values').textContent = v
      ? `Brows up L/R: ${(v.browOuterUpLeft ?? 0).toFixed(2)} / ${(v.browOuterUpRight ?? 0).toFixed(2)} | Eyes closed L/R: ${(v.eyeBlinkLeft ?? 0).toFixed(2)} / ${(v.eyeBlinkRight ?? 0).toFixed(2)} | Mouth open: ${(v.jawOpen ?? 0).toFixed(2)} | Mouth corners up L/R: ${(v.mouthSmileLeft ?? 0).toFixed(2)} / ${(v.mouthSmileRight ?? 0).toFixed(2)}`
      : 'No face in view';
  });
  bus.on('head_state', (m) => {
    if (m.player !== player) return;
    const el = $('#fl-head-vals'), r = m.state;
    if (r.calibrating || !control.head.isCalibrated()) { el.textContent = 'Calibrating - hold a neutral pose...'; return; }
    if (r.values) {
      const on = ['left', 'right', 'up', 'down'].filter((k) => r[k]);
      el.textContent = `Tilt ${r.values.roll.toFixed(0)} deg | lean ${r.values.lean.toFixed(2)} | vertical ${r.values.vert.toFixed(2)} -> ${on.join('+') || 'neutral'}`;
    } else el.textContent = 'No face in view';
  });
  bus.on('gesture', (g) => {
    if (g.player !== player) return;
    counts[g.name] = (counts[g.name] || 0) + 1;
    panel.querySelector(`[data-c="${g.name}"]`).textContent = counts[g.name];
    const a = actionFor(control.settings.map, g.name);
    $('#fl-last').textContent = `${LABELS[g.name]}${a ? ` -> ${control.settings.map[g.name].toUpperCase()}!` : ''}`;
  });
}
