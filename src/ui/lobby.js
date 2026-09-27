// Start screen: three big choices (Player 1, Player 2, this laptop only). Works with the face, the keyboard and the mouse:
//   face:      tilt your head left/right to move the highlight, raise your eyebrows (or smile) to pick it
//   keyboard:  Left/Right (or Tab) to move, Enter/Space to pick
//   mouse:     click
// Picking reloads the page into the right role. Everyone shares one room for now (see lobbyConfig.js).
import { bus } from '../eventBus.js';
import { joinSearch, localSearch, OPTIONS, optionEnabled, moveFocus, initialFocus } from '../lobbyConfig.js';
import { KINDS } from '../face/personalCal.js';

const KEY = 'composure.lobby.v2';
// Face pace on this screen: slow and steady, nothing happens by accident.
export const LOBBY_PACE = {
  warmupMs: 3000,        // after the camera is ready, wait this long before any face input counts (time to read and settle)
  tiltDeg: 10,           // tilt (from your neutral) that counts on this screen: gentler than in the game, the hold is what keeps it safe
  tiltReleaseDeg: 5,     // back inside this and the tilt is over (so a wobble around the edge does not flicker on and off)
  moveHoldMs: 450,       // hold a tilt this long to move the highlight one step
  repeatMs: 900,         // keep the tilt going and it steps again every this long (reach the last card in one motion)
  gapToleranceMs: 200,   // tracking noise: a dropout shorter than this does not restart the hold
  settleMs: 1200,        // the highlight must have stayed put this long before a choice can start
  stillDeg: 6,           // ...and the head must have moved less than this over that time, or the measuring waits
  baselineMs: 1200,      // the resting position is measured over the LAST this-long of the warm-up (sit still then)
  browMargin: 0.15,      // to choose, eyebrows/smile must beat your own resting level by at least this much
  selfCorrect: 0.02,     // while your head is near neutral, the baseline follows slow shifts (sinking into the chair)
  selectHoldMs: 1200,    // eyebrows (or a smile) must be HELD this long to choose; a bar fills on the card meanwhile
};
// Pure helpers (unit tested).
export function median(xs) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((p, q) => p - q);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
export function baselineFrom(samples, t, windowMs) {
  const w = samples.filter((x) => t - x.t <= windowMs);
  return { roll: median(w.map((x) => x.roll)), brows: median(w.map((x) => x.brows)), smile: median(w.map((x) => x.smile)) };
}
// Slowly follow the head while it is near neutral (never during a deliberate tilt).
export function driftBaseline(baseRoll, roll, releaseDeg, k) {
  const rel = roll - baseRoll;
  return Math.abs(rel) < releaseDeg ? baseRoll + k * rel : baseRoll;
}
const CSS = `
#lobby .gauge{position:relative;height:14px;margin-top:10px;width:min(360px,100%);background:#fff0df;border:1px solid #b87d50;border-radius:8px}
#lobby .gauge i{position:absolute;top:0;bottom:0;width:2px;background:#b87d50;opacity:.6}
#lobby .gauge b{position:absolute;top:1px;width:12px;height:12px;margin-left:-6px;border-radius:50%;background:#925125;left:50%}
#lobby{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:#ffeaaa;color:#42271f;font:600 18px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:16px;overflow:auto}
#lobby .card{width:min(980px,100%)}
#lobby h1{margin:0 0 6px;font-size:34px;letter-spacing:.04em}
#lobby p{margin:8px 0;color:#604032}
#lobby .options{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:22px}
@media (max-width:760px){#lobby .options{grid-template-columns:1fr}}
#lobby .opt{font:inherit;color:#42271f;background:#fff0df;border:3px solid #b87d50;border-radius:18px;padding:30px 16px;min-height:170px;cursor:pointer;text-align:center}
#lobby .opt b{display:block;font-size:26px;margin-bottom:8px}
#lobby .opt small{display:block;color:#704b3e;font-size:16px}
#lobby .opt.p1{border-color:#2d5f9e}
#lobby .opt.p2{border-color:#9e2d3b}
#lobby .opt.focus{background:#f5d0aa;border-color:#925125;box-shadow:0 0 0 4px rgba(146,81,37,.22);transform:scale(1.03)}
#lobby .opt:disabled{opacity:.45;cursor:not-allowed}
#lobby .opt.taken small{color:#925125}
#lobby .help{margin-top:22px;padding:14px 18px;background:#fff0df;border:1px solid #b87d50;border-radius:12px}
#lobby .help b{color:#925125}
#lobby .status{margin-top:12px;min-height:1.5em}
#lobby .warn{color:#925125}
#lobby .row{margin-top:16px;display:flex;gap:12px;flex-wrap:wrap}
#lobby .link{font:inherit;color:#604032;background:none;border:1px solid #b87d50;border-radius:10px;padding:8px 14px;cursor:pointer}
#lobby .link:hover,#lobby .link:focus-visible{border-color:#925125;outline:none}
#lobby .sr{position:absolute;left:-9999px}
#lobby .opt{position:relative;overflow:hidden}
#lobby .opt .prog{position:absolute;left:0;bottom:0;height:10px;width:0;background:#c96a1b}
#lobby .tiny{font-size:13px;font-weight:400;opacity:.85}
`;

