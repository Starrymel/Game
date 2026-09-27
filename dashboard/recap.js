// Owner: D. Compact recap: loads one match from /api/matches/:id and draws the short, game-style summary.
'use strict';

const $ = (id) => document.getElementById(id);
const matchId = new URLSearchParams(location.search).get('match');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mmss = (ms) => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (v) => (v == null || Number.isNaN(v) ? '–' : String(Math.round(v)));

// Esc inside this iframe can't reach the game page's key handler, so ask the parent to close the overlay.
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && window.parent !== window) window.parent.postMessage({ composure: 'close' }, location.origin);
});

function say(text) { const m = $('msg'); m.textContent = text; m.hidden = false; $('recap').hidden = true; }

async function fetchMatch() {
  // The final batch may still be on its way to the database when the overlay opens, so retry a few times.
  for (let i = 0; i < 8; i++) {
    try {
      const r = await fetch('/api/matches/' + encodeURIComponent(matchId));
      if (r.ok) return await r.json();
      if (r.status !== 404 && r.status !== 503) return null;
    } catch (_) { /* network blip: retry */ }
    await sleep(800);
  }
  return null;
}

// ---- The recap: pictures and short sentences, no graphs. Everything is worked out from the match data. ----
const ICON = {
  fist: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M14 30c0-6 4-10 9-10h20c6 0 9 4 9 10v8c0 8-6 14-14 14h-6c-8 0-18-4-18-14z" fill="#ffd9a0"/><path d="M24 22v10M33 21v11M42 22v10" stroke-width="3.5"/><path d="M14 30v8" /></svg>',
  laser: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M4 32c8-12 20-16 28-16s20 4 28 16c-8 12-20 16-28 16S12 44 4 32z" fill="#fff"/><circle cx="32" cy="32" r="9" fill="#ffd9a0"/><circle cx="32" cy="32" r="3.5" fill="#42271f" stroke="none"/><path d="M50 32h12M48 24l11-6M48 40l11 6" stroke="#c42c43" stroke-width="4"/></svg>',
  sword: '<img src="/assets/hazards/sword1.png" alt="" width="52" height="52">',
  prize: '<img src="/assets/prizes/prize1.png" alt="" width="52" height="52">',
  spark: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 6l6 18 18 8-18 8-6 18-6-18-18-8 18-8z" fill="#ffd9a0"/></svg>',
  heart: '<svg viewBox="0 0 64 64" aria-hidden="true"><path d="M32 54C10 38 6 24 14 16c6-6 14-3 18 3 4-6 12-9 18-3 8 8 4 22-18 38z" fill="#f28ea0"/><path d="M14 34h10l4-8 6 14 4-6h12" stroke-width="3"/></svg>',
};

function analyse(d) {
  const names = [d.match.p1_name || 'Player 1', d.match.p2_name || 'Player 2'];
  const T = Math.max(d.match.duration_ms || 0, ...d.snapshots.map((s) => s.t), ...d.samples.map((s) => s.t), 1000);
  const ko = d.events.find((e) => e.type === 'ko');
  const winner = d.match.winner || (ko && ko.payload && ko.payload.winner) || null;
  const last = d.snapshots.length ? d.snapshots[d.snapshots.length - 1] : null;
  const bio = [1, 2].map((p) => {
    const hr = d.samples.filter((s) => s.player === p && s.hr != null);
    const peak = hr.length ? hr.reduce((a, b) => (b.hr > a.hr ? b : a)) : null;
    return { peakHr: peak ? peak.hr : null, peakAt: peak ? peak.t : null };
  });
  const hits = d.events.filter((e) => e.type === 'hit');
  const biggest = hits.length ? hits.reduce((a, b) => ((+b.payload.damage || 0) > (+a.payload.damage || 0) ? b : a)) : null;
  const live = d.samples.some((s) => s.source === 'presage');
  const fx = (d.stats && d.stats.players) || null;
  return { names, T, winner, ko, last, bio, biggest, live, fx };
}

