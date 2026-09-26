// Owner: D. Dashboard logic: loads a match from /api/matches/:id and draws the HP vs heart-rate chart.
'use strict';
if (new URLSearchParams(location.search).get('embed')) document.body.classList.add('embed');
const $ = id => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const MARKERS = {   // shape + label so identity never relies on color alone
  ko:          { label: 'KO',           shape: 'diamond' },
  big_hit:     { label: 'Big hit',      shape: 'triangle' },
  flinch:      { label: 'Flinch',       shape: 'circle' },
  heal_streak: { label: 'Heal streak',  shape: 'square' },
};
const state = { data: null, show: { ko: true, big_hit: true, flinch: true, heal_streak: true } };
const mmss = ms => { const s = Math.round(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const fmt = (v, d = 0) => v == null || Number.isNaN(v) ? '–' : (+v).toFixed(d);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const nearestIdx = (arr, t) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m].t < t) lo = m + 1; else hi = m; } return lo > 0 && Math.abs(arr[lo - 1].t - t) < Math.abs(arr[lo].t - t) ? lo - 1 : lo; };

async function init() {
  let list = [];
  try {
    const r = await fetch('/api/matches'); if (!r.ok) throw new Error('HTTP ' + r.status);
    list = await r.json();
  } catch (e) { return showErr('Could not reach the backend (' + e.message + '). Is the server running?'); }
  const wantId = new URLSearchParams(location.search).get('match');
  if (!list.length && !wantId) return showErr('No matches logged yet. Play one, or POST /api/dev/fake-match to create a fake match.');
  const sel = $('matchSel');
  if (wantId && !list.some((m) => m.id === wantId)) list.unshift({ id: wantId, started_at: Date.now(), p1_name: 'Player 1', p2_name: 'Player 2' });
  sel.innerHTML = list.map(m => `<option value="${esc(m.id)}">${new Date(m.started_at).toLocaleTimeString()} · ${esc(m.p1_name)} vs ${esc(m.p2_name)}</option>`).join('');
  const want = new URLSearchParams(location.search).get('match');
  if (want && list.some(m => m.id === want)) sel.value = want;
  sel.onchange = () => load(sel.value);
  load(sel.value);
}
function showErr(msg) { $('main').classList.add('hidden'); const e = $('err'); e.textContent = msg; e.classList.remove('hidden'); }

async function load(id) {
  try {
    let r;
    for (let i = 0; i < 6; i++) {   // the final batch may still be in flight when the overlay opens
      r = await fetch('/api/matches/' + encodeURIComponent(id));
      if (r.ok) break;
      if (r.status !== 404 && r.status !== 503) break;
      await new Promise((res) => setTimeout(res, 800));
    }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    state.data = await r.json();
  } catch (e) { return showErr('Could not load match: ' + e.message); }
  $('err').classList.add('hidden'); $('main').classList.remove('hidden');
  history.replaceState(null, '', '?match=' + encodeURIComponent(id));
  render();
}

function stats(d) {
  const out = [1, 2].map(p => {
    const hr = d.samples.filter(s => s.player === p && s.hr != null).map(s => s.hr);
    const calm = d.samples.filter(s => s.player === p && s.calm != null).map(s => s.calm);
    const ev = d.events.filter(e => e.player === p);
    const hits = ev.filter(e => e.type === 'hit');
    return {
      peakHr: hr.length ? Math.max(...hr) : null,
      avgHr: hr.length ? hr.reduce((a, b) => a + b, 0) / hr.length : null,
      calmPct: calm.length ? 100 * calm.reduce((a, b) => a + b, 0) / calm.length : null,
      dmg: hits.reduce((a, e) => a + (+e.payload.damage || 0), 0),
      flinches: ev.filter(e => e.type === 'flinch').length,
      heals: ev.filter(e => e.type === 'heal_streak').length,
      bigHits: ev.filter(e => e.type === 'big_hit').length,
    };
  });
  return out;
}

