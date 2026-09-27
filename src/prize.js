// Falling prize: every so often something drops from the top of the arena; the first fighter to touch it
// gets a heal and some special meter. Host-authoritative: the state lives on the match object, so it rides
// along in the net state that the guest renders. Off unless enabled (setPrizeEnabled(true), see main.js).
import { STAGE, hurtbox, overlaps } from './fighter.js';

export const PRIZE = {
  firstDelayS: 4,      // first drop after the round starts
  minGapS: 7, maxGapS: 11, // wait between the previous prize ending and the next drop
  fallSpeed: 130,      // px/sec
  landedHeightPx: 26,  // resting height above the ground (centre of the prize)
  spawnHeightPx: 340,  // start height above the ground (top of the arena)
  lingerS: 6,          // how long a landed prize stays before it vanishes
  size: 38,            // collision + draw size in px
  healHp: 15,
  meterGain: 30,
  artSlots: 3,         // prize1.png .. prize3.png in assets/prizes/ (see README there)
  margin: 90,          // keep drops away from the arena edges
};

let enabled = false;
export const setPrizeEnabled = (v) => { enabled = !!v; };
export const isPrizeEnabled = () => enabled;

export function createPrize() {
  return { active: false, x: 0, yh: 0, art: 0, landed: false, ttl: 0, timer: PRIZE.firstDelayS, seq: 0, lastCatch: null };
}

// What the guest needs to draw it (kept small: this is sent every frame).
export function publicPrize(p) {
  if (!p) return null;
  return { active: p.active, x: p.x, yh: p.yh, art: p.art, landed: p.landed, ttl: p.ttl, seq: p.seq, lastCatch: p.lastCatch };
}

export function prizeBox(p) {
  const s = PRIZE.size;
  return { x: p.x - s / 2, y: STAGE.groundY - p.yh - s / 2, w: s, h: s };
}

// Advance one physics step. `hooks.emit(name, payload)` reports events; `random` is injectable for tests.
export function stepPrize(match, dt, { random = Math.random, emit = () => {} } = {}) {
  if (!enabled || !match.prize) return;
  const p = match.prize;
  if (match.over) { p.active = false; return; }

  if (!p.active) {
    p.timer -= dt;
    if (p.timer <= 0) {
      p.active = true; p.landed = false; p.ttl = PRIZE.lingerS;
      p.x = PRIZE.margin + random() * (STAGE.width - 2 * PRIZE.margin);
      p.yh = PRIZE.spawnHeightPx;
      p.art = Math.floor(random() * PRIZE.artSlots);
      p.seq += 1;
      emit('prize_spawn', { x: p.x, art: p.art });
    }
    return;
  }

  if (!p.landed) {
    p.yh = Math.max(PRIZE.landedHeightPx, p.yh - PRIZE.fallSpeed * dt);
    if (p.yh <= PRIZE.landedHeightPx) p.landed = true;
  } else {
    p.ttl -= dt;
    if (p.ttl <= 0) { emit('prize_missed', {}); p.active = false; p.timer = PRIZE.minGapS + random() * (PRIZE.maxGapS - PRIZE.minGapS); return; }
  }

  // First fighter to touch it wins it (fighter 1 checked first on an exact tie).
  const box = prizeBox(p);
  for (const id of [1, 2]) {
    const f = match.fighters[id];
    if (!f || f.state === 'ko' || !overlaps(hurtbox(f), box)) continue;
    const before = f.hp;
    f.hp = Math.min(f.maxHp, f.hp + PRIZE.healHp);
    f.meter = Math.min(f.maxMeter, f.meter + PRIZE.meterGain);
    p.active = false;
    p.timer = PRIZE.minGapS + random() * (PRIZE.maxGapS - PRIZE.minGapS);
    p.lastCatch = { player: id, hp: Math.round(f.hp - before), seq: p.seq };
    emit('prize_caught', { player: id, hp: f.hp - before, meter: PRIZE.meterGain, t: Date.now() });
    return;
  }
}
