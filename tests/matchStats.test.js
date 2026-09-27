import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { matchStats } = createRequire(import.meta.url)('../server/lib/matchStats.js');

const ev = (t, type, player, payload = {}) => ({ t, type, player, payload });

test('counts punches, lasers, swords and prizes per player', () => {
  const s = matchStats([
    ev(1, 'attack', 1, { kind: 'laser' }), ev(2, 'attack', 1, { kind: 'laser' }), ev(3, 'attack', 1, { kind: 'light' }),
    ev(4, 'hit', 2, { attacker: 1, damage: 9, kind: 'laser' }),
    ev(5, 'hit', 2, { attacker: 1, damage: 5, kind: 'light', blocked: true }),
    ev(6, 'sword_hit', 2, { damage: 12 }), ev(7, 'sword_dodged', 1),
    ev(8, 'prize_caught', 1, { hp: 10 }), ev(9, 'prize_missed', null),
  ]);
  const p1 = s.players[1], p2 = s.players[2];
  assert.deepEqual(p1.lasers, { thrown: 2, landed: 1, accuracy: 50 });
  assert.deepEqual(p1.punches, { thrown: 1, landed: 1, accuracy: 100 });
  assert.equal(p1.damageDealt, 14);
  assert.equal(p2.damageTaken, 26);          // 9 + 5 from fists/laser, 12 from the sword
  assert.equal(p2.blocked, 1);
  assert.equal(p2.swordsHit, 1); assert.equal(p1.swordsDodged, 1);
  assert.equal(p1.prizesCaught, 1); assert.equal(p1.prizeHealed, 10);
  assert.equal(s.prizesMissed, 1);
});

test('older matches without attack events: thrown is unknown, not zero', () => {
  const s = matchStats([ev(1, 'hit', 2, { attacker: 1, damage: 8, kind: 'light' })]);
  assert.equal(s.players[1].punches.thrown, null);
  assert.equal(s.players[1].punches.landed, 1);
  assert.equal(s.players[1].punches.accuracy, null);
});
