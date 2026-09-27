import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
const { createMatch, stepMatch } = await import('../../src/game.js');
const { setRemoteInput, clearRemoteInput } = await import('../../src/input.js');
const { COMBAT } = await import('../../src/fighter.js');
const { beamGeometry } = await import('../../src/ui/effects.js');

const NEUTRAL = { left: false, right: false, up: false, down: false, light: false, lightNear: false, special: false, laser: false };
function fire(gap, { block = false, oppY = 0 } = {}) {
  const m = createMatch();
  m.fighters[1].x = 100; m.fighters[2].x = 100 + gap; m.fighters[1].meter = 100; m.fighters[2].y = oppY;
  if (block) setRemoteInput(2, { ...NEUTRAL, down: true });   // the defender holds block (state comes from input each tick)
  setRemoteInput(1, { ...NEUTRAL, special: true });
  for (let i = 0; i < 30; i++) stepMatch(m, 1 / 60, Date.now());   // 0.5 s: covers the active window
  clearRemoteInput(1); clearRemoteInput(2);
  return m;
}

test('the eye laser is mid-range: it hits from far away, but not beyond its reach', () => {
  const inRange = fire(300);
  assert.ok(inRange.fighters[2].hp < 100, 'hit at 300 px');
  assert.ok(100 - inRange.fighters[2].hp > COMBAT.specialDamage * 0.8, 'about full special damage');
  assert.equal(inRange.fighters[1].meter < 100, true, 'the laser spends the full meter');
  const tooFar = fire(COMBAT.specialRange + COMBAT.bodyWidth + 60);
  assert.equal(tooFar.fighters[2].hp, 100, 'no hit beyond the reach');
});

test('blocking still cuts laser damage, and a fighter high in a jump can avoid it', () => {
  const plain = 100 - fire(250).fighters[2].hp;
  const blocked = 100 - fire(250, { block: true }).fighters[2].hp;
  assert.ok(blocked > 0 && blocked < plain * 0.5, `blocked ${blocked} vs plain ${plain}`);
  assert.equal(fire(250, { oppY: 110 }).fighters[2].hp, 100);   // near the top of a jump: the beam passes underneath
});

test('the drawn beam reaches the target from mid-range and stops at the true reach otherwise', () => {
  const m = createMatch();
  m.fighters[1].x = 100; m.fighters[2].x = 380; m.fighters[1].attack = { kind: 'special', elapsedMs: 60, hasHit: false, phase: 'active' };
  const near = beamGeometry(m.fighters[1], m.fighters[2]);
  assert.equal(near.onTarget, true);
  m.fighters[2].x = 700;
  const far = beamGeometry(m.fighters[1], m.fighters[2]);
  assert.equal(far.onTarget, false);
  assert.equal(far.end.x, 100 + COMBAT.bodyWidth / 2 + COMBAT.specialRange);
});

// ---- the regular eyebrow laser (kind 'laser'): ranged, no meter, weaker than the special, can't be spammed ----
function fireLaser(gap, ms = 500, meter = 0) {
  const m = createMatch();
  m.fighters[1].x = 100; m.fighters[2].x = 100 + gap; m.fighters[1].meter = meter;
  setRemoteInput(1, { ...NEUTRAL, laser: true });
  for (let i = 0; i < Math.round(ms / 16.67); i++) stepMatch(m, 1 / 60, Date.now());
  clearRemoteInput(1);
  return m;
}

test('the laser shot is a regular attack: works with an empty meter, hits at range, weaker than the special', () => {
  const m = fireLaser(280);
  const dmg = 100 - m.fighters[2].hp;
  assert.ok(dmg > 0, 'hit at 280 px with an empty meter');
  assert.ok(dmg < COMBAT.specialDamage * 0.6, `weaker than the special: ${dmg}`);
  assert.ok(Math.abs(dmg - COMBAT.laserDamage) < 3, `about laserDamage: ${dmg}`);
  assert.equal(fireLaser(COMBAT.laserRange + COMBAT.bodyWidth + 60).fighters[2].hp, 100, 'nothing beyond its reach');
});

test('the laser cannot be spammed: a second shot has to wait out the recovery', () => {
  const m = createMatch();
  m.fighters[1].x = 100; m.fighters[2].x = 300;
  setRemoteInput(1, { ...NEUTRAL, laser: true });          // key held the whole time
  for (let i = 0; i < 60; i++) stepMatch(m, 1 / 60, Date.now());   // 1 second holding the button
  clearRemoteInput(1);
  const dmg = 100 - m.fighters[2].hp;
  assert.ok(dmg < COMBAT.laserDamage * 3, `at most about two shots in a second, took ${dmg}`);
});

test('the beam is drawn for the laser too (thinner than the special) and reaches the target', () => {
  const m = createMatch();
  m.fighters[1].x = 100; m.fighters[2].x = 350;
  m.fighters[1].attack = { kind: 'laser', elapsedMs: 50, hasHit: false, phase: 'active' };
  const b = beamGeometry(m.fighters[1], m.fighters[2]);
  assert.ok(b && b.onTarget && b.scale < 1);
  m.fighters[1].attack = { kind: 'special', elapsedMs: 50, hasHit: false, phase: 'active' };
  assert.equal(beamGeometry(m.fighters[1], m.fighters[2]).scale, 1);
});
