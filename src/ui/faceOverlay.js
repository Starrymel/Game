// Face controls on-ramp: an overlay that walks through loading -> calibrating -> "try it", a warning banner
// (dark room, face lost, ...), and a small chip to recenter or switch to the keyboard. Views only: all logic
// lives in face/faceControl.js.
import { bus } from '../eventBus.js';
import { actionFor, ACTION_LABELS, LABELS } from '../face/actions.js';

export function cameraErrorText(e) {
  const name = e?.name;
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'The camera is blocked. Allow it for this site (the camera icon in the address bar), then try again.';
  if (name === 'NotFoundError') return 'No camera found.';
  if (name === 'NotReadableError') return 'The camera is busy - close other apps or tabs using it, then try again.';
  const msg = e?.message || '';
  if (/fetch|network|import|load/i.test(msg)) return 'Could not load face tracking. Check your internet connection and try again.';
  return msg || 'Something went wrong starting face tracking.';
}

const CSS = `
#face-overlay{position:fixed;inset:0;z-index:50;display:flex;align-items:center;justify-content:center;background:rgba(6,8,12,.86);font:700 16px/1.5 ui-monospace,Menlo,Consolas,monospace;color:#38251d}
#face-overlay[hidden]{display:none}
#face-overlay .card{width:min(520px,92vw);background:#f5d0aa;border:1px solid #b87d50;border-radius:14px;padding:24px 26px}
#face-overlay h2{margin:0 0 8px;font-size:22px}
#face-overlay p{margin:8px 0}
#face-overlay .row{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
#face-overlay button,#face-chip button{font:inherit;color:#38251d;background:#e9b787;border:1px solid #a77550;border-radius:8px;padding:8px 14px;cursor:pointer}
#face-overlay button:hover,#face-overlay button:focus-visible,#face-chip button:hover,#face-chip button:focus-visible{border-color:#925125;outline:none}
#face-overlay .primary{background:#e6a363;border-color:#925125}
#face-overlay .warn{color:#843b12}
#face-overlay .big{font-size:44px;font-weight:700;margin:10px 0;line-height:1.1}
#face-overlay .tiny{font-size:12px;font-weight:400;opacity:.8;margin-top:16px}
#face-warn{position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:60;max-width:92vw;background:#3a2a05;border:1px solid #ffd166;color:#ffe9b0;border-radius:10px;padding:8px 14px;font:14px ui-monospace,Menlo,Consolas,monospace}
#face-warn[hidden]{display:none}
#face-toast{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:55;background:rgba(22,26,36,.94);border:1px solid #4a7bff;color:#f4f5f8;border-radius:10px;padding:8px 16px;font:15px ui-monospace,Menlo,Consolas,monospace;pointer-events:none}
#face-toast.warn{border-color:#ffd166;color:#ffe9b0}
#face-toast[hidden]{display:none}
#face-chip{position:fixed;left:12px;bottom:12px;z-index:40;display:flex;gap:8px;align-items:center;background:#f5d0aa;border:1px solid #b87d50;border-radius:999px;padding:6px 10px;font:13px ui-monospace,Menlo,Consolas,monospace;color:#51392a}
#face-chip button{padding:3px 10px;font-size:13px;border-radius:999px}
`;

// Calibration pace: every step counts down 10 seconds before it measures, then asks you to hold for 3.
// A slow head tilt to the RIGHT skips the current step (small hint on every page).
export const SKIP_HOLD_MS = 1000;     // the tilt must be held this long: a twitch or a stretch never skips
export const SKIP_HINT = 'Tip: tilt your head slowly to the right to skip this step.';

