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

function analyse(d) {
  const names = [d.match.p1_name || 'Player 1', d.match.p2_name || 'Player 2'];
  const T = Math.max(d.match.duration_ms || 0, ...d.snapshots.map((s) => s.t), ...d.samples.map((s) => s.t), 1000);
  const ko = d.events.find((e) => e.type === 'ko');
  let winner = d.match.winner || (ko && ko.payload && ko.payload.winner) || null;
  const stats = [1, 2].map((p) => {
    const hr = d.samples.filter((s) => s.player === p && s.hr != null).map((s) => s.hr);
    return {
      peakHr: hr.length ? Math.max(...hr) : null,
      dmg: d.events.filter((e) => e.type === 'hit' && e.player === p).reduce((a, e) => a + (+e.payload.damage || 0), 0),
      flinches: d.events.filter((e) => e.type === 'flinch' && e.player === p).length,
    };
  });
  const hits = d.events.filter((e) => e.type === 'hit');
  const biggest = hits.length ? hits.reduce((a, b) => ((+b.payload.damage || 0) > (+a.payload.damage || 0) ? b : a)) : null;
  const live = d.samples.some((s) => s.source === 'presage');
  return { names, T, ko, winner, stats, biggest, live };
}

function render(d) {
  const a = analyse(d);
  const [n1, n2] = a.names;

  $('banner').innerHTML = a.winner
    ? `<span class="chip" style="background:var(--p${a.winner})"></span>${esc(a.names[a.winner - 1])} wins`
    : 'Draw';
  $('sub').innerHTML = `${mmss(a.T)} round<span class="tag">${a.live ? 'Live Presage biometrics' : 'Mock biometrics'}</span>`;

  $('legend').innerHTML = [1, 2].map((p) =>
    `<span><i style="background:var(--p${p})"></i>${esc(a.names[p - 1])}</span>`).join('');

  const tile = (label, f) => `<div class="tile"><div class="label">${label}</div><div class="row">` +
    [0, 1].map((i) => `<span class="v"><i style="background:var(--p${i + 1})"></i>${f(a.stats[i])}</span>`).join('') + '</div></div>';
  $('stats').innerHTML = tile('Peak HR', (s) => fmt(s.peakHr)) + tile('Damage taken', (s) => fmt(s.dmg)) + tile('Flinches', (s) => s.flinches);

  $('full').href = './?match=' + encodeURIComponent(matchId);
  drawChart(d, a);
}

