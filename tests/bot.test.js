import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis.window || { addEventListener() {} };
const { setBotEnabled, isBotEnabled, stepBot, BOT } = await import('../src/bot.js');
const { readInput, clearRemoteInput } = await import('../src/input.js');
const { makeFighter, COMBAT } = await import('../src/fighter.js');

const mk = (dist) => ({ fighters: { 1: makeFighter(1, 400 - dist / 2, 1), 2: makeFighter(2, 400 + dist / 2, -1) } });
const hi = () => 0;   // always beats a `random() < chance` check
const lo = () => 1;   // always fails one

test('disabled by default: stepBot does not touch either player\'s input', () => {
  setBotEnabled(false);
  stepBot(mk(300), 1000);
  assert.equal(readInput(1).left || readInput(1).right, false);
  assert.equal(readInput(2).left || readInput(2).right, false);
});

test('far from the opponent: it walks in, does not attack, and never drives Player 1', () => {
  setBotEnabled(true, 2);
  const m = mk(COMBAT.laserRange + 100); // out of even laser range
  stepBot(m, 0, hi);
  const p2 = readInput(2);
  assert.equal(p2.left || p2.right, true);
  assert.equal(p2.light || p2.laser || p2.special, false);
  assert.equal(readInput(1).left || readInput(1).right, false);
});

test('in melee range: it can throw a light punch (forced to always beat the attack roll)', () => {
  setBotEnabled(true, 2);
  const m = mk(30); // well inside lightRange + bodyWidth
  stepBot(m, 0, hi);
  assert.equal(readInput(2).light, true);
});

test('never attacks when the roll fails, even in range', () => {
  setBotEnabled(true, 2);
  const m = mk(30);
  stepBot(m, 0, lo);
  const p2 = readInput(2);
  assert.equal(p2.light, false);
  assert.equal(p2.laser, false);
  assert.equal(p2.special, false);
});

test('blocks an incoming hit it "sees" (forced to always beat the block roll), then releases the block', () => {
  setBotEnabled(true, 2);
  const m = mk(30);
  m.fighters[1].attack = { kind: 'light', elapsedMs: 10, hasHit: false, phase: 'active' };
  stepBot(m, 1000, hi);
  assert.equal(readInput(2).down, true);
  assert.equal(readInput(2).light, false); // never attacks and blocks at once
  stepBot(m, 1000 + BOT.blockHoldMs + 1, lo); // past the block window, and the roll fails this time
  assert.equal(readInput(2).down, false);
});

test('turning it off clears the override so both seats go neutral again', () => {
  setBotEnabled(true, 2);
  stepBot(mk(30), 0, hi);
  setBotEnabled(false, 2);
  assert.equal(readInput(2).light, false);
  assert.equal(readInput(2).left || readInput(2).right, false);
});

test('isBotEnabled reflects the current state', () => {
  setBotEnabled(false);
  assert.equal(isBotEnabled(), false);
  setBotEnabled(true, 2);
  assert.equal(isBotEnabled(), true);
  clearRemoteInput(2);
});
