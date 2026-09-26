// Owner: C
// Generates fixtures/fake-match.json: a scripted, deterministic match that exercises
// every commentary moment (combo, special, big flinch, panic spike, calm clutch,
// heal streak, comeback, KO). Shapes follow CONTRACT.md.
//
//   node tools/make-fake-match.js
//
// Story: P1 bullies P2 early (combo + special), P2's HR spikes. P2 then calms down at
// low HP, heals, P1 panics, P2 lands a combo + special, overtakes, and KOs P1.

import { writeFileSync } from 'node:fs';

const T0 = 1700000000000;
const STEP = 250;
const END = 37000;

// Keyframes: [ms, value], linearly interpolated.
const bio = {
  1: {
    hr: [[0, 80], [18000, 82], [22000, 118], [37000, 124]],
    breath: [[0, 14], [18000, 14], [22000, 24], [37000, 26]],
    stress: [[0, 0.35], [18000, 0.35], [22000, 0.85], [37000, 0.9]],
    calm: [[0, 0.6], [18000, 0.6], [22000, 0.2], [37000, 0.15]],
  },
  2: {
    hr: [[0, 82], [9000, 84], [12000, 114], [15000, 110], [17000, 80], [37000, 76]],
    breath: [[0, 14], [9000, 15], [12000, 25], [15000, 22], [17000, 11], [37000, 10]],
    stress: [[0, 0.4], [9000, 0.4], [12000, 0.9], [15000, 0.8], [17000, 0.2], [37000, 0.15]],
    calm: [[0, 0.55], [9000, 0.55], [12000, 0.15], [15000, 0.3], [17000, 0.85], [37000, 0.88]],
  },
};
const meter = {
  1: [[0, 0], [8000, 100], [9000, 100], [9001, 0], [37000, 30]],
  2: [[0, 0], [28000, 100], [30000, 100], [30001, 0], [37000, 20]],
};
// P2 heals 1.5 HP/s between these times.
const heal = { 2: { from: 19000, to: 32000, perSec: 1.5 } };

// Scripted actions at exact ms (multiples of STEP).
const hits = [
  // P1 combo on P2
  [2000, 1, 'light', 10, 0.5],
  [3000, 1, 'light', 10, 0.5],
  [4000, 1, 'light', 10, 0.5],
  [9000, 1, 'special', 25, 0.9],
  [12000, 1, 'light', 10, 0.45],
  [14500, 1, 'light', 10, 0.45],
  // P2 answers
  [24000, 2, 'light', 12, 0.55],
  [25000, 2, 'light', 12, 0.65],
  [26000, 2, 'light', 12, 0.8],
  [30000, 2, 'special', 30, 0.95],
  [33000, 2, 'light', 12, 0.8],
  [34500, 2, 'light', 12, 0.8],
  [37000, 2, 'light', 12, 0.85],
];
const meterFull = [[8000, 1], [28000, 2]];

function lerp(frames, ms) {
  if (ms <= frames[0][0]) return frames[0][1];
  for (let i = 1; i < frames.length; i++) {
    const [t1, v1] = frames[i];
    const [t0, v0] = frames[i - 1];
    if (ms <= t1) return v0 + ((v1 - v0) * (ms - t0)) / (t1 - t0);
  }
  return frames[frames.length - 1][1];
}

const r2 = (x) => Math.round(x * 100) / 100;

export function makeFakeMatch() {
  const events = [];
  const hp = { 1: 100, 2: 100 };
  let over = false;
  const push = (at, type, payload) => events.push({ at, type, payload: { ...payload, t: T0 + at } });

  const bioAt = (p, ms) => ({
    hr: r2(lerp(bio[p].hr, ms)),
    breath: r2(lerp(bio[p].breath, ms)),
    stress: r2(lerp(bio[p].stress, ms)),
    calm: r2(lerp(bio[p].calm, ms)),
    source: 'mock',
  });

  push(0, 'round_start', { round: 1 });

  for (let ms = 0; ms <= END && !over; ms += STEP) {
    for (const [at, player] of meterFull) if (at === ms) push(ms, 'meter_full', { player });

    for (const [at, attacker, kind, damage, magnitude] of hits) {
      if (at !== ms || over) continue;
      const defender = attacker === 1 ? 2 : 1;
      hp[defender] = Math.max(0, hp[defender] - damage);
      push(ms, 'hit', { attacker, defender, damage, kind });
      push(ms, 'flinch', { player: defender, magnitude });
      if (kind === 'special') push(ms, 'special', { player: attacker });
      if (hp[defender] === 0) {
        over = true;
        push(ms, 'ko', { winner: attacker, loser: defender });
        push(ms, 'round_end', { round: 1, winner: attacker });
      }
    }

    for (const [p, h] of Object.entries(heal)) {
      if (ms >= h.from && ms < h.to && hp[p] > 0) {
        const amount = (h.perSec * STEP) / 1000;
        hp[p] = Math.min(100, hp[p] + amount);
        push(ms, 'heal_tick', { player: Number(p), amount });
      }
    }

    for (const p of [1, 2]) push(ms, 'biometric_sample', { player: p, ...bioAt(p, ms) });

    push(ms, 'state_snapshot', {
      round: 1,
      timeRemaining: r2(99 - ms / 1000),
      players: [1, 2].map((id) => ({
        id,
        hp: r2(hp[id]), maxHp: 100,
        meter: Math.round(lerp(meter[id], ms)), maxMeter: 100,
        x: id === 1 ? 300 : 360, y: 0, facing: id === 1 ? 1 : -1,
        state: hp[id] === 0 ? 'ko' : 'idle',
        biometrics: bioAt(id, ms),
      })),
    });
  }

  return {
    meta: {
      description: 'Scripted fake match for commentary development. Regenerate with tools/make-fake-match.js',
      t0: T0,
      durationMs: events[events.length - 1].at,
    },
    events,
  };
}

if (globalThis.process?.argv?.[1] && new URL(import.meta.url).pathname === process.argv[1]) {
  const out = new URL('../fixtures/fake-match.json', import.meta.url);
  const match = makeFakeMatch();
  writeFileSync(out, JSON.stringify(match, null, 1) + '\n');
  console.log(`wrote ${match.events.length} events (${match.meta.durationMs} ms) to fixtures/fake-match.json`);
}
