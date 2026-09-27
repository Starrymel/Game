// Owner: D
// Listens to the event bus and ships everything to the backend in ~500 ms batches.
// Side-effect module: `import './logging/logger.js';` at the TOP of main.js is all the game needs.
// Never throws and never waits on the network, so a dead backend can't affect gameplay.
import { bus } from '../eventBus.js';

const ENDPOINT = '/api/log/batch';
const FLUSH_MS = 500;
const SAMPLE_MS = 500;          // biometric_sample fires ~10/s per player; store 2/s
const BIG_HIT_DAMAGE = 15;      // hits at/above this (or any special) also log a 'big_hit'
const HEAL_STREAK_MS = 3000;    // continuous healing this long logs a 'heal_streak'
const HEAL_GAP_MS = 400;        // a pause longer than this breaks the streak
const MAX_FAILS = 5;            // stop sending after this many consecutive failures (until one succeeds)

let m = null;                   // current match (one per round)
let fails = 0;

const round1 = (v) => Math.round(v * 10) / 10;

function startMatch(t) {
  if (m && !m.ended) endMatch(null, t);           // e.g. player pressed R mid-round
  closeAnalysis();
  m = {
    id: 'm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    t0: t, ended: false, sentMeta: false,
    buf: { samples: [], events: [], snapshots: [] },
    lastSample: { 1: 0, 2: 0 },
    heal: { 1: { start: null, last: null, fired: false }, 2: { start: null, last: null, fired: false } },
  };
}

const rel = (t) => Math.max(0, Math.round(t - m.t0));
const ev = (t, type, player, payload = {}) => m && m.buf.events.push({ t: rel(t), type, player, payload });

function flush(end) {
  if (!m) return;
  const { samples, events, snapshots } = m.buf;
  if (!samples.length && !events.length && !snapshots.length && !end) return;
  m.buf = { samples: [], events: [], snapshots: [] };
  if (fails >= MAX_FAILS && !end) return;
  const body = JSON.stringify({
    match_id: m.id,
    started_at: new Date(m.t0).toISOString(),
    meta: { p1_name: 'Player 1', p2_name: 'Player 2' },
    samples, events, snapshots, end,
  });
  try {
    fetch(ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, keepalive: true })
      .then((r) => { fails = r.ok ? 0 : fails + 1; })
      .catch(() => { fails++; });
  } catch (_) { fails++; }
}

function endMatch(winner, t) {
  if (!m || m.ended) return;
  m.ended = true;
  flush({ winner: winner ?? null, duration_ms: rel(t) });
}

// ---- bus subscriptions
bus.on('round_start', ({ t }) => startMatch(t));

bus.on('biometric_sample', (s) => {
  if (!m || m.ended || (s.player !== 1 && s.player !== 2)) return;
  const now = s.t || Date.now();
  if (now - m.lastSample[s.player] < SAMPLE_MS) return;
  m.lastSample[s.player] = now;
  m.buf.samples.push({ t: rel(now), player: s.player, hr: s.hr, breath: s.breath, stress: s.stress, calm: s.calm, source: s.source });
});

bus.on('state_snapshot', (s) => {
  if (!m || m.ended) return;
  const [a, b] = s.players;
  m.lastSnap = { p1_hp: round1(a.hp), p2_hp: round1(b.hp), p1_meter: round1(a.meter), p2_meter: round1(b.meter) };
  m.buf.snapshots.push({ t: rel(s.t), ...m.lastSnap });
});

