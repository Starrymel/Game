import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestMatchSummary } from '../../src/commentary/summary.js';
import { initCommentary } from '../../src/commentary/index.js';
import { createSilentPlayer } from '../../src/commentary/announcer.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const S = { headline: 'Two wins!', analysis: 'Calm.', turningPoint: 'At 30s.', text: 'Two wins! Calm. Turning point: At 30s.', source: 'gemini' };

test('requestMatchSummary posts the detail and saves to the match when asked', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, method: init.method, body: JSON.parse(init.body) }); return ok(S); };
  const detail = { match: { id: 'm-abc 1' }, samples: [], events: [], snapshots: [{ t: 0, p1_hp: 1, p2_hp: 1 }] };

  assert.deepEqual(await requestMatchSummary(detail, { fetchImpl }), S);
  assert.equal(calls.length, 1, 'no save by default');
  assert.equal(calls[0].url, '/api/ai/summary');

  await requestMatchSummary(detail, { fetchImpl, save: true });
  assert.equal(calls[2].url, '/api/matches/m-abc%201/summary');
  assert.equal(calls[2].method, 'PUT');
  assert.deepEqual(calls[2].body, { summary: S.text });
});

test('requestMatchSummary throws on HTTP error, survives failed save', async () => {
  await assert.rejects(requestMatchSummary({}, { fetchImpl: async () => ({ ok: false, status: 503 }) }), /503/);
  let n = 0;
  const s = await requestMatchSummary({ match: { id: 'x' } }, {
    save: true,
    fetchImpl: async () => { if (n++) throw new Error('db down'); return ok(S); },
  });
  assert.equal(s.headline, 'Two wins!');
});

function makeBus() {
  const l = new Map();
  return {
    on(t, fn) { if (!l.has(t)) l.set(t, new Set()); l.get(t).add(fn); return () => l.get(t).delete(fn); },
    emit(t, p) { l.get(t)?.forEach((fn) => fn(p)); },
  };
}

test('round end -> summary requested with recorded log -> headline spoken', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bus = makeBus();
  const spoken = [];
  // Resolves immediately: a setTimeout-based player would be frozen by the mocked timers.
  const player = { play: async (text, m) => { spoken.push([m.type, text]); }, stop() {} };
  let sentDetail;
  const c = initCommentary({
    bus, player, lineSource: null,
    summarize: async (d) => { sentDetail = d; return S; },
  });
  const now = Date.now();
  bus.emit('round_start', { round: 1, t: now });
  bus.emit('state_snapshot', { t: now + 250, round: 1, timeRemaining: 98, players: [
    { id: 1, hp: 100, maxHp: 100, meter: 0, biometrics: null }, { id: 2, hp: 0, maxHp: 100, meter: 0, biometrics: null }] });
  bus.emit('ko', { winner: 1, loser: 2, t: now + 300 });
  bus.emit('round_end', { round: 1, winner: 1, t: now + 300 });
  assert.equal(sentDetail, undefined, 'waits for the KO call first');

  t.mock.timers.tick(2500);
  t.mock.timers.reset();
  // The headline queues behind the KO line and its 350ms inter-line gap.
  for (let i = 0; i < 50 && !spoken.some(([type]) => type === 'post_match'); i++) await wait(20);
  assert.equal(sentDetail.match.winner, 1);
  assert.equal(sentDetail.snapshots.length, 2);
  assert.ok(spoken.some(([type, text]) => type === 'post_match' && text === 'Two wins!'), JSON.stringify(spoken));
  c.stop();
});

test('summary for an old round is discarded if a new round started', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bus = makeBus();
  let calls = 0;
  const c = initCommentary({ bus, player: createSilentPlayer(), lineSource: null, summarize: async () => { calls++; return S; } });
  bus.emit('round_start', { round: 1, t: Date.now() });
  bus.emit('round_end', { round: 1, winner: null, t: Date.now() });
  bus.emit('round_start', { round: 2, t: Date.now() });
  t.mock.timers.tick(3000);
  t.mock.timers.reset();
  await wait(10);
  assert.equal(calls, 0, 'pending summary cancelled by round_start');
  c.stop();
});
