import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const express = require('express');
const { createMemoryStore, createMatchStore } = require('../../server/lib/matchStore.js');

const quiet = { log() {}, warn() {} };
const b1 = {
  match_id: 'm-1', started_at: '2026-09-26T19:00:00.000Z', meta: { p1_name: 'Ana', p2_name: 'Ben' },
  samples: [{ t: 500, player: 1, hr: 80, breath: 12, stress: 0.3, calm: 0.7, source: 'mock' }, { t: 0, player: 3, hr: 1 }],
  events: [{ t: 250, type: 'hit', player: 2, payload: { damage: 10 } }, { t: 1 }],
  snapshots: [{ t: 250, p1_hp: 100, p2_hp: 90, p1_meter: 5, p2_meter: 2 }, { t: 0, p1_hp: 100, p2_hp: 100, p1_meter: 0, p2_meter: 0 }],
};
const b1end = { match_id: 'm-1', snapshots: [{ t: 750, p1_hp: 100, p2_hp: 0, p1_meter: 9, p2_meter: 3 }], end: { winner: 1, duration_ms: 750 } };

test('memory store builds the same shapes as the DB routes', () => {
  const mem = createMemoryStore({ now: () => Date.parse('2026-09-26T19:00:01Z') });
  mem.ingest(b1);
  mem.ingest(b1end);
  const d = mem.detail('m-1');
  assert.deepEqual(Object.keys(d), ['match', 'samples', 'events', 'snapshots']);
  assert.deepEqual(Object.keys(d.match), ['id', 'started_at', 'ended_at', 'p1_name', 'p2_name', 'winner', 'duration_ms', 'summary', 'meta']);
  assert.equal(d.match.winner, 1);
  assert.equal(d.match.duration_ms, 750);
  assert.equal(d.match.ended_at, '2026-09-26T19:00:01.000Z');
  assert.equal(d.samples.length, 1, 'invalid player dropped');
  assert.equal(d.events.length, 1, 'event without type dropped');
  assert.deepEqual(d.snapshots.map((s) => s.t), [0, 250, 750], 'sorted by t across batches');
  assert.deepEqual(d.samples[0], { t: 500, player: 1, hr: 80, breath: 12, stress: 0.3, calm: 0.7, source: 'mock' });

  const [row] = mem.list();
  assert.deepEqual(Object.keys(row), ['id', 'started_at', 'ended_at', 'p1_name', 'p2_name', 'winner', 'duration_ms', 'has_summary', 'summary_preview']);
  assert.equal(row.has_summary, false);
  mem.setSummary('m-1', 'x'.repeat(300));
  assert.equal(mem.list()[0].summary_preview.length, 180);
});

test('memory store keeps only the newest N matches, newest first', () => {
  const mem = createMemoryStore({ max: 3 });
  for (let i = 1; i <= 5; i++) mem.ingest({ match_id: `m${i}` });
  assert.deepEqual(mem.list().map((m) => m.id), ['m5', 'm4', 'm3']);
  assert.equal(mem.detail('m1'), null);
});

function failingPool() {
  let calls = 0;
  return { get calls() { return calls; }, query: async () => { calls++; throw new Error('Connection terminated due to connection timeout'); } };
}

test('DB down: serves memory, and stops hitting the DB for 30s', async () => {
  const clock = { t: 0 };
  const pool = failingPool();
  const store = createMatchStore({ pool, now: () => clock.t, log: quiet });
  store.memory.ingest(b1);
  assert.deepEqual((await store.list()).source, 'memory');
  const callsAfterFirst = pool.calls;
  assert.equal((await store.detail('m-1')).source, 'memory');
  assert.equal(await store.saveSummary('m-1', 'S'), true);
  assert.equal(pool.calls, callsAfterFirst, 'no DB round trips while marked down');
  clock.t = 31000;
  await store.list();
  assert.ok(pool.calls > callsAfterFirst, 'retries the DB after 30s');
});

test('DB up: DB rows win, memory-only matches (not yet written) are added', async () => {
  const pool = {
    async query(sql, params = []) {
      if (/FROM matches ORDER BY/.test(sql)) return { rows: [{ id: 'db-1', started_at: '2026-09-26T18:00:00.000Z', has_summary: true, summary_preview: 'S' }] };
      if (/FROM matches WHERE id/.test(sql)) return { rows: params[0] === 'db-1' ? [{ id: 'db-1', summary: 'S' }] : [] };
      return { rows: [], rowCount: 1 };
    },
  };
  const store = createMatchStore({ pool, log: quiet });
  store.memory.ingest({ match_id: 'fresh', started_at: '2026-09-26T19:00:00.000Z' });
  const { source, rows } = await store.list();
  assert.equal(source, 'db');
  assert.deepEqual(rows.map((r) => r.id), ['fresh', 'db-1']);
  assert.equal((await store.detail('db-1')).source, 'db');
  assert.equal((await store.detail('fresh')).source, 'memory', 'not in DB yet: memory copy');
});

test('match routes work with no DB at all (list, detail, 404, PUT summary)', async () => {
  // Fresh module instances so the process-wide store starts empty.
  for (const k of Object.keys(require.cache)) if (/server[\\/](lib|routes)[\\/]/.test(k)) delete require.cache[k];
  const saved = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  try {
    const dbMod = require('../../server/lib/db.js');
    dbMod.pool = null;
    const { getMatchStore } = require('../../server/lib/matchStore.js');
    getMatchStore().memory.ingest(b1);
    getMatchStore().memory.ingest(b1end);
    const app = express();
    app.use(express.json());
    app.use('/api/matches', require('../../server/routes/matches.js'));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${server.address().port}/api/matches`;
    try {
      const list = await fetch(base);
      assert.equal(list.status, 200);
      assert.equal(list.headers.get('x-match-source'), 'memory');
      assert.equal((await list.json())[0].id, 'm-1');
      const det = await fetch(`${base}/m-1`);
      assert.equal(det.status, 200);
      assert.equal((await det.json()).snapshots.length, 3);
      assert.equal((await fetch(`${base}/nope`)).status, 404);
      const put = await fetch(`${base}/m-1/summary`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ summary: 'Saved!' }) });
      assert.equal(put.status, 200);
      assert.equal((await (await fetch(`${base}/m-1`)).json()).match.summary, 'Saved!');
      assert.equal((await fetch(`${base}/nope/summary`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 503);
    } finally {
      server.close();
    }
  } finally {
    if (saved !== undefined) process.env.DATABASE_URL = saved;
  }
});
