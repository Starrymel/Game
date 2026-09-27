import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = { addEventListener() {} };
const { createMatch, stepMatch, NEAR_PUNCH_PX } = await import('../../src/game.js');
const { setRemoteInput, clearRemoteInput } = await import('../../src/input.js');

const NEUTRAL = { left: false, right: false, up: false, down: false, light: false, lightNear: false, special: false };
const run = (m, input, steps = 5) => { setRemoteInput(1, input); for (let i = 0; i < steps; i++) stepMatch(m, 1 / 60, Date.now()); };
const fresh = (gap) => { const m = createMatch(); m.fighters[1].x = 300; m.fighters[2].x = 300 + gap; return m; };

test('lightNear punches when the opponent is within reach', () => {
  const m = fresh(NEAR_PUNCH_PX - 10);
  run(m, { ...NEUTRAL, lightNear: true });
  assert.equal(m.fighters[1].state, 'attack');
  assert.equal(m.fighters[1].attack.kind, 'light');
  clearRemoteInput(1);
});

test('lightNear does nothing when the opponent is far away (no wasted punches in the air)', () => {
  const m = fresh(NEAR_PUNCH_PX + 60);
  run(m, { ...NEUTRAL, lightNear: true });
  assert.notEqual(m.fighters[1].state, 'attack');
  clearRemoteInput(1);
});

test('plain light still punches at any distance, and older guests without lightNear still work', () => {
  const m = fresh(400);
  run(m, { ...NEUTRAL, light: true });
  assert.equal(m.fighters[1].state, 'attack');
  const m2 = fresh(60);
  run(m2, { left: false, right: false, up: false, down: false, light: true, special: false }); // no lightNear key at all
  assert.equal(m2.fighters[1].state, 'attack');
  clearRemoteInput(1);
});
