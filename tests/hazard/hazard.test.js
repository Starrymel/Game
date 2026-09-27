import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || { addEventListener() {} };
const { createHazard, stepHazard, setHazardEnabled, publicHazard, HAZARD, swordBox } = await import('../../src/hazard.js');
const { makeFighter, hurtbox } = await import('../../src/fighter.js');
const { createMatch, stepMatch, buildNetState, matchFromNetState } = await import('../../src/game.js');
const { pickSwordArt } = await import('../../src/ui/hazardRender.js');
const { clearRemoteInput, setRemoteInput } = await import('../../src/input.js');

const rnd = (x) => () => x;
const mk = () => ({ over: false, hazard: createHazard(), fighters: { 1: makeFighter(1, 200, 1), 2: makeFighter(2, 600, -1) } });
const run = (m, secs, hooks) => { for (let i = 0; i < Math.round(secs * 60); i++) stepHazard(m, 1 / 60, hooks); };
function hookSet() {
  const log = { hurt: [], events: [] };
  return { log, random: rnd(0.0), emit: (n, p) => log.events.push(n), hurt: (f, d) => { log.hurt.push([f.id, d]); f.hp -= d; return d; } };
}

test('does nothing unless enabled', () => {
  setHazardEnabled(false);
  const m = mk(); run(m, 30, hookSet());
  assert.equal(m.hazard.phase, 'idle'); assert.equal(m.hazard.seq, 0);
});

test('warns first (no damage), then falls, sticks in the floor, vanishes, and schedules the next one', () => {
  setHazardEnabled(true);
  const m = mk(); const h = hookSet();
  m.fighters[1].x = 100;                       // far from the fighters' spawn spot: nobody is hit in this test
  m.fighters[2].x = 750;
  run(m, HAZARD.firstDelayS + 0.1, h);
  assert.equal(m.hazard.phase, 'warn');
  assert.ok(h.log.events.includes('hazard_warn'));
  const x = m.hazard.x;
  // stand exactly under it during the WARNING: no damage yet
  m.fighters[1].x = x;
  run(m, HAZARD.warnS - 0.2, h);
  assert.equal(m.hazard.phase, 'warn');
  assert.equal(h.log.hurt.length, 0, 'the marker itself never hurts');
  m.fighters[1].x = 100;                       // step out
  run(m, 0.4, h);
  assert.equal(m.hazard.phase, 'fall');
  run(m, 1.0, h);
  assert.equal(m.hazard.phase, 'stuck');
  assert.equal(h.log.hurt.length, 0, 'stepping aside works');
  run(m, HAZARD.stuckS + 0.1, h);
  assert.equal(m.hazard.phase, 'idle');
  assert.ok(m.hazard.timer > 0 && m.hazard.timer <= HAZARD.maxGapS, `next warning scheduled within ${HAZARD.maxGapS}s: ${m.hazard.timer}`);
  setHazardEnabled(false);
});

test('a fighter left under the falling sword is hurt exactly once', () => {
  setHazardEnabled(true);
  const m = mk(); const h = hookSet();
  m.fighters[1].x = 100; m.fighters[2].x = 750;
  run(m, HAZARD.firstDelayS + 0.1, h);
  m.fighters[1].x = m.hazard.x;               // walks into it and stays
  run(m, HAZARD.warnS + 1.5, h);
  assert.deepEqual(h.log.hurt, [[1, HAZARD.damage]]);
  assert.equal(m.hazard.lastHit.player, 1);
  assert.ok(h.log.events.includes('hazard_hit'));
  setHazardEnabled(false);
});

