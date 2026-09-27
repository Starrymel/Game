import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrize, stepPrize, setPrizeEnabled, publicPrize, PRIZE, prizeBox } from '../../src/prize.js';
import { makeFighter, STAGE } from '../../src/fighter.js';
import { pickArt } from '../../src/ui/prizeRender.js';

const mkMatch = () => ({ over: false, prize: createPrize(), fighters: { 1: makeFighter(1, 100, 1), 2: makeFighter(2, 700, -1) } });
const run = (m, secs, opts) => { for (let i = 0; i < secs * 60; i++) stepPrize(m, 1 / 60, opts); };
const fixedRandom = (x) => () => x;

test('does nothing unless enabled', () => {
  setPrizeEnabled(false);
  const m = mkMatch(); run(m, 30);
  assert.equal(m.prize.active, false);
  assert.equal(m.prize.seq, 0);
});

test('spawns after the first delay, falls, lands, then vanishes if nobody catches it', () => {
  setPrizeEnabled(true);
  const m = mkMatch(); const ev = [];
  const opts = { random: fixedRandom(0.5), emit: (n, p) => ev.push(n) };
  run(m, PRIZE.firstDelayS - 0.5, opts); assert.equal(m.prize.active, false);
  run(m, 1, opts); assert.equal(m.prize.active, true); assert.ok(ev.includes('prize_spawn'));
  assert.equal(m.prize.x, PRIZE.margin + 0.5 * (STAGE.width - 2 * PRIZE.margin)); // 400: nobody stands there
  run(m, 1, opts); assert.ok(m.prize.yh < PRIZE.spawnHeightPx);
  run(m, 4, opts); assert.equal(m.prize.landed, true); assert.equal(m.prize.yh, PRIZE.landedHeightPx);
  run(m, PRIZE.lingerS + 0.5, opts); assert.equal(m.prize.active, false);
  assert.ok(m.prize.timer > 0);                 // counting down to the next drop
  setPrizeEnabled(false);
});

test('a fighter under the prize catches it: heals (capped), fills meter, reports the catch', () => {
  setPrizeEnabled(true);
  const m = mkMatch(); const ev = [];
  m.fighters[1].hp = 60; m.fighters[1].x = 400; m.fighters[1].meter = 90;
  const opts = { random: fixedRandom(0.5), emit: (n, p) => ev.push([n, p]) };
  run(m, 12, opts);
  assert.equal(m.fighters[1].hp, 60 + PRIZE.healHp);
  assert.equal(m.fighters[1].meter, 100);                // capped
  assert.equal(m.prize.active, false);
  assert.equal(m.prize.lastCatch.player, 1);
  assert.equal(m.prize.lastCatch.hp, PRIZE.healHp);
  assert.ok(ev.some(([n, p]) => n === 'prize_caught' && p.player === 1));
  assert.equal(m.fighters[2].hp, 100);
  setPrizeEnabled(false);
});

test('full-HP fighter still catches it (0 HP gained), and a KO fighter cannot', () => {
  setPrizeEnabled(true);
  const m = mkMatch(); m.fighters[1].x = 400; m.fighters[1].state = 'ko';
  m.fighters[2].x = 400;
  run(m, 12, { random: fixedRandom(0.5) });
  assert.equal(m.prize.lastCatch.player, 2);
  assert.equal(m.prize.lastCatch.hp, 0);
  setPrizeEnabled(false);
});

test('a jumping fighter can catch it in mid-air; round over clears it', () => {
  setPrizeEnabled(true);
  const m = mkMatch(); const opts = { random: fixedRandom(0.5) };
  run(m, PRIZE.firstDelayS + 1, opts);
  assert.equal(m.prize.active, true);
  assert.equal(m.prize.landed, false);
  m.fighters[1].x = m.prize.x; m.fighters[1].y = m.prize.yh - 20;   // body spans the prize's height
  stepPrize(m, 1 / 60, opts);
  assert.equal(m.prize.lastCatch.player, 1);                          // caught while still falling
  const m2 = mkMatch(); run(m2, PRIZE.firstDelayS + 0.5, opts);
  m2.over = true; stepPrize(m2, 1 / 60, opts);
  assert.equal(m2.prize.active, false);
  setPrizeEnabled(false);
});

test('publicPrize is small and pickArt falls back without loaded images', () => {
  const p = createPrize(); assert.deepEqual(Object.keys(publicPrize(p)).sort(), ['active', 'art', 'landed', 'lastCatch', 'seq', 'ttl', 'x', 'yh']);
  assert.equal(publicPrize(null), null);
  assert.equal(pickArt(1, [null, null, null]), null);
  const ok = { complete: true, naturalWidth: 10 };
  assert.equal(pickArt(1, [ok, null, null]), ok);
});
