import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createMomentDetector, PRIORITY, DEFAULTS, thresholdsFrom } from '../../src/commentary/moments.js';
import { mechanicsConfig } from '../../src/mechanics.config.js';

// Magnitude the engine puts on the bus for a defender with this stress (B's formula / 2).
const flinchMag = (stress, c = mechanicsConfig) => (c.flinch.min + (c.flinch.max - c.flinch.min) * stress) / 2;
import { startCommentaryListener } from '../../src/commentary/listener.js';
import { replayMatchSync } from '../../tools/replay-match.js';

const bio = (hr = 80, calm = 0.5) => ({ hr, breath: 14, stress: 1 - calm, calm, source: 'mock' });
const snap = (t, hp1, hp2, b1 = bio(), b2 = bio()) => ({
  t, round: 1, timeRemaining: 90,
  players: [
    { id: 1, hp: hp1, maxHp: 100, meter: 0, maxMeter: 100, biometrics: b1 },
    { id: 2, hp: hp2, maxHp: 100, meter: 0, maxMeter: 100, biometrics: b2 },
  ],
});
const types = (ms) => ms.map((m) => m.type);

test('passes through ko/special/meter_full/round events with priorities', () => {
  const d = createMomentDetector();
  assert.deepEqual(types(d.handle('round_start', { round: 1, t: 0 })), ['round_start']);
  assert.deepEqual(types(d.handle('meter_full', { player: 1, t: 1 })), ['meter_full']);
  assert.deepEqual(types(d.handle('special', { player: 1, t: 2 })), ['special']);
  const [ko] = d.handle('ko', { winner: 1, loser: 2, t: 3 });
  assert.equal(ko.priority, PRIORITY.ko);
  assert.equal(ko.player, 1);
  assert.deepEqual(d.handle('ko', { winner: 1, loser: 2, t: 4 }), [], 'ko fires once per round');
  assert.ok(PRIORITY.ko > PRIORITY.special && PRIORITY.special > PRIORITY.big_flinch
    && PRIORITY.big_flinch > PRIORITY.hit);
});

test('round_end announced on time-out, suppressed after KO', () => {
  const d = createMomentDetector();
  assert.deepEqual(types(d.handle('round_end', { round: 1, winner: 1, t: 0 })), ['round_end']);
  d.handle('round_start', { round: 2, t: 1 });
  d.handle('ko', { winner: 2, loser: 1, t: 2 });
  assert.deepEqual(d.handle('round_end', { round: 2, winner: 2, t: 2 }), []);
});

test('big flinch: stressed defenders only, using the real magnitude range', () => {
  const d = createMomentDetector();
  assert.deepEqual(d.handle('flinch', { player: 2, magnitude: flinchMag(0), t: 0 }), [], 'calm');
  assert.deepEqual(d.handle('flinch', { player: 2, magnitude: flinchMag(0.3), t: 1 }), [], 'mock baseline stress');
  assert.deepEqual(d.handle('flinch', { player: 2, magnitude: flinchMag(0.5), t: 2 }), [], 'middling');
  assert.deepEqual(types(d.handle('flinch', { player: 2, magnitude: flinchMag(0.6), t: 3 })), ['big_flinch'], 'stressed hotkey, lowest point');
  assert.deepEqual(types(d.handle('flinch', { player: 2, magnitude: flinchMag(1), t: 4 })), ['big_flinch'], 'max stress');
});

test('thresholds stay inside what B\'s formulas can produce (guards future retuning)', () => {
  for (const config of [mechanicsConfig, { flinch: { min: 0.5, max: 2 }, heal: { base: 2, max: 3 } }]) {
    const th = thresholdsFrom(config);
    assert.ok(th.bigFlinchMagnitude > flinchMag(0.5, config), 'calm/middling players are not "big"');
    assert.ok(th.bigFlinchMagnitude <= flinchMag(0.6, config), 'a stressed player (hotkey minimum) is');
    const perWindow = (rate) => rate * th.healStreakWindowMs / 1000;
    assert.ok(perWindow(config.heal.base) >= th.healStreakHp, 'base-rate healing for the window reaches a streak');
    assert.ok(th.healStreakHp > 0);
  }
  assert.equal(DEFAULTS.bigFlinchMagnitude, thresholdsFrom().bigFlinchMagnitude);
});

test('combo after 3 hits in window; broken by gap or other attacker', () => {
  const d = createMomentDetector();
  const hit = (attacker, t) => types(d.handle('hit', { attacker, defender: 3 - attacker, damage: 5, kind: 'light', t }));
  assert.deepEqual(hit(1, 0), ['hit']);
  assert.deepEqual(hit(1, 1000), ['hit']);
  assert.deepEqual(hit(1, 2000), ['combo']);
  assert.deepEqual(hit(1, 9000), ['hit'], 'gap resets');
  assert.deepEqual(hit(1, 9500), ['hit']);
  assert.deepEqual(hit(2, 9600), ['hit'], 'other attacker resets');
  assert.deepEqual(hit(1, 9700), ['hit']);
});

test('heal streak: ~5s of real healing (60 ticks/s at B\'s base rate), reset by a hit, cooldown', () => {
  const d = createMomentDetector();
  const rate = mechanicsConfig.heal.base; // slowest real healing, 1 HP/s
  const heal = (from, to) => {
    const out = [];
    for (let t = from; t < to; t += 1000 / 60) out.push(...d.handle('heal_tick', { player: 1, amount: rate / 60, t: Math.round(t) }));
    return out;
  };
  assert.deepEqual(heal(0, 3000), [], '3s is not a streak yet');
  d.handle('hit', { attacker: 2, defender: 1, damage: 5, kind: 'light', t: 3000 });
  assert.deepEqual(heal(4400, 7400), [], 'hit wiped the streak; 3s again');
  const out = heal(7400, 9400);
  assert.deepEqual(types(out), ['heal_streak'], 'fires by 5s of uninterrupted healing');
  assert.ok(out[0].t - 4400 <= 5000);
  assert.deepEqual(heal(9400, 18000), [], 'cooldown');
});

