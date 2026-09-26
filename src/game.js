import { bus } from './eventBus.js';
import { Mechanics } from './mechanics.js';
import { getBiometrics } from './biometrics.js';
import { readInput } from './input.js';
import {
  STAGE, PHYSICS, COMBAT, makeFighter, hurtbox, hitbox, overlaps,
} from './fighter.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const STEP_MS = 1000 / 60;
const SNAPSHOT_MS = 250;
const ROUND_SECONDS = 99;
const MIN_SEPARATION = 46;
const BLOCK_DAMAGE_REDUCTION = 0.7;

export function createMatch() {
  const match = {
    round: 1,
    timeRemaining: ROUND_SECONDS,
    over: false,
    fighters: {
      1: makeFighter(1, STAGE.width * 0.3, 1),
      2: makeFighter(2, STAGE.width * 0.7, -1),
    },
  };
  bus.emit('round_start', { round: match.round, t: Date.now() });
  return match;
}

export function resetMatch(match) {
  match.round += 1;
  match.timeRemaining = ROUND_SECONDS;
  match.over = false;
  match.fighters[1] = makeFighter(1, STAGE.width * 0.3, 1);
  match.fighters[2] = makeFighter(2, STAGE.width * 0.7, -1);
  bus.emit('round_start', { round: match.round, t: Date.now() });
}

const latestBiometrics = { 1: null, 2: null };
bus.on('biometric_sample', ({ player, ...s }) => {
  latestBiometrics[player] = { player, ...s };
});

function startAttack(f, kind) {
  f.attack = {
    kind,
    elapsedMs: 0,
    hasHit: false,
    phase: 'active',
  };
  f.state = 'attack';
}

function resolveHit(match, attacker, defender, kind, t) {
  const baseDamage = kind === 'special' ? COMBAT.specialDamage : COMBAT.lightDamage;
  let dmg = Mechanics.calcDamage(baseDamage, attacker, defender);

  const blocking = defender.state === 'block';
  if (blocking) dmg *= (1 - BLOCK_DAMAGE_REDUCTION);
  dmg = Math.max(0, dmg);

  defender.hp = clamp(defender.hp - dmg, 0, defender.maxHp);
  bus.emit('hit', { attacker: attacker.id, defender: defender.id, damage: dmg, kind, t });

  const flinchMult = Mechanics.calcFlinchMultiplier(defender);
  defender.flinchMs = COMBAT.flinchBaseMs * flinchMult;
  defender.state = 'flinch';
  bus.emit('flinch', { player: defender.id, magnitude: clamp(flinchMult / 2, 0, 1), t });

  if (Mechanics.meterGateOpen(attacker)) {
    const gain = Mechanics.meterGain(attacker, 'hit_landed', COMBAT.meterOnHitLanded);
    if (gain) {
      const wasFull = attacker.meter >= attacker.maxMeter;
      attacker.meter = clamp(attacker.meter + gain, 0, attacker.maxMeter);
      bus.emit('meter_gain', { player: attacker.id, amount: gain, t });
      if (!wasFull && attacker.meter >= attacker.maxMeter) {
        bus.emit('meter_full', { player: attacker.id, t });
      }
    }
  }
  if (Mechanics.meterGateOpen(defender)) {
    const gain = Mechanics.meterGain(defender, 'hit_taken', COMBAT.meterOnHitTaken);
    if (gain) {
      defender.meter = clamp(defender.meter + gain, 0, defender.maxMeter);
      bus.emit('meter_gain', { player: defender.id, amount: gain, t });
    }
  }

  if (kind === 'special') {
    attacker.meter = 0;
    bus.emit('special', { player: attacker.id, t });
  }

  if (defender.hp <= 0 && !match.over) {
    match.over = true;
    defender.state = 'ko';
    bus.emit('ko', { winner: attacker.id, loser: defender.id, t });
    bus.emit('round_end', { round: match.round, winner: attacker.id, t });
  }
}