test('a jump at the right moment or a sideways step avoids it; both fighters can be hit by the same sword', () => {
  setHazardEnabled(true);
  const m = mk(); const h = hookSet();
  m.fighters[1].x = 380; m.fighters[2].x = 420;   // standing next to each other: one wide-ish sword can catch both? width 30 -> only overlapping ones
  run(m, HAZARD.firstDelayS + 0.1, h);
  m.hazard.x = 400;                                // force the sword between them (each body is 40 wide, so both overlap)
  run(m, HAZARD.warnS + 1.5, h);
  assert.deepEqual(h.log.hurt.map((x) => x[0]).sort(), [1, 2]);
  setHazardEnabled(false);
});

test('aimed at a living fighter, and never at the edges', () => {
  setHazardEnabled(true);
  for (const r of [0, 0.5, 0.99]) {
    const m = mk(); m.fighters[1].state = 'ko'; m.fighters[2].x = 600;
    run(m, HAZARD.firstDelayS + 0.1, { random: rnd(r), emit() {}, hurt: () => 0 });
    assert.ok(Math.abs(m.hazard.x - 600) <= HAZARD.aimJitter + 1, `x=${m.hazard.x} near the living fighter`);
    assert.ok(m.hazard.x >= HAZARD.margin && m.hazard.x <= 800 - HAZARD.margin);
  }
  setHazardEnabled(false);
});

test('engine: blocking cuts the damage, a hit flinches, and a sword can KO (the other player wins)', () => {
  setHazardEnabled(true);
  const put = (m, id, x) => { m.fighters[id].x = x; };
  const drop = (m, x) => { Object.assign(m.hazard, { phase: 'fall', x, yh: 200, t: 0, hitIds: [], seq: 1 }); };
  // plain hit
  let m = createMatch(); put(m, 1, 300); put(m, 2, 700); drop(m, 300);
  for (let i = 0; i < 60; i++) stepMatch(m, 1 / 60, Date.now());
  const plain = 100 - m.fighters[1].hp;
  assert.ok(plain > 5, `hurt: ${plain}`);
  assert.equal(m.fighters[2].hp, 100, 'the other fighter is untouched');
  // blocking (the defender holds "down")
  m = createMatch(); put(m, 1, 300); put(m, 2, 700); drop(m, 300);
  setRemoteInput(1, { left: false, right: false, up: false, down: true, light: false, lightNear: false, special: false, laser: false });
  for (let i = 0; i < 60; i++) stepMatch(m, 1 / 60, Date.now());
  clearRemoteInput(1);
  const blocked = 100 - m.fighters[1].hp;
  assert.ok(blocked > 0 && blocked < plain * 0.5, `blocked ${blocked} vs plain ${plain}`);
  // KO
  m = createMatch(); put(m, 1, 300); put(m, 2, 700); m.fighters[1].hp = 5; drop(m, 300);
  for (let i = 0; i < 60; i++) stepMatch(m, 1 / 60, Date.now());
  assert.equal(m.over, true);
  assert.equal(m.fighters[1].state, 'ko');
  setHazardEnabled(false);
});

test('online: the sword state rides along to the guest, small and complete', () => {
  const m = createMatch();
  Object.assign(m.hazard, { phase: 'warn', x: 321, t: 0.4, art: 2, seq: 7 });
  const net = buildNetState(m, Date.now());
  assert.deepEqual(Object.keys(net.hazard).sort(), ['art', 'lastHit', 'phase', 'seq', 't', 'x', 'yh']);
  const guest = matchFromNetState(JSON.parse(JSON.stringify(net)));
  assert.equal(guest.hazard.phase, 'warn'); assert.equal(guest.hazard.x, 321);
  assert.equal(publicHazard(null), null);
  const box = swordBox({ x: 100, yh: 0 });
  assert.equal(box.y + box.h, 320);                                     // tip on the floor
  assert.ok(hurtbox(m.fighters[1]).h > 0);
});

test('sword art: any file that exists is used, otherwise the plain drawn sword', () => {
  assert.equal(pickSwordArt(1, [null, null, null]), null);
  const ok = { complete: true, naturalWidth: 10 };
  assert.equal(pickSwordArt(2, [ok, null, null]), ok);
});
