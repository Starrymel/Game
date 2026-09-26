import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAutoSummary, attach } = require('../../server/lib/autoSummary.js');

const quiet = { log() {}, warn() {} };
const G = { headline: 'H!', analysis: 'A.', turningPoint: 'T.', source: 'gemini' };

function fakeDb(matches) {
  const updates = [];
  return {
    updates,
    pool: {
      async query(sql, [id, text]) {
        updates.push({ sql, id, text });
        if (matches[id].summary) return { rowCount: 0 };
        matches[id].summary = text;
        return { rowCount: 1 };
      },
    },
    load: async (_pool, id) => (matches[id]
      ? { match: { id, summary: matches[id].summary ?? null }, samples: [], events: [{ t: 0 }], snapshots: [{ t: 0 }] }
      : null),
  };
}

test('saves the Gemini summary text for a match without one', async () => {
  const matches = { m1: {} };
  const db = fakeDb(matches);
  const w = createAutoSummary({ pool: db.pool, load: db.load, generateSummary: async () => G, log: quiet });
  assert.equal(await w.summarize('m1'), 'saved');
  assert.equal(matches.m1.summary, 'H! A. Turning point: T.');
  assert.match(db.updates[0].sql, /summary IS NULL/, 'guarded against overwriting');
});

test('never overwrites an existing summary, skips missing/empty matches', async () => {
  let calls = 0;
  const matches = { has: { summary: 'from recap' } };
  const db = fakeDb(matches);
  const w = createAutoSummary({ pool: db.pool, load: db.load, generateSummary: async () => { calls++; return G; }, log: quiet });
  assert.equal(await w.summarize('has'), 'exists');
  assert.equal(await w.summarize('nope'), 'missing');
  assert.equal(calls, 0);
  assert.equal(matches.has.summary, 'from recap');

  const empty = createAutoSummary({
    pool: db.pool, log: quiet, generateSummary: async () => { calls++; return G; },
    load: async () => ({ match: { summary: null }, samples: [], events: [], snapshots: [] }),
  });
  assert.equal(await empty.summarize('e'), 'empty');
  assert.equal(calls, 0);
});

test('does not store the template fallback (so Gemini can be retried later)', async () => {
  const matches = { m: {} };
  const db = fakeDb(matches);
  const w = createAutoSummary({ pool: db.pool, load: db.load, generateSummary: async () => ({ ...G, source: 'template' }), log: quiet });
  assert.equal(await w.summarize('m'), 'no-gemini');
  assert.equal(matches.m.summary, undefined);
  assert.equal(db.updates.length, 0);
});

test('runs one at a time, dedupes, and survives errors', async () => {
  const matches = { a: {}, b: {}, c: {} };
  const db = fakeDb(matches);
  let active = 0;
  let maxActive = 0;
  const order = [];
  const w = createAutoSummary({
    pool: db.pool, load: db.load, log: quiet,
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
  w.summarize('a');
  w.summarize('b');
  const last = await w.summarize('c');
  assert.equal(maxActive, 1);
  assert.deepEqual(order, ['a', 'b', 'c']);
  assert.equal(last, 'saved');
  assert.equal(matches.b.summary, undefined);
});

test('attach is a no-op without a DB or when disabled', () => {
  const hooks = [];
  const ingest = { onMatchEnd: (fn) => hooks.push(fn) };
  assert.equal(attach(ingest, { pool: null, env: {} }), null);
  assert.equal(attach(ingest, { pool: {}, env: { AUTO_SUMMARY: '0' } }), null);
  assert.equal(hooks.length, 0);
  assert.ok(attach(ingest, { pool: {}, env: {} }));
  assert.equal(hooks.length, 1);
});
