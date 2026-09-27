// Falling swords: every few seconds a sword drops from the sky at a marked spot. Stay out of the spot (walk, jump or
// block) or lose HP. Host-authoritative like the prize: the state lives on the match and rides along in the net state.
// Off unless enabled (setHazardEnabled(true), see main.js).
import { STAGE, COMBAT, hurtbox, overlaps } from './fighter.js';

export const HAZARD = {
  firstDelayS: 10,        // first sword after the round starts
  minGapS: 6, maxGapS: 9, // wait between one sword ending and the next warning
  warnS: 1.0,             // the floor marker is shown this long before the sword falls (fair notice, even for head controls)
  fallSpeed: 560,         // px/sec
  stuckS: 0.55,           // stays embedded in the floor briefly (harmless) before vanishing
  spawnTipHeight: 430,    // tip height above the floor when it starts (whole sword is off-screen)
  width: 30,              // drawn width of the plain sword
  length: 84,             // blade length (also the height of the danger zone)
  hitRadius: 50,          // you are hit if your body centre is within this many px of the sword's line: the red marker on the floor
                          // is drawn a little wider than this, so what looks dangerous IS dangerous, and its edge is safe
  damage: 12,
  aimJitter: 45,          // aimed at a fighter, +/- this many px (less than hitRadius: standing still always gets you hit; you have to move)
  artSlots: 3,            // sword1.png .. sword3.png in assets/hazards/ (see the README there)
  margin: 60,
};

let enabled = false;
export const setHazardEnabled = (v) => { enabled = !!v; };
export const isHazardEnabled = () => enabled;

export function createHazard() {
  return { phase: 'idle', x: 0, yh: HAZARD.spawnTipHeight, art: 0, t: 0, timer: HAZARD.firstDelayS, seq: 0, hitIds: [], lastHit: null };
}

// What the guest needs to draw it.
export function publicHazard(h) {
  if (!h) return null;
  return { phase: h.phase, x: h.x, yh: h.yh, art: h.art, t: h.t, seq: h.seq, lastHit: h.lastHit };
}

// Does the falling sword hurt this fighter right now? Horizontal: inside the marker's danger lane (a fighter's drawn sprite is
// much wider than the physics body, so a thin sword-sized box felt like "it hit me but did nothing"). Vertical: the blade
// and the fighter's body overlap in height (a fighter high in a jump can pass over the tip).
export function swordHits(h, f) {
  if (Math.abs(h.x - f.x) > HAZARD.hitRadius) return false;
  return h.yh <= f.y + COMBAT.bodyHeight && h.yh + HAZARD.length >= f.y;
}

// The sword's body, tip at the bottom: canvas coordinates, same space as hurtbox().
export function swordBox(h) {
  const tipY = STAGE.groundY - h.yh;
  return { x: h.x - HAZARD.width / 2, y: tipY - HAZARD.length, w: HAZARD.width, h: HAZARD.length };
}

// Advance one physics step.
// hooks.hurt(fighter, baseDamage) applies the damage (blocking, flinch, KO live in game.js) and returns what was dealt.
// hooks.emit(name, payload) reports events. random is injectable for tests.
export function stepHazard(match, dt, { random = Math.random, emit = () => {}, hurt = () => 0 } = {}) {
  if (!enabled || !match.hazard) return;
  const h = match.hazard;
  if (match.over) { h.phase = 'idle'; return; }

  if (h.phase === 'idle') {
    h.timer -= dt;
    if (h.timer > 0) return;
    // Aim at a random living fighter (so the warning matters), not somewhere harmless.
    const alive = [1, 2].filter((id) => match.fighters[id] && match.fighters[id].state !== 'ko');
    const target = match.fighters[alive[Math.floor(random() * alive.length)] ?? 1];
    const jitter = (random() - 0.5) * 2 * HAZARD.aimJitter;
    h.x = Math.max(HAZARD.margin, Math.min(STAGE.width - HAZARD.margin, (target?.x ?? STAGE.width / 2) + jitter));
    h.art = Math.floor(random() * HAZARD.artSlots);
    h.phase = 'warn'; h.t = 0; h.yh = HAZARD.spawnTipHeight; h.hitIds = []; h.seq += 1;
    emit('hazard_warn', { x: h.x });
    return;
  }

  h.t += dt;
  if (h.phase === 'warn') {
    if (h.t >= HAZARD.warnS) { h.phase = 'fall'; h.t = 0; emit('hazard_fall', { x: h.x }); }
    return;
  }

  if (h.phase === 'fall') {
    h.yh = Math.max(0, h.yh - HAZARD.fallSpeed * dt);
    for (const id of [1, 2]) {
      const f = match.fighters[id];
      if (!f || f.state === 'ko' || h.hitIds.includes(id) || !swordHits(h, f)) continue;
      h.hitIds.push(id);
      const dealt = hurt(f, HAZARD.damage);
      h.lastHit = { player: id, hp: Math.round(dealt), seq: h.seq };
      emit('hazard_hit', { player: id, damage: dealt, t: Date.now() });
      if (match.over) { h.phase = 'idle'; return; }
    }
    if (h.yh <= 0) { h.phase = 'stuck'; h.t = 0; }
    return;
  }

  if (h.phase === 'stuck' && h.t >= HAZARD.stuckS) {           // harmless now; gone, and the next one is scheduled
    h.phase = 'idle';
    h.timer = HAZARD.minGapS + random() * (HAZARD.maxGapS - HAZARD.minGapS);
  }
}
