// Per-player numbers for one match, counted in code from the logged events (never by Gemini, so they cannot be invented).
// Shape of an event: { t, type, player, payload }. For 'hit' the player is the one who got hit (payload.attacker hit them);
// for 'attack' it is the attacker; sword_* / prize_* name the player they happened to.
// Older matches have no 'attack' events: "thrown" is then null (unknown), the other numbers still work.
const r1 = (x) => Math.round(x * 10) / 10;
const pct = (a, b) => (b > 0 ? Math.round((100 * a) / b) : null);

function matchStats(events = []) {
  const hasAttacks = events.some((e) => e.type === 'attack');
  const blank = () => ({
    punches: { thrown: hasAttacks ? 0 : null, landed: 0 },
    lasers: { thrown: hasAttacks ? 0 : null, landed: 0 },
    specials: 0,
    damageDealt: 0, damageTaken: 0, blocked: 0, biggestHit: 0,
    swordsHit: 0, swordsDodged: 0, swordDamage: 0,
    prizesCaught: 0, prizeHealed: 0,
  });
  const out = { 1: blank(), 2: blank() };
  let prizesMissed = 0;
  for (const e of events) {
    const p = e.player;
    const pl = e.payload || {};
    if (e.type === 'attack' && out[p]) {
      if (pl.kind === 'laser') out[p].lasers.thrown += 1;
      else if (pl.kind === 'light') out[p].punches.thrown += 1;
    } else if (e.type === 'hit' && out[p] && out[pl.attacker]) {
      const dmg = +pl.damage || 0, a = out[pl.attacker];
      a.damageDealt += dmg; out[p].damageTaken += dmg;
      if (pl.blocked) out[p].blocked += 1;
      if (dmg > a.biggestHit) a.biggestHit = dmg;
      if (pl.kind === 'laser') a.lasers.landed += 1;
      else if (pl.kind === 'special') a.specials += 1;
      else a.punches.landed += 1;
    } else if (e.type === 'sword_hit' && out[p]) {
      const dmg = +pl.damage || 0;
      out[p].swordsHit += 1; out[p].swordDamage += dmg; out[p].damageTaken += dmg;
    } else if (e.type === 'sword_dodged' && out[p]) {
      out[p].swordsDodged += 1;
    } else if (e.type === 'prize_caught' && out[p]) {
      out[p].prizesCaught += 1; out[p].prizeHealed += +pl.hp || 0;
    } else if (e.type === 'prize_missed') prizesMissed += 1;
  }
  for (const p of [1, 2]) {
    const s = out[p];
    for (const k of ['damageDealt', 'damageTaken', 'biggestHit', 'swordDamage', 'prizeHealed']) s[k] = Math.round(s[k]);
    s.punches.accuracy = pct(s.punches.landed, s.punches.thrown);
    s.lasers.accuracy = pct(s.lasers.landed, s.lasers.thrown);
  }
  return { players: out, prizesMissed, hasAttacks };
}

module.exports = { matchStats, r1 };