// One chart, one shared time axis, two stacked panels: HP on top, heart rate below. No dual y-axes.
function drawChart(d, a) {
  const W = 700, L = 46, R = 70;
  const HP = [22, 148], HR = [178, 226], AX = 226;
  const X = (t) => L + (t / a.T) * (W - L - R);
  const hpY = (v) => HP[1] - (v / 100) * (HP[1] - HP[0]);
  const allHr = d.samples.filter((s) => s.hr != null).map((s) => s.hr);
  const hasHr = allHr.length > 1;
  const lo = hasHr ? Math.floor(Math.min(...allHr) / 10) * 10 - 5 : 50;
  const hi = hasHr ? Math.ceil(Math.max(...allHr) / 10) * 10 + 5 : 150;
  const hrY = (v) => HR[1] - ((v - lo) / (hi - lo)) * (HR[1] - HR[0]);
  let s = '';

  // grid + y labels
  for (const v of [0, 50, 100]) s += `<line x1="${L}" x2="${W - R}" y1="${hpY(v)}" y2="${hpY(v)}" stroke="var(--grid)"/><text x="${L - 8}" y="${hpY(v) + 4}" text-anchor="end" font-size="12">${v}</text>`;
  s += `<text x="${L}" y="${HP[0] - 8}" font-size="12" style="fill:var(--text-3)">HEALTH</text>`;
  s += `<text x="${L}" y="${HR[0] - 8}" font-size="12" style="fill:var(--text-3)">HEART RATE (bpm)</text>`;
  if (hasHr) {
    for (const v of [lo + 5, hi - 5]) s += `<line x1="${L}" x2="${W - R}" y1="${hrY(v)}" y2="${hrY(v)}" stroke="var(--grid)"/><text x="${L - 8}" y="${hrY(v) + 4}" text-anchor="end" font-size="12">${Math.round(v)}</text>`;
  } else {
    s += `<text x="${(L + W - R) / 2}" y="${(HR[0] + HR[1]) / 2 + 4}" text-anchor="middle" font-size="13" style="fill:var(--text-3)">No heart-rate data for this round</text>`;
  }

  // time axis
  const step = [5000, 10000, 15000, 30000, 60000].find((st) => a.T / st <= 6) || 60000;
  for (let t = 0; t <= a.T; t += step) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${AX}" y2="${AX + 4}" stroke="var(--text-3)"/><text x="${X(t)}" y="${AX + 18}" text-anchor="middle" font-size="12">${mmss(t)}</text>`;
  s += `<line x1="${L}" x2="${W - R}" y1="${AX}" y2="${AX}" stroke="var(--line)"/>`;

  // lines
  const line = (pts, p) => (pts.length ? `<polyline fill="none" stroke="var(--p${p})" stroke-width="3" stroke-linejoin="round" stroke-linecap="round" points="${pts.join(' ')}"/>` : '');
  const ends = { hp: [], hr: [] };
  for (const p of [1, 2]) {
    const sn = d.snapshots.filter((x) => x['p' + p + '_hp'] != null);
    s += line(sn.map((x) => `${X(x.t).toFixed(1)},${hpY(x['p' + p + '_hp']).toFixed(1)}`), p);
    if (sn.length) ends.hp.push({ p, y: hpY(sn[sn.length - 1]['p' + p + '_hp']), x: X(sn[sn.length - 1].t) });
    const sm = d.samples.filter((x) => x.player === p && x.hr != null);
    s += line(sm.map((x) => `${X(x.t).toFixed(1)},${hrY(x.hr).toFixed(1)}`), p);
    if (sm.length) ends.hr.push({ p, y: hrY(sm[sm.length - 1].hr), x: X(sm[sm.length - 1].t) });
  }
  // direct labels at the line ends, nudged apart when they'd overlap
  for (const list of [ends.hp, ends.hr]) {
    list.sort((u, v) => u.y - v.y);
    if (list.length === 2 && list[1].y - list[0].y < 15) { const mid = (list[0].y + list[1].y) / 2; list[0].y = mid - 8; list[1].y = mid + 8; }
    for (const e of list) s += `<text x="${e.x + 8}" y="${e.y + 4}" font-size="13" style="fill:var(--text)">${esc(a.names[e.p - 1])}</text>`;
  }

  // markers: the KO (vertical line + diamond) and the single biggest hit (triangle on the victim's HP line)
  const tri = (cx, cy, r) => `<polygon points="${cx},${cy - r} ${cx + r},${cy + r * 0.8} ${cx - r},${cy + r * 0.8}" fill="var(--text)" stroke="var(--bg)" stroke-width="2"/>`;
  if (a.biggest) {
    const v = a.biggest.player, snap = d.snapshots.length ? d.snapshots.reduce((b, c) => (Math.abs(c.t - a.biggest.t) < Math.abs(b.t - a.biggest.t) ? c : b)) : null;
    const hp = snap ? snap['p' + v + '_hp'] : null;
    if (hp != null) {
      const cx = X(a.biggest.t), cy = hpY(hp);
      // label goes in the empty space below the marker (lines usually sit near the top); flip above if that would hit the axis
      const below = cy + 26 <= HP[1] + 6;
      const lx = Math.min(Math.max(cx, L + 34), W - R - 34);
      s += `<g><title>Biggest hit: ${fmt(a.biggest.payload.damage)} damage on ${esc(a.names[v - 1])}</title>${tri(cx, cy, 8)}</g>`;
      s += `<text x="${lx}" y="${below ? cy + 26 : cy - 14}" text-anchor="middle" font-size="12" style="fill:var(--text)">Biggest hit</text>`;
    }
  }
  if (a.ko) {
    const x = X(a.ko.t);
    s += `<line x1="${x}" x2="${x}" y1="${HP[0] - 4}" y2="${AX}" stroke="var(--text)" stroke-opacity=".55" stroke-width="2" stroke-dasharray="4 4"/>`;
    s += `<g><title>KO</title><polygon points="${x},${HP[0] - 16} ${x + 9},${HP[0] - 7} ${x},${HP[0] + 2} ${x - 9},${HP[0] - 7}" fill="var(--text)" stroke="var(--bg)" stroke-width="2"/></g>`;
    s += `<text x="${x}" y="${HP[0] - 22}" text-anchor="middle" font-size="12" font-weight="700" style="fill:var(--text)">KO</text>`;
  }
  $('chart').innerHTML = s;
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
