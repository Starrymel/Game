import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncer } from '../../src/commentary/announcer.js';
import { FALLBACK_LINES, createFallbackPicker, fillTemplate } from '../../src/commentary/fallbackLines.js';
import { PRIORITY } from '../../src/commentary/moments.js';

const tick = () => new Promise((r) => setTimeout(r, 0));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Player whose clips only finish when the test says so.
function manualPlayer() {
  const played = [];
  let finish = null;
  return {
    played,
    play(text, moment) {
      played.push({ text, type: moment.type });
      return new Promise((r) => { finish = r; });
    },
    stop() { finish?.(); finish = null; },
    finish() { const f = finish; finish = null; f?.(); },
  };
}

function setup(opts = {}) {
  const clock = { t: 1000 };
  const player = manualPlayer();
  const drops = [];
  const lines = [];
  const a = createAnnouncer({
    player,
    now: () => clock.t,
    rng: () => 0,
    onDrop: (d) => drops.push(`${d.moment.type}:${d.reason}`),
    onLine: (l) => lines.push(l),
    options: { gapMs: 0, lineTimeoutMs: 50, ...opts.options },
    getLine: opts.getLine,
  });
  const m = (type, extra = {}) => ({ type, priority: PRIORITY[type], t: clock.t, player: 1, data: {}, ...extra });
  return { a, clock, player, drops, lines, m };
}

test('plays highest priority first once the current line finishes', async () => {
  const { a, player, m } = setup();
  a.enqueue(m('hit'));
  await tick();
  a.enqueue(m('meter_full'));
  a.enqueue(m('big_flinch'));
  a.enqueue(m('comeback'));
  player.finish(); await tick();
  player.finish(); await tick();
  player.finish(); await tick();
  assert.deepEqual(player.played.map((p) => p.type), ['hit', 'comeback', 'big_flinch', 'meter_full']);
});

test('KO interrupts lower-priority speech and plays next', async () => {
  const { a, player, drops, m } = setup();
  a.enqueue(m('big_flinch'));
  await tick();
  a.enqueue(m('hit'));
  a.enqueue(m('ko', { player: 2 }));
  await tick();
  assert.deepEqual(player.played.map((p) => p.type), ['big_flinch', 'ko']);
  assert.ok(drops.includes('big_flinch:interrupted'));
});

test('special does not interrupt KO', async () => {
  const { a, player, m } = setup();
  a.enqueue(m('ko'));
  await tick();
  a.enqueue(m('special'));
  await tick();
  assert.deepEqual(player.played.map((p) => p.type), ['ko']);
});

test('stale moments are dropped instead of played late', async () => {
  const { a, clock, player, drops, m } = setup();
  a.enqueue(m('special'));
  await tick();
  a.enqueue(m('hit'));             // maxAge 1200ms
  a.enqueue(m('round_end'));       // maxAge 6000ms
  clock.t += 2000;
  player.finish(); await tick();
  player.finish(); await tick();
  assert.ok(drops.includes('hit:stale'));
  assert.deepEqual(player.played.map((p) => p.type), ['special', 'round_end']);
});

test('per-type cooldown suppresses spam', async () => {
  const { a, clock, player, drops, m } = setup();
  a.enqueue(m('big_flinch'));
  await tick(); player.finish(); await tick();
  clock.t += 1000;
  a.enqueue(m('big_flinch'));
  assert.ok(drops.includes('big_flinch:cooldown'));
  clock.t += 4000;
  a.enqueue(m('big_flinch'));
  await tick();
  assert.equal(player.played.filter((p) => p.type === 'big_flinch').length, 2);
});

test('one queued moment per type (newer replaces older) and queue is capped', async () => {
  const { a, drops, m } = setup({ options: { maxQueue: 2 } });
  a.enqueue(m('special'));
  await tick();                              // speaking special
  a.enqueue(m('combo', { player: 1 }));
  a.enqueue(m('combo', { player: 2 }));
  assert.ok(drops.includes('combo:replaced'));
  assert.equal(a.queue[0].player, 2);
  a.enqueue(m('heal_streak'));
  a.enqueue(m('comeback'));
  assert.ok(drops.includes('combo:overflow'), 'lowest priority (combo 50 < heal_streak 55) is evicted');
  assert.deepEqual(a.queue.map((q) => q.type), ['comeback', 'heal_streak']);
});

test('uses getLine text when fast', async () => {
  const { a, player, lines, m } = setup({ getLine: async () => '  Generated line!  ' });
  a.enqueue(m('special'));
  await tick(); await tick();
  assert.equal(player.played[0].text, 'Generated line!');
  assert.equal(lines[0].source, 'getLine');
  assert.equal(a.stats.fromGetLine, 1);
});

test('falls back when getLine is slow, throws, or returns junk', async () => {
  for (const getLine of [
    () => wait(500).then(() => 'too late'),
    async () => { throw new Error('503'); },
    async () => '',
  ]) {
    const { a, player, lines, m } = setup({ getLine });
    a.enqueue(m('special'));
    await wait(80);
    assert.equal(lines[0].source, 'fallback');
    assert.ok(FALLBACK_LINES.special.map((t) => fillTemplate(t, { player: 1 })).includes(player.played[0].text));
  }
});

test('a moment that goes stale while waiting on getLine is dropped', async () => {
  let clock;
  const s = setup({ getLine: () => { clock.t += 5000; return Promise.resolve('late'); } });
  clock = s.clock;
  s.a.enqueue(s.m('hit'));
  await wait(10);
  assert.deepEqual(s.player.played, []);
  assert.ok(s.drops.includes('hit:stale'));
});

test('a failing player does not stall the queue', async () => {
  const played = [];
  const a = createAnnouncer({
    player: { play: async (t, m) => { played.push(m.type); throw new Error('decode'); }, stop() {} },
    options: { gapMs: 0 },
  });
  a.enqueue({ type: 'special', priority: 90, t: Date.now(), player: 1 });
  a.enqueue({ type: 'combo', priority: 50, t: Date.now(), player: 1 });
  await wait(10);
  assert.deepEqual(played, ['special', 'combo']);
});

test('stop() silences and ignores further moments', async () => {
  const { a, player, m } = setup();
  a.enqueue(m('special'));
  await tick();
  a.stop();
  a.enqueue(m('ko'));
  await tick();
  assert.deepEqual(player.played.map((p) => p.type), ['special']);
});

test('fallback lines: every moment type covered, short, templated, no immediate repeats', () => {
  for (const type of Object.keys(PRIORITY)) {
    assert.ok(FALLBACK_LINES[type]?.length, `no fallback lines for ${type}`);
    for (const line of FALLBACK_LINES[type]) {
      const text = fillTemplate(line, { player: 2, data: { round: 1 } });
      assert.ok(text.split(/\s+/).length <= 15, `too long: ${text}`);
      assert.doesNotMatch(text, /[{}]/);
    }
  }
  const pickLine = createFallbackPicker(() => 0);
  const a = pickLine({ type: 'ko', player: 1 });
  const b = pickLine({ type: 'ko', player: 1 });
  assert.notEqual(a, b);
  assert.match(a, /Player One/);
});
