import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.performance ??= { now: () => Date.now() };
const { beamGeometry, eyePositions } = await import('../../src/ui/effects.js');
const { makeFighter, COMBAT, hitbox, hurtbox, overlaps } = await import('../../src/fighter.js');

// A special in flight, elapsedMs into the attack.
function firing(f, elapsedMs, extra = {}) {
  f.attack = { kind: 'special', elapsedMs, hasHit: false, phase: elapsedMs <= COMBAT.specialActiveMs ? 'active' : 'recover', ...extra };
  f.state = 'attack';
  return f;
}

test('no beam without a special', () => {
  const a = makeFighter(1, 300, 1), d = makeFighter(2, 360, -1);
  assert.equal(beamGeometry(a, d), null);
  a.attack = { kind: 'light', elapsedMs: 50, hasHit: false, phase: 'active' };
  assert.equal(beamGeometry(a, d), null);
});

test('in range: beam ends on the opponent, exactly when the real hitbox would connect', () => {
  const a = firing(makeFighter(1, 300, 1), 60), d = makeFighter(2, 380, -1);
  assert.equal(overlaps(hitbox(a), hurtbox(d)), true, 'sanity: the engine would register this hit');
  const b = beamGeometry(a, d);
  assert.equal(b.onTarget, true);
  const t = hurtbox(d);
  assert.ok(b.end.x >= t.x && b.end.x <= t.x + t.w && b.end.y >= t.y && b.end.y <= t.y + t.h, 'ends inside the opponent');
});

test('out of range: beam stops at the special\'s true reach, never at the opponent', () => {
  const a = firing(makeFighter(1, 200, 1), 60), d = makeFighter(2, 600, -1);
  assert.equal(overlaps(hitbox(a), hurtbox(d)), false, 'sanity: the engine would not register this');
  const b = beamGeometry(a, d);
  assert.equal(b.onTarget, false);
  assert.equal(b.end.x, 200 + COMBAT.bodyWidth / 2 + COMBAT.specialRange);
});

test('beam starts at both eyes and mirrors with facing', () => {
  const right = makeFighter(2, 400, 1), left = makeFighter(2, 400, -1);
  const r = eyePositions(right), l = eyePositions(left);
  assert.equal(r.length, 2);
  for (let i = 0; i < 2; i++) {
    assert.ok(Math.abs((r[i].x - 400) + (l[i].x - 400)) < 1e-9, 'mirrored around the fighter');
    assert.equal(r[i].y, l[i].y);
    assert.ok(r[i].y < hurtbox(right).y + 20, 'eyes are up at head height');
  }
  const jumping = makeFighter(2, 400, 1);
  jumping.y = 50;
  assert.equal(eyePositions(jumping)[0].y, r[0].y - 50, 'follows jumps');
});

test('fades in, holds for the active window, fades out during recovery', () => {
  const d = makeFighter(2, 380, -1);
  const alpha = (ms) => beamGeometry(firing(makeFighter(1, 300, 1), ms), d)?.alpha ?? 0;
  assert.ok(alpha(5) < alpha(60));
  assert.equal(alpha(COMBAT.specialActiveMs), 1);
  assert.ok(alpha(COMBAT.specialActiveMs + 100) > 0 && alpha(COMBAT.specialActiveMs + 100) < 1);
  assert.equal(alpha(COMBAT.specialActiveMs + 250), 0);
});

test('stays on a target it already hit, but not on a KO\'d body it missed', () => {
  const a = firing(makeFighter(1, 200, 1), 180, { hasHit: true }), d = makeFighter(2, 600, -1);
  assert.equal(beamGeometry(a, d).onTarget, true, 'hit registered earlier: keep the beam on them while fading');
  const miss = firing(makeFighter(1, 300, 1), 60), ko = makeFighter(2, 380, -1);
  ko.state = 'ko';
  assert.equal(beamGeometry(miss, ko).onTarget, false);
});
