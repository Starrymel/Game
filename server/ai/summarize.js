// Owner: C
// Builds the compact match log sent to Gemini
//
// Input is the match-detail shape served by GET /api/matches/:id (D's Tiger Data rows),
// which the in-game recorder also produces:
//   { match: { id, winner, duration_ms, p1_name, p2_name },
//     samples:   [{ t, player, hr, breath, stress, calm }],
//     events:    [{ t, type, player, payload }],
//     snapshots: [{ t, p1_hp, p2_hp, p1_meter, p2_meter }] }
// t is ms since match start. Output is a small plain object (a few hundred tokens).

const { matchStats } = require('../lib/matchStats');

const HP_CURVE_POINTS = 16;
const CALM_THRESHOLD = 0.6;
const STRESS_THRESHOLD = 0.7;
const COMEBACK_DEFICIT = 30;

const r0 = (x) => Math.round(x);
const r2 = (x) => Math.round(x * 100) / 100;
const sec = (ms) => r2(ms / 1000);
const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : null);

function playerNames(match = {}) {
  return { 1: match.p1_name || 'Player One', 2: match.p2_name || 'Player Two' };
}

function bioStats(samples, player) {
  const s = samples.filter((x) => x.player === player && num(x.hr) !== null);
  if (!s.length) return null;
  const hr = s.map((x) => x.hr);
  const peak = s.reduce((a, b) => (b.hr > a.hr ? b : a));
  const low = s.reduce((a, b) => (b.hr < a.hr ? b : a));
  const calmS = s.filter((x) => num(x.calm) !== null);
  const stressS = s.filter((x) => num(x.stress) !== null);
  const breath = s.map((x) => x.breath).filter((b) => num(b) !== null);
  return {
    hrAvg: r0(hr.reduce((a, b) => a + b, 0) / hr.length),
    hrMin: r0(low.hr),
    hrPeak: r0(peak.hr),
    hrPeakAtS: sec(peak.t),
    breathMax: breath.length ? r0(Math.max(...breath)) : null,
    calmAvg: calmS.length ? r2(calmS.reduce((a, b) => a + b.calm, 0) / calmS.length) : null,
    pctTimeCalm: calmS.length ? r0((100 * calmS.filter((x) => x.calm >= CALM_THRESHOLD).length) / calmS.length) : null,
    pctTimeStressed: stressS.length ? r0((100 * stressS.filter((x) => x.stress >= STRESS_THRESHOLD).length) / stressS.length) : null,
  };
}

// Biggest HP swing and lead changes, from snapshots.
function hpStory(snapshots) {
  if (!snapshots.length) return { leadChanges: [], comeback: null, biggestLead: null };
  const leadChanges = [];
  let leader = 0;
  const maxDeficit = { 1: 0, 2: 0 };
  let comeback = null;
  let biggestLead = null;
  for (const s of snapshots) {
    const diff = s.p1_hp - s.p2_hp;
    const now = diff > 0 ? 1 : diff < 0 ? 2 : leader;
    if (now !== leader && leader !== 0) leadChanges.push({ atS: sec(s.t), newLeader: now });
    leader = now;
    if (!biggestLead || Math.abs(diff) > biggestLead.by) biggestLead = { by: r0(Math.abs(diff)), leader: diff > 0 ? 1 : 2, atS: sec(s.t) };
    for (const p of [1, 2]) {
      const deficit = p === 1 ? -diff : diff;
      maxDeficit[p] = Math.max(maxDeficit[p], deficit);
      if (!comeback && maxDeficit[p] >= COMEBACK_DEFICIT && deficit <= 0) {
        comeback = { player: p, wasBehindBy: r0(maxDeficit[p]), atS: sec(s.t) };
      }
    }
  }
  return { leadChanges, comeback, biggestLead };
}

function hpCurve(snapshots) {
  if (!snapshots.length) return [];
  const step = Math.max(1, Math.ceil(snapshots.length / HP_CURVE_POINTS));
  const pts = snapshots.filter((_, i) => i % step === 0);
  if (pts.at(-1) !== snapshots.at(-1)) pts.push(snapshots.at(-1));
  return pts.map((s) => [sec(s.t), r0(s.p1_hp), r0(s.p2_hp)]);
}

// player = who it's about. comeback/panic_spike/calm_clutch come from the in-game recorder.
const KEY_EVENT_TYPES = new Set(['special', 'heal_streak', 'meter_full', 'comeback', 'panic_spike', 'calm_clutch', 'sword_hit', 'prize_caught']);

function keyEvents(events) {
  const out = [];
  let flinches = 0;
  for (const e of events) {
    if (e.type === 'flinch') {
      if ((e.payload?.magnitude ?? 0) >= 0.6 && flinches < 6) {
        flinches += 1;
        out.push({ atS: sec(e.t), type: 'big_flinch', victim: e.player });
      }
    } else if (e.type === 'ko') {
      out.push({ atS: sec(e.t), type: 'ko', loser: e.player, winner: e.payload?.winner ?? (e.player === 1 ? 2 : 1) });
    } else if (e.type === 'big_hit') {
      // D's logger stores the victim as player for hit-type events.
      out.push({ atS: sec(e.t), type: 'big_hit', victim: e.player, damage: e.payload?.damage });
    } else if (KEY_EVENT_TYPES.has(e.type)) {
      out.push({ atS: sec(e.t), type: e.type, player: e.player });
    }
  }
  return out.slice(0, 30);
}

