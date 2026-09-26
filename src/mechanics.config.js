import { Mechanics } from './mechanics.js';
import { bus } from './eventBus.js';

export const mechanicsConfig = {
  smoothing: { samples: 8, staleMs: 3000 },
  sensor: { hrMin: 40, hrMax: 200, breathMin: 4, breathMax: 40 },
  breathing: { ideal: 10, tolerance: 10, variation: 4 },
  heal: { base: 1, bonus: 0.4, calmThreshold: 0.6, max: 1.4, delayMs: 1400 },
  damage: { min: 0.92, max: 1.08 },
  flinch: { min: 0.8, max: 1.2, spikeBpm: 25 },
  meter: { hrMin: 60, hrMax: 110, hysteresis: 3, passivePerSecond: 3, breathBonus: 0.5 },
  effects: { shakePx: 6, flashMs: 180, healMs: 350 },
};
export const biometricOverrides = { 1: null, 2: null };
const states = new WeakMap();
const lastHits = { 1: -Infinity, 2: -Infinity };
bus.on('hit', ({ defender, t }) => { lastHits[defender] = t; });
bus.on('round_start', () => { lastHits[1] = lastHits[2] = -Infinity; });
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const finite = (v, fallback) => Number.isFinite(v) ? v : fallback;
const mean = (list, key) => list.reduce((sum, row) => sum + row[key], 0) / list.length;

// One update per physics tick; repeated hook reads never bias the moving average.
export function updateBiofeedback(player, sample, dt, now = Date.now()) {
  let state = states.get(player);
  if (!state) { state = { rows: [], key: null, gate: false, override: false }; states.set(player, state); }
  const c = mechanicsConfig;
  const override = biometricOverrides[player.id];
  if (!!override !== state.override) { state.rows = []; state.key = null; state.override = !!override; }
  const raw = override ? { ...override, t: now, source: 'debug' } : sample;
  const valid = raw && ['hr', 'breath', 'stress', 'calm'].every(k => Number.isFinite(raw[k])) &&
    Number.isFinite(raw.t) && now - raw.t <= c.smoothing.staleMs && raw.t <= now + 1000;
  const key = override ? JSON.stringify(override) + ':' + Math.floor(now / 100) : raw?.source + ':' + raw?.t;
  if (valid && key !== state.key) {
    state.key = key;
    state.rows.push({ hr: clamp(raw.hr, c.sensor.hrMin, c.sensor.hrMax),
      breath: clamp(raw.breath, c.sensor.breathMin, c.sensor.breathMax),
      stress: clamp(raw.stress, 0, 1), calm: clamp(raw.calm, 0, 1) });
  }
  state.rows = state.rows.slice(-clamp(Math.round(c.smoothing.samples), 1, 60));
  if (!valid) { state.rows = []; state.key = null; }
  const rows = state.rows;
  const bio = valid && rows.length ? Object.fromEntries(['hr', 'breath', 'stress', 'calm'].map(k => [k, mean(rows, k)]))
    : { hr: 85, breath: 18, stress: 0.5, calm: 0.5 };
  const variation = rows.length ? Math.sqrt(mean(rows.map(r => ({ v: (r.breath - bio.breath) ** 2 })), 'v')) : 0;
  const breathing = clamp(1 - Math.abs(bio.breath - c.breathing.ideal) / c.breathing.tolerance, 0, 1) *
    clamp(1 - variation / c.breathing.variation, 0, 1);
  const spike = valid ? clamp((clamp(raw.hr, c.sensor.hrMin, c.sensor.hrMax) - bio.hr) / c.flinch.spikeBpm, 0, 1) : 0;
  const stress = Math.max(bio.stress, spike);
  const margin = state.gate ? c.meter.hysteresis : 0;
  state.gate = !!valid && bio.hr >= c.meter.hrMin - margin && bio.hr <= c.meter.hrMax + margin;
  const healRate = valid && bio.calm >= c.heal.calmThreshold
    ? clamp(c.heal.base * (1 + c.heal.bonus * bio.calm * breathing), 0, c.heal.max) : 0;
  const result = {
    ...bio, valid: !!valid, source: override ? 'debug' : raw?.source ?? 'missing', breathing, spike, gate: state.gate,
    damage: valid ? c.damage.min + (c.damage.max - c.damage.min) * stress : 1,
    flinch: valid ? c.flinch.min + (c.flinch.max - c.flinch.min) * stress : 1,
    healRate, healingReady: now - lastHits[player.id] >= c.heal.delayMs,
    meterMultiplier: 1 + c.meter.breathBonus * breathing,
    now, dt: clamp(finite(dt, 0), 0, 0.1),
  };
  player.biofeedback = result;
  if (override) player.biometrics = { ...raw, source: 'mock', player: player.id };
  return result;
}
const feedback = p => p.biofeedback ?? updateBiofeedback(p, p.biometrics, 0);
Mechanics.calcDamage = (base, attacker, defender) => Math.max(0, finite(base, 0)) * feedback(defender).damage;
Mechanics.calcFlinchMultiplier = p => feedback(p).flinch;
Mechanics.healTick = (p, dt) => {
  const b = feedback(p);
  return p.hp > 0 && b.now - lastHits[p.id] >= mechanicsConfig.heal.delayMs ? Math.min(Math.max(0, p.maxHp - p.hp), b.healRate * clamp(finite(dt, 0), 0, 0.1)) : 0;
};
Mechanics.meterGateOpen = p => feedback(p).gate;
Mechanics.meterGain = (p, event, base) => {
  const b = feedback(p);
  return b.gate ? Math.min(Math.max(0, p.maxMeter - p.meter),
    (event === 'tick' ? mechanicsConfig.meter.passivePerSecond * b.dt : Math.max(0, finite(base, 0))) * b.meterMultiplier) : 0;
};
