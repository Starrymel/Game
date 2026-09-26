import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiLineSource } from '../../src/commentary/aiClient.js';

const res = (status, body = {}) => ({ ok: status < 400, status, json: async () => body });
const m = (type) => ({ type, player: 1, t: 0, data: {}, context: null });

test('returns server text and sends recent lines', async () => {
  let sent;
  const src = createGeminiLineSource({ fetchImpl: async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return res(200, { text: 'Boom!' }); } });
  src.remember('one');
  src.remember('two');
  assert.equal(await src.getLine(m('special')), 'Boom!');
  assert.equal(sent.url, '/api/ai/line');
  assert.deepEqual(sent.body.recent, ['one', 'two']);
  assert.equal(sent.body.moment.type, 'special');
});

test('hit chatter skips the API', async () => {
  let calls = 0;
  const src = createGeminiLineSource({ fetchImpl: async () => { calls++; return res(200, { text: 'x' }); } });
  assert.equal(await src.getLine(m('hit')), null);
  assert.equal(calls, 0);
});

test('backs off after a 5xx, retries after backoff', async () => {
  const clock = { t: 0 };
  let calls = 0;
  let status = 503;
  const src = createGeminiLineSource({ now: () => clock.t, backoffMs: 1000, fetchImpl: async () => { calls++; return res(status, { text: 'ok' }); } });
  assert.equal(await src.getLine(m('ko')), null);
  assert.equal(await src.getLine(m('ko')), null);
  assert.equal(calls, 1, 'second call skipped during backoff');
  clock.t = 1500;
  status = 200;
  assert.equal(await src.getLine(m('ko')), 'ok');
});

test('aborts slow requests and returns null', async () => {
  const src = createGeminiLineSource({
    timeoutMs: 20,
    fetchImpl: (url, { signal }) => new Promise((_, rej) => signal.addEventListener('abort', () => rej(new Error('abort')))),
  });
  const start = Date.now();
  assert.equal(await src.getLine(m('special')), null);
  assert.ok(Date.now() - start < 500);
  assert.equal(src.stats.failed, 1);
});

test('network error returns null (announcer falls back)', async () => {
  const src = createGeminiLineSource({ fetchImpl: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(await src.getLine(m('special')), null);
});