function render() {
  const d = state.data, m = d.match;
  const names = [m.p1_name || 'Player 1', m.p2_name || 'Player 2'];
  $('n1').textContent = names[0]; $('n2').textContent = names[1];
  const T = Math.max(m.duration_ms || 0, ...d.snapshots.map(s => s.t), ...d.samples.map(s => s.t), 1000);
  $('result').textContent = (m.winner ? `${names[m.winner - 1]} wins` : 'No result') + ' · ' + mmss(T);
  $('simbadge').classList.toggle('hidden', !d.samples.some(s => s.source === 'mock'));
  const st = stats(d);

  const tile = (label, f) => `<div class="tile"><div class="label">${label}</div><div class="row">` +
    [0, 1].map(i => `<span class="v"><i style="background:var(--p${i + 1})"></i>${f(st[i])}</span>`).join('') + '</div></div>';
  $('tiles').innerHTML =
    tile('Peak heart rate (bpm)', s => fmt(s.peakHr)) +
    tile('Avg heart rate (bpm)', s => fmt(s.avgHr)) +
    tile('Damage taken', s => fmt(s.dmg)) +
    tile('Flinches', s => s.flinches) +
    tile('Heal streaks', s => s.heals) +
    tile('Calm (avg %)', s => fmt(s.calmPct));

  $('legend').innerHTML =
    [0, 1].map(i => `<span style="display:inline-flex;align-items:center;gap:6px"><svg width="26" height="10" aria-hidden="true"><line x1="0" y1="5" x2="26" y2="5" stroke="var(--p${i + 1})" stroke-width="3" stroke-linecap="round"/></svg>${esc(names[i])}</span>`).join('') +
    Object.entries(MARKERS).map(([k, v]) => `<label><input type="checkbox" data-k="${k}" ${state.show[k] ? 'checked' : ''}>${markerSvg(v.shape, 'var(--text-2)', 7, 8, 8, 16, 16)}${v.label}</label>`).join('');
  $('legend').querySelectorAll('input').forEach(cb => cb.onchange = () => { state.show[cb.dataset.k] = cb.checked; drawChart(); });

  $('summary').innerHTML = '';
  if (m.summary) $('summary').textContent = m.summary;
  else { $('summary').textContent = 'Analysis not generated yet.'; $('summary').className = 'muted'; }
  if (m.summary) $('summary').className = '';

  const rows = d.events.filter(e => e.type !== 'hit');
  $('evTable').innerHTML = '<tr><th>Time</th><th>Player</th><th>Event</th><th>Detail</th></tr>' +
    rows.map(e => `<tr><td>${mmss(e.t)}</td><td>${esc(names[e.player - 1] || '')}</td><td>${esc((MARKERS[e.type] || {}).label || e.type)}</td><td>${esc(Object.entries(e.payload || {}).map(([k, v]) => k + ' ' + v).join(', '))}</td></tr>`).join('');
  drawChart();
}

function markerSvg(shape, fill, r, cx, cy, w, h, extra = '') {
  const s = `<svg width="${w}" height="${h}" aria-hidden="true">`;
  const stroke = 'stroke="var(--card)" stroke-width="2"';
  const g = shape === 'diamond' ? `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${fill}" ${stroke}/>` :
    shape === 'triangle' ? `<polygon points="${cx},${cy - r} ${cx + r},${cy + r * .8} ${cx - r},${cy + r * .8}" fill="${fill}" ${stroke}/>` :
    shape === 'square' ? `<rect x="${cx - r * .8}" y="${cy - r * .8}" width="${r * 1.6}" height="${r * 1.6}" rx="2" fill="${fill}" ${stroke}/>` :
    `<circle cx="${cx}" cy="${cy}" r="${r * .85}" fill="${fill}" ${stroke}/>`;
  return s + g + '</svg>';
}
function markerShape(shape, fill, cx, cy, r) {   // in-chart (no wrapper svg)
  const stroke = 'stroke="var(--card)" stroke-width="2"';
  return shape === 'diamond' ? `<polygon points="${cx},${cy - r} ${cx + r},${cy} ${cx},${cy + r} ${cx - r},${cy}" fill="${fill}" ${stroke}/>` :
    shape === 'triangle' ? `<polygon points="${cx},${cy - r} ${cx + r},${cy + r * .8} ${cx - r},${cy + r * .8}" fill="${fill}" ${stroke}/>` :
    shape === 'square' ? `<rect x="${cx - r * .8}" y="${cy - r * .8}" width="${r * 1.6}" height="${r * 1.6}" rx="2" fill="${fill}" ${stroke}/>` :
    `<circle cx="${cx}" cy="${cy}" r="${r * .85}" fill="${fill}" ${stroke}/>`;
}