const pips = (landed, thrown, p) => {
  const n = Math.min(thrown == null ? landed : thrown, 12);
  if (!n) return '<span class="none">-</span>';
  return Array.from({ length: n }, (_, i) => `<i class="${i < Math.min(landed, n) ? 'on' : ''}" style="--c:var(--p${p})"></i>`).join('') + (thrown > 12 ? '<em>+</em>' : '');
};
const who = (p) => `<i class="dot" style="background:var(--p${p})"></i>`;

function card({ icon, title, rows, more }) {
  return `<button type="button" class="card" aria-expanded="false"><span class="head"><span class="ico">${icon}</span><b>${title}</b></span>${rows.map((r) => `<span class="line">${r}</span>`).join('')}<span class="more">${more || ''}</span></button>`;
}

function render(d) {
  const a = analyse(d);
  const [n1, n2] = a.names;
  const W = a.winner;

  // Headline: the two fighters, the winner in colour with a crown, the other one greyed out.
  const art = (p, file) => `<figure class="fighter ${W ? (W === p ? 'won' : 'lost') : ''}" style="--c:var(--p${p})"><img src="/assets/characters/${file}" alt="${esc(a.names[p - 1])}">${W === p ? '<span class="crown" aria-hidden="true">&#128081;</span>' : ''}<figcaption>${esc(a.names[p - 1])}</figcaption></figure>`;
  $('banner').innerHTML = `${art(1, 'dog.png')}<div class="mid"><h1>${W ? esc(a.names[W - 1]) + ' wins!' : 'A draw!'}</h1><p>${mmss(a.T)} round<span class="tag">${a.live ? 'live heart rate' : 'simulated heart rate'}</span></p></div>${art(2, 'bunny.png')}`;

  // Health left at the end: two fat bars.
  const hp = (p) => { const v = a.last ? Math.max(0, Math.round(a.last['p' + p + '_hp'])) : null; return `<div class="hp"><span>${who(p)}${esc(a.names[p - 1])}</span><div class="bar"><div style="width:${v == null ? 0 : v}%;background:var(--p${p})"></div></div><b>${v == null ? '-' : v}</b></div>`; };
  $('hpbars').innerHTML = hp(1) + hp(2);

  const f = a.fx;
  const cards = [];
  if (f) {
    const L = (o) => (o.thrown == null ? `${o.landed} hit` : o.thrown ? `${o.landed}/${o.thrown}` : '');
    cards.push(card({ icon: ICON.fist, title: 'Punches', rows: [1, 2].map((p) => `${who(p)}<span class="pips">${pips(f[p].punches.landed, f[p].punches.thrown, p)}</span><small>${L(f[p].punches)}</small>`), more: `Damage dealt: ${f[1].damageDealt} vs ${f[2].damageDealt}` }));
    cards.push(card({ icon: ICON.laser, title: 'Eye lasers', rows: [1, 2].map((p) => `${who(p)}<span class="pips">${pips(f[p].lasers.landed, f[p].lasers.thrown, p)}</span><small>${L(f[p].lasers)}</small>`), more: a.biggest ? `Biggest hit: ${fmt(a.biggest.payload.damage)} damage on ${esc(a.names[a.biggest.player - 1])} at ${mmss(a.biggest.t)}` : '' }));
    cards.push(card({ icon: ICON.sword, title: 'Falling swords', rows: [1, 2].map((p) => `${who(p)}<b class="big">${f[p].swordsDodged}</b><small>dodged</small><b class="big bad">${f[p].swordsHit}</b><small>hit</small>`), more: `Sword damage: ${f[1].swordDamage} vs ${f[2].swordDamage}` }));
    cards.push(card({ icon: ICON.prize, title: 'Prizes', rows: [1, 2].map((p) => `${who(p)}<b class="big">${f[p].prizesCaught}</b><small>caught${f[p].prizeHealed ? ` (+${f[p].prizeHealed} HP)` : ''}</small>`), more: a.fx && d.stats.prizesMissed ? `${d.stats.prizesMissed} prize${d.stats.prizesMissed > 1 ? 's' : ''} nobody grabbed` : '' }));
    cards.push(card({ icon: ICON.spark, title: 'Damage', rows: [1, 2].map((p) => `${who(p)}<small>dealt</small><b class="big">${f[p].damageDealt}</b><small>took</small><b class="big bad">${f[p].damageTaken}</b>`), more: `Blocked hits: ${f[1].blocked} vs ${f[2].blocked}` }));
  }
  const cracked = a.bio[0].peakHr != null && a.bio[1].peakHr != null && a.bio[0].peakHr !== a.bio[1].peakHr ? (a.bio[0].peakHr > a.bio[1].peakHr ? 1 : 2) : null;
  const flinch = (p) => d.events.filter((e) => e.type === 'flinch' && e.player === p).length;
  cards.push(card({ icon: ICON.heart, title: 'Heart', rows: [1, 2].map((p) => `${who(p)}<b class="big">${fmt(a.bio[p - 1].peakHr)}</b><small>bpm peak</small><b class="big bad">${flinch(p)}</b><small>flinches</small>`), more: cracked ? `${esc(a.names[cracked - 1])}'s heart spiked highest${a.bio[cracked - 1].peakAt != null ? ' at ' + mmss(a.bio[cracked - 1].peakAt) : ''}` : '' }));
  $('cards').innerHTML = cards.join('');
  $('cards').querySelectorAll('.card').forEach((c, i) => {
    c.style.animationDelay = `${120 + i * 90}ms`;
    c.addEventListener('click', () => { const on = c.classList.toggle('open'); c.setAttribute('aria-expanded', String(on)); });
  });

  $('full').href = './?match=' + encodeURIComponent(matchId);
}