export function initFaceOverlay({ control, player, autoCloseMs = 2200, countdownMs = 10000, holdMs = 3000, comfortMs = 10000, comfortReturningMs = 3000, now = () => Date.now() }) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);

  const overlay = document.createElement('div');
  overlay.id = 'face-overlay'; overlay.setAttribute('role', 'dialog'); overlay.setAttribute('aria-live', 'polite'); overlay.hidden = true;
  const warnBar = document.createElement('div'); warnBar.id = 'face-warn'; warnBar.setAttribute('role', 'status'); warnBar.hidden = true;
  const chip = document.createElement('div'); chip.id = 'face-chip';
  const toast = document.createElement('div'); toast.id = 'face-toast'; toast.hidden = true; toast.setAttribute('role', 'status');
  document.body.append(overlay, warnBar, chip, toast);
  let toastTimer = null;
  function flash(text, warn = false) {
    toast.textContent = text; toast.classList.toggle('warn', warn); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, 1300);
  }

  let step = 'hidden';         // hidden | loading | calibrating | personal | try | done | error
  let closeTimer = null;
  let dismissed = false;       // the player skipped the walkthrough this session
  let personalToken = 0;       // bumps to cancel a running personal-calibration flow
  let personalWait = null;     // resolves when the person clicks Retry/Skip after a failed measurement
  let skipRequested = false;   // Skip pressed (button or head tilt) during a countdown/hold: skip just that step
  let comfortUntil = 0;        // the "get comfortable" page stays up until this time (10 s the first time)
  let comfortToken = 0;
  let shownAt = 0;            // when the current page appeared (a tilt right after it changes never counts)
  let armed = false;          // the head must come back to neutral once before a tilt can skip
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function show(html) { overlay.innerHTML = `<div class="card">${html}</div>`; overlay.hidden = false; shownAt = now(); armed = false; }
  const hide = () => { overlay.hidden = true; step = 'hidden'; clearTimeout(closeTimer); personalToken++; renderChip(); };

  function warningsHtml() {
    return control.warnings.length ? `<p class="warn" id="face-overlay-warn">${control.warnings.map((w) => w.text).join(' ')}</p>` : '';
  }

  const hintHtml = () => `<p class="tiny" id="face-skip-hint">${SKIP_HINT}</p>`;
  const setText = (sel, text) => { const el = overlay.querySelector(sel); if (el) el.textContent = text; };

  // Show "label N" once a second while `ms` runs out. Returns false if the flow was cancelled meanwhile.
  async function tick(ms, token, isCurrent, label) {
    const end = now() + ms;
    for (;;) {
      const left = end - now();
      if (left <= 0 || !isCurrent(token)) break;
      setText('#face-count', `${label} ${Math.ceil(left / 1000)}`);
      await sleep(Math.min(250, left));
    }
    return isCurrent(token);
  }

  // Measure one gesture (eyebrows or smile) from this person's own face, so the thresholds fit them.
  async function measureOne(kind, label, instruction, token) {
    skipRequested = false;
    const current = (t) => t === personalToken && !skipRequested;
    for (;;) {
      show(`<h2>${label}</h2><p>${instruction}</p><p class="big" id="face-count" aria-live="off">Get ready... ${Math.ceil(countdownMs / 1000)}</p>
        <div class="row"><button type="button" data-a="pskip">Skip this one</button></div>${hintHtml()}`);
      if (!await tick(countdownMs, token, current, 'Get ready...')) return null;      // cancelled, or skipped: on to the next step
      const measuring = control.measure(kind, holdMs, { shouldApply: () => current(token) });
      const holding = tick(holdMs, token, current, 'NOW - hold it!');
      const res = await measuring; await holding;
      if (token !== personalToken || skipRequested) return null;
      if (res.ok) {
        show(`<h2>${label}</h2><p>Got it. Your range: ${res.baseline.toFixed(2)} at rest, ${res.peak.toFixed(2)} at your best.</p>`);
        await sleep(1500);
        return res;
      }
      show(`<h2>${label}</h2><p class="warn">I couldn't see a clear difference from your resting face. Try a bigger movement, keep your face well lit and in view.</p>${warningsHtml()}
        <div class="row"><button type="button" class="primary" data-a="pretry">Try again</button><button type="button" data-a="pskip">Skip (use the default)</button></div>${hintHtml()}`);
      const choice = await new Promise((r) => { personalWait = r; });
      personalWait = null;
      if (token !== personalToken) return null;
      if (choice === 'skip') return null;
    }
  }

  async function runPersonal() {
    const token = ++personalToken;
    step = 'personal';
    await measureOne('brows', 'Your eyebrows', 'Raise your eyebrows <b>as high as you can</b> and hold them up. This sets your laser trigger.', token);
    if (token !== personalToken) return;
    await measureOne('smile', 'Your smile', 'Now <b>smile</b> - a normal, natural smile is fine - and hold it. This sets your punch trigger.', token);
    if (token !== personalToken) return;
    control.update({ personalDone: true });
    step = 'ready-try'; renderTry();
  }

  function renderTry() {
    step = 'try';
    show(`<h2>All set!</h2><p>Try it: <b>raise your eyebrows</b> (laser) or <b>smile</b> (punch).</p>
      <p>Tilt your head to walk, raise it to jump, lower it to block.</p>${warningsHtml()}
      <div class="row"><button type="button" class="primary" data-a="skip">Start playing</button></div>
      <p class="tiny" id="face-skip-hint">Tip: tilt your head slowly to the right to start playing.</p>`);
  }

  function render() {
    const st = control.status;
    if (dismissed && st !== 'error') { overlay.hidden = true; renderChip(); return; }
    if (st === 'loading') {
      step = 'loading';
      show(`<h2>Play with your face</h2><p>Loading face tracking... Allow the camera when your browser asks.</p>
        <p>First time takes a few seconds and needs internet.</p>
        <div class="row"><button type="button" data-a="keyboard">Play with the keyboard instead</button></div>`);
    } else if (st === 'calibrating' || (st === 'ready' && comfortUntil > now())) {
      // The first page: sit comfortably. Stays up for a full countdown (10 s the first time, shorter when the person
      // already calibrated before), even though the head baseline itself is taken in the first second.
      if (step !== 'comfort') {
        step = 'comfort';
        const ms = control.settings.personalDone ? comfortReturningMs : comfortMs;
        comfortUntil = now() + ms;
        const token = ++comfortToken;
        show(`<h2>Get comfortable</h2><p>Sit so your whole face is in view, look at the screen and relax your face.</p>
          <p class="big" id="face-count" aria-live="off">${Math.ceil(ms / 1000)}</p>${warningsHtml()}
          <div class="row"><button type="button" data-a="cskip">Skip this step</button><button type="button" data-a="keyboard">Use the keyboard</button></div>${hintHtml()}`);
        tick(ms, token, (t) => t === comfortToken && step === 'comfort', '').then(() => { if (token === comfortToken && step === 'comfort') { comfortUntil = 0; step = 'hidden'; render(); } });
      }
    } else if (st === 'ready' && step !== 'done') {
      if (!control.settings.personalDone && step !== 'personal') runPersonal();
      else if (control.settings.personalDone && step !== 'try' && step !== 'personal') renderTry();
    } else if (st === 'error') {
      step = 'error';
      show(`<h2>Face controls didn't start</h2><p class="warn">${cameraErrorText(control.error)}</p>
        <div class="row"><button type="button" class="primary" data-a="retry">Try again</button><button type="button" data-a="keyboard">Play with the keyboard</button></div>`);
    } else if (st === 'off') {
      overlay.hidden = true;
    }
    renderChip();
  }

  overlay.addEventListener('click', (e) => {
    const a = e.target?.dataset?.a;
    if (a === 'cskip') { comfortUntil = 0; comfortToken++; step = 'hidden'; render(); }
    else if (a === 'skip') { dismissed = true; hide(); }
    else if (a === 'keyboard') { control.stop(); dismissed = true; hide(); }
    else if (a === 'retry') { dismissed = false; control.start(); }
    else if (a === 'pretry') personalWait?.('retry');
    else if (a === 'pskip') {
      if (personalWait) personalWait('skip');
      else skipRequested = true;                    // during a countdown/hold: skip only this step, the next one follows
    }
  });

  function renderChip() {
    const on = control.status === 'ready' || control.status === 'calibrating' || control.status === 'loading';
    chip.innerHTML = on
      ? `<span>Face controls: ON</span><button type="button" data-a="recenter">Recenter</button><button type="button" data-a="recal">Recalibrate</button><button type="button" data-a="off">Use keyboard</button>`
      : `<span>Face controls: off</span><button type="button" data-a="on">Turn on</button>`;
  }
  chip.addEventListener('click', (e) => {
    const a = e.target?.dataset?.a;
    if (a === 'recenter') control.recenter();
    else if (a === 'recal') { dismissed = false; control.update({ personalDone: false }); step = 'hidden'; control.recenter(); render(); }
    else if (a === 'off') { control.stop(); }
    else if (a === 'on') { dismissed = false; step = 'hidden'; control.start(); }
  });

  // Show what the camera saw, so "nothing happened" is never a mystery: detected -> what it does -> why not (meter).
  bus.on('gesture', (g) => {
    if (g.player !== player || control.status !== 'ready' || step === 'personal') return;
    const act = control.settings.map[g.name];
    if (!act || act === 'none') return;
    let text = `${LABELS[g.name]} -> ${ACTION_LABELS[act] || act}`, warn = false;
    const f = globalThis.__match?.fighters?.[player];             // only the host has the match; the guest just shows the gesture
    if (act === 'special' && f && f.meter < f.maxMeter) { text += ` - not ready: meter ${Math.round((f.meter / f.maxMeter) * 100)}%`; warn = true; }
    flash(text, warn);
  });

  // Successful try-it: any gesture that is mapped to an action counts.
  bus.on('gesture', (g) => {
    if (g.player !== player || step !== 'try' || !actionFor(control.settings.map, g.name)) return;
    step = 'done';
    show(`<h2>Nice!</h2><p>That's it - go get the prizes.</p>`);
    closeTimer = setTimeout(hide, autoCloseMs);
  });

  // Skip with the head: a SLOW tilt to the right (held SKIP_HOLD_MS, after coming back to neutral once). Does the same as
  // the page's own skip button.
  let rightSince = 0;
  bus.on('head_state', (m) => {
    if (m.player !== player || overlay.hidden) return;
    const right = !!m.state?.right;
    const t = now();
    if (!right) { armed = t - shownAt > 800; rightSince = 0; setText('#face-skip-hint', step === 'try' ? 'Tip: tilt your head slowly to the right to start playing.' : SKIP_HINT); return; }
    if (!armed || t - shownAt < 1500) return;                    // just arrived on this page, or still tilted from before
    if (!rightSince) rightSince = t;
    setText('#face-skip-hint', 'Skipping... keep it there');
    if (t - rightSince >= SKIP_HOLD_MS) {
      rightSince = 0; armed = false;
      overlay.querySelector('[data-a="pskip"], [data-a="cskip"], [data-a="skip"]')?.click();
    }
  });

  bus.on('face_status', (s) => { if (s.player === player) { if (s.status !== 'ready') { personalToken++; if (step === 'personal' || step === 'try' || step === 'done') step = 'hidden'; } render(); } });
  bus.on('face_warnings', (w) => {
    if (w.player !== player) return;
    warnBar.hidden = !w.warnings.length || control.status === 'off';
    warnBar.textContent = w.warnings.map((x) => x.text).join(' ');
    if (!overlay.hidden && (step === 'calibrating' || step === 'try')) {
      const el = overlay.querySelector('#face-overlay-warn');
      if (el) el.textContent = w.warnings.map((x) => x.text).join(' ');
      else if (w.warnings.length) (step === 'try' ? renderTry : render)();
    }
  });

  render();
  return { render, hide };
}