// ---- the money chart: two stacked panels, ONE shared time axis (no dual y-axes)
const G = { W: 1000, L: 58, R: 86, mk: [8, 34], hp: [48, 268], hr: [306, 464], ax: 464 };
function drawChart() {
  const d = state.data, m = d.match;
  const names = [m.p1_name || 'Player 1', m.p2_name || 'Player 2'];
  const T = Math.max(m.duration_ms || 0, ...d.snapshots.map(s => s.t), ...d.samples.map(s => s.t), 1000);
  const X = t => G.L + (t / T) * (G.W - G.L - G.R);
  const hpY = v => G.hp[1] - (v / 100) * (G.hp[1] - G.hp[0]);
  const allHr = d.samples.filter(s => s.hr != null).map(s => s.hr);
  let lo = allHr.length ? Math.floor(Math.min(...allHr) / 10) * 10 - 10 : 50, hi = allHr.length ? Math.ceil(Math.max(...allHr) / 10) * 10 + 10 : 150;
  const hrY = v => G.hr[1] - ((v - lo) / (hi - lo)) * (G.hr[1] - G.hr[0]);
  let s = '';

  // grid + y labels
  for (const v of [0, 25, 50, 75, 100]) s += `<line x1="${G.L}" x2="${G.W - G.R}" y1="${hpY(v)}" y2="${hpY(v)}" stroke="var(--grid)"/><text x="${G.L - 8}" y="${hpY(v) + 4}" text-anchor="end" font-size="13">${v}</text>`;
  const hrStep = (hi - lo) > 80 ? 40 : 20;
  for (let v = Math.ceil(lo / hrStep) * hrStep; v <= hi; v += hrStep) s += `<line x1="${G.L}" x2="${G.W - G.R}" y1="${hrY(v)}" y2="${hrY(v)}" stroke="var(--grid)"/><text x="${G.L - 8}" y="${hrY(v) + 4}" text-anchor="end" font-size="13">${v}</text>`;
  s += `<text x="${G.L}" y="${G.hp[0] - 4}" font-size="13" font-weight="600" style="fill:var(--text)">Health (HP)</text>`;
  s += `<text x="${G.L}" y="${G.hr[0] - 8}" font-size="13" font-weight="600" style="fill:var(--text)">Heart rate (bpm)</text>`;

  // x axis ticks
  const tickStep = T > 120000 ? 30000 : T > 40000 ? 10000 : 5000;
  for (let t = 0; t <= T; t += tickStep) s += `<line x1="${X(t)}" x2="${X(t)}" y1="${G.hp[0]}" y2="${G.ax}" stroke="var(--grid)"/><text x="${X(t)}" y="${G.ax + 20}" text-anchor="middle" font-size="13">${mmss(t)}</text>`;

  // lines (2px thin marks, round joins)
  const line = (pts, color, w = 2.5) => pts.length ? `<polyline fill="none" stroke="${color}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(p => p.join(',')).join(' ')}"/>` : '';
  for (const p of [1, 2]) {
    s += line(d.snapshots.filter(x => x['p' + p + '_hp'] != null).map(x => [X(x.t).toFixed(1), hpY(x['p' + p + '_hp']).toFixed(1)]), `var(--p${p})`);
    s += line(d.samples.filter(x => x.player === p && x.hr != null).map(x => [X(x.t).toFixed(1), hrY(x.hr).toFixed(1)]), `var(--p${p})`);
  }
  // direct end labels
  for (const p of [1, 2]) {
    const hpL = [...d.snapshots].reverse().find(x => x['p' + p + '_hp'] != null), hrL = [...d.samples].reverse().find(x => x.player === p && x.hr != null);
    if (hpL) s += `<text x="${X(hpL.t) + 8}" y="${hpY(hpL['p' + p + '_hp']) + 4 + (p === 2 ? 0 : 0)}" font-size="13" style="fill:var(--text)">${esc(names[p - 1])}</text>`;
    if (hrL) s += `<text x="${X(hrL.t) + 8}" y="${hrY(hrL.hr) + 4}" font-size="13" style="fill:var(--text)">${esc(names[p - 1])}</text>`;
  }
  // event markers: shape strip on top, thin guide lines through both panels
  const my = G.mk[0] + 13;
  for (const e of d.events) {
    const mk = MARKERS[e.type]; if (!mk || !state.show[e.type] || !e.player) continue;
    const x = X(e.t), c = `var(--p${e.player})`;
    s += `<line x1="${x}" x2="${x}" y1="${my}" y2="${G.ax}" stroke="${c}" stroke-opacity="${e.type === 'ko' ? .7 : .25}" stroke-width="${e.type === 'ko' ? 2 : 1}" stroke-dasharray="${e.type === 'ko' ? '' : '3 3'}"/>`;
    s += markerShape(mk.shape, c, x, my, e.type === 'ko' ? 10 : 8);
  }
  s += `<g id="cross" style="display:none"><line id="crossLine" y1="${my + 12}" y2="${G.ax}" stroke="var(--text-2)" stroke-width="1"/></g>`;
  s += `<rect id="hit" x="${G.L}" y="${G.mk[0]}" width="${G.W - G.L - G.R}" height="${G.ax - G.mk[0]}" fill="transparent"/>`;
  $('chart').innerHTML = s;

  // hover layer
  const svg = $('chart'), tip = $('tip'), wrap = $('chartwrap');
  const hit = $('hit'), cross = $('cross'), cl = $('crossLine');
  hit.onmousemove = ev => {
    const pt = svg.getBoundingClientRect();
    const px = (ev.clientX - pt.left) / pt.width * G.W;
    const t = Math.max(0, Math.min(T, (px - G.L) / (G.W - G.L - G.R) * T));
    cl.setAttribute('x1', X(t)); cl.setAttribute('x2', X(t)); cross.style.display = '';
    const snap = d.snapshots.length ? d.snapshots[nearestIdx(d.snapshots, t)] : null;
    const row = p => { const arr = d.samples.filter(x => x.player === p); const sm = arr.length ? arr[nearestIdx(arr, t)] : null;
      return `<div class="r"><span><span class="swatch" style="background:var(--p${p});width:10px;height:10px"></span> ${esc(names[p - 1])}</span><span>HP <b>${snap ? fmt(snap['p' + p + '_hp']) : '–'}</b> · HR <b>${sm ? fmt(sm.hr) : '–'}</b></span></div>`; };
    const near = d.events.filter(e => MARKERS[e.type] && state.show[e.type] && Math.abs(e.t - t) < T * 0.012 + 300);
    tip.innerHTML = `<div style="margin-bottom:4px"><b>${mmss(t)}</b></div>` + row(1) + row(2) +
      near.map(e => `<div class="ev">${MARKERS[e.type].label} – ${esc(names[e.player - 1] || '')}</div>`).join('');
    tip.style.display = 'block';
    const wr = wrap.getBoundingClientRect(), tw = tip.offsetWidth;
    let left = ev.clientX - wr.left + 14; if (left + tw > wr.width) left = ev.clientX - wr.left - tw - 14;
    tip.style.left = Math.max(0, left) + 'px'; tip.style.top = (ev.clientY - wr.top + 14) + 'px';
  };
  hit.onmouseleave = () => { tip.style.display = 'none'; cross.style.display = 'none'; };
}

$('tableBtn').onclick = () => { const on = $('tableCard').classList.toggle('hidden'); $('tableBtn').setAttribute('aria-pressed', String(!on)); };
init();