// The summary line. If this match has no saved summary yet, ask Person C's route (/api/ai/summary) to write one
// from the match's own data (this page has the real match id, which the in-game recorder doesn't), then save it
// with PUT so the full dashboard and later recaps show it too. Their route falls back to a template if Gemini fails.
async function generateSummary(d) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 25000);
  try {
    const r = await fetch('/api/ai/summary', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: ctrl.signal,
      body: JSON.stringify({ match: d.match, samples: d.samples, events: d.events, snapshots: d.snapshots }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.text === 'string' && j.text.trim() ? j.text.trim() : null;
  } catch (_) { return null; } finally { clearTimeout(timer); }
}

async function showSummary(d) {
  const el = $('summary');
  // The recap is a quick read: show only the headline sentence. The full text is kept in the title tooltip,
  // saved in the database, and shown in full on the "Full analysis" page.
  const firstSentence = (t) => { const m = t.match(/^[\s\S]+?[.!?](?=\s|$)/); return (m ? m[0] : t).trim(); };
  const put = (text) => { el.className = 'summary'; el.textContent = firstSentence(text); el.title = text; };
  if (d.match.summary) return put(d.match.summary);

  el.className = 'summary waiting';
  el.textContent = 'Analyzing the match\u2026';

  const text = await generateSummary(d);
  if (text) {
    put(text);
    fetch('/api/matches/' + encodeURIComponent(matchId) + '/summary', {   // best effort: don't block the screen on it
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: text }),
    }).catch(() => {});
    return;
  }
  // The route was unreachable. Someone else (e.g. the in-game panel) may still save one, so check a few times.
  for (let i = 0; i < 4; i++) {
    await sleep(2500);
    try {
      const r = await fetch('/api/matches/' + encodeURIComponent(matchId));
      if (r.ok) { const j = await r.json(); if (j.match.summary) return put(j.match.summary); }
    } catch (_) { /* keep waiting */ }
  }
  el.className = 'summary'; el.textContent = ''; el.title = '';   // nothing to say: don't leave a dangling "analyzing"
}

(async function main() {
  if (!matchId) return say('No match selected.');
  const d = await fetchMatch();
  if (!d) return say('Could not load this match.');
  $('msg').hidden = true;
  $('recap').hidden = false;
  render(d);
  showSummary(d);
})();
