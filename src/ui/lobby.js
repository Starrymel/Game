// Start screen: three big choices (Player 1, Player 2, this laptop only). Works with the face, the keyboard and the mouse:
//   face:      SMILE = Player 1, RAISE EYEBROWS = Player 2 (hold it until the bar fills)
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
  selectHoldMs: 1000,    // eyebrows (or a smile) must be HELD this long to choose; a bar fills on the card meanwhile
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
#lobby .opt{font:inherit;color:#42271f;background:#fff0df;border:3px solid #b87d50;border-radius:18px;padding:30px 16px;min-height:250px;cursor:pointer;text-align:center}
#lobby .opt b{display:block;font-size:26px;margin-bottom:8px}
#lobby .opt small{display:block;color:#704b3e;font-size:16px}
#lobby .opt.p1{border-color:#2d5f9e}
#lobby .opt.p2{border-color:#9e2d3b}
#lobby .opt.focus{background:#f5d0aa;border-color:#925125;box-shadow:0 0 0 4px rgba(146,81,37,.22);transform:scale(1.03)}
#lobby .opt:disabled{opacity:.45;cursor:not-allowed}
#lobby .opt.taken small{color:#925125}
#lobby .help{margin-top:22px;padding:14px 18px;background:#fff0df;border:1px solid #b87d50;border-radius:12px}
#lobby .help b{color:#925125}
#lobby .warn{color:#925125}
#lobby .row{margin-top:16px;display:flex;gap:12px;flex-wrap:wrap}
#lobby .link{font:inherit;color:#604032;background:none;border:1px solid #b87d50;border-radius:10px;padding:8px 14px;cursor:pointer}
#lobby .link:hover,#lobby .link:focus-visible{border-color:#925125;outline:none}
#lobby .sr{position:absolute;left:-9999px}
#lobby .opt{position:relative;overflow:hidden}
#lobby .opt > *:not(.prog){position:relative}
#lobby .opt .prog{position:absolute;left:0;top:0;bottom:0;width:0;background:rgba(201,106,27,.38);box-shadow:inset -4px 0 0 #c96a1b}
#lobby .opt .ico{display:block;margin:0 auto 6px}
#lobby .opt .gest{display:block;font-size:26px;font-weight:800;color:#42271f;margin:2px 0 6px}
#lobby .opt small{color:#42271f;font-size:16px}
#lobby .cam{display:inline-flex;align-items:center;gap:6px;margin-left:14px;font-size:15px}
#lobby .cam i{width:12px;height:12px;border-radius:50%;background:#a99;border:2px solid #42271f}
#lobby .cam.on i{background:#3f9a3f}
#lobby .count{display:inline-block;min-width:1.2em;text-align:center;font-size:52px;line-height:1;color:#925125;vertical-align:-6px}
#lobby .lead{margin:2px 0 10px;font-size:18px}
#lobby .status{margin:0 0 14px;min-height:1.4em;padding:12px 18px;font-size:28px;line-height:1.25;font-weight:800;background:#fff0df;border:3px dashed #b87d50;border-radius:14px;color:#42271f}
#lobby .status.live{background:#f5d0aa;border:3px solid #925125}
#lobby .options.locked .opt{opacity:.5;filter:saturate(.6)}
#lobby .options.live .opt:not(:disabled){animation:lobbyglow 1.8s ease-in-out infinite}
@keyframes lobbyglow{0%,100%{box-shadow:0 0 0 0 rgba(146,81,37,0)}50%{box-shadow:0 0 0 6px rgba(146,81,37,.25)}}
@media (prefers-reduced-motion:reduce){#lobby .options.live .opt{animation:none}}
#lobby .tiny{font-size:15px;font-weight:600;opacity:1;color:#604032;margin-top:14px}
`;

const LABELS = {
  p1: { title: "I'm Player 1", gest: 'Smile', note: 'starts the match' },
  p2: { title: "I'm Player 2", gest: 'Raise eyebrows', note: 'joins Player 1' },
  local: { title: 'This laptop only', gest: 'Click or Enter', note: 'two players, one screen' },
};
// Hand-drawn icons in the page's own colours (thick brown outline, warm fill), so they read from across a desk.
const INK = '#42271f', SKIN = '#ffd9a0';
const svg = (inner) => `<svg class="ico" viewBox="0 0 100 100" width="84" height="84" aria-hidden="true" focusable="false" fill="none" stroke="${INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
const face = `<circle cx="50" cy="52" r="38" fill="${SKIN}"/>`;
export const ICONS = {
  p1: svg(`${face}<circle cx="37" cy="44" r="4.5" fill="${INK}" stroke="none"/><circle cx="63" cy="44" r="4.5" fill="${INK}" stroke="none"/><path d="M27 60 Q50 88 73 60" stroke-width="6"/><path d="M24 55 L29 58 M76 55 L71 58" stroke-width="3.5"/>`),
  p2: svg(`${face}<path d="M24 30 Q35 12 47 26" stroke-width="6"/><path d="M53 26 Q65 12 76 30" stroke-width="6"/><circle cx="37" cy="48" r="4.5" fill="${INK}" stroke="none"/><circle cx="63" cy="48" r="4.5" fill="${INK}" stroke="none"/><path d="M41 72 H59"/>`),
  local: svg(`<rect x="16" y="24" width="68" height="46" rx="6" fill="${SKIN}"/><path d="M8 78 H92"/><circle cx="37" cy="39" r="6"/><circle cx="63" cy="39" r="6"/><path d="M27 62 Q37 48 47 62 M53 62 Q63 48 73 62" stroke-width="4"/>`),
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
    <p class="lead">Play a friend online, or on this laptop. <span class="cam" id="lobby-cam" hidden><i></i><span></span></span></p>
    <p class="status" id="lobby-face" aria-live="polite"></p>
    <div class="options" id="lobby-options" role="listbox" aria-label="Who are you?">
      ${OPTIONS.map((id) => `<button type="button" class="opt ${id}" data-id="${id}" role="option"><span class="prog" data-prog="${id}"></span>${ICONS[id]}<b>${LABELS[id].title}</b><span class="gest">${LABELS[id].gest}</span><small data-note="${id}">${LABELS[id].note}</small></button>`).join('')}
    </div>
    <p class="tiny" id="lobby-help">Face: hold the gesture until the card fills. Keyboard: Left / Right, then Enter. Mouse: click.</p>
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
  let lastFace = 0;          // last time the camera reported a face
  let baseReady = false;     // the resting position has been measured (face input counts from then on)

  function setFocus(i, announce = true) {
    if (i === focus && announce) return;
    focus = i; focusedAt = now();
    paint();
    btn(OPTIONS[focus]).focus({ preventScroll: true });        // keeps keyboard and face in step
    if (announce) $('#lobby-announce').textContent = `${LABELS[OPTIONS[focus]].title}. Press Enter to choose.`;
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
      case 'loading': return 'Starting the camera... allow it when asked.';
      case 'calibrating': return `Sit comfortably and look at the screen...${w ? ' ' + w : ''}`;
      case 'ready': {
        if (w) return w;
        const left = readyAt ? Math.ceil((PACE.warmupMs - (now() - readyAt)) / 1000) : 0;
        if (left <= 0 && !baseReady) return 'Relax your face... almost there';
        return left > 0 ? (left <= 1 ? 'Relax your face... almost there' : `Starting in ${left}... sit comfortably, relaxed face`) : 'Go! Smile = Player 1 · Raise eyebrows = Player 2';
      }
      case 'error': return `Face controls did not start (${faceControl.error?.message || 'camera problem'}). You can still use the keyboard or the mouse.`;
      default: return 'Face controls are off. Use the keyboard or the mouse.';
    }
  }
  function paintFace() {
    const s = $('#lobby-face');
    const txt = faceStatusText();
    const cd = /^Starting in (\d+)\.\.\. (.*)$/.exec(txt);
    if (cd) { s.textContent = ''; s.append('Starting in '); const n = document.createElement('span'); n.className = 'count'; n.textContent = cd[1]; s.append(n, `... ${cd[2]}`); }
    else s.textContent = txt;
    const cam = $('#lobby-cam');
    cam.hidden = !faceControl || !['calibrating', 'ready'].includes(faceControl.status);
    const seen = now() - lastFace < 1000;
    cam.classList.toggle('on', seen); cam.lastChild.textContent = seen ? 'camera sees you' : 'camera cannot see you - face the screen';
    s.classList.toggle('warn', !!faceControl?.warnings?.length || faceControl?.status === 'error');
    const live = !!faceControl && faceControl.status === 'ready' && baseReady && !faceControl.warnings?.length;
    const locked = !!faceControl && ['loading', 'calibrating', 'ready'].includes(faceControl.status) && !live;
    s.classList.toggle('live', live);
    const opts = $('#lobby-options'); opts.classList.toggle('live', live); opts.classList.toggle('locked', locked);
    const t = $('#lobby-facetoggle');
    t.hidden = !faceControl;
    t.textContent = faceControl && (faceControl.status === 'off') ? 'Turn face controls on' : 'Turn face controls off';
  }
  if (faceControl) {
    offs.push(bus.on('face_status', paintFace), bus.on('face_warnings', paintFace));
    offs.push(bus.on('face_values', (m) => { if (m.player === 1 && m.scores) lastFace = now(); }));
    // Nothing counts until the camera has been ready for a while (time to read this page and settle).
    const warmedUp = () => readyAt > 0 && now() - readyAt >= PACE.warmupMs;
    offs.push(bus.on('face_status', () => { readyAt = faceControl.status === 'ready' ? (readyAt || now()) : 0; }));
    if (faceControl.status === 'ready') readyAt = now();
    const warmTimer = setInterval(() => { if (!closed) paintFace(); }, 250);
    offs.push(() => clearInterval(warmTimer));

    // Head: hold a tilt for moveHoldMs to move one step; keep holding and it steps again every repeatMs (it stops at the ends).
    // Uses the head angle itself (not the gameplay left/right flags), with its own gentler threshold, and forgives short
    // tracking dropouts, so it does not need a big or perfectly steady tilt. Drift is off here: a held tilt must not fade away.
    // One gesture per seat, no head movement needed: SMILE = Player 1, RAISE EYEBROWS = Player 2. Hold it until the bar fills.
    // The resting level of each is measured during the last part of the warm-up, so a resting face never chooses by itself,
    // and the gesture must clearly beat both the calibrated threshold and your own resting level.
    const samples = [];
    let base = null, holdKind = null;
    const ensureBase = (t) => {
      if (!base && warmedUp()) { base = baselineFrom(samples, t, PACE.baselineMs); baseReady = true; paintFace(); }
      return base;
    };
    offs.push(bus.on('face_values', (m) => {
      if (m.player !== 1 || faceControl.status !== 'ready' || closed) return;
      const t = now(), sc = m.scores;
      if (sc && !base) { samples.push({ t, roll: NaN, brows: KINDS.brows(sc), smile: KINDS.smile(sc) }); if (samples.length > 400) samples.shift(); }
      const b = ensureBase(t);
      const reset = () => { selectSince = 0; holdKind = null; setBar('select', 0); };
      if (!b || !sc) return reset();
      const s = faceControl.settings;
      // how far above the needed level each gesture is (negative = not doing it); the stronger one wins
      const smileX = KINDS.smile(sc) - Math.max(s.smileUp, Math.min(b.smile, 0.75 * s.smileUp) + PACE.browMargin);
      const browsX = KINDS.brows(sc) - Math.max(s.browsUp, Math.min(b.brows, 0.75 * s.browsUp) + PACE.browMargin);
      const kind = smileX > 0 && smileX >= browsX ? 'smile' : browsX > 0 ? 'brows' : null;
      if (!kind) return reset();
      const id = kind === 'smile' ? 'p1' : 'p2';
      if (!optionEnabled(id, status)) { reset(); return; }          // that seat is taken: nothing to choose
      if (kind !== holdKind) { holdKind = kind; selectSince = t; setFocus(OPTIONS.indexOf(id)); }
      const k = Math.min(1, (t - selectSince) / PACE.selectHoldMs);
      setBar('select', k);
      if (k >= 1) { selectSince = 0; holdKind = null; choose(id); }
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
