// Owner: C
// Detects heal streak, comeback, panic spike, calm clutch
//
// Pure logic: feed it bus events via handle(type, payload), get back an array of
// "moments" for the announcer. Uses payload.t (not Date.now()) so replays are
// deterministic.
//
// Moment shape:
//   { type, priority, t, player?, data, context }
//   context = { round, timeRemaining, players: [{ id, hp, maxHp, meter, hr, breath, stress, calm }] }

export const PRIORITY = {
  ko: 100,
  special: 90,
  comeback: 80,
  big_flinch: 70,
  calm_clutch: 65,
  panic_spike: 60,
  heal_streak: 55,
  combo: 50,
  meter_full: 45,
  round_start: 40,
  round_end: 40,
  hit: 10,
};

export const DEFAULTS = {
  bigFlinchMagnitude: 0.6,    // flinch at/above this is worth calling out
  comboHits: 3,               // consecutive hits by one attacker...
  comboWindowMs: 2500,        // ...each within this gap
  healStreakHp: 8,            // healed at least this much...
  healStreakWindowMs: 6000,   // ...within this window, without being hit
  healStreakCooldownMs: 10000,
  comebackDeficit: 30,        // was behind by >= this much HP...
  comebackRecover: 0,         // ...and is now ahead by >= this (0 = tied or better)
  panicHrJump: 20,            // HR rose by >= this many bpm...
  panicWindowMs: 5000,        // ...within this window
  panicCooldownMs: 10000,
  clutchHpFraction: 0.25,     // at or below this HP fraction...
  clutchCalm: 0.7,            // ...with calm at or above this...
  clutchHoldMs: 2000,         // ...held for this long
};

const other = (p) => (p === 1 ? 2 : 1);