bus.on('hit', ({ attacker, defender, damage, kind, t }) => {
  if (!m || m.ended) return;
  ev(t, 'hit', defender, { attacker, damage: round1(damage), kind });
  if (kind === 'special' || damage >= BIG_HIT_DAMAGE) ev(t, 'big_hit', defender, { attacker, damage: round1(damage), kind });
});
bus.on('flinch', ({ player, magnitude, t }) => m && !m.ended && ev(t, 'flinch', player, { magnitude: round1(magnitude * 100) / 100 }));
bus.on('special', ({ player, t }) => m && !m.ended && ev(t, 'special', player));
bus.on('meter_full', ({ player, t }) => m && !m.ended && ev(t, 'meter_full', player));
bus.on('ko', ({ winner, loser, t }) => {
  if (!m || m.ended) return;
  ev(t, 'ko', loser, { winner });
  // The last 250 ms snapshot predates the killing blow, so add one final point with the loser at 0 HP.
  const last = m.lastSnap || { p1_hp: 100, p2_hp: 100, p1_meter: 0, p2_meter: 0 };
  m.buf.snapshots.push({ ...last, t: rel(t), [`p${loser}_hp`]: 0 });
});

// heal_tick fires every physics step, so we don't log each one; we log one 'heal_streak' per sustained run.
bus.on('heal_tick', ({ player, t }) => {
  if (!m || m.ended) return;
  const h = m.heal[player];
  if (h.last !== null && t - h.last > HEAL_GAP_MS) { h.start = null; h.fired = false; }
  if (h.start === null) h.start = t;
  h.last = t;
  if (!h.fired && t - h.start >= HEAL_STREAK_MS) { h.fired = true; ev(t, 'heal_streak', player, { seconds: HEAL_STREAK_MS / 1000 }); }
});

bus.on('round_end', ({ winner, t }) => {
  if (!m || m.ended) return;
  endMatch(winner, t);
  showAnalysisButton(m.id);
});

setInterval(() => flush(), FLUSH_MS);
window.addEventListener('pagehide', () => { if (m && !m.ended) endMatch(null, Date.now()); });

// ---- "Match analysis" button + overlay (self-contained; touches no game files)
let uiEls = [];
function closeAnalysis() { uiEls.forEach((e) => e.remove()); uiEls = []; if (closeOverlay) closeOverlay(); }

function showAnalysisButton(id) {
  closeAnalysis();
  const btn = document.createElement('button');
  btn.textContent = 'View round recap';
  btn.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;padding:12px 22px;font:600 16px system-ui,sans-serif;border:0;border-radius:10px;background:#a92e64;color:#fff;cursor:pointer;box-shadow:0 4px 18px rgba(0,0,0,.4)';
  btn.onclick = () => openOverlay(id);
  document.body.appendChild(btn);
  uiEls.push(btn);
}

let closeOverlay = null;
// The recap page asks us to close when Esc is pressed inside its iframe (the game can't see those keys).
window.addEventListener('message', (e) => {
  if (e.origin === location.origin && e.data && e.data.composure === 'close' && closeOverlay) closeOverlay();
});

function openOverlay(id) {
  if (closeOverlay) closeOverlay();
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:fixed;inset:0;z-index:60;background:rgba(0,0,0,.72);display:flex;align-items:center;justify-content:center;padding:2vh 2vw';
  const frame = document.createElement('iframe');
  frame.src = `/dashboard/recap.html?match=${encodeURIComponent(id)}`;
  frame.title = 'Round recap';
  frame.style.cssText = 'width:min(780px,100%);height:min(600px,100%);border:1px solid #ba8095;border-radius:14px;background:#fce0e9;box-shadow:0 10px 40px rgba(0,0,0,.6)';
  const x = document.createElement('button');
  x.textContent = '\u2715';
  x.setAttribute('aria-label', 'Close recap');
  x.style.cssText = 'position:absolute;top:14px;right:22px;z-index:61;width:38px;height:38px;border:0;border-radius:19px;background:#fff;color:#000;font-size:18px;cursor:pointer';
  const onKey = (e) => { if (e.key === 'Escape') closeOverlay(); };
  closeOverlay = () => { wrap.remove(); document.removeEventListener('keydown', onKey); closeOverlay = null; };
  x.onclick = () => closeOverlay();
  wrap.addEventListener('click', (e) => { if (e.target === wrap) closeOverlay(); });   // click the dark backdrop to close
  document.addEventListener('keydown', onKey);
  wrap.append(frame, x);
  document.body.appendChild(wrap);
  frame.focus();
}
