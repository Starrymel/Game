export const STAGE = { width: 800, height: 400, groundY: 320 };

export const PHYSICS = {
  moveSpeed: 220,       // px/sec
  gravity: 1400,        // px/sec^2, applied to vy each tick
  jumpVelocity: 560,    // px/sec, positive = upward
};

export const COMBAT = {
  lightDamage: 8,
  specialDamage: 25,
  lightRange: 55,
  laserDamage: 9,         // regular ranged attack (eyebrows): weaker than the special, but always available
  laserRange: 320,
  laserActiveMs: 120,
  laserRecoverMs: 450,    // long enough that it can't be spammed
  specialRange: 320,      // the eye laser: mid-range (was 65 when the special was a close-up move); the beam in ui/effects.js follows this
  lightActiveMs: 100,
  lightRecoverMs: 200,
  specialActiveMs: 150,
  specialRecoverMs: 350,
  flinchBaseMs: 250,
  meterOnHitLanded: 10,
  meterOnHitTaken: 5,
  maxMeter: 100,
  maxHp: 100,
  bodyWidth: 40,
  bodyHeight: 80,
};

export function makeFighter(id, x, facing) {
  return {
    id,
    x, y: 0, // y is height above ground, 0 = grounded
    vy: 0,
    facing, // 1 = facing right, -1 = facing left
    hp: COMBAT.maxHp,
    maxHp: COMBAT.maxHp,
    meter: 0,
    maxMeter: COMBAT.maxMeter,
    state: 'idle', // idle|walk|jump|attack|block|flinch|ko
    attack: null, // { kind, elapsedMs, hasHit, phase: 'active'|'recover' }
    flinchMs: 0,
    biometrics: { hr: 75, breath: 14, stress: 0, calm: 1, source: 'mock' },
  };
}

export function hurtbox(f) {
  return { x: f.x - COMBAT.bodyWidth / 2, y: STAGE.groundY - f.y - COMBAT.bodyHeight,
    w: COMBAT.bodyWidth, h: COMBAT.bodyHeight };
}

export function hitbox(f) {
  if (!f.attack || f.attack.phase !== 'active') return null;
  const range = f.attack.kind === 'special' ? COMBAT.specialRange : f.attack.kind === 'laser' ? COMBAT.laserRange : COMBAT.lightRange;
  const w = range, h = 24;
  const cx = f.x + f.facing * (COMBAT.bodyWidth / 2 + range / 2);
  const cy = STAGE.groundY - f.y - COMBAT.bodyHeight * 0.55;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function overlaps(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
