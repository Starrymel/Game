import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutoSummary, attach } = require('../../server/lib/autoSummary.js');
const { createMatchStore, createMemoryStore } = require('../../server/lib/matchStore.js');

const quiet = { log() {}, warn() {} };
const G = { headline: 'H!', analysis: 'A.', turningPoint: 'T.', source: 'gemini' };
const batch = (id, end = { winner: 1, duration_ms: 1000 }) => ({
  match_id: id, meta: { p1_name: 'Ana', p2_name: 'Ben' },
  snapshots: [{ t: 0, p1_hp: 100, p2_hp: 100 }], events: [{ t: 10, type: 'hit', player: 2, payload: {} }], end,
});

function memStore(...ids) {
  const store = createMatchStore({ pool: null, log: quiet });
  for (const id of ids) store.memory.ingest(batch(id));
  return store;
}

test('saves the Gemini summary text (no DB needed)', async () => {
  const store = memStore('m1');
  const w = createAutoSummary({ store, generateSummary: async () => G, log: quiet });
  assert.equal(await w.summarize('m1'), 'saved');
  assert.equal(store.memory.detail('m1').match.summary, 'H! A. Turning point: T.');
});

test('never overwrites an existing summary; skips missing/empty matches', async () => {
  let calls = 0;
  const store = memStore('has');
  store.memory.setSummary('has', 'from recap');
  store.memory.ingest({ match_id: 'empty', end: { winner: 1 } });
  const w = createAutoSummary({ store, generateSummary: async () => { calls++; return G; }, log: quiet });
  assert.equal(await w.summarize('has'), 'exists');
  assert.equal(await w.summarize('nope'), 'missing');
  assert.equal(await w.summarize('empty'), 'empty');
  assert.equal(calls, 0);
  assert.equal(store.memory.detail('has').match.summary, 'from recap');
});

test('does not store the template fallback, and allows a later retry', async () => {
  const store = memStore('m');
  let source = 'template';
  const w = createAutoSummary({ store, generateSummary: async () => ({ ...G, source }), log: quiet });
  assert.equal(await w.summarize('m'), 'no-gemini');
  assert.equal(store.memory.detail('m').match.summary, null);
  source = 'gemini';
  assert.equal(await w.summarize('m'), 'saved');
});

test('runs one at a time, once per match, and survives errors', async () => {
  const store = memStore('a', 'b', 'c');
  let active = 0;
  let maxActive = 0;
  const order = [];
  const w = createAutoSummary({
    store, log: quiet,
    generateSummary: async (d) => {
      active++; maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      order.push(d.match.id);
      if (d.match.id === 'b') throw new Error('boom');
      return G;
    },
  });
  w.summarize('a');
  w.summarize('a'); // second end signal (memory, then DB) for the same match
  w.summarize('b');
  const last = await w.summarize('c');
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(last, 'saved');
  assert.equal(await w.summarize('a'), 'saved', 'already done: not re-run');
  assert.equal(order.length, 3);
});

test('attach works without a DB; disabled by AUTO_SUMMARY=0', () => {
  const hooks = [];
  const ingest = { onMatchEnd: (fn) => hooks.push(fn) };
  const store = createMatchStore({ pool: null, memory: createMemoryStore() });
  assert.equal(attach(ingest, { store, env: { AUTO_SUMMARY: '0' } }), null);
  assert.equal(hooks.length, 0);
  assert.ok(attach(ingest, { store, env: {} }));
  assert.equal(hooks.length, 1);
});