export function createMomentDetector(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  let snap = null;
  let perRound;

  function resetRound() {
    perRound = {
      combo: { attacker: null, count: 0, lastT: -Infinity },
      heal: { 1: freshHeal(), 2: freshHeal() },
      maxDeficit: { 1: 0, 2: 0 },
      hrHistory: { 1: [], 2: [] },
      lastPanicT: { 1: -Infinity, 2: -Infinity },
      clutchSince: { 1: null, 2: null },
      clutchFired: { 1: false, 2: false },
      koFired: false,
    };
  }
  function freshHeal() {
    return { ticks: [], lastStreakT: -Infinity };
  }
  resetRound();

  function context() {
    if (!snap) return null;
    return {
      round: snap.round,
      timeRemaining: snap.timeRemaining,
      players: snap.players.map((p) => ({
        id: p.id,
        hp: Math.round(p.hp),
        maxHp: p.maxHp,
        meter: Math.round(p.meter),
        hr: p.biometrics ? Math.round(p.biometrics.hr) : null,
        breath: p.biometrics ? Math.round(p.biometrics.breath) : null,
        stress: p.biometrics ? round2(p.biometrics.stress) : null,
        calm: p.biometrics ? round2(p.biometrics.calm) : null,
      })),
    };
  }

  function moment(type, t, player, data = {}) {
    return { type, priority: PRIORITY[type], t, player, data, context: context() };
  }

  const handlers = {
    round_start(p) {
      resetRound();
      return [moment('round_start', p.t, undefined, { round: p.round })];
    },

    round_end(p) {
      // After a KO the KO call already says it all; only announce time-outs.
      if (perRound.koFired) return [];
      return [moment('round_end', p.t, p.winner ?? undefined, { round: p.round, winner: p.winner })];
    },

    ko(p) {
      if (perRound.koFired) return [];
      perRound.koFired = true;
      return [moment('ko', p.t, p.winner, { winner: p.winner, loser: p.loser })];
    },

    special(p) {
      return [moment('special', p.t, p.player)];
    },

    meter_full(p) {
      return [moment('meter_full', p.t, p.player)];
    },

    flinch(p) {
      if (p.magnitude < cfg.bigFlinchMagnitude) return [];
      return [moment('big_flinch', p.t, p.player, { magnitude: round2(p.magnitude) })];
    },

    hit(p) {
      const out = [];
      // Getting hit breaks the defender's heal streak.
      perRound.heal[p.defender].ticks = [];

      const c = perRound.combo;
      if (c.attacker === p.attacker && p.t - c.lastT <= cfg.comboWindowMs) {
        c.count += 1;
      } else {
        c.attacker = p.attacker;
        c.count = 1;
      }
      c.lastT = p.t;

      if (c.count === cfg.comboHits) {
        out.push(moment('combo', p.t, p.attacker, { hits: c.count, defender: p.defender }));
      } else if (p.kind !== 'special') {
        out.push(moment('hit', p.t, p.attacker, {
          defender: p.defender, damage: round2(p.damage), kind: p.kind,
        }));
      }
      return out;
    },

    heal_tick(p) {
      const h = perRound.heal[p.player];
      h.ticks.push({ t: p.t, amount: p.amount });
      while (h.ticks.length && p.t - h.ticks[0].t > cfg.healStreakWindowMs) h.ticks.shift();
      const total = h.ticks.reduce((s, x) => s + x.amount, 0);
      if (total >= cfg.healStreakHp && p.t - h.lastStreakT >= cfg.healStreakCooldownMs) {
        h.lastStreakT = p.t;
        h.ticks = [];
        return [moment('heal_streak', p.t, p.player, { healed: round2(total) })];
      }
      return [];
    },

    state_snapshot(s) {
      snap = s;
      const out = [];
      for (const pl of s.players) {
        out.push(...checkComeback(s, pl), ...checkPanic(s, pl), ...checkClutch(s, pl));
      }
      return out;
    },
  };

  function checkComeback(s, pl) {
    const opp = s.players.find((x) => x.id === other(pl.id));
    if (!opp) return [];
    const diff = pl.hp - opp.hp; // negative = behind
    const deficit = -diff;
    if (deficit > perRound.maxDeficit[pl.id]) perRound.maxDeficit[pl.id] = deficit;
    if (perRound.maxDeficit[pl.id] >= cfg.comebackDeficit && diff >= cfg.comebackRecover) {
      const was = perRound.maxDeficit[pl.id];
      perRound.maxDeficit[pl.id] = 0; // re-arm only if they fall far behind again
      return [moment('comeback', s.t, pl.id, { wasBehindBy: Math.round(was) })];
    }
    return [];
  }

  function checkPanic(s, pl) {
    const hr = pl.biometrics?.hr;
    if (hr == null) return [];
    const hist = perRound.hrHistory[pl.id];
    hist.push({ t: s.t, hr });
    while (hist.length && s.t - hist[0].t > cfg.panicWindowMs) hist.shift();
    const minHr = Math.min(...hist.map((x) => x.hr));
    if (hr - minHr >= cfg.panicHrJump && s.t - perRound.lastPanicT[pl.id] >= cfg.panicCooldownMs) {
      perRound.lastPanicT[pl.id] = s.t;
      return [moment('panic_spike', s.t, pl.id, { from: Math.round(minHr), to: Math.round(hr) })];
    }
    return [];
  }

  function checkClutch(s, pl) {
    if (perRound.clutchFired[pl.id]) return [];
    const calm = pl.biometrics?.calm;
    const low = pl.hp > 0 && pl.hp <= pl.maxHp * cfg.clutchHpFraction;
    if (!low || calm == null || calm < cfg.clutchCalm) {
      perRound.clutchSince[pl.id] = null;
      return [];
    }
    if (perRound.clutchSince[pl.id] == null) perRound.clutchSince[pl.id] = s.t;
    if (s.t - perRound.clutchSince[pl.id] >= cfg.clutchHoldMs) {
      perRound.clutchFired[pl.id] = true;
      return [moment('calm_clutch', s.t, pl.id, { hp: Math.round(pl.hp), calm: round2(calm) })];
    }
    return [];
  }

  return {
    handle(type, payload) {
      return handlers[type]?.(payload) ?? [];
    },
    get snapshot() {
      return snap;
    },
  };
}

function round2(x) {
  return Math.round(x * 100) / 100;
}
