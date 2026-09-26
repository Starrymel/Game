// Generates a plausible fake match so the dashboard can be built before real data exists.
function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

function fakeMatch(seed = Date.now(), durationMs = 90000) {
  const r = rng(seed);
  const id = 'fake-' + seed.toString(36);
  const hp = [100, 100], meter = [0, 0], hr = [78, 82], stress = [0.2, 0.2], breath = [14, 15];
  const samples = [], events = [], snapshots = [];
  let ko = null, nextHitAt = 2000, healStreak = [0, 0];
  for (let t = 0; t <= durationMs && !ko; t += 250) {
    if (t >= nextHitAt) {
      const victim = r() < 0.5 ? 0 : 1;
      const flinchy = stress[victim] > 0.55;
      const base = 3 + r() * 7, mult = flinchy ? 1.35 : 1.0;
      const dmg = Math.round(base * mult * 10) / 10;
      hp[victim] = Math.max(0, hp[victim] - dmg);
      hr[victim] += 6 + r() * 8; stress[victim] = Math.min(1, stress[victim] + 0.18);
      meter[1 - victim] = Math.min(100, meter[1 - victim] + dmg * 1.2);
      healStreak[victim] = 0;
      events.push({ t, type: 'hit', player: victim + 1, payload: { damage: dmg, multiplier: mult } });
      if (dmg > 12) events.push({ t: t + 20, type: 'big_hit', player: victim + 1, payload: { damage: dmg } });
      if (flinchy) events.push({ t: t + 40, type: 'flinch', player: victim + 1, payload: { stress: +stress[victim].toFixed(2) } });
      nextHitAt = t + 900 + r() * 2600;
      if (hp[victim] <= 0) { ko = victim + 1; events.push({ t: t + 60, type: 'ko', player: victim + 1, payload: {} }); }
    }
    for (const p of [0, 1]) {            // biometrics relax toward baseline, heal when calm
      hr[p] += (75 - hr[p]) * 0.02 + (r() - 0.5) * 1.2;
      stress[p] = Math.max(0.05, stress[p] - 0.011 + (r() - 0.5) * 0.01);
      breath[p] = 12 + stress[p] * 10 + (r() - 0.5);
      if (stress[p] < 0.35 && hp[p] < 100 && hp[p] > 0) {
        hp[p] = Math.min(100, hp[p] + 0.35 * (1.5 - stress[p]));
        if (++healStreak[p] === 12) events.push({ t, type: 'heal_streak', player: p + 1, payload: { seconds: 3 } });
      }
    }
    if (t % 500 === 0) for (const p of [0, 1]) samples.push({
      t, player: p + 1, hr: +hr[p].toFixed(1), breath: +breath[p].toFixed(1),
      stress: +stress[p].toFixed(2), calm: +(1 - stress[p]).toFixed(2), source: 'mock' });
    snapshots.push({ t, p1_hp: +hp[0].toFixed(1), p2_hp: +hp[1].toFixed(1), p1_meter: +meter[0].toFixed(1), p2_meter: +meter[1].toFixed(1) });
  }
  const dur = snapshots[snapshots.length - 1].t;
  return { match_id: id, meta: { p1_name: 'Mary', p2_name: 'Rival', source: 'mock' },
    samples, events, snapshots, end: { winner: ko ? 3 - ko : (hp[0] >= hp[1] ? 1 : 2), duration_ms: dur } };
}
module.exports = { fakeMatch };