function countBy(events, type) {
  const c = { 1: 0, 2: 0 };
  for (const e of events) if (e.type === type && c[e.player] !== undefined) c[e.player] += 1;
  return c;
}

function compactMatch(detail) {
  const match = detail.match ?? {};
  const samples = Array.isArray(detail.samples) ? detail.samples : [];
  const events = Array.isArray(detail.events) ? detail.events : [];
  const snapshots = (Array.isArray(detail.snapshots) ? detail.snapshots : [])
    .filter((s) => num(s.p1_hp) !== null && num(s.p2_hp) !== null);
  const names = playerNames(match);
  const last = snapshots.at(-1);
  // Hit/flinch events record the victim as player; special records the attacker.
  const hitsTaken = countBy(events, 'hit');
  const flinches = countBy(events, 'flinch');
  const specials = countBy(events, 'special');
  const st = matchStats(events);
  // Counted in code from the events, so Gemini only tells the story around real numbers.
  const fight = (p) => {
    const x = st.players[p];
    return {
      punches: x.punches, lasers: x.lasers, damageDealt: x.damageDealt, damageTaken: x.damageTaken, biggestHit: x.biggestHit,
      swordsHit: x.swordsHit, swordsDodged: x.swordsDodged, prizesCaught: x.prizesCaught, prizeHealed: x.prizeHealed,
    };
  };

  return {
    names,
    winner: match.winner ?? null,
    durationS: sec(match.duration_ms ?? last?.t ?? 0),
    finalHp: last ? { 1: r0(last.p1_hp), 2: r0(last.p2_hp) } : null,
    players: {
      1: { ...bioStats(samples, 1), hitsLanded: hitsTaken[2], hitsTaken: hitsTaken[1], specials: specials[1], flinchesSuffered: flinches[1], ...fight(1) },
      2: { ...bioStats(samples, 2), hitsLanded: hitsTaken[1], hitsTaken: hitsTaken[2], specials: specials[2], flinchesSuffered: flinches[2], ...fight(2) },
    },
    ...hpStory(snapshots),
    hpCurve: hpCurve(snapshots),
    prizesMissed: st.prizesMissed,
    keyEvents: keyEvents(events),
  };
}

// Deterministic summary used when Gemini is unavailable, so the panel is never empty.
function templateSummary(c) {
  const n = c.names;
  const w = c.winner;
  const l = w === 1 ? 2 : w === 2 ? 1 : null;
  const headline = w ? `${n[w]} wins${c.comeback?.player === w ? ' with a comeback' : ''}!` : 'A dead heat!';
  const parts = [];
  const p = c.players;
  // Short and human, no stat dump: who cracked, who kept cool.
  if (p[1].calmAvg != null && p[2].calmAvg != null) {
    const calmer = p[1].calmAvg >= p[2].calmAvg ? 1 : 2;
    const other = calmer === 1 ? 2 : 1;
    const t = p[other].hrPeakAtS != null ? ` around ${Math.round(p[other].hrPeakAtS)}s` : '';
    parts.push(`${n[other]} cracked first: the heart rate spiked${t}.`);
    parts.push(`${n[calmer]} stayed calm and took it.`);
  } else if (l && c.finalHp) {
    parts.push(`${n[l]} went down and ${n[w]} was left standing.`);
  }
  // One fun line from the fight numbers: swords and prizes are the most visual bits.
  const sw = [1, 2].map((q) => p[q].swordsHit ?? 0), dg = [1, 2].map((q) => p[q].swordsDodged ?? 0), pr = [1, 2].map((q) => p[q].prizesCaught ?? 0);
  if (sw[0] + sw[1] >= 2 && sw[0] !== sw[1]) { const vic = sw[0] > sw[1] ? 1 : 2; parts.push(`${n[vic]} kept getting speared by falling swords.`); }
  else if (dg[0] + dg[1] >= 3 && dg[0] !== dg[1]) { const dodger = dg[0] > dg[1] ? 1 : 2; parts.push(`${n[dodger]} danced around the falling swords.`); }
  else if (pr[0] + pr[1] >= 2 && pr[0] !== pr[1]) { const grab = pr[0] > pr[1] ? 1 : 2; parts.push(`${n[grab]} grabbed the prizes.`); }
  const turningPoint = c.comeback
    ? `${n[c.comeback.player]} erased a ${c.comeback.wasBehindBy} HP deficit at ${Math.round(c.comeback.atS)}s.`
    : c.leadChanges.length
      ? `The lead flipped to ${n[c.leadChanges.at(-1).newLeader]} at ${Math.round(c.leadChanges.at(-1).atS)}s.`
      : w ? `${n[w]} led from start to finish.` : 'Neither fighter could pull away.';
  return { headline, analysis: parts.join(' '), turningPoint };
}

module.exports = { compactMatch, templateSummary };