test('heal streak never fires for a player who is not healing', () => {
  const d = createMomentDetector();
  const out = [];
  for (let t = 0; t < 20000; t += 1000 / 60) out.push(...d.handle('heal_tick', { player: 1, amount: 0, t: Math.round(t) }));
  assert.deepEqual(out, []);
});

test('comeback when a player erases a big deficit', () => {
  const d = createMomentDetector();
  assert.deepEqual(d.handle('state_snapshot', snap(0, 100, 60)), []);
  assert.deepEqual(d.handle('state_snapshot', snap(250, 90, 60)), []);
  const out = d.handle('state_snapshot', snap(500, 55, 60));
  assert.deepEqual(types(out), ['comeback']);
  assert.equal(out[0].player, 2);
  assert.equal(out[0].data.wasBehindBy, 40);
  assert.deepEqual(d.handle('state_snapshot', snap(750, 50, 60)), [], 'no repeat');
});

test('panic spike on HR jump within window, with cooldown', () => {
  const d = createMomentDetector();
  assert.deepEqual(d.handle('state_snapshot', snap(0, 100, 100, bio(80))), []);
  assert.deepEqual(d.handle('state_snapshot', snap(2000, 100, 100, bio(95))), []);
  const out = d.handle('state_snapshot', snap(4000, 100, 100, bio(101)));
  assert.deepEqual(types(out), ['panic_spike']);
  assert.deepEqual(out[0].data, { from: 80, to: 101 });
  assert.deepEqual(d.handle('state_snapshot', snap(5000, 100, 100, bio(80))), []);
  assert.deepEqual(d.handle('state_snapshot', snap(6000, 100, 100, bio(110))), [], 'cooldown');
});

test('slow HR drift outside the window is not a panic spike', () => {
  const d = createMomentDetector();
  let out = [];
  for (let t = 0, hr = 70; t <= 30000; t += 1000, hr += 1.5) {
    out.push(...d.handle('state_snapshot', snap(t, 100, 100, bio(hr))));
  }
  assert.deepEqual(out, []);
});

test('calm clutch: low HP + calm held for 2s, once per round', () => {
  const d = createMomentDetector();
  const calmLow = (t, calm = 0.8) => d.handle('state_snapshot', snap(t, 20, 100, bio(80, calm)));
  assert.deepEqual(calmLow(0), []);
  assert.deepEqual(calmLow(1000, 0.4), [], 'lost calm resets hold');
  assert.deepEqual(calmLow(1250), []);
  assert.deepEqual(calmLow(3000), []);
  assert.deepEqual(types(calmLow(3250)), ['calm_clutch']);
  assert.deepEqual(calmLow(9000), []);
  d.handle('round_start', { round: 2, t: 10000 });
  calmLow(10000);
  assert.deepEqual(types(calmLow(12000)), ['calm_clutch'], 're-armed next round');
});

test('moments carry compact HP/HR context from latest snapshot', () => {
  const d = createMomentDetector();
  d.handle('state_snapshot', snap(0, 82.4, 50, bio(91.6, 0.3)));
  const [m] = d.handle('special', { player: 1, t: 10 });
  assert.deepEqual(m.context.players[0], {
    id: 1, hp: 82, maxHp: 100, meter: 0, hr: 92, breath: 14, stress: 0.7, calm: 0.3,
  });
});

test('fake match fixture replays through the bus and hits every moment type', () => {
  const fixture = JSON.parse(readFileSync(new URL('../../fixtures/fake-match.json', import.meta.url)));
  const listeners = new Map();
  const bus = {
    on(type, fn) { listeners.set(type, [...(listeners.get(type) ?? []), fn]); return () => listeners.delete(type); },
    emit(type, p) { listeners.get(type)?.forEach((fn) => fn(p)); },
  };
  const seen = [];
  const listener = startCommentaryListener({ bus, onMoment: (m) => seen.push(m) });
  replayMatchSync(bus, fixture);

  const got = new Set(types(seen));
  // round_end is only announced on time-outs; the fixture ends in a KO.
  for (const t of Object.keys(PRIORITY)) if (t !== 'round_end') assert.ok(got.has(t), `missing ${t}`);
  assert.ok(!got.has('round_end'));

  const ko = seen.find((m) => m.type === 'ko');
  assert.equal(ko.data.winner, 2);
  const comeback = seen.find((m) => m.type === 'comeback');
  assert.equal(comeback.player, 2);
  assert.ok(comeback.t < ko.t);

  listener.stop();
  const before = seen.length;
  replayMatchSync(bus, fixture);
  assert.equal(seen.length, before, 'stop() unsubscribes');
});

test('replayMatch plays in scaled real time and restamps t', async () => {
  const fixture = { meta: {}, events: [
    { at: 0, type: 'x', payload: { t: 1 } },
    { at: 200, type: 'x', payload: { t: 2 } },
  ] };
  const got = [];
  const { replayMatch } = await import('../../tools/replay-match.js');
  const start = Date.now();
  const r = replayMatch({ emit: (_, p) => got.push(p) }, fixture, { speed: 4 });
  await r.done;
  assert.equal(got.length, 2);
  assert.ok(Date.now() - start >= 45, 'waited ~50ms at 4x');
  assert.ok(got[1].t >= start, 'restamped with Date.now()');
});