const LABELS = {
  p1: { title: "I'm Player 1", note: 'starts the match' },
  p2: { title: "I'm Player 2", note: 'joins Player 1' },
  local: { title: 'This laptop only', note: 'two players, one screen' },
};

function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; } }
function save(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (_) { /* private window: fine */ } }

export function initLobby({ pollMs = 2000, go = (search) => { location.search = search; }, faceControl = null, now = () => Date.now(), pace = {} } = {}) {
  const PACE = { ...LOBBY_PACE, ...pace };
  const style = document.createElement('style'); style.textContent = CSS; document.head.append(style);
  const el = document.createElement('div'); el.id = 'lobby';
  const remembered = load();
  el.innerHTML = `<div class="card" role="dialog" aria-label="Start">
    <h1>Composure</h1>
    <p>Play a friend online: one of you is Player 1, the other Player 2. Or play on this laptop.</p>
    <div class="options" role="listbox" aria-label="Who are you?">
      ${OPTIONS.map((id) => `<button type="button" class="opt ${id}" data-id="${id}" role="option"><b>${LABELS[id].title}</b><small data-note="${id}">${LABELS[id].note}</small><span class="prog" data-prog="${id}"></span></button>`).join('')}
    </div>
    <div class="help" id="lobby-help">
      <p><b>Face:</b> tilt your head left or right and hold it a moment to move the highlight (keep tilting to keep moving, let go to stop). To choose, <b>raise your eyebrows</b> or <b>smile</b> and hold it until the bar fills.</p>
      <p><b>Keyboard:</b> Left / Right to move, Enter to choose. <b>Mouse:</b> click.</p>
    </div>
    <p class="status" id="lobby-face" aria-live="polite"></p>
    <div class="gauge" id="lobby-gauge" aria-hidden="true" hidden><i style="left:${50 - 10 / 60 * 100}%"></i><i style="left:${50 + 10 / 60 * 100}%"></i><b id="lobby-dot"></b></div>
    <p class="sr" id="lobby-announce" aria-live="assertive"></p>
    <div class="row"><button type="button" class="link" id="lobby-facetoggle"></button></div>
  </div>`;
  document.body.append(el);
  const $ = (q) => el.querySelector(q);
  const btn = (id) => $(`.opt[data-id="${id}"]`);

  let status = null, relayPort = null, timer = null;
  let focus = initialFocus(remembered.player, null);
  let focusedAt = now();
  let prevDir = { left: false, right: false };
  let closed = false;
  let readyAt = 0;           // when the camera became ready (0 = not ready)
  let selectSince = 0;       // when the current eyebrow/smile hold began
  let baseReady = false;     // the resting position has been measured (face input counts from then on)
  let headTilted = false;    // any head tilt right now (a tilt shifts the face and could look like an eyebrow raise)

  function setFocus(i, announce = true) {
    if (i === focus && announce) return;
    focus = i; focusedAt = now();
    paint();
    btn(OPTIONS[focus]).focus({ preventScroll: true });        // keeps keyboard and face in step
    if (announce) $('#lobby-announce').textContent = `${LABELS[OPTIONS[focus]].title}. Raise your eyebrows or press Enter to choose.`;
  }

  // Progress bar on the highlighted card while a choice is being held.
  function setBar(kind, k) {
    if (kind !== 'select') return;
    OPTIONS.forEach((id, i) => { const b = $(`[data-prog="${id}"]`); if (b) b.style.width = i === focus ? `${Math.round(k * 100)}%` : '0'; });
  }

  function paint() {
    OPTIONS.forEach((id, i) => {
      const b = btn(id), enabled = optionEnabled(id, status);
      b.disabled = !enabled;
      b.classList.toggle('focus', i === focus);
      b.classList.toggle('taken', !enabled);
      b.setAttribute('aria-selected', String(i === focus));
      $(`[data-note="${id}"]`).textContent = enabled ? LABELS[id].note : 'already taken - the other seat is free';
    });
  }

  async function poll() {
    try {
      const res = await fetch(`/api/room/${encodeURIComponent(new URLSearchParams(location.search).get('room') || 'MAIN')}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      status = { host: !!data.host, guest: !!data.guest };
      // On plain http (local dev) the game looks for the relay on another port unless told; this server has it.
      relayPort = data.relay && location.protocol === 'http:' ? (location.port || 80) : null;
    } catch (_) { status = null; }                      // no status service: still playable
    if (!optionEnabled(OPTIONS[focus], status)) {            // the highlighted seat just got taken: step to a free one
      const right = moveFocus(focus, 1, status);
      focus = right !== focus ? right : moveFocus(focus, -1, status);
    }
    paint();
  }

  function choose(id) {
    if (closed || !optionEnabled(id, status)) return;
    closed = true;
    save({ player: id === 'p2' ? 2 : 1 });
    $('#lobby-announce').textContent = `${LABELS[id].title}. Starting...`;
    go(id === 'local' ? localSearch(location.search) : joinSearch(location.search, { player: id === 'p1' ? 1 : 2, relayPort }));
  }

  // ---- mouse and keyboard ----
  el.addEventListener('click', (e) => { const b = e.target.closest?.('.opt'); if (b && !b.disabled) choose(b.dataset.id); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); setFocus(moveFocus(focus, 1, status)); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); setFocus(moveFocus(focus, -1, status)); }
  });

  // ---- face ----
  const offs = [];
  function faceStatusText() {
    if (!faceControl) return 'Face controls are off. Use the keyboard or the mouse.';
    const w = faceControl.warnings?.[0]?.text;
    switch (faceControl.status) {
      case 'loading': return 'Starting face controls... allow the camera when asked.';
      case 'calibrating': return `Sit comfortably and look at the screen for a moment...${w ? ' ' + w : ''}`;
      case 'ready': {
        if (w) return w;
        const left = readyAt ? Math.ceil((PACE.warmupMs - (now() - readyAt)) / 1000) : 0;
        if (left <= 0 && readyAt && !baseReady) return 'Hold still... measuring your resting position';
        return left > 0 ? (left <= 1 ? 'Hold still... measuring your resting position' : `Face controls start in ${left}... (read the tips above, then sit comfortably)`) : 'Face controls are ready. Tilt and hold to move; hold your eyebrows up to choose.';
      }
      case 'error': return `Face controls did not start (${faceControl.error?.message || 'camera problem'}). You can still use the keyboard or the mouse.`;
      default: return 'Face controls are off. Use the keyboard or the mouse.';
    }
  }
  function paintFace() {
    const s = $('#lobby-face');
    s.textContent = faceStatusText();
    s.classList.toggle('warn', !!faceControl?.warnings?.length || faceControl?.status === 'error');
    const t = $('#lobby-facetoggle');
    t.hidden = !faceControl;
    t.textContent = faceControl && (faceControl.status === 'off') ? 'Turn face controls on' : 'Turn face controls off';
  }
  if (faceControl) {
    offs.push(bus.on('face_status', paintFace), bus.on('face_warnings', paintFace));
    // Nothing counts until the camera has been ready for a while (time to read this page and settle).
    const warmedUp = () => readyAt > 0 && now() - readyAt >= PACE.warmupMs;
    offs.push(bus.on('face_status', () => { readyAt = faceControl.status === 'ready' ? (readyAt || now()) : 0; }));
    if (faceControl.status === 'ready') readyAt = now();
    const warmTimer = setInterval(() => { if (!closed) paintFace(); }, 250);
    offs.push(() => clearInterval(warmTimer));

    // Head: hold a tilt for moveHoldMs to move one step; keep holding and it steps again every repeatMs (it stops at the ends).
    // Uses the head angle itself (not the gameplay left/right flags), with its own gentler threshold, and forgives short
    // tracking dropouts, so it does not need a big or perfectly steady tilt. Drift is off here: a held tilt must not fade away.
    faceControl.head.options.drift = 0;
    // Resting position, measured over the last part of the warm-up (not at page load, when you may still be settling in).
    const samples = [];
    let base = null;
    // Only taken once the head has been still for baselineMs (a tilt during the countdown just makes it wait a little longer).
    const ensureBase = (t) => {
      if (!base && warmedUp()) {
        const rolls = samples.filter((x) => t - x.t <= PACE.baselineMs && Number.isFinite(x.roll)).map((x) => x.roll);
        if (rolls.length >= 3 && Math.max(...rolls) - Math.min(...rolls) <= PACE.stillDeg) { base = baselineFrom(samples, t, PACE.baselineMs); baseReady = true; paintFace(); }
      }
      return base;
    };
    const dot = $('#lobby-dot'), gauge = $('#lobby-gauge');
    let dir = 0, since = 0, lastSeen = 0, lastStep = 0;
    offs.push(bus.on('head_state', (m) => {
      if (m.player !== 1 || faceControl.status !== 'ready') return;
      const st = m.state, raw = st?.values?.roll, t = now();
      if (raw == null) return;
      if (!base) { samples.push({ t, roll: raw, brows: NaN, smile: NaN }); if (samples.length > 400) samples.shift(); }
      const b = ensureBase(t);
      if (!b) return;
      const roll = raw - b.roll;
      b.roll = driftBaseline(b.roll, raw, PACE.tiltReleaseDeg, PACE.selfCorrect);
      gauge.hidden = false;
      dot.style.left = `${50 + Math.max(-30, Math.min(30, -roll)) / 60 * 100}%`;
      headTilted = Math.abs(roll) > PACE.tiltReleaseDeg || !!(st.up || st.down);
      // + roll = head tilted to the person's left. Once tilting, stay "on" until back inside the release angle.
      const onLeft = roll >= (dir === -1 ? PACE.tiltReleaseDeg : PACE.tiltDeg);
      const onRight = roll <= -(dir === 1 ? PACE.tiltReleaseDeg : PACE.tiltDeg);
      const now_ = onLeft ? -1 : onRight ? 1 : 0;
      if (now_ !== 0) {
        lastSeen = t;
        if (now_ !== dir) { dir = now_; since = t; lastStep = 0; }
      } else if (t - lastSeen > PACE.gapToleranceMs) { dir = 0; since = 0; lastStep = 0; }
      if (dir === 0) return;
      const due = lastStep === 0 ? t - since >= PACE.moveHoldMs : t - lastStep >= PACE.repeatMs;
      if (due) { lastStep = t; setFocus(moveFocus(focus, dir, status)); }
    }));

    // Choosing: eyebrows (or a smile) HELD for selectHoldMs, clearly above YOUR resting level, with the head still and the
    // highlight settled. A bar on the card fills while you hold; letting go resets it.
    offs.push(bus.on('face_values', (m) => {
      if (m.player !== 1 || faceControl.status !== 'ready' || closed) return;
      const t = now(), sc = m.scores;
      if (sc && !base) { samples.push({ t, roll: NaN, brows: KINDS.brows(sc), smile: KINDS.smile(sc) }); if (samples.length > 400) samples.shift(); }
      const b = ensureBase(t);
      if (!b) { selectSince = 0; setBar('select', 0); return; }
      const s = faceControl.settings;
      // (the resting level is capped below the threshold, so a raise during the countdown can never lock you out)
    const active = !!sc && !headTilted && (KINDS.brows(sc) > Math.max(s.browsUp, Math.min(b.brows, 0.75 * s.browsUp) + PACE.browMargin) || KINDS.smile(sc) > Math.max(s.smileUp, Math.min(b.smile, 0.75 * s.smileUp) + PACE.browMargin));
      if (!active || t - focusedAt < PACE.settleMs) { selectSince = 0; setBar('select', 0); return; }
      if (!selectSince) selectSince = t;
      const k = Math.min(1, (t - selectSince) / PACE.selectHoldMs);
      setBar('select', k);
      if (k >= 1) { selectSince = 0; choose(OPTIONS[focus]); }
    }));
    $('#lobby-facetoggle').addEventListener('click', () => { if (faceControl.status === 'off') faceControl.start(); else faceControl.stop(); });
    if (faceControl.settings.enabled) faceControl.start();
  }
  paintFace();

  paint(); poll();
  btn(OPTIONS[focus]).focus({ preventScroll: true });
  timer = setInterval(poll, pollMs);
  return {
    stop() { closed = true; clearInterval(timer); offs.forEach((off) => off()); el.remove(); style.remove(); },
    get focusId() { return OPTIONS[focus]; },
  };
}
