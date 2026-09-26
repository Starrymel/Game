// Owner: C
// Records the current round from the bus in the same shape as GET /api/matches/:id
// (D's Tiger Data rows), so the post-match summary works even when the DB is down.
// Conventions match D's logger: t = ms since round start; hit/flinch/ko store the
// victim as player; special/meter_full store the actor.

import { WATCHED_EVENTS } from './listener.js';

const SAMPLE_MS = 500;
const BIG_HIT_DAMAGE = 15;
const MAX_ROWS = 4000;
// Moments from moments.js worth keeping in the log (player = who it's about).
const MOMENT_EVENTS = new Set(['heal_streak', 'comeback', 'panic_spike', 'calm_clutch']);

export function createMatchRecorder() {
  let rec = null;
  const r1 = (x) => Math.round(x * 10) / 10;

  function start(t) {
    rec = { t0: t, winner: null, endT: null, lastSample: { 1: -Infinity, 2: -Infinity }, samples: [], events: [], snapshots: [] };
  }
  const rel = (t) => Math.max(0, Math.round(t - rec.t0));
  const push = (arr, row) => { if (arr.length < MAX_ROWS) arr.push(row); };
  const ev = (t, type, player, payload = {}) => push(rec.events, { t: rel(t), type, player, payload });

  const handlers = {
    round_start: ({ t }) => start(t),
    biometric_sample(s) {
      if (s.t - rec.lastSample[s.player] < SAMPLE_MS) return;
      rec.lastSample[s.player] = s.t;
      push(rec.samples, { t: rel(s.t), player: s.player, hr: s.hr, breath: s.breath, stress: s.stress, calm: s.calm, source: s.source });
    },
    state_snapshot(s) {
      const [a, b] = s.players;
      push(rec.snapshots, { t: rel(s.t), p1_hp: r1(a.hp), p2_hp: r1(b.hp), p1_meter: r1(a.meter), p2_meter: r1(b.meter) });
    },
    hit({ attacker, defender, damage, kind, t }) {
      ev(t, 'hit', defender, { attacker, damage: r1(damage), kind });
      if (kind === 'special' || damage >= BIG_HIT_DAMAGE) ev(t, 'big_hit', defender, { attacker, damage: r1(damage), kind });
    },
    flinch: ({ player, magnitude, t }) => ev(t, 'flinch', player, { magnitude: Math.round(magnitude * 100) / 100 }),
    special: ({ player, t }) => ev(t, 'special', player),
    meter_full: ({ player, t }) => ev(t, 'meter_full', player),
    ko({ winner, loser, t }) {
      ev(t, 'ko', loser, { winner });
      const last = rec.snapshots.at(-1);
      if (last) push(rec.snapshots, { ...last, t: rel(t), [`p${loser}_hp`]: 0 });
    },
    round_end({ winner, t }) {
      rec.winner = winner ?? null;
      rec.endT = t;
    },
  };

  return {
    events: ['biometric_sample', ...WATCHED_EVENTS.filter((e) => e !== 'heal_tick')],
    handle(type, payload) {
      if (type !== 'round_start' && (!rec || rec.endT !== null)) return;
      handlers[type]?.(payload);
    },
    onMoment(m) {
      if (rec && rec.endT === null && MOMENT_EVENTS.has(m.type)) ev(m.t, m.type, m.player, m.data);
    },
    detail() {
      if (!rec) return null;
      return {
        match: {
          winner: rec.winner,
          duration_ms: rel(rec.endT ?? rec.t0 + (rec.snapshots.at(-1)?.t ?? 0)),
          p1_name: 'Player One',
          p2_name: 'Player Two',
        },
        samples: rec.samples,
        events: rec.events,
        snapshots: rec.snapshots,
      };
    },
  };
}