function updateFighter(match, f, opponent, dtSeconds, t) {
  f.biometrics = latestBiometrics[f.id] ?? getBiometrics(f.id) ?? f.biometrics;

  if (f.state === 'ko') return;

  const input = readInput(f.id);

  // Heal tick applies regardless of state; B's formula decides when it matters.
  const healAmount = Mechanics.healTick(f, dtSeconds);
  if (healAmount) {
    f.hp = clamp(f.hp + healAmount, 0, f.maxHp);
    bus.emit('heal_tick', { player: f.id, amount: healAmount, t });
  }

  if (Mechanics.meterGateOpen(f)) {
    const passiveGain = Mechanics.meterGain(f, 'tick', 0);
    if (passiveGain) {
      const wasFull = f.meter >= f.maxMeter;
      f.meter = clamp(f.meter + passiveGain, 0, f.maxMeter);
      bus.emit('meter_gain', { player: f.id, amount: passiveGain, t });
      if (!wasFull && f.meter >= f.maxMeter) bus.emit('meter_full', { player: f.id, t });
    }
  }

  if (f.flinchMs > 0) {
    f.flinchMs -= dtSeconds * 1000;
    if (f.flinchMs <= 0) {
      f.flinchMs = 0;
      f.state = 'idle';
    } else {
      return; // locked out while flinching
    }
  }

  if (f.attack) {
    f.attack.elapsedMs += dtSeconds * 1000;
    const activeMs = f.attack.kind === 'special' ? COMBAT.specialActiveMs : COMBAT.lightActiveMs;
    const recoverMs = f.attack.kind === 'special' ? COMBAT.specialRecoverMs : COMBAT.lightRecoverMs;

    if (f.attack.phase === 'active') {
      if (!f.attack.hasHit) {
        const hb = hitbox(f);
        if (hb && overlaps(hb, hurtbox(opponent)) && opponent.state !== 'ko') {
          f.attack.hasHit = true;
          resolveHit(match, f, opponent, f.attack.kind, t);
        }
      }
      if (f.attack.elapsedMs >= activeMs) f.attack.phase = 'recover';
    } else if (f.attack.elapsedMs >= activeMs + recoverMs) {
      f.attack = null;
      f.state = 'idle';
    }
    return; // no movement while attacking
  }

  // Facing: track opponent when not mid-action.
  f.facing = f.x < opponent.x ? 1 : -1;

  // Vertical / jump
  if (f.y > 0 || f.vy !== 0) {
    f.vy -= PHYSICS.gravity * dtSeconds;
    f.y = Math.max(0, f.y + f.vy * dtSeconds);
    if (f.y === 0) f.vy = 0;
    f.state = f.y > 0 ? 'jump' : 'idle';
  } else if (input.up) {
    f.vy = PHYSICS.jumpVelocity;
    f.state = 'jump';
  }

  // Horizontal movement (allowed while jumping too)
  let dx = 0;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;
  if (dx !== 0) {
    const next = f.x + dx * PHYSICS.moveSpeed * dtSeconds;
    const minX = COMBAT.bodyWidth / 2;
    const maxX = STAGE.width - COMBAT.bodyWidth / 2;
    const sepClamped = f.id === 1
      ? Math.min(next, opponent.x - MIN_SEPARATION)
      : Math.max(next, opponent.x + MIN_SEPARATION);
    f.x = clamp(sepClamped, minX, maxX);
    if (f.y === 0) f.state = 'walk';
  }

  if (f.y === 0 && dx === 0) {
    f.state = input.down ? 'block' : 'idle';
  }

  // Attack start (grounded only, not while blocking)
  if (f.y === 0 && f.state !== 'block') {
    if (input.special && f.meter >= f.maxMeter) {
      startAttack(f, 'special');
    } else if (input.light) {
      startAttack(f, 'light');
    }
  }
}

export function stepMatch(match, dtSeconds, t) {
  if (match.over) return;

  match.timeRemaining = Math.max(0, match.timeRemaining - dtSeconds);
  if (match.timeRemaining === 0) {
    match.over = true;
    const f1 = match.fighters[1], f2 = match.fighters[2];
    const winner = f1.hp === f2.hp ? null : (f1.hp > f2.hp ? 1 : 2);
    bus.emit('round_end', { round: match.round, winner, t });
    return;
  }

  updateFighter(match, match.fighters[1], match.fighters[2], dtSeconds, t);
  updateFighter(match, match.fighters[2], match.fighters[1], dtSeconds, t);
}

export function buildSnapshot(match, t) {
  const p = (id) => {
    const f = match.fighters[id];
    return {
      id: f.id, hp: f.hp, maxHp: f.maxHp, meter: f.meter, maxMeter: f.maxMeter,
      x: f.x, y: f.y, facing: f.facing, state: f.state, biometrics: f.biometrics,
    };
  };
  return { t, round: match.round, timeRemaining: match.timeRemaining, players: [p(1), p(2)] };
}

export function runLoop({ onSnapshot, onRender } = {}) {
  const match = createMatch();
  let physicsAccMs = 0;
  let snapshotAccMs = 0;
  let last = performance.now();

  function frame(now) {
    const frameMs = Math.min(now - last, 250); // clamp huge tab-switch gaps
    last = now;
    physicsAccMs += frameMs;
    snapshotAccMs += frameMs;

    while (physicsAccMs >= STEP_MS) {
      stepMatch(match, STEP_MS / 1000, Date.now());
      physicsAccMs -= STEP_MS;
    }

    if (snapshotAccMs >= SNAPSHOT_MS) {
      snapshotAccMs -= SNAPSHOT_MS;
      const snap = buildSnapshot(match, Date.now());
      bus.emit('state_snapshot', snap);
      onSnapshot?.(snap);
    }

    onRender?.(match);
    requestAnimationFrame(frame);
  }

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'r') resetMatch(match);
  });

  requestAnimationFrame(frame);
  return match;
}
