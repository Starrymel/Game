// Solo-play opponent: when no second person is on the keyboard, Player 2 can be driven by a small
// bot instead of standing in for a real guest. It closes or holds distance, throws light/laser/special
// attacks when in range, and sometimes blocks a hit it sees coming -- not a perfect reader, so it's
// beatable. Feeds input through the same override slot netplay uses for a remote player (see input.js
// setRemoteInput), so nothing downstream (game.js's combat, hazards, prizes) needs to know the input
// isn't a real person, and a disabled bot clears the same way a dropped connection does.
import { setRemoteInput, clearRemoteInput } from './input.js';
import { COMBAT, hitbox, hurtbox, overlaps } from './fighter.js';

export const BOT = {
  decisionMinS: 0.5, decisionMaxS: 1.1,  // how often it re-picks what to do next (movement or an attack)
  preferredRange: 90,                     // roughly the distance it tries to hold when not attacking
  approachSlack: 30,                      // dead zone around preferredRange before it bothers moving
  jumpChance: 0.06,
  lightChance: 0.35,   // chance it throws a light punch when in melee range and free to act -- was 0.55
  laserChance: 0.22,   // chance it fires the laser when in laser range and free to act -- was 0.35
  specialChance: 0.4,  // chance it spends a full meter on the special when in range -- was 0.6
  blockChance: 0.55,   // chance it blocks an incoming attack it sees coming -- deliberately not 100%
  blockHoldMs: 220,    // how long a triggered block is held
};

let enabled = false;
let target = 2, opponentId = 1;
let dir = 0, jumping = false;
let wantLight = false, wantLaser = false, wantSpecial = false;
let nextDecisionAt = 0;
let blockUntil = 0;

export function setBotEnabled(v, playerId = 2) {
  enabled = !!v;
  target = playerId;
  opponentId = playerId === 1 ? 2 : 1;
  nextDecisionAt = 0;   // re-roll on the next step rather than waiting out an old timer
  blockUntil = 0;
  if (!enabled) clearRemoteInput(target);
}
export function isBotEnabled() { return enabled; }

// Called once per rendered frame from the game loop with the live match object; a no-op unless solo
// mode turned it on, and safe to call before the match exists (guest-side, or the first frame).
export function stepBot(match, now = Date.now(), random = Math.random) {
  if (!enabled || !match?.fighters) return;
  const me = match.fighters[target], opp = match.fighters[opponentId];
  if (!me || !opp || me.state === 'ko') { clearRemoteInput(target); return; }

  const dist = Math.abs(me.x - opp.x);
  const facing = me.x < opp.x ? 1 : -1;

  // React to an incoming hit a little before it lands: see it once, then commit to blocking for a
  // short window, rather than reading every frame perfectly (that would be unbeatable).
  if (now >= blockUntil && !me.attack) {
    const theirHitbox = opp.attack?.phase === 'active' ? hitbox(opp) : null;
    if (theirHitbox && overlaps(theirHitbox, hurtbox(me)) && random() < BOT.blockChance) {
      blockUntil = now + BOT.blockHoldMs;
    }
  }
  const blocking = now < blockUntil;

  if (now >= nextDecisionAt && !blocking) {
    wantLight = wantLaser = wantSpecial = false;
    if (!me.attack) {
      if (me.meter >= me.maxMeter && dist <= COMBAT.specialRange && random() < BOT.specialChance) wantSpecial = true;
      else if (dist <= COMBAT.lightRange + COMBAT.bodyWidth && random() < BOT.lightChance) wantLight = true;
      else if (dist <= COMBAT.laserRange && random() < BOT.laserChance) wantLaser = true;
    }
    if (wantLight || wantLaser || wantSpecial) {
      dir = 0; jumping = false;
    } else {
      const tooFar = dist > BOT.preferredRange + BOT.approachSlack;
      const tooClose = dist < BOT.preferredRange - BOT.approachSlack;
      dir = tooFar ? facing : tooClose ? -facing : 0;
      jumping = random() < BOT.jumpChance;
    }
    nextDecisionAt = now + (BOT.decisionMinS + random() * (BOT.decisionMaxS - BOT.decisionMinS)) * 1000;
  }

  setRemoteInput(target, {
    left: !blocking && dir < 0, right: !blocking && dir > 0, up: !blocking && jumping, down: blocking,
    light: !blocking && wantLight, lightNear: false, special: !blocking && wantSpecial, laser: !blocking && wantLaser,
  });
}
